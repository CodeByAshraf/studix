// src/services/notificationService.test.js
// Product Completion Phase 1 — Issue 4 (Option A). Pure-function test of
// deriveNotifications — no React, no network. Mirrors the deriveMatDist/
// reportData.bookletDeliveries pure-function test pattern already established this
// session. Verifies: correct mapping from reminderService.js's reminder shapes to the
// notification shape NotificationsPage.jsx expects; correct type assignment; every
// freshly-derived item defaults to unread (read-state layering itself lives in
// ui.context.jsx, tested separately).
import { describe, it, expect } from 'vitest';
import { deriveNotifications } from './notificationService';

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
