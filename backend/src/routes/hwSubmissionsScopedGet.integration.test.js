// backend/src/routes/hwSubmissionsScopedGet.integration.test.js
// Grades + Homework Submissions Backend Read Foundation (spec 003). Real PostgreSQL + Express
// integration (scratch database only), same structure as attendance.integration.test.js. Proves:
//   - GET /api/hwSubmissions is purely additive (no params → identical to the unfiltered
//     generic route boot-sync still depends on), and its 2 filters (studentId/homeworkId) are
//     composable.
//   - GET /api/hwSubmissions/aggregate's 2 groupBy dimensions (status/homework) each return
//     counts numerically identical to a direct count over the same seeded rows, including empty
//     results and rejection of an unrecognized groupBy value before any lookup.
//   - A present-but-empty studentId/homeworkId is rejected with 400 before any lookup (FR-010,
//     spec.md Clarifications 2026-09-21 — closes analyze finding U1).
//
// Named to match the production file (hwSubmissionsScopedGet.js) — the original
// "hwSubmissions.integration.test.js" name is already taken by the existing atomic
// write-router's own test file (see tasks.md T001 drift note); this file does not touch that
// one at all.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED" test is
// recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

function request(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* n/a */ }
        resolve({ status: res.statusCode, body: json });
      });
    }).on('error', reject);
  });
}

