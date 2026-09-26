// backend/src/routes/grades.js
// ─────────────────────────────────────────────────────────────────────────────
// Grades + Homework Submissions Backend Read Foundation (spec 003) — backend-only,
// additive. One dedicated, read-only route mounted BEFORE the generic dynamic CRUD loop
// (same pattern as backend/src/routes/attendance.js):
//   - GET /api/grades — scoped list (studentId/examId, composable)
//
// Purely additive: with no query params, GET / returns exactly what the generic unfiltered
// route (makeCrudRouter) returns today — same {ok, data, count} shape, same rows — so the
// existing boot-sync (pgGetCollection('grades')) keeps working identically [Phase 3 cutover:
// grades has since left PG_COLLECTIONS; the unfiltered caller is now exportBackup]. No frontend
// consumer is migrated by this feature, PG_COLLECTIONS is untouched, and examGrades.js's
// write path (PUT /api/exam-grades/:examId) is completely unmodified — this file adds no
// write capability at all, and does not intercept POST/PUT/PATCH/DELETE on /api/grades
// (those keep flowing to the generic CRUD router exactly as before, since this router only
// defines GET / and calls next() for anything else).
//
// Phase 1C (Grades global-read migration) — GET /aggregate?groupBy=none|student|exam adds the
// "Grades Batch B" aggregate deferred above (FR-012): joining grades.score against exams.total
// server-side (raw SQL — Prisma's groupBy cannot express a per-row ratio against a joined
// table), so ExamReports/ExamsPage/ReportsPage never need to fetch the full grades table to
// compute a ranking/average/pass-rate. Mounted on this SAME router (same technique as
// hwSubmissionsScopedGet.js's GET /aggregate), so it inherits the exact same
// requireAuth/requirePermission('exams') middleware as GET / above — no separate wiring.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { snakeToCamel } from '../lib/caseMapper.js';
import { serializeBigInt } from './payments.js';

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

const router = Router();

// ── GET / — scoped list (studentId/examId, composable) ──────────────────────────────────
// No params → identical to the generic unfiltered route (boot-sync's exact current call).
router.get('/', asyncHandler(async (req, res) => {
  const studentId = validateScopeParam(req.query, 'studentId', 'studentId');
  const examId = validateScopeParam(req.query, 'examId', 'examId');

  const where = {};
  if (studentId) where.student_id = studentId;
  if (examId) where.exam_id = examId;

  const rows = await prisma.grades.findMany({ where });
  const shaped = snakeToCamel(rows);
  res.json({ ok: true, data: serializeBigInt(shaped), count: shaped.length });
}));

// ── Aggregate helpers (groupBy=none|student|exam) ────────────────────────────────────────
const GROUP_BY_DIMENSIONS = new Set(['none', 'student', 'exam']);

function scopeSql(studentId, examId) {
  const studentClause = studentId ? Prisma.sql`AND g.student_id = ${studentId}` : Prisma.empty;
  const examClause = examId ? Prisma.sql`AND g.exam_id = ${examId}` : Prisma.empty;
  return Prisma.sql`${studentClause} ${examClause}`;
}

// groupBy=none: a single-row overall average — ExamsPage's KPI card and ReportsPage's
// "avgExamPct" both need exactly this number (mean of score/exam.total*100 across every
// non-absent, scored grade), not the full row set.
async function aggregateNone(studentId, examId) {
  const rows = await prisma.$queryRaw`
    SELECT
      ROUND(AVG(g.score::numeric / e.total::numeric * 100))::int AS avg_pct,
      COUNT(*)::int AS count
    FROM grades g
    JOIN exams e ON e.id = g.exam_id
    WHERE NOT g.absent AND g.score IS NOT NULL
    ${scopeSql(studentId, examId)}
  `;
  const r = rows[0];
  return [{ avgPct: r.count > 0 ? r.avg_pct : null, count: r.count }];
}

