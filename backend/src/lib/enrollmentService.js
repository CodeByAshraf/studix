// backend/src/lib/enrollmentService.js
// Phase 1 (Multi-Group Enrollment) — the single write-through path for a student's
// Primary Group, plus the minimum operations needed to manage Additional Groups. Every
// exported function opens its own transaction via runInTransaction (this project's
// existing transaction helper, lib/transaction.js) — no second transaction abstraction.
//
// Invariant this module exists to guarantee, always atomically (same commit):
//   - at most one active role='primary' enrollment per student (also DB-enforced by
//     uq_student_group_enrollments_student_primary_active, migration 005 — this module
//     is the intended single writer, but the constraint is the real safety net)
//   - students.group_id always equals the group_id of that active primary enrollment,
//     or NULL when there is none
//
// setPrimaryGroup() covers both "set" (no previous Primary) and "transfer" (an existing
// Primary is replaced) — the task's own description of a transfer is exactly what this
// function does whenever a previous active Primary is found, so a second, near-identical
// function was not worth the duplication (same atomic sequence either way: close old if
// present, open new, sync students.group_id).
//
// crypto.randomUUID() for new ids and CURRENT_TIMESTAMP-equivalent (Date.now() via `new
// Date()`, left to the trg_*_updated triggers for updated_at) — same conventions used
// throughout this codebase (attendanceSessions.js, studentCreate.js).
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { runInTransaction } from './transaction.js';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Studix day codes — the same set groups.days/attend_days use everywhere (groupService.js's
// ALL_DAYS on the frontend, attendanceEligibility.js's dayCodeOf on the backend).
export const DAY_CODES = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];

// attend_days is a nullable Json column: SQL NULL ("attends every day the group meets") must
// be written as Prisma.DbNull, not a bare null.
function toAttendDaysColumn(days) {
  return days === null || days === undefined ? Prisma.DbNull : days;
}

// Same normalization used in attendanceSessions.js/studentCreate.js: a "YYYY-MM-DD"
// string is treated as that calendar date at UTC midnight, so it never shifts a day
// under a non-UTC server timezone. A Date is passed through as-is. No value defaults to
// "now".
function normalizeDate(value) {
  if (value === undefined || value === null) return new Date();
  if (value instanceof Date) return value;
  if (typeof value === 'string' && DATE_ONLY_RE.test(value)) return new Date(`${value}T00:00:00.000Z`);
  return new Date(value);
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  err.expose = true;
  return err;
}

/**
 * The one enrollment day-validation rule (Primary create/update, Additional create, schedule
 * update). `undefined` means "not provided" and is returned as-is; `null` means "attends every
 * day the group meets". Otherwise: a non-empty array of known day codes, every one of which the
 * group actually meets on. Returns the value to store (duplicates removed).
 */
export async function resolveAttendDaysTx(tx, groupId, attendDays) {
  if (attendDays === undefined || attendDays === null) return attendDays;
  if (!Array.isArray(attendDays)) throw badRequest('attend_days يجب أن تكون مصفوفة أو null.');
  if (attendDays.length === 0) {
    throw badRequest('اختر يوم حضور واحداً على الأقل (أو null لحضور كل أيام المجموعة).');
  }
  const unknown = attendDays.filter((d) => !DAY_CODES.includes(d));
  if (unknown.length) throw badRequest(`رمز يوم غير معروف: ${unknown.join('، ')}.`);

  const group = await tx.groups.findUnique({ where: { id: groupId }, select: { days: true } });
  if (!group) throw badRequest('المجموعة غير موجودة.');
  const groupDays = Array.isArray(group.days) ? group.days : [];
  const notMeeting = attendDays.filter((d) => !groupDays.includes(d));
  if (notMeeting.length) {
    throw badRequest(`المجموعة لا تجتمع في هذه الأيام: ${notMeeting.join('، ')}.`);
  }
  return [...new Set(attendDays)];
}

function sameDays(a, b) {
  if (a == null || b == null) return a == null && b == null;
  return a.length === b.length && a.every((d) => b.includes(d));
}

