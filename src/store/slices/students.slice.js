// src/store/slices/students.slice.js
// ─────────────────────────────────────────────────────────────────────────────
// لماذا Zustand بدلاً من useState في Context؟
//
// Context + useState:
//   تغيير students → re-render كل مكون يستهلك DataContext
//   حتى لو المكون يقرأ فقط payments وليس students
//
// Zustand + selectors:
//   تغيير students → re-render فقط المكونات التي تشترك في students
//   مكون يقرأ payments فقط؟ لا يُعاد render نهائياً
//
// المبدأ:
//   const students = useAppStore(s => s.students);       // يُعاد render عند تغيير students فقط
//   const payments = useAppStore(s => s.payments);       // لا علاقة بـ students
//   const count    = useAppStore(s => s.students.length); // derived — يُعاد render عند تغير الطول فقط
//
// ─────────────────────────────────────────────────────────────────────────────

// الـ slice هو دالة تأخذ set وget وتُرجع جزء من الـ store
// لا React imports هنا — pure state + pure functions
export const createStudentsSlice = (set, get) => ({
  // ── State ──────────────────────────────────────────────────────────────────
  students: INITIAL_STUDENTS,

  // ── Actions ────────────────────────────────────────────────────────────────
  // كل action تستدعي set() مع الـ state الجديد
  // set() في Zustand يعمل shallow merge — لا داعي لـ spread كامل

  addStudent: (newStudent) =>
    set((state) => ({
      students: [...state.students, newStudent],
    })),

  updateStudent: (id, updates) =>
    set((state) => ({
      students: state.students.map((s) =>
        s.id === id ? { ...s, ...updates, updatedAt: new Date().toISOString() } : s
      ),
    })),

  removeStudent: (id) =>
    set((state) => ({
      students: state.students.filter((s) => s.id !== id),
    })),

  // setStudents: للتوافق مع الكود القديم الذي يستدعي setStudents(prev => ...)
  // يدعم كلا الشكلين: setStudents(array) أو setStudents(fn)
  setStudents: (studentsOrUpdater) =>
    set((state) => ({
      students:
        typeof studentsOrUpdater === 'function'
          ? studentsOrUpdater(state.students)
          : studentsOrUpdater,
    })),

  // ── Selectors (computed values) ────────────────────────────────────────────
  // لا توجد selectors هنا — تُعرَّف في useAppStore للوصول السهل
  // مثال:  const activeStudents = useAppStore(s => s.students.filter(s => s.status === 'active'))
});
import { INITIAL_STUDENTS } from '../../data/initialData';
