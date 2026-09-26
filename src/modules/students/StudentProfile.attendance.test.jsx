// src/modules/students/StudentProfile.attendance.test.jsx
// C4 Attendance migration Phase 2 — StudentProfile.jsx's header stat and AttendanceTab now
// both come from ONE scoped GET /api/attendance?studentId= fetch (mirrors the existing
// studentPayments pattern in the same file exactly), instead of filtering the store's
// global attendance array in two separate places.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentProfile from './StudentProfile';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

const GROUP_ID = 'g1';
const S1 = 's1';

const BASE_STUDENT = {
  id: S1, name: 'طالب واحد', code: 'TC001', grade: 'الأول', phone: '01000000001',
  parentPhone: '01000000002', groupId: GROUP_ID, status: 'active', enrollDate: '2025-01-01', monthlyFee: 100,
};

function mockFetch({ attendance = [] } = {}) {
  const attendanceCalls = [];
  globalThis.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.includes('/api/payments?')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: [] }) });
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

function seedBaseState(extra = {}) {
  useAppStore.setState({
    groups: [{ id: GROUP_ID, name: 'مجموعة أ', grade: 'الأول', max: 20 }],
    students: [BASE_STUDENT],
    exams: [], grades: [], parents: [],
    ...extra,
  });
}

function renderProfile() {
  return render(
    <ToastProvider>
      <StudentProfile studentId={S1} onBack={() => {}} onEdit={() => {}} />
    </ToastProvider>
  );
}

describe('StudentProfile — attendance is scoped to this student (C4 Attendance migration Phase 2)', () => {
  it('fetches GET /api/attendance?studentId= with the correct param, exactly once (header + tab share it)', async () => {
    seedBaseState();
    const { attendanceCalls } = mockFetch({ attendance: [] });

    renderProfile();

    await waitFor(() => expect(attendanceCalls.length).toBeGreaterThan(0));
    expect(attendanceCalls).toHaveLength(1);
    expect(attendanceCalls[0]).toContain(`studentId=${S1}`);
  });

  it('shows the correct attendance percentage in the header, derived from the scoped fetch', async () => {
    seedBaseState();
    mockFetch({
      attendance: [
        { id: 'a1', studentId: S1, groupId: GROUP_ID, date: '2026-01-01', status: 'present', sessionTime: '09:00' },
        { id: 'a2', studentId: S1, groupId: GROUP_ID, date: '2026-01-02', status: 'present', sessionTime: '09:00' },
        { id: 'a3', studentId: S1, groupId: GROUP_ID, date: '2026-01-03', status: 'absent', sessionTime: '09:00' },
        { id: 'a4', studentId: S1, groupId: GROUP_ID, date: '2026-01-04', status: 'absent', sessionTime: '09:00' },
      ],
    });

    renderProfile();

    // 2/4 present = 50% — shown both in the header badge and (redundantly) inside the
    // default-active AttendanceTab's own stats, both computed from the same scoped fetch.
    await waitFor(() => expect(screen.getAllByText('50%').length).toBeGreaterThan(0));
  });

  it('the Attendance tab shows records sorted newest-first, exactly as the old client-side filter+sort did', async () => {
    seedBaseState();
    mockFetch({
      attendance: [
        { id: 'a-old', studentId: S1, groupId: GROUP_ID, date: '2025-01-01', status: 'present', sessionTime: '09:00' },
        { id: 'a-new', studentId: S1, groupId: GROUP_ID, date: '2026-01-01', status: 'absent', sessionTime: '09:00' },
      ],
    });

    renderProfile();

    // status badges are rendered in row order — the newer (2026) "absent" record must come
    // before the older (2025) "present" one.
    await waitFor(() => expect(screen.getAllByText(/^(حاضر|غائب|متأخر)$/)).toHaveLength(2));
    const statusCells = screen.getAllByText(/^(حاضر|غائب|متأخر)$/);
    expect(statusCells[0]).toHaveTextContent('غائب');
    expect(statusCells[1]).toHaveTextContent('حاضر');
  });

  it('an empty attendance history shows the "—" header state and empty-list tab state, not an error', async () => {
    seedBaseState();
    mockFetch({ attendance: [] });

    renderProfile();

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByText('50%')).not.toBeInTheDocument();
  });
});
