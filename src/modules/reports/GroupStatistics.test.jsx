// src/modules/reports/GroupStatistics.test.jsx
// Scalability Architecture Phase 4 Cutover 1 — GroupStatistics.jsx now fetches
// GET /api/payments?month=&year= (current real month/year, matching getGroupStats' own
// internal new Date()-derived scope) instead of reading the store's payments array.
// getGroupStats itself is completely unchanged — only the array fed into it changed
// source. We mock fetch directly (same technique as PaymentsPage.payments.test.jsx).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import GroupStatistics from './GroupStatistics';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

const now = new Date();
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();
const GROUP = { id: 'g1', name: 'مجموعة أ', subject: 'رياضيات', teacher: 'أ. محمد', time: '5:00', days: [], max: 30, color: '#3b82f6' };
const STUDENT = { id: 's1', name: 'طالب', groupId: 'g1', status: 'active', monthlyFee: 1000 };

function mockPaymentsFetch(payments, attendanceGroupAggregate = []) {
  const attendanceAggregateCalls = [];
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
    // C4 Attendance migration Phase 2 — same principle as GroupsPage.gridView.test.jsx:
    // ONE batched GET /api/attendance/aggregate?groupBy=group call for every group.
    if (u.includes('/api/attendance/aggregate')) {
      attendanceAggregateCalls.push(u);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: attendanceGroupAggregate }) });
    }
    return Promise.reject(new Error(`unexpected fetch: ${u}`));
  });
  return { attendanceAggregateCalls };
}
afterEach(() => { vi.restoreAllMocks(); });

function renderPage() {
  return render(
    <ToastProvider>
      <GroupStatistics />
    </ToastProvider>
  );
}

describe('GroupStatistics — group revenue comes from a scoped fetch, matches getGroupStats exactly', () => {
  it('shows the correct net revenue (paid payments this month/year, refunds excluded) for a group', async () => {
    useAppStore.setState({
      groups: [GROUP], students: [STUDENT], attendance: [],
      treasuryTxn: [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 200 }],
    });
    mockPaymentsFetch([
      { id: 'p1', studentId: 's1', groupId: 'g1', month: MONTH, year: YEAR, status: 'paid', amount: 1000 },
      { id: 'p-old', studentId: 's1', groupId: 'g1', month: MONTH, year: YEAR - 1, status: 'paid', amount: 500 },
    ]);

    renderPage();

    // net = 1000 - 200 (active refund) = 800 -> "إيراد" card shows "1k" (Math.round(800/1000))
    expect(await screen.findByText('1k')).toBeInTheDocument();
  });

  it('an empty payments feed shows zero revenue, not an error', async () => {
    useAppStore.setState({ groups: [GROUP], students: [STUDENT], attendance: [], treasuryTxn: [] });
    mockPaymentsFetch([]);

    renderPage();

    // revenueData يستبعد أي مجموعة إيرادها 0 (.filter(d=>d.value>0)) — فيظهر placeholder
    // "لا توجد بيانات" بدل الرسم البياني، بدل انتظار "0" غامضة قد تطابق أرقاماً أخرى.
    expect(await screen.findByText('لا توجد بيانات')).toBeInTheDocument();
  });
});

// C4 Attendance migration Phase 2 — getGroupStats no longer reads the store's attendance
// array (previously filtered once per group per render); GroupStatistics now fetches
// GET /api/attendance/aggregate?groupBy=group ONCE for every group.
describe('GroupStatistics — attendance % comes from one batched aggregate call, not per group', () => {
  it('fetches groupBy=group exactly once regardless of how many groups are displayed', async () => {
    const groupB = { ...GROUP, id: 'g2', name: 'مجموعة ب' };
    useAppStore.setState({ groups: [GROUP, groupB], students: [STUDENT], treasuryTxn: [] });
    const { attendanceAggregateCalls } = mockPaymentsFetch([], [
      { key: 'g1', total: 10, present: 8, absent: 2, late: 0 },
      { key: 'g2', total: 5, present: 5, absent: 0, late: 0 },
    ]);

    renderPage();
    await screen.findAllByText('مجموعة أ');

    expect(attendanceAggregateCalls).toHaveLength(1);
    expect(attendanceAggregateCalls[0]).toMatch(/groupBy=group/);
    expect(attendanceAggregateCalls[0]).not.toMatch(/groupId=/);
  });

  it('an attendance fetch failure does not crash the page — groups still render', async () => {
    useAppStore.setState({ groups: [GROUP], students: [STUDENT], treasuryTxn: [] });
    globalThis.fetch = vi.fn((url) => {
      const u = String(url);
      if (u.includes('/api/attendance/aggregate')) return Promise.reject(new Error('network error'));
      if (u.includes('/api/payments?')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: [] }) });
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    renderPage();

    expect((await screen.findAllByText('مجموعة أ')).length).toBeGreaterThan(0);
  });
});
