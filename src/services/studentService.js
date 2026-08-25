// src/services/studentService.js
// Backend API version — async functions calling REST API
import { sanitizeText } from '../utils/sanitize';
import { generateCode } from '../utils/helpers';
import {
  validate, hasErrors, sanitizeFormData,
  studentSchema, validators,
} from '../utils/validation';

// ── Validation (يبقى synchronous للـ UI feedback الفوري) ────────────────────
export function validateStudent(data, existingStudents = [], editId = null) {
  const errors = validate(studentSchema, data);

  if (!errors.phone && data.phone) {
    const duplicate = existingStudents.find(
      (s) => s.phone === data.phone.trim() && s.id !== editId
    );
    if (duplicate) errors.phone = 'رقم الهاتف مسجّل بالفعل';
  }

  if (data.parentPhone?.trim()) {
    const phoneError = validators.egyptPhone(data.parentPhone);
    if (phoneError) errors.parentPhone = phoneError;
  }

  return errors;
}

// ── Create → POST /api/students ────────────────────────────────────────────
export function createStudent(data, existingStudents) {
  const errors = validateStudent(data, existingStudents);
  if (hasErrors(errors)) throw { type: 'VALIDATION', errors };

  const clean = sanitizeStudentData(data);
  return {
    ...clean,
    id:         `s${Date.now()}`,
    code:       generateCode('TC', existingStudents.length + 1),
    enrollDate: new Date().toISOString().split('T')[0],
    createdAt:  new Date().toISOString(),
    updatedAt:  new Date().toISOString(),
  };
}

// ── Update → PUT /api/students/:id ─────────────────────────────────────────
export function updateStudent(id, data, existingStudents) {
  const errors = validateStudent(data, existingStudents, id);
  if (hasErrors(errors)) throw { type: 'VALIDATION', errors };

  const clean = sanitizeStudentData(data);
  return { ...clean, id, updatedAt: new Date().toISOString() };
}


// ── Filter/Search (client-side — البيانات موجودة في Zustand) ───────────────
export function filterStudents(students, { query, grade, groupId, status }) {
  const q = (query || '').toLowerCase().trim();
  return students.filter((s) => {
    if (q && ![s.name, s.code, s.phone, s.school || ''].some((f) => f.toLowerCase().includes(q))) return false;
    if (grade   && s.grade   !== grade)   return false;
    if (groupId && s.groupId !== groupId) return false;
    if (status  && s.status  !== status)  return false;
    return true;
  });
}

// ── Stats (client-side) ────────────────────────────────────────────────────
export function getStudentStats(studentId, { attendance, payments, grades, exams }) {
  const attRecs   = attendance.filter((a) => a.studentId === studentId);
  const payRecs   = payments.filter((p) => p.studentId === studentId);
  const gradeRecs = grades.filter((g) => g.studentId === studentId && !g.absent && g.score !== null);

  const attPct = attRecs.length
    ? Math.round(attRecs.filter((a) => a.status === 'present').length / attRecs.length * 100)
    : null;

  const avgScore = gradeRecs.length
    ? Math.round(gradeRecs.reduce((acc, g) => {
        const exam = exams.find((e) => e.id === g.examId);
        return acc + (exam ? Math.round(g.score / exam.total * 100) : 0);
      }, 0) / gradeRecs.length)
    : null;

  const lastPayment = [...payRecs].sort((a, b) => b.date.localeCompare(a.date))[0];
  return { attPct, avgScore, lastPayment, attCount: attRecs.length };
}

function sanitizeStudentData(data) {
  const clean = sanitizeFormData(data, ['name', 'phone', 'parentPhone', 'school', 'notes']);
  return {
    name:        clean.name.trim(),
    phone:       clean.phone.trim(),
    parentPhone: clean.parentPhone?.trim() || '',
    grade:       clean.grade,
    groupId:     clean.groupId,
    school:      clean.school?.trim() || '',
    notes:       clean.notes?.trim() || '',
    status:      clean.status || 'active',
    monthlyFee:  data.monthlyFee != null && data.monthlyFee !== '' ? Number(data.monthlyFee) : null,
  };
}
