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
// treasuryTxn (اختياري، افتراضياً []) يُستخدَم لطرح الاسترداد الفعلي لكل دفعة (عبر
// getRefundedAmount أدناه) من إيرادها — بدون هذا، دفعة استُرِدَّت جزئياً أو كلياً كانت
// تُحسَب بكامل مبلغها الأصلي إلى الأبد، فتُضخِّم كل رقم إيراد يعتمد على هذه الدوال. غياب
// treasuryTxn (استدعاء قديم لم يُحدَّث بعد) يُعيد بالضبط السلوك السابق لدفعات بلا أي
// استرداد — لا تغيير لأي رقم في غياب استرداد حقيقي.
export function getMonthlyRevenue(payments, month, year, treasuryTxn = []) {
  return payments
    .filter((p) => p.month === month && (!year || p.year === year || p.date?.startsWith(`${year}`)))
    .reduce((sum, p) => sum + (p.amount - getRefundedAmount(p.id, treasuryTxn)), 0);
}

export function getDailyRevenue(payments, date, treasuryTxn = []) {
  return payments
    .filter((p) => p.date === date)
    .reduce((sum, p) => sum + (p.amount - getRefundedAmount(p.id, treasuryTxn)), 0);
}

export function getRevenueByGroup(payments, groups, treasuryTxn = []) {
  return groups.map((g) => ({
    id:      g.id,
    name:    g.name,
    color:   g.color,
    revenue: payments
      .filter((p) => p.groupId === g.id)
      .reduce((s, p) => s + (p.amount - getRefundedAmount(p.id, treasuryTxn)), 0),
  })).sort((a, b) => b.revenue - a.revenue);
}

export function getMonthlyBreakdown(payments, year = new Date().getFullYear(), treasuryTxn = []) {
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    return {
      month,
      label:   MONTHS_AR[month],
      revenue: getMonthlyRevenue(payments, month, year, treasuryTxn),
    };
  });
}

// ── Scalability Architecture Phase 4 Cutover 1 — /api/payments/aggregate adapters ──
// الخادم (getPaymentAggregates بالضبط نفس صيغة "SUM(amount) - SUM(استرداد فعّال)"
// المُستخدَمة محلياً هنا) يُعيد صفوفاً جزئية فقط — بُعد بلا أي دفعة لا يظهر كصفّ إطلاقاً
// (بخلاف getMonthlyBreakdown/getRevenueByGroup المحليتين أعلاه اللتين تبنيان دائماً
// بنية كثيفة: 12 شهراً/كل المجموعات، حتى لو كانت القيمة صفراً). هاتان الدالتان تُعيدان
// بناء نفس البنية الكثيفة من استجابة الخادم الجزئية — بلا أي تغيير على الترتيب/التسميات/
// منطق "أفضل شهر"/المتوسط/الفرز التي تعتمد عليها FinancialAnalytics.jsx/PaymentReports.jsx.
export function zeroFillMonthlyAggregate(aggregateRows = []) {
  const byMonth = new Map(aggregateRows.map((r) => [Number(r.key), Number(r.revenue) || 0]));
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    return { month, label: MONTHS_AR[month], revenue: byMonth.get(month) ?? 0 };
  });
}

// groups: مصفوفة groups الكاملة من الـ store (غير متأثرة بهذا التفويض — collection
// أساسية غير مُزالة من PG_COLLECTIONS) — تضمن ظهور كل مجموعة حتى بلا أي دفعة (revenue:0)،
// بنفس سلوك getRevenueByGroup(payments, groups, ...) بالضبط.
export function zeroFillGroupAggregate(aggregateRows = [], groups = []) {
  const byGroup = new Map(aggregateRows.map((r) => [r.key, Number(r.revenue) || 0]));
  return groups.map((g) => ({
    id: g.id, name: g.name, color: g.color, revenue: byGroup.get(g.id) ?? 0,
  }));
}

