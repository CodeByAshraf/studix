// src/modules/communication/constants.js
// ═══════════════════════════════════════════════════════════════════════════
// ثوابت مركز التواصل (enums) — مصدر واحد لكل قيم الأعمال.
// كل enum يقابل عموداً/جدول lookup لاحقاً (SQL-ready). لا نصوص حرفية.
// ═══════════════════════════════════════════════════════════════════════════

// ── أنواع التواصل ────────────────────────────────────────────────────────
export const CommType = Object.freeze({
  PHONE_CALL:   'phoneCall',
  WHATSAPP:     'whatsapp',
  SMS:          'sms',
  EMAIL:        'email',
  PARENT_VISIT: 'parentVisit',
  CENTER_VISIT: 'centerVisit',
  OTHER:        'other',
});

// ── أسباب التواصل ────────────────────────────────────────────────────────
export const CommReason = Object.freeze({
  NEW_REGISTRATION:        'newRegistration',
  RESERVATION_FOLLOWUP:    'reservationFollowup',
  FIRST_LESSON_CONFIRM:    'firstLessonConfirm',
  ATTENDANCE:              'attendance',
  ABSENCE:                 'absence',
  PAYMENT_REMINDER:        'paymentReminder',
  BOOKLET_DELIVERY:        'bookletDelivery',
  SCHEDULE_CHANGE:         'scheduleChange',
  COMPLAINT:               'complaint',
  INQUIRY:                 'inquiry',
  ACADEMIC_FOLLOWUP:       'academicFollowup',
  OTHER:                   'other',
});

// ── نتائج التواصل ────────────────────────────────────────────────────────
export const CommResult = Object.freeze({
  ANSWERED:            'answered',
  NO_ANSWER:           'noAnswer',
  BUSY:                'busy',
  PHONE_OFF:           'phoneOff',
  WRONG_NUMBER:        'wrongNumber',
  PROMISE_TO_PAY:      'promiseToPay',
  CONFIRMED_ATTENDANCE:'confirmedAttendance',
  RESCHEDULE:          'reschedule',
  RESERVATION_CANCELLED:'reservationCancelled',
  COMPLETED:           'completed',
  FOLLOWUP_REQUIRED:   'followupRequired',
});

// ── أولوية ───────────────────────────────────────────────────────────────
export const Priority = Object.freeze({
  LOW:    'low',
  NORMAL: 'normal',
  HIGH:   'high',
  URGENT: 'urgent',
});

// ── حالة سجل التواصل ──────────────────────────────────────────────────────
export const CommStatus = Object.freeze({
  OPEN:      'open',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  ARCHIVED:  'archived',
});

// ── حالة مهمة المتابعة ────────────────────────────────────────────────────
export const TaskStatus = Object.freeze({
  PENDING:   'pending',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

// ── بادئة رقم التواصل المقروء ─────────────────────────────────────────────
export const COMM_NUMBER_PREFIX = 'COM';
export const COMM_NUMBER_PAD = 6;
