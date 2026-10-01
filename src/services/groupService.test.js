// src/services/groupService.test.js
// BUG-02 (remaining part) — getGroupStats.collected (re-exported as totalRevenue, and the
// source of collectionRate) summed payments.amount directly, bypassing any refund check.
// A payment refunded (partially or fully) after being marked 'paid' kept counting as fully
// collected forever. Now nets out active refunds via getRefundedAmount (treasury_txn).
import { describe, it, expect } from 'vitest';
import { getGroupStats, groupMeetingDays, selectedAttendDays, toAttendDays } from './groupService';

const GROUP = { id: 'g1', name: 'مجموعة أ', price: 1000, max: 30 };

function baseArgs({ students, payments, treasuryTxn }) {
  const now = new Date();
  return { group: GROUP, students, payments, attendance: [], treasuryTxn, month: now.getMonth() + 1 };
}

function studentsFor(ids) {
  return ids.map((id) => ({ id, name: id, groupId: 'g1', status: 'active', monthlyFee: 1000 }));
}

function paymentFor(id, studentId, amount) {
  const now = new Date();
  return { id, studentId, groupId: 'g1', amount, payType: 'subscription', status: 'paid', month: now.getMonth() + 1, year: now.getFullYear() };
}

describe('getGroupStats — collected/totalRevenue/collectionRate net out active refunds (BUG-02, remaining part)', () => {
  it('payment 1000, refund 0 -> collected/totalRevenue = 1000, collectionRate = 100%', () => {
    const students = studentsFor(['s1']);
    const payments = [paymentFor('p1', 's1', 1000)];
    const stats = getGroupStats(GROUP, students, payments, [], []);
    expect(stats.monthlyCollected).toBe(1000);
    expect(stats.totalRevenue).toBe(1000);
    expect(stats.collectionRate).toBe(100);
  });

  it('payment 1000, refund 300 -> collected/totalRevenue = 700, collectionRate = 70%, not 100%', () => {
    const students = studentsFor(['s1']);
    const payments = [paymentFor('p1', 's1', 1000)];
    const treasuryTxn = [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }];
    const stats = getGroupStats(GROUP, students, payments, [], treasuryTxn);
    expect(stats.monthlyCollected).toBe(700);
    expect(stats.totalRevenue).toBe(700);
    expect(stats.collectionRate).toBe(70);
  });

  it('multiple refunds on the same payment are deducted cumulatively', () => {
    const students = studentsFor(['s1']);
    const payments = [paymentFor('p1', 's1', 1000)];
    const treasuryTxn = [
      { paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 },
      { paymentId: 'p1', refType: 'refund', status: 'active', amount: 200 },
    ];
    const stats = getGroupStats(GROUP, students, payments, [], treasuryTxn);
    expect(stats.monthlyCollected).toBe(500);
  });

  it('a cancelled (non-active) refund transaction is never deducted', () => {
    const students = studentsFor(['s1']);
    const payments = [paymentFor('p1', 's1', 1000)];
    const treasuryTxn = [{ paymentId: 'p1', refType: 'refund', status: 'cancelled', amount: 300 }];
    const stats = getGroupStats(GROUP, students, payments, [], treasuryTxn);
    expect(stats.monthlyCollected).toBe(1000);
  });

  it('multiple students: a refund on one payment does not affect another unrefunded payment', () => {
    const students = studentsFor(['s1', 's2']);
    const payments = [paymentFor('p1', 's1', 1000), paymentFor('p2', 's2', 500)];
    const treasuryTxn = [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }];
    const stats = getGroupStats(GROUP, students, payments, [], treasuryTxn);
    expect(stats.monthlyCollected).toBe(1200); // 700 + 500
  });

  it('existing no-refund behavior is unchanged when treasuryTxn is omitted (default [])', () => {
    const students = studentsFor(['s1']);
    const payments = [paymentFor('p1', 's1', 1000)];
    const stats = getGroupStats(GROUP, students, payments, []);
    expect(stats.monthlyCollected).toBe(1000);
    expect(stats.totalRevenue).toBe(1000);
  });
});

