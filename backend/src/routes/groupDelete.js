// backend/src/routes/groupDelete.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 2.1 (Homework behavioral cleanup) — server-side homework guard for DELETE /api/groups/:id.
//
// Homework 2.0 targets a grade, not a group, so "this group's grade still has homework" is a
// business rule with no FK behind it (only legacy homeworks.group_id rows are FK-protected).
// GroupsPage used to enforce it client-side by reading homework data — first from the global
// s.homeworks bootstrap (silently empty for a user without the 'homework' permission, so the
// rule was skipped), then in Phase 2 via GET /api/homeworks?grade= (403 for that same user, so
// Group deletion became blocked by an unrelated permission).
//
// The rule now runs here, inside the Group-deletion request itself — mounted in server.js with
// the same requireAuth + requirePermission('groups') chain as the generic DELETE /api/groups/:id
// it guards. So: Group deletion requires exactly the 'groups' permission (as before), no
// 'homework' permission is needed, no homework data is exposed (only a count in the message),
// and the rule cannot be bypassed by calling the API directly.
//
// Only DELETE /:id is intercepted, and only to reject; when the guard passes it calls next()
// and the generic CRUD router performs the delete exactly as before (missing group → 404, FK
// violations → 409, unchanged). Same interception technique as homeworkDelete.js/examDelete.js.
//
// M2/F3 — the page's other related-record checks moved here for the same reason: they read
// enrollments ('students'), attendance ('attendance'), communications ('students') and
// payments ('payments'), so a 403 on any of them blocked a 'groups'-only user from deleting
// even an empty group. Same checks, order and messages the page used (members, attendance,
// exams, admissions, communications, payments), each a 409 with GROUP_HAS_RELATED_RECORDS;
// the homework rule still runs last with its own code, exactly as before.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const GROUP_HAS_HOMEWORK = 'GROUP_HAS_HOMEWORK';
export const GROUP_HAS_RELATED_RECORDS = 'GROUP_HAS_RELATED_RECORDS';

// Members = active enrollments (Primary and Additional) plus any student whose
// students.group_id still points here (that FK blocks the delete regardless) — the page's
// exact definition.
async function countGroupMembers(groupId) {
  const [enrolled, primary] = await Promise.all([
    prisma.student_group_enrollments.findMany({ where: { group_id: groupId, status: 'active' }, select: { student_id: true } }),
    prisma.students.findMany({ where: { group_id: groupId }, select: { id: true } }),
  ]);
  return new Set([...enrolled.map((e) => e.student_id), ...primary.map((s) => s.id)]).size;
}

// [count, message] — in the order GroupsPage checked them.
const RELATED = [
  [countGroupMembers, (n) => `لا يمكن حذف المجموعة — بها ${n} طالب. انقل الطلاب أولاً.`],
  [(id) => prisma.attendance.count({ where: { group_id: id } }), (n) => `لا يمكن حذف المجموعة — لها ${n} سجل حضور تاريخي.`],
  [(id) => prisma.exams.count({ where: { group_id: id } }), (n) => `لا يمكن حذف المجموعة — لها ${n} امتحان.`],
  [(id) => prisma.admissions.count({ where: { group_id: id } }), (n) => `لا يمكن حذف المجموعة — لها ${n} سجل قبول مرتبط.`],
  [(id) => prisma.communications.count({ where: { group_id: id } }), (n) => `لا يمكن حذف المجموعة — لها ${n} سجل تواصل مرتبط.`],
  [(id) => prisma.payments.count({ where: { group_id: id } }), (n) => `لا يمكن حذف المجموعة — لها ${n} دفعة مسجَّلة.`],
];

const router = Router();

router.delete('/:id', asyncHandler(async (req, res, next) => {
  const group = await prisma.groups.findUnique({ where: { id: req.params.id }, select: { id: true, grade: true } });
  if (!group) return next(); // generic router answers 404, unchanged

  for (const [count, message] of RELATED) {
    // Sequential on purpose: stop at the first blocking relation and report it, as the page did.
    const n = await count(group.id);
    if (n > 0) {
      return res.status(409).json({ ok: false, code: GROUP_HAS_RELATED_RECORDS, error: message(n) });
    }
  }

  if (group.grade) {
    const count = await prisma.homeworks.count({ where: { grade: group.grade } });
    if (count > 0) {
      return res.status(409).json({
        ok: false,
        code: GROUP_HAS_HOMEWORK,
        error: `لا يمكن حذف المجموعة — لها ${count} واجب مسجَّل.`,
      });
    }
  }
  next();
}));

export default router;
