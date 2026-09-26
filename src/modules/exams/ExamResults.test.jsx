// src/modules/exams/ExamResults.test.jsx
// C4 Grades/hwSubmissions Frontend Migration (Batch A, feature 004) — new test file (none
// existed before this feature). ExamResults now fetches GET /api/grades?examId= instead of
// reading the store's global grades array; getExamStatsWithPass/eligibleStudents/ranking all
// stay client-side and reactive (research.md §5), so the only behavior this file needs to
// prove is: (a) the fetched, exam-scoped grades produce identical stats/ranking to what a
// full-history join would have produced, (b) the empty state is gated behind loading, and
// (c) a failed fetch surfaces a visible error (closes analyze finding U1, FR-011).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ExamResults from './ExamResults';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetGrades: vi.fn() };
});
import { pgGetGrades } from '../../services/api';

const GRADE = 'الصف الأول الثانوي';
const EXAM = { id: 'e1', name: 'امتحان تجريبي', type: 'monthly', grade: GRADE, total: 100, pass: 50 };
const S1 = { id: 's1', name: 'Student One', code: 'C1', grade: GRADE, status: 'active' };
const S2 = { id: 's2', name: 'Student Two', code: 'C2', grade: GRADE, status: 'active' };
const S3 = { id: 's3', name: 'Student Three', code: 'C3', grade: GRADE, status: 'active' };

function renderResults() {
  return render(
    <ToastProvider>
      <ExamResults exam={EXAM} />
    </ToastProvider>
  );
}

function seedStudents() {
  useAppStore.setState({ students: [S1, S2, S3] });
}

describe('ExamResults — scoped grades fetch (feature 004)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStudents();
  });

  it('fetches GET /api/grades scoped to this exam and shows the exact same stats a full-history join would produce', async () => {
    pgGetGrades.mockResolvedValue([
      { id: 'g1', examId: EXAM.id, studentId: S1.id, score: 80, absent: false },
      { id: 'g2', examId: EXAM.id, studentId: S2.id, score: 40, absent: false },
      { id: 'g3', examId: EXAM.id, studentId: S3.id, score: null, absent: true },
    ]);

    renderResults();

    expect(await screen.findByText('ترتيب الطلاب (3)')).toBeInTheDocument();
    expect(pgGetGrades).toHaveBeenCalledWith({ examId: EXAM.id });

    // stats: avg of non-absent scores (80,40) = 60; highest 80; lowest 40; passed 1/2 = 50%; absent 1
    // Values and labels are sibling divs inside the same StatBox — scope by label to avoid
    // colliding with the identical raw score also shown in the ranked list below.
    await waitFor(() => {
      expect(screen.getByText('60/100')).toBeInTheDocument();
    });
    expect(screen.getByText('أعلى درجة').previousElementSibling).toHaveTextContent('80');
    expect(screen.getByText('أدنى درجة').previousElementSibling).toHaveTextContent('40');
    expect(screen.getByText('نسبة النجاح').previousElementSibling).toHaveTextContent('50%');
    expect(screen.getByText('غائب عن الامتحان')).toBeInTheDocument();
  });

  it('shows the empty state only after loading completes, not during the loading window', async () => {
    let resolveFetch;
    pgGetGrades.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));

    renderResults();
    // During the loading window, neither the empty state nor the ranked list should assert a
    // wrong empty message — nothing meaningful is asserted here except absence of the message.
    expect(screen.queryByText('لم يتم إدخال الدرجات بعد')).not.toBeInTheDocument();

    resolveFetch([]);
    expect(await screen.findByText('لم يتم إدخال الدرجات بعد')).toBeInTheDocument();
  });

  it('surfaces a visible error when the grades fetch fails (closes analyze finding U1)', async () => {
    pgGetGrades.mockRejectedValue(new Error('PG GET /grades → 500'));

    renderResults();

    expect(await screen.findByText(/PG GET \/grades/)).toBeInTheDocument();
  });
});
