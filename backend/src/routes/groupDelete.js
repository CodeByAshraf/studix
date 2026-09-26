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
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const GROUP_HAS_HOMEWORK = 'GROUP_HAS_HOMEWORK';

const router = Router();

router.delete('/:id', asyncHandler(async (req, res, next) => {
  const group = await prisma.groups.findUnique({ where: { id: req.params.id }, select: { grade: true } });
  if (group?.grade) {
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
