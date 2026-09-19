// src/modules/exams/buildExamReport.test.js
// Exams Phase 2 — proves the two print functions now use grade-based eligibility
// (getExamEligibleStudents / student.grade===exam.grade), never Group membership, and
// that `group` remains purely a display label (can be missing entirely for new exams).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openGroupExamReport, openStudentExamReport } from './buildExamReport';

let writtenHtml;
function mockWindow() {
  writtenHtml = '';
  const win = { document: { open: vi.fn(), write: vi.fn((html) => { writtenHtml += html; }), close: vi.fn() }, focus: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(win);
  return win;
}

const GRADE_6 = 'الصف السادس الابتدائي';
const GRADE_7 = 'الصف الأول الإعدادي';
const GROUP_A = { id: 'g1', name: 'مجموعة أ' };
const EXAM = { id: 'e1', name: 'امتحان الجبر', subject: 'رياضيات', grade: GRADE_6, academicYear: '2025/2026', total: 20, pass: 10, date: '2026-01-10' };

const STUDENTS = [
  { id: 's1', name: 'أحمد علي',  code: 'C001', grade: GRADE_6, status: 'active' },
  { id: 's2', name: 'سارة محمد', code: 'C002', grade: GRADE_6, status: 'active' },
  { id: 's3', name: 'منى فتحي',  code: 'C003', grade: GRADE_7, status: 'active' }, // wrong grade
  { id: 's4', name: 'خالد سعيد', code: 'C004', grade: GRADE_6, status: 'inactive' }, // inactive
];

const GRADES = [
  { examId: 'e1', studentId: 's1', score: 18, absent: false },
  { examId: 'e1', studentId: 's3', score: 20, absent: false }, // different grade — must be excluded
];

describe('openGroupExamReport — grade-based eligibility (Exams Phase 2)', () => {
  beforeEach(() => { mockWindow(); });

  it('includes only students whose grade matches exam.grade, excluding wrong-grade and inactive students', () => {
    openGroupExamReport({ group: GROUP_A, exam: EXAM, students: STUDENTS, grades: GRADES, profile: {} });
    expect(writtenHtml).toContain('أحمد علي');
    expect(writtenHtml).toContain('سارة محمد');
    expect(writtenHtml).not.toContain('منى فتحي'); // wrong grade, despite having a grade record
    expect(writtenHtml).not.toContain('خالد سعيد'); // inactive
  });

  it('works with no group at all — group is purely a display label, never required for eligibility', () => {
    expect(() => openGroupExamReport({ group: undefined, exam: EXAM, students: STUDENTS, grades: GRADES, profile: {} })).not.toThrow();
    expect(writtenHtml).toContain('أحمد علي');
  });
});

describe('openStudentExamReport — grade-based eligibility (Exams Phase 2)', () => {
  beforeEach(() => { mockWindow(); });

  it('includes only exams matching the student\'s own grade', () => {
    const student = { id: 's1', name: 'أحمد علي', code: 'C001', grade: GRADE_6, status: 'active' };
    const otherGradeExam = { ...EXAM, id: 'e2', name: 'امتحان مختلف', grade: GRADE_7 };
    const gradesWithStray = [...GRADES, { examId: 'e2', studentId: 's1', score: 5, absent: false }];
    openStudentExamReport({ student, group: GROUP_A, exams: [EXAM, otherGradeExam], grades: gradesWithStray, profile: {} });
    expect(writtenHtml).toContain('امتحان الجبر');
    expect(writtenHtml).not.toContain('امتحان مختلف'); // exam targets a different grade
  });
});
