// src/modules/admissions/AdmissionsPage.jsx
// ─────────────────────────────────────────────────────────────────────────────
// وحدة التسجيل والقبول — CRM خفيف لرحلة الطالب من أول اتصال حتى التفعيل.
// واجهة فقط (بيانات تجريبية). كل شيء داخل صفحة واحدة بتبويبات.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useMemo } from 'react';
import {
  STAGES, LEAD_STATUS, RESERVATION_STATUS, LEAD_SOURCES,
  FOLLOWUP_TYPES, ADMISSION_PAYMENT_TYPES, MOCK_GROUPS, nextAdmissionNumber, SYSTEM_EVENTS,
} from './mockData';
import {
  AdmissionStage, LeadStatus, ReservationStatus, PaymentType,
  SystemActivityType, isFullName,
} from './constants';
import { Badge, Avatar, StatCard, Field, inputStyle } from './components';
import { useToast } from '../../components/Toast';
import { useAppStore } from '../../store/app.store';
import { useAuth } from '../../store/auth.context';
import { createStudent } from '../../services/studentService';
import { GRADES } from '../../services/groupService';
import {
  pgGetCollection, pgActivateAdmission, pgCreateParent,
  pgCreateAdmission, pgUpdateAdmission, pgCreateAdmissionFollowup, pgCreateAdmissionSystemLog,
  pgCreateAdmissionPayment, pgCancelAdmissionWithRefund,
} from '../../services/api';
import { normalizeParentPhone } from '../communication/parentService';
import { getAdmissionTreasuryTotals } from '../../services/treasuryService';
import { openAdmissionReport } from './buildAdmissionReport';

// Product Completion Phase 1 — Issue 3: نفس findOrCreateParentId المستخدَم في
// StudentsPage.jsx بالضبط (مكرَّر عمداً لا util مشترك — نفس نمط normalizeParentPhone
// نفسه المكرَّر أصلاً بين studentWhatsappService.js وmigration/mapping/normalizePhone.js).
async function findOrCreateParentId(phone) {
  const normalized = normalizeParentPhone(phone);
  if (!normalized) return null;
  const result = await pgCreateParent(
    { phone: normalized },
    {
      onPhoneConflict: async () => {
        const fresh = await pgGetCollection('parents');
        return fresh.find((r) => normalizeParentPhone(r.phone) === normalized)?.id ?? null;
      },
    }
  );
  if (result.conflict) {
    if (!result.existingId) throw new Error('تعذّر إيجاد سجل ولي الأمر بعد تعارض الهاتف');
    return result.existingId;
  }
  return result.data.id;
}

const TABS = [
  { id: 'leads',    label: 'العملاء المحتملون', icon: '📞' },
  { id: 'reserved', label: 'الحجز',             icon: '📋' },
  { id: 'followup', label: 'المتابعة',          icon: '🔄' },
  { id: 'active',   label: 'الطلاب النشطون',    icon: '✅' },
];

// Phase 3B-13A/3B-14D — يجمع سجل قبول واحد (شكل الخادم فقط) مع أبنائه
// (admissionFollowups/admissionSystemLog/admissionPayments، كلها جداول علائقية حقيقية
// على PostgreSQL الآن). هذا عرض مُشتَقّ فقط للقراءة — لا يُكتَب أبداً بشكله المركَّب إلى
// أي state؛ كل كتابة تستهدف الـ collection المُطبَّعة الصحيحة مباشرة (انظر
// updateRecord/addFollowup/logEvent/addPayment/doCancelWithRefund أدناه).
function composeAdmission(admission, followups, systemLog, payments) {
  return {
    ...admission,
    followups: followups.filter((f) => f.admissionId === admission.id),
    systemLog: systemLog.filter((l) => l.admissionId === admission.id),
    payments:  payments.filter((p) => p.admissionId === admission.id),
  };
}

