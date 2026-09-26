// src/modules/attendance/AttendanceReports.groupTab.test.jsx
// C4 Attendance migration Phase 2 — the "تقرير المجموعة" (by-group) tab now fetches
// GET /api/attendance?groupId= instead of filtering the store's global attendance array.
// getGroupAttendanceStats/getGroupSessions (attendanceService.js) are completely unchanged
// pure functions — deliberately NOT migrated to the aggregate endpoint, because the
// per-session expand view needs real per-student rows (name + status), which an aggregate
// (counts only) cannot reproduce.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AttendanceReports from './AttendanceReports';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetAttendance: vi.fn() };
});
import { pgGetAttendance } from '../../services/api';

const GROUP_A = { id: 'g1', name: 'مجموعة أ', grade: 'الأول الثانوي', color: '#3b82f6' };
const STUDENT_1 = { id: 's1', name: 'أحمد علي', code: 'C001', groupId: 'g1', status: 'active' };
const STUDENT_2 = { id: 's2', name: 'سارة محمد', code: 'C002', groupId: 'g1', status: 'active' };

const ATTENDANCE = [
  { id: 'a1', studentId: 's1', groupId: 'g1', date: '2026-01-05', status: 'present', sessionTime: '09:00' },
  { id: 'a2', studentId: 's2', groupId: 'g1', date: '2026-01-05', status: 'absent', sessionTime: '09:00' },
];

function seed() {
  useAppStore.setState({ groups: [GROUP_A], students: [STUDENT_1, STUDENT_2] });
  pgGetAttendance.mockImplementation(({ groupId }) =>
    Promise.resolve(groupId === 'g1' ? ATTENDANCE : []));
}

function openGroupTab() {
  render(<ToastProvider><AttendanceReports /></ToastProvider>);
  fireEvent.click(screen.getByText('تقرير المجموعة'));
}

describe('AttendanceReports — "تقرير المجموعة" tab uses the scoped GET (not the aggregate, to preserve per-session rows)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('fetches GET /api/attendance?groupId= with the correct group id when a group is selected', async () => {
    seed();
    openGroupTab();
    fireEvent.change(screen.getByDisplayValue('اختر مجموعة...'), { target: { value: 'g1' } });

    await waitFor(() => expect(pgGetAttendance).toHaveBeenCalledWith({ groupId: 'g1' }));
  });

  it('shows the correct session count and stats, computed by the unchanged getGroupAttendanceStats/getGroupSessions', async () => {
    seed();
    openGroupTab();
    fireEvent.change(screen.getByDisplayValue('اختر مجموعة...'), { target: { value: 'g1' } });

    expect(await screen.findByText('الجلسات (1)')).toBeInTheDocument();
  });

  it('expanding a session shows the real per-student names and statuses (needs actual rows, not an aggregate)', async () => {
    seed();
    openGroupTab();
    fireEvent.change(screen.getByDisplayValue('اختر مجموعة...'), { target: { value: 'g1' } });
    await screen.findByText('الجلسات (1)');

    fireEvent.click(screen.getByText('٥ يناير ٢٠٢٦'));

    expect(await screen.findByText('أحمد علي')).toBeInTheDocument();
    expect(screen.getByText('سارة محمد')).toBeInTheDocument();
  });

  it('a group with no attendance history shows the empty state, not an error', async () => {
    seed();
    pgGetAttendance.mockResolvedValue([]);
    openGroupTab();
    fireEvent.change(screen.getByDisplayValue('اختر مجموعة...'), { target: { value: 'g1' } });

    expect(await screen.findByText('لا توجد جلسات مسجّلة')).toBeInTheDocument();
  });

  it('shows an error toast (and does not crash) when the scoped fetch fails', async () => {
    seed();
    pgGetAttendance.mockRejectedValue(new Error('PG GET /attendance → 500'));
    openGroupTab();
    fireEvent.change(screen.getByDisplayValue('اختر مجموعة...'), { target: { value: 'g1' } });

    expect(await screen.findByText(/PG GET \/attendance/)).toBeInTheDocument();
  });
});
