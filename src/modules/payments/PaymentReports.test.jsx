// src/modules/payments/PaymentReports.test.jsx
// MEDIUM-A Finding 1 — the by-group "نسبة السداد" (payment rate) counted a payment for
// the current month number regardless of year. Verifies the year guard added to
// currentMonthRevenue (scoped to the report's own selected `year`, not just "this month").
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import PaymentReports from './PaymentReports';
import { useAppStore } from '../../store/app.store';
import { formatCurrency } from '../../utils/helpers';

describe('PaymentReports — by-group payment rate is year-aware (MEDIUM-A Finding 1)', () => {
  it('does not count a payment from the same month number in a past year toward the current year\'s payment rate', () => {
    const now = new Date();
    const thisMonth = now.getMonth() + 1;
    const thisYear  = now.getFullYear();

    useAppStore.setState({
      groups: [{ id: 'g1', name: 'مجموعة أ', subject: 'رياضيات', price: 100 }],
      students: [{ id: 's1', name: 'طالب', groupId: 'g1', status: 'active', monthlyFee: 100 }],
      payments: [
        { id: 'p-old', studentId: 's1', groupId: 'g1', month: thisMonth, year: thisYear - 1, amount: 100, date: `${thisYear - 1}-01-01` },
      ],
      centerProfile: {},
    });

    render(<PaymentReports />);
    fireEvent.click(screen.getByText('حسب المجموعة'));

    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });
});

// BUG-02 (remaining part) — the "by group" table's "نسبة السداد" (payment rate) and the
// "Daily (current month)" chart both summed raw payments.amount directly, bypassing the
// already-fixed getMonthlyBreakdown/getRevenueByGroup entirely, and so kept overstating
// revenue after a refund. Both now net out active refunds via getRefundedAmount/
// getNetRevenue — same single source of truth used everywhere else.
describe('PaymentReports — by-group payment rate nets out active refunds (BUG-02, remaining part)', () => {
  function baseSetup(extraTreasuryTxn = []) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    useAppStore.setState({
      groups: [{ id: 'g1', name: 'مجموعة أ', subject: 'رياضيات', price: 1000 }],
      students: [{ id: 's1', name: 'طالب', groupId: 'g1', status: 'active', monthlyFee: 1000 }],
      payments: [
        { id: 'p1', studentId: 's1', groupId: 'g1', month, year, amount: 1000, date: now.toISOString().split('T')[0] },
      ],
      treasuryTxn: extraTreasuryTxn,
      centerProfile: {},
    });
  }

  it('a fully-paid, unrefunded group shows a 100% payment rate', () => {
    baseSetup([]);
    render(<PaymentReports />);
    fireEvent.click(screen.getByText('حسب المجموعة'));
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('a 300/1000 refund on the only payment drops the payment rate to 70%, not 100%', () => {
    baseSetup([{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }]);
    render(<PaymentReports />);
    fireEvent.click(screen.getByText('حسب المجموعة'));
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });
});

describe('PaymentReports — daily (current month) view nets out active refunds (BUG-02, remaining part)', () => {
  it('a payment refunded today shows its net amount (700), not the raw 1000, in both the daily total and the per-day row', () => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    useAppStore.setState({
      groups: [{ id: 'g1', name: 'مجموعة أ', price: 1000 }],
      students: [{ id: 's1', name: 'طالب', groupId: 'g1', status: 'active' }],
      payments: [
        { id: 'p1', studentId: 's1', groupId: 'g1', month: now.getMonth() + 1, year: now.getFullYear(), amount: 1000, date: todayStr },
      ],
      treasuryTxn: [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
      centerProfile: {},
    });

    render(<PaymentReports />);
    fireEvent.click(screen.getByText('اليومي (الشهر الحالي)'));

    expect(screen.getAllByText(formatCurrency(700)).length).toBeGreaterThan(0);
    expect(screen.queryByText(formatCurrency(1000))).not.toBeInTheDocument();
  });
});
