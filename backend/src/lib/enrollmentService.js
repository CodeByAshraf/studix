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
import { runInTransaction } from './transaction.js';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

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
 * has an active Primary enrollment for the *same* group, this is a no-op (no duplicate
 * history row). students.group_id is synced to the new group_id in the same transaction.
 */
export async function setPrimaryGroupTx(tx, studentId, groupId, { effectiveDate } = {}) {
  if (!groupId) throw badRequest('groupId مطلوب لتعيين/تغيير المجموعة الرئيسية.');
  const date = normalizeDate(effectiveDate);

  const current = await findActivePrimary(tx, studentId);
  if (current && current.group_id === groupId) {
    return current; // already the student's Primary Group — nothing to do
  }

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
      attend_days: null,
    },
  });

  await tx.students.update({ where: { id: studentId }, data: { group_id: groupId } });

  return created;
}

/**
 * Adds a new active Additional Group enrollment. Never touches students.group_id.
 * `endDate`/`attendDays` are optional (Phase 3A) — omitted or null, this is byte-identical
 * to the original Phase 1 behavior (end_date: null, attend_days: null).
 */
export async function addAdditionalEnrollmentTx(tx, studentId, groupId, { effectiveDate, endDate, attendDays } = {}) {
  if (!groupId) throw badRequest('groupId مطلوب لإضافة مجموعة إضافية.');
  if (attendDays !== undefined && attendDays !== null && !Array.isArray(attendDays)) {
    throw badRequest('attend_days يجب أن تكون مصفوفة أو null.');
  }
  const date = normalizeDate(effectiveDate);
  const end = endDate != null ? normalizeDate(endDate) : null;
  assertValidRange(date, end);

  return tx.student_group_enrollments.create({
    data: {
      id: crypto.randomUUID(),
      student_id: studentId,
      group_id: groupId,
      role: 'additional',
      status: 'active',
      start_date: date,
      end_date: end,
      attend_days: attendDays ?? null,
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
  if (attendDays !== undefined && attendDays !== null && !Array.isArray(attendDays)) {
    throw badRequest('attend_days يجب أن تكون مصفوفة أو null.');
  }

  const data = {};
  if (attendDays !== undefined) data.attend_days = attendDays;
  if (startDate !== undefined) data.start_date = normalizeDate(startDate);
  if (endDate !== undefined) data.end_date = endDate === null ? null : normalizeDate(endDate);

  const finalStart = data.start_date ?? enrollment.start_date;
  const finalEnd = 'end_date' in data ? data.end_date : enrollment.end_date;
  assertValidRange(finalStart, finalEnd);

  return tx.student_group_enrollments.update({ where: { id: enrollmentId }, data });
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
