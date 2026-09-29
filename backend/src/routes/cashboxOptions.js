// backend/src/routes/cashboxOptions.js
// ─────────────────────────────────────────────────────────────────────────────
// M2/F1 — GET /api/cashboxes/options: the cashbox picker for payment flows.
//
// Recording a regular payment ('payments'), an admission deposit ('admissions') or a
// material-distribution payment ('materials' + 'payments') requires choosing a cashbox, but
// the cashboxes collection itself is Treasury data ('treasury'). Roles meant to record
// payments without full Treasury access therefore had an empty picker and could not submit.
//
// This endpoint returns ONLY { id, name, active } — no opening balance, balance, totals or
// transactions. It is read-only (GET only; any other method falls through to the unchanged
// 'treasury'-guarded /api/cashboxes mounts). Inactive cashboxes are included with
// active:false so the forms keep filtering exactly as before, and every payment route still
// re-validates the chosen cashbox server-side (exists + active). Mounted in server.js behind
// requireAnyPermission('payments', 'admissions', 'materials', 'treasury').
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const CASHBOX_OPTION_PERMISSIONS = ['payments', 'admissions', 'materials', 'treasury'];

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const rows = await prisma.cashboxes.findMany({
    select: { id: true, name: true, active: true },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  });
  res.json({ ok: true, data: rows });
}));

export default router;
