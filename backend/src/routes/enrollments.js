// backend/src/routes/enrollments.js
// Phase 3A (Multi-Group Enrollment — Enrollment API). Dedicated, restricted route for
// student_group_enrollments — deliberately NOT registered in collections.js/the generic
// dynamic CRUD loop (crud.js), so there is no unrestricted create/update/delete on this
// table from any client. Every mutation below calls into enrollmentService.js (Phase 1's
// setPrimaryGroup/withdrawEnrollment, this phase's extended addAdditionalEnrollment/new
// updateEnrollmentSchedule) — this file never touches student_group_enrollments directly
// itself, and never invents a second business-logic path.
//
// Two path families, both mounted in server.js before the generic dynamic collections loop
// (same pattern as communications.js/studentReport.js):
//   - studentEnrollmentsRouter → /api/students/:studentId/enrollments (GET list, POST add
//     Additional Group) — same "/:studentId/..." shape as studentReport.js's own route.
//   - enrollmentRouter (default export) → /api/enrollments/:enrollmentId (DELETE withdraw,
//     PATCH schedule).
//
// Primary Group changes are NOT duplicated here — the existing PUT/PATCH /api/students/:id
// path (crud.js, Phase 1) already routes group_id through setPrimaryGroupTx/
// withdrawEnrollmentTx correctly; this file only adds what that path doesn't cover
// (Additional Group add/withdraw, and post-hoc attend_days/start_date/end_date edits).
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { snakeToCamel } from '../lib/caseMapper.js';
import {
  addAdditionalEnrollment,
  withdrawEnrollment,
  updateEnrollmentSchedule,
} from '../lib/enrollmentService.js';

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

// ── /api/students/:studentId/enrollments ──────────────────────────────────────────────
export const studentEnrollmentsRouter = Router();

// GET — the student's ACTIVE enrollments (Primary and Additional both included; `role` is
// a returned field, not filtered on). Withdrawn/transferred history is out of scope here —
// nothing in Phase 3's UI plan needs it yet, and exposing it is a trivial future addition.
studentEnrollmentsRouter.get('/:studentId/enrollments', asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const rows = await prisma.student_group_enrollments.findMany({
    where: { student_id: studentId, status: 'active' },
    orderBy: { start_date: 'asc' },
  });
  res.json({ ok: true, data: snakeToCamel(rows) });
}));

// POST — add an Additional Group enrollment. Calls enrollmentService's
// addAdditionalEnrollment (never a direct student_group_enrollments.create() here).
studentEnrollmentsRouter.post('/:studentId/enrollments', asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const { groupId, startDate, endDate, attendDays } = req.body || {};
  if (typeof groupId !== 'string' || !groupId.trim()) throw badRequest('groupId مطلوب.');

  const created = await addAdditionalEnrollment(studentId, groupId, {
    effectiveDate: startDate,
    endDate,
    attendDays,
  });
  res.status(201).json({ ok: true, data: snakeToCamel(created) });
}));

// ── /api/enrollments/:enrollmentId ─────────────────────────────────────────────────────
const enrollmentRouter = Router();

// DELETE — withdraw an Additional Group enrollment. Scoped to role='additional' only: a
// Primary Group withdrawal already has its own correct path (PUT /api/students/:id with
// groupId: null, Phase 1) which also nulls students.group_id — that invariant belongs to
// the student-facing path, not here, so this route refuses to touch a Primary row at all
// rather than silently duplicating that behavior.
enrollmentRouter.delete('/:enrollmentId', asyncHandler(async (req, res) => {
  const { enrollmentId } = req.params;
  const enrollment = await prisma.student_group_enrollments.findUnique({ where: { id: enrollmentId } });
  if (!enrollment) return res.status(404).json({ ok: false, error: 'التسجيل غير موجود.' });
  if (enrollment.role !== 'additional') {
    throw badRequest('هذا المسار مخصَّص لسحب مجموعة إضافية فقط — لتغيير المجموعة الرئيسية استخدم تعديل بيانات الطالب.');
  }

  const withdrawn = await withdrawEnrollment(enrollmentId, { effectiveDate: req.body?.effectiveDate });
  res.json({ ok: true, data: snakeToCamel(withdrawn) });
}));

// PATCH — update an active enrollment's attend_days/start_date/end_date.
enrollmentRouter.patch('/:enrollmentId', asyncHandler(async (req, res) => {
  const { enrollmentId } = req.params;
  const { attendDays, startDate, endDate } = req.body || {};
  const updated = await updateEnrollmentSchedule(enrollmentId, { attendDays, startDate, endDate });
  res.json({ ok: true, data: snakeToCamel(updated) });
}));

export { enrollmentRouter };
export default enrollmentRouter;
