// src/modules/reports/FinancialAnalytics.test.jsx
// MEDIUM-A Finding 1 — "لم يدفعوا هذا الشهر" (unpaidCount) treated a payment for the
// same month number in a PAST year as "paid this month", hiding a genuinely-unpaid
// student from this KPI. Verifies the year guard added to paidThisMonth.
//
// Scalability Architecture Phase 4 Cutover 1: FinancialAnalytics.jsx now fetches every
// number/chart from GET /api/payments and /api/payments/aggregate instead of reading the
// store's payments/treasuryTxn arrays directly — mockPaymentsBackend (a faithful in-memory
// test double of the real server routes) serves those requests from the same fixture
// arrays this file already used via useAppStore.setState.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FinancialAnalytics from './FinancialAnalytics';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';
import { mockPaymentsBackend } from '../../test-utils/mockPaymentsBackend';
import { formatCurrency } from '../../utils/helpers';
import { vi } from 'vitest';

afterEach(() => { vi.restoreAllMocks(); });

function renderPage() {
  return render(
    <ToastProvider>
      <FinancialAnalytics />
    </ToastProvider>
  );
}

describe('FinancialAnalytics — unpaidCount is year-aware (MEDIUM-A Finding 1)', () => {
  it('counts an active student as unpaid this month even if they paid the same month number last year', async () => {
    const now = new Date();
    const thisMonth = now.getMonth() + 1;
    const thisYear  = now.getFullYear();

    useAppStore.setState({
      groups: [],
      students: [{ id: 's1', name: 'طالب', status: 'active' }],
    });
    mockPaymentsBackend([
      { id: 'p-old', studentId: 's1', month: thisMonth, year: thisYear - 1, status: 'paid', amount: 100, date: `${thisYear - 1}-01-01` },
    ], []);

    renderPage();

    const label = await screen.findByText('لم يدفعوا هذا الشهر');
    const valueDiv = label.closest('div').nextElementSibling;
    await waitFor(() => expect(valueDiv).toHaveTextContent('1'));
  });
});

