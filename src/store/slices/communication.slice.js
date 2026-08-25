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
  communications: INITIAL_COMMUNICATIONS,
  commTasks:      INITIAL_COMM_TASKS,
  // parents: Phase 3B-16 — PostgreSQL هو مصدر الحقيقة الوحيد لبيانات ولي الأمر
  // الإضافية (هاتف بديل/تفضيلات/ملاحظات) الآن. مُزامَنة إقلاعياً من PG_COLLECTIONS
  // (db.middleware.js)، ومُخزَّنة محلياً كـ cache فقط عبر partialize (app.store.js) —
  // لا parentExtras محلي منفصل إطلاقاً بعد الآن (كان مصدر تكرار، أُزيل بالكامل).
  parents:        [],

  // ── سجلات التواصل ─────────────────────────────────────────
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
