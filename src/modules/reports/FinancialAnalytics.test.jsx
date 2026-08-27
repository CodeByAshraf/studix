// src/modules/reports/FinancialAnalytics.test.jsx
// MEDIUM-A Finding 1 — "لم يدفعوا هذا الشهر" (unpaidCount) treated a payment for the
// same month number in a PAST year as "paid this month", hiding a genuinely-unpaid
// student from this KPI. Verifies the year guard added to paidThisMonth.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FinancialAnalytics from './FinancialAnalytics';
import { useAppStore } from '../../store/app.store';
import { formatCurrency } from '../../utils/helpers';

describe('FinancialAnalytics — unpaidCount is year-aware (MEDIUM-A Finding 1)', () => {
  it('counts an active student as unpaid this month even if they paid the same month number last year', () => {
    const now = new Date();
    const thisMonth = now.getMonth() + 1;
    const thisYear  = now.getFullYear();

    useAppStore.setState({
      groups: [],
      students: [{ id: 's1', name: 'طالب', status: 'active' }],
      payments: [
        { id: 'p-old', studentId: 's1', month: thisMonth, year: thisYear - 1, status: 'paid', amount: 100, date: `${thisYear - 1}-01-01` },
      ],
    });

    render(<FinancialAnalytics />);

    const label = screen.getByText('لم يدفعوا هذا الشهر');
    const valueDiv = label.closest('div').nextElementSibling;
    expect(valueDiv).toHaveTextContent('1');
  });
});

// BUG-02 (remaining part) — every revenue KPI/chart here ("الإيراد الكلي", "إيراد هذا
// الشهر", "إيراد اليوم", the monthly trend chart, the by-group chart) summed raw
// payments.amount directly, bypassing paymentService entirely, and so kept overstating
// revenue after a refund. All now use the shared getNetRevenue() helper — same single
// source of truth PaymentsPage.jsx/PaymentReports.jsx now use too.
describe('FinancialAnalytics — revenue KPIs are net of active refunds (BUG-02, remaining part)', () => {
  function valueFor(labelText) {
    const label = screen.getByText(labelText);
    return label.closest('div').nextElementSibling.textContent;
  }

  it('Payment 1000, refund 0 -> "الإيراد الكلي" shows 1000', () => {
    const now = new Date();
    useAppStore.setState({
      groups: [], students: [{ id: 's1', name: 'طالب', status: 'active' }],
      payments: [{ id: 'p1', studentId: 's1', amount: 1000, month: now.getMonth() + 1, year: now.getFullYear(), date: now.toISOString().split('T')[0], status: 'paid', method: 'cash' }],
      treasuryTxn: [],
    });

    render(<FinancialAnalytics />);

    expect(valueFor('الإيراد الكلي')).toBe(formatCurrency(1000));
  });

  it('Payment 1000, refund 300 -> "الإيراد الكلي" shows 700, not 1000', () => {
    const now = new Date();
    useAppStore.setState({
      groups: [], students: [{ id: 's1', name: 'طالب', status: 'active' }],
      payments: [{ id: 'p1', studentId: 's1', amount: 1000, month: now.getMonth() + 1, year: now.getFullYear(), date: now.toISOString().split('T')[0], status: 'paid', method: 'cash' }],
      treasuryTxn: [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    });

    render(<FinancialAnalytics />);

    expect(valueFor('الإيراد الكلي')).toBe(formatCurrency(700));
  });

  it('multiple refunds on the same payment reduce "الإيراد الكلي" by their cumulative amount', () => {
    const now = new Date();
    useAppStore.setState({
      groups: [], students: [{ id: 's1', name: 'طالب', status: 'active' }],
      payments: [{ id: 'p1', studentId: 's1', amount: 1000, month: now.getMonth() + 1, year: now.getFullYear(), date: now.toISOString().split('T')[0], status: 'paid', method: 'cash' }],
      treasuryTxn: [
        { paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 },
        { paymentId: 'p1', refType: 'refund', status: 'active', amount: 200 },
      ],
    });

    render(<FinancialAnalytics />);

    expect(valueFor('الإيراد الكلي')).toBe(formatCurrency(500));
  });

  it('"إيراد اليوم" (today) is also net of a refund on a payment made today', () => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    useAppStore.setState({
      groups: [], students: [{ id: 's1', name: 'طالب', status: 'active' }],
      payments: [{ id: 'p1', studentId: 's1', amount: 1000, month: now.getMonth() + 1, year: now.getFullYear(), date: todayStr, status: 'paid', method: 'cash' }],
      treasuryTxn: [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    });

    render(<FinancialAnalytics />);

    expect(valueFor('إيراد اليوم')).toBe(formatCurrency(700));
  });

  it('existing no-refund behavior remains unchanged (regression guard)', () => {
    const now = new Date();
    useAppStore.setState({
      groups: [{ id: 'g1', name: 'G1', color: '#3b82f6' }],
      students: [{ id: 's1', name: 'طالب', status: 'active', groupId: 'g1' }],
      payments: [
        { id: 'p1', studentId: 's1', groupId: 'g1', amount: 300, month: now.getMonth() + 1, year: now.getFullYear(), date: now.toISOString().split('T')[0], status: 'paid', method: 'cash' },
      ],
      treasuryTxn: [],
    });

    render(<FinancialAnalytics />);

    expect(valueFor('الإيراد الكلي')).toBe(formatCurrency(300));
  });
});
