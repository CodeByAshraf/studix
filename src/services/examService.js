// src/services/examService.js

import { validate, hasErrors, sanitizeFormData, examSchema } from '../utils/validation';

export const EXAM_TYPES = {
  monthly: { label: 'شهري',         icon: '📅' },
  midterm: { label: 'نصف الفصل',   icon: '📖' },
  final:   { label: 'نهائي',        icon: '🎓' },
  quiz:    { label: 'اختبار سريع',  icon: '⚡' },
};

export const EXAM_STATUS = {
  upcoming: { label: 'قادم',        color: '#3b82f6', bg: 'rgba(59,130,246,.1)',  border: 'rgba(59,130,246,.25)' },
  grading:  { label: 'قيد التصحيح', color: '#f59e0b', bg: 'rgba(245,158,11,.1)', border: 'rgba(245,158,11,.25)' },
  done:     { label: 'منتهي',       color: '#10b981', bg: 'rgba(16,185,129,.1)', border: 'rgba(16,185,129,.25)' },
};

// ── Validation ──────────────────────────────────────────────
// examSchema (validate العام) يتحقّق من كل حقل بمعزل عن الآخرين — لا يمكنه التحقّق
// من "pass <= total" (يحتاج الحقلين معاً). نضيفه هنا كفحص إضافي بعد الفحص العادي،
// فقط لو total/pass نفسهما صالحين أصلاً (يمنع رسالتين متضاربتين على نفس الحقل).
// نفس القيد الموجود بالقاعدة (chk_exam_pass) — هذا يمنع وصول الطلب للخادم أصلاً.
export function validateExam(data) {
  const errors = validate(examSchema, data);
  if (!errors.total && !errors.pass) {
    const total = Number(data.total);
    const pass  = Number(data.pass);
    if (Number.isFinite(total) && Number.isFinite(pass) && pass > total) {
      errors.pass = 'درجة النجاح يجب ألا تتجاوز الدرجة الكلية';
    }
  }
  return errors;
}

// ── Create exam ─────────────────────────────────────────────
export function createExam(data) {
  const errors = validateExam(data);
  if (hasErrors(errors)) throw { type: 'VALIDATION', errors };
  const clean = sanitizeFormData(data, ['name','teacher','notes']);
  const examDate = new Date(clean.date);
  const status   = examDate > new Date() ? 'upcoming' : 'grading';
  return {
    id:      `e${Date.now()}`,
    name:    clean.name?.trim(),
    groupId: clean.groupId,
    subject: clean.subject || '',
    date:    clean.date,
    total:   Number(clean.total),
    pass:    Number(clean.pass) || 50,
    type:    clean.type || 'monthly',
    teacher: clean.teacher?.trim() || '',
    status,
    createdAt: new Date().toISOString(),
  };
}

// ── Update exam ─────────────────────────────────────────────
export function updateExam(id, data) {
  const errors = validateExam(data);
  if (hasErrors(errors)) throw { type: 'VALIDATION', errors };
  const clean = sanitizeFormData(data, ['name','teacher']);
  return {
    id, name: clean.name?.trim(), subject: clean.subject, date: clean.date,
    total: Number(clean.total), pass: Number(clean.pass),
    type: clean.type, teacher: clean.teacher?.trim() || '', status: clean.status,
    updatedAt: new Date().toISOString(),
  };
}

// ── Grade helpers ────────────────────────────────────────────
export function gradeStatus(score, total, pass) {
  if (score === null || score === undefined) return 'none';
  return score >= pass ? 'pass' : 'fail';
}

export function scorePercent(score, total) {
  if (!total || score === null) return null;
  return Math.round((score / total) * 100);
}

export function scoreGrade(pct) {
  if (pct === null) return '—';
  if (pct >= 90)   return 'A+';
  if (pct >= 80)   return 'A';
  if (pct >= 70)   return 'B';
  if (pct >= 60)   return 'C';
  if (pct >= 50)   return 'D';
  return 'F';
}

