// src/store/index.js
// ─────────────────────────────────────────────────────────────────────────────
// Barrel + Compatibility Shim — المرحلة 3
//
// التغيير الجوهري من المرحلة 2:
//   المرحلة 2: useApp() كان يقرأ من DataContext (useState واحد ضخم)
//              → أي تغيير في أي بيانات = re-render كل مكون يستخدم useApp()
//
//   المرحلة 3: useApp() يقرأ من Zustand store
//              → المكونات القديمة لا تزال تعمل بدون تعديل
//              → المكونات الجديدة/المحدَّثة تستخدم selectors محددة
//              → re-render مضبوط بدقة per-slice
//
// استراتيجية الـ shim:
//   useApp() يستخدم useAppStore(s => s) — يقرأ كل الـ state
//   هذا يعني مكونات useApp() تُعاد render عند أي تغيير
//   لكن هذا مقبول مؤقتاً لأن:
//   1. الـ layouts (Sidebar/Topbar) أُصلحت في المرحلة 2 — لا تستخدم useApp()
//   2. كل مكون جديد يستخدم selectors محددة
//   3. تحويل المكونات القديمة للـ selectors يحدث تدريجياً
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback }    from 'react';
import { useShallow }     from 'zustand/react/shallow';
import { useAppStore }    from './app.store';
import { useAuth }        from './auth.context';
import { useUI   }        from './ui.context';
import { useToast }       from '../components/Toast';
import { ROUTES }         from '../constants/routes';

// Named re-exports للكود الجديد
export { useAuth, AuthProvider } from './auth.context';
export { useUI,   UIProvider   } from './ui.context';
export { useAppStore }           from './app.store';
export { useData, DataProvider } from './data.context';

// Typed data selectors — للمكونات التي تُحدَّث لاحقاً
export {
  useCashboxes,
  useStudents, useGroups, usePayments, useAttendance, useAbsFollowup,
  useExams, useGrades, useHomeworks, useHwSubmissions,
  useMaterials, useMatDist, useTreasuryTxn, useTreasuryMeta,
  useActivityLogs, useStoreActions,
} from './app.store';

