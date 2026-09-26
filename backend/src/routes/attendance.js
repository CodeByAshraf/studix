// backend/src/routes/attendance.js
// ─────────────────────────────────────────────────────────────────────────────
// C4 Attendance migration — Phase 1 (backend foundation only). Two dedicated,
// read-only routes mounted BEFORE the generic dynamic CRUD loop (same pattern as
// communications.js/payments.js/studentReport.js):
//   - GET /api/attendance            — scoped list (studentId/groupId/date/status)
//   - GET /api/attendance/aggregate  — server-side aggregation (groupBy)
//
// Purely additive at this phase: with no query params, GET / returns exactly what the
// generic unfiltered route (makeCrudRouter) returns today — same {ok, data, count} shape,
// same rows — so the existing boot-sync (pgGetCollection('attendance'), still calling this
// same GET with no params) keeps working identically. No frontend consumer is migrated in
// this phase, PG_COLLECTIONS is untouched, and attendance-sessions.js's write path
// (PUT /api/attendance-sessions/:groupId/:date) is completely unmodified — this file adds
// no write capability at all, and does not intercept POST/PUT/PATCH/DELETE on /api/attendance
// (those keep flowing to the generic CRUD router exactly as before, since this router only
// defines the two GET routes below and calls next() for anything else, same as
// communications.js).
//
// Response shape: matches what every existing consumer of the general route already reads
// after boot-sync's own normalization (db.middleware.js's COLLECTION_FIXUPS.attendance) —
// camelCase fields (studentId/groupId/sessionTime/createdAt), `date` as a plain "YYYY-MM-DD"
// string. Unlike the generic route (which returns a raw timestamp for `date` and relies on
// the CLIENT to trim it), this dedicated route normalizes `date` server-side before sending —
// the same convention already established by every other Phase-3B-4-and-later attendance
// route (attendanceSessions.js's own toDateOnly()), so a future frontend consumer of this
// endpoint needs no client-side fixup at all.
//
// Aggregation design (§B — see the audit report this implements): the 5 groupBy dimensions
// below are exactly the ones the Attendance C4 Phase 1 consumer audit identified as actually
// needed, no more. status/group/student/date use genuine SQL-side aggregation
// (prisma.attendance.groupBy — real GROUP BY + COUNT in Postgres, never a full-table
// findMany). weekday is the one dimension Prisma cannot GROUP BY natively without raw SQL;
// it instead does a findMany selecting only {date} (and only within whatever WHERE clause
// already narrowed the row set — e.g. a caller doing `?status=absent&groupBy=weekday` only
// ever fetches absence rows), then buckets by weekday in JS using attendanceEligibility.js's
// own dayCodeOf() — reused, not reimplemented, so this endpoint can never silently disagree
// with the eligibility module's day-of-week convention.
//
// Eligibility reuse: attendanceEligibility.js governs *who should get a row* at write time
// (already enforced inside attendanceSessions.js's saveAttendanceSession, inside the same
// transaction). These aggregates only ever summarize rows that already exist and were
// already eligibility-checked when written — a transferred student's attendance under their
// OLD group remains correctly attributed to that old group_id in the data itself, so no
// aggregate here needs to re-run eligibility logic; it would be redundant, not
// authoritative. This is a deliberate scope decision, not an oversight — see "remaining
// concerns" in the implementation report for where eligibility WOULD matter (roster-shaped
// consumers, not summary aggregates), which is unchanged and out of this phase's scope.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { snakeToCamel } from '../lib/caseMapper.js';
import { serializeBigInt } from './payments.js';
import { dayCodeOf } from '../lib/attendanceEligibility.js';

const VALID_STATUSES = new Set(['present', 'absent', 'late']); // matches chk_attendance_status
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GROUP_BY_DIMENSIONS = new Set(['status', 'group', 'student', 'weekday', 'date']);
const DAY_KEYS_AR_ORDER = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

// attendance.date is @db.Date — Prisma returns a JS Date; JSON.stringify would turn it into
// a full timestamp ("2000-01-01T00:00:00.000Z"), same problem documented in
// attendanceSessions.js/db.middleware.js. Normalized here, server-side, before sending.
function toDateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return value;
}

function validateDateParam(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw badRequest(`${label} يجب أن يكون بصيغة YYYY-MM-DD.`);
  }
  return value;
}

function validateStatusParam(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (!VALID_STATUSES.has(value)) {
    throw badRequest(`status غير صالح: "${value}". القيم المسموحة: present/absent/late.`);
  }
  return value;
}

const router = Router();

// ── GET / — scoped list (studentId/groupId/date/status/studentIds, composable) ───────────
// No params → identical to the generic unfiltered route (boot-sync's exact current call).
// studentIds (C4 Phase 2 addition — StudentsPage.jsx's per-row AttendanceHeatMap needs real
// rows, not counts, to preserve its cell-by-cell tooltips; a comma-separated batch here lets
// one request cover an entire visible page of students, same concept already supported on
// the aggregate route below, just extended to this list route too): student_id IN (...).
router.get('/', asyncHandler(async (req, res) => {
  const { studentId, groupId, date, status, studentIds } = req.query;
  const where = {};
  if (studentId) where.student_id = studentId;
  if (studentIds) {
    const ids = String(studentIds).split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) throw badRequest('studentIds لا يجوز أن تكون فارغة.');
    where.student_id = { in: ids };
  }
  if (groupId) where.group_id = groupId;
  const validDate = validateDateParam(date, 'date');
  if (validDate) where.date = new Date(`${validDate}T00:00:00.000Z`);
  const validStatus = validateStatusParam(status);
  if (validStatus) where.status = validStatus;

  const rows = await prisma.attendance.findMany({ where });
  const shaped = snakeToCamel(rows).map((r) => ({ ...r, date: toDateOnly(r.date) }));
  res.json({ ok: true, data: serializeBigInt(shaped), count: shaped.length });
}));

