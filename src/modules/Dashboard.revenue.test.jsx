// src/modules/Dashboard.revenue.test.jsx
// BUG-02 (remaining part, final sweep) — the "إيراد هذا الشهر" KPI was hardcoded to a
// fixed calendar month (month === 3, "March") regardless of the real current date, and
// summed payments.amount directly, bypassing any refund check — a payment refunded
// (partially or fully) kept counting as fully collected forever. Now uses the current
// month/year (same convention as ReportsPage.jsx/FinancialAnalytics.jsx) and nets out
// active refunds via the shared getNetRevenue() helper (same single source of truth used
// everywhere else in the app — no refund logic duplicated here).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Dashboard from './Dashboard';
import { useAppStore } from '../store/app.store';
import { UIProvider } from '../store/ui.context';
import { formatCurrency } from '../utils/helpers';

function renderDashboard() {
  return render(
    <UIProvider>
      <Dashboard />
    </UIProvider>
  );
}

function seed(payments, treasuryTxn = []) {
  useAppStore.setState({
    students: [], groups: [], attendance: [], activityLogs: [],
    communications: [], commTasks: [],
    payments, treasuryTxn,
  });
}

function currentMonthYear() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

describe('Dashboard — "إيراد هذا الشهر" is net of active refunds (BUG-02, remaining part)', () => {
  it('payment 1000, refund 0 -> revenue unchanged at 1000', () => {
    const { month, year } = currentMonthYear();
    seed([{ id: 'p1', studentId: 's1', month, year, amount: 1000, status: 'paid' }], []);
    renderDashboard();
    expect(screen.getByText(formatCurrency(1000))).toBeInTheDocument();
  });

  it('payment 1000, active refund 300 -> revenue shows 700, not 1000', () => {
    const { month, year } = currentMonthYear();
    seed(
      [{ id: 'p1', studentId: 's1', month, year, amount: 1000, status: 'paid' }],
      [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    );
    renderDashboard();
    expect(screen.getByText(formatCurrency(700))).toBeInTheDocument();
    expect(screen.queryByText(formatCurrency(1000))).not.toBeInTheDocument();
  });

  it('multiple active refunds on the same payment are deducted cumulatively', () => {
    const { month, year } = currentMonthYear();
    seed(
      [{ id: 'p1', studentId: 's1', month, year, amount: 1000, status: 'paid' }],
      [
        { paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 },
        { paymentId: 'p1', refType: 'refund', status: 'active', amount: 200 },
      ],
    );
    renderDashboard();
    expect(screen.getByText(formatCurrency(500))).toBeInTheDocument();
  });

  it('a cancelled (non-active) refund transaction is never deducted', () => {
    const { month, year } = currentMonthYear();
    seed(
      [{ id: 'p1', studentId: 's1', month, year, amount: 1000, status: 'paid' }],
      [{ paymentId: 'p1', refType: 'refund', status: 'cancelled', amount: 300 }],
    );
    renderDashboard();
    expect(screen.getByText(formatCurrency(1000))).toBeInTheDocument();
  });

  it('no payments -> revenue shows 0', () => {
    seed([], []);
    renderDashboard();
    expect(screen.getByText(formatCurrency(0))).toBeInTheDocument();
  });

  it('only counts the current calendar month — a payment from last month is excluded', () => {
    const now = new Date();
    const thisMonth = now.getMonth() + 1;
    const thisYear = now.getFullYear();
    const lastMonth = thisMonth === 1 ? 12 : thisMonth - 1;
    const lastMonthYear = thisMonth === 1 ? thisYear - 1 : thisYear;

    seed([
      { id: 'p-this', studentId: 's1', month: thisMonth, year: thisYear, amount: 100, status: 'paid' },
      { id: 'p-last', studentId: 's2', month: lastMonth, year: lastMonthYear, amount: 900, status: 'paid' },
    ], []);
    renderDashboard();

    expect(screen.getByText(formatCurrency(100))).toBeInTheDocument();
    expect(screen.queryByText(formatCurrency(1000))).not.toBeInTheDocument();
  });

  it('only counts the current year — the same month number in a past year is excluded', () => {
    const now = new Date();
    const thisMonth = now.getMonth() + 1;
    const thisYear = now.getFullYear();

    seed([
      { id: 'p-this', studentId: 's1', month: thisMonth, year: thisYear, amount: 100, status: 'paid' },
      { id: 'p-old', studentId: 's2', month: thisMonth, year: thisYear - 1, amount: 900, status: 'paid' },
    ], []);
    renderDashboard();

    expect(screen.getByText(formatCurrency(100))).toBeInTheDocument();
    expect(screen.queryByText(formatCurrency(1000))).not.toBeInTheDocument();
  });
});
