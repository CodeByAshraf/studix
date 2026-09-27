// backend/src/lib/cashboxLedger.js
// ─────────────────────────────────────────────────────────────
// P2-3 — the single place a balance-gated cashbox debit is checked.
//
// Invariant: a balance-gated debit (payment refund, admission-cancellation refund, transfer out,
// manual expense) never commits if it would take its cashbox below zero — even when several run
// concurrently. Reversals are deliberately not gated (a correction of an entry that should never
// have existed, same as before P2-3) and credits never are.
//
// How: the balance is derived (opening_balance + Σ active income − Σ active expense), so there is
// no balance column whose UPDATE could carry the check. Instead the cashbox row is locked
// (SELECT … FOR NO KEY UPDATE) inside the caller's transaction, and the balance is recomputed
// AFTER the lock is held. A second debit on the same cashbox blocks at the lock until the first
// commits or rolls back; under READ COMMITTED its balance query then runs on a fresh snapshot
// that includes the first debit's committed row. The caller writes its expense in the same
// transaction, so lock, check and write are atomic.
//
// FOR NO KEY UPDATE (not FOR UPDATE): it conflicts with itself, serializing debits, but not with
// the FOR KEY SHARE lock a treasury_txn INSERT takes on its cashbox through the FK — so credits
// (payments, admission payments, manual income) are never blocked by a debit in progress.
// ─────────────────────────────────────────────────────────────
import { Prisma } from '@prisma/client';

/**
 * Locks the cashbox row for a debit and returns it with its balance as of the lock.
 * Must be called inside runInTransaction; the lock is held until that transaction ends.
 * @returns {Promise<{ cashbox: { id, name, active, opening_balance }, balance: Prisma.Decimal } | null>}
 *   null when the cashbox does not exist.
 */
export async function lockCashboxForDebit(tx, cashboxId) {
  const rows = await tx.$queryRaw`
    SELECT id, name, active, opening_balance FROM public.cashboxes
    WHERE id = ${cashboxId}
    FOR NO KEY UPDATE`;
  const cashbox = rows[0];
  if (!cashbox) return null;

  const [{ net }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0)::numeric AS net
    FROM public.treasury_txn
    WHERE cashbox_id = ${cashboxId} AND status = 'active'`;

  const balance = new Prisma.Decimal(cashbox.opening_balance).plus(new Prisma.Decimal(net));
  return { cashbox, balance };
}

// Exact decimal comparison (no float rounding): true when debiting `amount` would go below zero.
export function exceedsBalance(amount, balance) {
  return new Prisma.Decimal(amount).greaterThan(balance);
}
