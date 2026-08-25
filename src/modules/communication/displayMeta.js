// src/modules/communication/displayMeta.js
// ─────────────────────────────────────────────────────────────────────────────
// بيانات العرض (labels / colors / icons) لمركز التواصل — مفاتيحها من enums.
// ─────────────────────────────────────────────────────────────────────────────

import { CommType, CommReason, CommResult, Priority, CommStatus, TaskStatus } from './constants';

export const COMM_TYPE_META = {
  [CommType.PHONE_CALL]:   { label: 'مكالمة هاتفية', icon: '📞', color: '#3b82f6' },
  [CommType.WHATSAPP]:     { label: 'واتساب',        icon: '💬', color: '#10b981' },
  [CommType.SMS]:          { label: 'رسالة نصية',    icon: '✉️', color: '#06b6d4' },
  [CommType.EMAIL]:        { label: 'بريد إلكتروني', icon: '📧', color: '#8b5cf6' },
  [CommType.PARENT_VISIT]: { label: 'زيارة ولي أمر', icon: '🏠', color: '#f59e0b' },
  [CommType.CENTER_VISIT]: { label: 'زيارة للسنتر',  icon: '🏢', color: '#ec4899' },
  [CommType.OTHER]:        { label: 'أخرى',          icon: '•',  color: '#64748b' },
};

export const COMM_REASON_META = {
  [CommReason.NEW_REGISTRATION]:     { label: 'تسجيل جديد' },
  [CommReason.RESERVATION_FOLLOWUP]: { label: 'متابعة حجز' },
  [CommReason.FIRST_LESSON_CONFIRM]: { label: 'تأكيد أول حصة' },
  [CommReason.ATTENDANCE]:           { label: 'حضور' },
  [CommReason.ABSENCE]:              { label: 'غياب' },
  [CommReason.PAYMENT_REMINDER]:     { label: 'تذكير بالدفع' },
  [CommReason.BOOKLET_DELIVERY]:     { label: 'تسليم مذكرات' },
  [CommReason.SCHEDULE_CHANGE]:      { label: 'تغيير موعد' },
  [CommReason.COMPLAINT]:            { label: 'شكوى' },
  [CommReason.INQUIRY]:              { label: 'استفسار' },
  [CommReason.ACADEMIC_FOLLOWUP]:    { label: 'متابعة دراسية' },
  [CommReason.OTHER]:                { label: 'أخرى' },
};

export const COMM_RESULT_META = {
  [CommResult.ANSWERED]:             { label: 'تم الرد',        color: '#10b981' },
  [CommResult.NO_ANSWER]:            { label: 'لم يرد',         color: '#f59e0b' },
  [CommResult.BUSY]:                 { label: 'مشغول',          color: '#f59e0b' },
  [CommResult.PHONE_OFF]:            { label: 'مغلق',           color: '#ef4444' },
  [CommResult.WRONG_NUMBER]:         { label: 'رقم خطأ',        color: '#ef4444' },
  [CommResult.PROMISE_TO_PAY]:       { label: 'وعد بالدفع',     color: '#8b5cf6' },
  [CommResult.CONFIRMED_ATTENDANCE]: { label: 'أكّد الحضور',    color: '#10b981' },
  [CommResult.RESCHEDULE]:           { label: 'إعادة جدولة',    color: '#06b6d4' },
  [CommResult.RESERVATION_CANCELLED]:{ label: 'ألغى الحجز',     color: '#ef4444' },
  [CommResult.COMPLETED]:            { label: 'مكتمل',          color: '#10b981' },
  [CommResult.FOLLOWUP_REQUIRED]:    { label: 'يحتاج متابعة',   color: '#f59e0b' },
};

export const PRIORITY_META = {
  [Priority.LOW]:    { label: 'منخفضة', color: '#64748b' },
  [Priority.NORMAL]: { label: 'عادية',  color: '#3b82f6' },
  [Priority.HIGH]:   { label: 'عالية',  color: '#f59e0b' },
  [Priority.URGENT]: { label: 'عاجلة',  color: '#ef4444' },
};

export const COMM_STATUS_META = {
  [CommStatus.OPEN]:      { label: 'مفتوح',  color: '#3b82f6' },
  [CommStatus.COMPLETED]: { label: 'مكتمل',  color: '#10b981' },
  [CommStatus.CANCELLED]: { label: 'ملغى',   color: '#ef4444' },
  [CommStatus.ARCHIVED]:  { label: 'مؤرشف',  color: '#64748b' },
};

export const TASK_STATUS_META = {
  [TaskStatus.PENDING]:   { label: 'معلّقة', color: '#f59e0b' },
  [TaskStatus.COMPLETED]: { label: 'مكتملة', color: '#10b981' },
  [TaskStatus.CANCELLED]: { label: 'ملغاة',  color: '#64748b' },
};

// طرق التواصل المفضّلة (لملف ولي الأمر)
export const PREFERRED_METHOD_META = {
  [CommType.PHONE_CALL]: { label: 'مكالمة', icon: '📞' },
  [CommType.WHATSAPP]:   { label: 'واتساب', icon: '💬' },
  [CommType.SMS]:        { label: 'رسالة',  icon: '✉️' },
};

// تنسيق التاريخ والوقت
export function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
  } catch { return iso; }
}

export function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('ar-EG', { dateStyle: 'medium' });
  } catch { return d; }
}
