// backend/src/routes/hwSubmissions.integration.test.js
// Homework 2.0 Phase 2 — saveHwSubmissions now validates every record's studentId before
// persisting: the student must be active AND student.grade === homework.grade (never Group
// membership). Invalid students reject the WHOLE save atomically (matches this function's
// existing all-or-nothing upsert/delete transaction). Existing submission/grading behavior
// (score bounds, status enum, upsert-by-unique-key, replace-only-this-homework's-records)
// is preserved and re-verified here as regression.
//
// Real PostgreSQL integration (scratch database), same pattern as
// attendanceSessions.integration.test.js — saveHwSubmissions called directly, no HTTP/auth.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('routes/hwSubmissions.js — grade-based eligibility validation (Homework 2.0, real PostgreSQL)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, saveHwSubmissions;
  let seq = 0;

  const GRADE_6 = 'الصف السادس الابتدائي';
  const GRADE_7 = 'الصف الأول الإعدادي';

  beforeAll(async () => {
    scratch = await setupScratchDb('hw_submissions_eligibility');
    client = scratch.client;
    ({ saveHwSubmissions } = await import('./hwSubmissions.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  async function seedHomework(overrides = {}) {
    const id = nextId('hw');
    return client.homeworks.create({
      data: { id, title: 'واجب', grade: GRADE_6, due_date: new Date('2026-02-01'), total_score: 10, ...overrides },
    });
  }

  async function seedStudent(overrides = {}) {
    const id = nextId('s');
    return client.students.create({ data: { id, code: id, name: 'طالب', status: 'active', grade: GRADE_6, ...overrides } });
  }

  it('succeeds for a matching-grade active student (regression: normal save still works)', async () => {
    const hw = await seedHomework();
    const student = await seedStudent();

    const result = await saveHwSubmissions({ homeworkId: hw.id, records: [{ studentId: student.id, status: 'submitted', score: 8 }] });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].studentId).toBe(student.id);
    expect(result.records[0].score).toBe(8);
  });

  it('rejects a wrong-grade student, and persists nothing', async () => {
    const hw = await seedHomework({ grade: GRADE_6 });
    const student = await seedStudent({ grade: GRADE_7 });

    await expect(saveHwSubmissions({ homeworkId: hw.id, records: [{ studentId: student.id, status: 'submitted' }] }))
      .rejects.toThrow();

    const rows = await client.hw_submissions.findMany({ where: { homework_id: hw.id } });
    expect(rows).toHaveLength(0);
  });

  it('rejects an inactive student even with the matching grade, and persists nothing', async () => {
    const hw = await seedHomework();
    const student = await seedStudent({ status: 'inactive' });

    await expect(saveHwSubmissions({ homeworkId: hw.id, records: [{ studentId: student.id, status: 'submitted' }] }))
      .rejects.toThrow();

    const rows = await client.hw_submissions.findMany({ where: { homework_id: hw.id } });
    expect(rows).toHaveLength(0);
  });

  it('rejects a nonexistent studentId, and persists nothing', async () => {
    const hw = await seedHomework();

    await expect(saveHwSubmissions({ homeworkId: hw.id, records: [{ studentId: 'no-such-student', status: 'submitted' }] }))
      .rejects.toThrow();

    const rows = await client.hw_submissions.findMany({ where: { homework_id: hw.id } });
    expect(rows).toHaveLength(0);
  });

  it('rejects the WHOLE save (atomic) when one of several students is invalid — the valid one is not partially saved either', async () => {
    const hw = await seedHomework();
    const validStudent = await seedStudent();
    const invalidStudent = await seedStudent({ grade: GRADE_7 });

    await expect(saveHwSubmissions({
      homeworkId: hw.id,
      records: [
        { studentId: validStudent.id, status: 'submitted' },
        { studentId: invalidStudent.id, status: 'submitted' },
      ],
    })).rejects.toThrow();

    const rows = await client.hw_submissions.findMany({ where: { homework_id: hw.id } });
    expect(rows).toHaveLength(0);
  });

  it('a homework with no grade set (legacy/edge case) does not block submissions — grade check is skipped, status/active still enforced', async () => {
    const hw = await seedHomework({ grade: null });
    const activeStudent = await seedStudent();
    const inactiveStudent = await seedStudent({ status: 'inactive' });

    const result = await saveHwSubmissions({ homeworkId: hw.id, records: [{ studentId: activeStudent.id, status: 'submitted' }] });
    expect(result.records).toHaveLength(1);

    await expect(saveHwSubmissions({ homeworkId: hw.id, records: [{ studentId: inactiveStudent.id, status: 'submitted' }] }))
      .rejects.toThrow();
  });

  // ── Regression — existing behavior preserved exactly ─────────────────────────────────
  it('regression: existing submissions are preserved when re-saving with the same valid roster (upsert-by-unique-key)', async () => {
    const hw = await seedHomework();
    const student = await seedStudent();
    const first = await saveHwSubmissions({ homeworkId: hw.id, records: [{ studentId: student.id, status: 'missing' }] });
    const firstId = first.records[0].id;

    const second = await saveHwSubmissions({ homeworkId: hw.id, records: [{ studentId: student.id, status: 'submitted', score: 7 }] });

    expect(second.records).toHaveLength(1);
    expect(second.records[0].id).toBe(firstId); // same row, upserted — not a new insert
    expect(second.records[0].status).toBe('submitted');
    expect(second.records[0].score).toBe(7);
  });

  it('regression: replaces only this homework\'s submissions — an unrelated homework\'s submissions survive untouched', async () => {
    const hw1 = await seedHomework();
    const hw2 = await seedHomework();
    const student = await seedStudent();
    await saveHwSubmissions({ homeworkId: hw1.id, records: [{ studentId: student.id, status: 'submitted' }] });
    await saveHwSubmissions({ homeworkId: hw2.id, records: [{ studentId: student.id, status: 'submitted' }] });

    await saveHwSubmissions({ homeworkId: hw1.id, records: [] }); // clears hw1's roster entirely

    const hw1Rows = await client.hw_submissions.findMany({ where: { homework_id: hw1.id } });
    const hw2Rows = await client.hw_submissions.findMany({ where: { homework_id: hw2.id } });
    expect(hw1Rows).toHaveLength(0);
    expect(hw2Rows).toHaveLength(1); // untouched
  });

  it('regression: score above the homework\'s total_score is still rejected', async () => {
    const hw = await seedHomework({ total_score: 10 });
    const student = await seedStudent();

    await expect(saveHwSubmissions({ homeworkId: hw.id, records: [{ studentId: student.id, status: 'submitted', score: 15 }] }))
      .rejects.toThrow();
  });

  it('regression: an invalid status value is still rejected', async () => {
    const hw = await seedHomework();
    const student = await seedStudent();

    await expect(saveHwSubmissions({ homeworkId: hw.id, records: [{ studentId: student.id, status: 'graded' }] }))
      .rejects.toThrow();
  });
});