// ── Aggregate helpers ─────────────────────────────────────────────────────────────────────

function buildAggregateWhere({ groupId, studentId, studentIds, date, from, to, status }) {
  const where = {};
  if (groupId) where.group_id = groupId;
  if (studentId) where.student_id = studentId;
  if (studentIds) {
    const ids = String(studentIds).split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) throw badRequest('studentIds لا يجوز أن تكون فارغة.');
    where.student_id = { in: ids };
  }
  const validDate = validateDateParam(date, 'date');
  const validFrom = validateDateParam(from, 'from');
  const validTo = validateDateParam(to, 'to');
  if (validDate) {
    where.date = new Date(`${validDate}T00:00:00.000Z`);
  } else if (validFrom || validTo) {
    where.date = {};
    if (validFrom) where.date.gte = new Date(`${validFrom}T00:00:00.000Z`);
    if (validTo) where.date.lte = new Date(`${validTo}T00:00:00.000Z`);
  }
  const validStatus = validateStatusParam(status);
  if (validStatus) where.status = validStatus;
  return where;
}

function validateThreshold(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw badRequest('threshold يجب أن يكون عدداً صحيحاً غير سالب.');
  return n;
}

// status/group/student/date: genuine SQL-side GROUP BY + COUNT (prisma.groupBy), never a
// full-table findMany. group/student/date all group by [dimension, status] together so the
// response can report present/absent/late/total per key in one query — exactly what
// getGroupAttendanceStats/getAttendanceStats already compute client-side today, just moved
// server-side.
async function aggregateByStatus(where) {
  const rows = await prisma.attendance.groupBy({ by: ['status'], where, _count: true });
  return rows
    .map((r) => ({ key: r.status, count: r._count }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

async function aggregateByDimension(where, column, { threshold } = {}) {
  const rows = await prisma.attendance.groupBy({ by: [column, 'status'], where, _count: true });
  const buckets = new Map(); // key -> { total, present, absent, late }
  for (const r of rows) {
    const rawKey = r[column];
    const key = column === 'date' ? toDateOnly(rawKey) : rawKey;
    if (!buckets.has(key)) buckets.set(key, { total: 0, present: 0, absent: 0, late: 0 });
    const b = buckets.get(key);
    b.total += r._count;
    b[r.status] = (b[r.status] ?? 0) + r._count;
  }
  let out = [...buckets.entries()].map(([key, b]) => ({ key, ...b }));
  if (threshold !== undefined) out = out.filter((r) => r.absent >= threshold);
  return out.sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

// weekday: the one dimension Prisma cannot GROUP BY natively (no portable EXTRACT(DOW) in
// the query builder) — fetches only {date} within the already-filtered WHERE (e.g. a caller
// scoping to ?status=absent never pulls present/late rows at all), buckets in JS via
// attendanceEligibility.js's own dayCodeOf() so this never drifts from that module's
// day-of-week convention.
async function aggregateByWeekday(where) {
  const rows = await prisma.attendance.findMany({ where, select: { date: true } });
  const counts = new Map(DAY_KEYS_AR_ORDER.map((k) => [k, 0]));
  for (const r of rows) {
    const key = dayCodeOf(r.date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return DAY_KEYS_AR_ORDER
    .map((key) => ({ key, count: counts.get(key) ?? 0 }))
    .filter((r) => r.count > 0);
}

export async function getAttendanceAggregates({ groupBy, groupId, studentId, studentIds, date, from, to, status, threshold } = {}) {
  if (!GROUP_BY_DIMENSIONS.has(groupBy)) {
    throw badRequest('groupBy يجب أن يكون أحد: status, group, student, weekday, date.');
  }
  const where = buildAggregateWhere({ groupId, studentId, studentIds, date, from, to, status });
  const validThreshold = validateThreshold(threshold);

  if (groupBy === 'status') return aggregateByStatus(where);
  if (groupBy === 'weekday') return aggregateByWeekday(where);
  const column = groupBy === 'group' ? 'group_id' : groupBy === 'student' ? 'student_id' : 'date';
  return aggregateByDimension(where, column, { threshold: validThreshold });
}

// ── GET /aggregate ────────────────────────────────────────────────────────────────────────
// Mounted on the SAME router as GET / above, so /api/attendance/aggregate is intercepted
// here before it could ever reach the generic CRUD router's GET /:id (which would otherwise
// treat "aggregate" as a literal attendance id) — same technique as
// cashboxBalance.js's GET /api/cashboxes/:id/balance.
router.get('/aggregate', asyncHandler(async (req, res) => {
  const { groupBy, groupId, studentId, studentIds, date, from, to, status, threshold } = req.query;
  const data = await getAttendanceAggregates({ groupBy, groupId, studentId, studentIds, date, from, to, status, threshold });
  res.json({ ok: true, data });
}));

export default router;
