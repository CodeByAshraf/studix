// backend/src/routes/hwSubmissionsScopedGet.js
// ─────────────────────────────────────────────────────────────────────────────
// Grades + Homework Submissions Backend Read Foundation (spec 003) — backend-only,
// additive. Two dedicated, read-only routes mounted BEFORE the generic dynamic CRUD loop
// (same pattern as backend/src/routes/attendance.js):
//   - GET /api/hwSubmissions            — scoped list (studentId/homeworkId, plus Phase 2's
//                                         parent-homework dueFrom/dueTo/academicYear/grade;
//                                         all composable)
//   - GET /api/hwSubmissions/aggregate  — server-side aggregation (groupBy=status|homework)
//
// Named "*ScopedGet" (not "hwSubmissions.js") because backend/src/routes/hwSubmissions.js
// already exists — it is the existing atomic roster-write router (PUT /:homeworkId, mounted
// at the hyphenated /api/hw-submissions). This file is a completely separate router mounted
// at a different path (/api/hwSubmissions, no hyphen); that existing file and its mount are
// untouched by this feature.
//
// Purely additive: with no query params, GET / returns exactly what the generic unfiltered
// route (makeCrudRouter) returns today — same {ok, data, count} shape, same rows — so the
// existing boot-sync (pgGetCollection('hwSubmissions')) keeps working identically [Phase 3
// cutover: hwSubmissions has since left PG_COLLECTIONS; unfiltered callers: HomeworkSearch with
// no filters, exportBackup]. No frontend
// consumer is migrated by this feature, PG_COLLECTIONS is untouched, and the existing atomic
// write router is completely unmodified — this file adds no write capability at all, and does
// not intercept POST/PUT/PATCH/DELETE on /api/hwSubmissions (those keep flowing to the
// generic CRUD router exactly as before, since this router only defines the two GET routes
// below and calls next() for anything else).
//
// Aggregation design: only groupBy=status and groupBy=homework are implemented (FR-006,
// FR-007) — both are genuine SQL-side GROUP BY + COUNT (prisma.hw_submissions.groupBy), never
// a full-table findMany. No groupBy=student, no date-range filter, no threshold — none of
// these were requested for this feature (see research.md §5).
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { snakeToCamel } from '../lib/caseMapper.js';
import { serializeBigInt } from './payments.js';

const GROUP_BY_DIMENSIONS = new Set(['status', 'homework']);

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

// Present-but-empty scoping params are rejected before any lookup (FR-010); an absent key is
// simply "no filter for that dimension" (spec.md Clarifications, session 2026-09-21).
function validateScopeParam(query, key, label) {
  if (!(key in query)) return undefined;
  const value = query[key];
  if (value === undefined || value === null || value === '') {
    throw badRequest(`${label} لا يجوز أن يكون فارغاً.`);
  }
  return value;
}

function buildWhere(query) {
  const studentId = validateScopeParam(query, 'studentId', 'studentId');
  const homeworkId = validateScopeParam(query, 'homeworkId', 'homeworkId');
  const where = {};
  if (studentId) where.student_id = studentId;
  if (homeworkId) where.homework_id = homeworkId;
  return where;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function validateDateParam(query, key) {
  const value = validateScopeParam(query, key, key);
  if (value === undefined) return undefined;
  const date = typeof value === 'string' && DATE_ONLY.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw badRequest(`${key} يجب أن يكون تاريخاً بصيغة YYYY-MM-DD.`);
  }
  return date;
}

// Phase 2 (Homework global-read migration) — parent-homework scope for HomeworkSearch:
// dueFrom/dueTo/academicYear/grade filter submissions by their homework's due_date/
// academic_year/grade (a relation filter — one SQL query, never a per-homework request).
// They mirror exactly the homework-level predicates of filterHomeworkSubmissionRows
// (homeworkDate = dueDate, inclusive range). GET / only — /aggregate is unchanged.
function buildHomeworkScope(query) {
  const dueFrom = validateDateParam(query, 'dueFrom');
  const dueTo = validateDateParam(query, 'dueTo');
  const academicYear = validateScopeParam(query, 'academicYear', 'academicYear');
  const grade = validateScopeParam(query, 'grade', 'grade');
  const hw = {};
  if (dueFrom || dueTo) {
    hw.due_date = {};
    if (dueFrom) hw.due_date.gte = dueFrom;
    if (dueTo) hw.due_date.lte = dueTo;
  }
  if (academicYear) hw.academic_year = academicYear;
  if (grade) hw.grade = grade;
  return Object.keys(hw).length > 0 ? hw : undefined;
}

const router = Router();

// ── GET / — scoped list (studentId/homeworkId + parent-homework scope, composable) ────────
// No params → identical to the generic unfiltered route (boot-sync's exact current call).
router.get('/', asyncHandler(async (req, res) => {
  const where = buildWhere(req.query);
  const homeworkScope = buildHomeworkScope(req.query);
  if (homeworkScope) where.homeworks = homeworkScope;
  const rows = await prisma.hw_submissions.findMany({ where });
  const shaped = snakeToCamel(rows);
  res.json({ ok: true, data: serializeBigInt(shaped), count: shaped.length });
}));

// ── Aggregate helpers ────────────────────────────────────────────────────────────────────

// groupBy=status: real SQL-side GROUP BY + COUNT, never a full-table findMany.
async function aggregateByStatus(where) {
  const rows = await prisma.hw_submissions.groupBy({ by: ['status'], where, _count: true });
  return rows
    .map((r) => ({ key: r.status, count: r._count }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// groupBy=homework: groups by [homework_id, status] together so the response can report a
// per-status breakdown for each assignment in one query — same bucketing technique as
// attendance.js's aggregateByDimension().
async function aggregateByHomework(where) {
  const rows = await prisma.hw_submissions.groupBy({ by: ['homework_id', 'status'], where, _count: true });
  const buckets = new Map(); // homeworkId -> { total, <status>: count, ... }
  for (const r of rows) {
    const key = r.homework_id;
    if (!buckets.has(key)) buckets.set(key, { total: 0 });
    const b = buckets.get(key);
    b.total += r._count;
    b[r.status] = (b[r.status] ?? 0) + r._count;
  }
  return [...buckets.entries()]
    .map(([key, b]) => ({ key, ...b }))
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

// ── GET /aggregate ───────────────────────────────────────────────────────────────────────
// Mounted on the SAME router as GET / above, so /api/hwSubmissions/aggregate is intercepted
// here before it could ever reach the generic CRUD router's GET /:id — same technique as
// attendance.js's GET /aggregate.
router.get('/aggregate', asyncHandler(async (req, res) => {
  const { groupBy } = req.query;
  if (!GROUP_BY_DIMENSIONS.has(groupBy)) {
    throw badRequest('groupBy يجب أن يكون أحد: status, homework.');
  }
  const where = buildWhere(req.query);
  const data = groupBy === 'status' ? await aggregateByStatus(where) : await aggregateByHomework(where);
  res.json({ ok: true, data });
}));

export default router;
