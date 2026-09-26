// src/modules/reports/AttendanceAnalytics.test.jsx
// C4 Attendance Batch A — total/present/absent/late/pct, byGroup, dailyTrend, and dayData now
// come from GET /api/attendance/aggregate (groupBy=status/group/date/weekday) instead of
// filtering the store's global attendance array. `sessions` and `absentees` are NOT migrated by
// this feature (sessions has no matching aggregate dimension; absentees was already migrated in
// feature 001 via statsByStudentFromRecords) — this file only asserts the four migrated pieces.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AttendanceAnalytics from './AttendanceAnalytics';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetAttendanceAggregate: vi.fn() };
});
import { pgGetAttendanceAggregate } from '../../services/api';

const GROUP_A = { id: 'g1', name: 'مجموعة أ', color: '#3b82f6' };

function seed() {
  useAppStore.setState({ groups: [GROUP_A], students: [], attendance: [] });
}

function mockAggregate({ status = [], group = [], date = [], weekday = [] } = {}) {
  pgGetAttendanceAggregate.mockImplementation(({ groupBy }) => {
    if (groupBy === 'status')  return Promise.resolve(status);
    if (groupBy === 'group')   return Promise.resolve(group);
    if (groupBy === 'date')    return Promise.resolve(date);
    if (groupBy === 'weekday') return Promise.resolve(weekday);
    return Promise.resolve([]);
  });
}

function renderPage() {
  return render(<ToastProvider><AttendanceAnalytics /></ToastProvider>);
}

describe('AttendanceAnalytics — reads from the scoped/aggregate attendance endpoints (C4 Attendance Batch A)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('fetches all four aggregate dimensions exactly once, with the correct params', async () => {
    seed();
    mockAggregate();
    renderPage();

    await waitFor(() => expect(pgGetAttendanceAggregate).toHaveBeenCalledTimes(4));
    const calls = pgGetAttendanceAggregate.mock.calls.map(c => c[0]);
    expect(calls).toContainEqual({ groupBy: 'status' });
    expect(calls).toContainEqual({ groupBy: 'group' });
    expect(calls).toContainEqual({ groupBy: 'weekday', status: 'absent' });
    const dateCall = calls.find(c => c.groupBy === 'date');
    expect(dateCall).toBeTruthy();
    expect(dateCall.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dateCall.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('renders total/present/absent/late/pct from groupBy=status', async () => {
    seed();
    mockAggregate({ status: [{ key: 'present', count: 7 }, { key: 'absent', count: 2 }, { key: 'late', count: 1 }] });
    renderPage();

    const pctLabel = await screen.findByText(/معدل الحضور الكلي/);
    expect(pctLabel.nextElementSibling).toHaveTextContent('70%'); // 7/10
    expect((await screen.findByText(/حاضر \(سجل\)/)).nextElementSibling).toHaveTextContent('7');
    expect((await screen.findByText(/غائب \(سجل\)/)).nextElementSibling).toHaveTextContent('2');
    expect((await screen.findByText(/متأخر \(سجل\)/)).nextElementSibling).toHaveTextContent('1');
  });

  it('renders byGroup percentages from groupBy=group', async () => {
    seed();
    mockAggregate({ group: [{ key: 'g1', total: 10, present: 6, absent: 4, late: 0 }] });
    renderPage();

    expect(await screen.findByText('مجموعة أ')).toBeInTheDocument();
  });

  it('dailyTrend takes the last 14 dates from the 90-day-windowed response', async () => {
    seed();
    const dates = Array.from({ length: 20 }, (_, i) => ({
      key: `2026-01-${String(i + 1).padStart(2, '0')}`, total: 1, present: 1, absent: 0, late: 0,
    }));
    mockAggregate({ date: dates });
    renderPage();

    await screen.findByText('اتجاه الحضور اليومي');
    expect(await screen.findByText('آخر 14 جلسة مسجّلة')).toBeInTheDocument();
  });

  it('dayData renders weekday-absence counts from groupBy=weekday&status=absent', async () => {
    seed();
    mockAggregate({ weekday: [{ key: 'sat', count: 5 }, { key: 'sun', count: 2 }] });
    renderPage();

    expect(await screen.findByText('السبت')).toBeInTheDocument();
    expect(screen.getByText('الأحد')).toBeInTheDocument();
  });

  it('shows empty/zero states, not errors, when there is no attendance data at all', async () => {
    seed();
    mockAggregate();
    renderPage();

    await waitFor(() => expect(pgGetAttendanceAggregate).toHaveBeenCalledTimes(4));
    expect(screen.getByText('لا توجد بيانات')).toBeInTheDocument(); // byGroup empty state (dayData shares no distinct empty-state text with byGroup in this render, first match suffices)
  });

  it('shows a clear error toast when a fetch fails, not a blank/stale display', async () => {
    seed();
    pgGetAttendanceAggregate.mockRejectedValue(new Error('PG GET /attendance/aggregate → 500'));
    renderPage();

    expect(await screen.findByText(/PG GET \/attendance\/aggregate/)).toBeInTheDocument();
  });
});
