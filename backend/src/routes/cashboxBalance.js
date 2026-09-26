// backend/src/routes/cashboxBalance.js
// ─────────────────────────────────────────────────────────────────────────────
// Scalability Architecture Phase 3 — Treasury Safety Gate ONLY. This is a read-only,
// independent balance endpoint — it does NOT touch TreasuryPage.jsx, does NOT remove
// treasury_txn from PG_COLLECTIONS, and does NOT modify any existing financial write
// transaction (createPayment/refundPayment/reverseTreasuryTxn/transferBetweenCashboxes
// are untouched).
//
// Formula replicated EXACTLY from src/services/cashboxService.js's getCashboxBalance
// (the current, full-history, client-side reference implementation):
//   balance = opening_balance + Σ(income, status != 'cancelled') - Σ(expense, status != 'cancelled')
// — same predicate (`status != 'cancelled'`, not `status = 'active'` — the two are
// equivalent today only because chk_treasury_status permits exactly {active, cancelled},
// but the query mirrors the client's own predicate literally, not an assumption about it).
//
// Reversals and transfers need NO special-case handling here: a reversal
// (reverseTreasuryTxn, treasuryTxn.js) marks the ORIGINAL row 'cancelled' (excluded by the
// same predicate) and creates a normal opposite-type row (included normally) — a transfer
// (transferBetweenCashboxes) is just two ordinary income/expense rows on two different
// cashboxes. Both are already correctly reflected by summing type=income/expense per
// cashbox_id; nothing about them requires a different formula.
//
// `asOf` is a genuinely NEW capability — src/services/cashboxService.js's
// getCashboxBalance has no date filter at all today (it always sums the FULL history for
// "the current balance"). Omitting `asOf` here reproduces that exact current behavior
// (no date filter, verified equal in cashboxBalance.integration.test.js). When provided,
// `asOf` is inclusive (`date <= asOf`) — "balance as of the end of that calendar day".
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { parseTreasuryDate } from './treasuryTxn.js';

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

// يُصدَّر منفصلاً عن الـ router ليكون قابلاً للاختبار مباشرة بلا HTTP/auth، بنفس مبدأ
// createPayment/getStudentReportData.
export async function getCashboxBalanceAsOf(cashboxId, { asOf } = {}) {
  if (typeof cashboxId !== 'string' || !cashboxId.trim()) {
    throw badRequest('cashboxId مطلوب.');
  }

  const cashbox = await prisma.cashboxes.findUnique({ where: { id: cashboxId } });
  if (!cashbox) throw badRequest('الخزنة غير موجودة.');

  let parsedAsOf = null;
  if (asOf !== undefined && asOf !== null && asOf !== '') {
    parsedAsOf = parseTreasuryDate(asOf);
    if (!parsedAsOf) throw badRequest('asOf غير صالح.');
  }

  const baseWhere = { cashbox_id: cashboxId, status: { not: 'cancelled' } };
  if (parsedAsOf) baseWhere.date = { lte: parsedAsOf };

  const [incomeAgg, expenseAgg] = await Promise.all([
    prisma.treasury_txn.aggregate({ where: { ...baseWhere, type: 'income' }, _sum: { amount: true } }),
    prisma.treasury_txn.aggregate({ where: { ...baseWhere, type: 'expense' }, _sum: { amount: true } }),
  ]);

  const balance = Number(cashbox.opening_balance)
    + Number(incomeAgg._sum.amount ?? 0)
    - Number(expenseAgg._sum.amount ?? 0);

  return { cashboxId, balance, asOf: asOf || null };
}

const router = Router();

// GET /api/cashboxes/:cashboxId/balance?asOf=YYYY-MM-DD — نفس صلاحية /api/cashboxes
// الحالية (requirePermission('treasury'))، مفروضة عند التركيب في server.js.
router.get('/:cashboxId/balance', asyncHandler(async (req, res) => {
  const data = await getCashboxBalanceAsOf(req.params.cashboxId, { asOf: req.query.asOf });
  res.json({ ok: true, data });
}));

export default router;
