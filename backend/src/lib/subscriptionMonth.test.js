// backend/src/lib/subscriptionMonth.test.js — M-01: the single month-state rule.
import { describe, it, expect } from 'vitest';
import { deriveMonthState, resolveMonthlyFee, MONTH_STATE } from './subscriptionMonth.js';

describe('deriveMonthState (M-01)', () => {
  it.each([
    [500, 0, MONTH_STATE.UNPAID],
    [500, -10, MONTH_STATE.UNPAID],
    [500, 300, MONTH_STATE.PARTIAL],
    [500, 499.99, MONTH_STATE.PARTIAL],
    [500, 500, MONTH_STATE.PAID],
    [500, 600, MONTH_STATE.PAID],
  ])('fee %s, net %s -> %s', (fee, net, expected) => {
    expect(deriveMonthState(fee, net)).toBe(expected);
  });

  it('the four refund scenarios from the M-01 plan', () => {
    expect(deriveMonthState(500, 500 - 200)).toBe('partial');
    expect(deriveMonthState(500, 500 - 500)).toBe('unpaid');
    expect(deriveMonthState(500, 300 - 300)).toBe('unpaid');
    expect(deriveMonthState(500, 300 + 200 - 100)).toBe('partial');
  });

  it('I-1: a zero, negative, null or missing fee is never "paid" (partial once something is paid)', () => {
    for (const fee of [0, -5, null, undefined, NaN, 'abc']) {
      expect(deriveMonthState(fee, 0)).toBe('unpaid');
      expect(deriveMonthState(fee, 1000)).toBe('partial');
    }
  });

  it('accepts numeric strings (Prisma Decimal serializations)', () => {
    expect(deriveMonthState('500', '500')).toBe('paid');
    expect(deriveMonthState('500.00', '250.50')).toBe('partial');
  });
});

describe('resolveMonthlyFee (M-01)', () => {
  it('the student fee wins when positive, else the primary group price, else 0', () => {
    expect(resolveMonthlyFee({ monthly_fee: 300 }, { price: 900 })).toBe(300);
    expect(resolveMonthlyFee({ monthly_fee: 0 }, { price: 900 })).toBe(900);
    expect(resolveMonthlyFee({ monthly_fee: null }, { price: '450.00' })).toBe(450);
    expect(resolveMonthlyFee({ monthly_fee: null }, null)).toBe(0);
    expect(resolveMonthlyFee(null, null)).toBe(0);
  });
});
