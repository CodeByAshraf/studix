// src/store/app.store.js
import { create }               from 'zustand';
import { devtools, persist }    from 'zustand/middleware';
import { createStudentsSlice }  from './slices/students.slice';
import { createGroupsSlice }    from './slices/groups.slice';
import { createPaymentsSlice }  from './slices/payments.slice';
import { createAttendanceSlice } from './slices/attendance.slice';
import { createAcademicSlice }  from './slices/academic.slice';
import { createMaterialsSlice } from './slices/materials.slice';
import { createInventorySlice } from './slices/inventory.slice';
import { createCommunicationSlice } from './slices/communication.slice';
import { createWaReportLogSlice } from './slices/waReportLog.slice';
import { createTreasurySlice }  from './slices/treasury.slice';
import { createActivitySlice }  from './slices/activity.slice';
import { createCenterProfileSlice } from './slices/centerProfile.slice';
import { createAdmissionsSlice } from './slices/admissions.slice';
import { storage }              from '../hooks/useErrorHandler';

// ── Store ─────────────────────────────────────────────────────
export const useAppStore = create()(
  devtools(
    persist(
      (set, get) => ({
        // ── Slices ──────────────────────────────────────────────
        ...createStudentsSlice(set, get),
        ...createGroupsSlice(set, get),
        ...createPaymentsSlice(set, get),
        ...createAttendanceSlice(set, get),
        ...createAcademicSlice(set, get),
        ...createMaterialsSlice(set, get),
        ...createInventorySlice(set, get),
        ...createCommunicationSlice(set, get),
        ...createWaReportLogSlice(set, get),
        ...createTreasurySlice(set, get),
        ...createActivitySlice(set, get),
        ...createCenterProfileSlice(set, get),
        ...createAdmissionsSlice(set, get),

        // ── Backup ────────────────────────────────────────────────
        exportBackup: (currentUserId) => {
          const s = get();
          const data = {
            students:      s.students,
            groups:        s.groups,
            payments:      s.payments,
            attendance:    s.attendance,
            exams:         s.exams,
            grades:        s.grades,
            homeworks:     s.homeworks,
            hwSubmissions: s.hwSubmissions,
            exportedAt:    new Date().toISOString(),
          };
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url  = URL.createObjectURL(blob);
          const a    = Object.assign(document.createElement('a'), {
            href: url,
            download: `studix-backup-${Date.now()}.json`,
          });
          a.click();
          URL.revokeObjectURL(url);
          // لا toast متاح من داخل action الـ store نفسه (خارج React tree) — فشل
          // تسجيل الحدث هنا best-effort صامت فقط (console.error)، لا يُبتلَع محلياً
          // (لا localStorage fallback إطلاقاً — Phase 3B-15 الصريح).
          s.addLog({ action: 'export', module: 'settings', description: 'تصدير نسخة احتياطية' })
            .catch((e) => console.error('[activityLog] فشل تسجيل حدث التصدير:', e.message));
        },

        // ── Auto-backup ───────────────────────────────────────────
        saveAutoBackup: () => {
          const s = get();
          try {
            storage.set('studix_autobackup', {
              savedAt: new Date().toISOString(),
              data: {
                students:   s.students,
                groups:     s.groups,
                payments:   s.payments,
                attendance: s.attendance,
                exams:      s.exams,
                grades:     s.grades,
              },
            });
          } catch {}
        },
      }),
      // ── persist options ────────────────────────────────────────
      {
        name: 'studix-v1',
        partialize: (state) => ({
          students:        state.students,
          groups:          state.groups,
          payments:        state.payments,
          attendance:      state.attendance,
          absenceFollowup: state.absenceFollowup,
          exams:           state.exams,
          grades:          state.grades,
          homeworks:       state.homeworks,
          hwSubmissions:   state.hwSubmissions,
          materials:       state.materials,
          invMaterials:      state.invMaterials,
          inventoryTxn:      state.inventoryTxn,
          inventorySettings: state.inventorySettings,
          communications:    state.communications,
          commTasks:         state.commTasks,
          parents:           state.parents,
          waReportLog:       state.waReportLog,
          cashboxes:       state.cashboxes,
          treasuryTxn:     state.treasuryTxn,
          treasuryMeta:    state.treasuryMeta,
          activityLogs:    state.activityLogs,
          centerProfile:   state.centerProfile,
          admissions:      state.admissions,
          // Phase 3B-13A/3B-14D — admissionFollowups/admissionSystemLog/admissionPayments
          // تُعاد جلبها من PostgreSQL عند الإقلاع على أي حال (نفس بقية الـ collections
          // أعلاه)، لكن تُدرَج هنا أيضاً للاتساق (نفس مبدأ admissions/payments/treasuryTxn).
          admissionFollowups: state.admissionFollowups,
          admissionSystemLog: state.admissionSystemLog,
          admissionPayments:  state.admissionPayments,
        }),
      }
    ),
    // ── devtools options ─────────────────────────────────────────
    { name: 'Studix — App Store' }
  )
);

