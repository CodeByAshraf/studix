// src/modules/students/StudentsPage.attendance.test.jsx
// C4 Attendance migration Phase 2 — the students list's per-row AttendanceHeatMap and the
// delete-guard's attendance count both now come from ONE batched
// GET /api/attendance?studentIds= fetch covering every visible (paginated) student — not
// one request per row, and not one extra request at delete-time (the guard reuses the same
// already-fetched data, since the student being deleted is always a currently-visible row).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentsPage from './StudentsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return {
    ...actual,
    pgDeleteStudent: vi.fn(), pgGetPayments: vi.fn(), pgGetCommunications: vi.fn(),
    pgGetAttendance: vi.fn(), pgGetGrades: vi.fn(), pgGetHwSubmissions: vi.fn(),
  };
});
import { pgDeleteStudent, pgGetPayments, pgGetCommunications, pgGetAttendance, pgGetGrades, pgGetHwSubmissions } from '../../services/api';

const GROUP_ID = 'g1';
const S1 = { id: 's1', name: 'أحمد علي', code: 'C001', groupId: GROUP_ID, status: 'active', phone: '0100' };
const S2 = { id: 's2', name: 'سارة محمد', code: 'C002', groupId: GROUP_ID, status: 'active', phone: '0200' };

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <StudentsPage />
      </ToastProvider>
    </AuthProvider>
  );
}

function seed(students = [S1, S2]) {
  useAppStore.setState({
    groups: [{ id: GROUP_ID, name: 'Test Group' }],
    students,
    attendance: [], grades: [], admissions: [], communications: [], hwSubmissions: [],
    inventoryTxn: [], payments: [], waReportLog: [],
  });
  pgGetPayments.mockResolvedValue([]);
  pgGetCommunications.mockResolvedValue([]);
  // C4 Grades/hwSubmissions Frontend Migration (Batch A, feature 004): the delete guard's
  // grades/hwSubmissions counts now come from pgGetGrades/pgGetHwSubmissions, not the store.
  pgGetGrades.mockResolvedValue([]);
  pgGetHwSubmissions.mockResolvedValue([]);
}

async function openConfirmAndClickFor(name) {
  const row = screen.getByText(name).closest('tr');
  fireEvent.click(row.querySelector('[title="حذف"]'));
  fireEvent.click(await screen.findByRole('button', { name: 'نعم، احذف' }));
}

describe('StudentsPage — attendance is batched across the visible page (C4 Attendance migration Phase 2)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('fetches GET /api/attendance?studentIds= exactly once, covering every visible student', async () => {
    seed();
    pgGetAttendance.mockResolvedValue([]);
    renderPage();

    await waitFor(() => expect(pgGetAttendance).toHaveBeenCalledTimes(1));
    const [params] = pgGetAttendance.mock.calls[0];
    const ids = params.studentIds.split(',').sort();
    expect(ids).toEqual(['s1', 's2']);
  });

  it('renders each row\'s real attendance heat map (not just a count) from the batched response', async () => {
    seed();
    pgGetAttendance.mockResolvedValue([
      { id: 'a1', studentId: 's1', groupId: GROUP_ID, date: '2026-01-01', status: 'present' },
      { id: 'a2', studentId: 's1', groupId: GROUP_ID, date: '2026-01-02', status: 'present' },
      { id: 'a3', studentId: 's2', groupId: GROUP_ID, date: '2026-01-01', status: 'absent' },
    ]);
    renderPage();

    // s1: 2/2 present = 100%, s2: 0/1 present = 0%
    expect(await screen.findByText('100%')).toBeInTheDocument();
    expect(await screen.findByText('0%')).toBeInTheDocument();
  });

  it('a student with no attendance shows no percentage badge, not an error', async () => {
    seed();
    pgGetAttendance.mockResolvedValue([]);
    renderPage();

    await waitFor(() => expect(pgGetAttendance).toHaveBeenCalled());
    expect(screen.queryByText(/^\d+%$/)).not.toBeInTheDocument();
  });

  it('the delete-guard blocks using the SAME batched data — no extra request at delete-time', async () => {
    seed();
    pgGetAttendance.mockResolvedValue([
      { id: 'a1', studentId: 's1', groupId: GROUP_ID, date: '2026-01-01', status: 'present' },
    ]);
    renderPage();
    await waitFor(() => expect(pgGetAttendance).toHaveBeenCalledTimes(1));

    await openConfirmAndClickFor('أحمد علي');

    expect(pgDeleteStudent).not.toHaveBeenCalled();
    expect(await screen.findByText(/سجل حضور/)).toBeInTheDocument();
    // still exactly one call — the guard did not trigger a second fetch
    expect(pgGetAttendance).toHaveBeenCalledTimes(1);
  });

  it('a student with no attendance history is NOT blocked by the attendance guard', async () => {
    seed();
    pgGetAttendance.mockResolvedValue([
      { id: 'a1', studentId: 's1', groupId: GROUP_ID, date: '2026-01-01', status: 'present' },
      // s2 has no records at all
    ]);
    pgDeleteStudent.mockResolvedValue(true);
    renderPage();
    await waitFor(() => expect(pgGetAttendance).toHaveBeenCalledTimes(1));

    await openConfirmAndClickFor('سارة محمد');

    await waitFor(() => expect(pgDeleteStudent).toHaveBeenCalledWith('s2'));
  });
});
