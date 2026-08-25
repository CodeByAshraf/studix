// src/hooks/useStudents.js
// ─────────────────────────────────────────────────────────────────────────────
// المرحلة 3: يستخدم Zustand selectors بدلاً من useApp()
//
// الفرق الجوهري:
//   قبل: const { students, setStudents, ... } = useApp()
//        → re-render عند تغيير أي شيء في AppContext
//
//   بعد: const students = useAppStore(s => s.students)
//        → re-render فقط عند تغيير students
//        const setStudents = useAppStore(s => s.setStudents)
//        → هذا لا يُعيد render أبداً (function ثابتة)
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useMemo, useCallback } from 'react';
import { useAppStore }        from '../store/app.store';
import { useAuth }            from '../store/auth.context';
import { useToast }           from '../components/Toast';
import { useErrorHandler }    from './useErrorHandler';
import {
  filterStudents, createStudent, updateStudent, getStudentStats,
} from '../services/studentService';
import { paginate, debounce } from '../utils/helpers';
import { PAGINATION } from '../config/app.config';

const PAGE_SIZE = PAGINATION.STUDENTS_PAGE_SIZE;

export default function useStudents() {
  // ── Zustand selectors — granular subscriptions ────────────────────────────
  const students       = useAppStore((s) => s.students);
  const attendance     = useAppStore((s) => s.attendance);
  const payments       = useAppStore((s) => s.payments);
  const grades         = useAppStore((s) => s.grades);
  const exams          = useAppStore((s) => s.exams);
  // Actions — لا تُسبب re-render (functions ثابتة في Zustand)
  const setStudents    = useAppStore((s) => s.setStudents);
  const addLog         = useAppStore((s) => s.addLog);

  const { currentUser } = useAuth();
  const toast  = useToast();
  const { loading, run } = useErrorHandler(toast);

  // ── Filter state ──────────────────────────────────────────────────────────
  const [filters, setFilters] = useState({ query: '', grade: '', groupId: '', status: '' });
  const [page,    setPage]    = useState(1);

  // ── Computed ──────────────────────────────────────────────────────────────
  const filtered  = useMemo(() => filterStudents(students, filters), [students, filters]);
  const paginated = useMemo(() => paginate(filtered, page, PAGE_SIZE), [filtered, page]);

  // ── Filter helpers ────────────────────────────────────────────────────────
  const setQuery   = useMemo(
    () => debounce((q) => { setFilters((f) => ({ ...f, query: q })); setPage(1); }, 250),
    [],
  );
  const setGrade   = useCallback((v) => { setFilters((f) => ({ ...f, grade:   v })); setPage(1); }, []);
  const setGroupId = useCallback((v) => { setFilters((f) => ({ ...f, groupId: v })); setPage(1); }, []);
  const setStatus  = useCallback((v) => { setFilters((f) => ({ ...f, status:  v })); setPage(1); }, []);
  const clearFilters = useCallback(() => { setFilters({ query:'', grade:'', groupId:'', status:'' }); setPage(1); }, []);

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const addStudent = useCallback(async (formData) => {
    return run(async () => {
      const newStudent = createStudent(formData, students);
      setStudents((prev) => [...prev, newStudent]);
      addLog({ userName: currentUser?.id, action: 'create', module: 'students', description: `إضافة طالب: ${newStudent.name}` });
      toast.success(`تم تسجيل ${newStudent.name} بنجاح ✓`);
      return newStudent;
    }, { errorMsg: 'فشل تسجيل الطالب' });
  }, [students, setStudents, run, toast, addLog, currentUser]);

  const editStudent = useCallback(async (id, formData) => {
    return run(async () => {
      const updated = updateStudent(id, formData, students);
      setStudents((prev) => prev.map((s) => s.id === id ? { ...s, ...updated } : s));
      addLog({ userName: currentUser?.id, action: 'update', module: 'students', description: `تعديل: ${updated.name}` });
      toast.success(`تم تعديل بيانات ${updated.name}`);
      return updated;
    }, { errorMsg: 'فشل تعديل بيانات الطالب' });
  }, [students, setStudents, run, toast, addLog, currentUser]);

  const removeStudent = useCallback(async (id) => {
    const student = students.find((s) => s.id === id);
    return run(async () => {
      setStudents((prev) => prev.filter((s) => s.id !== id));
      addLog({ userName: currentUser?.id, action: 'delete', module: 'students', description: `حذف: ${student?.name}` });
      toast.info(`تم حذف ${student?.name}`);
    }, { errorMsg: 'فشل حذف الطالب' });
  }, [students, setStudents, run, toast, addLog, currentUser]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const getStats = useCallback(
    (studentId) => getStudentStats(studentId, { attendance, payments, grades, exams }),
    [attendance, payments, grades, exams],
  );

  return {
    students, filtered, paginated, page, setPage, filters,
    setQuery, setGrade, setGroupId, setStatus, clearFilters,
    addStudent, editStudent, removeStudent,
    getStats, loading,
  };
}
