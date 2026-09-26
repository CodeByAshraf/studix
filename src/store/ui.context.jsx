// src/store/ui.context.jsx
// ─────────────────────────────────────────────────────────────────────────────
// UIContext — المرحلة الأخيرة: متكامل مع React Router v6
//
// navigate() الآن:
//   1. يُحدّث currentPage في UIContext (للـ Sidebar active state)
//   2. يُحدّث URL في المتصفح عبر React Router (Back/Forward يعمل)
//
// المكونات القديمة تستدعي navigate('students') — يُحوَّل لـ /students تلقائياً
// ─────────────────────────────────────────────────────────────────────────────
import {
  createContext, useContext, useState, useCallback, useMemo, useEffect,
} from 'react';
import { storage } from '../hooks/useErrorHandler';
import { DEFAULT_THEME } from '../constants/theme';
import { ROUTES }        from '../constants/routes';
import { useAppStore } from './app.store';
import { generateReminders } from '../modules/communication/reminderService';
import { deriveNotifications, deriveAbsenceNotifications } from '../services/notificationService';
import { classifyAbsenceFollowups } from '../services/attendanceService';
import { pgGetCollection } from '../services/api';
import { normalizeCollectionForMerge } from './db.middleware';

const UIContext = createContext(null);

// Product Completion Phase 1, Issue 4: read/dismissed state has nowhere to live on the
// underlying source records (communications/commTasks have no read/dismissed concept),
// so it's kept here as a small, purely local set of derived-notification-ids — same
// category of local-only state as tc_theme, not business data, not synced to Postgres.
const NOTIF_READ_IDS_KEY = 'tc_notif_read_ids';

