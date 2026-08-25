// src/services/materialService.js
import { validate, hasErrors, sanitizeFormData, materialSchema } from '../utils/validation';

export const GRADES = [
  'الصف الأول الثانوي',
  'الصف الثاني الثانوي',
  'الصف الثالث الثانوي',
  'الصف الأول الإعدادي',
  'الصف الثاني الإعدادي',
  'الصف الثالث الإعدادي',
];

export const SUBJECTS = [
  'رياضيات','فيزياء','كيمياء','أحياء','إنجليزية','عربي',
  'تاريخ','جغرافيا','فلسفة','حاسب','علوم','أخرى',
];

export const PAY_STATUS = {
  paid:    { label: 'مدفوع',          color: '#10b981', bg: 'rgba(16,185,129,.12)', border: 'rgba(16,185,129,.25)' },
  partial: { label: 'مدفوع جزئياً',  color: '#f59e0b', bg: 'rgba(245,158,11,.12)', border: 'rgba(245,158,11,.25)' },
  unpaid:  { label: 'غير مدفوع',     color: '#ef4444', bg: 'rgba(239,68,68,.12)',  border: 'rgba(239,68,68,.25)'  },
};

// ── Validation ──────────────────────────────────────────────
export function validateMaterial(data) {
  const errors = {};
  if (!data.name?.trim())    errors.name    = 'اسم المذكرة مطلوب';
  if (!data.subject)         errors.subject = 'اختر المادة';
  if (!data.grade)           errors.grade   = 'اختر السنة الدراسية';
  if (!data.addedAt)         errors.addedAt = 'تاريخ الإضافة مطلوب';
  if (data.price !== '' && data.price !== undefined && Number(data.price) < 0)
    errors.price = 'السعر يجب أن يكون موجباً';
  return errors;
}

// ── Create ──────────────────────────────────────────────────
export function createMaterial(data) {
  const errors = validate(materialSchema, data);
  if (hasErrors(errors)) throw { type: 'VALIDATION', errors };
  const clean = sanitizeFormData(data, ['name','description','teacher']);
  return {
    id:          `mat${Date.now()}`,
    name:        clean.name?.trim(),
    subject:     clean.subject,
    teacher:     clean.teacher || '',
    grade:       clean.grade,
    price:       Number(clean.price) || 0,
    description: clean.description?.trim() || '',
    addedAt:     clean.addedAt || new Date().toISOString().split('T')[0],
    createdAt:   new Date().toISOString(),
  };
}

// ── Update ──────────────────────────────────────────────────
export function updateMaterial(id, data) {
  const errors = validate(materialSchema, data);
  if (hasErrors(errors)) throw { type: 'VALIDATION', errors };
  const clean = sanitizeFormData(data, ['name','description','teacher']);
  return {
    id, name: clean.name?.trim(), subject: clean.subject, teacher: clean.teacher || '',
    grade: clean.grade, price: Number(clean.price), description: clean.description?.trim() || '',
    addedAt: clean.addedAt || data.addedAt,
    updatedAt: new Date().toISOString(),
  };
}

// ── matDist read-path (derived from inventoryTxn, no independent state) ─────
// نفس فلتر Phase 3B-12 Finding #1 بالضبط (استبعاد status='cancelled')، ونفس معنى
// "آخر حركة نشطة حقيقية لكل طالب" في backend/src/routes/materialDistribution.js —
// هذه الدالة تعيد فقط القراءة (لا قرار كتابة/تسوية إطلاقاً)، بنفس نمط
// reportData.js's bookletDeliveries (Phase 3B-12 Finding #3) — اشتقاق من
// inventoryTxn المُزامَن إقلاعياً بالفعل، بلا أي حالة محلية مستقلة جديدة.
const MATDIST_RELEVANT_TXN_TYPES = ['studentDelivery', 'reservation', 'reservationRelease', 'return'];

export function deriveMatDist(inventoryTxn = []) {
  const relevant = inventoryTxn.filter(
    (t) => MATDIST_RELEVANT_TXN_TYPES.includes(t.type) && t.status !== 'cancelled'
  );

  // أحدث حركة نشطة لكل زوج (matId, studentId) — نفس latestByStudent في
  // materialDistribution.js (orderBy created_at desc، أول عنصر فقط).
  const latestByPair = new Map();
  for (const t of relevant) {
    const key = `${t.materialId}:${t.studentId}`;
    const existing = latestByPair.get(key);
    if (!existing || new Date(t.createdAt) > new Date(existing.createdAt)) {
      latestByPair.set(key, t);
    }
  }

  // طالب لم تُمَسّ حالته إطلاقاً (لا حركة نشطة له لهذه المادة) → لا سجل هنا، تماماً كما
  // isUntouchedDefault في materialDistribution.js لا تُنشئ حركة وهمية له. كل القارئين
  // الحاليين (MaterialsPage/MaterialDistribution/MaterialReports/StudentReportPage)
  // يتعاملون مع غياب السجل كـ "لم يُستلَم/غير مدفوع" افتراضياً بالفعل، بلا تغيير هنا.
  return Array.from(latestByPair.values()).map((t) => {
    const meta = t.legacyMetadata || {};
    return {
      id:         t.id,
      matId:      t.materialId,
      studentId:  t.studentId,
      received:   t.type === 'studentDelivery',
      receivedAt: meta.receivedAt ?? null,
      payStatus:  meta.payStatus || 'unpaid',
      paidAmount: Number(meta.paidAmount) || 0,
    };
  });
}

// ── Distribution stats for one material ─────────────────────
export function getMatStats(matId, dist, students) {
  const matDist       = dist.filter(d => d.matId === matId);
  const receivedDist  = matDist.filter(d => d.received);
  const paidDist      = matDist.filter(d => d.payStatus === 'paid');
  const partialDist   = matDist.filter(d => d.payStatus === 'partial');
  const unpaidDist    = matDist.filter(d => d.payStatus === 'unpaid' || !d.payStatus);
  const totalCollected= matDist.reduce((s, d) => s + (d.paidAmount || 0), 0);

  return {
    totalStudents:  matDist.length,
    received:       receivedDist.length,
    notReceived:    matDist.length - receivedDist.length,
    paid:           paidDist.length,
    partial:        partialDist.length,
    unpaid:         unpaidDist.length,
    totalCollected,
  };
}

// ── Revenue across all materials ────────────────────────────
export function getTotalRevenue(dist) {
  return dist.reduce((s, d) => s + (d.paidAmount || 0), 0);
}
