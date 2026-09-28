// backend/src/lib/attendanceEligibility.js
// Phase 2 (Multi-Group Enrollment — Attendance Eligibility). Determines which students are
// eligible to appear in a group's attendance roster on a given date, from
// student_group_enrollments (Phase 1 — see enrollmentService.js, unmodified here) instead of
// students.group_id. Primary and Additional enrollments are treated identically — the rule
// below reads a single enrollment row, regardless of its role.
//
// Eligibility for one (student, group, date):
//   1. an enrollment row with student_id/group_id matching
//   2. enrollment.start_date <= date, and enrollment.end_date is NULL or date <= end_date
//   3. dayCodeOf(date) is one of group.days (the group meets that weekday), AND
//   4. enrollment.attend_days is NULL (every group day) or contains dayCodeOf(date) —
//      group.days says when the group meets, attend_days only narrows it for this student;
//      an explicit attend_days can never make a student eligible on a day the group does
//      not meet.
//
// Group Closure (Attendance Integration) — deliberately NOT filtered by status='active':
// every enrollmentService.js closure path (withdrawEnrollmentTx/setPrimaryGroupTx's
// transfer-close) always sets end_date together with the status change — a closed
// (withdrawn/transferred) row's end_date already correctly excludes any date after its real
// closure, and a still-open row always has status='active' with end_date either null or a
// future bound. So status is fully redundant with the start_date/end_date window for every
// row this module's callers ever write (verified against enrollmentService.js's own
// invariants) — and dropping it is what makes ONE query correct for both "today/future"
// roster-building (SessionMarking) and historical report dates: a row now closed still
// accurately represents "this enrollment was active during [start_date, end_date]" for any
// date that genuinely fell inside that window before closure. Filtering by status='active'
// would incorrectly exclude that historically-true row. See
// attendanceEligibility.integration.test.js test 12 for the concrete scenario this fixes.
//
// Day codes are the 3-letter set already used throughout the app for groups.days/
// student_group_enrollments.attend_days ('sat'..'fri' — see src/services/groupService.js's
// ALL_DAYS). dayCodeOf() reproduces the exact getDay()-indexed mapping already used in
// src/modules/reports/AttendanceAnalytics.jsx (JS Date.getDay(), 0=Sunday..6=Saturday) —
// duplicated rather than imported because the backend and frontend are separate module
// graphs with nothing importable between them.
import { prisma } from '../prisma.js';

const DAY_CODES_BY_GETDAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Same normalization as enrollmentService.js's normalizeDate: a "YYYY-MM-DD" string is that
// calendar date at UTC midnight, so it never shifts a day under a non-UTC server timezone.
function toDateOnly(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && DATE_ONLY_RE.test(value)) return new Date(`${value}T00:00:00.000Z`);
  return new Date(value);
}

export function dayCodeOf(date) {
  return DAY_CODES_BY_GETDAY[toDateOnly(date).getUTCDay()];
}

function isDayAllowed(allowedDays, dateObj) {
  const days = Array.isArray(allowedDays) ? allowedDays : [];
  return days.includes(dayCodeOf(dateObj));
}

// Rules 3+4 above: the group must meet that weekday, and a non-NULL attend_days must include it.
function isEnrollmentDayAllowed(enrollment, groupDays, dateObj) {
  if (!isDayAllowed(groupDays, dateObj)) return false;
  return enrollment.attend_days == null || isDayAllowed(enrollment.attend_days, dateObj);
}

/**
 * The active, date-eligible enrollment rows for one group on one date (Primary and
 * Additional both included — no role filter). Pass `client` (a Prisma transaction client)
 * to compose this inside an already-open transaction; defaults to the plain `prisma` client
 * for read-only callers.
 */
export async function getEligibleEnrollmentsForGroupDate(groupId, date, client = prisma) {
  const dateObj = toDateOnly(date);
  const group = await client.groups.findUnique({ where: { id: groupId }, select: { days: true } });
  if (!group) return [];

  const enrollments = await client.student_group_enrollments.findMany({
    where: {
      group_id: groupId,
      start_date: { lte: dateObj },
      OR: [{ end_date: null }, { end_date: { gte: dateObj } }],
    },
  });

  return enrollments.filter((e) => isEnrollmentDayAllowed(e, group.days, dateObj));
}

/**
 * Convenience wrapper over getEligibleEnrollmentsForGroupDate — just the student ids,
 * de-duplicated (defense in depth: two enrollment rows for the same student/group/date
 * should never happen given enrollmentService.js's own invariants, but the roster this
 * feeds must never show the same student twice regardless).
 */
export async function getEligibleStudentIdsForGroupDate(groupId, date, client = prisma) {
  const enrollments = await getEligibleEnrollmentsForGroupDate(groupId, date, client);
  return [...new Set(enrollments.map((e) => e.student_id))];
}

/** Single (student, group, date) eligibility check — same rule, scoped to one enrollment. */
export async function isStudentEligibleForGroupDate(studentId, groupId, date, client = prisma) {
  const dateObj = toDateOnly(date);
  const group = await client.groups.findUnique({ where: { id: groupId }, select: { days: true } });
  if (!group) return false;

  const enrollment = await client.student_group_enrollments.findFirst({
    where: {
      student_id: studentId,
      group_id: groupId,
      start_date: { lte: dateObj },
      OR: [{ end_date: null }, { end_date: { gte: dateObj } }],
    },
  });
  if (!enrollment) return false;
  return isEnrollmentDayAllowed(enrollment, group.days, dateObj);
}
