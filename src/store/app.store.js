// src/store/app.store.js
import { create }               from 'zustand';
import { devtools, persist, createJSONStorage } from 'zustand/middleware';
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
import { createReportSettingsSlice } from './slices/reportSettings.slice';
import { pgGetPayments, pgGetGrades, pgGetHomeworks, pgGetHwSubmissions } from '../services/api';

// ── Persistence (localStorage['studix-v1']) ───────────────────
// P2 Fix A — only genuinely local/client-owned state is persisted. Everything server-owned
// (students, groups, payments, attendance, treasury, inventory, admissions, logs, …) lives
// in PostgreSQL and is re-fetched by boot-sync / scoped reads; a browser copy only
// duplicated it and could exhaust the localStorage quota.
export const PERSIST_NAME    = 'studix-v1';
export const PERSIST_VERSION = 1;

// materials: legacy local-only list (no PG table). treasuryMeta: legacy local compat.
// reportConfig: per-browser report section flags. centerProfile.slogan: no DB column.
export function pickLocalState(state) {
  const s = state && typeof state === 'object' ? state : {};
  const local = {};
  if (s.reportConfig !== undefined) local.reportConfig = s.reportConfig;
  if (s.treasuryMeta !== undefined) local.treasuryMeta = s.treasuryMeta;
  if (s.materials    !== undefined) local.materials    = s.materials;
  if (s.centerProfile && typeof s.centerProfile === 'object' && s.centerProfile.slogan !== undefined) {
    local.centerProfile = { slogan: s.centerProfile.slogan };
  }
  return local;
}

// A failed localStorage write (QuotaExceededError, storage disabled, …) must never throw out
// of set(): the in-memory update has already happened and server writes are independent, so
// a persistence failure is logged for diagnostics and otherwise ignored.
const jsonStorage = createJSONStorage(() => localStorage);
export const safePersistStorage = {
  getItem: (name) => {
    try { return jsonStorage ? jsonStorage.getItem(name) : null; }
    catch (e) { console.warn(`[persist] failed to read "${name}":`, e?.name, e?.message); return null; }
  },
  setItem: (name, value) => {
    try { jsonStorage?.setItem(name, value); }
    catch (e) { console.error(`[persist] failed to write "${name}" (in-memory state unaffected):`, e?.name, e?.message); }
  },
  removeItem: (name) => {
    try { jsonStorage?.removeItem(name); }
    catch (e) { console.warn(`[persist] failed to remove "${name}":`, e?.name, e?.message); }
  },
};

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
        ...createReportSettingsSlice(set, get),

        // ── Backup (Scalability Architecture — payments PG_COLLECTIONS cutover prep) ──
        // payments لم يعد يُضمَّن ضمن boot-sync الكامل بالضرورة (المرحلة التالية تُزيله من
        // PG_COLLECTIONS) — state.payments الشامل لم يعد مصدر حقيقة موثوقاً لعدد/تاريخ كل
        // الدفعات. exportBackup (تصدير يدوي، نادر — زر واحد في الإعدادات) يجلب المجموعة
        // الكاملة طازجة من GET /api/payments (بلا فلاتر، نفس الشكل الذي كان boot-sync
        // يوفّره بالضبط) بدل قراءتها من الـ store — يحافظ على محتوى/شكل الملف المُصدَّر
        // حرفياً كما كان. غير متزامنة الآن (fetch شبكة) — المُستدعي (SettingsPage.jsx)
        // يتولّى حالة الانتظار/الخطأ.
        // Grades + Homework global-read migration, Phase 3 (final cutover): grades/homeworks/
        // hwSubmissions left PG_COLLECTIONS too, so the store copies are no longer a complete
        // snapshot (empty on a fresh browser) — fetched fresh here by the exact same mechanism
        // as payments (unfiltered scoped GETs, same normalized shape boot-sync used to produce).
        exportBackup: async (currentUserId) => {
          const s = get();
          const [payments, grades, homeworks, hwSubmissions] = await Promise.all([
            pgGetPayments({}), pgGetGrades({}), pgGetHomeworks(), pgGetHwSubmissions({}),
          ]);
          const data = {
            students:      s.students,
            groups:        s.groups,
            payments,
            attendance:    s.attendance,
            exams:         s.exams,
            grades,
            homeworks,
            hwSubmissions,
            exportedAt:    new Date().toISOString(),
          };
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url  = URL.createObjectURL(blob);
          const a    = Object.assign(document.createElement('a'), {
            href: url,
            download: `studix-data-export-${Date.now()}.json`,
          });
          a.click();
          URL.revokeObjectURL(url);
          // لا toast متاح من داخل action الـ store نفسه (خارج React tree) — فشل
          // تسجيل الحدث هنا best-effort صامت فقط (console.error)، لا يُبتلَع محلياً
          // (لا localStorage fallback إطلاقاً — Phase 3B-15 الصريح).
          s.addLog({ action: 'export', module: 'settings', description: 'تصدير البيانات (JSON)' })
            .catch((e) => console.error('[activityLog] فشل تسجيل حدث التصدير:', e.message));
        },
      }),
      // ── persist options ────────────────────────────────────────
      {
        name:       PERSIST_NAME,
        version:    PERSIST_VERSION,
        storage:    safePersistStorage,
        partialize: (state) => pickLocalState(state),
        // v0 (every build before P2 Fix A) persisted a full server-owned snapshot (students,
        // payments, attendance, treasuryTxn, …) that could outgrow the localStorage quota.
        // Only the local-only fields survive; persist then rewrites the key with the small
        // v1 shape, replacing the old large blob in place.
        migrate:    (persistedState) => pickLocalState(persistedState),
        // Filtered again here (not only in migrate): a snapshot with a missing/odd version
        // skips migrate entirely, and server-owned rows must never re-enter the store from
        // localStorage. centerProfile merges field-wise so only `slogan` comes from storage.
        merge: (persistedState, currentState) => {
          const local = pickLocalState(persistedState);
          return {
            ...currentState,
            ...local,
            centerProfile: { ...currentState.centerProfile, ...local.centerProfile },
          };
        },
      }
    ),
    // ── devtools options ─────────────────────────────────────────
    { name: 'Studix — App Store' }
  )
);

