// src/services/homeworkSearchService.test.js
// Homework Phase 3A — Search & Reports. The search/print/(future WhatsApp) surfaces all need
// the *same* flat, filterable dataset: one row per (homework, eligible student) pair, answering
// "which students submitted / did not submit?" rather than "which homeworks exist?". These two
// pure functions are that single shared implementation — reused by HomeworkSearch.jsx (screen)
// and buildHomeworkSearchReport.js (print), so print can never drift from what's on screen.
import { describe, it, expect } from 'vitest';
import { buildHomeworkSubmissionRows, filterHomeworkSubmissionRows } from './homeworkSearchService';

const GRADE_6 = 'الصف السادس الابتدائي';
const GRADE_7 = 'الصف الأول الإعدادي';

function hw(over = {}) {
  return { id: 'hw1', title: 'واجب 1', subject: 'رياضيات', grade: GRADE_6, academicYear: '2025/2026', dueDate: '2026-03-10', totalScore: 20, groupId: 'g1', ...over };
}
function student(over = {}) {
  return { id: 's1', name: 'طالب واحد', code: 'C1', grade: GRADE_6, status: 'active', groupId: 'g1', ...over };
}

describe('buildHomeworkSubmissionRows — one row per (homework, eligible student) pair', () => {
  it('includes a grade-matching active student and excludes a wrong-grade student', () => {
    const rows = buildHomeworkSubmissionRows(
      [hw()],
      [student({ id: 's1', grade: GRADE_6 }), student({ id: 's2', grade: GRADE_7 })],
      []
    );
    expect(rows.map(r => r.studentId)).toEqual(['s1']);
  });

  it('a student with no saved submission record defaults to status "missing" (never submitted)', () => {
    const rows = buildHomeworkSubmissionRows([hw()], [student()], []);
    expect(rows[0].status).toBe('missing');
    expect(rows[0].score).toBeNull();
  });

  it('resolves status/score from the matching hwSubmissions record when one exists', () => {
    const rows = buildHomeworkSubmissionRows(
      [hw()],
      [student()],
      [{ hwId: 'hw1', studentId: 's1', status: 'submitted', score: 18, submittedAt: '2026-03-09' }]
    );
    expect(rows[0].status).toBe('submitted');
    expect(rows[0].score).toBe(18);
  });

  it('carries the expected display fields for the suggested result columns', () => {
    const rows = buildHomeworkSubmissionRows([hw()], [student()], []);
    expect(rows[0]).toMatchObject({
      homeworkId: 'hw1', homeworkTitle: 'واجب 1', homeworkDate: '2026-03-10',
      academicYear: '2025/2026', grade: GRADE_6, studentId: 's1', studentName: 'طالب واحد',
    });
  });

  it('group_id (on either the homework or the student) has no effect on which rows are produced', () => {
    const withGroups = buildHomeworkSubmissionRows(
      [hw({ groupId: 'gA' })], [student({ groupId: 'gX' })], []
    );
    const noGroups = buildHomeworkSubmissionRows(
      [hw({ groupId: null })], [student({ groupId: null })], []
    );
    expect(withGroups.map(r => r.studentId)).toEqual(noGroups.map(r => r.studentId));
  });

  it('a student enrolled via multiple homeworks/grades still appears at most once per homework', () => {
    const rows = buildHomeworkSubmissionRows(
      [hw({ id: 'hw1' }), hw({ id: 'hw2' })],
      [student()],
      []
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(r => r.homeworkId)).size).toBe(2);
  });
});

describe('filterHomeworkSubmissionRows', () => {
  const rows = [
    { homeworkId: 'hw1', homeworkDate: '2026-03-05', academicYear: '2025/2026', grade: GRADE_6, status: 'submitted', studentId: 's1' },
    { homeworkId: 'hw2', homeworkDate: '2026-03-20', academicYear: '2025/2026', grade: GRADE_6, status: 'missing',   studentId: 's2' },
    { homeworkId: 'hw3', homeworkDate: '2026-04-01', academicYear: '2025/2026', grade: GRADE_7, status: 'late',      studentId: 's3' },
    { homeworkId: 'hw4', homeworkDate: '2025-09-15', academicYear: '2024/2025', grade: GRADE_6, status: 'missing',   studentId: 's4' },
  ];

  it('returns all rows when no filters are set', () => {
    expect(filterHomeworkSubmissionRows(rows, {})).toHaveLength(4);
  });

  it('filters by dateFrom', () => {
    const result = filterHomeworkSubmissionRows(rows, { dateFrom: '2026-03-10' });
    expect(result.map(r => r.homeworkId)).toEqual(['hw2', 'hw3']);
  });

  it('filters by dateTo', () => {
    const result = filterHomeworkSubmissionRows(rows, { dateTo: '2026-03-10' });
    expect(result.map(r => r.homeworkId)).toEqual(['hw1', 'hw4']);
  });

  it('filters by a full date range (dateFrom + dateTo)', () => {
    const result = filterHomeworkSubmissionRows(rows, { dateFrom: '2026-03-01', dateTo: '2026-03-31' });
    expect(result.map(r => r.homeworkId)).toEqual(['hw1', 'hw2']);
  });

  it('filters by academicYear', () => {
    const result = filterHomeworkSubmissionRows(rows, { academicYear: '2024/2025' });
    expect(result.map(r => r.homeworkId)).toEqual(['hw4']);
  });

  it('filters by grade', () => {
    const result = filterHomeworkSubmissionRows(rows, { grade: GRADE_7 });
    expect(result.map(r => r.homeworkId)).toEqual(['hw3']);
  });

  it('status "submitted" includes both submitted and late (an actual submission exists)', () => {
    const result = filterHomeworkSubmissionRows(rows, { status: 'submitted' });
    expect(result.map(r => r.homeworkId).sort()).toEqual(['hw1', 'hw3']);
  });

  it('status "not_submitted" includes only missing', () => {
    const result = filterHomeworkSubmissionRows(rows, { status: 'not_submitted' });
    expect(result.map(r => r.homeworkId).sort()).toEqual(['hw2', 'hw4']);
  });

  it('combines grade + date range + status (the documented "Grade 6 + March + Not Submitted" example)', () => {
    const result = filterHomeworkSubmissionRows(rows, {
      grade: GRADE_6, dateFrom: '2026-03-01', dateTo: '2026-03-31', status: 'not_submitted',
    });
    expect(result.map(r => r.homeworkId)).toEqual(['hw2']);
  });

  it('returns an empty array when no row matches the combined filters', () => {
    const result = filterHomeworkSubmissionRows(rows, { grade: GRADE_7, status: 'not_submitted' });
    expect(result).toEqual([]);
  });
});
