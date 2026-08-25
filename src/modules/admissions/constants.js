// src/modules/admissions/constants.js
// ═══════════════════════════════════════════════════════════════════════════
// ثوابت وحدة القبول المركزية (enums) — مصدر واحد لكل قيم الأعمال.
// تُستخدم في كل مكان بدل النصوص الحرفية (magic strings) لضمان الاتساق
// وجاهزية الترحيل لـ SQL (كل enum يقابل عموداً/جدول lookup لاحقاً).
// ═══════════════════════════════════════════════════════════════════════════

// ── مراحل القبول (workflow) ──────────────────────────────────────────────
export const AdmissionStage = Object.freeze({
  LEAD:      'lead',
  RESERVED:  'reserved',
  WAITING:   'waiting',
  CONFIRMED: 'confirmed',
  ACTIVE:    'active',
});

// ── حالة العميل المحتمل ──────────────────────────────────────────────────
export const LeadStatus = Object.freeze({
  NEW:            'new',
  CONTACTED:      'contacted',
  INTERESTED:     'interested',
  NOT_INTERESTED: 'notInterested',
  FOLLOWUP_LATER: 'followupLater',
});

// ── حالة الحجز ───────────────────────────────────────────────────────────
export const ReservationStatus = Object.freeze({
  RESERVED:  'reserved',
  WAITING:   'waiting',
  CANCELLED: 'cancelled',
});

// ── أنواع الدفع (القبول) ─────────────────────────────────────────────────
export const PaymentType = Object.freeze({
  DEPOSIT:  'deposit',
  BOOKLETS: 'booklets',
  COURSE:   'course',
  OTHER:    'other',
});

// ── أنواع التواصل (متابعات الاستقبال — يدوية) ────────────────────────────
export const CommunicationType = Object.freeze({
  CALL:      'call',
  WHATSAPP:  'whatsapp',
  VISIT:     'visit',
  CONFIRMED: 'confirmed',
  NO_ANSWER: 'noAnswer',
  EXCUSED:   'excused',
});

// ── أنواع أحداث النشاط النظامي (تلقائية — للقراءة فقط) ────────────────────
export const SystemActivityType = Object.freeze({
  CREATED:            'created',
  RESERVATION:        'reservation',
  CONFIRMED:          'confirmed',
  PAYMENT_RECEIVED:   'paymentReceived',
  BOOKLETS_DELIVERED: 'bookletsDelivered',
  REFUND_ISSUED:      'refundIssued',
  WAITING:            'waiting',
  FIRST_LESSON:       'firstLesson',
  ACTIVATED:          'activated',
  CANCELLED:          'cancelled',
});

// ── فئات الخزنة المقابلة لأنواع دفع القبول ────────────────────────────────
// (تُستخدم عند إنشاء حركة الخزنة — الخزنة هي مصدر الحقيقة المالي)
export const PAYMENT_TO_CASHBOX_CATEGORY = Object.freeze({
  [PaymentType.DEPOSIT]:  'revisions',
  [PaymentType.BOOKLETS]: 'materials',
  [PaymentType.COURSE]:   'subscriptions',
  [PaymentType.OTHER]:    'other',
});

// ── الوحدة المصدر (للتتبّع في الخزنة) ─────────────────────────────────────
export const SOURCE_MODULE_ADMISSIONS = 'admissions';

// ── بادئة رقم القبول المقروء ──────────────────────────────────────────────
export const ADMISSION_NUMBER_PREFIX = 'ADM';
export const ADMISSION_NUMBER_PAD = 6;

// التحقق من الاسم الثنائي (مطابق لقاعدة إنشاء الطالب — يمنع فشل التفعيل لاحقاً)
export function isFullName(name) {
  return (name || '').trim().split(/\s+/).filter(Boolean).length >= 2;
}
