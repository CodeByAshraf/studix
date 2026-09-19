// src/services/homeworkService.test.js
// Homework 2.0 Phase 2 — getHomeworkEligibleStudents(homework, students) is the single
// shared eligibility function replacing five independent Group-based roster copies
// (HomeworkTracking.jsx, HomeworkPage.jsx, buildHomeworkReport.js, HomeworkReports.jsx,
// reportData.js/studentReport.js). Rule: active AND student.grade === homework.grade —
// never Group membership. Because it filters the flat students array directly (never
// joining through student_group_enrollments or students.groupId), a student can only ever
// appear once — there is nothing here that could produce a duplicate.
import { describe, it, expect } from 'vitest';
import { getHomeworkEligibleStudents, validateHomework } from './homeworkService';

const GRADE_6 = 'الصف السادس الابتدائي';
const GRADE_7 = 'الصف الأول الإعدادي';

function student(over = {}) {
  return { id: 's1', name: 'طالب', code: 'C1', grade: GRADE_6, status: 'active', groupId: 'g1', ...over };
}

describe('getHomeworkEligibleStudents — grade-based, never Group-based (Homework 2.0)', () => {
  it('a matching-grade active student is included', () => {
    const result = getHomeworkEligibleStudents({ grade: GRADE_6 }, [student()]);
    expect(result.map((s) => s.id)).toEqual(['s1']);
  });

  it('a wrong-grade student is excluded even though they are active', () => {
    const result = getHomeworkEligibleStudents({ grade: GRADE_6 }, [student({ grade: GRADE_7 })]);
    expect(result).toEqual([]);
  });

  it('an inactive student with the matching grade is excluded', () => {
    const result = getHomeworkEligibleStudents({ grade: GRADE_6 }, [student({ status: 'inactive' })]);
    expect(result).toEqual([]);
  });

  it('a graduated student with the matching grade is excluded', () => {
    const result = getHomeworkEligibleStudents({ grade: GRADE_6 }, [student({ status: 'graduated' })]);
    expect(result).toEqual([]);
  });

  it('a student with no Group at all (groupId: null) but the matching grade is included', () => {
    const result = getHomeworkEligibleStudents({ grade: GRADE_6 }, [student({ groupId: null })]);
    expect(result.map((s) => s.id)).toEqual(['s1']);
  });

  it('a student with Primary + (conceptually) Additional Group enrollments still appears exactly once — Group membership is never consulted', () => {
    // getHomeworkEligibleStudents never reads groupId/student_group_enrollments at all — a
    // student row appears exactly once in the `students` array by definition, so there is
    // no join here that could ever produce a duplicate regardless of how many groups they
    // are enrolled in (Primary or Additional).
    const ahmed = student({ id: 'ahmed', groupId: 'gA' }); // Primary=A, Additional=B is irrelevant — not read
    const result = getHomeworkEligibleStudents({ grade: GRADE_6 }, [ahmed]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ahmed');
  });

  it('changing a student\'s grade changes their eligibility for the same homework', () => {
    const s = student({ grade: GRADE_6 });
    expect(getHomeworkEligibleStudents({ grade: GRADE_6 }, [s]).map((x) => x.id)).toEqual(['s1']);
    const moved = { ...s, grade: GRADE_7 };
    expect(getHomeworkEligibleStudents({ grade: GRADE_6 }, [moved])).toEqual([]);
    expect(getHomeworkEligibleStudents({ grade: GRADE_7 }, [moved]).map((x) => x.id)).toEqual(['s1']);
  });

  it('a Group transfer (groupId changes) never affects homework eligibility — grade unchanged', () => {
    const before = student({ groupId: 'gA' });
    const afterTransfer = { ...before, groupId: 'gC' }; // Primary transferred A -> C, grade untouched
    expect(getHomeworkEligibleStudents({ grade: GRADE_6 }, [before]).map((x) => x.id))
      .toEqual(getHomeworkEligibleStudents({ grade: GRADE_6 }, [afterTransfer]).map((x) => x.id));
  });

  it('multiple students: only active, matching-grade ones are returned, each once', () => {
    const roster = [
      student({ id: 's1', grade: GRADE_6, status: 'active' }),
      student({ id: 's2', grade: GRADE_7, status: 'active' }), // wrong grade
      student({ id: 's3', grade: GRADE_6, status: 'inactive' }), // inactive
      student({ id: 's4', grade: GRADE_6, status: 'active', groupId: null }), // no group, still eligible
    ];
    const result = getHomeworkEligibleStudents({ grade: GRADE_6 }, roster);
    expect(result.map((s) => s.id).sort()).toEqual(['s1', 's4']);
  });
});

describe('validateHomework — grade required, Group no longer required (Homework 2.0)', () => {
  const VALID = { title: 'واجب 1', subject: 'رياضيات', grade: GRADE_6, dueDate: '2026-02-01', createdAt: '2026-01-01' };

  it('validates successfully with grade and no groupId at all', () => {
    const errors = validateHomework(VALID);
    expect(errors.groupId).toBeUndefined();
    expect(errors.grade).toBeUndefined();
  });

  it('requires grade — missing grade is rejected', () => {
    const { grade: _grade, ...withoutGrade } = VALID;
    const errors = validateHomework(withoutGrade);
    expect(errors.grade).toBeTruthy();
  });

  it('no longer requires groupId even when explicitly empty', () => {
    const errors = validateHomework({ ...VALID, groupId: '' });
    expect(errors.groupId).toBeUndefined();
  });

  // Regression — every other existing rule unchanged.
  it('still requires title/subject/dueDate/createdAt (regression)', () => {
    const errors = validateHomework({});
    expect(errors.title).toBeTruthy();
    expect(errors.subject).toBeTruthy();
    expect(errors.dueDate).toBeTruthy();
    expect(errors.createdAt).toBeTruthy();
  });

  it('still rejects totalScore <= 0 and dueDate before createdAt (regression)', () => {
    const errors1 = validateHomework({ ...VALID, totalScore: 0 });
    expect(errors1.totalScore).toBeTruthy();
    const errors2 = validateHomework({ ...VALID, dueDate: '2025-01-01', createdAt: '2026-01-01' });
    expect(errors2.dueDate).toBeTruthy();
  });
});