// ── Selectors ─────────────────────────────────────────────────
export const useStudents     = () => useAppStore((s) => s.students);
export const useGroups       = () => useAppStore((s) => s.groups);
export const usePayments     = () => useAppStore((s) => s.payments);
export const useAttendance   = () => useAppStore((s) => s.attendance);
export const useAbsFollowup  = () => useAppStore((s) => s.absenceFollowup);
export const useExams        = () => useAppStore((s) => s.exams);
export const useGrades       = () => useAppStore((s) => s.grades);
export const useHomeworks    = () => useAppStore((s) => s.homeworks);
export const useHwSubmissions= () => useAppStore((s) => s.hwSubmissions);
export const useMaterials    = () => useAppStore((s) => s.materials);
export const useCashboxes    = () => useAppStore((s) => s.cashboxes);
export const useTreasuryTxn  = () => useAppStore((s) => s.treasuryTxn);
export const useTreasuryMeta = () => useAppStore((s) => s.treasuryMeta);
export const useActivityLogs = () => useAppStore((s) => s.activityLogs);

export const useStoreActions = () => useAppStore((s) => ({
  // students
  addStudent:    s.addStudent,
  updateStudent: s.updateStudent,
  removeStudent: s.removeStudent,
  setStudents:   s.setStudents,
  // groups
  addGroup:      s.addGroup,
  updateGroup:   s.updateGroup,
  removeGroup:   s.removeGroup,
  setGroups:     s.setGroups,
  // payments
  addPayment:    s.addPayment,
  updatePayment: s.updatePayment,
  removePayment: s.removePayment,
  setPayments:   s.setPayments,
  // attendance
  setAttendance:         s.setAttendance,
  saveAttendanceSession: s.saveAttendanceSession,
  setAbsenceFollowup:    s.setAbsenceFollowup,
  // academic
  setExams:         s.setExams,
  setGrades:        s.setGrades,
  saveExamGrades:   s.saveExamGrades,
  setHomeworks:     s.setHomeworks,
  setHwSubmissions: s.setHwSubmissions,
  // materials
  setMaterials: s.setMaterials,
  // treasury
  setTreasuryTxn:      s.setTreasuryTxn,
  setTreasuryMeta:     s.setTreasuryMeta,
  addTreasuryTxn:      s.addTreasuryTxn,
  updateTreasuryTxn:   s.updateTreasuryTxn,
  reverseTreasuryTxn:  s.reverseTreasuryTxn,
  updateTreasuryMeta:  s.updateTreasuryMeta,
  addCashbox:               s.addCashbox,
  updateCashbox:            s.updateCashbox,
  removeCashbox:            s.removeCashbox,
  setDefaultCashbox:        s.setDefaultCashbox,
  transferBetweenCashboxes: s.transferBetweenCashboxes,
  // activity
  addLog:    s.addLog,
  // backup
  exportBackup:   s.exportBackup,
  saveAutoBackup: s.saveAutoBackup,
}));