// A student may hold at most one ACTIVE enrollment per group, whatever its role (also
// DB-enforced by uq_student_group_enrollments_student_group_active) — checked up front so the
// caller gets a clear 409 instead of a raw unique-index violation.
async function assertNotActiveInGroup(tx, studentId, groupId) {
  const existing = await tx.student_group_enrollments.findFirst({
    where: { student_id: studentId, group_id: groupId, status: 'active' },
  });
  if (existing) {
    throw conflict(existing.role === 'primary'
      ? 'هذه المجموعة هي المجموعة الرئيسية للطالب بالفعل.'
      : 'الطالب مسجَّل بالفعل في هذه المجموعة كمجموعة إضافية.');
  }
}

// Shared by addAdditionalEnrollmentTx (a brand-new row's own start/end) and
// updateEnrollmentScheduleTx (an existing row's edited start/end) — the same "the period
// must not be inverted" rule either way.
function assertValidRange(startDate, endDate) {
  if (endDate && startDate > endDate) {
    throw badRequest('start_date يجب ألا يكون بعد end_date.');
  }
}

// Exported so a caller that only needs to know "is there an active Primary, and what's its
// enrollment id" (e.g. crud.js clearing group_id to null — withdrawEnrollmentTx() takes an
// enrollment id, not a student id) can reuse this instead of re-querying separately.
export async function findActivePrimary(tx, studentId) {
  return tx.student_group_enrollments.findFirst({
    where: { student_id: studentId, role: 'primary', status: 'active' },
  });
}

// ── Core logic, composable inside an already-open transaction ────────────────────────
// Exported (in addition to the public wrappers below) so callers that already hold a
// transaction — e.g. studentCreate.js creating a student with an initial group in the
// very same transaction as the students.create() — can compose this instead of opening
// a second, nested transaction.

/**
 * Sets or changes a student's Primary Group. If the student already has an active
 * Primary enrollment for a *different* group, it is closed as 'transferred' (history
 * preserved, never deleted) before the new one opens as 'active'. If the student already
 * has an active Primary enrollment for the *same* group, no new row is created — only its
 * attend_days is updated when `attendDays` is provided and differs. students.group_id is
 * synced to the new group_id in the same transaction.
 *
 * `attendDays` (validated by resolveAttendDaysTx): undefined = not provided (same group:
 * keep the current schedule; new Primary: NULL), null = every group day, array = those days.
 */
export async function setPrimaryGroupTx(tx, studentId, groupId, { effectiveDate, attendDays } = {}) {
  if (!groupId) throw badRequest('groupId مطلوب لتعيين/تغيير المجموعة الرئيسية.');
  const date = normalizeDate(effectiveDate);
  const days = await resolveAttendDaysTx(tx, groupId, attendDays);

  const current = await findActivePrimary(tx, studentId);
  if (current && current.group_id === groupId) {
    if (days === undefined || sameDays(current.attend_days, days)) return current;
    return tx.student_group_enrollments.update({
      where: { id: current.id },
      data: { attend_days: toAttendDaysColumn(days) },
    });
  }

  // The new Primary group must not already be one of the student's active Additional groups.
  await assertNotActiveInGroup(tx, studentId, groupId);

  if (current) {
    await tx.student_group_enrollments.update({
      where: { id: current.id },
      data: { status: 'transferred', end_date: date },
    });
  }

  const created = await tx.student_group_enrollments.create({
    data: {
      id: crypto.randomUUID(),
      student_id: studentId,
      group_id: groupId,
      role: 'primary',
      status: 'active',
      start_date: date,
      end_date: null,
      attend_days: toAttendDaysColumn(days),
    },
  });

  await tx.students.update({ where: { id: studentId }, data: { group_id: groupId } });

  return created;
}

/**
 * Adds a new active Additional Group enrollment. Never touches students.group_id.
 * `endDate`/`attendDays` are optional (Phase 3A) — omitted or null, this is byte-identical
 * to the original Phase 1 behavior (end_date: null, attend_days: null). Rejected (409) when the
 * student already has an active enrollment in this group — Primary or Additional.
 */
