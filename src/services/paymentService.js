// src/services/paymentService.js
// المرحلة 5: Central Validation Engine
import {
  validate, hasErrors, sanitizeFormData, paymentSchema,
} from '../utils/validation';

export const PAYMENT_METHODS = {
  cash:     { label: 'نقدي',       icon: '💵' },
  transfer: { label: 'تحويل بنكي', icon: '🏦' },
  instapay: { label: 'إنستاباي',   icon: '📱' },
  visa:     { label: 'فيزا',        icon: '💳' },
};

// أنواع الدفع — تظهر في الفورم وفي الإيصال المطبوع.
export const PAYMENT_TYPES = {
  subscription: 'رسوم شهرية',
  material:     'مذكرة دراسية',
  exam:         'رسوم امتحان',
  extra:        'مراجعة خاصة',
  other:        'أخرى',
};

// رسوم الطالب الشهرية: رسوم الطالب الفردية أولاً، وإلا سعر المجموعة (احتياطي).
// هذا يسمح بتسعير فردي لكل طالب مع الحفاظ على توافق البيانات القديمة.
export function getStudentFee(student, group) {
  const fee = Number(student?.monthlyFee);
  if (fee > 0) return fee;
  return Number(group?.price) || 0;
}

export const PAYMENT_STATUS = {
  paid:    { label: 'مدفوع كامل', color: '#10b981', bg: 'rgba(16,185,129,.12)', border: 'rgba(16,185,129,.25)' },
  partial: { label: 'جزئي',       color: '#f59e0b', bg: 'rgba(245,158,11,.12)', border: 'rgba(245,158,11,.25)' },
  unpaid:  { label: 'لم يُسدَّد', color: '#ef4444', bg: 'rgba(239,68,68,.12)',  border: 'rgba(239,68,68,.25)'  },
};

export const MONTHS_AR = [
  '', 'يناير','فبراير','مارس','أبريل','مايو','يونيو',
  'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر',
];

// ── Validation ────────────────────────────────────────────────────────────────
export function validatePayment(data) {
  return validate(paymentSchema, data);
}

// ── Create ────────────────────────────────────────────────────────────────────
export function createPayment(data, student, group) {
  const errors = validatePayment(data);
  if (hasErrors(errors)) throw { type: 'VALIDATION', errors };

  const clean      = sanitizeFormData(data, ['notes']);
  const amount     = Number(clean.amount);
  const studentFee = getStudentFee(student, group);
  const status     = studentFee === 0 ? 'paid' : amount >= studentFee ? 'paid' : 'partial';

  return {
    id:        `p${Date.now()}`,
    studentId: clean.studentId,
    groupId:   student?.groupId || clean.groupId || '',
    month:     Number(clean.month),
    year:      Number(clean.year) || new Date().getFullYear(),
    amount,
    method:    clean.method || 'cash',
    date:      clean.date,
    payType:   clean.payType || 'subscription',
    materialId: clean.materialId || null,
    status,
    notes:     clean.notes?.trim() || '',
    createdAt: new Date().toISOString(),
  };
}

// ── Revenue helpers ───────────────────────────────────────────────────────────
export function getMonthlyRevenue(payments, month, year) {
  return payments
    .filter((p) => p.month === month && (!year || p.year === year || p.date?.startsWith(`${year}`)))
    .reduce((sum, p) => sum + p.amount, 0);
}

export function getDailyRevenue(payments, date) {
  return payments.filter((p) => p.date === date).reduce((sum, p) => sum + p.amount, 0);
}

export function getRevenueByGroup(payments, groups) {
  return groups.map((g) => ({
    id:      g.id,
    name:    g.name,
    color:   g.color,
    revenue: payments.filter((p) => p.groupId === g.id).reduce((s, p) => s + p.amount, 0),
  })).sort((a, b) => b.revenue - a.revenue);
}

export function getMonthlyBreakdown(payments, year = new Date().getFullYear()) {
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    return {
      month,
      label:   MONTHS_AR[month],
      revenue: getMonthlyRevenue(payments, month, year),
    };
  });
}

export function getUnpaidStudents(students, payments, month, year = new Date().getFullYear()) {
  return students.filter((s) => {
    if (s.status !== 'active') return false;
    const paid = payments.some(
      (p) => p.studentId === s.id && p.month === month &&
             (p.status === 'paid') &&
             (!year || p.year === year || p.date?.startsWith(`${year}`))
    );
    return !paid;
  });
}
// ── Refund derivation (Phase 3B-14C) ───────────────────────────────────────────
// الدفعة ثابتة (immutable) — لا حقل refunded/refundedAmount عليها إطلاقاً (لا عمود
// مطابق في القاعدة أصلاً). "كم استُرِدَّ من هذه الدفعة" قيمة مُشتَقّة دائماً من حركات
// treasury_txn المرتبطة (ref_type:'refund', payment_id:<payment.id>, status:'active')
// — لا تُخزَّن أبداً، بنفس مبدأ derivation رصيد الخزنة (getCashboxBalance).
export function getRefundedAmount(paymentId, treasuryTxn) {
  return (treasuryTxn || [])
    .filter(t => t.paymentId === paymentId && t.refType === 'refund' && t.status === 'active')
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
}

export function getRemainingRefundable(payment, treasuryTxn) {
  return Math.max(0, Number(payment.amount) - getRefundedAmount(payment.id, treasuryTxn));
}

export function getPartialStudents(students, payments, month, year = new Date().getFullYear()) {
  return students.filter((s) => {
    if (s.status !== 'active') return false;
    return payments.some(
      (p) => p.studentId === s.id &&
             p.month === month &&
             p.status === 'partial' &&
             (!year || p.year === year || p.date?.startsWith(`${year}`))
    );
  });
}