// BUG-06 — monthlyPayments filtered by month number only, never by year (the same
// "MEDIUM-A Finding 1" pattern already fixed in ReportsPage.jsx/FinancialAnalytics.jsx/
// UnpaidStudents.jsx/PaymentsPage.jsx, missed here). A payment from the same month number
// in a past year was counted into "this month"'s collected/totalRevenue/collectionRate.
describe('getGroupStats — monthly figures are year-aware (BUG-06)', () => {
  it('a payment from the current month AND current year is included', () => {
    const now = new Date();
    const students = studentsFor(['s1']);
    const payments = [{ id: 'p1', studentId: 's1', groupId: 'g1', amount: 1000, payType: 'subscription', status: 'paid', month: now.getMonth() + 1, year: now.getFullYear() }];
    const stats = getGroupStats(GROUP, students, payments, [], []);
    expect(stats.monthlyCollected).toBe(1000);
    expect(stats.totalRevenue).toBe(1000);
    expect(stats.collectionRate).toBe(100);
  });

  it('a payment from the same month number but a PAST year is excluded', () => {
    const now = new Date();
    const students = studentsFor(['s1']);
    const payments = [{ id: 'p1', studentId: 's1', groupId: 'g1', amount: 1000, payType: 'subscription', status: 'paid', month: now.getMonth() + 1, year: now.getFullYear() - 1 }];
    const stats = getGroupStats(GROUP, students, payments, [], []);
    expect(stats.monthlyCollected).toBe(0);
    expect(stats.totalRevenue).toBe(0);
    expect(stats.collectionRate).toBe(0);
  });

  it('an active refund is still deducted from the year-filtered total', () => {
    const now = new Date();
    const students = studentsFor(['s1']);
    const payments = [{ id: 'p1', studentId: 's1', groupId: 'g1', amount: 1000, payType: 'subscription', status: 'paid', month: now.getMonth() + 1, year: now.getFullYear() }];
    const treasuryTxn = [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }];
    const stats = getGroupStats(GROUP, students, payments, [], treasuryTxn);
    expect(stats.monthlyCollected).toBe(700);
    expect(stats.collectionRate).toBe(70);
  });

  it('a cancelled (inactive) refund is not deducted from the year-filtered total', () => {
    const now = new Date();
    const students = studentsFor(['s1']);
    const payments = [{ id: 'p1', studentId: 's1', groupId: 'g1', amount: 1000, payType: 'subscription', status: 'paid', month: now.getMonth() + 1, year: now.getFullYear() }];
    const treasuryTxn = [{ paymentId: 'p1', refType: 'refund', status: 'cancelled', amount: 300 }];
    const stats = getGroupStats(GROUP, students, payments, [], treasuryTxn);
    expect(stats.monthlyCollected).toBe(1000);
  });

  it('no payments at all -> collected/totalRevenue/collectionRate are all 0, not NaN/crash', () => {
    const students = studentsFor(['s1']);
    const stats = getGroupStats(GROUP, students, [], [], []);
    expect(stats.monthlyCollected).toBe(0);
    expect(stats.totalRevenue).toBe(0);
    expect(stats.collectionRate).toBe(0);
  });
});

// M-01 — collected is the month's net SUBSCRIPTION money, never filtered by payments.status.
describe('getGroupStats — collected counts subscription money regardless of record status (M-01)', () => {
  it('instalments recorded as "partial" are collected: 600 + 400 of 1000 -> 1000, 100%', () => {
    const students = studentsFor(['s1']);
    const payments = [
      { ...paymentFor('p1', 's1', 600), status: 'partial' },
      { ...paymentFor('p2', 's1', 400), status: 'partial' },
    ];
    const stats = getGroupStats(GROUP, students, payments, [], []);
    expect(stats.monthlyCollected).toBe(1000);
    expect(stats.collectionRate).toBe(100);
  });

  it('a single partial payment counts toward collected: 300 of 1000 -> 30%', () => {
    const stats = getGroupStats(GROUP, studentsFor(['s1']), [{ ...paymentFor('p1', 's1', 300), status: 'partial' }], [], []);
    expect(stats.monthlyCollected).toBe(300);
    expect(stats.collectionRate).toBe(30);
  });

  it('material/other payments in the same month are not subscription collection', () => {
    const payments = [
      paymentFor('p1', 's1', 500),
      { ...paymentFor('m1', 's1', 900), payType: 'material' },
      { ...paymentFor('x1', 's1', 900), payType: 'extra' },
    ];
    const stats = getGroupStats(GROUP, studentsFor(['s1']), payments, [], []);
    expect(stats.monthlyCollected).toBe(500);
    expect(stats.collectionRate).toBe(50);
  });
});

