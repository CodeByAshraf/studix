// src/modules/admissions/mockData.js
// ─────────────────────────────────────────────────────────────────────────────
// بيانات العرض (labels / colors / icons) لوحدة القبول — مفاتيحها من enums
// المركزية في constants.js. لا نصوص أعمال حرفية هنا؛ فقط تنسيق العرض.
// ─────────────────────────────────────────────────────────────────────────────

import {
  AdmissionStage, LeadStatus, ReservationStatus, PaymentType,
  CommunicationType, SystemActivityType,
  ADMISSION_NUMBER_PREFIX, ADMISSION_NUMBER_PAD,
} from './constants';

// ── مراحل القبول (بيانات العرض + ترتيب المسار) ───────────────────────────
export const STAGES = {
  [AdmissionStage.LEAD]:      { id: AdmissionStage.LEAD,      order: 1, label: 'عميل محتمل',     color: '#3b82f6', icon: '📞' },
  [AdmissionStage.RESERVED]:  { id: AdmissionStage.RESERVED,  order: 2, label: 'محجوز',          color: '#8b5cf6', icon: '📋' },
  [AdmissionStage.WAITING]:   { id: AdmissionStage.WAITING,   order: 3, label: 'قائمة الانتظار', color: '#f59e0b', icon: '⏳' },
  [AdmissionStage.CONFIRMED]: { id: AdmissionStage.CONFIRMED, order: 4, label: 'مؤكّد',          color: '#06b6d4', icon: '✔️' },
  [AdmissionStage.ACTIVE]:    { id: AdmissionStage.ACTIVE,    order: 5, label: 'طالب نشط',       color: '#10b981', icon: '✅' },
};

// ── حالة العميل المحتمل ──────────────────────────────────────────────────
export const LEAD_STATUS = {
  [LeadStatus.NEW]:            { label: 'جديد',          color: '#3b82f6' },
  [LeadStatus.CONTACTED]:      { label: 'تم التواصل',    color: '#06b6d4' },
  [LeadStatus.INTERESTED]:     { label: 'مهتم',          color: '#10b981' },
  [LeadStatus.NOT_INTERESTED]: { label: 'غير مهتم',      color: '#ef4444' },
  [LeadStatus.FOLLOWUP_LATER]: { label: 'متابعة لاحقاً', color: '#f59e0b' },
};

// ── حالة الحجز ───────────────────────────────────────────────────────────
export const RESERVATION_STATUS = {
  [ReservationStatus.RESERVED]:  { label: 'مؤكد',         color: '#10b981' },
  [ReservationStatus.WAITING]:   { label: 'قائمة انتظار', color: '#f59e0b' },
  [ReservationStatus.CANCELLED]: { label: 'ملغى',         color: '#ef4444' },
};

// ── أنواع التواصل (متابعات الاستقبال اليدوية) ────────────────────────────
export const FOLLOWUP_TYPES = {
  [CommunicationType.CALL]:      { label: 'اتصال هاتفي', icon: '📞', color: '#3b82f6' },
  [CommunicationType.WHATSAPP]:  { label: 'واتساب',      icon: '💬', color: '#10b981' },
  [CommunicationType.VISIT]:     { label: 'زيارة',       icon: '🏢', color: '#8b5cf6' },
  [CommunicationType.CONFIRMED]: { label: 'أكد الحضور',  icon: '✅', color: '#10b981' },
  [CommunicationType.NO_ANSWER]: { label: 'لم يرد',      icon: '📵', color: '#f59e0b' },
  [CommunicationType.EXCUSED]:   { label: 'اعتذر',       icon: '🚫', color: '#ef4444' },
};

