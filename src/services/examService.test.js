// src/services/examService.test.js
// Exams Phase 2 — getExamEligibleStudents(exam, students) is the single shared eligibility
// function replacing every independent Group-based roster copy across the Exams module
// (GradeEntry.jsx, ExamResults.jsx, buildExamReport.js). Rule: active AND
// student.grade === exam.grade — never Group membership. Mirrors
// homeworkService.js's getHomeworkEligibleStudents exactly.
import { describe, it, expect } from 'vitest';
import { getExamEligibleStudents, validateExam, createExam, updateExam } from './examService';

const GRADE_6 = 'الصف السادس الابتدائي';
const GRADE_7 = 'الصف الأول الإعدادي';

function student(over = {}) {
  return { id: 's1', name: 'طالب', code: 'C1', grade: GRADE_6, status: 'active', groupId: 'g1', ...over };
}

describe('getExamEligibleStudents — grade-based, never Group-based (Exams Phase 2)', () => {
  it('a matching-grade active student is included', () => {
    const result = getExamEligibleStudents({ grade: GRADE_6 }, [student()]);
    expect(result.map((s) => s.id)).toEqual(['s1']);
  });

  it('a wrong-grade student is excluded even though they are active', () => {
    const result = getExamEligibleStudents({ grade: GRADE_6 }, [student({ grade: GRADE_7 })]);
    expect(result).toEqual([]);
  });

  it('an inactive student with the matching grade is excluded', () => {
    const result = getExamEligibleStudents({ grade: GRADE_6 }, [student({ status: 'inactive' })]);
    expect(result).toEqual([]);
  });

  it('a graduated student with the matching grade is excluded', () => {
    const result = getExamEligibleStudents({ grade: GRADE_6 }, [student({ status: 'graduated' })]);
    expect(result).toEqual([]);
  });

  it('a student with no Group at all (groupId: null) but the matching grade is included', () => {
    const result = getExamEligibleStudents({ grade: GRADE_6 }, [student({ groupId: null })]);
    expect(result.map((s) => s.id)).toEqual(['s1']);
  });

  it('a student with Primary + Additional Group enrollments still appears exactly once — Group membership is never consulted', () => {
    const ahmed = student({ id: 'ahmed', groupId: 'gA' });
    const result = getExamEligibleStudents({ grade: GRADE_6 }, [ahmed]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ahmed');
  });

  it('a Group transfer never affects exam eligibility — grade unchanged', () => {
    const before = student({ groupId: 'gA' });
    const afterTransfer = { ...before, groupId: 'gC' };
    expect(getExamEligibleStudents({ grade: GRADE_6 }, [before]).map((x) => x.id))
      .toEqual(getExamEligibleStudents({ grade: GRADE_6 }, [afterTransfer]).map((x) => x.id));
  });

  it('multiple students: only active, matching-grade ones are returned, each once', () => {
    const roster = [
      student({ id: 's1', grade: GRADE_6, status: 'active' }),
      student({ id: 's2', grade: GRADE_7, status: 'active' }), // wrong grade
      student({ id: 's3', grade: GRADE_6, status: 'inactive' }), // inactive
      student({ id: 's4', grade: GRADE_6, status: 'active', groupId: null }), // no group, still eligible
    ];
    const result = getExamEligibleStudents({ grade: GRADE_6 }, roster);
    expect(result.map((s) => s.id).sort()).toEqual(['s1', 's4']);
  });
});

describe('validateExam — grade required, Group no longer required (Exams Phase 2)', () => {
  const VALID = { name: 'امتحان 1', subject: 'رياضيات', grade: GRADE_6, date: '2026-02-01', total: '100', pass: '50' };

  it('validates successfully with grade and no groupId at all', () => {
    const errors = validateExam(VALID);
    expect(errors.groupId).toBeUndefined();
    expect(errors.grade).toBeUndefined();
  });

  it('requires grade — missing grade is rejected', () => {
    const { grade: _grade, ...withoutGrade } = VALID;
    const errors = validateExam(withoutGrade);
    expect(errors.grade).toBeTruthy();
  });

  it('no longer requires groupId even when explicitly empty', () => {
    const errors = validateExam({ ...VALID, groupId: '' });
    expect(errors.groupId).toBeUndefined();
  });

  it('still requires name/date/total (regression) — subject was never a required field', () => {
    const errors = validateExam({});
    expect(errors.name).toBeTruthy();
    expect(errors.date).toBeTruthy();
    expect(errors.total).toBeTruthy();
  });

  it('still rejects pass > total (regression)', () => {
    const errors = validateExam({ ...VALID, total: '50', pass: '60' });
    expect(errors.pass).toBeTruthy();
  });
});

describe('createExam / updateExam — grade + academicYear targeting, groupId preserved as historical', () => {
  const VALID = { name: 'امتحان 1', subject: 'رياضيات', grade: GRADE_6, date: '2026-02-01', total: '100', pass: '50' };

  it('createExam stamps grade/academicYear and leaves groupId null when none is given', () => {
    const exam = createExam({ ...VALID, academicYear: '2025/2026' });
    expect(exam.grade).toBe(GRADE_6);
    expect(exam.academicYear).toBe('2025/2026');
    expect(exam.groupId).toBeNull();
  });

  it('updateExam preserves an existing historical groupId when passed through unchanged', () => {
    const exam = updateExam('e1', { ...VALID, academicYear: '2025/2026', groupId: 'g1', status: 'upcoming' });
    expect(exam.groupId).toBe('g1');
    expect(exam.grade).toBe(GRADE_6);
  });
});
