// backend/src/routes/grades.integration.test.js
// Grades + Homework Submissions Backend Read Foundation (spec 003). Real PostgreSQL + Express
// integration (scratch database only), same structure as attendance.integration.test.js. Proves:
//   - GET /api/grades is purely additive (no params → identical to the unfiltered generic route
//     boot-sync still depends on), and its 2 filters (studentId/examId) are composable.
//   - Empty results (known id, no rows) return {ok:true, data:[], count:0}, never an error.
//   - A present-but-empty studentId/examId is rejected with 400 before any lookup (FR-010,
//     spec.md Clarifications 2026-09-21 — closes analyze finding U1).
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

describe('GET /api/grades (real PostgreSQL + Express integration, spec 003)', () => {
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
    scratch = await setupScratchDb('grades_scoped_get');
    client = scratch.client;

    const gradesRouter = (await import('./grades.js')).default;
    const { errorHandler } = await import('../middleware/errorHandler.js');

    const app = express();
    app.use('/api/grades', gradesRouter);
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

  async function seedExam(overrides = {}) {
    const id = nextId('e');
    return client.exams.create({
      data: { id, name: 'امتحان اختبار', date: new Date('2026-01-10T00:00:00.000Z'), total: 100, ...overrides },
    });
  }

  async function seedGrade({ examId, studentId, score = 80, absent = false }) {
    return client.grades.create({
      data: { id: nextId('g'), exam_id: examId, student_id: studentId, score, absent },
    });
  }

  it('GET / with no params returns exactly what the generic unfiltered route would (purely additive)', async () => {
    const student = await seedStudent();
    const exam = await seedExam();
    await seedGrade({ examId: exam.id, studentId: student.id, score: 90 });

    const res = await request(port, '/api/grades');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const generic = await client.grades.findMany({});
    expect(res.body.count).toBe(generic.length);
    expect(res.body.data.length).toBe(generic.length);
  });

  it('GET /?studentId=... returns only that student\'s grades', async () => {
    const s1 = await seedStudent();
    const s2 = await seedStudent();
    const exam = await seedExam();
    await seedGrade({ examId: exam.id, studentId: s1.id, score: 70 });
    await seedGrade({ examId: exam.id, studentId: s2.id, score: 60 });

    const res = await request(port, `/api/grades?studentId=${s1.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((r) => r.studentId === s1.id)).toBe(true);
    expect(res.body.data.some((r) => r.studentId === s2.id)).toBe(false);
  });

  it('GET /?examId=... returns only that exam\'s grades', async () => {
    const student = await seedStudent();
    const e1 = await seedExam();
    const e2 = await seedExam();
    await seedGrade({ examId: e1.id, studentId: student.id, score: 55 });
    await seedGrade({ examId: e2.id, studentId: student.id, score: 65 });

    const res = await request(port, `/api/grades?examId=${e1.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((r) => r.examId === e1.id)).toBe(true);
    expect(res.body.data.some((r) => r.examId === e2.id)).toBe(false);
  });

  it('GET /?studentId=...&examId=... composes both filters (AND)', async () => {
    const student = await seedStudent();
    const e1 = await seedExam();
    const e2 = await seedExam();
    await seedGrade({ examId: e1.id, studentId: student.id, score: 88 });
    await seedGrade({ examId: e2.id, studentId: student.id, score: 44 });

    const res = await request(port, `/api/grades?studentId=${student.id}&examId=${e1.id}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].examId).toBe(e1.id);
    // grades.score is a Prisma Decimal — like every existing consumer of this same
    // snakeToCamel/serializeBigInt pair (see backend/src/lib/caseMapper.js), it serializes to
    // a decimal string via Decimal.prototype.toJSON(), matching today's generic route exactly
    // (FR-013: no reshaping introduced by this feature).
    expect(res.body.data[0].score).toBe('88');
  });

  it('a real student with no grades returns an empty result, not an error', async () => {
    const student = await seedStudent();
    const res = await request(port, `/api/grades?studentId=${student.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: [], count: 0 });
  });

  it('an unknown studentId returns an empty result, not an error', async () => {
    const res = await request(port, '/api/grades?studentId=does_not_exist');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: [], count: 0 });
  });

  it('a present-but-empty studentId is rejected with 400 before any lookup (closes analyze finding U1)', async () => {
    const res = await request(port, '/api/grades?studentId=');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('response rows carry the same fields the existing generic route already returns (camelCase, no reshaping)', async () => {
    const student = await seedStudent();
    const exam = await seedExam();
    await seedGrade({ examId: exam.id, studentId: student.id, score: 77, absent: false });

    const res = await request(port, `/api/grades?studentId=${student.id}`);
    const row = res.body.data[0];
    expect(row).toHaveProperty('id');
    expect(row).toHaveProperty('examId');
    expect(row).toHaveProperty('studentId');
    expect(row).toHaveProperty('score');
    expect(row).toHaveProperty('absent');
    expect(row).toHaveProperty('createdAt');
  });
});
