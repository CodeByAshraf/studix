// src/modules/reports/ReportsPage.revenue.test.jsx
// BUG-02 (remaining part) — the "نظرة عامة" overview dashboard's "إيراد هذا الشهر" and the
// "من إجمالي ..." subtitle both summed payments.amount directly, bypassing any refund
// check. Now both come net-of-refunds from the server (aggregate endpoints).
//
// Scalability Architecture Phase 4 Cutover 2: ReportsPage.jsx's OverviewDashboard now
// fetches GET /api/payments/aggregate instead of reading the store's payments/treasuryTxn
// arrays directly — mockPaymentsBackend (the faithful in-memory test double of the real
// server routes, from Cutover 1) serves those requests from the same fixture arrays this
// file already used via useAppStore.setState.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReportsPage from './ReportsPage';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';
import { mockPaymentsBackend } from '../../test-utils/mockPaymentsBackend';
import { formatCurrency } from '../../utils/helpers';

afterEach(() => { vi.restoreAllMocks(); });

function seed() {
  useAppStore.setState({
    groups: [], students: [{ id: 's1', name: 'طالب', status: 'active' }],
    attendance: [], grades: [], exams: [],
  });
}

function renderPage() {
  return render(
    <ToastProvider>
      <ReportsPage />
    </ToastProvider>
  );
}

describe('ReportsPage — overview "إيراد هذا الشهر" / "من إجمالي" are net of active refunds (BUG-02, remaining part)', () => {
  it('payment 1000, refund 0 -> both show 1000', async () => {
    const month = new Date().getMonth() + 1;
    const year = new Date().getFullYear();
    seed();
    mockPaymentsBackend([{ id: 'p1', studentId: 's1', amount: 1000, month, year, status: 'paid' }], []);

    renderPage();

    expect(await screen.findByText(formatCurrency(1000))).toBeInTheDocument();
    expect(await screen.findByText(`من إجمالي ${formatCurrency(1000)}`)).toBeInTheDocument();
  });

  it('payment 1000, refund 300 -> both show 700, not 1000', async () => {
    const month = new Date().getMonth() + 1;
    const year = new Date().getFullYear();
    seed();
    mockPaymentsBackend(
      [{ id: 'p1', studentId: 's1', amount: 1000, month, year, status: 'paid' }],
      [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    );

    renderPage();

    expect(await screen.findByText(formatCurrency(700))).toBeInTheDocument();
    expect(await screen.findByText(`من إجمالي ${formatCurrency(700)}`)).toBeInTheDocument();
    expect(screen.queryByText(formatCurrency(1000))).not.toBeInTheDocument();
  });
});
