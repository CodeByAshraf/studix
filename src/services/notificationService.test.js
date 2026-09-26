// src/services/notificationService.test.js
// Product Completion Phase 1 — Issue 4 (Option A). Pure-function test of
// deriveNotifications — no React, no network. Mirrors the deriveMatDist/
// reportData.bookletDeliveries pure-function test pattern already established this
// session. Verifies: correct mapping from reminderService.js's reminder shapes to the
// notification shape NotificationsPage.jsx expects; correct type assignment; every
// freshly-derived item defaults to unread (read-state layering itself lives in
// ui.context.jsx, tested separately).
import { describe, it, expect } from 'vitest';
import { deriveNotifications, deriveAbsenceNotifications } from './notificationService';

function emptyReminders(overrides = {}) {
  return {
    todayFollowups: [], overdueFollowups: [], tomorrowFollowups: [],
    priorityTasks: [], repeatedNoAnswer: [], paymentPromisesDue: [],
    ...overrides,
  };
}

describe('deriveNotifications', () => {
  it('returns an empty list when reminderService.js has nothing to report', () => {
    expect(deriveNotifications(emptyReminders())).toEqual([]);
  });

  it('maps an overdue follow-up to a system-type, urgent notification', () => {
    const r = { id: 'c1', studentName: 'أحمد علي', followupDate: '2026-08-10' };
    const out = deriveNotifications(emptyReminders({ overdueFollowups: [r] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'notif-overdue-c1', type: 'system', urgent: true, read: false });
    expect(out[0].title).toContain('متأخرة');
    expect(out[0].body).toContain('أحمد علي');
  });

  it('maps a due-today follow-up to a system-type, non-urgent notification', () => {
    const r = { id: 'c2', studentName: 'سارة محمد', followupDate: '2026-08-23' };
    const out = deriveNotifications(emptyReminders({ todayFollowups: [r] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'notif-today-c2', type: 'system', urgent: false, read: false });
  });

  it('maps a repeated-no-answer parent to a system-type, urgent notification including the count', () => {
    const p = { key: '201123456789', parentName: 'ولي أمر محمد', phone: '201123456789', count: 4 };
    const out = deriveNotifications(emptyReminders({ repeatedNoAnswer: [p] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'notif-noanswer-201123456789', type: 'system', urgent: true });
    expect(out[0].body).toContain('4');
  });

  it('maps a payment promise due today to a payment-type notification', () => {
    const r = { id: 'c3', studentName: 'محمود سيد', followupDate: '2026-08-23' };
    const out = deriveNotifications(emptyReminders({ paymentPromisesDue: [r] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'notif-promise-c3', type: 'payment', urgent: true });
  });

  it('does NOT derive notifications from tomorrowFollowups or priorityTasks (out of the approved signal set)', () => {
    const out = deriveNotifications(emptyReminders({
      tomorrowFollowups: [{ id: 'c4', studentName: 'x', followupDate: '2026-08-24' }],
      priorityTasks: [{ id: 't1', title: 'مهمة عاجلة', dueDate: '2026-08-23', employee: 'u1' }],
    }));
    expect(out).toEqual([]);
  });

  it('produces a stable id for the same underlying record across recomputations (needed for read-state matching)', () => {
    const r = { id: 'c5', studentName: 'x', followupDate: '2026-08-20' };
    const a = deriveNotifications(emptyReminders({ overdueFollowups: [r] }));
    const b = deriveNotifications(emptyReminders({ overdueFollowups: [{ ...r }] }));
    expect(a[0].id).toBe(b[0].id);
  });

  it('combines multiple signal sources into one flat list', () => {
    const out = deriveNotifications({
      todayFollowups: [{ id: 'c1', studentName: 'a', followupDate: '2026-08-23' }],
      overdueFollowups: [{ id: 'c2', studentName: 'b', followupDate: '2026-08-10' }],
      tomorrowFollowups: [],
      priorityTasks: [],
      repeatedNoAnswer: [{ key: 'k1', parentName: 'c', phone: '2010', count: 3 }],
      paymentPromisesDue: [{ id: 'c3', studentName: 'd', followupDate: '2026-08-23' }],
    });
    expect(out).toHaveLength(4);
    expect(out.map((n) => n.id).sort()).toEqual(
      ['notif-noanswer-k1', 'notif-overdue-c2', 'notif-promise-c3', 'notif-today-c1'].sort()
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deriveAbsenceNotifications — إشعارات متابعة الغياب المتأخرة. المُدخَل هو حصراً
// classifyAbsenceFollowups(...).overdue (attendanceService.js) — هذا الملف لا يُعيد
// حساب التصنيف، فقط يشتقّ شكل الإشعار منه. نفس مبدأ deriveNotifications أعلاه
// بالضبط: دالة نقية، بلا حالة، بلا تخزين مستقل.
describe('deriveAbsenceNotifications', () => {
  const GROUPS = [{ id: 'g1', name: 'مجموعة أ', subject: 'رياضيات' }];

  function overdueItem({ attendance, student } = {}) {
    return {
      attendance: { id: 'att1', groupId: 'g1', date: '2026-09-13', ...attendance },
      student:    { id: 's1', name: 'أحمد محمد', ...student },
      followup:   null,
    };
  }

  it('7. one overdue attendance record -> exactly one absence notification', () => {
    const out = deriveAbsenceNotifications([overdueItem()], GROUPS);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'notif-absence-att1', type: 'absence', read: false, urgent: true });
  });

  it('8. re-running derivation for the same record yields the same notification id — no duplicate created', () => {
    const item = overdueItem();
    const first  = deriveAbsenceNotifications([item], GROUPS);
    const second = deriveAbsenceNotifications([item], GROUPS);
    expect(first[0].id).toBe(second[0].id);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });

  it('9. the id is derived only from attendanceId — never the current date, never random', () => {
    const id1 = deriveAbsenceNotifications([overdueItem()], GROUPS)[0].id;
    const id2 = deriveAbsenceNotifications([overdueItem()], GROUPS)[0].id;
    expect(id1).toBe('notif-absence-att1');
    expect(id2).toBe('notif-absence-att1');
    // نفس الحالة عبر تواريخ غياب مختلفة (لو تغيّر تاريخ السجل نفسه) — المعرِّف لا يزال
    // مبنياً على attendance.id حصراً، لا attendance.date.
    const differentDate = deriveAbsenceNotifications(
      [overdueItem({ attendance: { date: '2020-01-01' } })], GROUPS,
    )[0].id;
    expect(differentDate).toBe('notif-absence-att1');
  });

  it('10. contains the exact attendanceId in its navigation payload, and student/subject/date in the body', () => {
    const out = deriveAbsenceNotifications([overdueItem()], GROUPS);
    expect(out[0].link).toEqual({ page: 'attendance', view: 'followup', attendanceId: 'att1' });
    expect(out[0].body).toContain('أحمد محمد');
    expect(out[0].body).toContain('رياضيات');
    expect(out[0].body).toContain('2026-09-13');
  });

  it('13. multiple overdue absences -> one notification per attendanceId, each independent', () => {
    const items = [
      overdueItem({ attendance: { id: 'att1' } }),
      overdueItem({ attendance: { id: 'att2' }, student: { id: 's2', name: 'سارة' } }),
    ];
    const out = deriveAbsenceNotifications(items, GROUPS);
    expect(out.map((n) => n.id).sort()).toEqual(['notif-absence-att1', 'notif-absence-att2']);
  });

  it('falls back to the group name when no subject is set, and to a generic label when the group is missing', () => {
    const out1 = deriveAbsenceNotifications([overdueItem()], [{ id: 'g1', name: 'مجموعة أ' }]);
    expect(out1[0].body).toContain('مجموعة أ');

    const out2 = deriveAbsenceNotifications([overdueItem()], []);
    expect(out2[0].body).toContain('الحصة');
  });

  it('returns an empty list when there are no overdue absences', () => {
    expect(deriveAbsenceNotifications([], GROUPS)).toEqual([]);
  });
});
