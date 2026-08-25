// src/store/slices/attendance.slice.js

export const createAttendanceSlice = (set) => ({
  attendance:       INITIAL_ATTENDANCE,
  absenceFollowup:  INITIAL_ABSENCE_FOLLOWUP,

  setAttendance: (attendanceOrUpdater) =>
    set((state) => ({
      attendance:
        typeof attendanceOrUpdater === 'function'
          ? attendanceOrUpdater(state.attendance)
          : attendanceOrUpdater,
    })),

  setAbsenceFollowup: (valOrUpdater) =>
    set((state) => ({
      absenceFollowup:
        typeof valOrUpdater === 'function'
          ? valOrUpdater(state.absenceFollowup)
          : valOrUpdater,
    })),

  // action محددة: حفظ جلسة حضور كاملة (تحذف القديم وتضيف الجديد)
  saveAttendanceSession: (groupId, date, records) =>
    set((state) => ({
      attendance: [
        ...state.attendance.filter(
          (r) => !(r.groupId === groupId && r.date === date)
        ),
        ...records,
      ],
    })),
});
import { INITIAL_ATTENDANCE, INITIAL_ABSENCE_FOLLOWUP } from '../../data/initialData';