// BUG-02 (remaining part) — every revenue KPI/chart here ("الإيراد الكلي", "إيراد هذا
// الشهر", "إيراد اليوم", the monthly trend chart, the by-group chart) summed raw
// payments.amount directly, bypassing paymentService entirely, and so kept overstating
// revenue after a refund. All now come net-of-refunds from the server (aggregate
// endpoints) — same single source of truth PaymentsPage.jsx/PaymentReports.jsx now use too.
describe('FinancialAnalytics — revenue KPIs are net of active refunds (BUG-02, remaining part)', () => {
  async function valueFor(labelText) {
    const label = await screen.findByText(labelText);
    return label.closest('div').nextElementSibling.textContent;
  }

  it('Payment 1000, refund 0 -> "الإيراد الكلي" shows 1000', async () => {
    const now = new Date();
    useAppStore.setState({
      groups: [], students: [{ id: 's1', name: 'طالب', status: 'active' }],
    });
    mockPaymentsBackend(
      [{ id: 'p1', studentId: 's1', amount: 1000, month: now.getMonth() + 1, year: now.getFullYear(), date: now.toISOString().split('T')[0], status: 'paid', method: 'cash' }],
      [],
    );

    renderPage();

    expect(await valueFor('الإيراد الكلي')).toBe(formatCurrency(1000));
  });

  it('Payment 1000, refund 300 -> "الإيراد الكلي" shows 700, not 1000', async () => {
    const now = new Date();
    useAppStore.setState({
      groups: [], students: [{ id: 's1', name: 'طالب', status: 'active' }],
    });
    mockPaymentsBackend(
      [{ id: 'p1', studentId: 's1', amount: 1000, month: now.getMonth() + 1, year: now.getFullYear(), date: now.toISOString().split('T')[0], status: 'paid', method: 'cash' }],
      [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    );

    renderPage();

    expect(await valueFor('الإيراد الكلي')).toBe(formatCurrency(700));
  });

  it('multiple refunds on the same payment reduce "الإيراد الكلي" by their cumulative amount', async () => {
    const now = new Date();
    useAppStore.setState({
      groups: [], students: [{ id: 's1', name: 'طالب', status: 'active' }],
    });
    mockPaymentsBackend(
      [{ id: 'p1', studentId: 's1', amount: 1000, month: now.getMonth() + 1, year: now.getFullYear(), date: now.toISOString().split('T')[0], status: 'paid', method: 'cash' }],
      [
        { paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 },
        { paymentId: 'p1', refType: 'refund', status: 'active', amount: 200 },
      ],
    );

    renderPage();

    expect(await valueFor('الإيراد الكلي')).toBe(formatCurrency(500));
  });

  it('"إيراد اليوم" (today) is also net of a refund on a payment made today', async () => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const treasuryTxn = [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }];
    // todayRev (بخلاف total/monthly/byGroup) يُحسَب محلياً عبر getNetRevenue(todayPayments,
    // treasuryTxn) — لا نظير له في /aggregate (لا يقبل date=) — فيحتاج treasuryTxn من
    // الـ store أيضاً، لا فقط ما يُمرَّر لـ mockPaymentsBackend (المُستخدَم لحساب استجابات
    // الخادم المُجمَّعة الأخرى فقط).
    useAppStore.setState({
      groups: [], students: [{ id: 's1', name: 'طالب', status: 'active' }], treasuryTxn,
    });
    mockPaymentsBackend(
      [{ id: 'p1', studentId: 's1', amount: 1000, month: now.getMonth() + 1, year: now.getFullYear(), date: todayStr, status: 'paid', method: 'cash' }],
      treasuryTxn,
    );

    renderPage();

    expect(await valueFor('إيراد اليوم')).toBe(formatCurrency(700));
  });

  it('existing no-refund behavior remains unchanged (regression guard)', async () => {
    const now = new Date();
    useAppStore.setState({
      groups: [{ id: 'g1', name: 'G1', color: '#3b82f6' }],
      students: [{ id: 's1', name: 'طالب', status: 'active', groupId: 'g1' }],
    });
    mockPaymentsBackend(
      [{ id: 'p1', studentId: 's1', groupId: 'g1', amount: 300, month: now.getMonth() + 1, year: now.getFullYear(), date: now.toISOString().split('T')[0], status: 'paid', method: 'cash' }],
      [],
    );

    renderPage();

    expect(await valueFor('الإيراد الكلي')).toBe(formatCurrency(300));
  });
});

// M-01 — "paid this month" is the derived month state (net subscription money >= the student's
// fee), never payments.status: instalments recorded as "partial" that reach the fee count as paid;
// a material payment, however large, never pays the subscription.
describe('FinancialAnalytics — unpaidCount/collectRate use the derived month state (M-01)', () => {
  async function valueFor(labelText) {
    const label = await screen.findByText(labelText);
    return label.closest('div').nextElementSibling;
  }

  it('instalments 300 + 200 of 500 -> paid; 300 of 500 -> not paid; material only -> not paid', async () => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year  = now.getFullYear();
    const date  = `${year}-${String(month).padStart(2, '0')}-05`;
    const pay = (id, studentId, amount, extra = {}) => ({
      id, studentId, amount, month, year, date, method: 'cash', payType: 'subscription', status: 'partial', ...extra,
    });
    useAppStore.setState({
      groups: [],
      treasuryTxn: [],
      students: [
        { id: 's1', name: 'أقساط', status: 'active', monthlyFee: 500 },
        { id: 's2', name: 'جزئي', status: 'active', monthlyFee: 500 },
        { id: 's3', name: 'مذكرة', status: 'active', monthlyFee: 500 },
        { id: 's4', name: 'كامل', status: 'active', monthlyFee: 500 },
      ],
    });
    mockPaymentsBackend([
      pay('a', 's1', 300), pay('b', 's1', 200),
      pay('c', 's2', 300),
      pay('d', 's3', 900, { payType: 'material', status: 'paid' }),
      pay('e', 's4', 500, { status: 'paid' }),
    ], []);

    renderPage();

    await waitFor(async () => expect(await valueFor('لم يدفعوا هذا الشهر')).toHaveTextContent('2'));
    await waitFor(async () => expect(await valueFor('معدل التحصيل')).toHaveTextContent('50%'));
  });
});
