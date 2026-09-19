// src/services/homeworkSearchService.js
// Homework Phase 3A — Search & Reports. The operational question is "which students
// submitted / did not submit?", not "which homeworks exist?" — so the shared unit here is a
// flat row per (homework, eligible student) pair, reused as-is by the search screen and by
// print (buildHomeworkSearchReport.js), so print can never drift from what is on screen.
import { getHomeworkEligibleStudents } from './homeworkService';

// One row per (homework, eligible student) pair. Eligibility is delegated to
// getHomeworkEligibleStudents (grade-based, never groupId) — the same single source of
// truth used everywhere else in Homework 2.0. A student with no saved hwSubmissions record
// defaults to status:'missing' (never submitted), matching HomeworkTracking.jsx's own default.
export function buildHomeworkSubmissionRows(homeworks, students, hwSubmissions) {
  const rows = [];
  for (const hw of homeworks) {
    const eligible = getHomeworkEligibleStudents(hw, students);
    for (const student of eligible) {
      const sub = hwSubmissions.find((s) => s.hwId === hw.id && s.studentId === student.id);
      rows.push({
        homeworkId: hw.id,
        homeworkTitle: hw.title,
        homeworkDate: hw.dueDate,
        academicYear: hw.academicYear || '',
        grade: hw.grade,
        subject: hw.subject,
        studentId: student.id,
        studentName: student.name,
        studentCode: student.code,
        status: sub?.status || 'missing',
        score: sub?.score ?? null,
        totalScore: hw.totalScore ?? null,
        submittedAt: sub?.submittedAt || null,
      });
    }
  }
  return rows;
}

// filters: { dateFrom, dateTo, academicYear, grade, status }
// status: '' | 'submitted' (an actual submission exists — 'submitted' or 'late') | 'not_submitted' ('missing' only)
export function filterHomeworkSubmissionRows(rows, filters = {}) {
  const { dateFrom, dateTo, academicYear, grade, status } = filters;
  return rows.filter((r) => {
    if (dateFrom && r.homeworkDate < dateFrom) return false;
    if (dateTo && r.homeworkDate > dateTo) return false;
    if (academicYear && r.academicYear !== academicYear) return false;
    if (grade && r.grade !== grade) return false;
    if (status === 'submitted' && r.status === 'missing') return false;
    if (status === 'not_submitted' && r.status !== 'missing') return false;
    return true;
  });
}