// ── أنواع الدفع (القبول) ─────────────────────────────────────────────────
export const ADMISSION_PAYMENT_TYPES = {
  [PaymentType.DEPOSIT]:  { label: 'دفعة حجز',    color: '#8b5cf6' },
  [PaymentType.BOOKLETS]: { label: 'مذكرات',      color: '#f59e0b' },
  [PaymentType.COURSE]:   { label: 'رسوم الدروس', color: '#10b981' },
  [PaymentType.OTHER]:    { label: 'أخرى',        color: '#64748b' },
};

// ── أحداث النشاط النظامي (تلقائية — للقراءة فقط) ──────────────────────────
export const SYSTEM_EVENTS = {
  [SystemActivityType.CREATED]:            { label: 'تم إنشاء سجل القبول',   icon: '📝', color: '#3b82f6' },
  [SystemActivityType.RESERVATION]:        { label: 'تم الحجز',             icon: '📋', color: '#8b5cf6' },
  [SystemActivityType.CONFIRMED]:          { label: 'تم تأكيد الحجز',       icon: '✔️', color: '#06b6d4' },
  [SystemActivityType.PAYMENT_RECEIVED]:   { label: 'تم استلام دفعة',       icon: '💰', color: '#10b981' },
  [SystemActivityType.BOOKLETS_DELIVERED]: { label: 'تم تسليم المذكرات',    icon: '📚', color: '#f59e0b' },
  [SystemActivityType.REFUND_ISSUED]:      { label: 'تم إصدار استرداد',     icon: '↩️', color: '#ef4444' },
  [SystemActivityType.WAITING]:            { label: 'أُضيف لقائمة الانتظار', icon: '⏳', color: '#f59e0b' },
  [SystemActivityType.FIRST_LESSON]:       { label: 'حضر أول حصة',          icon: '🎓', color: '#ec4899' },
  [SystemActivityType.ACTIVATED]:          { label: 'تم تفعيل الطالب',       icon: '✅', color: '#10b981' },
  [SystemActivityType.CANCELLED]:          { label: 'تم إلغاء الحجز',       icon: '🚫', color: '#ef4444' },
};

// ── قوائم اختيار ثابتة (عرض) ──────────────────────────────────────────────
export const LEAD_SOURCES = ['فيسبوك', 'توصية صديق', 'حضور مباشر', 'واتساب', 'إعلان', 'أخرى'];
export const GRADES = ['الصف الأول الثانوي', 'الصف الثاني الثانوي', 'الصف الثالث الثانوي'];
export const MOCK_GROUPS = ['مجموعة السبت والثلاثاء', 'مجموعة الأحد والأربعاء', 'مجموعة الجمعة'];

// ─────────────────────────────────────────────────────────────────────────────
// أدوات مساعدة
// ─────────────────────────────────────────────────────────────────────────────

// الأحرف الأولى للاسم (للأفاتار)
export function initials(name) {
  return (name || '').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('');
}

const AVATAR_COLORS = [
  { bg: 'rgba(59,130,246,.15)', fg: '#3b82f6' },
  { bg: 'rgba(16,185,129,.15)', fg: '#10b981' },
  { bg: 'rgba(245,158,11,.15)', fg: '#f59e0b' },
  { bg: 'rgba(139,92,246,.15)', fg: '#8b5cf6' },
  { bg: 'rgba(236,72,153,.15)', fg: '#ec4899' },
  { bg: 'rgba(6,182,212,.15)',  fg: '#06b6d4' },
];

export function avatarColor(name) {
  const sum = (name || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

// توليد رقم قبول مقروء تسلسلي: ADM-000001, ADM-000002...
// يعتمد على أكبر رقم موجود (لا يعيد استخدام الأرقام بعد الحذف).
export function nextAdmissionNumber(records = []) {
  const re = new RegExp(`^${ADMISSION_NUMBER_PREFIX}-(\\d+)$`);
  let max = 0;
  for (const r of records) {
    const m = re.exec(r.admissionNo || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${ADMISSION_NUMBER_PREFIX}-${String(max + 1).padStart(ADMISSION_NUMBER_PAD, '0')}`;
}
