// src/modules/attendance/SessionMarking.eligibility.test.jsx
// Group Closure (Attendance Integration) — SessionMarking's roster is now fetched from
// pgGetEligibleStudentsForSession(groupId, date) (attendanceEligibility.js on the server —
// enrollment/date/day, Primary and Additional treated equally), replacing the old
// students.groupId===selectedGroup local filter with zero date/day awareness. The actual
// eligibility algorithm (attend_days/start_date/end_date/day-code matching) is already
// fully covered by backend/src/lib/attendanceEligibility.integration.test.js — this file
// only proves the UI wiring: correct args, correct rendering of whatever the server
// returns, refetch on group/date change, loading and error handling.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SessionMarking from './SessionMarking';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetEligibleStudentsForSession: vi.fn(), pgGetAttendance: vi.fn() };
});
import { pgGetEligibleStudentsForSession, pgGetAttendance } from '../../services/api';

const GROUP_A = 'gA';
const GROUP_B = 'gB';
const S1 = 's1'; // Primary in A
const S2 = 's2'; // Additional in B, NOT Primary in either
const S3 = 's3'; // never enrolled anywhere
const TODAY = new Date().toISOString().split('T')[0];

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <SessionMarking onDone={() => {}} />
      </ToastProvider>
    </AuthProvider>
  );
}

function seedStore() {
  useAppStore.setState({
    groups: [{ id: GROUP_A, name: 'Group A' }, { id: GROUP_B, name: 'Group B' }],
    students: [
      { id: S1, name: 'Student One', code: 'C1', groupId: GROUP_A, status: 'active' },
      { id: S2, name: 'Student Two', code: 'C2', groupId: null, status: 'active' }, // no Primary Group at all
      { id: S3, name: 'Student Three', code: 'C3', groupId: null, status: 'active' },
    ],
    attendance: [],
  });
}

describe('SessionMarking — eligibility-based roster (Group Closure)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
    // C4 Attendance migration Phase 2: existingSession (the pre-fill/"already has a
    // session" check) now calls pgGetAttendance({groupId,date}) instead of filtering the
    // store's global attendance array — default to "no existing session" so these
    // eligibility-focused tests are unaffected.
    pgGetAttendance.mockResolvedValue([]);
  });

  it('Case C: fetches the roster with the selected group + date, and renders only the returned eligible students', async () => {
    pgGetEligibleStudentsForSession.mockResolvedValue([S1]);
    renderPage();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: GROUP_A } });

    await waitFor(() => expect(pgGetEligibleStudentsForSession).toHaveBeenCalledWith(GROUP_A, TODAY));
    fireEvent.click(await screen.findByRole('button', { name: /بدء تسجيل الحضور/, hidden: false }));
    expect(await screen.findByText('Student One')).toBeInTheDocument();
    expect(screen.queryByText('Student Two')).not.toBeInTheDocument();
    expect(screen.queryByText('Student Three')).not.toBeInTheDocument();
  });

  it('Case C: an Additional-Group-only student (no Primary Group at all) appears when the server says they are eligible for that group', async () => {
    pgGetEligibleStudentsForSession.mockResolvedValue([S2]); // S2 has groupId: null but IS eligible for GROUP_B
    renderPage();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: GROUP_B } });
    await waitFor(() => expect(pgGetEligibleStudentsForSession).toHaveBeenCalledWith(GROUP_B, TODAY));
    fireEvent.click(await screen.findByRole('button', { name: /بدء تسجيل الحضور/ }));

    expect(await screen.findByText('Student Two')).toBeInTheDocument();
  });

  it('Case H: a student with no active enrollment is excluded even when the server returns an empty roster', async () => {
    pgGetEligibleStudentsForSession.mockResolvedValue([]);
    renderPage();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: GROUP_A } });
    await waitFor(() => expect(pgGetEligibleStudentsForSession).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /بدء تسجيل الحضور/ }));

    expect(await screen.findByText('لا يوجد طلاب في هذه المجموعة')).toBeInTheDocument();
  });

  it('re-fetches the roster (day-of-week sensitivity) when the session date changes', async () => {
    pgGetEligibleStudentsForSession.mockResolvedValueOnce([S1]);
    renderPage();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: GROUP_A } });
    await waitFor(() => expect(pgGetEligibleStudentsForSession).toHaveBeenCalledWith(GROUP_A, TODAY));

    pgGetEligibleStudentsForSession.mockResolvedValueOnce([]); // e.g. a day S1's attend_days excludes
    const dateInput = screen.getByDisplayValue(TODAY);
    fireEvent.change(dateInput, { target: { value: '2026-03-01' } });

    await waitFor(() => expect(pgGetEligibleStudentsForSession).toHaveBeenCalledWith(GROUP_A, '2026-03-01'));
  });

  it('disables "بدء تسجيل الحضور" while the roster is still loading, so a stale/empty roster is never started', async () => {
    let resolveRoster;
    pgGetEligibleStudentsForSession.mockImplementation(() => new Promise((resolve) => { resolveRoster = resolve; }));
    renderPage();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: GROUP_A } });
    expect(screen.getByRole('button', { name: /بدء تسجيل الحضور/ })).toBeDisabled();

    resolveRoster([S1]);
    await waitFor(() => expect(screen.getByRole('button', { name: /بدء تسجيل الحضور/ })).not.toBeDisabled());
  });

  it('shows an error toast (and does not crash) when the roster fetch fails', async () => {
    pgGetEligibleStudentsForSession.mockRejectedValue(new Error('PG GET /attendance-sessions/gA/2026-.../roster → 500'));
    renderPage();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: GROUP_A } });

    // toast.error(err.message || fallback) — the mocked error's own message wins, matching
    // this codebase's established error-toast convention (see StudentProfile.test.jsx).
    expect(await screen.findByText(/PG GET \/attendance-sessions/)).toBeInTheDocument();
  });
});
