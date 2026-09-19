// backend/src/routes/examGrades.integration.test.js
// Exams Phase 2 — saveExamGrades now validates every record's studentId before persisting:
// the student must be active AND student.grade === exam.grade (never Group membership).
// Invalid students reject the WHOLE save atomically (matches this function's existing
// all-or-nothing upsert/delete transaction). Existing grading behavior (score bounds,
// upsert-by-unique-key, replace-only-this-exam's-records) is preserved and re-verified here
// as regression. Mirrors hwSubmissions.integration.test.js exactly.
//
// Real PostgreSQL integration (scratch database), same pattern as
// hwSubmissions.integration.test.js — saveExamGrades called directly, no HTTP/auth.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
//
// Before this file, saveExamGrades had NO dedicated business-logic test coverage — only one
// incidental assertion inside cryptoGlobalIndependence.integration.test.js (a UUID
// independence test, not a grades-business-logic test). This file replaces that gap.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('routes/examGrades.js — grade-based eligibility validation (Exams Phase 2, real PostgreSQL)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, saveExamGrades;
  let seq = 0;

  const GRADE_6 = 'الصف السادس الابتدائي';
  const GRADE_7 = 'الصف الأول الإعدادي';

  beforeAll(async () => {
    scratch = await setupScratchDb('exam_grades_eligibility');
    client = scratch.client;
    ({ saveExamGrades } = await import('./examGrades.js'));
  }, 60_000);

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
      data: { id, name: 'امتحان', grade: GRADE_6, date: new Date('2026-02-01'), total: 100, pass: 50, ...overrides },
    });
  }

  async function seedStudent(overrides = {}) {
    const id = nextId('s');
    return client.students.create({ data: { id, code: id, name: 'طالب', status: 'active', grade: GRADE_6, ...overrides } });
  }

  it('succeeds for a matching-grade active student (regression: normal save still works)', async () => {
    const exam = await seedExam();
    const student = await seedStudent();

    const result = await saveExamGrades({ examId: exam.id, records: [{ studentId: student.id, score: 88 }] });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].studentId).toBe(student.id);
    expect(result.records[0].score).toBe(88);
  });

  it('rejects a wrong-grade student, and persists nothing', async () => {
    const exam = await seedExam({ grade: GRADE_6 });
    const student = await seedStudent({ grade: GRADE_7 });

    await expect(saveExamGrades({ examId: exam.id, records: [{ studentId: student.id, score: 50 }] }))
      .rejects.toThrow();

    const rows = await client.grades.findMany({ where: { exam_id: exam.id } });
    expect(rows).toHaveLength(0);
  });

  it('rejects an inactive student even with the matching grade, and persists nothing', async () => {
    const exam = await seedExam();
    const student = await seedStudent({ status: 'inactive' });

    await expect(saveExamGrades({ examId: exam.id, records: [{ studentId: student.id, score: 50 }] }))
      .rejects.toThrow();

    const rows = await client.grades.findMany({ where: { exam_id: exam.id } });
    expect(rows).toHaveLength(0);
  });

  it('rejects a nonexistent studentId, and persists nothing', async () => {
    const exam = await seedExam();

    await expect(saveExamGrades({ examId: exam.id, records: [{ studentId: 'no-such-student', score: 50 }] }))
      .rejects.toThrow();

    const rows = await client.grades.findMany({ where: { exam_id: exam.id } });
    expect(rows).toHaveLength(0);
  });

  it('rejects the WHOLE save (atomic) when one of several students is invalid — the valid one is not partially saved either', async () => {
    const exam = await seedExam();
    const validStudent = await seedStudent();
    const invalidStudent = await seedStudent({ grade: GRADE_7 });

    await expect(saveExamGrades({
      examId: exam.id,
      records: [
        { studentId: validStudent.id, score: 60 },
        { studentId: invalidStudent.id, score: 60 },
      ],
    })).rejects.toThrow();

    const rows = await client.grades.findMany({ where: { exam_id: exam.id } });
    expect(rows).toHaveLength(0);
  });

  it('an exam with no grade set (legacy/edge case) does not block grading — grade check is skipped, active status still enforced', async () => {
    const exam = await seedExam({ grade: null });
    const activeStudent = await seedStudent();
    const inactiveStudent = await seedStudent({ status: 'inactive' });

    const result = await saveExamGrades({ examId: exam.id, records: [{ studentId: activeStudent.id, score: 70 }] });
    expect(result.records).toHaveLength(1);

    await expect(saveExamGrades({ examId: exam.id, records: [{ studentId: inactiveStudent.id, score: 70 }] }))
      .rejects.toThrow();
  });

  it('a historical exam with academic_year null remains fully usable for grading', async () => {
    const exam = await seedExam({ academic_year: null });
    const student = await seedStudent();

    const result = await saveExamGrades({ examId: exam.id, records: [{ studentId: student.id, score: 42 }] });
    expect(result.records).toHaveLength(1);
    expect(result.records[0].score).toBe(42);
  });

  // ── Regression — existing behavior preserved exactly ─────────────────────────────────
  it('regression: existing grades are preserved when re-saving with the same valid roster (upsert-by-unique-key)', async () => {
    const exam = await seedExam();
    const student = await seedStudent();
    const first = await saveExamGrades({ examId: exam.id, records: [{ studentId: student.id, score: 30 }] });
    const firstId = first.records[0].id;

    const second = await saveExamGrades({ examId: exam.id, records: [{ studentId: student.id, score: 90 }] });

    expect(second.records).toHaveLength(1);
    expect(second.records[0].id).toBe(firstId); // same row, upserted — not a new insert
    expect(second.records[0].score).toBe(90);
  });

  it('regression: replaces only this exam\'s grades — an unrelated exam\'s grades survive untouched', async () => {
    const exam1 = await seedExam();
    const exam2 = await seedExam();
    const student = await seedStudent();
    await saveExamGrades({ examId: exam1.id, records: [{ studentId: student.id, score: 50 }] });
    await saveExamGrades({ examId: exam2.id, records: [{ studentId: student.id, score: 50 }] });

    await saveExamGrades({ examId: exam1.id, records: [] }); // clears exam1's roster entirely

    const exam1Rows = await client.grades.findMany({ where: { exam_id: exam1.id } });
    const exam2Rows = await client.grades.findMany({ where: { exam_id: exam2.id } });
    expect(exam1Rows).toHaveLength(0);
    expect(exam2Rows).toHaveLength(1); // untouched
  });

  it('regression: score above the exam\'s total is still rejected', async () => {
    const exam = await seedExam({ total: 100 });
    const student = await seedStudent();

    await expect(saveExamGrades({ examId: exam.id, records: [{ studentId: student.id, score: 150 }] }))
      .rejects.toThrow();
  });

  it('regression: a negative score is still rejected', async () => {
    const exam = await seedExam();
    const student = await seedStudent();

    await expect(saveExamGrades({ examId: exam.id, records: [{ studentId: student.id, score: -5 }] }))
      .rejects.toThrow();
  });

  it('regression: absent:true with no score still saves correctly', async () => {
    const exam = await seedExam();
    const student = await seedStudent();

    const result = await saveExamGrades({ examId: exam.id, records: [{ studentId: student.id, score: null, absent: true }] });
    expect(result.records).toHaveLength(1);
    expect(result.records[0].absent).toBe(true);
    expect(result.records[0].score).toBeNull();
  });
});
