// src/services/paymentService.test.js
// BUG-02 fix verification — revenue functions must net out active refunds (derived from
// treasury_txn, never a stored field on the immutable payment row — see getRefundedAmount's
// own header comment). Pure-function tests, no React, no network, no database.
import { describe, it, expect } from 'vitest';
import {
  getMonthlyRevenue, getDailyRevenue, getRevenueByGroup, getMonthlyBreakdown,
  getRefundedAmount, getRemainingRefundable,
  deriveMonthState, getSubscriptionNet, getStudentMonthState, getUnpaidStudents, getPartialStudents,
} from './paymentService';

function payment(overrides = {}) {
  return { id: 'p1', month: 1, year: 2026, date: '2026-01-15', amount: 1000, groupId: 'g1', ...overrides };
}

function refundTxn(paymentId, amount, overrides = {}) {
  return { paymentId, refType: 'refund', status: 'active', amount, ...overrides };
}

describe('BUG-02 — revenue functions net out refunds', () => {
  describe('getMonthlyRevenue', () => {
    it('Payment = 1000, Refund = 0 -> Revenue = 1000', () => {
      const revenue = getMonthlyRevenue([payment({ amount: 1000 })], 1, 2026, []);
      expect(revenue).toBe(1000);
    });

    it('Payment = 1000, Refund = 300 -> Revenue = 700', () => {
      const payments = [payment({ amount: 1000 })];
      const txns = [refundTxn('p1', 300)];
      expect(getMonthlyRevenue(payments, 1, 2026, txns)).toBe(700);
    });

    it('multiple refunds on the same payment -> revenue reduced by the cumulative refunded amount', () => {
      const payments = [payment({ amount: 1000 })];
      const txns = [refundTxn('p1', 300), refundTxn('p1', 200)];
      expect(getMonthlyRevenue(payments, 1, 2026, txns)).toBe(500);
    });

    it('payments with no refunds remain unchanged, even when other payments in the same set are refunded', () => {
      const payments = [payment({ id: 'p1', amount: 1000 }), payment({ id: 'p2', amount: 500 })];
      const txns = [refundTxn('p1', 300)]; // only p1 refunded
      expect(getMonthlyRevenue(payments, 1, 2026, txns)).toBe(1200); // 700 + 500
    });

    it('a refund with status != active is never subtracted (reversed/cancelled refund does not count)', () => {
      const payments = [payment({ amount: 1000 })];
      const txns = [refundTxn('p1', 300, { status: 'cancelled' })];
      expect(getMonthlyRevenue(payments, 1, 2026, txns)).toBe(1000);
    });

    it('a treasury_txn belonging to a different payment is never subtracted', () => {
      const payments = [payment({ id: 'p1', amount: 1000 })];
      const txns = [refundTxn('p-other', 300)];
      expect(getMonthlyRevenue(payments, 1, 2026, txns)).toBe(1000);
    });

    it('calling without the treasuryTxn argument at all preserves the exact previous (pre-fix) behavior', () => {
      const payments = [payment({ amount: 1000 })];
      expect(getMonthlyRevenue(payments, 1, 2026)).toBe(1000);
    });
  });

  describe('getDailyRevenue', () => {
    it('Payment = 1000, Refund = 300 -> Revenue = 700', () => {
      const payments = [payment({ date: '2026-01-15', amount: 1000 })];
      const txns = [refundTxn('p1', 300)];
      expect(getDailyRevenue(payments, '2026-01-15', txns)).toBe(700);
    });

    it('payments with no refunds remain unchanged', () => {
      const payments = [payment({ date: '2026-01-15', amount: 1000 })];
      expect(getDailyRevenue(payments, '2026-01-15', [])).toBe(1000);
    });
  });

  describe('getRevenueByGroup', () => {
    it('nets out a refund for the payment\'s group only', () => {
      const groups = [{ id: 'g1', name: 'G1' }, { id: 'g2', name: 'G2' }];
      const payments = [payment({ id: 'p1', groupId: 'g1', amount: 1000 }), payment({ id: 'p2', groupId: 'g2', amount: 500 })];
      const txns = [refundTxn('p1', 300)];
      const result = getRevenueByGroup(payments, groups, txns);
      expect(result.find(g => g.id === 'g1').revenue).toBe(700);
      expect(result.find(g => g.id === 'g2').revenue).toBe(500);
    });
  });

  describe('getMonthlyBreakdown', () => {
    it('nets out a refund for the payment\'s month only', () => {
      const payments = [payment({ id: 'p1', month: 1, amount: 1000 })];
      const txns = [refundTxn('p1', 300)];
      const result = getMonthlyBreakdown(payments, 2026, txns);
      expect(result.find(m => m.month === 1).revenue).toBe(700);
      expect(result.find(m => m.month === 2).revenue).toBe(0);
    });
  });

  describe('getRefundedAmount / getRemainingRefundable (already-correct reference implementation, unchanged)', () => {
    it('sums only active refund-type treasury_txn rows for the given payment', () => {
      const txns = [refundTxn('p1', 300), refundTxn('p1', 200), refundTxn('p-other', 999)];
      expect(getRefundedAmount('p1', txns)).toBe(500);
    });

    it('getRemainingRefundable never goes below zero', () => {
      const p = payment({ amount: 100 });
      const txns = [refundTxn('p1', 100)];
      expect(getRemainingRefundable(p, txns)).toBe(0);
    });
  });
});

