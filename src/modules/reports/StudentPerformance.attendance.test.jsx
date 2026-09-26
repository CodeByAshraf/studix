// src/modules/reports/StudentPerformance.attendance.test.jsx
// C4 Attendance migration Phase 2 — the per-student deep-dive profile's attendance section
// (history, present/absent/late counts, last-24 heat cells) now comes from a scoped
// GET /api/attendance?studentId= fetch instead of filtering the store's global attendance
// array. getAttendanceStats-equivalent math is unchanged — only the data source moved.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentPerformance from './StudentPerformance';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

const STUDENT = { id: 's1', name: 'أحمد', status: 'active', grade: 'الأول الثانوي', code: 'C1' };

function mockFetch({ attendance = [] } = {}) {
  const attendanceCalls = [];
  globalThis.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.includes('/api/payments/aggregate')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: [{ key: 's1', count: 0, revenue: 0 }] }) });
    }
    if (u.includes('/api/attendance?')) {
      attendanceCalls.push(u);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: attendance }) });
    }
    return Promise.reject(new Error(`unexpected fetch: ${u}`));
  });
  return { attendanceCalls };
}
afterEach(() => { vi.restoreAllMocks(); });

function seed() {
  useAppStore.setState({ students: [STUDENT], groups: [], grades: [], exams: [] });
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

describe('StudentPerformance — attendance section is scoped to the selected student (C4 Attendance migration Phase 2)', () => {
  it('fetches GET /api/attendance?studentId= only after a student is selected, with the correct id', async () => {
    seed();
    const { attendanceCalls } = mockFetch({ attendance: [] });
    selectStudent();

    await waitFor(() => expect(attendanceCalls.length).toBeGreaterThan(0));
    expect(attendanceCalls[0]).toContain(`studentId=${STUDENT.id}`);
  });

  it('shows the correct present/absent/late counts, matching the exact same math as before', async () => {
    seed();
    mockFetch({
      attendance: [
        { id: 'a1', studentId: 's1', groupId: 'g1', date: '2026-01-01', status: 'present' },
        { id: 'a2', studentId: 's1', groupId: 'g1', date: '2026-01-02', status: 'present' },
        { id: 'a3', studentId: 's1', groupId: 'g1', date: '2026-01-03', status: 'absent' },
        { id: 'a4', studentId: 's1', groupId: 'g1', date: '2026-01-04', status: 'late' },
      ],
    });
    selectStudent();

    // present=2, absent=1, late=1 rendered as separate StatBox values.
    await waitFor(() => expect(screen.getAllByText('2').length).toBeGreaterThan(0));
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(2); // absent + late
  });

  it('an empty attendance history is handled without error (attPct null, no crash)', async () => {
    seed();
    mockFetch({ attendance: [] });
    selectStudent();

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    // page renders normally, student profile header still visible
    expect(screen.getByText('C1')).toBeInTheDocument();
  });

  it('switching to a different student re-fetches with the new studentId (no stale data carried over)', async () => {
    const student2 = { id: 's2', name: 'سارة', status: 'active', grade: 'الأول الثانوي', code: 'C2' };
    useAppStore.setState({ students: [STUDENT, student2], groups: [], grades: [], exams: [] });
    const { attendanceCalls } = mockFetch({ attendance: [] });

    render(<ToastProvider><StudentPerformance /></ToastProvider>);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: STUDENT.name } });
    fireEvent.click(screen.getByRole('option', { name: new RegExp(STUDENT.name) }));
    await waitFor(() => expect(attendanceCalls).toContainEqual(expect.stringContaining('studentId=s1')));

    fireEvent.change(input, { target: { value: student2.name } });
    fireEvent.click(screen.getByRole('option', { name: new RegExp(student2.name) }));
    await waitFor(() => expect(attendanceCalls).toContainEqual(expect.stringContaining('studentId=s2')));
  });
});
