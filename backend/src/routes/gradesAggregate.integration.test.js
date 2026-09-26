// backend/src/routes/gradesAggregate.integration.test.js
// Phase 1C (Grades global-read migration) — GET /api/grades/aggregate?groupBy=none|student|exam.
// Real PostgreSQL + Express integration (scratch database only), same structure/harness as
// grades.integration.test.js. Server-side aggregation (JOIN grades+exams, GROUP BY) so the
// frontend's ranking/weak-students/exam-stats views never fetch the full grades table just to
// compute an average — see specs/004-.../research.md FR-012 "Grades Batch B" deferral, now
// implemented.
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

describe('GET /api/grades/aggregate (real PostgreSQL + Express integration, Phase 1C)', () => {
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
    scratch = await setupScratchDb('grades_aggregate');
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
      data: { id, name: 'امتحان اختبار', date: new Date('2026-01-10T00:00:00.000Z'), total: 100, pass: 50, ...overrides },
    });
  }

  async function seedGrade({ examId, studentId, score = 80, absent = false }) {
    return client.grades.create({
      data: { id: nextId('g'), exam_id: examId, student_id: studentId, score, absent },
    });
  }

  it('rejects an unknown groupBy with 400', async () => {
    const res = await request(port, '/api/grades/aggregate?groupBy=bogus');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('requires groupBy', async () => {
    const res = await request(port, '/api/grades/aggregate');
    expect(res.status).toBe(400);
  });

  // Runs before any other test in this file seeds a grade row — the unfiltered groupBy=none
  // aggregate spans the whole scratch table (that's the real ExamsPage/ReportsPage usage: no
  // studentId/examId filter), so this is the one case that genuinely needs an empty table,
  // unlike every other test below which scopes by studentId/examId for isolation instead.
  it('with no matching rows returns avgPct null, count 0 (not an error)', async () => {
    const res = await request(port, '/api/grades/aggregate?groupBy=none');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ avgPct: null, count: 0 }]);
  });

  describe('groupBy=none — overall average percentage across all valid grades', () => {
    it('computes avgPct as the mean of (score/exam.total*100) across every non-absent, scored grade for a given exam', async () => {
      const s1 = await seedStudent();
      const s2 = await seedStudent();
      const e = await seedExam({ total: 100 });
      await seedGrade({ examId: e.id, studentId: s1.id, score: 80 }); // 80%
      await seedGrade({ examId: e.id, studentId: s2.id, score: 50 }); // 50%

      const res = await request(port, `/api/grades/aggregate?groupBy=none&examId=${e.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ avgPct: 65, count: 2 }]); // (80+50)/2, rounded
    });

    it('excludes absent and null-score rows', async () => {
      const s1 = await seedStudent();
      const s2 = await seedStudent();
      const e = await seedExam({ total: 100 });
      await seedGrade({ examId: e.id, studentId: s1.id, score: 90 });
      await seedGrade({ examId: e.id, studentId: s2.id, score: null, absent: true });

      const res = await request(port, `/api/grades/aggregate?groupBy=none&examId=${e.id}`);
      expect(res.body.data[0].count).toBe(1);
      expect(res.body.data[0].avgPct).toBe(90);
    });
  });

  describe('groupBy=student — per-student average percentage, exam count, fail count', () => {
    it('returns one row per student with grades, keyed by studentId', async () => {
      const s1 = await seedStudent();
      const s2 = await seedStudent();
      const e = await seedExam({ total: 100, pass: 50 });
      await seedGrade({ examId: e.id, studentId: s1.id, score: 90 });
      await seedGrade({ examId: e.id, studentId: s2.id, score: 30 });

      const res = await request(port, '/api/grades/aggregate?groupBy=student');
      expect(res.status).toBe(200);
      const byKey = Object.fromEntries(res.body.data.map(r => [r.key, r]));
      expect(byKey[s1.id]).toMatchObject({ avgPct: 90, examCount: 1, failCount: 0 });
      expect(byKey[s2.id]).toMatchObject({ avgPct: 30, examCount: 1, failCount: 1 });
    });

    it('averages across multiple exams for the same student', async () => {
      const s = await seedStudent();
      const e1 = await seedExam({ total: 100 });
      const e2 = await seedExam({ total: 100 });
      await seedGrade({ examId: e1.id, studentId: s.id, score: 100 });
      await seedGrade({ examId: e2.id, studentId: s.id, score: 60 });

      const res = await request(port, '/api/grades/aggregate?groupBy=student');
      const row = res.body.data.find(r => r.key === s.id);
      expect(row.avgPct).toBe(80);
      expect(row.examCount).toBe(2);
    });

    it('filters to a single exam when examId is passed (RankingTable filterExam use-case)', async () => {
      const s = await seedStudent();
      const e1 = await seedExam({ total: 100 });
      const e2 = await seedExam({ total: 100 });
      await seedGrade({ examId: e1.id, studentId: s.id, score: 40 });
      await seedGrade({ examId: e2.id, studentId: s.id, score: 90 });

      const res = await request(port, `/api/grades/aggregate?groupBy=student&examId=${e1.id}`);
      const row = res.body.data.find(r => r.key === s.id);
      expect(row.avgPct).toBe(40);
      expect(row.examCount).toBe(1);
    });

    it('a present-but-empty examId is rejected with 400', async () => {
      const res = await request(port, '/api/grades/aggregate?groupBy=student&examId=');
      expect(res.status).toBe(400);
    });
  });

  describe('groupBy=exam — per-exam stats (count/avg/highest/lowest/passed/failed/passRate/absent)', () => {
    it('computes stats for one exam, matching getExamStatsWithPass semantics', async () => {
      const s1 = await seedStudent();
      const s2 = await seedStudent();
      const s3 = await seedStudent();
      const exam = await seedExam({ total: 100, pass: 50 });
      await seedGrade({ examId: exam.id, studentId: s1.id, score: 90 });
      await seedGrade({ examId: exam.id, studentId: s2.id, score: 30 });
      await seedGrade({ examId: exam.id, studentId: s3.id, score: null, absent: true });

      const res = await request(port, `/api/grades/aggregate?groupBy=exam&examId=${exam.id}`);
      expect(res.status).toBe(200);
      const row = res.body.data.find(r => r.key === exam.id);
      expect(row).toMatchObject({
        count: 2, avg: 60, highest: 90, lowest: 30, passed: 1, failed: 1, passRate: 50, absent: 1,
      });
    });

    it('covers multiple exams in one request (no N+1 for the exam-card grid)', async () => {
      const s = await seedStudent();
      const e1 = await seedExam({ total: 100, pass: 50 });
      const e2 = await seedExam({ total: 100, pass: 50 });
      await seedGrade({ examId: e1.id, studentId: s.id, score: 70 });
      await seedGrade({ examId: e2.id, studentId: s.id, score: 20 });

      const res = await request(port, '/api/grades/aggregate?groupBy=exam');
      const byKey = Object.fromEntries(res.body.data.map(r => [r.key, r]));
      expect(byKey[e1.id].passed).toBe(1);
      expect(byKey[e2.id].failed).toBe(1);
    });

    it('an exam with no grades yet is simply absent from the response (count 0 implied)', async () => {
      const exam = await seedExam();
      const res = await request(port, `/api/grades/aggregate?groupBy=exam&examId=${exam.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });
});
