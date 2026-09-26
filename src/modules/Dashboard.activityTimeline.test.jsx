// src/modules/Dashboard.activityTimeline.test.jsx
// Scalability Architecture Phase 4 (activityLogs) — Dashboard.jsx's "آخر النشاطات" timeline
// widget now fetches GET /api/activityLogs?limit=5 (via pgGetActivityLogs) instead of
// reading the store's activityLogs array (no longer boot-synced). No new loading/error UI
// is required for this secondary widget (matches its sibling revenue widgets' existing
// empty-until-resolved behavior) — this file proves it requests exactly the latest 5 and
// renders them correctly, and that a fetch failure degrades to an empty (not broken) widget.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Dashboard from './Dashboard';
import { useAppStore } from '../store/app.store';
import { UIProvider } from '../store/ui.context';
import { ToastProvider } from '../components/Toast';

vi.mock('../services/api', async () => {
  const actual = await vi.importActual('../services/api');
  return {
    ...actual,
    pgGetPayments: vi.fn(),
    pgGetPaymentAggregates: vi.fn(),
    pgGetActivityLogs: vi.fn(),
  };
});
import { pgGetPayments, pgGetPaymentAggregates, pgGetActivityLogs } from '../services/api';

function renderDashboard() {
  return render(
    <ToastProvider>
      <UIProvider>
        <Dashboard />
      </UIProvider>
    </ToastProvider>
  );
}

function seed() {
  useAppStore.setState({
    students: [], groups: [], attendance: [], activityLogs: [],
    communications: [], commTasks: [], treasuryTxn: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
  pgGetPayments.mockResolvedValue([]);
  pgGetPaymentAggregates.mockResolvedValue([{ key: null, count: 0, revenue: 0 }]);
});

describe('Dashboard — "آخر النشاطات" timeline (Phase 4 activityLogs)', () => {
  it('requests exactly the latest 5 activity logs', async () => {
    pgGetActivityLogs.mockResolvedValue({ items: [], total: 0 });
    renderDashboard();
    await waitFor(() => expect(pgGetActivityLogs).toHaveBeenCalledWith({ limit: 5 }));
  });

  it('renders the returned records with description/user/module', async () => {
    pgGetActivityLogs.mockResolvedValue({
      items: [
        { id: 'al1', action: 'create', module: 'payments', user: 'أحمد', description: 'دفعة جديدة', ts: new Date().toISOString() },
      ],
      total: 1,
    });
    renderDashboard();

    expect(await screen.findByText('دفعة جديدة')).toBeInTheDocument();
    expect(await screen.findByText('أحمد · payments')).toBeInTheDocument();
  });

  it('a fetch failure leaves the timeline empty without crashing the page', async () => {
    pgGetActivityLogs.mockRejectedValue(new Error('PG GET /activityLogs → 500'));
    renderDashboard();

    // الصفحة تُكمل التصيير بلا استثناء غير مُلتقَط — عنصر معروف آخر في الصفحة يظهر بنجاح.
    expect(await screen.findByText('لوحة التحكم')).toBeInTheDocument();
  });
});