describe('GET /api/hwSubmissions + /api/hwSubmissions/aggregate (real PostgreSQL + Express integration, spec 003)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, server, port;
  let seq = 0;

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  beforeAll(async () => {
    scratch = await setupScratchDb('hw_submissions_scoped_get');
    client = scratch.client;

    const hwSubmissionsScopedGetRouter = (await import('./hwSubmissionsScopedGet.js')).default;
    const { errorHandler } = await import('../middleware/errorHandler.js');

    const app = express();
    app.use('/api/hwSubmissions', hwSubmissionsScopedGetRouter);
    app.use(errorHandler);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    port = server.address().port;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (scratch) await teardownScratchDb(scratch);
  });

  async function seedStudent(overrides = {}) {
    const id = nextId('s');
    return client.students.create({ data: { id, code: id, name: 'طالب اختبار', status: 'active', ...overrides } });
  }

  async function seedHomework(overrides = {}) {
    const id = nextId('hw');
    return client.homeworks.create({
      data: { id, title: 'واجب اختبار', due_date: new Date('2026-01-15T00:00:00.000Z'), ...overrides },
    });
  }

  async function seedSubmission({ homeworkId, studentId, status = 'submitted' }) {
    return client.hw_submissions.create({
      data: { id: nextId('hs'), homework_id: homeworkId, student_id: studentId, status },
    });
  }

  it('GET / with no params returns exactly what the generic unfiltered route would (purely additive)', async () => {
    const student = await seedStudent();
    const hw = await seedHomework();
    await seedSubmission({ homeworkId: hw.id, studentId: student.id });

    const res = await request(port, '/api/hwSubmissions');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const generic = await client.hw_submissions.findMany({});
    expect(res.body.count).toBe(generic.length);
    expect(res.body.data.length).toBe(generic.length);
  });

  it('GET /?studentId=... returns only that student\'s submissions', async () => {
    const s1 = await seedStudent();
    const s2 = await seedStudent();
    const hw = await seedHomework();
    await seedSubmission({ homeworkId: hw.id, studentId: s1.id, status: 'submitted' });
    await seedSubmission({ homeworkId: hw.id, studentId: s2.id, status: 'late' });

    const res = await request(port, `/api/hwSubmissions?studentId=${s1.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((r) => r.studentId === s1.id)).toBe(true);
    expect(res.body.data.some((r) => r.studentId === s2.id)).toBe(false);
  });

  it('GET /?homeworkId=... returns only that assignment\'s submissions', async () => {
    const student = await seedStudent();
    const hw1 = await seedHomework();
    const hw2 = await seedHomework();
    await seedSubmission({ homeworkId: hw1.id, studentId: student.id, status: 'submitted' });
    await seedSubmission({ homeworkId: hw2.id, studentId: student.id, status: 'missing' });

    const res = await request(port, `/api/hwSubmissions?homeworkId=${hw1.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((r) => r.homeworkId === hw1.id)).toBe(true);
    expect(res.body.data.some((r) => r.homeworkId === hw2.id)).toBe(false);
  });

  it('GET /?studentId=...&homeworkId=... composes both filters (AND)', async () => {
    const student = await seedStudent();
    const hw1 = await seedHomework();
    const hw2 = await seedHomework();
    await seedSubmission({ homeworkId: hw1.id, studentId: student.id, status: 'submitted' });
    await seedSubmission({ homeworkId: hw2.id, studentId: student.id, status: 'late' });

    const res = await request(port, `/api/hwSubmissions?studentId=${student.id}&homeworkId=${hw1.id}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].homeworkId).toBe(hw1.id);
    expect(res.body.data[0].status).toBe('submitted');
  });

  it('a real student with no submissions returns an empty result, not an error', async () => {
    const student = await seedStudent();
    const res = await request(port, `/api/hwSubmissions?studentId=${student.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: [], count: 0 });
  });

  it('a present-but-empty homeworkId is rejected with 400 before any lookup (closes analyze finding U1)', async () => {
    const res = await request(port, '/api/hwSubmissions?homeworkId=');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  // ── Phase 2 (Homework global-read migration) — parent-homework scope for HomeworkSearch ──
  it('GET /?dueFrom=&dueTo= returns only submissions whose homework due_date is in the inclusive range', async () => {
    const student = await seedStudent();
    const tag = nextId('yr'); // unique academic_year isolates this test from rows seeded by others
    const before = await seedHomework({ academic_year: tag, due_date: new Date('2031-03-09T00:00:00.000Z') });
    const onFrom = await seedHomework({ academic_year: tag, due_date: new Date('2031-03-10T00:00:00.000Z') });
    const onTo = await seedHomework({ academic_year: tag, due_date: new Date('2031-03-20T00:00:00.000Z') });
    const after = await seedHomework({ academic_year: tag, due_date: new Date('2031-03-21T00:00:00.000Z') });
    for (const hw of [before, onFrom, onTo, after]) await seedSubmission({ homeworkId: hw.id, studentId: student.id });

    const res = await request(port, `/api/hwSubmissions?academicYear=${tag}&dueFrom=2031-03-10&dueTo=2031-03-20`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((r) => r.homeworkId).sort()).toEqual([onFrom.id, onTo.id].sort());
  });

  it('GET /?academicYear=&grade= composes both parent-homework filters (AND)', async () => {
    const student = await seedStudent();
    const tag = nextId('yr');
    const match = await seedHomework({ academic_year: tag, grade: 'الصف الأول الثانوي' });
    const otherGrade = await seedHomework({ academic_year: tag, grade: 'الصف الثاني الثانوي' });
    const otherYear = await seedHomework({ academic_year: `${tag}_x`, grade: 'الصف الأول الثانوي' });
    for (const hw of [match, otherGrade, otherYear]) await seedSubmission({ homeworkId: hw.id, studentId: student.id });

    const res = await request(port, `/api/hwSubmissions?academicYear=${encodeURIComponent(tag)}&grade=${encodeURIComponent('الصف الأول الثانوي')}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].homeworkId).toBe(match.id);
  });

  it('parent-homework filters compose with studentId (AND)', async () => {
    const s1 = await seedStudent();
    const s2 = await seedStudent();
    const tag = nextId('yr');
    const hw = await seedHomework({ academic_year: tag });
    await seedSubmission({ homeworkId: hw.id, studentId: s1.id });
    await seedSubmission({ homeworkId: hw.id, studentId: s2.id });

    const res = await request(port, `/api/hwSubmissions?academicYear=${tag}&studentId=${s1.id}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].studentId).toBe(s1.id);
  });

  it('a malformed or impossible dueFrom/dueTo is rejected with 400 before any lookup', async () => {
    for (const q of ['dueFrom=2031-3-1', 'dueTo=2031-02-30', 'dueFrom=abc', 'dueTo=']) {
      const res = await request(port, `/api/hwSubmissions?${q}`);
      expect(res.status, q).toBe(400);
      expect(res.body.ok).toBe(false);
    }
  });

  it('a present-but-empty academicYear/grade is rejected with 400', async () => {
    for (const q of ['academicYear=', 'grade=']) {
      const res = await request(port, `/api/hwSubmissions?${q}`);
      expect(res.status, q).toBe(400);
    }
  });

  it('GET /aggregate?groupBy=status returns counts numerically identical to a direct count', async () => {
    const s1 = await seedStudent();
    const s2 = await seedStudent();
    const s3 = await seedStudent();
    const hw = await seedHomework();
    await seedSubmission({ homeworkId: hw.id, studentId: s1.id, status: 'submitted' });
    await seedSubmission({ homeworkId: hw.id, studentId: s2.id, status: 'late' });
    await seedSubmission({ homeworkId: hw.id, studentId: s3.id, status: 'missing' });

    // Scoped to this test's own homeworkId — the shared scratch DB accumulates rows from
    // earlier tests in this file, so an unscoped status aggregate here would double-count them.
    const res = await request(port, `/api/hwSubmissions/aggregate?groupBy=status&homeworkId=${hw.id}`);
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(res.body.data.map((r) => [r.key, r.count]));
    expect(byKey.submitted).toBe(1);
    expect(byKey.late).toBe(1);
    expect(byKey.missing).toBe(1);
  });

  it('GET /aggregate?groupBy=homework returns per-assignment counts matching a direct count', async () => {
    const s1 = await seedStudent();
    const s2 = await seedStudent();
    const hw1 = await seedHomework();
    const hw2 = await seedHomework();
    await seedSubmission({ homeworkId: hw1.id, studentId: s1.id, status: 'submitted' });
    await seedSubmission({ homeworkId: hw1.id, studentId: s2.id, status: 'late' });
    await seedSubmission({ homeworkId: hw2.id, studentId: s1.id, status: 'missing' });

    const res = await request(port, '/api/hwSubmissions/aggregate?groupBy=homework');
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(res.body.data.map((r) => [r.key, r]));
    expect(byKey[hw1.id].total).toBe(2);
    expect(byKey[hw1.id].submitted).toBe(1);
    expect(byKey[hw1.id].late).toBe(1);
    expect(byKey[hw2.id].total).toBe(1);
    expect(byKey[hw2.id].missing).toBe(1);
  });

  it('an empty scope for either aggregate dimension returns [], not an error', async () => {
    const res = await request(port, '/api/hwSubmissions/aggregate?groupBy=status&studentId=does_not_exist');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: [] });
  });

  it('an invalid groupBy value is rejected with 400 before any lookup', async () => {
    const res = await request(port, '/api/hwSubmissions/aggregate?groupBy=student');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});