// getNetRevenue: نفس منطق الخصم المُستخدَم داخل الدوال الأربع أعلاه بالضبط (مبلغ الدفعة -
// getRefundedAmount)، لكن كبنية لبنة عامة تقبل أي مجموعة دفعات مُفلترَة مسبقاً من جهة
// الاستدعاء (يوم واحد، شهر، مجموعة، إلخ) — مصدر الحقيقة الوحيد لأي مجموع إيراد جديد في
// الواجهة، بدل أن يُعيد كل مكوّن كتابة `p.amount - getRefundedAmount(...)` بنفسه. الدوال
// الأربع أعلاه لم تُعَد كتابتها لتستخدمها (سلوكها الحالي مُختبَر بالفعل ولم يتغيّر) — هذه
// إضافة لبنة جديدة فقط لنقاط استدعاء جديدة (KPIs/رسوم بيانية) لم تكن تستخدم أياً منها.
export function getNetRevenue(payments, treasuryTxn = []) {
  return payments.reduce((sum, p) => sum + (p.amount - getRefundedAmount(p.id, treasuryTxn)), 0);
}

// ── M-01 — monthly subscription state ─────────────────────────────────────────────────────
// A month's state is ALWAYS derived from money, never read from payments.status (that column is
// a record-level snapshot written once at insert). Mirror of backend/src/lib/subscriptionMonth.js
// — keep both identical:
//   fee > 0 : net <= 0 -> unpaid, 0 < net < fee -> partial, net >= fee -> paid
//   fee <= 0 (zero/unset): nothing positive is due, so never 'paid' — partial once something
//            was paid, otherwise unpaid (same convention as buildPaymentsReport.js).
export const MONTH_STATE = Object.freeze({ PAID: 'paid', PARTIAL: 'partial', UNPAID: 'unpaid' });

export function deriveMonthState(fee, net) {
  const f = Number(fee);
  const n = Number(net);
  if (!Number.isFinite(n) || n <= 0) return MONTH_STATE.UNPAID;
  if (Number.isFinite(f) && f > 0 && n >= f) return MONTH_STATE.PAID;
  return MONTH_STATE.PARTIAL;
}

// Same month/year predicate the month-scoped consumers already use (year fallback kept as is).
function isInMonth(p, month, year) {
  return p.month === month && (!year || p.year === year || p.date?.startsWith(`${year}`));
}

// Net subscription money of one student/month: payType === 'subscription' payments only, minus
// their active refunds (getRefundedAmount — the existing refund model).
export function getSubscriptionNet(payments, studentId, month, year, treasuryTxn = []) {
  return getNetRevenue(
    (payments || []).filter((p) => p.studentId === studentId && p.payType === 'subscription' && isInMonth(p, month, year)),
    treasuryTxn,
  );
}

// { fee, net, remaining, state } for one student/month. `group` is the student's own group.
export function getStudentMonthState(student, group, payments, month, year, treasuryTxn = []) {
  const fee = getStudentFee(student, group);
  const net = getSubscriptionNet(payments, student?.id, month, year, treasuryTxn);
  return { fee, net, remaining: Math.max(0, fee - net), state: deriveMonthState(fee, net) };
}

function studentsInMonthState(students, payments, month, year, { groups = [], treasuryTxn = [] }, wanted) {
  const groupById = new Map((groups || []).map((g) => [g.id, g]));
  return students.filter((s) => s.status === 'active'
    && getStudentMonthState(s, groupById.get(s.groupId), payments, month, year, treasuryTxn).state === wanted);
}

// Active students whose subscription month is unpaid. `options.groups` resolves each student's
// fee (group price fallback); `options.treasuryTxn` nets active refunds.
export function getUnpaidStudents(students, payments, month, year = new Date().getFullYear(), options = {}) {
  return studentsInMonthState(students, payments, month, year, options, MONTH_STATE.UNPAID);
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

// Active students whose subscription month is partially paid (same options as above).
export function getPartialStudents(students, payments, month, year = new Date().getFullYear(), options = {}) {
  return studentsInMonthState(students, payments, month, year, options, MONTH_STATE.PARTIAL);
}

