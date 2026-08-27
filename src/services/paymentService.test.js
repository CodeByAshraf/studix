// src/services/paymentService.test.js
// BUG-02 fix verification — revenue functions must net out active refunds (derived from
// treasury_txn, never a stored field on the immutable payment row — see getRefundedAmount's
// own header comment). Pure-function tests, no React, no network, no database.
import { describe, it, expect } from 'vitest';
import {
  getMonthlyRevenue, getDailyRevenue, getRevenueByGroup, getMonthlyBreakdown,
  getRefundedAmount, getRemainingRefundable,
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