export async function addAdditionalEnrollmentTx(tx, studentId, groupId, { effectiveDate, endDate, attendDays } = {}) {
  if (!groupId) throw badRequest('groupId مطلوب لإضافة مجموعة إضافية.');
  const days = await resolveAttendDaysTx(tx, groupId, attendDays);
  const date = normalizeDate(effectiveDate);
  const end = endDate != null ? normalizeDate(endDate) : null;
  assertValidRange(date, end);
  await assertNotActiveInGroup(tx, studentId, groupId);

  return tx.student_group_enrollments.create({
    data: {
      id: crypto.randomUUID(),
      student_id: studentId,
      group_id: groupId,
      role: 'additional',
      status: 'active',
      start_date: date,
      end_date: end,
      attend_days: toAttendDaysColumn(days),
    },
  });
}

/**
 * Withdraws one enrollment by id (Primary or Additional — this function determines
 * which from the row itself, rather than the caller having two near-identical entry
 * points). Withdrawing the active Primary sets students.group_id to NULL — deliberately
 * no automatic promotion of any Additional enrollment (explicit business decision, see
 * migration/enrollmentService docs). Withdrawing an Additional enrollment leaves the
 * Primary and students.group_id untouched.
 */
export async function withdrawEnrollmentTx(tx, enrollmentId, { effectiveDate } = {}) {
  const date = normalizeDate(effectiveDate);
  const enrollment = await tx.student_group_enrollments.findUnique({ where: { id: enrollmentId } });
  if (!enrollment) throw badRequest('التسجيل غير موجود.');
  if (enrollment.status !== 'active') throw badRequest('لا يمكن سحب تسجيل غير نشط بالفعل.');

  const updated = await tx.student_group_enrollments.update({
    where: { id: enrollmentId },
    data: { status: 'withdrawn', end_date: date },
  });

  if (enrollment.role === 'primary') {
    await tx.students.update({ where: { id: enrollment.student_id }, data: { group_id: null } });
  }

  return updated;
}

/**
 * Updates an existing active enrollment's schedule fields (attend_days, start_date,
 * end_date) — Phase 3A. Never writes role/status/student_id/group_id, so neither of the
 * two partial unique indexes (uq_..._student_primary_active, keyed on student_id+role+
 * status; uq_..._student_group_active, keyed on student_id+group_id+status) can be
 * affected by this function — it never touches any column either one depends on.
 * Restricted to status='active' enrollments: a closed (withdrawn/transferred) row is
 * history and is never edited in place (same principle as setPrimaryGroupTx closing a
 * replaced Primary as 'transferred' rather than mutating it).
 */
export async function updateEnrollmentScheduleTx(tx, enrollmentId, { attendDays, startDate, endDate } = {}) {
  const enrollment = await tx.student_group_enrollments.findUnique({ where: { id: enrollmentId } });
  if (!enrollment) throw badRequest('التسجيل غير موجود.');
  if (enrollment.status !== 'active') throw badRequest('لا يمكن تعديل جدول تسجيل غير نشط (تاريخي).');
  const days = await resolveAttendDaysTx(tx, enrollment.group_id, attendDays);

  const data = {};
  if (days !== undefined) data.attend_days = toAttendDaysColumn(days);
  if (startDate !== undefined) data.start_date = normalizeDate(startDate);
  if (endDate !== undefined) data.end_date = endDate === null ? null : normalizeDate(endDate);

  const finalStart = data.start_date ?? enrollment.start_date;
  const finalEnd = 'end_date' in data ? data.end_date : enrollment.end_date;
  assertValidRange(finalStart, finalEnd);

  return tx.student_group_enrollments.update({ where: { id: enrollmentId }, data });
}

