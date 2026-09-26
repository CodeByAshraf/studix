// backend/src/routes/homeworksScopedGet.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 (Homework global-read migration) — one dedicated, read-only route mounted BEFORE
// the generic dynamic CRUD loop (same pattern as grades.js / hwSubmissionsScopedGet.js):
//   - GET /api/homeworks?grade=  — scoped list of homework parent records
//
// The only filter is `grade`. It was added for GroupsPage's delete guard; Phase 2.1 moved that
// guard server-side (groupDelete.js, 'groups' permission), so no frontend consumer uses it now.
// HomeworkPage/HomeworkReports/HomeworkSearch need the full parent list (their KPIs/tabs/
// dropdowns span every homework), so they call this route with no params — a page-level read
// instead of the global bootstrap. No speculative filters.
//
// With no params, GET / returns the same rows and the same {ok, data, count} shape as the
// generic unfiltered route (makeCrudRouter), so the existing boot-sync
// (pgGetCollection('homeworks')) keeps working identically [Phase 3 cutover: homeworks has
// since left PG_COLLECTIONS; the unfiltered callers are the Homework pages and exportBackup].
// Phase 2.1: no orderBy, same neutral order as the generic route. Screens that need an order
// sort explicitly (HomeworkPage's list: dueDate DESC); the others (HomeworkReports groupings,
// HomeworkSearch rows, dropdowns) never sorted, so a server order would change what they show.
//
// Only GET / is defined: GET /:id, POST, PUT, PATCH keep flowing to the generic CRUD router,
// and DELETE /:id to homeworkDelete.js, exactly as before.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { snakeToCamel } from '../lib/caseMapper.js';
import { serializeBigInt } from './payments.js';

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

// Present-but-empty scoping params are rejected before any lookup; an absent key is simply
// "no filter for that dimension" (same rule as grades.js / hwSubmissionsScopedGet.js).
function validateScopeParam(query, key, label) {
  if (!(key in query)) return undefined;
  const value = query[key];
  if (typeof value !== 'string' || value === '') {
    throw badRequest(`${label} لا يجوز أن يكون فارغاً.`);
  }
  return value;
}

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const grade = validateScopeParam(req.query, 'grade', 'grade');

  const where = {};
  if (grade) where.grade = grade;

  const rows = await prisma.homeworks.findMany({ where });
  const shaped = snakeToCamel(rows);
  res.json({ ok: true, data: serializeBigInt(shaped), count: shaped.length });
}));

export default router;