// ── M-01 — monthly subscription state is derived from net subscription money ───────────────
// payments.status is a record-level snapshot only; none of these helpers may read it.
describe('M-01 — monthly subscription state', () => {
  const group = { id: 'g1', price: 500 };
  const student = (overrides = {}) => ({ id: 's1', status: 'active', groupId: 'g1', monthlyFee: null, ...overrides });
  const sub = (id, amount, overrides = {}) => payment({ id, amount, studentId: 's1', payType: 'subscription', status: 'paid', ...overrides });

  describe('deriveMonthState', () => {
    it.each([
      [500, 0, 'unpaid'], [500, 300, 'partial'], [500, 500, 'paid'], [500, 650, 'paid'],
    ])('fee %s, net %s -> %s', (fee, net, expected) => {
      expect(deriveMonthState(fee, net)).toBe(expected);
    });

    it('I-1: a zero/unset fee is never "paid" — partial once something was paid, else unpaid', () => {
      for (const fee of [0, null, undefined, -1]) {
        expect(deriveMonthState(fee, 0)).toBe('unpaid');
        expect(deriveMonthState(fee, 200)).toBe('partial');
      }
    });
  });

  describe('getSubscriptionNet / getStudentMonthState', () => {
    it('instalments 300 + 200 reach the fee -> paid, even though each record says "partial"', () => {
      const pays = [sub('p1', 300, { status: 'partial' }), sub('p2', 200, { status: 'partial' })];
      expect(getSubscriptionNet(pays, 's1', 1, 2026)).toBe(500);
      expect(getStudentMonthState(student(), group, pays, 1, 2026).state).toBe('paid');
    });

    it('the four refund scenarios (active refunds netted, cancelled ignored)', () => {
      const one = [sub('p1', 500)];
      expect(getStudentMonthState(student(), group, one, 1, 2026, [refundTxn('p1', 200)]).state).toBe('partial');
      expect(getStudentMonthState(student(), group, one, 1, 2026, [refundTxn('p1', 500)]).state).toBe('unpaid');
      expect(getStudentMonthState(student(), group, [sub('p1', 300)], 1, 2026, [refundTxn('p1', 300)]).state).toBe('unpaid');
      const two = [sub('p1', 300), sub('p2', 200)];
      const r = getStudentMonthState(student(), group, two, 1, 2026, [refundTxn('p1', 100), refundTxn('p2', 999, { status: 'cancelled' })]);
      expect(r.net).toBe(400);
      expect(r.remaining).toBe(100);
      expect(r.state).toBe('partial');
    });

    it('a fully refunded "paid" record does not make the month paid', () => {
      const r = getStudentMonthState(student(), group, [sub('p1', 500, { status: 'paid' })], 1, 2026, [refundTxn('p1', 500)]);
      expect(r.state).toBe('unpaid');
    });

    it('only payType === "subscription" counts — material/extra payments (or a missing payType) never do', () => {
      const pays = [
        payment({ id: 'm1', studentId: 's1', amount: 900, payType: 'material', status: 'paid' }),
        payment({ id: 'x1', studentId: 's1', amount: 900, payType: 'extra', status: 'paid' }),
        payment({ id: 'n1', studentId: 's1', amount: 900, status: 'paid' }),
      ];
      expect(getSubscriptionNet(pays, 's1', 1, 2026)).toBe(0);
      expect(getStudentMonthState(student(), group, pays, 1, 2026).state).toBe('unpaid');
    });

    it('scopes by student, month and year (same month number in another year is ignored)', () => {
      const pays = [sub('p1', 500, { year: 2025, date: '2025-01-15' }), sub('p2', 500, { studentId: 'other' }), sub('p3', 500, { month: 2 })];
      expect(getSubscriptionNet(pays, 's1', 1, 2026)).toBe(0);
    });

    it('the student fee overrides the group price; the remaining amount never goes negative', () => {
      const r = getStudentMonthState(student({ monthlyFee: 300 }), group, [sub('p1', 500)], 1, 2026);
      expect(r.fee).toBe(300);
      expect(r.remaining).toBe(0);
      expect(r.state).toBe('paid');
    });
  });

  describe('getUnpaidStudents / getPartialStudents', () => {
    const students = [
      student({ id: 'full' }), student({ id: 'inst' }), student({ id: 'half' }),
      student({ id: 'none' }), student({ id: 'refunded' }), student({ id: 'gone', status: 'inactive' }),
    ];
    const pays = [
      sub('a', 500, { studentId: 'full' }),
      sub('b', 300, { studentId: 'inst', status: 'partial' }), sub('c', 200, { studentId: 'inst', status: 'partial' }),
      sub('d', 200, { studentId: 'half', status: 'partial' }),
      sub('e', 500, { studentId: 'refunded', status: 'paid' }),
      payment({ id: 'm', studentId: 'none', amount: 900, payType: 'material', status: 'paid' }),
    ];
    const txns = [refundTxn('e', 500)];
    const opts = { groups: [group], treasuryTxn: txns };

    it('unpaid = active students whose derived month state is unpaid', () => {
      expect(getUnpaidStudents(students, pays, 1, 2026, opts).map((s) => s.id)).toEqual(['none', 'refunded']);
    });

    it('partial = active students whose derived month state is partial', () => {
      expect(getPartialStudents(students, pays, 1, 2026, opts).map((s) => s.id)).toEqual(['half']);
    });
  });
});