/**
 * Applies a student's complete group schedule — Primary Group + its days, and the full list
 * of Additional Groups with their days — inside the caller's transaction, so student create
 * (studentCreate.js) and student edit (crud.js) either commit the whole schedule or nothing.
 *
 *   groupId            undefined = Primary unchanged, null = withdraw the Primary,
 *                      string = set/transfer the Primary (setPrimaryGroupTx).
 *   primaryAttendDays  the Primary enrollment's attend_days (see setPrimaryGroupTx).
 *   additionalGroups   undefined = Additional Groups untouched; an array of
 *                      { groupId, attendDays } = the complete desired list: active Additional
 *                      enrollments not in it are withdrawn, listed existing ones get their
 *                      attend_days updated, new ones are added.
 *
 * Order matters: Additional Groups dropped from the list are withdrawn before the Primary
 * changes (so an Additional group can become the Primary), and new Additional Groups are
 * added after it (so the previous Primary group can become an Additional one).
 */
export async function applyStudentEnrollmentsTx(tx, studentId, { groupId, primaryAttendDays, additionalGroups, effectiveDate } = {}) {
  let wanted;
  if (additionalGroups !== undefined) {
    if (!Array.isArray(additionalGroups)) throw badRequest('additionalGroups يجب أن تكون مصفوفة.');
    wanted = additionalGroups.map((a) => {
      if (!a || typeof a.groupId !== 'string' || !a.groupId.trim()) {
        throw badRequest('كل مجموعة إضافية تحتاج groupId صالحاً.');
      }
      return { groupId: a.groupId, attendDays: a.attendDays };
    });
    const ids = wanted.map((a) => a.groupId);
    if (new Set(ids).size !== ids.length) throw badRequest('لا يمكن اختيار نفس المجموعة الإضافية أكثر من مرة.');

    const currentPrimary = await findActivePrimary(tx, studentId);
    const primaryGroupId = groupId !== undefined ? groupId : currentPrimary?.group_id ?? null;
    if (primaryGroupId && ids.includes(primaryGroupId)) {
      throw badRequest('المجموعة الرئيسية لا يمكن اختيارها كمجموعة إضافية أيضاً.');
    }

    const activeAdditional = await tx.student_group_enrollments.findMany({
      where: { student_id: studentId, role: 'additional', status: 'active' },
    });
    for (const e of activeAdditional) {
      if (!ids.includes(e.group_id)) await withdrawEnrollmentTx(tx, e.id, { effectiveDate });
    }
    wanted = wanted.map((a) => ({ ...a, existing: activeAdditional.find((e) => e.group_id === a.groupId) }));
  }

  if (groupId === null) {
    const current = await findActivePrimary(tx, studentId);
    if (current) await withdrawEnrollmentTx(tx, current.id, { effectiveDate });
  } else if (groupId !== undefined) {
    await setPrimaryGroupTx(tx, studentId, groupId, { effectiveDate, attendDays: primaryAttendDays });
  } else if (primaryAttendDays !== undefined) {
    const current = await findActivePrimary(tx, studentId);
    if (!current) throw badRequest('لا توجد مجموعة رئيسية لتعديل أيام حضورها.');
    await setPrimaryGroupTx(tx, studentId, current.group_id, { effectiveDate, attendDays: primaryAttendDays });
  }

  for (const a of wanted ?? []) {
    if (a.existing) {
      if (a.attendDays !== undefined && !sameDays(a.existing.attend_days, a.attendDays)) {
        await updateEnrollmentScheduleTx(tx, a.existing.id, { attendDays: a.attendDays });
      }
    } else {
      await addAdditionalEnrollmentTx(tx, studentId, a.groupId, { effectiveDate, attendDays: a.attendDays });
    }
  }
}

// ── Public API — each opens its own transaction ──────────────────────────────────────

export async function setPrimaryGroup(studentId, groupId, opts) {
  return runInTransaction((tx) => setPrimaryGroupTx(tx, studentId, groupId, opts));
}

export async function addAdditionalEnrollment(studentId, groupId, opts) {
  return runInTransaction((tx) => addAdditionalEnrollmentTx(tx, studentId, groupId, opts));
}

export async function withdrawEnrollment(enrollmentId, opts) {
  return runInTransaction((tx) => withdrawEnrollmentTx(tx, enrollmentId, opts));
}

export async function updateEnrollmentSchedule(enrollmentId, opts) {
  return runInTransaction((tx) => updateEnrollmentScheduleTx(tx, enrollmentId, opts));
}
