// src/modules/Dashboard.revenue.test.jsx
// BUG-02 (remaining part, final sweep) — the "إيراد هذا الشهر" KPI was hardcoded to a
// fixed calendar month (month === 3, "March") regardless of the real current date, and
// summed payments.amount directly, bypassing any refund check — a payment refunded
// (partially or fully) kept counting as fully collected forever. Now uses the current
// month/year (same convention as ReportsPage.jsx/FinancialAnalytics.jsx) and nets out
// active refunds via the shared getNetRevenue() helper (same single source of truth used
// everywhere else in the app — no refund logic duplicated here).
//
// Scalability Architecture Phase 4 Cutover 1: Dashboard.jsx now fetches
// GET /api/payments?month=&year= (this month, feeds monthRev/monthPaid) and
// GET /api/payments/aggregate?groupBy=none&month=&year= (last month, a single number)
// instead of reading the store's payments array. We mock fetch directly (same technique
// as PaymentsPage.payments.test.jsx), deriving both responses from one fixture array so
// the tests stay a single source of truth per scenario.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Dashboard from './Dashboard';
import { useAppStore } from '../store/app.store';
import { UIProvider } from '../store/ui.context';
import { ToastProvider } from '../components/Toast';
import { formatCurrency } from '../utils/helpers';

function renderDashboard() {
  return render(
    <ToastProvider>
      <UIProvider>
        <Dashboard />
      </UIProvider>
    </ToastProvider>
  );
}

function mockPaymentsFetch(payments, treasuryTxn = []) {
  globalThis.fetch = vi.fn((url) => {
    const u = String(url);
    const qp = new URL(u).searchParams;
    const month = qp.get('month');
    const year = qp.get('year');
    let rows = payments;
    if (month !== null) rows = rows.filter((p) => p.month === Number(month));
    if (year !== null) rows = rows.filter((p) => p.year === Number(year));

    if (u.includes('/api/payments/aggregate')) {
      const gross = rows.reduce((s, p) => s + Number(p.amount), 0);
      const refunded = rows.reduce((s, p) => {
        const refs = treasuryTxn.filter((t) => t.paymentId === p.id && t.refType === 'refund' && t.status === 'active');
        return s + refs.reduce((rs, t) => rs + Number(t.amount), 0);
      }, 0);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: [{ key: null, count: rows.length, revenue: gross - refunded }] }) });
    }
    if (u.includes('/api/payments?')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: rows }) });
    }
    return Promise.reject(new Error(`unexpected fetch: ${u}`));
  });
}
afterEach(() => { vi.restoreAllMocks(); });

function seed(payments, treasuryTxn = []) {
  useAppStore.setState({
    students: [], groups: [], attendance: [], activityLogs: [],
    communications: [], commTasks: [], treasuryTxn,
  });
  mockPaymentsFetch(payments, treasuryTxn);
}

function currentMonthYear() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

describe('Dashboard — "إيراد هذا الشهر" is net of active refunds (BUG-02, remaining part)', () => {
  it('payment 1000, refund 0 -> revenue unchanged at 1000', async () => {
    const { month, year } = currentMonthYear();
    seed([{ id: 'p1', studentId: 's1', month, year, amount: 1000, status: 'paid' }], []);
    renderDashboard();
    expect(await screen.findByText(formatCurrency(1000))).toBeInTheDocument();
  });

  it('payment 1000, active refund 300 -> revenue shows 700, not 1000', async () => {
    const { month, year } = currentMonthYear();
    seed(
      [{ id: 'p1', studentId: 's1', month, year, amount: 1000, status: 'paid' }],
      [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    );
    renderDashboard();
    expect(await screen.findByText(formatCurrency(700))).toBeInTheDocument();
    expect(screen.queryByText(formatCurrency(1000))).not.toBeInTheDocument();
  });

  it('multiple active refunds on the same payment are deducted cumulatively', async () => {
    const { month, year } = currentMonthYear();
    seed(
      [{ id: 'p1', studentId: 's1', month, year, amount: 1000, status: 'paid' }],
      [
        { paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 },
        { paymentId: 'p1', refType: 'refund', status: 'active', amount: 200 },
      ],
    );
    renderDashboard();
    expect(await screen.findByText(formatCurrency(500))).toBeInTheDocument();
  });

  it('a cancelled (non-active) refund transaction is never deducted', async () => {
    const { month, year } = currentMonthYear();
    seed(
      [{ id: 'p1', studentId: 's1', month, year, amount: 1000, status: 'paid' }],
      [{ paymentId: 'p1', refType: 'refund', status: 'cancelled', amount: 300 }],
    );
    renderDashboard();
    expect(await screen.findByText(formatCurrency(1000))).toBeInTheDocument();
  });

  it('no payments -> revenue shows 0', async () => {
    seed([], []);
    renderDashboard();
    expect(await screen.findByText(formatCurrency(0))).toBeInTheDocument();
  });

  it('only counts the current calendar month — a payment from last month is excluded', async () => {
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

    expect(await screen.findByText(formatCurrency(100))).toBeInTheDocument();
    expect(screen.queryByText(formatCurrency(1000))).not.toBeInTheDocument();
  });

  it('only counts the current year — the same month number in a past year is excluded', async () => {
    const now = new Date();
    const thisMonth = now.getMonth() + 1;
    const thisYear = now.getFullYear();

    seed([
      { id: 'p-this', studentId: 's1', month: thisMonth, year: thisYear, amount: 100, status: 'paid' },
      { id: 'p-old', studentId: 's2', month: thisMonth, year: thisYear - 1, amount: 900, status: 'paid' },
    ], []);
    renderDashboard();

    expect(await screen.findByText(formatCurrency(100))).toBeInTheDocument();
    expect(screen.queryByText(formatCurrency(1000))).not.toBeInTheDocument();
  });
});

// M-01 — "N طالب دفع" counts students whose month is FULLY paid by net subscription money
// (derived month state), never payments.status: instalments reaching the fee count, a partial
// month, a fully refunded "paid" record and a material payment do not.
describe('Dashboard — "طالب دفع" uses the derived month state (M-01)', () => {
  it('instalments 300 + 200 of 500 count; partial, fully-refunded and material-only do not', async () => {
    const { month, year } = currentMonthYear();
    const date = `${year}-${String(month).padStart(2, '0')}-05`;
    const pay = (id, studentId, amount, extra = {}) => ({
      id, studentId, amount, month, year, date, payType: 'subscription', status: 'partial', ...extra,
    });
    const refunds = [{ paymentId: 'e', refType: 'refund', status: 'active', amount: 500 }];
    seed([
      pay('a', 's1', 300), pay('b', 's1', 200),
      pay('c', 's2', 300),
      pay('d', 's3', 900, { payType: 'material', status: 'paid' }),
      pay('e', 's4', 500, { status: 'paid' }),
    ], refunds);
    useAppStore.setState({
      students: ['s1', 's2', 's3', 's4'].map((id) => ({ id, name: id, status: 'active', monthlyFee: 500 })),
    });
    const paymentsFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((url) => (String(url).includes('/api/attendance')
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: [] }) })
      : paymentsFetch(url)));

    renderDashboard();

    expect(await screen.findByText('1 طالب دفع')).toBeInTheDocument();
  });
});
