// src/store/slices/communication.slice.js
// ─────────────────────────────────────────────────────────────────────────────
// شريحة مركز التواصل — موديول مستقل تماماً.
// يملك: سجلات التواصل (communications) + مهام المتابعة (commTasks).
// السجلات لا تُحذف أبداً (أرشفة فقط).
// ─────────────────────────────────────────────────────────────────────────────

import {
  INITIAL_COMMUNICATIONS,
  INITIAL_COMM_TASKS,
} from '../../data/initialData';

export const createCommunicationSlice = (set) => ({
  // ── State ────────────────────────────────────────────────
  // Pre-Installer Audit C4: communications/commTasks no longer boot-sync from PostgreSQL
  // (db.middleware.js's PG_COLLECTIONS) — both are used live, exclusively, by
  // CommunicationPage.jsx, which now fetches and seeds them itself on mount via
  // setCommunications/setCommTasks below (same "fetch on the one page that needs it, not
  // at every login" pattern already established for payments/admissionPayments). These
  // seed defaults remain only as the pre-first-fetch placeholder.
  communications: INITIAL_COMMUNICATIONS,
  commTasks:      INITIAL_COMM_TASKS,
  // parents: Phase 3B-16 — PostgreSQL هو مصدر الحقيقة الوحيد لبيانات ولي الأمر
  // الإضافية (هاتف بديل/تفضيلات/ملاحظات) الآن. مُزامَنة إقلاعياً من PG_COLLECTIONS
  // (db.middleware.js)، ومُخزَّنة محلياً كـ cache فقط عبر partialize (app.store.js) —
  // لا parentExtras محلي منفصل إطلاقاً بعد الآن (كان مصدر تكرار، أُزيل بالكامل).
  parents:        [],

  // ── سجلات التواصل ─────────────────────────────────────────
  // C4 fix: seeds the whole collection on CommunicationPage.jsx's mount (replaces, doesn't
  // merge — safe because every write already goes server-first via pgCreate*/pgUpdate*
  // before any local state changes, so there is never unsynced local-only data to lose).
  setCommunications: (v) =>
    set((s) => ({ communications: typeof v === 'function' ? v(s.communications) : v })),

  addCommunication: (record) =>
    set((s) => ({ communications: [record, ...s.communications] })),

  updateCommunication: (id, updates) =>
    set((s) => ({
      communications: s.communications.map((r) =>
        r.id === id ? { ...r, ...updates, updatedAt: new Date().toISOString() } : r
      ),
    })),

  // أرشفة بدل الحذف (السجلات لا تُحذف)
  archiveCommunication: (id) =>
    set((s) => ({
      communications: s.communications.map((r) =>
        r.id === id ? { ...r, status: 'archived', updatedAt: new Date().toISOString() } : r
      ),
    })),

  // ── مهام المتابعة ─────────────────────────────────────────
  setCommTasks: (v) =>
    set((s) => ({ commTasks: typeof v === 'function' ? v(s.commTasks) : v })),

  addCommTask: (task) =>
    set((s) => ({ commTasks: [task, ...s.commTasks] })),

  updateCommTask: (id, updates) =>
    set((s) => ({
      commTasks: s.commTasks.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
    })),

  // ── parents (Phase 3B-16) ─────────────────────────────────
  setParents: (v) =>
    set((s) => ({ parents: typeof v === 'function' ? v(s.parents) : v })),
});
