// src/modules/reports/ReportsPage.test.jsx
// MEDIUM-A Finding 1 — "هذا الشهر" (overview payments quick-stat) filtered by month
// number only, counting the same calendar month across every past year. Verifies the
// year guard added to ReportsPage.jsx's OverviewDashboard.
//
// Scalability Architecture Phase 4 Cutover 2: this count now comes from the server
// (GET /api/payments/aggregate?groupBy=none&month=&year=, exact equality — the current
// behavior has no year/date fallback, and none is introduced) instead of a client-side
// filter over the store's payments array.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReportsPage from './ReportsPage';
import AttendanceAnalytics from './AttendanceAnalytics';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';
import { mockPaymentsBackend } from '../../test-utils/mockPaymentsBackend';

// C4 Attendance Batch A — OverviewDashboard's attPct now comes from
// GET /api/attendance/aggregate?groupBy=status instead of the global attendance store array.
vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetAttendanceAggregate: vi.fn() };
});
import { pgGetAttendanceAggregate } from '../../services/api';

beforeEach(() => { pgGetAttendanceAggregate.mockResolvedValue([]); });
afterEach(() => { vi.restoreAllMocks(); });

describe('ReportsPage — overview payments quick-stat is year-aware (MEDIUM-A Finding 1)', () => {
  it('"هذا الشهر" only counts payments from the current month AND current year, not the same month number in a past year', async () => {
    const now = new Date();
    const thisMonth = now.getMonth() + 1;
    const thisYear  = now.getFullYear();

    useAppStore.setState({ students: [], groups: [], attendance: [], grades: [], exams: [] });
    mockPaymentsBackend([
      { id: 'p-this', studentId: 's1', month: thisMonth, year: thisYear, amount: 100, date: `${thisYear}-01-01` },
      { id: 'p-old',  studentId: 's1', month: thisMonth, year: thisYear - 1, amount: 100, date: `${thisYear - 1}-01-01` },
    ], []);

    render(
      <ToastProvider>
        <ReportsPage />
      </ToastProvider>
    );

    const label = await screen.findByText('هذا الشهر');
    const valueSpan = label.parentElement.querySelector('span:last-child');
    expect(valueSpan).toHaveTextContent('1');
  });
});

describe('ReportsPage — overview "معدل الحضور" reads from the scoped attendance aggregate (C4 Attendance Batch A)', () => {
  it('fetches GET /api/attendance/aggregate?groupBy=status exactly once and renders the resulting percentage', async () => {
    useAppStore.setState({ students: [], groups: [], attendance: [], grades: [], exams: [] });
    mockPaymentsBackend([], []);
    pgGetAttendanceAggregate.mockResolvedValue([
      { key: 'present', count: 8 },
      { key: 'absent',  count: 2 },
    ]);

    render(<ToastProvider><ReportsPage /></ToastProvider>);

    await waitFor(() => expect(pgGetAttendanceAggregate).toHaveBeenCalledTimes(1));
    expect(pgGetAttendanceAggregate).toHaveBeenCalledWith({ groupBy: 'status' });

    const label = await screen.findByText(/معدل الحضور/);
    const valueDiv = label.nextElementSibling;
    expect(valueDiv).toHaveTextContent('80%'); // 8 present / 10 total
  });

  it('shows "—" when there is no attendance data at all, not an error', async () => {
    useAppStore.setState({ students: [], groups: [], attendance: [], grades: [], exams: [] });
    mockPaymentsBackend([], []);
    pgGetAttendanceAggregate.mockResolvedValue([]);

    render(<ToastProvider><ReportsPage /></ToastProvider>);

    const label = await screen.findByText(/معدل الحضور/);
    const valueDiv = label.nextElementSibling;
    expect(valueDiv).toHaveTextContent('—');
  });
});

// T006 — Cross-Cutting Verification (spec.md Edge Cases: "two consumers computing the same
// underlying figure must continue to agree with each other, exactly as they do today").
// ReportsPage's attPct and AttendanceAnalytics' pct both derive from the identical
// groupBy=status shape — verifying that here (rather than a new test file) since both are
// already exercised in this file.
describe('ReportsPage attPct and AttendanceAnalytics pct agree on the same underlying data (spec.md Edge Cases)', () => {
  it('render the same percentage for the same groupBy=status aggregate response', async () => {
    useAppStore.setState({ groups: [], students: [], attendance: [], grades: [], exams: [] });
    mockPaymentsBackend([], []);
    pgGetAttendanceAggregate.mockResolvedValue([{ key: 'present', count: 3 }, { key: 'absent', count: 1 }]); // 75%

    const { unmount } = render(<ToastProvider><ReportsPage /></ToastProvider>);
    await waitFor(() => {
      const reportsLabel = screen.getByText(/معدل الحضور/);
      expect(reportsLabel.nextElementSibling).toHaveTextContent('75%');
    });
    unmount();

    render(<ToastProvider><AttendanceAnalytics /></ToastProvider>);
    await waitFor(() => {
      const analyticsLabel = screen.getByText(/معدل الحضور الكلي/);
      expect(analyticsLabel.nextElementSibling).toHaveTextContent('75%');
    });
  });
});
