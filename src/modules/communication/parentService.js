// src/modules/communication/parentService.js
// ═══════════════════════════════════════════════════════════════════════════
// خدمة ملف ولي الأمر — يشتق أولياء الأمور وإحصائياتهم من سجلات التواصل.
// ولي الأمر كيان أساسي (first-class) لكنه محسوب من البيانات، لا يُخزّن منفصلاً
// إلا للبيانات الإضافية (هاتف بديل، تفضيلات). SQL-ready.
// ═══════════════════════════════════════════════════════════════════════════

import { CommType, CommResult, CommStatus, TaskStatus } from './constants';

// مفتاح تعريف ولي الأمر: الهاتف أولاً، ثم الاسم (للتجميع المحلي فقط — لا علاقة له
// بمطابقة صف parents الحقيقي، انظر normalizeParentPhone أدناه).
export function parentKey(record) {
  return (record.phone && record.phone.trim()) || (record.parentName && record.parentName.trim()) || null;
}

// تطبيع رقم الهاتف المصري لمطابقة عمود parents.phone الحقيقي (الصيغة الدولية
// 201xxxxxxxxx) — نفس الخوارزمية المستخدَمة بالفعل في migration/mapping/normalizePhone.js
// وفي src/modules/student-report/studentWhatsappService.js (مكرَّرة هناك عمداً كدالة
// محلية غير مُصدَّرة، لا util مشترك — نفس النمط هنا). رقم غير صالح → null (لا نبني
// parent وهمي، ولا نطابق بالاسم مطلقاً — Phase 3B-16 Decision Needed #1).
export function normalizeParentPhone(phone) {
  if (!phone) return null;
  let p = String(phone).replace(/[\s\-()]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('00')) p = p.slice(2);
  if (/^01[0-9]{9}$/.test(p)) return '20' + p.slice(1);
  if (/^201[0-9]{9}$/.test(p)) return p;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// تجميع أولياء الأمور من سجلات التواصل (مع مطابقة صف parents الحقيقي عبر الهاتف
// المطبَّع — Phase 3B-16: parents هو مصدر الحقيقة الوحيد للبيانات الإضافية الآن،
// لا parentExtras محلي إطلاقاً بعد الآن)
// ─────────────────────────────────────────────────────────────────────────────
export function deriveParents(records = [], realParents = []) {
  const map = new Map();

  for (const r of records) {
    const key = parentKey(r);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        key,
        parentName: r.parentName || '',
        phone: r.phone || '',
        studentNames: new Set(),
        records: [],
      });
    }
    const p = map.get(key);
    if (!p.parentName && r.parentName) p.parentName = r.parentName;
    if (!p.phone && r.phone) p.phone = r.phone;
    if (r.studentName) p.studentNames.add(r.studentName);
    p.records.push(r);
  }

  // فهرسة parents الحقيقيين بالهاتف المطبَّع (مرة واحدة) لمطابقة O(1)
  const byPhone = new Map();
  for (const rp of realParents) {
    const np = normalizeParentPhone(rp.phone);
    if (np) byPhone.set(np, rp);
  }

  // تحويل + مطابقة صف parents الحقيقي (إن وُجد)
  return Array.from(map.values()).map((p) => {
    const normalizedPhone = normalizeParentPhone(p.phone);
    const match = normalizedPhone ? byPhone.get(normalizedPhone) : null;
    return {
      ...p,
      studentNames: Array.from(p.studentNames),
      normalizedPhone,
      id: match?.id ?? null,
      altPhone: match?.altPhone || '',
      notes: match?.notes || '',
      preferredMethod: match?.preferredMethod || null,
      preferredTime: match?.preferredTime || '',
      // مراجع مستقبلية (nullable) — لا عمود لها، تبقى كما كانت دائماً (لا قارئ لها
      // في التطبيق إطلاقاً، مؤكَّد — خارج نطاق Phase 3B-16)
      studentIds: [],
      admissionIds: [],
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// إحصائيات ولي أمر (من سجلاته)
// ─────────────────────────────────────────────────────────────────────────────
export function getParentStats(parentRecords = []) {
  const sorted = parentRecords.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const byType = (t) => parentRecords.filter((r) => r.type === t).length;
  const byResult = (res) => parentRecords.filter((r) => r.result === res).length;

  const lastComm = sorted[0] || null;
  const lastSuccess = sorted.find((r) =>
    r.result === CommResult.ANSWERED ||
    r.result === CommResult.CONFIRMED_ATTENDANCE ||
    r.result === CommResult.COMPLETED
  ) || null;
  const lastNoAnswer = sorted.find((r) => r.result === CommResult.NO_ANSWER) || null;

  return {
    total: parentRecords.length,
    calls: byType(CommType.PHONE_CALL),
    whatsapp: byType(CommType.WHATSAPP),
    sms: byType(CommType.SMS),
    visits: byType(CommType.PARENT_VISIT) + byType(CommType.CENTER_VISIT),
    // محاولات الاتصال (نتائج)
    answered: byResult(CommResult.ANSWERED),
    noAnswer: byResult(CommResult.NO_ANSWER),
    busy: byResult(CommResult.BUSY),
    phoneOff: byResult(CommResult.PHONE_OFF),
    wrongNumber: byResult(CommResult.WRONG_NUMBER),
    lastComm,
    lastSuccess,
    lastNoAnswer,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// الإجراء التالي الوحيد لولي الأمر (أحدث متابعة معلّقة)
// ─────────────────────────────────────────────────────────────────────────────
export function getNextAction(parentRecords = []) {
  // أحدث سجل له تاريخ متابعة مستقبلي/اليوم
  const withFollowup = parentRecords
    .filter((r) => r.followupDate && r.status !== CommStatus.ARCHIVED)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return withFollowup[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// سجلات ولي أمر (الأحدث أولاً)
// ─────────────────────────────────────────────────────────────────────────────
export function getParentHistory(records = [], key) {
  return records
    .filter((r) => parentKey(r) === key)
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