export function UIProvider({ children, canAccess }) {
  const [currentPage,    setCurrentPage]    = useState(ROUTES.DASHBOARD);
  const [theme,          setThemeState]     = useState(() => storage.get('tc_theme', DEFAULT_THEME));

  // ── Notifications (Issue 4 — derived, not independently stored) ────────────
  // communications/commTasks are read-only here (Issue 4 reads them read-only;
  // reminderService.js itself is never modified). Zustand needs no Provider — useAppStore
  // is reachable directly from any component, so no new prop threading into UIProvider is
  // needed for this.
  //
  // Pre-Installer Audit C4: communications/commTasks no longer boot-sync from PostgreSQL
  // (db.middleware.js's PG_COLLECTIONS) — CommunicationPage.jsx fetches its own copy on
  // mount, but UIProvider wraps the WHOLE app and this notification bell must stay
  // populated even when that page is never visited in the session. UIProvider mounts
  // exactly once at app start, so fetching here once mirrors the old boot-sync's timing
  // and freshness exactly — best-effort (console.warn only, no toast — this is a
  // background derivation, not a user-initiated action, same principle as
  // db.middleware.js's own per-collection failure handling).
  const setCommunications = useAppStore((s) => s.setCommunications);
  const setCommTasks      = useAppStore((s) => s.setCommTasks);
  useEffect(() => {
    let cancelled = false;
    pgGetCollection('communications')
      .then((data) => { if (!cancelled) setCommunications(normalizeCollectionForMerge('communications', data)); })
      .catch((err) => console.warn('[UIProvider] فشل جلب communications للتذكيرات:', err.message));
    pgGetCollection('commTasks')
      .then((data) => { if (!cancelled) setCommTasks(normalizeCollectionForMerge('commTasks', data)); })
      .catch((err) => console.warn('[UIProvider] فشل جلب commTasks للتذكيرات:', err.message));
    return () => { cancelled = true; };
  }, [setCommunications, setCommTasks]);

  const communications = useAppStore((s) => s.communications);
  const commTasks      = useAppStore((s) => s.commTasks);
  const reminders    = useMemo(() => generateReminders(communications, commTasks), [communications, commTasks]);

  // متابعة الغياب المتأخرة — نفس مبدأ communications/commTasks أعلاه بالضبط: قراءة من
  // Zustand الموجود بالفعل (بلا أي تخزين/API/متجر جديد)، تصنيف نقي (classifyAbsenceFollowups)
  // ثم اشتقاق إشعارات (deriveAbsenceNotifications) — deriveNotifications نفسها لا تُعدَّل.
  const attendance      = useAppStore((s) => s.attendance);
  const absenceFollowup = useAppStore((s) => s.absenceFollowup);
  const students        = useAppStore((s) => s.students);
  const groups          = useAppStore((s) => s.groups);
  const { overdue: overdueAbsences } = useMemo(
    () => classifyAbsenceFollowups(attendance, absenceFollowup, students),
    [attendance, absenceFollowup, students],
  );

  const derivedNotifs = useMemo(
    () => [...deriveNotifications(reminders), ...deriveAbsenceNotifications(overdueAbsences, groups)],
    [reminders, overdueAbsences, groups],
  );

  const [readIds, setReadIds] = useState(() => new Set(storage.get(NOTIF_READ_IDS_KEY, [])));

  // تقليم آلي: أي id مقروء لتذكير حُلّ/انتهى (لم يعد ضمن القائمة المُشتقّة حالياً) يُحذَف
  // هنا تلقائياً — يمنع تراكم بلا نهاية، بلا حاجة لأي منطق "انتهاء صلاحية" صريح.
  useEffect(() => {
    setReadIds((prev) => {
      const currentIds = new Set(derivedNotifs.map((n) => n.id));
      const pruned = new Set([...prev].filter((id) => currentIds.has(id)));
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [derivedNotifs]);

  useEffect(() => {
    storage.set(NOTIF_READ_IDS_KEY, Array.from(readIds));
  }, [readIds]);

  const notifications = useMemo(
    () => derivedNotifs.map((n) => (readIds.has(n.id) ? { ...n, read: true } : n)),
    [derivedNotifs, readIds],
  );

  // React Router navigate fn — يُسجَّل من RouterNavigate component
  const [rrNavigateFn,   setRrNavigateFn]   = useState(null);

  // ── Register React Router navigate ────────────────────────────────────────
  // يُستدعى من RouterNavigate component داخل BrowserRouter
  const registerNavigate = useCallback((fn) => {
    setRrNavigateFn(() => fn);
  }, []);

  // ── Theme ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    storage.set('tc_theme', theme);
  }, [theme]);

  const setTheme = useCallback((t) => setThemeState(t), []);

  // ── Navigate ──────────────────────────────────────────────────────────────
  // يُحدّث UIContext state + React Router URL في نفس الوقت
  // query اختياري — يضيف query string للانتقال المباشر (deep link)، مثل "متابعة الآن" في
  // إشعار الغياب (?view=followup&attendanceId=...). كل استدعاء موجود بالفعل بمعامل واحد
  // فقط يبقى يعمل بلا أي تغيير — لا يُغيَّر currentPage/syncFromUrl (يعتمدان على pathname
  // فقط، غير مُتأثِّرَين بـ query string).
  const navigate = useCallback((pageId, query) => {
    if (!canAccess || canAccess(pageId)) {
      setCurrentPage(pageId);
      // Push to browser history if React Router is available
      if (rrNavigateFn) {
        const base = pageId === ROUTES.DASHBOARD ? '/' : `/${pageId}`;
        const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
        rrNavigateFn(base + qs);
      }
    }
  }, [canAccess, rrNavigateFn]);

  // ── Sync URL → currentPage (Back/Forward button) ──────────────────────────
  const syncFromUrl = useCallback((pathname) => {
    const pageId = pathname.replace('/', '') || ROUTES.DASHBOARD;
    const validRoute = Object.values(ROUTES).includes(pageId);
    if (validRoute) setCurrentPage(pageId);
    else setCurrentPage(ROUTES.DASHBOARD);
  }, []);

  // ── Notifications ──────────────────────────────────────────────────────────
  const unreadNotifs = useMemo(
    () => notifications.filter(n => !n.read).length,
    [notifications],
  );

  const markNotifRead = useCallback((id) => {
    setReadIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const markAllNotifsRead = useCallback(() => {
    setReadIds((prev) => {
      const next = new Set(prev);
      for (const n of derivedNotifs) next.add(n.id);
      return next;
    });
  }, [derivedNotifs]);

  const value = useMemo(() => ({
    currentPage,
    navigate,
    syncFromUrl,
    registerNavigate,
    theme,
    setTheme,
    notifications,
    unreadNotifs,
    markNotifRead,
    markAllNotifsRead,
  }), [
    currentPage, navigate, syncFromUrl, registerNavigate,
    theme, setTheme,
    notifications, unreadNotifs,
    markNotifRead, markAllNotifsRead,
  ]);

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within UIProvider');
  return ctx;
}