// ── Compatibility Shim — useApp() ─────────────────────────────────────────────
// يُحاكي AppContext القديم بالكامل
// كل مكون يستورد useApp من './context/AppContext' يستمر في العمل
export function useApp() {
  const auth  = useAuth();
  const ui    = useUI();
  const toast = useToast();

  // ✅ STEP 6 FIX: granular selectors بدل قراءة كل الـ state
  // كل selector مستقل — re-render فقط عند تغيير الـ slice المحدد
  const store = useAppStore(useShallow(s => ({
    // data
    students:      s.students,
    groups:        s.groups,
    payments:      s.payments,
    attendance:    s.attendance,
    absenceFollowup: s.absenceFollowup,
    exams:         s.exams,
    grades:        s.grades,
    homeworks:     s.homeworks,
    hwSubmissions: s.hwSubmissions,
    materials:     s.materials,
    matDist:       s.matDist,
    cashboxes:     s.cashboxes,
    treasuryTxn:   s.treasuryTxn,
    treasuryMeta:  s.treasuryMeta,
    addCashbox:    s.addCashbox,
    updateCashbox: s.updateCashbox,
    removeCashbox: s.removeCashbox,
    setDefaultCashbox: s.setDefaultCashbox,
    transferBetweenCashboxes: s.transferBetweenCashboxes,
    activityLogs:  s.activityLogs,
    // actions
    setStudents:   s.setStudents,
    setGroups:     s.setGroups,
    setPayments:   s.setPayments,
    setAttendance: s.setAttendance,
    addLog:        s.addLog,
    exportBackup:  s.exportBackup,
    saveAutoBackup: s.saveAutoBackup,
    addTreasuryTxn:     s.addTreasuryTxn,
    updateTreasuryTxn:  s.updateTreasuryTxn,
    reverseTreasuryTxn: s.reverseTreasuryTxn,
    updateTreasuryMeta: s.updateTreasuryMeta,
  })));

  const logout = useCallback(() => {
    // يُسجَّل قبل auth.logout() عمداً — الجلسة ما زالت سارية هنا، فالخادم يشتقّ
    // user_id الحقيقي من الجلسة الفعلية بدل جلسة أُنهيت للتو.
    store.addLog({
      action:      'logout',
      module:      'auth',
      entityType:  'user',
      entityId:    auth.currentUser?.id ?? null,
      description: `تسجيل خروج: ${auth.currentUser?.name || ''}`,
    }).catch((e) => toast.error(e.message || 'تعذّر تسجيل حدث الخروج في سجل النشاط'));
    auth.logout();
    ui.navigate(ROUTES.DASHBOARD);
  }, [auth, ui, store.addLog, toast]);

  const login = useCallback(async (userId, password) => {
    const result = await auth.login(userId, password);
    if (result?.success) {
      // result.name يأتي من استجابة الخادم مباشرة (Stabilization phase) — لا من
      // مصفوفة users محلية (أُزيلت، PostgreSQL هو مصدر الحقيقة الوحيد الآن)، ولا
      // من auth.currentUser (لن يعكس state المحدَّث بعد ضمن نفس اللفّة).
      store.addLog({
        action:      'login',
        module:      'auth',
        entityType:  'user',
        entityId:    userId,
        description: `تسجيل دخول: ${result.name || userId}`,
      }).catch((e) => toast.error(e.message || 'تعذّر تسجيل حدث الدخول في سجل النشاط'));
    }
    return result;
  }, [auth, store.addLog, toast]);

  const exportBackup = useCallback(() => {
    store.exportBackup(auth.currentUser?.id);
  }, [store.exportBackup, auth.currentUser]);

  return {
    // ── Auth ────────────────────────────────────────────────
    isLoggedIn:   auth.isLoggedIn,
    currentUser:  auth.currentUser,
    isAdmin:      auth.isAdmin,
    teachers:     auth.teachers,
    setTeachers:  auth.setTeachers,
    login,
    logout,
    canAccess:    auth.canAccess,

    // ── UI ──────────────────────────────────────────────────
    currentPage:       ui.currentPage,
    navigate:          ui.navigate,
    theme:             ui.theme,
    setTheme:          ui.setTheme,
    notifications:     ui.notifications,
    setNotifications:  ui.setNotifications,
    unreadNotifs:      ui.unreadNotifs,
    markNotifRead:     ui.markNotifRead,
    markAllNotifsRead: ui.markAllNotifsRead,

    // ── Data (من Zustand) ───────────────────────────────────
    students:           store.students,
    setStudents:        store.setStudents,
    groups:             store.groups,
    setGroups:          store.setGroups,
    payments:           store.payments,
    setPayments:        store.setPayments,
    attendance:         store.attendance,
    setAttendance:      store.setAttendance,
    absenceFollowup:    store.absenceFollowup,
    setAbsenceFollowup: store.setAbsenceFollowup,
    exams:              store.exams,
    setExams:           store.setExams,
    grades:             store.grades,
    setGrades:          store.setGrades,
    homeworks:          store.homeworks,
    setHomeworks:       store.setHomeworks,
    hwSubmissions:      store.hwSubmissions,
    setHwSubmissions:   store.setHwSubmissions,
    materials:          store.materials,
    setMaterials:       store.setMaterials,
    matDist:            store.matDist,
    setMatDist:         store.setMatDist,
    cashboxes:          store.cashboxes,
    addCashbox:         store.addCashbox,
    updateCashbox:      store.updateCashbox,
    removeCashbox:      store.removeCashbox,
    setDefaultCashbox:  store.setDefaultCashbox,
    transferBetweenCashboxes: store.transferBetweenCashboxes,
    treasuryTxn:        store.treasuryTxn,
    setTreasuryTxn:     store.setTreasuryTxn,
    treasuryMeta:       store.treasuryMeta,
    setTreasuryMeta:    store.setTreasuryMeta,
    activityLogs:       store.activityLogs,
    addLog:             store.addLog,
    exportBackup,
  };
}
