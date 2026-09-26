// src/modules/exams/ExamReports.grades.test.jsx
// Phase 1D (Grades global-read migration) — Top Students / Weak Students / Ranking Table now
// read from GET /api/grades/aggregate?groupBy=student (unfiltered, shared across the three
// tabs; RankingTable additionally re-fetches scoped by examId when its own filter is set)
// instead of filtering the store's global grades array with getTopStudents/getWeakStudents.
// The print tab fetches grades on-demand (studentId/examId-scoped) only when "generate" is
// clicked, instead of reading from the global array continuously.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ExamReports from './ExamReports';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetGradesAggregate: vi.fn(), pgGetGrades: vi.fn() };
});
import { pgGetGradesAggregate, pgGetGrades } from '../../services/api';

const EXAM = { id: 'e1', name: 'امتحان أول', total: 100, pass: 50, status: 'done', grade: 'الأول الثانوي' };
const S1 = { id: 's1', name: 'أحمد محمد', code: 'C1', grade: 'الأول الثانوي', status: 'active', groupId: 'g1' };
const S2 = { id: 's2', name: 'سارة علي', code: 'C2', grade: 'الأول الثانوي', status: 'active', groupId: 'g1' };
const GROUP = { id: 'g1', name: 'مجموعة أ', grade: 'الأول الثانوي' };

function renderReports() {
  return render(<ToastProvider><ExamReports /></ToastProvider>);
}

function seed() {
  useAppStore.setState({ students: [S1, S2], groups: [GROUP], grades: [], exams: [EXAM], centerProfile: {} });
}

describe('ExamReports — Top/Weak/Ranking read from the scoped grades aggregate (Phase 1D)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed();
    pgGetGradesAggregate.mockResolvedValue([]);
    pgGetGrades.mockResolvedValue([]);
  });

  it('fetches groupBy=student unfiltered exactly once on mount (top tab is default)', async () => {
    renderReports();
    await waitFor(() => expect(pgGetGradesAggregate).toHaveBeenCalledTimes(1));
    expect(pgGetGradesAggregate).toHaveBeenCalledWith({ groupBy: 'student' });
  });

  it('renders the top-students podium from the aggregate response', async () => {
    pgGetGradesAggregate.mockResolvedValue([
      { key: 's1', avgPct: 90, examCount: 2, failCount: 0 },
      { key: 's2', avgPct: 60, examCount: 2, failCount: 1 },
    ]);
    renderReports();

    await waitFor(() => expect(screen.getByText('90%')).toBeInTheDocument());
    expect(screen.getByText('60%')).toBeInTheDocument();
  });

  it('weak-students tab filters the same aggregate by threshold, without a second fetch', async () => {
    pgGetGradesAggregate.mockResolvedValue([
      { key: 's1', avgPct: 90, examCount: 2, failCount: 0 },
      { key: 's2', avgPct: 40, examCount: 2, failCount: 2 },
    ]);
    renderReports();
    await waitFor(() => expect(pgGetGradesAggregate).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText(/يحتاجون دعم/));

    expect(await screen.findByText('سارة علي')).toBeInTheDocument();
    expect(screen.queryByText('أحمد محمد')).not.toBeInTheDocument();
    // still just the one shared fetch — no per-tab re-fetch
    expect(pgGetGradesAggregate).toHaveBeenCalledTimes(1);
  });

  it('ranking table re-fetches scoped by examId when the exam filter changes', async () => {
    pgGetGradesAggregate.mockImplementation(({ examId } = {}) =>
      Promise.resolve(examId ? [{ key: 's1', avgPct: 30, examCount: 1, failCount: 1 }] : [{ key: 's1', avgPct: 90, examCount: 2, failCount: 0 }]));
    renderReports();
    fireEvent.click(screen.getByText(/ترتيب عام/));
    await waitFor(() => expect(screen.getByText('90%')).toBeInTheDocument());

    const examSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(examSelect, { target: { value: EXAM.id } });

    await waitFor(() => expect(pgGetGradesAggregate).toHaveBeenCalledWith({ groupBy: 'student', examId: EXAM.id }));
    await waitFor(() => expect(screen.getByText('30%')).toBeInTheDocument());
  });

  it('print (by student) fetches GET /api/grades?studentId= only when "generate" is clicked', async () => {
    renderReports();
    fireEvent.click(screen.getByText(/طباعة كشف/));
    fireEvent.click(screen.getByText('بالطالب'));

    const groupSelect = screen.getAllByRole('combobox').find(
      (el) => el.tagName === 'SELECT' && Array.from(el.options).some((o) => o.textContent === 'اختر المجموعة...'));
    fireEvent.change(groupSelect, { target: { value: 'g1' } });
    const studentInput = screen.getAllByRole('combobox').find((el) => el.tagName === 'INPUT');
    fireEvent.change(studentInput, { target: { value: 'أحمد' } });
    fireEvent.click(screen.getByRole('option', { name: /أحمد محمد/ }));

    expect(pgGetGrades).not.toHaveBeenCalled();
    vi.spyOn(window, 'open').mockReturnValue({ document: { open: vi.fn(), write: vi.fn(), close: vi.fn() } });
    fireEvent.click(screen.getByText('🖨 توليد الكشف وطباعته'));

    await waitFor(() => expect(pgGetGrades).toHaveBeenCalledWith({ studentId: 's1' }));
  });

  it('print (by group+exam) fetches GET /api/grades?examId= only when "generate" is clicked', async () => {
    renderReports();
    fireEvent.click(screen.getByText(/طباعة كشف/));

    const selects = screen.getAllByRole('combobox');
    const groupSelect = selects.find((el) => Array.from(el.options).some((o) => o.textContent === 'اختر المجموعة...'));
    fireEvent.change(groupSelect, { target: { value: 'g1' } });
    const examSelect = selects.find((el) => Array.from(el.options).some((o) => /اختر الامتحان/.test(o.textContent)));
    fireEvent.change(examSelect, { target: { value: EXAM.id } });

    expect(pgGetGrades).not.toHaveBeenCalled();
    vi.spyOn(window, 'open').mockReturnValue({ document: { open: vi.fn(), write: vi.fn(), close: vi.fn() } });
    fireEvent.click(screen.getByText('🖨 توليد الكشف وطباعته'));

    await waitFor(() => expect(pgGetGrades).toHaveBeenCalledWith({ examId: EXAM.id }));
  });
});