export function scoreColor(pct) {
  if (pct === null) return 'var(--text3)';
  if (pct >= 80)   return '#10b981';
  if (pct >= 60)   return '#f59e0b';
  return '#ef4444';
}

// ── Exam analytics ───────────────────────────────────────────
export function getExamStats(examId, grades, total) {
  const examGrades = grades.filter(g => g.examId === examId && !g.absent && g.score !== null);
  if (!examGrades.length) return { count: 0, avg: null, highest: null, lowest: null, passed: 0, failed: 0, passRate: null };

  const scores  = examGrades.map(g => g.score);
  const avg     = Math.round(scores.reduce((s, n) => s + n, 0) / scores.length);
  const highest = Math.max(...scores);
  const lowest  = Math.min(...scores);
  const allGrades = grades.filter(g => g.examId === examId);
  const passed  = examGrades.filter(g => g.score >= (total * 0.5)).length; // will be overridden with actual pass
  return { count: examGrades.length, avg, highest, lowest, passed, failed: examGrades.length - passed, passRate: Math.round(passed / examGrades.length * 100), absent: allGrades.filter(g => g.absent).length };
}

export function getExamStatsWithPass(examId, grades, exam) {
  const examGrades = grades.filter(g => g.examId === examId && !g.absent && g.score !== null);
  if (!examGrades.length) {
    const allG = grades.filter(g => g.examId === examId);
    return { count: 0, avg: null, highest: null, lowest: null, passed: 0, failed: 0, passRate: null, absent: allG.filter(g=>g.absent).length };
  }
  const scores  = examGrades.map(g => g.score);
  const avg     = Math.round(scores.reduce((s,n) => s+n, 0) / scores.length);
  const highest = Math.max(...scores);
  const lowest  = Math.min(...scores);
  const passed  = examGrades.filter(g => g.score >= exam.pass).length;
  const allG    = grades.filter(g => g.examId === examId);
  return {
    count:    examGrades.length,
    avg,
    highest,
    lowest,
    passed,
    failed:   examGrades.length - passed,
    passRate: Math.round(passed / examGrades.length * 100),
    absent:   allG.filter(g => g.absent).length,
  };
}

// ── Top students across all exams ────────────────────────────
export function getTopStudents(students, grades, exams, limit = 10) {
  return students
    .filter(s => s.status === 'active')
    .map(s => {
      const sg = grades.filter(g => g.studentId === s.id && !g.absent && g.score !== null);
      if (!sg.length) return null;
      const avgPct = sg.reduce((sum, g) => {
        const exam = exams.find(e => e.id === g.examId);
        return sum + (exam ? (g.score / exam.total) * 100 : 0);
      }, 0) / sg.length;
      return { ...s, avgPct: Math.round(avgPct), examCount: sg.length };
    })
    .filter(Boolean)
    .sort((a, b) => b.avgPct - a.avgPct)
    .slice(0, limit);
}

// ── Weak students (below 60%) ────────────────────────────────
export function getWeakStudents(students, grades, exams, threshold = 60) {
  return students
    .filter(s => s.status === 'active')
    .map(s => {
      const sg = grades.filter(g => g.studentId === s.id && !g.absent && g.score !== null);
      if (!sg.length) return null;
      const avgPct = sg.reduce((sum, g) => {
        const exam = exams.find(e => e.id === g.examId);
        return sum + (exam ? (g.score / exam.total) * 100 : 0);
      }, 0) / sg.length;
      const failCount = sg.filter(g => {
        const exam = exams.find(e => e.id === g.examId);
        return exam && g.score < exam.pass;
      }).length;
      return { ...s, avgPct: Math.round(avgPct), examCount: sg.length, failCount };
    })
    .filter(s => s && s.avgPct < threshold)
    .sort((a, b) => a.avgPct - b.avgPct);
}
