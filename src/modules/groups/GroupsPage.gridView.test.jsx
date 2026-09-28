// src/modules/groups/GroupsPage.gridView.test.jsx
// Scalability Architecture Phase 4 Cutover 2 — GroupCard.jsx (grid view, the default view
// mode) no longer reads the store's payments array itself; GroupsPage.jsx fetches
// GET /api/payments?month=&year= (real current month/year) once and passes it down as a
// prop. getGroupStats itself is unchanged — this proves the fetched-and-passed data
// produces the exact same collection-rate/attendance numbers GroupStatistics.jsx (P9,
// Cutover 1) already proved for the identical formula, so grid view and list/analytics
// views stay equivalent after the migration.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import GroupsPage from './GroupsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

const now = new Date();
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();
// max=8 عمداً — يبعد capacityPct (activeCount/max) عن أي تصادم نصّي مع collectionRate
// المختبَرة (100%/50%/0%) — طالب واحد نشط من أصل 8 = 13% تقريباً، غير متداخل.
const GROUP = { id: 'g1', name: 'مجموعة أ', subject: 'رياضيات', teacher: 'أ. محمد', time: '5:00', days: [], max: 8, color: '#3b82f6' };
const STUDENT = { id: 's1', name: 'طالب', groupId: 'g1', status: 'active', monthlyFee: 1000 };

function mockFetch({ payments, groupAggregate = [], attendanceGroupAggregate = [] }) {
  const attendanceAggregateCalls = [];
  globalThis.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.includes('/api/payments/aggregate')) {
      const qp = new URL(u).searchParams;
      if (qp.get('groupBy') === 'group') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: groupAggregate }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: [{ key: null, count: 0, revenue: 0 }] }) });
    }
    if (u.includes('/api/payments?')) {
      const qp = new URL(u).searchParams;
      const month = qp.get('month');
      const year = qp.get('year');
      let rows = payments;
      if (month !== null) rows = rows.filter((p) => p.month === Number(month));
      if (year !== null) rows = rows.filter((p) => p.year === Number(year));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: rows }) });
    }
    // C4 Attendance migration Phase 2 — GroupCard's per-group % now comes from ONE batched
    // GET /api/attendance/aggregate?groupBy=group call (GroupsPage-level), not per-card.
    if (u.includes('/api/attendance/aggregate')) {
      attendanceAggregateCalls.push(u);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: attendanceGroupAggregate }) });
    }
    // Group Membership unification — card counts come from active enrollments; every seeded
    // student has the active Primary enrollment the real write paths create alongside groupId.
    if (u.includes('/api/enrollments')) {
      const data = useAppStore.getState().students
        .filter((s) => s.groupId)
        .map((s) => ({ id: `e-${s.id}`, studentId: s.id, groupId: s.groupId, role: 'primary', status: 'active' }));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
    }
    return Promise.reject(new Error(`unexpected fetch: ${u}`));
  });
  return { attendanceAggregateCalls };
}
afterEach(() => { vi.restoreAllMocks(); });

function renderGrid() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <GroupsPage />
      </ToastProvider>
    </AuthProvider>
  );
}

describe('GroupsPage grid view (GroupCard) — payments now fetched, not read from the store', () => {
  it('shows the correct collection rate (paid this month, net of refunds, vs expected fee) without ever seeding the store payments array', async () => {
    useAppStore.setState({
      groups: [GROUP], students: [STUDENT], attendance: [], treasuryTxn: [],
      admissions: [], communications: [], homeworks: [],
    });
    mockFetch({
      payments: [{ id: 'p1', studentId: 's1', groupId: 'g1', month: MONTH, year: YEAR, status: 'paid', amount: 1000 }],
      groupAggregate: [{ key: 'g1', count: 1, revenue: 1000 }],
    });

    renderGrid();

    // collectionRate = collected(1000) / expected(1000) * 100 = 100%
    expect(await screen.findByText('100%')).toBeInTheDocument();
  });

  it('a partially-collected month shows a collection rate below 100%, net of an active refund', async () => {
    useAppStore.setState({
      groups: [GROUP], students: [STUDENT], attendance: [], treasuryTxn: [
        { paymentId: 'p1', refType: 'refund', status: 'active', amount: 500 },
      ],
      admissions: [], communications: [], homeworks: [],
    });
    mockFetch({
      payments: [{ id: 'p1', studentId: 's1', groupId: 'g1', month: MONTH, year: YEAR, status: 'paid', amount: 1000 }],
      groupAggregate: [{ key: 'g1', count: 1, revenue: 500 }],
    });

    renderGrid();

    // collected صافٍ = 1000 - 500 = 500، expected = 1000 -> 50%
    expect(await screen.findByText('50%')).toBeInTheDocument();
  });

  it('zero payments this month shows a 0% collection rate, not an error', async () => {
    useAppStore.setState({
      groups: [GROUP], students: [STUDENT], attendance: [], treasuryTxn: [],
      admissions: [], communications: [], homeworks: [],
    });
    mockFetch({ payments: [], groupAggregate: [] });

    renderGrid();

    expect(await screen.findByText('0%')).toBeInTheDocument();
  });
});

// C4 Attendance migration Phase 2 — GroupCard no longer reads the store's attendance array
// (previously filtered per-card, N times per render); GroupsPage fetches
// GET /api/attendance/aggregate?groupBy=group once for every group and passes each card its
// own row as a prop, mirroring the payments migration proven above.
describe('GroupsPage grid view (GroupCard) — attendance % now fetched in one batched aggregate call, not per card', () => {
  const GROUP_B = { ...GROUP, id: 'g2', name: 'مجموعة ب' };

  it('shows each card\'s correct attendance percentage from ONE batched aggregate call covering every group', async () => {
    useAppStore.setState({
      groups: [GROUP, GROUP_B], students: [STUDENT], treasuryTxn: [],
      admissions: [], communications: [], homeworks: [],
    });
    const { attendanceAggregateCalls } = mockFetch({
      payments: [], groupAggregate: [],
      attendanceGroupAggregate: [
        { key: 'g1', total: 10, present: 8, absent: 2, late: 0 },
        { key: 'g2', total: 4, present: 1, absent: 3, late: 0 },
      ],
    });

    renderGrid();

    // g1: 8/10 = 80%, g2: 1/4 = 25%
    expect(await screen.findByText('80%')).toBeInTheDocument();
    expect(await screen.findByText('25%')).toBeInTheDocument();
    // exactly one request for the whole page, regardless of how many groups are shown —
    // never one request per card.
    expect(attendanceAggregateCalls).toHaveLength(1);
    expect(attendanceAggregateCalls[0]).not.toMatch(/groupId=/);
  });

  it('a group with no attendance history at all shows "—" (not 0% or an error), matching the old "recentAtt.length === 0 -> null" behavior', async () => {
    useAppStore.setState({
      groups: [GROUP], students: [STUDENT], treasuryTxn: [],
      admissions: [], communications: [], homeworks: [],
    });
    mockFetch({ payments: [], groupAggregate: [], attendanceGroupAggregate: [] });

    renderGrid();

    const label = await screen.findByText('حضور %');
    expect(within(label.parentElement).getByText('—')).toBeInTheDocument();
  });
});