export default function AdmissionsPage() {
  const toast = useToast();
  const { currentUser } = useAuth();
  const currentUserName = currentUser?.name || currentUser?.id || 'الموظف الحالي';

  // البيانات الخام (شكل الخادم فقط) — مصدر الحقيقة PostgreSQL لكل الأربعة الآن (Phase
  // 3B-14D: admissionPayments أصبحت مُزامَنة حقيقياً، بعد أن كانت admissionPaymentsLocal
  // محلية بحتة).
  const admissionsRaw      = useAppStore((s) => s.admissions);
  const admissionFollowups = useAppStore((s) => s.admissionFollowups);
  const admissionSystemLog = useAppStore((s) => s.admissionSystemLog);
  const admissionPayments  = useAppStore((s) => s.admissionPayments);
  const setAdmissionsRaw      = useAppStore((s) => s.setAdmissions);
  const setAdmissionFollowups = useAppStore((s) => s.setAdmissionFollowups);
  const setAdmissionSystemLog = useAppStore((s) => s.setAdmissionSystemLog);
  const setAdmissionPayments  = useAppStore((s) => s.setAdmissionPayments);

  // العرض المركَّب — كل قراءة أدناه (stats/leadRecords/.../selected) تستخدم هذا، بنفس
  // الشكل بالضبط الذي كانت تقرأه من قبل (r.followups/r.payments/r.systemLog) — لا تغيير
  // في أي موضع قراءة سوى مصدر "records" هذا نفسه.
  const records = useMemo(
    () => admissionsRaw.map((a) => composeAdmission(a, admissionFollowups, admissionSystemLog, admissionPayments)),
    [admissionsRaw, admissionFollowups, admissionSystemLog, admissionPayments]
  );

  // تسجيل حدث نظامي تلقائي في سجل القبول — Phase 3B-13A: PostgreSQL مصدر الحقيقة الآن.
  // خطأ ثانوي غير حاجب عمداً (نفس مبدأ waReportLog تماماً — انظر تقرير قرار Phase 3B-9):
  // هذا حدث تدقيق تلقائي مصاحب لإجراء أساسي منجز بالفعل من جهته الخاصة، لا إجراء بواجهة
  // مستقلة — فشل تسجيله لا يجوز أن يُلغي/يُعلِّق نجاح الإجراء الأساسي الذي استدعاه.
  const logEvent = async (recordId, type, detail = '') => {
    try {
      const saved = await pgCreateAdmissionSystemLog({
        admissionId: recordId, type, detail, by: currentUser?.id ? currentUserName : null,
      });
      setAdmissionSystemLog((prev) => [...prev, saved]);
    } catch (e) {
      toast.error(e.message || 'تعذّر تسجيل النشاط النظامي');
    }
  };
  const [tab, setTab] = useState('leads');
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const [filterGrade, setFilterGrade] = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  // بيانات حقيقية: المجموعات والطلاب (لإضافة الطالب فعلياً عند تأكيد الحجز)
  const realGroups   = useAppStore((s) => s.groups);
  const realStudents = useAppStore((s) => s.students);
  const addStudent   = useAppStore((s) => s.addStudent);
  // للربط بالمدفوعات الحقيقية والخزنة والمذكرات
  const setTreasuryTxn = useAppStore((s) => s.setTreasuryTxn);
  const treasuryTxn    = useAppStore((s) => s.treasuryTxn);
  const cashboxes      = useAppStore((s) => s.cashboxes);
  const realMaterials  = useAppStore((s) => s.invMaterials);
  const centerProfile  = useAppStore((s) => s.centerProfile);
  // سجل القبول الجاري تأكيد حجزه (يفتح مودال اختيار المجموعة)
  const [confirmFor, setConfirmFor] = useState(null);
  const [cancelFor, setCancelFor] = useState(null);

  const selected = records.find(r => r.id === selectedId) || null;

  // إحصائيات المراحل
  const stats = useMemo(() => ({
    lead:        records.filter(r => r.stage === AdmissionStage.LEAD).length,
    reserved:    records.filter(r => r.stage === AdmissionStage.RESERVED).length,
    waiting:     records.filter(r => r.stage === AdmissionStage.WAITING).length,
    followup:    records.filter(r => r.stage !== AdmissionStage.ACTIVE && (r.followups || []).length > 0).length,
    confirmed:   records.filter(r => r.stage === AdmissionStage.CONFIRMED).length,
    active:      records.filter(r => r.stage === AdmissionStage.ACTIVE).length,
  }), [records]);

  // فلترة حسب البحث والفلاتر
  const filterFn = (r) => {
    const q = search.trim().toLowerCase();
    if (q && !(
      r.name.toLowerCase().includes(q) ||
      r.phone.includes(q) ||
      r.parentPhone.includes(q)
    )) return false;
    if (filterGrade && r.grade !== filterGrade) return false;
    if (filterGroup && r.group !== filterGroup) return false;
    return true;
  };

  // سجلات كل تبويب
  const leadRecords     = records.filter(r => r.stage === AdmissionStage.LEAD).filter(filterFn);
  const reservedRecords = records.filter(r => r.stage === AdmissionStage.RESERVED || r.stage === AdmissionStage.WAITING || r.stage === AdmissionStage.CONFIRMED).filter(filterFn);
  const followupRecords = records.filter(r => r.followups && r.followups.length > 0).filter(filterFn);
  const activeRecords   = records.filter(r => r.stage === AdmissionStage.ACTIVE).filter(filterFn);

  // ── إجراءات ──
  // Phase 3B-13A: PostgreSQL مصدر الحقيقة الآن لسجل القبول نفسه (name/stage/.../
  // reservationDate/courseFee...) — لا تعديل محلي إلا بعد نجاح الخادم. الدمج بعد النجاح
  // {...المحلي، ...استجابة_الخادم} (لا استبدال الصف كاملاً) يُبقي أي حقل محلي بحت
  // (activatedAt/confirmedAt/firstLessonAttended/secretary/booklets/cancelReason/اسم
  // المجموعة للعرض...) لأن الخادم لا يعيده أبداً — نفس مبدأ mergeCenterProfileSingleton
  // بالضبط (db.middleware.js، Phase 3B-10)، هنا عند تبنّي استجابة الكتابة بدل المزامنة.
  // يرمي عند الفشل (لا يلتقط الخطأ داخلياً) — كل مستدعٍ يملك try/catch خاصاً به لعرض
  // رسالة الخطأ الحقيقية وعدم إظهار نجاح وهمي.
  const updateRecord = async (id, updates) => {
    const saved = await pgUpdateAdmission(id, { ...updates, lastModifiedBy: currentUser?.id ?? null });
    setAdmissionsRaw((prev) => prev.map((r) => (r.id === id ? { ...r, ...saved } : r)));
    return saved;
  };

  const convertToReservation = async (id) => {
    try {
      await updateRecord(id, { stage: AdmissionStage.RESERVED, reservationStatus: ReservationStatus.RESERVED, reservationDate: new Date().toISOString().split('T')[0] });
      logEvent(id, SystemActivityType.RESERVATION);
      toast.success('تم تحويل العميل إلى حجز');
    } catch (e) {
      toast.error(e.message || 'فشل تحويل العميل إلى حجز');
    }
  };
  const confirmReservation = (id) => {
    const rec = records.find(r => r.id === id);
    if (rec) setConfirmFor(rec); // افتح مودال اختيار المجموعة
  };

  // تأكيد الحجز بعد اختيار المجموعة:
  // يحوّل السجل إلى "مؤكّد" ويربط المجموعة — لا يُنشئ طالباً حقيقياً بعد.
  // (الطالب يصبح حقيقياً/نشطاً فقط عند حضور أول حصة)
  const doConfirmWithGroup = async (rec, groupId) => {
    const group = realGroups.find(g => g.id === groupId);
    try {
    await updateRecord(rec.id, {
      stage: AdmissionStage.CONFIRMED,
      reservationStatus: ReservationStatus.RESERVED,
      confirmedGroupId: groupId,
      group: group?.name || rec.group,
      confirmedAt: new Date().toISOString().split('T')[0],
    });
    logEvent(rec.id, SystemActivityType.CONFIRMED, group?.name || '');
    setConfirmFor(null);
    toast.success(`تم تأكيد حجز ${rec.name} في ${group?.name || ''} \u2713`);
    } catch (e) {
      toast.error(e.message || 'فشل تأكيد الحجز');
    }
  };

  // حضور أول حصة = التفعيل:
  // الآن يُنشأ الطالب الحقيقي في إدارة الطلاب، ويتحوّل السجل إلى "طالب نشط".
  //
  // Phase 3B-13B (Stage ii) — تفعيل ذرّي حقيقي: كان Stage (i) ينسّق نفس هذه الكتابات
  // عبر 4 طلبات HTTP منفصلة تماماً (pgCreateStudent ثم updateRecord ثم logEvent مرّتين)
  // بلا أي ذرّية بينها — سباق بين تفعيلين متزامنين لنفس سجل القبول كان قادراً على إنشاء
  // طالبين مختلفين وترك أحدهما يتيماً. الآن استدعاء واحد فقط (pgActivateAdmission) ينفّذ
  // الأربعة معاً في معاملة PostgreSQL واحدة على الخادم — إما تنجح كلها أو لا شيء يتغيّر.
  // createStudent() المحلي يبقى هنا فقط للتحقّق/التطهير (نفس رسائل الخطأ المحلية الحالية
  // قبل أي استدعاء شبكة) — id/code/enrollDate/createdAt/updatedAt/gender المحلية تُهمَل
  // عمداً (الخادم يولّد id/code داخل المعاملة نفسها، بيانات حديثة فعلياً لا عدّاد محلي
  // قديم؛ gender لا عمود له إطلاقاً في students، نفس الاستبعاد الصامت الحالي).
  const attendFirstLesson = async (id) => {
    const rec = records.find(r => r.id === id);
    if (!rec) return;
    const groupId = rec.confirmedGroupId;
    const group = realGroups.find(g => g.id === groupId);
    if (!group) { toast.error('لا توجد مجموعة مؤكّدة لهذا الطالب'); return; }
    if (!isFullName(rec.name)) {
      toast.error(`اسم الطالب "${rec.name}" غير ثنائي — عدّل الاسم أولاً ليصبح ثنائياً قبل التفعيل`);
      return;
    }
    try {
      const validated = createStudent({
        name:        rec.name,
        phone:       rec.phone || '',
        parentPhone: rec.parentPhone || '',
        grade:       group?.grade || rec.grade,
        groupId:     groupId,
        school:      rec.school || '',
        status:      'active',
        notes:       rec.notes || '',
      }, realStudents);

      const parentId = await findOrCreateParentId(validated.parentPhone);

      const { admission: savedAdmission, student: savedStudent, systemLogEntries } = await pgActivateAdmission(rec.id, {
        name: validated.name, phone: validated.phone, parentPhone: validated.parentPhone,
        grade: validated.grade, groupId: validated.groupId, school: validated.school,
        notes: validated.notes, status: validated.status,
        ...(parentId ? { parentId } : {}),
      });

      addStudent(savedStudent);
      setAdmissionsRaw(prev => prev.map(r => (r.id === rec.id
        ? { ...r, ...savedAdmission, firstLessonAttended: true, activatedAt: new Date().toISOString().split('T')[0] }
        : r)));
      if (systemLogEntries.length) setAdmissionSystemLog(prev => [...prev, ...systemLogEntries]);
      toast.success(`حضر ${rec.name} أول حصة وتم تفعيله كطالب نشط \ud83c\udf89`);
    } catch (e) {
      const msg = e?.errors ? Object.values(e.errors)[0] : (e.message || 'تعذّر إضافة الطالب');
      toast.error(msg);
    }
  };

  const cancelReservation  = async (id) => {
    const rec = records.find(r => r.id === id);
    if (!rec) return;

    // إن لم توجد أي دفعات إطلاقاً → إلغاء مباشر بلا مودال سبب (لا شيء لاسترداده)
    if ((rec.payments || []).length === 0) {
      await doCancelWithRefund(rec, '');
      return;
    }

    // توجد دفعات → افتح مودال الاسترداد (السبب مطلوب هناك)
    setCancelFor(rec);
  };

  // إلغاء الحجز + استرداد كل دفعاته غير المستردة، Phase 3B-14D: معاملة ذرّية واحدة على
  // الخادم (backend/src/routes/admissionCancellation.js) — تحوّل حالة سجل القبول +
  // تحديد الدفعات القابلة للاسترداد + إنشاء حركات الاسترداد كلها معاً، تنجح كلها أو
  // تفشل كلها. لا تعديل محلي قبل نجاح الخادم؛ عند النجاح تُتبنّى الاستجابة الكاملة.
  const doCancelWithRefund = async (rec, reason) => {
    try {
      const { admission, refundTxns, logs } = await pgCancelAdmissionWithRefund(rec.id, reason || '');
      setAdmissionsRaw(prev => prev.map(a => (a.id === rec.id ? { ...a, ...admission } : a)));
      if (refundTxns.length > 0) setTreasuryTxn(prev => [...prev, ...refundTxns]);
      if (logs.length > 0) setAdmissionSystemLog(prev => [...prev, ...logs]);
      setCancelFor(null);
      toast.success(refundTxns.length > 0
        ? `تم إلغاء الحجز واسترداد ${refundTxns.length} دفعة`
        : 'تم إلغاء الحجز');
    } catch (e) {
      toast.error(e.message || 'فشل إلغاء الحجز');
    }
  };
  const moveToWaiting = async (id) => {
    try {
      await updateRecord(id, { stage: AdmissionStage.WAITING, reservationStatus: ReservationStatus.WAITING });
      logEvent(id, SystemActivityType.WAITING);
      toast.info('تمت الإضافة لقائمة الانتظار');
    } catch (e) {
      toast.error(e.message || 'فشل النقل لقائمة الانتظار');
    }
  };
  const moveFromWaiting = async (id) => {
    try {
      await updateRecord(id, { stage: AdmissionStage.RESERVED, reservationStatus: ReservationStatus.RESERVED });
      toast.success('تم نقل الطالب إلى المجموعة');
    } catch (e) {
      toast.error(e.message || 'فشل النقل إلى المجموعة');
    }
  };

  // إضافة متابعة جديدة لطالب — Phase 3B-13A: admission_followups جدول ابن علائقي حقيقي
  // الآن، لا مصفوفة مُضمَّنة. يرمي عند الفشل (إجراء أساسي بزر/نموذج مخصّص له، بعكس
  // logEvent) — FollowupTab.submit مسؤول عن عدم إغلاق نموذجه إلا بعد نجاح حقيقي.
  const addFollowup = async (recordId, followup) => {
    const saved = await pgCreateAdmissionFollowup({ admissionId: recordId, ...followup });
    setAdmissionFollowups(prev => [...prev, saved]);
    toast.success('تمت إضافة المتابعة');
  };

  // إضافة سجل قبول جديد (موحّد) — Phase 3B-13A: PostgreSQL مصدر الحقيقة الآن. الرقم
  // (admissionNo) يُحسَب محلياً أولاً (nextAdmissionNumber)، ويُعاد حسابه من بيانات خادم
  // حديثة فعلياً فقط عند تعارض number حقيقي (409) — نفس نمط pgCreateCommunication/
  // pgCreateMaterial بالضبط (لا "توليد من جهة الخادم" حقيقياً، انظر تقرير قرار
  // Phase 3B-13A، البند 1). لا followups/payments/systemLog في الصف المُرسَل أو المحفوظ
  // محلياً — تبدأ فارغة تلقائياً لأي id جديد عبر composeAdmission، بلا حاجة لبذرها.
  const addRecord = async (rec, successMsg) => {
    const admissionNo = nextAdmissionNumber(records);
    try {
      const saved = await pgCreateAdmission(
        { ...rec, admissionNo, createdBy: currentUser?.id ?? null },
        {
          computeNextNumber: async () => {
            const fresh = await pgGetCollection('admissions');
            return nextAdmissionNumber(fresh.map(a => ({ admissionNo: a.number })));
          },
        }
      );
      setAdmissionsRaw(prev => [{ ...rec, ...saved }, ...prev]);
      logEvent(saved.id, SystemActivityType.CREATED, saved.admissionNo);
      if (rec.stage === AdmissionStage.RESERVED || rec.stage === AdmissionStage.WAITING) logEvent(saved.id, SystemActivityType.RESERVATION);
      toast.success(successMsg || 'تمت الإضافة');
      return saved; // النموذج المستدعي (LeadsTab/ReservedTab) يُغلَق فقط عند نجاح حقيقي
    } catch (e) {
      toast.error(e.message || 'فشل حفظ سجل القبول');
      return null;
    }
  };

  const addReservation = (rec) => addRecord(rec, 'تمت إضافة الحجز');

  // تسجيل دفعة قبول — Phase 3B-14D: ذرّي على الخادم (backend/src/routes/
  // admissionPayments.js): حركة treasury_txn (دخل) ثم admission_payments تشير إليها،
  // معاً في معاملة واحدة (خطوتان فقط — لا رابط عكسي على treasury_txn يحتاج تحديثاً
  // لاحقاً، بعكس payments في 3B-14C). لا اختيار ضمني لخزنة إطلاقاً (قرار صريح) —
  // payment.cashboxId مطلوب من المستدعي (نموذج الدفعة أدناه). لا تعديل محلي قبل نجاح
  // الخادم؛ عند النجاح تُتبنّى الاستجابة الكاملة (payment + treasuryTxn + logs معاً).
  const addPayment = async (recordId, payment) => {
    const amount = Number(payment.amount) || 0;
    if (amount <= 0) { toast.error('أدخل مبلغاً صحيحاً'); return; }
    if (!payment.cashboxId) { toast.error('اختر الخزنة أولاً'); return; }

    const label = ADMISSION_PAYMENT_TYPES[payment.type]?.label || 'دفعة';

    // حركة إيراد فورية في الخزنة
    try {
      const { payment: savedPayment, treasuryTxn: txn, logs } = await pgCreateAdmissionPayment({
        admissionId: recordId,
        type:        payment.type,
        amount,
        date:        payment.at || new Date().toISOString().split('T')[0],
        method:      payment.method || 'cash',
        materialId:  payment.materialId || null,
        cashboxId:   payment.cashboxId,
      });
      setAdmissionPayments(prev => [...prev, savedPayment]);
      setTreasuryTxn(prev => [...prev, txn]);
      if (logs.length > 0) setAdmissionSystemLog(prev => [...prev, ...logs]);
      toast.success(`تم تسجيل ${label}: ${amount} ج.م ودخلت الخزنة ✓`);
    } catch (e) {
      toast.error(e.message || 'فشل تسجيل الدفعة');
    }
  };


  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
      {/* العمود الرئيسي */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* العنوان */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.3px' }}>التسجيل والقبول</h1>
          <p style={{ fontSize: '0.82rem', color: 'var(--text3)', marginTop: 3 }}>
            إدارة رحلة الطالب من أول اتصال حتى التفعيل
          </p>
        </div>

        {/* كروت الإحصائيات */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
          <StatCard icon="📞" label="العملاء المحتملون"   value={stats.lead}        color={STAGES.lead.color}/>
          <StatCard icon="📋" label="الطلاب المحجوزون"    value={stats.reserved}    color={STAGES.reserved.color}/>
          <StatCard icon="⏳" label="قائمة الانتظار"      value={stats.waiting}     color={STAGES.waiting.color}/>
          <StatCard icon="🔄" label="يحتاج متابعة"        value={stats.followup}    color="#06b6d4"/>
          <StatCard icon="✔️" label="مؤكّد (بانتظار أول حصة)" value={stats.confirmed} color={STAGES.confirmed.color}/>
          <StatCard icon="✅" label="الطلاب النشطون"      value={stats.active}      color={STAGES.active.color}/>
        </div>

        {/* منطقة البحث والفلاتر */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 بحث بالاسم أو رقم الطالب أو رقم ولي الأمر..."
            style={{ ...inputStyle, flex: 2, minWidth: 240 }}
          />
          <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 130, cursor: 'pointer' }}>
            <option value="">كل الصفوف</option>
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 130, cursor: 'pointer' }}>
            <option value="">كل المجموعات</option>
            {MOCK_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>

        {/* التبويبات */}
        <div style={{ display: 'flex', gap: 3, marginBottom: 20, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, padding: 3, width: 'fit-content' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 10,
              fontSize: '0.85rem', fontWeight: tab === t.id ? 700 : 500, cursor: 'pointer',
              fontFamily: 'Cairo,sans-serif', transition: 'all .15s', border: 'none',
              background: tab === t.id ? 'var(--surface)' : 'transparent',
              color: tab === t.id ? 'var(--accent)' : 'var(--text2)',
              boxShadow: tab === t.id ? '0 1px 4px rgba(0,0,0,.12)' : 'none',
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* محتوى التبويب */}
        <div style={{ animation: 'fadeIn .18s ease' }}>
          {tab === 'leads'    && <LeadsTab records={leadRecords} onSelect={setSelectedId} selectedId={selectedId} onConvert={convertToReservation} onAdd={(rec) => addRecord(rec, 'تمت إضافة العميل المحتمل')}/>}
          {tab === 'reserved' && <ReservedTab records={reservedRecords} onSelect={setSelectedId} onConfirm={confirmReservation} onCancel={cancelReservation} onWaiting={moveToWaiting} onFromWaiting={moveFromWaiting} onFirstLesson={attendFirstLesson} onAdd={addReservation} onAddPayment={addPayment} materials={realMaterials} cashboxes={cashboxes} treasuryTxn={treasuryTxn}/>}
          {tab === 'followup' && <FollowupTab records={followupRecords} allRecords={records} onSelect={setSelectedId} selectedId={selectedId} onAddFollowup={addFollowup}/>}
          {tab === 'active'   && <ActiveTab records={activeRecords} onSelect={setSelectedId}/>}
        </div>
      </div>

      {/* لوحة التفاصيل الجانبية */}
      <DetailsPanel record={selected} onClose={() => setSelectedId(null)} profile={centerProfile} treasuryTxn={treasuryTxn}/>

      {/* مودال اختيار المجموعة عند تأكيد الحجز */}
      {confirmFor && (
        <ConfirmGroupModal
          record={confirmFor}
          groups={realGroups}
          students={realStudents}
          onClose={() => setConfirmFor(null)}
          onConfirm={(groupId) => doConfirmWithGroup(confirmFor, groupId)}
        />
      )}

      {cancelFor && (
        <CancelRefundModal
          record={cancelFor}
          treasuryTxn={treasuryTxn}
          onClose={() => setCancelFor(null)}
          onConfirm={(reason) => doCancelWithRefund(cancelFor, reason)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// تبويب 1: العملاء المحتملون — نموذج + جدول
// ═══════════════════════════════════════════════════════════════════════════
function LeadsTab({ records, onSelect, selectedId, onConvert, onAdd }) {
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const empty = { name: '', parentName: '', phone: '', parentPhone: '', grade: GRADES[0], school: '', source: LEAD_SOURCES[0], notes: '', leadStatus: LeadStatus.NEW };
  const [form, setForm] = useState(empty);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Phase 3B-13A: onAdd (addRecord) يُرجع السجل المحفوظ عند النجاح أو null عند الفشل —
  // النموذج يُغلَق ويُفرَّغ فقط عند نجاح حقيقي على الخادم، لا فوراً كما كان سابقاً.
  const submit = async () => {
    if (!form.name.trim() || !form.phone.trim()) return;
    if (!isFullName(form.name)) { toast.error('اكتب اسم الطالب ثنائياً على الأقل (يُستخدم عند التفعيل)'); return; }
    const saved = await onAdd({
      id: `adm_${Date.now()}`, ...form, stage: AdmissionStage.LEAD,
      createdAt: new Date().toISOString().split('T')[0], secretary: 'الموظف الحالي',
      group: null, reservationDate: null, reservationStatus: null, activatedAt: null,
      booklets: null,
    });
    if (saved) { setForm(empty); setShowForm(false); }
  };

  return (
    <div>
      {/* زر إضافة */}
      {!showForm && (
        <button onClick={() => setShowForm(true)} style={btnPrimary}>+ إضافة عميل محتمل</button>
      )}

      {/* النموذج */}
      {showForm && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, marginBottom: 18 }}>
          <div style={{ fontWeight: 800, marginBottom: 16 }}>بيانات العميل المحتمل</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="اسم الطالب" required><input value={form.name} onChange={e => set('name', e.target.value)} style={inputStyle}/></Field>
            <Field label="اسم ولي الأمر"><input value={form.parentName} onChange={e => set('parentName', e.target.value)} style={inputStyle}/></Field>
            <Field label="رقم الطالب" required><input value={form.phone} onChange={e => set('phone', e.target.value)} style={inputStyle}/></Field>
            <Field label="رقم ولي الأمر"><input value={form.parentPhone} onChange={e => set('parentPhone', e.target.value)} style={inputStyle}/></Field>
            <Field label="الصف الدراسي"><select value={form.grade} onChange={e => set('grade', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>{GRADES.map(g => <option key={g} value={g}>{g}</option>)}</select></Field>
            <Field label="المدرسة"><input value={form.school} onChange={e => set('school', e.target.value)} style={inputStyle}/></Field>
            <Field label="مصدر التعارف"><select value={form.source} onChange={e => set('source', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>{LEAD_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
            <Field label="الحالة"><select value={form.leadStatus} onChange={e => set('leadStatus', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>{Object.entries(LEAD_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
            <div style={{ gridColumn: '1/-1' }}><Field label="ملاحظات"><textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }}/></Field></div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={() => { setShowForm(false); setForm(empty); }} style={btnSecondary}>إلغاء</button>
            <button onClick={submit} style={btnPrimary}>حفظ</button>
          </div>
        </div>
      )}

      {/* الجدول */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ background: 'var(--surface2)' }}>
              {['الطالب', 'الصف', 'رقم الطالب', 'المصدر', 'الحالة', 'إجراءات'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--text3)' }}>لا يوجد عملاء محتملون</td></tr>
            ) : records.map(r => {
              const st = LEAD_STATUS[r.leadStatus] || LEAD_STATUS.new;
              return (
                <tr key={r.id} onClick={() => onSelect(r.id)} style={{ cursor: 'pointer', background: selectedId === r.id ? 'var(--surface2)' : 'transparent', borderTop: '1px solid var(--border)' }}>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar name={r.name} size={34}/>
                      <div>
                        <div style={{ fontWeight: 700 }}>{r.name}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>{r.parentName}</div>
                      </div>
                    </div>
                  </td>
                  <td style={tdStyle}>{r.grade}</td>
                  <td style={tdStyle} dir="ltr">{r.phone}</td>
                  <td style={tdStyle}>{r.source}</td>
                  <td style={tdStyle}><Badge label={st.label} color={st.color}/></td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => onSelect(r.id)} style={btnTiny}>عرض</button>
                      <button onClick={() => onConvert(r.id)} style={{ ...btnTiny, color: STAGES.reserved.color, borderColor: `${STAGES.reserved.color}55` }}>تحويل لحجز</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// تبويب 2: الحجز — كروت
// ═══════════════════════════════════════════════════════════════════════════
function ReservedTab({ records, onSelect, onConfirm, onCancel, onWaiting, onFromWaiting, onFirstLesson, onAdd, onAddPayment, materials, cashboxes, treasuryTxn }) {
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [payFor, setPayFor] = useState(null); // الطالب اللي بنسجّل له دفعة
  const [payForm, setPayForm] = useState({ type: PaymentType.DEPOSIT, amount: '', materialId: '', cashboxId: '' });
  const activeCashboxes = (cashboxes || []).filter(cb => cb.active);
  // مذكرات سنة الطالب (تظهر عند اختيار نوع الدفع = مذكرات)
  const payMaterials = payFor ? (materials || []).filter(m => m.grade === payFor.grade) : [];
  const empty = { name: '', parentName: '', phone: '', parentPhone: '', grade: GRADES[0], group: MOCK_GROUPS[0], reservationDate: new Date().toISOString().split('T')[0], reservationStatus: ReservationStatus.RESERVED, courseFee: '', notes: '' };
  const [form, setForm] = useState(empty);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Phase 3B-13A: onAdd (addReservation → addRecord) يُرجع السجل المحفوظ عند النجاح أو
  // null عند الفشل — النموذج يُغلَق ويُفرَّغ فقط عند نجاح حقيقي على الخادم.
  const submit = async () => {
    if (!form.name.trim() || !form.phone.trim()) return;
    if (!isFullName(form.name)) { toast.error('اكتب اسم الطالب ثنائياً على الأقل (يُستخدم عند التفعيل)'); return; }
    const stage = form.reservationStatus === 'waiting' ? 'waiting' : 'reserved';
    const saved = await onAdd({
      id: `adm_${Date.now()}`, ...form, stage, leadStatus: LeadStatus.INTERESTED,
      school: '', source: 'حضور مباشر',
      createdAt: new Date().toISOString().split('T')[0], secretary: 'الموظف الحالي',
      activatedAt: null, booklets: null,
    });
    if (saved) { setForm(empty); setShowForm(false); }
  };

  return (
    <div>
      {/* زر إضافة حجز */}
      {!showForm && (
        <button onClick={() => setShowForm(true)} style={btnPrimary}>+ إضافة حجز</button>
      )}

      {/* نموذج الحجز */}
      {showForm && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, marginBottom: 18 }}>
          <div style={{ fontWeight: 800, marginBottom: 16 }}>بيانات الحجز</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="اسم الطالب" required><input value={form.name} onChange={e => set('name', e.target.value)} style={inputStyle}/></Field>
            <Field label="اسم ولي الأمر"><input value={form.parentName} onChange={e => set('parentName', e.target.value)} style={inputStyle}/></Field>
            <Field label="رقم الطالب" required><input value={form.phone} onChange={e => set('phone', e.target.value)} style={inputStyle}/></Field>
            <Field label="رقم ولي الأمر"><input value={form.parentPhone} onChange={e => set('parentPhone', e.target.value)} style={inputStyle}/></Field>
            <Field label="الصف الدراسي"><select value={form.grade} onChange={e => set('grade', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>{GRADES.map(g => <option key={g} value={g}>{g}</option>)}</select></Field>
            <Field label="المجموعة"><select value={form.group} onChange={e => set('group', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>{MOCK_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}</select></Field>
            <Field label="تاريخ الحجز"><input type="date" value={form.reservationDate} onChange={e => set('reservationDate', e.target.value)} style={inputStyle}/></Field>
            <Field label="حالة الحجز"><select value={form.reservationStatus} onChange={e => set('reservationStatus', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>{Object.entries(RESERVATION_STATUS).filter(([k]) => k !== 'cancelled').map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
            <Field label="رسوم الدروس الشهرية (ج.م)"><input type="number" min="0" value={form.courseFee} onChange={e => set('courseFee', e.target.value)} placeholder="مثال: 500" style={inputStyle}/></Field>
            <div style={{ gridColumn: '1/-1' }}><Field label="ملاحظات الحجز"><textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }}/></Field></div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={() => { setShowForm(false); setForm(empty); }} style={btnSecondary}>إلغاء</button>
            <button onClick={submit} style={btnPrimary}>حفظ الحجز</button>
          </div>
        </div>
      )}

      {records.length === 0 ? <EmptyState text="لا توجد حجوزات"/> : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
        {records.map(r => {
          const st = RESERVATION_STATUS[r.reservationStatus] || RESERVATION_STATUS.reserved;
          const isWaiting = r.stage === AdmissionStage.WAITING;
          const isConfirmed = r.stage === AdmissionStage.CONFIRMED;
          return (
            <div key={r.id} style={cardStyle} onClick={() => onSelect(r.id)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <Avatar name={r.name} size={44}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>{r.grade}</div>
                </div>
                <Badge label={isWaiting ? 'قائمة انتظار' : isConfirmed ? 'مؤكّد — بانتظار أول حصة' : st.label} color={isWaiting ? STAGES.waiting.color : isConfirmed ? STAGES.confirmed.color : st.color}/>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.8rem', marginBottom: 14 }}>
                <Row label="المجموعة" value={r.group || '—'}/>
                <Row label="تاريخ الحجز" value={r.reservationDate || '—'}/>
                <Row label="الموظف" value={r.secretary}/>
                {(r.payments || []).length > 0 && (() => {
                  // BUG-02: كانت تجمع r.payments.amount الخام مباشرة — مدفوعة قبول
                  // استُرِدَّت (إلغاء الحجز) تبقى محسوبة وكأنها لا تزال محصَّلة. مصدر
                  // الحقيقة الوحيد هو treasury_txn عبر admissionId (نفس مرجع DetailsPanel).
                  const { net } = getAdmissionTreasuryTotals(r.id, treasuryTxn);
                  return (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
                      <span style={{ color: 'var(--text3)' }}>المدفوع</span>
                      <span style={{ fontWeight: 800, color: 'var(--green)' }}>
                        {net} ج.م
                      </span>
                    </div>
                  );
                })()}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                {isWaiting ? (
                  <button onClick={() => onFromWaiting(r.id)} style={{ ...btnTiny, color: STAGES.confirmed.color, borderColor: `${STAGES.confirmed.color}55` }}>نقل للمجموعة</button>
                ) : isConfirmed ? (
                  <button onClick={() => onFirstLesson(r.id)} style={{ ...btnTiny, color: STAGES.active.color, borderColor: `${STAGES.active.color}55` }}>🎓 حضر أول حصة (تفعيل)</button>
                ) : (
                  <>
                    <button onClick={() => onConfirm(r.id)} style={{ ...btnTiny, color: STAGES.active.color, borderColor: `${STAGES.active.color}55` }}>تأكيد الحجز</button>
                    <button onClick={() => onWaiting(r.id)} style={{ ...btnTiny, color: STAGES.waiting.color, borderColor: `${STAGES.waiting.color}55` }}>قائمة الانتظار</button>
                  </>
                )}
                <button onClick={() => onCancel(r.id)} style={{ ...btnTiny, color: 'var(--red)', borderColor: 'rgba(239,68,68,.35)' }}>إلغاء</button>
                <button onClick={() => { setPayFor(r); setPayForm({ type: PaymentType.DEPOSIT, amount: '', materialId: '', cashboxId: '' }); }} style={{ ...btnTiny, color: '#8b5cf6', borderColor: '#8b5cf655' }}>💰 تسجيل دفعة</button>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* مودال تسجيل دفعة */}
      {payFor && (
        <div onClick={() => setPayFor(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: 380, maxWidth: '90vw' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <Avatar name={payFor.name} size={44}/>
              <div>
                <div style={{ fontWeight: 800 }}>تسجيل دفعة</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>{payFor.name}</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="نوع الدفع" required>
                <select value={payForm.type} onChange={e => {
                  const newType = e.target.value;
                  setPayForm(p => ({
                    ...p,
                    type: newType,
                    materialId: '',
                    // رسوم الدروس → املأ المبلغ تلقائياً بقيمة رسوم الدروس الشهرية للطالب
                    amount: newType === 'course' && payFor.courseFee ? String(payFor.courseFee) : p.amount,
                  }));
                }} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {Object.entries(ADMISSION_PAYMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </Field>

              {/* اختيار المذكرة الحقيقية — يظهر عند نوع الدفع "مذكرات" */}
              {payForm.type === PaymentType.BOOKLETS && (
                <Field label="المذكرة">
                  <select value={payForm.materialId} onChange={e => {
                    const m = payMaterials.find(x => x.id === e.target.value);
                    setPayForm(p => ({ ...p, materialId: e.target.value, amount: m?.price ? String(m.price) : p.amount }));
                  }} style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="">
                      {payMaterials.length === 0 ? `لا توجد مذكرات لـ ${payFor.grade}` : 'اختر المذكرة...'}
                    </option>
                    {payMaterials.map(m => <option key={m.id} value={m.id}>{m.name}{m.subject ? ` — ${m.subject}` : ''} ({m.price} ج.م)</option>)}
                  </select>
                </Field>
              )}

              <Field label="المبلغ (ج.م)" required>
                <input type="number" min="1" value={payForm.amount} onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))} placeholder="200" style={inputStyle}/>
                {payForm.type === PaymentType.COURSE && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text3)', marginTop: 4 }}>
                    {payFor.courseFee ? `رسوم الدروس الشهرية لهذا الطالب: ${payFor.courseFee} ج.م (تم ملؤها تلقائياً)` : 'لم تُحدَّد رسوم دروس شهرية في بيانات الحجز.'}
                  </div>
                )}
              </Field>

              <Field label="الخزنة" required>
                <select value={payForm.cashboxId} onChange={e => setPayForm(p => ({ ...p, cashboxId: e.target.value }))} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="">اختر الخزنة...</option>
                  {activeCashboxes.map(cb => <option key={cb.id} value={cb.id}>{cb.name}</option>)}
                </select>
                {activeCashboxes.length === 0 && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--red)', marginTop: 4 }}>
                    لا توجد خزنة نشطة. أنشئ خزنة من صفحة الخزنة أولاً.
                  </div>
                )}
              </Field>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setPayFor(null)} style={btnSecondary}>إلغاء</button>
              <button disabled={activeCashboxes.length === 0} onClick={() => {
                if (!payForm.amount || Number(payForm.amount) <= 0) { toast.error('أدخل مبلغاً صحيحاً'); return; }
                if (!payForm.cashboxId) { toast.error('اختر الخزنة أولاً'); return; }
                onAddPayment(payFor.id, { type: payForm.type, amount: Number(payForm.amount), materialId: payForm.materialId || null, at: new Date().toISOString().split('T')[0], cashboxId: payForm.cashboxId });
                setPayFor(null);
              }} style={{ ...btnPrimary, marginBottom: 0 }}>حفظ الدفعة</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function FollowupTab({ records, allRecords, onSelect, selectedId, onAddFollowup }) {
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ recordId: '', type: 'call', notes: '' });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // كل الطلاب المتاحين للمتابعة (غير النشطين والملغيين)
  const candidates = (allRecords || []).filter(r => r.stage !== AdmissionStage.ACTIVE);

  // Phase 3B-13A: addFollowup (onAddFollowup) يرمي عند الفشل الآن (بعكس logEvent) — لا
  // يُغلَق النموذج إلا بعد نجاح حقيقي على الخادم.
  const submit = async () => {
    if (!form.recordId) return;
    const now = new Date();
    const at = `${now.toISOString().split('T')[0]} ${now.toTimeString().slice(0, 5)}`;
    try {
      await onAddFollowup(form.recordId, { type: form.type, notes: form.notes, at, by: 'الموظف الحالي' });
      setForm({ recordId: '', type: 'call', notes: '' });
      setShowForm(false);
    } catch (e) {
      toast.error(e.message || 'فشل حفظ المتابعة');
    }
  };

  const allFollowups = records
    .flatMap(r => (r.followups || []).map(f => ({ ...f, student: r.name, recordId: r.id })))
    .sort((a, b) => new Date(b.at) - new Date(a.at));

  return (
    <div>
      {/* زر إضافة متابعة */}
      {!showForm && (
        <button onClick={() => setShowForm(true)} style={btnPrimary}>+ إضافة متابعة</button>
      )}

      {/* نموذج المتابعة */}
      {showForm && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, marginBottom: 18 }}>
          <div style={{ fontWeight: 800, marginBottom: 16 }}>إضافة متابعة جديدة</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="الطالب" required>
              <select value={form.recordId} onChange={e => set('recordId', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">اختر الطالب...</option>
                {candidates.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="نوع المتابعة" required>
              <select value={form.type} onChange={e => set('type', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                {Object.entries(FOLLOWUP_TYPES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </Field>
            <div style={{ gridColumn: '1/-1' }}><Field label="ملاحظات"><textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder="تفاصيل المكالمة أو المتابعة..."/></Field></div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <button onClick={() => { setShowForm(false); setForm({ recordId: '', type: 'call', notes: '' }); }} style={btnSecondary}>إلغاء</button>
            <button onClick={submit} style={btnPrimary}>حفظ المتابعة</button>
          </div>
        </div>
      )}

      {/* الخط الزمني */}
      {allFollowups.length === 0 ? <EmptyState text="لا توجد متابعات"/> : (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px' }}>
        <div style={{ fontWeight: 800, marginBottom: 18 }}>الخط الزمني للمتابعات</div>
        <div style={{ position: 'relative', paddingRight: 26 }}>
          <div style={{ position: 'absolute', right: 8, top: 6, bottom: 6, width: 2, background: 'var(--border)' }}/>
          {allFollowups.map((f) => {
            const meta = FOLLOWUP_TYPES[f.type] || FOLLOWUP_TYPES.call;
            return (
              <div key={f.id} onClick={() => onSelect(f.recordId)} style={{ position: 'relative', marginBottom: 18, cursor: 'pointer' }}>
                <div style={{ position: 'absolute', right: -25, top: 2, width: 18, height: 18, borderRadius: '50%', background: `${meta.color}22`, border: `2px solid ${meta.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9 }}>{meta.icon}</div>
                <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '10px 14px', border: `1px solid ${selectedId === f.recordId ? meta.color + '55' : 'var(--border)'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Badge label={meta.label} color={meta.color}/>
                    <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{f.student}</span>
                    <span style={{ marginRight: 'auto', fontSize: '0.72rem', color: 'var(--text3)' }}>{f.at}</span>
                  </div>
                  {f.notes && <div style={{ fontSize: '0.8rem', color: 'var(--text2)' }}>{f.notes}</div>}
                  <div style={{ fontSize: '0.72rem', color: 'var(--text3)', marginTop: 4 }}>الموظف: {f.by}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// تبويب 4: الطلاب النشطون — كروت
// ═══════════════════════════════════════════════════════════════════════════
function ActiveTab({ records, onSelect }) {
  if (records.length === 0) return <EmptyState text="لا يوجد طلاب نشطون"/>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
      {records.map(r => (
        <div key={r.id} style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <Avatar name={r.name} size={46}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>{r.group}</div>
            </div>
            <Badge label="نشط" color={STAGES.active.color}/>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: '0.8rem', marginBottom: 14 }}>
            <Row label="تاريخ التفعيل" value={r.activatedAt || '—'}/>
            <Row label="الصف" value={r.grade}/>
          </div>
          <button onClick={() => onSelect(r.id)} style={{ ...btnPrimary, width: '100%' }}>فتح ملف الطالب</button>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// لوحة التفاصيل الجانبية
// ═══════════════════════════════════════════════════════════════════════════
function DetailsPanel({ record, onClose, profile, treasuryTxn }) {
  if (!record) {
    return (
      <div style={{ width: 320, flexShrink: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '40px 24px', textAlign: 'center', position: 'sticky', top: 16 }}>
        <div style={{ fontSize: 40, marginBottom: 12, opacity: .3 }}>👤</div>
        <div style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>اختر طالباً لعرض تفاصيله</div>
      </div>
    );
  }

  const stage = STAGES[record.stage] || STAGES.lead;
  const lastFollowup = (record.followups || [])[record.followups.length - 1];

  // الملخص المالي — يُقرأ من حركات الخزنة الفعلية (المصدر الوحيد) عبر admissionId
  const linkedTxns = (treasuryTxn || []).filter(t => t.admissionId === record.id && t.status === 'active');
  const { income: finIncome, refund: finRefund, net: finNet } = getAdmissionTreasuryTotals(record.id, treasuryTxn);

  return (
    <div style={{ width: 320, flexShrink: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, position: 'sticky', top: 16, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
      {/* رأس */}
      <div style={{ padding: '20px', borderBottom: '1px solid var(--border)', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 12, left: 12, background: 'var(--surface2)', border: 'none', borderRadius: 8, width: 26, height: 26, cursor: 'pointer', color: 'var(--text3)', fontSize: 14 }}>✕</button>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <Avatar name={record.name} size={64}/>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>{record.name}</div>
            {record.admissionNo && (
              <div style={{ fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 700, fontFamily: 'monospace', marginTop: 2 }}>{record.admissionNo}</div>
            )}
            <div style={{ fontSize: '0.78rem', color: 'var(--text3)', marginTop: 2 }}>{record.grade}</div>
          </div>
          <Badge label={`${stage.icon} ${stage.label}`} color={stage.color}/>
          <button onClick={() => openAdmissionReport({ record, profile, treasuryTxn })} style={{
            marginTop: 4, padding: '8px 16px', borderRadius: 9, border: '1px solid var(--accent)',
            background: 'transparent', color: 'var(--accent)', fontFamily: 'Cairo,sans-serif',
            fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
          }}>🖨 طباعة البيان</button>
        </div>
      </div>

      {/* المعلومات الأساسية */}
      <PanelSection title="المعلومات الأساسية">
        <PanelRow label="ولي الأمر" value={record.parentName || '—'}/>
        <PanelRow label="رقم الطالب" value={record.phone} ltr/>
        <PanelRow label="رقم ولي الأمر" value={record.parentPhone} ltr/>
        <PanelRow label="المدرسة" value={record.school || '—'}/>
        <PanelRow label="المصدر" value={record.source}/>
      </PanelSection>

      {/* المجموعة الحالية */}
      {record.group && (
        <PanelSection title="المجموعة الحالية">
          <PanelRow label="المجموعة" value={record.group}/>
          {record.reservationDate && <PanelRow label="تاريخ الحجز" value={record.reservationDate}/>}
        </PanelSection>
      )}

      {/* آخر متابعة */}
      {lastFollowup && (
        <PanelSection title="آخر متابعة">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Badge label={FOLLOWUP_TYPES[lastFollowup.type]?.label || ''} color={FOLLOWUP_TYPES[lastFollowup.type]?.color || '#888'}/>
            <span style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>{lastFollowup.at}</span>
          </div>
          {lastFollowup.notes && <div style={{ fontSize: '0.8rem', color: 'var(--text2)' }}>{lastFollowup.notes}</div>}
        </PanelSection>
      )}

      {/* الملخص المالي — للقراءة فقط، مصدره الخزنة (traceability عبر admissionId) */}
      {linkedTxns.length > 0 && (
        <PanelSection title="الملخص المالي (من الخزنة)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* المؤشرات */}
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, background: 'rgba(16,185,129,.08)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text3)' }}>مدفوع</div>
                <div style={{ fontWeight: 800, color: 'var(--green)', fontSize: '0.9rem' }}>{finIncome} ج.م</div>
              </div>
              {finRefund > 0 && (
                <div style={{ flex: 1, background: 'rgba(239,68,68,.08)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text3)' }}>مسترد</div>
                  <div style={{ fontWeight: 800, color: 'var(--red)', fontSize: '0.9rem' }}>{finRefund} ج.م</div>
                </div>
              )}
              <div style={{ flex: 1, background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text3)' }}>الصافي</div>
                <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>{finNet} ج.م</div>
              </div>
            </div>

            {/* قائمة الحركات (للقراءة فقط) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
              {linkedTxns.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(t => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: '0.74rem', padding: '5px 8px', background: 'var(--surface2)', borderRadius: 6 }}>
                  <span style={{ color: t.type === 'income' ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                    {t.type === 'income' ? '+' : '−'}{t.amount}
                  </span>
                  <span style={{ flex: 1, textAlign: 'center', color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</span>
                  <span style={{ color: 'var(--text3)', fontSize: '0.66rem' }}>{t.date}</span>
                </div>
              ))}
            </div>

            <div style={{ fontSize: '0.66rem', color: 'var(--text3)', marginTop: 2, textAlign: 'center' }}>
              🔒 هذه البيانات مصدرها الخزنة — للعرض فقط
            </div>
          </div>
        </PanelSection>
      )}

      {/* المذكرات */}
      {record.booklets && (
        <PanelSection title="المذكرات">
          <PanelRow label="التسليم" value={record.booklets.delivered ? '✅ تم' : '⏳ لم يتم'}/>
          {record.booklets.delivered && <>
            <PanelRow label="الكمية" value={String(record.booklets.qty)}/>
            <PanelRow label="الإصدار" value={record.booklets.version}/>
          </>}
        </PanelSection>
      )}

      {/* الملاحظات */}
      {record.notes && (
        <PanelSection title="ملاحظات">
          <div style={{ fontSize: '0.8rem', color: 'var(--text2)', lineHeight: 1.6 }}>{record.notes}</div>
        </PanelSection>
      )}

      {/* الخط الزمني للنشاط */}
      {/* النشاط النظامي (تلقائي، للقراءة فقط) — منفصل عن متابعات الاستقبال */}
      <PanelSection title="النشاط النظامي (تلقائي)">
        {(record.systemLog || []).length === 0 ? (
          <div style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>لا يوجد نشاط نظامي بعد</div>
        ) : (
          <div style={{ position: 'relative', paddingRight: 18 }}>
            <div style={{ position: 'absolute', right: 5, top: 4, bottom: 4, width: 2, background: 'var(--border)' }}/>
            {(record.systemLog || []).slice().reverse().map(ev => {
              const meta = SYSTEM_EVENTS[ev.type] || { label: ev.type, icon: '•', color: '#888' };
              return (
                <div key={ev.id} style={{ position: 'relative', marginBottom: 12, fontSize: '0.76rem' }}>
                  <div style={{ position: 'absolute', right: -17, top: 1, width: 13, height: 13, borderRadius: '50%', background: `${meta.color}22`, border: `2px solid ${meta.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7 }}>{meta.icon}</div>
                  <div style={{ color: 'var(--text2)', fontWeight: 600 }}>{meta.label}{ev.detail ? ` — ${ev.detail}` : ''}</div>
                  <div style={{ color: 'var(--text3)', fontSize: '0.66rem' }}>{new Date(ev.at).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}</div>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ fontSize: '0.64rem', color: 'var(--text3)', marginTop: 4 }}>🔒 يُنشأ تلقائياً — للعرض فقط</div>
      </PanelSection>

      {/* متابعات الاستقبال (يدوية) */}
      <PanelSection title="متابعات الاستقبال">
        {(record.followups || []).length === 0 ? (
          <div style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>لا توجد متابعات</div>
        ) : (record.followups || []).slice().reverse().map(f => (
          <div key={f.id} style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: '0.76rem' }}>
            <span>{FOLLOWUP_TYPES[f.type]?.icon || '•'}</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: 'var(--text2)' }}>{f.notes || FOLLOWUP_TYPES[f.type]?.label}</div>
              <div style={{ color: 'var(--text3)', fontSize: '0.68rem' }}>{f.at} · {f.by}</div>
            </div>
          </div>
        ))}
      </PanelSection>

      {/* معلومات آخر تعديل (تلقائية) */}
      {record.lastModifiedAt && (
        <div style={{ padding: '12px 20px', fontSize: '0.68rem', color: 'var(--text3)', lineHeight: 1.7 }}>
          آخر تعديل: {new Date(record.lastModifiedAt).toLocaleDateString('ar-EG', { dateStyle: 'medium' })}
          {' · '}
          {new Date(record.lastModifiedAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
          {record.lastModifiedBy ? ` · بواسطة ${record.lastModifiedBy}` : ''}
        </div>
      )}
    </div>
  );
}

// ── مكوّنات مساعدة صغيرة ──
function PanelSection({ title, children }) {
  return (
    <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}
function PanelRow({ label, value, ltr }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 6, fontSize: '0.8rem' }}>
      <span style={{ color: 'var(--text3)' }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'left', direction: ltr ? 'ltr' : 'rtl' }}>{value}</span>
    </div>
  );
}
function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ color: 'var(--text3)' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}
function EmptyState({ text }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 40, textAlign: 'center', color: 'var(--text3)' }}>
      {text}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// مودال اختيار المجموعة عند تأكيد الحجز
// ═══════════════════════════════════════════════════════════════════════════
function ConfirmGroupModal({ record, groups, students, onClose, onConfirm }) {
  const [groupId, setGroupId] = useState('');
  // مجموعات نفس السنة الدراسية للطالب
  const gradeGroups = (groups || []).filter(g => g.grade === record.grade);
  // عدد طلاب كل مجموعة (من الطلاب الحقيقيين النشطين)
  const countInGroup = (gId) => (students || []).filter(s => s.groupId === gId && s.status === 'active').length;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: 440, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <Avatar name={record.name} size={44}/>
          <div>
            <div style={{ fontWeight: 800 }}>تأكيد الحجز واختيار المجموعة</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>{record.name} · {record.grade}</div>
          </div>
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text2)', margin: '14px 0 16px', lineHeight: 1.6 }}>
          اختر المجموعة المناسبة. سيتم إضافة الطالب إلى المجموعة وتحويله إلى <strong>طالب نشط</strong> في إدارة الطلاب.
        </p>

        {gradeGroups.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text3)', background: 'var(--surface2)', borderRadius: 10 }}>
            لا توجد مجموعات للصف "{record.grade}".<br/>
            <span style={{ fontSize: '0.8rem' }}>أنشئ مجموعة لهذا الصف أولاً من صفحة المجموعات.</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {gradeGroups.map(g => {
              const count = countInGroup(g.id);
              const isFull = g.max && count >= g.max;
              const selected = groupId === g.id;
              return (
                <button key={g.id} onClick={() => setGroupId(g.id)} disabled={isFull} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  padding: '12px 14px', borderRadius: 10, cursor: isFull ? 'not-allowed' : 'pointer',
                  fontFamily: 'Cairo,sans-serif', textAlign: 'right', opacity: isFull ? .5 : 1,
                  background: selected ? 'var(--accent)' : 'var(--surface2)',
                  border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                  color: selected ? 'var(--surface)' : 'var(--text)',
                }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{g.name}</div>
                    <div style={{ fontSize: '0.72rem', opacity: .8 }}>{g.grade}{g.price ? ` · ${g.price} ج.م` : ''}</div>
                  </div>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700 }}>
                    {isFull ? 'ممتلئة' : g.max ? `${count}/${g.max}` : count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onClose} style={btnSecondary}>إلغاء</button>
          <button onClick={() => groupId && onConfirm(groupId)} disabled={!groupId} style={{ ...btnPrimary, marginBottom: 0, opacity: groupId ? 1 : .5, cursor: groupId ? 'pointer' : 'not-allowed' }}>
            تأكيد وتفعيل الطالب
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// مودال إلغاء الحجز مع الاسترداد
// ═══════════════════════════════════════════════════════════════════════════
function CancelRefundModal({ record, treasuryTxn, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  // Phase 3B-14D: admission_payments لا حقل refunded عليها إطلاقاً (سجل ثابت، مثل
  // payments) — "غير مسترد" مُشتَقّ من عدم وجود حركة treasury_txn نشطة من نوع
  // admissionRefund مرتبطة بهذه الدفعة تحديداً، بنفس منطق الخادم الذري تماماً
  // (backend/src/routes/admissionCancellation.js). هذا عرض تقديري فقط قبل التنفيذ —
  // القرار الفعلي (وقفله ضد التزامن) يحدث على الخادم داخل نفس المعاملة.
  const refundedIds = new Set(
    (treasuryTxn || [])
      .filter(t => t.refType === 'admissionRefund' && t.status === 'active')
      .map(t => t.refId)
  );
  const unrefunded = (record.payments || []).filter(p => !refundedIds.has(p.id));
  const total = unrefunded.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: 420, maxWidth: '92vw' }}>
        <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 6 }}>إلغاء الحجز واسترداد المدفوعات</div>
        <div style={{ fontSize: '0.82rem', color: 'var(--text3)', marginBottom: 16 }}>
          {record.name} · سيتم استرداد {unrefunded.length} دفعة بإجمالي <strong style={{ color: 'var(--red)' }}>{total} ج.م</strong>
        </div>

        <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 12, marginBottom: 16 }}>
          {unrefunded.map(p => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '4px 0' }}>
              <span>{ADMISSION_PAYMENT_TYPES[p.type]?.label || 'دفعة'}</span>
              <span style={{ fontWeight: 700 }}>{p.amount} ج.م</span>
            </div>
          ))}
        </div>

        <div style={{ fontSize: '0.75rem', color: 'var(--text3)', marginBottom: 14, lineHeight: 1.6 }}>
          ℹ️ لن تُحذف الدفعات الأصلية. ستُسجَّل حركة استرداد منفصلة في الخزنة للحفاظ على دقة السجل المالي.
        </div>

        <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text3)', display: 'block', marginBottom: 6 }}>سبب الإلغاء (اختياري)</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="مثال: غيّر رأيه"
          style={{ ...inputStyle, resize: 'vertical', marginBottom: 18 }}/>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecondary}>تراجع</button>
          <button onClick={() => onConfirm(reason)} style={{ ...btnPrimary, marginBottom: 0, background: 'var(--red)' }}>تأكيد الإلغاء والاسترداد</button>
        </div>
      </div>
    </div>
  );
}

// ── أنماط مشتركة ──
const thStyle = { padding: '11px 14px', textAlign: 'right', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text3)' };
const tdStyle = { padding: '11px 14px', textAlign: 'right' };
const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, cursor: 'pointer', transition: 'all .15s' };
const btnPrimary = { padding: '9px 18px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: 'var(--surface)', fontFamily: 'Cairo,sans-serif', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', marginBottom: 18 };
const btnSecondary = { padding: '9px 18px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', fontFamily: 'Cairo,sans-serif', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' };
const btnTiny = { padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', fontFamily: 'Cairo,sans-serif', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' };
