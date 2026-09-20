// src/services/examService.test.js
// Exams Phase 2 — getExamEligibleStudents(exam, students) is the single shared eligibility
// function replacing every independent Group-based roster copy across the Exams module
// (GradeEntry.jsx, ExamResults.jsx, buildExamReport.js). Rule: active AND
// student.grade === exam.grade — never Group membership. Mirrors
// homeworkService.js's getHomeworkEligibleStudents exactly.
import { describe, it, expect } from 'vitest';
import { getExamEligibleStudents, validateExam, createExam, updateExam, computeExamEndTime, computeExamTimerState, formatRemainingSeconds } from './examService';

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

  it('createExam persists scheduledTime/durationMinutes when provided', () => {
    const exam = createExam({ ...VALID, scheduledTime: '09:00', durationMinutes: '60' });
    expect(exam.scheduledTime).toBe('09:00');
    expect(exam.durationMinutes).toBe(60);
  });

  it('createExam leaves scheduledTime/durationMinutes null when not provided (historical-style)', () => {
    const exam = createExam({ ...VALID });
    expect(exam.scheduledTime).toBeNull();
    expect(exam.durationMinutes).toBeNull();
  });

  it('updateExam preserves scheduledTime/durationMinutes when passed through', () => {
    const exam = updateExam('e1', { ...VALID, status: 'upcoming', scheduledTime: '14:30', durationMinutes: '45' });
    expect(exam.scheduledTime).toBe('14:30');
    expect(exam.durationMinutes).toBe(45);
  });
});

describe('validateExam — scheduling fields (Exams Phase 3C)', () => {
  const VALID = { name: 'امتحان 1', subject: 'رياضيات', grade: GRADE_6, date: '2026-02-01', total: '100', pass: '50' };

  it('both scheduling fields are optional — neither is required', () => {
    const errors = validateExam(VALID);
    expect(errors.scheduledTime).toBeUndefined();
    expect(errors.durationMinutes).toBeUndefined();
  });

  it('providing only scheduledTime (durationMinutes empty) is valid', () => {
    const errors = validateExam({ ...VALID, scheduledTime: '09:00' });
    expect(errors.scheduledTime).toBeUndefined();
    expect(errors.durationMinutes).toBeUndefined();
  });

  it('providing only durationMinutes (scheduledTime empty) is valid', () => {
    const errors = validateExam({ ...VALID, durationMinutes: '60' });
    expect(errors.scheduledTime).toBeUndefined();
    expect(errors.durationMinutes).toBeUndefined();
  });

  it('accepts valid HH:MM values across the full range', () => {
    expect(validateExam({ ...VALID, scheduledTime: '00:00' }).scheduledTime).toBeUndefined();
    expect(validateExam({ ...VALID, scheduledTime: '23:59' }).scheduledTime).toBeUndefined();
    expect(validateExam({ ...VALID, scheduledTime: '09:05' }).scheduledTime).toBeUndefined();
  });

  it('rejects invalid time formats', () => {
    expect(validateExam({ ...VALID, scheduledTime: '24:00' }).scheduledTime).toBeTruthy();
    expect(validateExam({ ...VALID, scheduledTime: '9:00' }).scheduledTime).toBeTruthy();
    expect(validateExam({ ...VALID, scheduledTime: '09:60' }).scheduledTime).toBeTruthy();
    expect(validateExam({ ...VALID, scheduledTime: 'not-a-time' }).scheduledTime).toBeTruthy();
  });

  it('accepts a valid positive integer duration', () => {
    expect(validateExam({ ...VALID, durationMinutes: '1' }).durationMinutes).toBeUndefined();
    expect(validateExam({ ...VALID, durationMinutes: '90' }).durationMinutes).toBeUndefined();
  });

  it('rejects an invalid duration (zero, negative, non-integer)', () => {
    expect(validateExam({ ...VALID, durationMinutes: '0' }).durationMinutes).toBeTruthy();
    expect(validateExam({ ...VALID, durationMinutes: '-5' }).durationMinutes).toBeTruthy();
    expect(validateExam({ ...VALID, durationMinutes: '1.5' }).durationMinutes).toBeTruthy();
  });
});

