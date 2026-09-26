// src/modules/exams/ExamsPage.grades.test.jsx
// Phase 1D (Grades global-read migration) — the KPI row's "متوسط الدرجات" and each exam
// card's stats (متوسط/ناجح/راسب/غائب/نسبة نجاح) now come from GET /api/grades/aggregate
// (groupBy=none for the KPI, groupBy=exam for every currently-listed exam in ONE request)
// instead of filtering the store's global grades array with getExamStatsWithPass per card.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ExamsPage from './ExamsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgCreateExam: vi.fn(), pgUpdateExam: vi.fn(), pgDeleteExam: vi.fn(), pgGetGradesAggregate: vi.fn() };
});
import { pgGetGradesAggregate } from '../../services/api';

const EXAM = { id: 'e1', name: 'Exam One', groupId: null, subject: 'رياضيات', date: '2026-01-01', total: 100, pass: 50, status: 'done' };

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <ExamsPage />
      </ToastProvider>
    </AuthProvider>
  );
}

function seedStore() {
  useAppStore.setState({
    groups: [], students: [], exams: [EXAM], grades: [],
    centerProfile: { academicYear: '2025/2026' },
  });
}

describe('ExamsPage — KPI + per-card stats read from the scoped grades aggregate (Phase 1D)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
    pgGetGradesAggregate.mockResolvedValue([]);
  });

  it('fetches groupBy=none and groupBy=exam exactly once each on mount, never the full grades collection', async () => {
    renderPage();
    await waitFor(() => expect(pgGetGradesAggregate).toHaveBeenCalledTimes(2));
    const calls = pgGetGradesAggregate.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({ groupBy: 'none' });
    expect(calls).toContainEqual({ groupBy: 'exam' });
  });

  it('renders the KPI average from the groupBy=none response', async () => {
    pgGetGradesAggregate.mockImplementation(({ groupBy }) =>
      Promise.resolve(groupBy === 'none' ? [{ avgPct: 77, count: 5 }] : []));
    renderPage();

    const label = await screen.findByText(/متوسط الدرجات/);
    await waitFor(() => expect(label.nextElementSibling).toHaveTextContent('77%'));
  });

  it('shows "—" for the KPI average when there is no grade data at all', async () => {
    pgGetGradesAggregate.mockResolvedValue([]);
    renderPage();

    const label = await screen.findByText(/متوسط الدرجات/);
    await waitFor(() => expect(label.nextElementSibling).toHaveTextContent('—'));
  });

  it("renders each exam card's stats from the groupBy=exam response, keyed by examId", async () => {
    pgGetGradesAggregate.mockImplementation(({ groupBy }) => Promise.resolve(
      groupBy === 'exam'
        ? [{ key: 'e1', count: 4, avg: 70, highest: 95, lowest: 40, passed: 3, failed: 1, passRate: 75, absent: 1 }]
        : []
    ));
    renderPage();

    await waitFor(() => expect(screen.getByText('70')).toBeInTheDocument()); // متوسط
    expect(screen.getByText('75%')).toBeInTheDocument(); // نسبة نجاح
  });

  it('an exam absent from the groupBy=exam response falls back to the "no grades entered yet" placeholder', async () => {
    pgGetGradesAggregate.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('لم تُدخَل الدرجات بعد')).toBeInTheDocument();
  });
});