// ── BUG-04: session-boundary reset ─────────────────────────────────────────────
// نقطة مركزية واحدة (لا حراسة مخصّصة في كل شاشة) تُستدعى من auth.context.jsx عند
// حدود الجلسة (تسجيل خروج، وقبل إعادة المزامنة بعد تسجيل دخول ناجح). بدونها، persist
// (أعلاه) يُبقي كل هذه المجموعات في localStorage['studix-v1'] بلا أي تغيير عبر تسجيل
// الخروج — فمستخدم لاحق أقل صلاحية على نفس المتصفح (جهاز استقبال مُشترَك مثلاً) كان
// يستمرّ يرى بيانات مالية/تجارية حقيقية من جلسة المستخدم السابق (مثال حقيقي مؤكَّد:
// إيراد Dashboard.jsx يُقرَأ من payments/treasuryTxn المخزَّنين مباشرة، بلا فحص صلاحية
// على مستوى الحقل — الحماية الوحيدة قبل هذا الإصلاح كانت صلاحية المسار 'dashboard'
// نفسها، منفصلة تماماً عن صلاحيتَي 'payments'/'treasury' الفعليتين).
//
// عمداً لا يُصفِّر centerProfile/inventorySettings/treasuryMeta — هذه إعدادات تنظيمية
// للمركز نفسه (اسم/شعار/حدود مخزون...)، لا سجلات جلسة مستخدم حسّاسة، ولا داعي لمسحها
// (قرار صريح: "لا تمسح إعدادات غير ذات صلة إلا عند الضرورة").
export function resetAppStore() {
  useAppStore.setState({
    students: [], groups: [], payments: [], attendance: [], absenceFollowup: [],
    exams: [], grades: [], homeworks: [], hwSubmissions: [], materials: [],
    invMaterials: [], inventoryTxn: [], communications: [], commTasks: [],
    parents: [], waReportLog: [], cashboxes: [], treasuryTxn: [], activityLogs: [],
    admissions: [], admissionFollowups: [], admissionSystemLog: [], admissionPayments: [],
  });
  // يمسح المفتاح الفعلي في localStorage أيضاً (لا يكتفي بالذاكرة) — دفاع إضافي: لو
  // تعطّلت الصفحة قبل أن تُثبَّت أول عملية تحميل (rehydrate) لاحقة، لا يبقى أي أثر قديم.
  try { useAppStore.persist.clearStorage(); } catch {}
}

// ── Selectors ─────────────────────────────────────────────────
export const useStudents     = () => useAppStore((s) => s.students);
export const useGroups       = () => useAppStore((s) => s.groups);
export const usePayments     = () => useAppStore((s) => s.payments);
export const useAttendance   = () => useAppStore((s) => s.attendance);
export const useAbsFollowup  = () => useAppStore((s) => s.absenceFollowup);
export const useExams        = () => useAppStore((s) => s.exams);
// Phase 1E (Grades global-read migration) — useGrades removed: proven to have zero callers
// anywhere in the app (every real Grades consumer reads `useAppStore((s) => s.grades)`
// directly or, post-migration, a scoped/aggregate fetch — never this selector). It was
// already dead before this migration, not made dead by it; `grades` itself stays in
// PG_COLLECTIONS and the slice's write actions (setGrades/addGrade/updateGrade/
// saveExamGrades) are untouched — only this one unused read selector is removed.
// Phase 2G (Homework global-read migration) — useHomeworks/useHwSubmissions removed: proven to
// have zero callers anywhere in the repo (same situation as useGrades above). homeworks/
// hwSubmissions stay in PG_COLLECTIONS and the slice's state + write actions are untouched.
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
}));
