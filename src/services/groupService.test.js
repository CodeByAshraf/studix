// src/services/groupService.test.js
// BUG-02 (remaining part) — getGroupStats.collected (re-exported as totalRevenue, and the
// source of collectionRate) summed payments.amount directly, bypassing any refund check.
// A payment refunded (partially or fully) after being marked 'paid' kept counting as fully
// collected forever. Now nets out active refunds via getRefundedAmount (treasury_txn).
import { describe, it, expect } from 'vitest';
import { getGroupStats } from './groupService';

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
  return { id, studentId, groupId: 'g1', amount, status: 'paid', month: now.getMonth() + 1, year: now.getFullYear() };
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
    const payments = [{ id: 'p1', studentId: 's1', groupId: 'g1', amount: 1000, status: 'paid', month: now.getMonth() + 1, year: now.getFullYear() }];
    const stats = getGroupStats(GROUP, students, payments, [], []);
    expect(stats.monthlyCollected).toBe(1000);
    expect(stats.totalRevenue).toBe(1000);
    expect(stats.collectionRate).toBe(100);
  });

  it('a payment from the same month number but a PAST year is excluded', () => {
    const now = new Date();
    const students = studentsFor(['s1']);
    const payments = [{ id: 'p1', studentId: 's1', groupId: 'g1', amount: 1000, status: 'paid', month: now.getMonth() + 1, year: now.getFullYear() - 1 }];
    const stats = getGroupStats(GROUP, students, payments, [], []);
    expect(stats.monthlyCollected).toBe(0);
    expect(stats.totalRevenue).toBe(0);
    expect(stats.collectionRate).toBe(0);
  });

  it('an active refund is still deducted from the year-filtered total', () => {
    const now = new Date();
    const students = studentsFor(['s1']);
    const payments = [{ id: 'p1', studentId: 's1', groupId: 'g1', amount: 1000, status: 'paid', month: now.getMonth() + 1, year: now.getFullYear() }];
    const treasuryTxn = [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }];
    const stats = getGroupStats(GROUP, students, payments, [], treasuryTxn);
    expect(stats.monthlyCollected).toBe(700);
    expect(stats.collectionRate).toBe(70);
  });

  it('a cancelled (inactive) refund is not deducted from the year-filtered total', () => {
    const now = new Date();
    const students = studentsFor(['s1']);
    const payments = [{ id: 'p1', studentId: 's1', groupId: 'g1', amount: 1000, status: 'paid', month: now.getMonth() + 1, year: now.getFullYear() }];
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
