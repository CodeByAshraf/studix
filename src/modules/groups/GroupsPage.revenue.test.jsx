// src/modules/groups/GroupsPage.revenue.test.jsx
// BUG-02 (remaining part) — the "الإيراد الكلي" overview KPI and the list-view per-group
// revenue column both summed payments.amount directly, bypassing any refund check. Both
// now come net-of-refunds from the server (GET /api/payments/aggregate) instead of a
// client-side getNetRevenue(payments, treasuryTxn) computation.
//
// Scalability Architecture Phase 4 Cutover 1: GroupsPage.jsx no longer reads the store's
// payments/treasuryTxn arrays for these two numbers — it fetches
// GET /api/payments/aggregate?groupBy=none (overview total) and ?groupBy=group (list-view
// per-group revenue) instead. We mock fetch directly (same technique as
// PaymentsPage.payments.test.jsx) to drive those two aggregate responses.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import GroupsPage from './GroupsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';
import { formatCurrency } from '../../utils/helpers';

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <GroupsPage />
      </ToastProvider>
    </AuthProvider>
  );
}

const GROUP = { id: 'g1', name: 'مجموعة أ', subject: 'رياضيات', grade: 'الأول الثانوي', teacher: 'أ. محمد', price: 1000, max: 30, days: [], time: '5:00' };

function seed({ total, byGroup }) {
  useAppStore.setState({
    groups: [GROUP], students: [{ id: 's1', name: 'طالب', groupId: 'g1', status: 'active' }],
    attendance: [], admissions: [], communications: [], exams: [], homeworks: [],
  });
  globalThis.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.includes('/api/payments/aggregate')) {
      const qp = new URL(u).searchParams;
      const groupBy = qp.get('groupBy');
      if (groupBy === 'none') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: [{ key: null, count: 1, revenue: total }] }) });
      }
      if (groupBy === 'group') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: byGroup }) });
      }
    }
    return Promise.reject(new Error(`unexpected fetch: ${u}`));
  });
}
afterEach(() => { vi.restoreAllMocks(); });

describe('GroupsPage — OverviewBar "الإيراد الكلي" is net of active refunds (BUG-02, remaining part)', () => {
  it('payment 1000, refund 0 -> shows 1000', async () => {
    seed({ total: 1000, byGroup: [{ key: 'g1', count: 1, revenue: 1000 }] });
    renderPage();
    expect(await screen.findByText(formatCurrency(1000))).toBeInTheDocument();
  });

  it('payment 1000, refund 300 -> shows 700, not 1000', async () => {
    seed({ total: 700, byGroup: [{ key: 'g1', count: 1, revenue: 700 }] });
    renderPage();
    expect(await screen.findByText(formatCurrency(700))).toBeInTheDocument();
    expect(screen.queryByText(formatCurrency(1000))).not.toBeInTheDocument();
  });
});

describe('GroupsPage — list view per-group revenue is net of active refunds (BUG-02, remaining part)', () => {
  it('a refunded payment reduces the group\'s list-row revenue', async () => {
    seed({ total: 700, byGroup: [{ key: 'g1', count: 1, revenue: 700 }] });
    renderPage();
    fireEvent.click(screen.getByText('≡ قائمة'));
    expect(await screen.findByText(formatCurrency(700).replace(' ج.م', ''))).toBeInTheDocument();
  });
});
