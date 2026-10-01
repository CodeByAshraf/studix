// backend/src/lib/subscriptionMonth.js
// ─────────────────────────────────────────────────────────────
// M-01 — the single definition of a student's monthly SUBSCRIPTION state.
//
// The state of a month is always derived from money, never read from payments.status:
//   net = Σ amount of that student's pay_type='subscription' payments for (year, month)
//         − Σ amount of the ACTIVE refunds (treasury_txn ref_type='refund') linked to them.
//
//   fee > 0 : net <= 0 -> 'unpaid', 0 < net < fee -> 'partial', net >= fee -> 'paid'.
//   fee <= 0 (zero / unset): no positive amount is due, so the month is never 'paid' —
//            'partial' once something was paid, otherwise 'unpaid' (same convention as the
//            group payment report, src/modules/payments/buildPaymentsReport.js).
//
// The frontend mirror is deriveMonthState in src/services/paymentService.js — keep both equal.
// ─────────────────────────────────────────────────────────────

export const MONTH_STATE = Object.freeze({ PAID: 'paid', PARTIAL: 'partial', UNPAID: 'unpaid' });

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function deriveMonthState(fee, net) {
  const f = toFiniteNumber(fee);
  const n = toFiniteNumber(net);
  if (n <= 0) return MONTH_STATE.UNPAID;
  if (f > 0 && n >= f) return MONTH_STATE.PAID;
  return MONTH_STATE.PARTIAL;
}

// The monthly fee is student-level: students.monthly_fee when positive, otherwise the price of
// the student's own primary group (students.group_id), otherwise 0 — the same rule as
// getStudentFee in src/services/paymentService.js.
export function resolveMonthlyFee(student, primaryGroup) {
  const own = toFiniteNumber(student?.monthly_fee);
  if (own > 0) return own;
  return toFiniteNumber(primaryGroup?.price);
}
