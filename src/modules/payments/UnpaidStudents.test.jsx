// src/modules/payments/UnpaidStudents.test.jsx
// MEDIUM-A Finding 1 — the "partial" tab's paidSoFar/remaining calculation counted any
// payment for the same month number regardless of year, hiding a real remaining balance
// once a student had a payment for that month number in a past year. Verifies the year
// guard added to both occurrences (aggregate + per-row).
//
// Scalability Architecture Phase 4 Cutover 1: UnpaidStudents.jsx now fetches
// GET /api/payments?month=&year= instead of reading the store's payments array — we mock
// fetch directly (same technique as PaymentsPage.payments.test.jsx) to serve that request
// from the same fixture rows used previously via useAppStore.setState.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import UnpaidStudents from './UnpaidStudents';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';
import { formatCurrency } from '../../utils/helpers';

function renderComponent() {
  return render(
    <ToastProvider>
      <UnpaidStudents onQuickPay={() => {}} />
    </ToastProvider>
  );
}

function mockPaymentsFetch(payments) {
  globalThis.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.includes('/api/payments?')) {
      const qp = new URL(u).searchParams;
      const month = qp.get('month');
      const year = qp.get('year');
      let rows = payments;
      if (month !== null) rows = rows.filter((p) => p.month === Number(month));
      if (year !== null) rows = rows.filter((p) => p.year === Number(year));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: rows }) });
    }
    return Promise.reject(new Error(`unexpected fetch: ${u}`));
  });
}
afterEach(() => { vi.restoreAllMocks(); });

describe('UnpaidStudents — partial-payment remaining balance is year-aware (MEDIUM-A Finding 1)', () => {
  it('excludes a payment from the same month number in a past year from paidSoFar/remaining', async () => {
    const now = new Date();
    const thisMonth = now.getMonth() + 1;
    const thisYear  = now.getFullYear();

    const payments = [
      { id: 'p-partial', studentId: 's1', month: thisMonth, year: thisYear, status: 'partial', amount: 100, date: `${thisYear}-01-05` },
      { id: 'p-old',     studentId: 's1', month: thisMonth, year: thisYear - 1, status: 'paid', amount: 250, date: `${thisYear - 1}-01-05` },
    ];
    useAppStore.setState({
      groups: [{ id: 'g1', name: 'مجموعة أ', price: 300 }],
      students: [{ id: 's1', name: 'طالب واحد', groupId: 'g1', status: 'active', monthlyFee: 300 }],
    });
    mockPaymentsFetch(payments);

    renderComponent();
    fireEvent.click(screen.getByRole('button', { name: /جزئي/ }));

    // paidSoFar الصحيح = 100 فقط (سنة حالية) — لا 350 (لو ضُمّت دفعة السنة الماضية خطأً)
    expect(await screen.findByText(/دفع: 100 ج\.م/)).toBeInTheDocument();
    expect(screen.queryByText(/دفع: 350 ج\.م/)).not.toBeInTheDocument();
    // remaining الصحيح = 300-100 = 200 — لو كان الخطأ قائماً لكان 0 (العنصر لا يظهر إطلاقاً)
    expect(screen.getByText('200')).toBeInTheDocument();
  });
});

// BUG-02 (remaining part) — paidSoFar/partialRemaining summed this month's payments.amount
// directly, so a refunded partial payment kept counting as fully paid, understating the
// real remaining balance. Now nets out active refunds via getNetRevenue.
describe('UnpaidStudents — paidSoFar/partialRemaining are net of active refunds (BUG-02, remaining part)', () => {
  const now = new Date();
  const MONTH = now.getMonth() + 1;
  const YEAR = now.getFullYear();
  const GROUP = { id: 'g1', name: 'مجموعة أ', price: 1000 };
  const STUDENT = { id: 's1', name: 'طالب واحد', groupId: 'g1', status: 'active', monthlyFee: 1000 };

  it('a 300 refund on a partial payment raises the remaining balance (paidSoFar nets the refund)', async () => {
    useAppStore.setState({
      groups: [GROUP], students: [STUDENT],
      treasuryTxn: [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    });
    mockPaymentsFetch([{ id: 'p1', studentId: 's1', groupId: 'g1', month: MONTH, year: YEAR, status: 'partial', amount: 500 }]);

    renderComponent();
    fireEvent.click(screen.getByRole('button', { name: /جزئي/ }));

    // paidSoFar الصافي = 500-300 = 200 (لا 500) -> remaining = 1000-200 = 800
    expect(await screen.findByText(/دفع: 200 ج\.م/)).toBeInTheDocument();
    expect(screen.getByText('800')).toBeInTheDocument();
    expect(screen.getByText(/^متبقي:/)).toBeInTheDocument();
    expect(screen.getByText(formatCurrency(800))).toBeInTheDocument();
  });

  it('a cancelled (non-active) refund does not affect paidSoFar/remaining', async () => {
    useAppStore.setState({
      groups: [GROUP], students: [STUDENT],
      treasuryTxn: [{ paymentId: 'p1', refType: 'refund', status: 'cancelled', amount: 300 }],
    });
    mockPaymentsFetch([{ id: 'p1', studentId: 's1', groupId: 'g1', month: MONTH, year: YEAR, status: 'partial', amount: 500 }]);

    renderComponent();
    fireEvent.click(screen.getByRole('button', { name: /جزئي/ }));

    expect(await screen.findByText(/دفع: 500 ج\.م/)).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
  });
});
