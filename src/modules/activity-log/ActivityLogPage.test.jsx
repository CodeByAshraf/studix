// src/modules/activity-log/ActivityLogPage.test.jsx
// Scalability Architecture Phase 4 (activityLogs) — ActivityLogPage.jsx now fetches
// GET /api/activityLogs?limit=200 (via pgGetActivityLogs) instead of reading the store's
// activityLogs array (no longer boot-synced). Covers: correct request, correct rendering,
// the real database total (not items.length), loading state, error state, and empty state.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ActivityLogPage from './ActivityLogPage';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetActivityLogs: vi.fn() };
});
import { pgGetActivityLogs } from '../../services/api';

function renderPage() {
  return render(
    <ToastProvider>
      <ActivityLogPage />
    </ToastProvider>
  );
}

beforeEach(() => { vi.clearAllMocks(); });

describe('ActivityLogPage', () => {
  it('requests the latest 200 activity logs', async () => {
    pgGetActivityLogs.mockResolvedValue({ items: [], total: 0 });
    renderPage();
    await screen.findByText('لا توجد أحداث مسجّلة بعد');
    expect(pgGetActivityLogs).toHaveBeenCalledWith({ limit: 200 });
  });

  it('shows a loading state before the response resolves', async () => {
    let resolveFetch;
    pgGetActivityLogs.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
    renderPage();

    expect(screen.getByText('...جارِ التحميل')).toBeInTheDocument();

    resolveFetch({ items: [], total: 0 });
    await screen.findByText('لا توجد أحداث مسجّلة بعد');
  });

  it('renders returned rows and the real database total (not items.length)', async () => {
    pgGetActivityLogs.mockResolvedValue({
      items: [
        { id: 'al1', action: 'create', module: 'payments', user: 'أحمد', description: 'دفعة جديدة', ts: '2026-01-05T10:00:00.000Z' },
        { id: 'al2', action: 'update', module: 'students', user: 'سارة', description: 'تعديل بيانات طالب', ts: '2026-01-05T09:00:00.000Z' },
      ],
      total: 4321, // العدّ الحقيقي لكامل الجدول — أكبر بكثير من طول الصفحة المُعادة (2)
    });
    renderPage();

    expect(await screen.findByText('دفعة جديدة')).toBeInTheDocument();
    expect(await screen.findByText('تعديل بيانات طالب')).toBeInTheDocument();
    expect(screen.getByText('أحمد')).toBeInTheDocument();
    expect(screen.getByText('سارة')).toBeInTheDocument();
    expect(screen.getByText('4321 حدث مسجّل')).toBeInTheDocument();
  });

  it('empty state (total: 0) shows the existing empty-state markup', async () => {
    pgGetActivityLogs.mockResolvedValue({ items: [], total: 0 });
    renderPage();

    expect(await screen.findByText('لا توجد أحداث مسجّلة بعد')).toBeInTheDocument();
    expect(screen.getByText('0 حدث مسجّل')).toBeInTheDocument();
  });

  it('error state renders an inline message and a toast, without crashing', async () => {
    pgGetActivityLogs.mockRejectedValue(new Error('PG GET /activityLogs → 500'));
    renderPage();

    expect(await screen.findByText('تعذّر تحميل سجل النشاط')).toBeInTheDocument();
    expect(await screen.findByText('PG GET /activityLogs → 500')).toBeInTheDocument(); // toast
  });
});
