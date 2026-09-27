-- backend/migrations/010_reversal_rows_non_financial.sql
-- Studix — migration 010: correct reversal accounting on existing treasury data.
--
-- reverseTreasuryTxn (routes/treasuryTxn.js) marks the original row 'cancelled' — which every
-- balance/total consumer excludes — AND used to create the opposite-type reversal row as
-- 'active', which every consumer counts. The original's effect was therefore removed twice:
-- reversing a +100 income moved the cashbox balance by -200. Reversal rows are now created
-- 'cancelled' (an audit record of the pair, no financial effect); this backfill applies the
-- same to reversal rows written before the fix.
--
-- Guarded to reversal rows whose original is itself 'cancelled' (the only state the reversal
-- path ever produces), so any inconsistent pair is left untouched rather than altered blindly.
-- Idempotent: a second run matches no rows. No schema change.
UPDATE public.treasury_txn r
SET status = 'cancelled'
FROM public.treasury_txn o
WHERE r.ref_type = 'reversal'
  AND r.status = 'active'
  AND o.id = r.ref_id
  AND o.status = 'cancelled';
