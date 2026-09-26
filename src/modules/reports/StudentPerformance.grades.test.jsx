// src/modules/reports/StudentPerformance.grades.test.jsx
// Phase 1A (Grades global-read migration) — the per-student deep-dive profile's exam-results
// section (studentGrades → examResults/avgExamPct) now comes from a scoped
// GET /api/grades?studentId= fetch instead of filtering the store's global grades array.
// Same pattern as StudentPerformance.attendance.test.jsx (C4 Attendance migration Phase 2).
// scoreColor/pct math is unchanged — only the data source moved.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentPerformance from './StudentPerformance';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

const STUDENT = { id: 's1', name: 'أحمد', status: 'active', grade: 'الأول الثانوي', code: 'C1' };
const EXAM = { id: 'e1', name: 'امتحان الشهر الأول', total: 100 };

function mockFetch({ grades = [] } = {}) {
  const gradesCalls = [];
  globalThis.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.includes('/api/payments/aggregate')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: [{ key: 's1', count: 0, revenue: 0 }] }) });
    }
    if (u.includes('/api/attendance?')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: [] }) });
    }
    if (u.includes('/api/grades?')) {
      gradesCalls.push(u);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: grades }) });
    }
    return Promise.reject(new Error(`unexpected fetch: ${u}`));
  });
  return { gradesCalls };
}
afterEach(() => { vi.restoreAllMocks(); });

function seed() {
  useAppStore.setState({ students: [STUDENT], groups: [], grades: [], exams: [EXAM] });
}

function selectStudent() {
  render(
    <ToastProvider>
      <StudentPerformance />
    </ToastProvider>
  );
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: STUDENT.name } });
  fireEvent.click(screen.getByRole('option', { name: new RegExp(STUDENT.name) }));
}

describe('StudentPerformance — exam-results section is scoped to the selected student (Phase 1A)', () => {
  it('fetches GET /api/grades?studentId= only after a student is selected, with the correct id', async () => {
    seed();
    const { gradesCalls } = mockFetch({ grades: [] });
    selectStudent();

    await waitFor(() => expect(gradesCalls.length).toBeGreaterThan(0));
    expect(gradesCalls[0]).toContain(`studentId=${STUDENT.id}`);
  });

  it('renders exam results from the scoped fetch, not from the global store', async () => {
    seed();
    // Global store grades intentionally holds a DIFFERENT record than the scoped fetch
    // returns, to prove the UI reads from the fetch, not from `s.grades`.
    useAppStore.setState({
      students: [STUDENT], groups: [], exams: [EXAM],
      grades: [{ id: 'stale', studentId: 's1', examId: 'e1', score: 999, absent: false }],
    });
    mockFetch({ grades: [{ id: 'g1', studentId: 's1', examId: 'e1', score: 80, absent: false }] });
    selectStudent();

    await waitFor(() => expect(screen.getByText(EXAM.name.substring(0, 20))).toBeInTheDocument());
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('excludes absent/null-score rows from exam results, same as the previous filter', async () => {
    seed();
    mockFetch({
      grades: [
        { id: 'g1', studentId: 's1', examId: 'e1', score: null, absent: true },
      ],
    });
    selectStudent();

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.getByText('لا توجد نتائج')).toBeInTheDocument();
  });

  it('switching to a different student re-fetches grades with the new studentId', async () => {
    const student2 = { id: 's2', name: 'سارة', status: 'active', grade: 'الأول الثانوي', code: 'C2' };
    useAppStore.setState({ students: [STUDENT, student2], groups: [], grades: [], exams: [EXAM] });
    const { gradesCalls } = mockFetch({ grades: [] });

    render(<ToastProvider><StudentPerformance /></ToastProvider>);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: STUDENT.name } });
    fireEvent.click(screen.getByRole('option', { name: new RegExp(STUDENT.name) }));
    await waitFor(() => expect(gradesCalls).toContainEqual(expect.stringContaining('studentId=s1')));

    fireEvent.change(input, { target: { value: student2.name } });
    fireEvent.click(screen.getByRole('option', { name: new RegExp(student2.name) }));
    await waitFor(() => expect(gradesCalls).toContainEqual(expect.stringContaining('studentId=s2')));
  });
});
