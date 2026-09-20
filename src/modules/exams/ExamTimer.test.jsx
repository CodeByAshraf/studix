// src/modules/exams/ExamTimer.test.jsx
// Exams Phase 3D — administrative Start action + countdown. Reuses the
// SupportAccessPage.jsx pattern: local 1-second tick for smooth display, periodic server
// re-sync, and re-sync on window focus / tab visibility change, so a stale local tick
// (refresh, sleep/wake) self-corrects instead of drifting. Nothing here ever touches
// grading (GradeEntry/pgSaveExamGrades) — this widget only records/display a start time.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import ExamTimer from './ExamTimer';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgStartExam: vi.fn(), pgGetExam: vi.fn() };
});
import { pgStartExam, pgGetExam } from '../../services/api';

const GRADE_6 = 'الصف السادس الابتدائي';
const BASE_EXAM = { id: 'e1', name: 'امتحان', grade: GRADE_6, subject: 'رياضيات', date: '2026-03-10', total: 100, pass: 50, status: 'upcoming' };

// ExamTimer reads `exam` from props, not the store directly — in production
// (ExamsPage.jsx), the parent subscribes to useAppStore's `exams` and re-passes a fresh
// prop on every store change. This tiny wrapper reproduces that subscription so a
// store update from inside ExamTimer (e.g. after Start) is actually reflected here too.
function Wrapper({ id }) {
  const exam = useAppStore((s) => s.exams.find((e) => e.id === id));
  return <ExamTimer exam={exam} />;
}

function renderTimer(exam) {
  useAppStore.setState({ exams: [exam], grades: [] });
  return render(<ToastProvider><Wrapper id={exam.id} /></ToastProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ExamTimer — phase display', () => {
  it('shows "لا يوجد جدولة" and no Start button when the exam has no duration at all (historical exam)', () => {
    renderTimer({ ...BASE_EXAM, durationMinutes: null, actualStartedAt: null });
    expect(screen.getByText('لا يوجد جدولة')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /بدء الامتحان/ })).not.toBeInTheDocument();
  });

  it('shows "جاهز للبدء" with a Start button once duration is set but the exam has not started', () => {
    renderTimer({ ...BASE_EXAM, durationMinutes: 60, actualStartedAt: null });
    expect(screen.getByText('جاهز للبدء')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /بدء الامتحان/ })).toBeInTheDocument();
  });

  it('reconstructs "جارٍ الآن" with a countdown immediately on mount when the exam was already started (refresh/resume behavior)', () => {
    const startedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // started 10 min ago
    renderTimer({ ...BASE_EXAM, durationMinutes: 60, actualStartedAt: startedAt });
    expect(screen.getByText(/جارٍ الآن/)).toBeInTheDocument();
    expect(screen.getByText(/49:5\d|50:00/)).toBeInTheDocument(); // ~50 minutes remaining
  });

  it('shows "انتهى الوقت" once the started exam\'s duration has fully elapsed', () => {
    const startedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // started 2h ago
    renderTimer({ ...BASE_EXAM, durationMinutes: 30, actualStartedAt: startedAt });
    expect(screen.getByText(/انتهى الوقت/)).toBeInTheDocument();
    expect(screen.getByText(/00:00/)).toBeInTheDocument();
  });
});

describe('ExamTimer — Start action', () => {
  it('clicking Start calls pgStartExam and transitions the display to "جارٍ الآن"', async () => {
    const actualStartedAt = new Date().toISOString();
    pgStartExam.mockResolvedValue({ examId: 'e1', actualStartedAt, durationMinutes: 60, remainingSeconds: 3600, phase: 'in_progress' });
    renderTimer({ ...BASE_EXAM, durationMinutes: 60, actualStartedAt: null });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /بدء الامتحان/ })); });

    expect(pgStartExam).toHaveBeenCalledWith('e1');
    expect(screen.getByText(/جارٍ الآن/)).toBeInTheDocument();
    expect(useAppStore.getState().exams[0].actualStartedAt).toBe(actualStartedAt);
  });

  it('starting an exam never touches grades — no automatic grading/submission happens', async () => {
    const actualStartedAt = new Date().toISOString();
    pgStartExam.mockResolvedValue({ examId: 'e1', actualStartedAt, durationMinutes: 60, remainingSeconds: 3600, phase: 'in_progress' });
    renderTimer({ ...BASE_EXAM, durationMinutes: 60, actualStartedAt: null });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /بدء الامتحان/ })); });

    expect(pgStartExam).toHaveBeenCalled();
    expect(useAppStore.getState().grades).toEqual([]); // unchanged
  });
});

describe('ExamTimer — countdown ticking and server re-sync', () => {
  it('ticks the displayed countdown down locally every second without any server call', async () => {
    const startedAt = new Date().toISOString();
    renderTimer({ ...BASE_EXAM, durationMinutes: 60, actualStartedAt: startedAt });

    expect(screen.getByText(/59:5\d|1:00:00/)).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });

    expect(screen.getByText(/59:5[0-5]/)).toBeInTheDocument();
    expect(pgGetExam).not.toHaveBeenCalled();
  });

  it('re-syncs from the server periodically (~20s) and adopts the fresh server state', async () => {
    const startedAt = new Date().toISOString();
    renderTimer({ ...BASE_EXAM, durationMinutes: 60, actualStartedAt: startedAt });
    pgGetExam.mockResolvedValue({ ...BASE_EXAM, durationMinutes: 90, actualStartedAt: startedAt });

    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });

    expect(pgGetExam).toHaveBeenCalledWith('e1');
    expect(useAppStore.getState().exams[0].durationMinutes).toBe(90);
  });

  it('re-syncs on window focus', async () => {
    const startedAt = new Date().toISOString();
    renderTimer({ ...BASE_EXAM, durationMinutes: 60, actualStartedAt: startedAt });
    pgGetExam.mockResolvedValue({ ...BASE_EXAM, durationMinutes: 60, actualStartedAt: startedAt });

    await act(async () => { window.dispatchEvent(new Event('focus')); });

    expect(pgGetExam).toHaveBeenCalledWith('e1');
  });

  it('re-syncs when the tab becomes visible again', async () => {
    const startedAt = new Date().toISOString();
    renderTimer({ ...BASE_EXAM, durationMinutes: 60, actualStartedAt: startedAt });
    pgGetExam.mockResolvedValue({ ...BASE_EXAM, durationMinutes: 60, actualStartedAt: startedAt });

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(pgGetExam).toHaveBeenCalledWith('e1');
  });

  it('does NOT re-sync at all before the exam has been started', async () => {
    renderTimer({ ...BASE_EXAM, durationMinutes: 60, actualStartedAt: null });

    await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });

    expect(pgGetExam).not.toHaveBeenCalled();
  });
});
