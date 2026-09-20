// backend/src/routes/examStart.js
// ─────────────────────────────────────────────────────────────────────────────
// Exams Phase 3D — Start Exam action. Studix exams are physical/offline exams (see
// Phase 3A's architecture audit) — this endpoint only records WHEN the secretary started
// the physical exam, for an administrative countdown display. It never gates grading,
// never locks anything, and never auto-submits anything.
//
// Server sets actual_started_at from its own clock (new Date()) — the client can never
// supply or override it (the request body is never read at all; only the URL param id is
// used). Concurrency-safe first-write-wins: the UPDATE's WHERE clause only matches a row
// whose actual_started_at is still NULL, so Postgres's row-level locking on concurrent
// UPDATEs to the same row guarantees only the first request's write actually changes
// anything — any later or racing request's UPDATE matches zero rows and simply falls
// through to re-reading (and returning) whatever timestamp is now stored, which may be
// its own write or another request's. This is the same "first successful write wins,
// never reset" requirement already solved once in this codebase (grades.js's
// upsert-by-unique-key pattern), applied here via a conditional UPDATE instead.
//
// Clock limitation (see Phase 3A audit): Studix's backend and frontend run on the same
// Windows machine — there is no independently trusted external clock the way a typical
// remote server would have. "Server authoritative" here means authoritative within this
// application's architecture (the client can never inject a fabricated start time), not a
// cryptographic guarantee against local system-clock manipulation. Deliberately NOT
// implementing the license module's high-water-mark clock-rollback deterrent
// (see license.js's checkClockAndUpdateHighWaterMark) — that exists for a real
// activation/DRM stake; this timer is a non-enforcing administrative display only, so
// that complexity is disproportionate here.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  err.expose = true;
  return err;
}

// Mirrors examService.js's computeExamTimerState on the frontend exactly (no shared
// package exists between backend/ and src/ in this codebase, so this is deliberately
// duplicated, small, and kept in lockstep rather than introducing a cross-package
// abstraction for one ~6-line calculation).
function computeTimerState(actualStartedAt, durationMinutes, now = Date.now()) {
  const startMs = actualStartedAt.getTime();
  const endMs = startMs + durationMinutes * 60_000;
  const remainingSeconds = Math.max(0, Math.round((endMs - now) / 1000));
  return { remainingSeconds, phase: remainingSeconds > 0 ? 'in_progress' : 'time_finished' };
}

// يُصدَّر منفصلاً عن الـ router ليكون قابلاً للاختبار مباشرة بلا HTTP/auth.
export async function startExam(examId) {
  if (typeof examId !== 'string' || !examId.trim()) throw notFound('الامتحان غير موجود.');

  const exam = await prisma.exams.findUnique({
    where: { id: examId },
    select: { id: true, duration_minutes: true, actual_started_at: true },
  });
  if (!exam) throw notFound('الامتحان غير موجود.');

  if (!Number.isInteger(exam.duration_minutes) || exam.duration_minutes <= 0) {
    throw badRequest('لا يمكن بدء الامتحان بلا مدة صالحة (duration_minutes).');
  }

  if (!exam.actual_started_at) {
    // Conditional, concurrency-safe write — see file header for the full reasoning.
    await prisma.exams.updateMany({
      where: { id: examId, actual_started_at: null },
      data: { actual_started_at: new Date() },
    });
  }

  const fresh = await prisma.exams.findUnique({
    where: { id: examId },
    select: { actual_started_at: true, duration_minutes: true },
  });

  const { remainingSeconds, phase } = computeTimerState(fresh.actual_started_at, fresh.duration_minutes);

  return {
    examId,
    actualStartedAt: fresh.actual_started_at.toISOString(),
    durationMinutes: fresh.duration_minutes,
    remainingSeconds,
    phase,
  };
}

const router = Router();

// POST /api/exams/:id/start — بدء الامتحان (أو استرجاع وقت البدء الموجود فعلاً إن كان قد
// بدأ بالفعل) — لا يقرأ req.body إطلاقاً، actual_started_at من ساعة الخادم فقط دائماً.
router.post('/:id/start', asyncHandler(async (req, res) => {
  const data = await startExam(req.params.id);
  res.json({ ok: true, data });
}));

export default router;
