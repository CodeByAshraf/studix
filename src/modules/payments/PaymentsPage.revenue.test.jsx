// src/modules/payments/PaymentsPage.revenue.test.jsx
// BUG-02 (remaining part) — PaymentsPage's own KPI tiles ("الإيراد الكلي" / "إيراد اليوم")
// computed revenue directly via payments.reduce(...), bypassing the already-fixed
// paymentService functions entirely, and so kept overstating revenue after a refund. Now
// both use the shared getNetRevenue() helper (single source of truth, same one
// FinancialAnalytics.jsx/PaymentReports.jsx now use too).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PaymentsPage from './PaymentsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';
import { formatCurrency } from '../../utils/helpers';

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <PaymentsPage />
      </ToastProvider>
    </AuthProvider>
  );
}

function valueFor(labelText) {
  const label = screen.getByText(labelText, { exact: false });
  return label.closest('div').nextElementSibling.textContent;
}

function baseStudentAndDate() {
  const today = new Date();
  return {
    todayStr: today.toISOString().split('T')[0],
    month: today.getMonth() + 1,
    year: today.getFullYear(),
  };
}

describe('PaymentsPage — revenue KPIs are net of active refunds (BUG-02, remaining part)', () => {
  it('Payment 1000, refund 0 -> displayed total revenue is 1000', () => {
    const { todayStr, month, year } = baseStudentAndDate();
    useAppStore.setState({
      groups: [], students: [{ id: 's1', name: 'طالب', status: 'active' }],
      payments: [{ id: 'p1', studentId: 's1', amount: 1000, month, year, date: todayStr, status: 'paid' }],
      treasuryTxn: [],
    });

    renderPage();

    expect(valueFor('الإيراد الكلي')).toBe(formatCurrency(1000));
  });

  it('Payment 1000, refund 300 -> displayed total revenue is 700', () => {
    const { todayStr, month, year } = baseStudentAndDate();
    useAppStore.setState({
      groups: [], students: [{ id: 's1', name: 'طالب', status: 'active' }],
      payments: [{ id: 'p1', studentId: 's1', amount: 1000, month, year, date: todayStr, status: 'paid' }],
      treasuryTxn: [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    });

    renderPage();

    expect(valueFor('الإيراد الكلي')).toBe(formatCurrency(700));
  });

  it('multiple refunds on the same payment -> cumulative amount deducted', () => {
    const { todayStr, month, year } = baseStudentAndDate();
    useAppStore.setState({
      groups: [], students: [{ id: 's1', name: 'طالب', status: 'active' }],
      payments: [{ id: 'p1', studentId: 's1', amount: 1000, month, year, date: todayStr, status: 'paid' }],
      treasuryTxn: [
        { paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 },
        { paymentId: 'p1', refType: 'refund', status: 'active', amount: 200 },
      ],
    });

    renderPage();

    expect(valueFor('الإيراد الكلي')).toBe(formatCurrency(500));
  });

  it('a payment with no refund is unaffected by another refunded payment in the same set', () => {
    const { todayStr, month, year } = baseStudentAndDate();
    useAppStore.setState({
      groups: [], students: [{ id: 's1', name: 'طالب 1', status: 'active' }, { id: 's2', name: 'طالب 2', status: 'active' }],
      payments: [
        { id: 'p1', studentId: 's1', amount: 1000, month, year, date: todayStr, status: 'paid' },
        { id: 'p2', studentId: 's2', amount: 500, month, year, date: todayStr, status: 'paid' },
      ],
      treasuryTxn: [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    });

    renderPage();

    // 700 (net p1) + 500 (untouched p2) = 1200
    expect(valueFor('الإيراد الكلي')).toBe(formatCurrency(1200));
  });

  it('"إيراد اليوم" (today revenue) is also net of a refund on a payment made today', () => {
    const { todayStr, month, year } = baseStudentAndDate();
    useAppStore.setState({
      groups: [], students: [{ id: 's1', name: 'طالب', status: 'active' }],
      payments: [{ id: 'p1', studentId: 's1', amount: 1000, month, year, date: todayStr, status: 'paid' }],
      treasuryTxn: [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    });

    renderPage();

    expect(valueFor('إيراد اليوم')).toBe(formatCurrency(700));
  });

  it('a cancelled (non-active) refund transaction is never deducted', () => {
    const { todayStr, month, year } = baseStudentAndDate();
    useAppStore.setState({
      groups: [], students: [{ id: 's1', name: 'طالب', status: 'active' }],
      payments: [{ id: 'p1', studentId: 's1', amount: 1000, month, year, date: todayStr, status: 'paid' }],
      treasuryTxn: [{ paymentId: 'p1', refType: 'refund', status: 'cancelled', amount: 300 }],
    });

    renderPage();

    expect(valueFor('الإيراد الكلي')).toBe(formatCurrency(1000));
  });

  it('existing no-refund behavior is completely unchanged (regression guard)', () => {
    const { todayStr, month, year } = baseStudentAndDate();
    useAppStore.setState({
      groups: [{ id: 'g1', name: 'G1', price: 100 }],
      students: [{ id: 's1', name: 'طالب', status: 'active', groupId: 'g1' }],
      payments: [
        { id: 'p1', studentId: 's1', groupId: 'g1', amount: 300, month, year, date: todayStr, status: 'paid' },
        { id: 'p2', studentId: 's1', groupId: 'g1', amount: 150, month, year, date: todayStr, status: 'partial' },
      ],
      treasuryTxn: [],
    });

    renderPage();

    expect(valueFor('الإيراد الكلي')).toBe(formatCurrency(450));
    expect(valueFor('إيراد اليوم')).toBe(formatCurrency(450));
  });
});
