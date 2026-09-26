// backend/src/routes/communications.js
// ─────────────────────────────────────────────────────────────────────────────
// Scalability Architecture Phase 4 — scoped, read-only GET for /api/communications,
// mounted before the generic dynamic loop (same pattern as payments.js/studentReport.js).
// Purely additive: with no query params it returns exactly what the generic unfiltered
// route returns today (same {ok, data, count} shape) — the boot-sync's unfiltered
// pgGetCollection('communications') call keeps working identically.
//
// Pre-Installer Audit D1 (previously a documented pre-existing inconsistency, found during
// the Phase 4 consumer audit): this codebase used to have TWO different "this student's
// communications" rules in different places — reportData.js's gatherStudentData matched
// only by (phone === student.parentPhone) OR (studentName === student.name), never by
// student_id, while StudentsPage.jsx/GroupsPage.jsx (and this route) matched by a direct
// student_id/group_id equality. D1 unified them: gatherStudentData now also prefers
// student_id when a record has one (exclusive match, ignoring phone/name), falling back to
// the old phone/name rule only for legacy records with no student_id at all — the exact
// rule this route already implements. This route itself is unchanged by that fix.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { snakeToCamel } from '../lib/caseMapper.js';
import { serializeBigInt } from './payments.js';

const router = Router();

// GET / — studentId/groupId اختياريان (مطابقة عمود مباشرة، لا phone/name) — بلا أي منهما
// يُعيد كل الصفوف، بنفس شكل استجابة المسار العام تماماً.
router.get('/', asyncHandler(async (req, res) => {
  const { studentId, groupId } = req.query;
  const where = {};
  if (studentId) where.student_id = studentId;
  if (groupId) where.group_id = groupId;

  const rows = await prisma.communications.findMany({ where });
  res.json({ ok: true, data: serializeBigInt(snakeToCamel(rows)), count: rows.length });
}));

export default router;
