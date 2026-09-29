// backend/src/routes/groupOptions.js
// ─────────────────────────────────────────────────────────────────────────────
// M2 (Group Options) — GET /api/groups/options: the group picker for operational flows that
// must choose a group without full Groups access:
//   - Admissions: confirming a reservation (choose the group, capacity check) and the
//     activation-time lookup of the confirmed group;
//   - Attendance: choosing the group for a session.
// The groups collection itself needs 'groups', so an admissions-only or attendance-only role
// had an empty picker and could not complete those flows.
//
// Returns ONLY { id, name, grade, max, price, activeCount } — no students, parents, phone
// numbers, teacher, schedule or other group fields. Read-only (GET only; any other method
// falls through to the unchanged 'groups'-guarded /api/groups mounts). Mounted in server.js
// BEFORE every other /api/groups mount (the group-delete guard applies requirePermission
// ('groups') to all /api/groups/* requests) behind requireAnyPermission('groups',
// 'admissions', 'attendance').
//
// activeCount = the current group-membership/capacity definition (GroupsPage's capacity and
// Attendance's picker, "Group Membership unification"): distinct students with an ACTIVE
// enrollment (Primary or Additional) in the group whose own status is 'active'. Computed
// here so the page never needs the students collection for it.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';

export const GROUP_OPTION_PERMISSIONS = ['groups', 'admissions', 'attendance'];

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const [groups, memberships] = await Promise.all([
    prisma.groups.findMany({
      select: { id: true, name: true, grade: true, max: true, price: true },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    }),
    prisma.student_group_enrollments.findMany({
      where: { status: 'active', students: { status: 'active' } },
      select: { group_id: true, student_id: true },
    }),
  ]);

  const membersByGroup = new Map();
  for (const { group_id: groupId, student_id: studentId } of memberships) {
    if (!membersByGroup.has(groupId)) membersByGroup.set(groupId, new Set());
    membersByGroup.get(groupId).add(studentId);
  }

  res.json({
    ok: true,
    data: groups.map((g) => ({
      id: g.id,
      name: g.name,
      grade: g.grade,
      max: g.max,
      price: Number(g.price),
      activeCount: membersByGroup.get(g.id)?.size ?? 0,
    })),
  });
}));

export default router;
