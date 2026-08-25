// src/hooks/useAttendance.js
// المرحلة 3: Zustand selectors
// saveAttendanceSession تستخدم action محددة في الـ store بدلاً من setAttendance يدوياً
import { useCallback }        from 'react';
import { useAppStore }        from '../store/app.store';
import { useAuth }            from '../store/auth.context';
import { useToast }           from '../components/Toast';
import { useErrorHandler }    from './useErrorHandler';
import {
  buildSessionRecords,
  getAttendanceStats,
  getFrequentAbsentees,
} from '../services/attendanceService';

export default function useAttendance() {
  // Granular subscriptions
  const attendance          = useAppStore((s) => s.attendance);
  const students            = useAppStore((s) => s.students);
  const saveAttendanceSession = useAppStore((s) => s.saveAttendanceSession);
  const setAttendance       = useAppStore((s) => s.setAttendance);
  const addLog              = useAppStore((s) => s.addLog);

  const { currentUser } = useAuth();
  const toast           = useToast();
  const { loading, run }= useErrorHandler(toast);

  const saveSession = useCallback(async (sessionData) => {
    return run(async () => {
      const { groupId, date, sessionTime, marks } = sessionData;

      // buildSessionRecords: pure function من attendanceService
      // تُحوّل marks object لـ attendance records
      const newRecords = buildSessionRecords(marks, groupId, date, sessionTime);

      // saveAttendanceSession: atomic action في الـ store
      // تحذف القديم وتضيف الجديد في operation واحدة
      saveAttendanceSession(groupId, date, newRecords);

      addLog({
        userName:    currentUser?.id,
        action:      'create',
        module:      'attendance',
        description: `حصة: ${groupId} — ${date}`,
      });
      toast.success(`تم حفظ سجل الحضور (${newRecords.length} طالب) ✓`);
      return newRecords;
    }, { errorMsg: 'فشل حفظ سجل الحضور' });
  }, [saveAttendanceSession, run, toast, addLog, currentUser]);

  const getStats     = useCallback(
    (studentId) => getAttendanceStats(studentId, attendance),
    [attendance],
  );

  const getAbsentees = useCallback(
    (threshold) => getFrequentAbsentees(students, attendance, threshold),
    [students, attendance],
  );

  return { attendance, saveSession, setAttendance, getStats, getAbsentees, loading };
}