// Fix 2 — attend_days <-> selected-days conversion used by every enrollment day picker.
describe('enrollment attendance-day helpers', () => {
  const G = { days: ['mon', 'sat'] }; // stored order is irrelevant — week order is canonical

  it('groupMeetingDays returns the group days in week order, and [] for a group without days', () => {
    expect(groupMeetingDays(G)).toEqual(['sat', 'mon']);
    expect(groupMeetingDays({ days: null })).toEqual([]);
  });

  it('selectedAttendDays: null means every meeting day; an array keeps only days the group meets', () => {
    expect(selectedAttendDays(null, G)).toEqual(['sat', 'mon']);
    expect(selectedAttendDays(['sat', 'tue'], G)).toEqual(['sat']);
  });

  it('toAttendDays: all meeting days (or nothing selected) → null, never []; a subset → that subset', () => {
    expect(toAttendDays(['sat', 'mon'], G)).toBeNull();
    expect(toAttendDays([], G)).toBeNull();
    expect(toAttendDays(['mon'], G)).toEqual(['mon']);
    expect(toAttendDays(['sat'], { days: null })).toBeNull();
  });
});

// Additional Group enrollment is membership/schedule only — the monthly fee is student-level
// and billed in the student's Primary group, so with enrollment membership a student adds to
// monthlyExpected (the collection % denominator) at most once: in their Primary group only.
describe('getGroupStats with enrollment membership — each student contributes their fee at most once', () => {
  const GA = { id: 'gA', name: 'أ', price: 1000, max: 30 };
  const GB = { id: 'gB', name: 'ب', price: 1000, max: 30 };
  const GC = { id: 'gC', name: 'ج', price: 1000, max: 30 };
  const S1 = { id: 's1', name: 's1', groupId: 'gA', status: 'active', monthlyFee: 500 };
  const now = new Date();
  const pay = (id, groupId, amount) => ({ id, studentId: 's1', groupId, amount, payType: 'subscription', status: 'paid', month: now.getMonth() + 1, year: now.getFullYear() });
  const members = (role) => new Map([['s1', role]]);

  it('1. a student in one Primary Group contributes their monthly fee once', () => {
    const stats = getGroupStats(GA, [S1], [], [], [], members('primary'));
    expect(stats.monthlyExpected).toBe(500);
  });

  it('2/4. Primary + one Additional: the fee counts in the Primary group only; the Additional group expects nothing from it', () => {
    const primary = getGroupStats(GA, [S1], [], [], [], members('primary'));
    const additional = getGroupStats(GB, [S1], [], [], [], members('additional'));
    expect(primary.monthlyExpected).toBe(500);
    expect(additional.monthlyExpected).toBe(0);
    expect(primary.monthlyExpected + additional.monthlyExpected).toBe(500);
  });

  it('3. Primary + multiple Additional groups: still exactly one fee across every group card', () => {
    const total = [[GA, 'primary'], [GB, 'additional'], [GC, 'additional']]
      .map(([g, role]) => getGroupStats(g, [S1], [], [], [], members(role)).monthlyExpected)
      .reduce((a, b) => a + b, 0);
    expect(total).toBe(500);
  });

  it('4. Additional membership still counts toward membership/capacity, just not toward expected revenue', () => {
    const additional = getGroupStats(GB, [S1], [], [], [], members('additional'));
    expect(additional.activeCount).toBe(1);
    expect(additional.totalCount).toBe(1);
    expect(additional.monthlyExpected).toBe(0);
    expect(additional.collectionRate).toBe(0); // no expected amount → 0%, never a division by zero
  });

  it('5. collection % in the Primary group is unchanged by the student\'s Additional memberships', () => {
    const withAdditionals = getGroupStats(GA, [S1], [pay('p1', 'gA', 250)], [], [], members('primary'));
    const legacyPath = getGroupStats(GA, [S1], [pay('p1', 'gA', 250)], [], []);
    expect(withAdditionals.monthlyCollected).toBe(250);
    expect(withAdditionals.collectionRate).toBe(50);
    expect(withAdditionals.collectionRate).toBe(legacyPath.collectionRate);
  });

  it('6. a Primary member with no fee still falls back to the group price exactly as before; an Additional one adds nothing', () => {
    const noFee = { ...S1, monthlyFee: null };
    expect(getGroupStats(GA, [noFee], [], [], [], members('primary')).monthlyExpected).toBe(1000);
    expect(getGroupStats(GA, [noFee], [], [], []).monthlyExpected).toBe(1000); // legacy path, unchanged
    expect(getGroupStats(GB, [noFee], [], [], [], members('additional')).monthlyExpected).toBe(0);
  });

  it('inactive members contribute nothing, whatever their role (unchanged)', () => {
    const inactive = { ...S1, status: 'inactive' };
    expect(getGroupStats(GA, [inactive], [], [], [], members('primary')).monthlyExpected).toBe(0);
  });
});