describe('computeExamEndTime — pure display calculation, never persisted (Exams Phase 3C)', () => {
  it('returns null when either input is missing', () => {
    expect(computeExamEndTime('', 60)).toBeNull();
    expect(computeExamEndTime('09:00', '')).toBeNull();
    expect(computeExamEndTime(null, null)).toBeNull();
  });

  it('computes a same-day end time', () => {
    expect(computeExamEndTime('09:00', 60)).toEqual({ time: '10:00', crossesMidnight: false });
    expect(computeExamEndTime('14:15', 45)).toEqual({ time: '15:00', crossesMidnight: false });
  });

  it('crosses midnight correctly (23:30 + 60 minutes = 00:30 next day)', () => {
    expect(computeExamEndTime('23:30', 60)).toEqual({ time: '00:30', crossesMidnight: true });
  });

  it('exactly reaching midnight is still flagged as crossing', () => {
    expect(computeExamEndTime('23:00', 60)).toEqual({ time: '00:00', crossesMidnight: true });
  });

  it('a very long duration wrapping multiple times still resolves to a valid time-of-day', () => {
    expect(computeExamEndTime('10:00', 1500)).toEqual({ time: '11:00', crossesMidnight: true }); // 25h later
  });
});

describe('computeExamTimerState — pure administrative timer calculation (Exams Phase 3D)', () => {
  it('"not_scheduled" when there is no duration at all (historical exams)', () => {
    expect(computeExamTimerState({ actualStartedAt: null, durationMinutes: null })).toEqual({ phase: 'not_scheduled', remainingSeconds: null });
    expect(computeExamTimerState({ actualStartedAt: null, durationMinutes: undefined })).toEqual({ phase: 'not_scheduled', remainingSeconds: null });
  });

  it('"ready_to_start" when duration is set but the exam has not been started yet', () => {
    expect(computeExamTimerState({ actualStartedAt: null, durationMinutes: 60 })).toEqual({ phase: 'ready_to_start', remainingSeconds: null });
  });

  it('"in_progress" with the correct remainingSeconds partway through', () => {
    const start = new Date('2026-01-01T09:00:00.000Z').toISOString();
    const now = new Date('2026-01-01T09:10:00.000Z').getTime(); // 10 minutes in, 60-minute exam
    const result = computeExamTimerState({ actualStartedAt: start, durationMinutes: 60 }, now);
    expect(result.phase).toBe('in_progress');
    expect(result.remainingSeconds).toBe(50 * 60);
  });

  it('"time_finished" with remainingSeconds 0 once the duration has fully elapsed', () => {
    const start = new Date('2026-01-01T09:00:00.000Z').toISOString();
    const now = new Date('2026-01-01T10:30:00.000Z').getTime(); // 90 minutes in, 60-minute exam
    const result = computeExamTimerState({ actualStartedAt: start, durationMinutes: 60 }, now);
    expect(result.phase).toBe('time_finished');
    expect(result.remainingSeconds).toBe(0);
  });

  it('exactly at the end boundary is "time_finished", not "in_progress"', () => {
    const start = new Date('2026-01-01T09:00:00.000Z').toISOString();
    const now = new Date('2026-01-01T10:00:00.000Z').getTime(); // exactly 60 minutes
    const result = computeExamTimerState({ actualStartedAt: start, durationMinutes: 60 }, now);
    expect(result.phase).toBe('time_finished');
    expect(result.remainingSeconds).toBe(0);
  });

  it('never returns a negative remainingSeconds', () => {
    const start = new Date('2026-01-01T09:00:00.000Z').toISOString();
    const now = new Date('2026-01-02T09:00:00.000Z').getTime(); // a full day later
    const result = computeExamTimerState({ actualStartedAt: start, durationMinutes: 30 }, now);
    expect(result.remainingSeconds).toBe(0);
  });
});

describe('formatRemainingSeconds', () => {
  it('formats under an hour as MM:SS', () => {
    expect(formatRemainingSeconds(59)).toBe('00:59');
    expect(formatRemainingSeconds(600)).toBe('10:00');
  });
  it('formats an hour or more as H:MM:SS', () => {
    expect(formatRemainingSeconds(3661)).toBe('1:01:01');
  });
  it('returns "—" for null (not_scheduled/ready_to_start)', () => {
    expect(formatRemainingSeconds(null)).toBe('—');
  });
  it('never shows negative time', () => {
    expect(formatRemainingSeconds(-5)).toBe('00:00');
  });
});
