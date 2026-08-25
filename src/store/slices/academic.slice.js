import {
  INITIAL_EXAMS, INITIAL_GRADES,
  INITIAL_HOMEWORKS, INITIAL_HW_SUBMISSIONS,
} from '../../data/initialData';
// src/store/slices/academic.slice.js
// يجمع: exams + grades + homeworks + hwSubmissions
// سبب الجمع: هذه الأربعة دائماً تُستخدم معاً في نفس الـ features (Exams, Reports)
// فصلها لا يُقلّل re-renders لأن مكونات الامتحانات تحتاج كليهما دائماً

export const createAcademicSlice = (set) => ({
  // ── Exams ──────────────────────────────────────────────────────────────────
  exams:  INITIAL_EXAMS,
  grades: INITIAL_GRADES,

  setExams: (v) => set((s) => ({ exams:  typeof v === 'function' ? v(s.exams)  : v })),
  setGrades:(v) => set((s) => ({ grades: typeof v === 'function' ? v(s.grades) : v })),

  addExam: (exam) =>
    set((s) => ({ exams: [...s.exams, exam] })),

  updateExam: (id, updates) =>
    set((s) => ({ exams: s.exams.map((e) => e.id === id ? { ...e, ...updates } : e) })),

  removeExam: (id) =>
    set((s) => ({ exams: s.exams.filter((e) => e.id !== id) })),

  addGrade: (grade) =>
    set((s) => ({ grades: [...s.grades, grade] })),

  updateGrade: (id, updates) =>
    set((s) => ({ grades: s.grades.map((g) => g.id === id ? { ...g, ...updates } : g) })),

  // حفظ درجات امتحان كامل (تحذف القديم وتضيف الجديد)
  saveExamGrades: (examId, newGrades) =>
    set((s) => ({
      grades: [
        ...s.grades.filter((g) => g.examId !== examId),
        ...newGrades,
      ],
    })),

  // ── Homeworks ──────────────────────────────────────────────────────────────
  homeworks:     INITIAL_HOMEWORKS,
  hwSubmissions: INITIAL_HW_SUBMISSIONS,

  setHomeworks:     (v) => set((s) => ({ homeworks:     typeof v === 'function' ? v(s.homeworks)     : v })),
  setHwSubmissions: (v) => set((s) => ({ hwSubmissions: typeof v === 'function' ? v(s.hwSubmissions) : v })),

  addHomework: (hw) =>
    set((s) => ({ homeworks: [...s.homeworks, hw] })),

  updateHomework: (id, updates) =>
    set((s) => ({ homeworks: s.homeworks.map((h) => h.id === id ? { ...h, ...updates } : h) })),

  removeHomework: (id) =>
    set((s) => ({ homeworks: s.homeworks.filter((h) => h.id !== id) })),
});
