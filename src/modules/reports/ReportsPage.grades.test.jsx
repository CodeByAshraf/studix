// src/modules/reports/ReportsPage.grades.test.jsx
// Phase 1D (Grades global-read migration) — OverviewDashboard's "avgExamPct" now comes from
// GET /api/grades/aggregate?groupBy=none instead of filtering the store's global grades array.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReportsPage from './ReportsPage';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';
import { mockPaymentsBackend } from '../../test-utils/mockPaymentsBackend';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetAttendanceAggregate: vi.fn(), pgGetGradesAggregate: vi.fn() };
});
import { pgGetAttendanceAggregate, pgGetGradesAggregate } from '../../services/api';

beforeEach(() => {
  pgGetAttendanceAggregate.mockResolvedValue([]);
  pgGetGradesAggregate.mockResolvedValue([]);
});
afterEach(() => { vi.restoreAllMocks(); });

function renderPage() {
  return render(<ToastProvider><ReportsPage /></ToastProvider>);
}

describe('ReportsPage overview — exam average reads from the scoped grades aggregate (Phase 1D)', () => {
  it('fetches GET /api/grades/aggregate?groupBy=none exactly once', async () => {
    useAppStore.setState({ students: [], groups: [], attendance: [], grades: [], exams: [] });
    mockPaymentsBackend([], []);
    renderPage();

    await waitFor(() => expect(pgGetGradesAggregate).toHaveBeenCalledTimes(1));
    expect(pgGetGradesAggregate).toHaveBeenCalledWith({ groupBy: 'none' });
  });

  it('renders the average exam percentage from the aggregate response', async () => {
    useAppStore.setState({ students: [], groups: [], attendance: [], grades: [], exams: [] });
    mockPaymentsBackend([], []);
    pgGetGradesAggregate.mockResolvedValue([{ avgPct: 72, count: 9 }]);
    renderPage();

    // Big is redefined on every OverviewDashboard render (a pre-existing pattern, not
    // introduced here), so React remounts it and a captured DOM reference goes stale —
    // re-query fresh on every poll instead of caching the label node once.
    await waitFor(() => {
      const label = screen.getByText(/متوسط الدرجات/);
      expect(label.nextElementSibling).toHaveTextContent('72%');
    });
  });

  it('shows "—" when there is no grade data at all, not an error', async () => {
    useAppStore.setState({ students: [], groups: [], attendance: [], grades: [], exams: [] });
    mockPaymentsBackend([], []);
    pgGetGradesAggregate.mockResolvedValue([]);
    renderPage();

    await waitFor(() => {
      const label = screen.getByText(/متوسط الدرجات/);
      expect(label.nextElementSibling).toHaveTextContent('—');
    });
  });
});