// groupBy=student: one row per student — powers getTopStudents/getWeakStudents (rank/filter
// client-side against the students already held in the store) and RankingTable's optional
// single-exam filter (examId scopes both the average and the fail count to that one exam).
async function aggregateByStudent(studentId, examId) {
  const rows = await prisma.$queryRaw`
    SELECT
      g.student_id AS key,
      ROUND(AVG(g.score::numeric / e.total::numeric * 100))::int AS avg_pct,
      COUNT(*)::int AS exam_count,
      COUNT(*) FILTER (WHERE g.score < e.pass)::int AS fail_count
    FROM grades g
    JOIN exams e ON e.id = g.exam_id
    WHERE NOT g.absent AND g.score IS NOT NULL
    ${scopeSql(studentId, examId)}
    GROUP BY g.student_id
  `;
  return rows.map((r) => ({ key: r.key, avgPct: r.avg_pct, examCount: r.exam_count, failCount: r.fail_count }));
}

// groupBy=exam: one row per exam — powers ExamsPage's per-card stats (one request for every
// currently-displayed exam, instead of one GET /api/grades?examId= per card). absent is
// counted via a FILTER (not the same WHERE-excluded rows as count/avg/highest/lowest/passed/
// failed), matching getExamStatsWithPass's own separate `allGrades.filter(g=>g.absent)`.
async function aggregateByExam(studentId, examId) {
  const rows = await prisma.$queryRaw`
    SELECT
      g.exam_id AS key,
      COUNT(*) FILTER (WHERE NOT g.absent AND g.score IS NOT NULL)::int AS count,
      ROUND(AVG(g.score) FILTER (WHERE NOT g.absent AND g.score IS NOT NULL))::int AS avg,
      MAX(g.score) FILTER (WHERE NOT g.absent AND g.score IS NOT NULL)::int AS highest,
      MIN(g.score) FILTER (WHERE NOT g.absent AND g.score IS NOT NULL)::int AS lowest,
      COUNT(*) FILTER (WHERE NOT g.absent AND g.score IS NOT NULL AND g.score >= e.pass)::int AS passed,
      COUNT(*) FILTER (WHERE NOT g.absent AND g.score IS NOT NULL AND g.score < e.pass)::int AS failed,
      COUNT(*) FILTER (WHERE g.absent)::int AS absent
    FROM grades g
    JOIN exams e ON e.id = g.exam_id
    WHERE 1=1
    ${scopeSql(studentId, examId)}
    GROUP BY g.exam_id
  `;
  return rows
    .filter((r) => r.count > 0 || r.absent > 0)
    .map((r) => ({
      key: r.key,
      count: r.count,
      avg: r.avg,
      highest: r.highest,
      lowest: r.lowest,
      passed: r.passed,
      failed: r.failed,
      passRate: r.count > 0 ? Math.round((r.passed / r.count) * 100) : null,
      absent: r.absent,
    }));
}

// ── GET /aggregate ───────────────────────────────────────────────────────────────────────
// Mounted on the SAME router as GET / above, so /api/grades/aggregate is intercepted here
// before it could ever reach the generic CRUD router's GET /:id — same technique as
// hwSubmissionsScopedGet.js's GET /aggregate.
router.get('/aggregate', asyncHandler(async (req, res) => {
  const { groupBy } = req.query;
  if (!GROUP_BY_DIMENSIONS.has(groupBy)) {
    throw badRequest('groupBy يجب أن يكون أحد: none, student, exam.');
  }
  const studentId = validateScopeParam(req.query, 'studentId', 'studentId');
  const examId = validateScopeParam(req.query, 'examId', 'examId');

  const data = groupBy === 'none' ? await aggregateNone(studentId, examId)
    : groupBy === 'student' ? await aggregateByStudent(studentId, examId)
    : await aggregateByExam(studentId, examId);
  res.json({ ok: true, data });
}));

export default router;
