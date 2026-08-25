// src/modules/exams/GradeEntry.test.jsx
// Phase 3B-5 — نفس عقد SessionMarking.test.jsx: الحالة المحلية (Zustand) لا تتغيّر
// إلا بعد نجاح الخادم، وتُطابق استجابة الخادم بالضبط عند النجاح، وتبقى دون تغيير
// عند الفشل.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import GradeEntry from './GradeEntry';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgSaveExamGrades: vi.fn() };
});
import { pgSaveExamGrades } from '../../services/api';

const GROUP_ID = 'g1';
const EXAM = { id: 'e1', groupId: GROUP_ID, name: 'Test Exam', total: 100, pass: 50 };
const S1 = 's1';
const S2 = 's2';

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <GradeEntry exam={EXAM} onClose={() => {}} />
      </ToastProvider>
    </AuthProvider>
  );
}

function seedStore() {
  useAppStore.setState({
    students: [
      { id: S1, name: 'Student One', code: 'C1', groupId: GROUP_ID, status: 'active' },
      { id: S2, name: 'Student Two', code: 'C2', groupId: GROUP_ID, status: 'active' },
    ],
    grades: [],
  });
}

describe('GradeEntry — server-truth write path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
  });

  it('does NOT touch local grades before the backend call resolves, and reconciles with the server response on success', async () => {
    const serverRecords = [
      { id: 'srv-1', examId: EXAM.id, studentId: S1, score: null, absent: false },
      { id: 'srv-2', examId: EXAM.id, studentId: S2, score: null, absent: false },
    ];
    let resolveCall;
    pgSaveExamGrades.mockImplementation(() => new Promise((resolve) => { resolveCall = resolve; }));

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /حفظ الدرجات/ }));

    expect(useAppStore.getState().grades).toEqual([]);

    resolveCall({ examId: EXAM.id, records: serverRecords });

    await waitFor(() => {
      expect(useAppStore.getState().grades).toEqual(serverRecords);
    });
  });

  it('leaves local grades state completely unchanged when the backend call fails', async () => {
    pgSaveExamGrades.mockRejectedValue(new Error('PG PUT /exam-grades/e1 → 500'));

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /حفظ الدرجات/ }));

    await waitFor(() => expect(pgSaveExamGrades).toHaveBeenCalledTimes(1));

    expect(useAppStore.getState().grades).toEqual([]);
    expect(await screen.findByText(/PG PUT \/exam-grades/)).toBeInTheDocument();
  });

  it('sends the correct examId and roster payload (score:null, absent:false by default)', async () => {
    pgSaveExamGrades.mockResolvedValue({ examId: EXAM.id, records: [] });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /حفظ الدرجات/ }));

    await waitFor(() => expect(pgSaveExamGrades).toHaveBeenCalledTimes(1));
    const [examId, records] = pgSaveExamGrades.mock.calls[0];
    expect(examId).toBe(EXAM.id);
    expect(records.sort((a, b) => a.studentId.localeCompare(b.studentId))).toEqual([
      { studentId: S1, score: null, absent: false },
      { studentId: S2, score: null, absent: false },
    ]);
  });

  it('replaces only the grades for this examId, preserving unrelated existing local grades', async () => {
    useAppStore.setState({
      grades: [{ id: 'unrelated-1', examId: 'other-exam', studentId: 'sX', score: 10, absent: false }],
    });
    const serverRecords = [{ id: 'srv-1', examId: EXAM.id, studentId: S1, score: null, absent: false }];
    pgSaveExamGrades.mockResolvedValue({ examId: EXAM.id, records: serverRecords });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /حفظ الدرجات/ }));

    await waitFor(() => {
      const grades = useAppStore.getState().grades;
      expect(grades).toHaveLength(2);
      expect(grades.find(g => g.id === 'unrelated-1')).toBeTruthy();
      expect(grades.find(g => g.id === 'srv-1')).toBeTruthy();
    });
  });
});
