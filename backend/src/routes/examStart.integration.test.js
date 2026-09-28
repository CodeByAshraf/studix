// backend/src/routes/examStart.integration.test.js
// Exams Phase 3D — Start Exam action. actual_started_at is set exclusively by the server
// clock, only once, and is concurrency-safe (first successful write wins; later/racing
// Start requests preserve it, never reset it). remainingSeconds/phase are computed fresh
// on every call, never stored. An exam without a valid duration_minutes cannot be started.
//
// Real PostgreSQL integration (scratch database), same pattern as
// examGrades.integration.test.js / examScheduling.integration.test.js.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('routes/examStart.js — Start Exam action (Exams Phase 3D, real PostgreSQL)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, startExam, examsCrud;
  let seq = 0;

  const GRADE_6 = 'الصف السادس الابتدائي';

  beforeAll(async () => {
    scratch = await setupScratchDb('exam_start');
    client = scratch.client;
    ({ startExam } = await import('./examStart.js'));
    // The generic /api/exams router exactly as server.js mounts it (writable, exams policy).
    const { makeCrudRouter } = await import('./crud.js');
    const { CRUD_POLICIES } = await import('./crudPolicies.js');
    examsCrud = makeCrudRouter('exams', { writable: true, policy: CRUD_POLICIES.exams });
  }, 60_000);

  function callCrud(method, url, body) {
    return new Promise((resolve, reject) => {
      const req = { method, url, headers: {}, body };
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json(b) { resolve({ statusCode: this.statusCode, body: b }); return this; },
      };
      examsCrud.handle(req, res, (err) => (err ? reject(err) : reject(new Error('no route matched'))));
    });
  }

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  async function seedExam(overrides = {}) {
    const id = nextId('e');
    return client.exams.create({
      data: { id, name: 'امتحان', grade: GRADE_6, date: new Date('2026-03-10'), total: 100, pass: 50, duration_minutes: 60, ...overrides },
    });
  }

  it('starts an exam successfully and returns a fresh actual_started_at, matching duration_minutes and a full remainingSeconds', async () => {
    const before = Date.now();
    const exam = await seedExam();

    const result = await startExam(exam.id);

    expect(result.examId).toBe(exam.id);
    expect(new Date(result.actualStartedAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(result.durationMinutes).toBe(60);
    expect(result.phase).toBe('in_progress');
    expect(result.remainingSeconds).toBeGreaterThan(60 * 60 - 5); // within 5s of the full 60 minutes
    expect(result.remainingSeconds).toBeLessThanOrEqual(60 * 60);
  });

  it('actual_started_at is genuinely persisted server-side (visible on a fresh read, not just the response)', async () => {
    const exam = await seedExam();
    await startExam(exam.id);

    const reread = await client.exams.findUnique({ where: { id: exam.id } });
    expect(reread.actual_started_at).not.toBeNull();
  });

  it('the client can never supply/override actual_started_at — the function only ever accepts an examId, nothing else', async () => {
    const exam = await seedExam();
    // startExam's signature is (examId) — there is no second parameter through which a
    // caller could inject a timestamp; calling it with extra arguments has no effect.
    const result = await startExam(exam.id, { actualStartedAt: '2000-01-01T00:00:00.000Z' });
    expect(new Date(result.actualStartedAt).getFullYear()).not.toBe(2000);
  });

  it('a second Start does not change the original timestamp', async () => {
    const exam = await seedExam();
    const first = await startExam(exam.id);
    await new Promise((r) => globalThis.setTimeout(r, 20));
    const second = await startExam(exam.id);
    expect(second.actualStartedAt).toBe(first.actualStartedAt);
  });

  it('concurrent/duplicate Start requests all resolve to the exact same first-written timestamp', async () => {
    const exam = await seedExam();
    const [r1, r2, r3] = await Promise.all([startExam(exam.id), startExam(exam.id), startExam(exam.id)]);
    expect(r2.actualStartedAt).toBe(r1.actualStartedAt);
    expect(r3.actualStartedAt).toBe(r1.actualStartedAt);
  });

  it('rejects starting an exam with no duration_minutes set', async () => {
    const exam = await seedExam({ duration_minutes: null });
    await expect(startExam(exam.id)).rejects.toThrow();

    const reread = await client.exams.findUnique({ where: { id: exam.id } });
    expect(reread.actual_started_at).toBeNull(); // rejection persists nothing
  });

  it('rejects starting a nonexistent exam', async () => {
    await expect(startExam('no-such-exam')).rejects.toThrow();
  });

  it('an exam whose (already-started) time has fully elapsed reports zero remainingSeconds and phase "time_finished"', async () => {
    const exam = await seedExam({ duration_minutes: 30, actual_started_at: new Date(Date.now() - 2 * 60 * 60 * 1000) }); // started 2h ago

    const result = await startExam(exam.id); // idempotent path — already started, just recomputes

    expect(result.remainingSeconds).toBe(0);
    expect(result.phase).toBe('time_finished');
    // the original (2h-ago) timestamp is preserved, not reset by this idempotent call
    expect(result.actualStartedAt).toBe(exam.actual_started_at.toISOString());
  });

  it('a historical exam with no scheduling data at all is untouched by this endpoint and stays fully valid', async () => {
    const exam = await seedExam({ duration_minutes: null, scheduled_time: null });
    await expect(startExam(exam.id)).rejects.toThrow();

    const reread = await client.exams.findUnique({ where: { id: exam.id } });
    expect(reread).toMatchObject({ id: exam.id, duration_minutes: null, scheduled_time: null, actual_started_at: null });
  });

  // ── The start time is writable ONLY through /start — never through the generic CRUD ──────
  it('a generic PUT cannot change an existing actual_started_at (400, stored value unchanged)', async () => {
    const exam = await seedExam();
    const started = await startExam(exam.id);

    await expect(callCrud('PUT', `/${exam.id}`, { actualStartedAt: '2020-01-01T00:00:00.000Z' }))
      .rejects.toMatchObject({ status: 400 });

    const reread = await client.exams.findUnique({ where: { id: exam.id } });
    expect(reread.actual_started_at.toISOString()).toBe(started.actualStartedAt);
  });

  it('a generic PUT cannot clear actual_started_at with null (400, stored value unchanged)', async () => {
    const exam = await seedExam();
    const started = await startExam(exam.id);

    await expect(callCrud('PUT', `/${exam.id}`, { actualStartedAt: null }))
      .rejects.toMatchObject({ status: 400 });

    const reread = await client.exams.findUnique({ where: { id: exam.id } });
    expect(reread.actual_started_at.toISOString()).toBe(started.actualStartedAt);
  });

  it('a generic POST cannot create an exam with a start time (400, nothing inserted)', async () => {
    const name = nextId('امتحان مرفوض');
    await expect(callCrud('POST', '/', {
      name, grade: GRADE_6, date: '2026-03-10T00:00:00.000Z', total: 100, pass: 50, durationMinutes: 60,
      actualStartedAt: '2020-01-01T00:00:00.000Z',
    })).rejects.toMatchObject({ status: 400 });

    expect(await client.exams.count({ where: { name } })).toBe(0);
  });

  it('a normal generic edit without the field still works and keeps the start time', async () => {
    const exam = await seedExam();
    const started = await startExam(exam.id);

    const res = await callCrud('PUT', `/${exam.id}`, { name: 'اسم معدَّل', durationMinutes: 90 });
    expect(res.statusCode).toBe(200);

    const reread = await client.exams.findUnique({ where: { id: exam.id } });
    expect(reread).toMatchObject({ name: 'اسم معدَّل', duration_minutes: 90 });
    expect(reread.actual_started_at.toISOString()).toBe(started.actualStartedAt);
  });

  it('/start still establishes the start time normally after refused generic attempts (server clock, first start wins)', async () => {
    const exam = await seedExam();
    await expect(callCrud('PUT', `/${exam.id}`, { actualStartedAt: '2020-01-01T00:00:00.000Z' }))
      .rejects.toMatchObject({ status: 400 });
    expect((await client.exams.findUnique({ where: { id: exam.id } })).actual_started_at).toBeNull();

    const before = Date.now();
    const first = await startExam(exam.id);
    const startedMs = new Date(first.actualStartedAt).getTime();
    expect(startedMs).toBeGreaterThanOrEqual(before - 1000);
    expect(startedMs).toBeLessThanOrEqual(Date.now() + 1000);
    expect(first.phase).toBe('in_progress');

    const second = await startExam(exam.id);
    expect(second.actualStartedAt).toBe(first.actualStartedAt);
  });
});
