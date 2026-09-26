// src/modules/Dashboard.attendanceHeat.test.jsx
// C4 Attendance Batch A — StudentRow's heat indicator (rendered for students.slice(0,5)) now
// fetches GET /api/attendance?studentIds=<those ids> instead of reading the full global
// attendance array per row. stats.attPct (attendance.slice(-50)) is explicitly out of scope for
// this feature and is not touched or asserted on here.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Dashboard from './Dashboard';
import { useAppStore } from '../store/app.store';
import { UIProvider } from '../store/ui.context';
import { ToastProvider } from '../components/Toast';

vi.mock('../services/api', async () => {
  const actual = await vi.importActual('../services/api');
  return { ...actual, pgGetAttendance: vi.fn() };
});
import { pgGetAttendance } from '../services/api';

function renderDashboard() {
  return render(
    <ToastProvider>
      <UIProvider>
        <Dashboard />
      </UIProvider>
    </ToastProvider>
  );
}

const S1 = { id: 's1', name: 'أحمد علي', code: 'C001', status: 'active', grade: 'الأول الثانوي' };
const S2 = { id: 's2', name: 'سارة محمد', code: 'C002', status: 'active', grade: 'الأول الثانوي' };

function seed(students) {
  useAppStore.setState({
    students, groups: [], treasuryTxn: [], attendance: [],
  });
}

function sortedIds(call) { return call[0].studentIds.split(',').sort(); }

describe('Dashboard — StudentRow heat is scoped to the visible students only (C4 Attendance Batch A)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('fetches GET /api/attendance?studentIds= exactly once, covering exactly the (up to 5) displayed students', async () => {
    seed([S1, S2]);
    pgGetAttendance.mockResolvedValue([]);
    renderDashboard();

    await waitFor(() => expect(pgGetAttendance).toHaveBeenCalledTimes(1));
    expect(sortedIds(pgGetAttendance.mock.calls[0])).toEqual(['s1', 's2']);
  });

  it("renders each listed student's own heat cells from the batched response, not another student's", async () => {
    seed([S1, S2]);
    pgGetAttendance.mockResolvedValue([
      { id: 'a1', studentId: 's1', groupId: 'g1', date: '2026-01-01', status: 'present' },
      { id: 'a2', studentId: 's2', groupId: 'g1', date: '2026-01-01', status: 'absent' },
    ]);
    renderDashboard();

    // s1: 1/1 present = 100%, s2: 0/1 present = 0%
    expect(await screen.findByText('100%')).toBeInTheDocument();
    expect(await screen.findByText('0%')).toBeInTheDocument();
  });

  it('a student with no attendance history shows "لا يوجد سجل", not an error', async () => {
    seed([S1]);
    pgGetAttendance.mockResolvedValue([]);
    renderDashboard();

    expect(await screen.findByText('لا يوجد سجل')).toBeInTheDocument();
  });

  it('makes no request when there are zero students to display', async () => {
    seed([]);
    renderDashboard();

    await screen.findByText('إيراد هذا الشهر'); // wait for a render that doesn't depend on students
    expect(pgGetAttendance).not.toHaveBeenCalled();
  });
});
