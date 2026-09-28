// src/modules/attendance/AttendanceReports.absenteesTab.test.jsx
// C4 Attendance migration Phase 2 — the "كثيرو الغياب" (frequent absentees) tab now fetches
// GET /api/attendance/aggregate?groupBy=student&studentIds=<active ids>[&groupId=] instead of
// filtering the store's global attendance array. studentIds is always the client's current
// active (and group-filtered) student ids — never omitted, never empty — so the request never
// scales with inactive/withdrawn students who still have attendance history (spec.md FR-004,
// research.md §1a). This is the last of the 11 C4 Attendance Phase 2 consumers.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AttendanceReports from './AttendanceReports';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetAttendanceAggregate: vi.fn(), pgGetGroupEnrollments: vi.fn() };
});
import { pgGetAttendanceAggregate, pgGetGroupEnrollments } from '../../services/api';

// Fix 2 — the group filter's members come from active enrollments (GET /api/enrollments?
// groupId=); every seeded student holds the active Primary enrollment the real write paths
// create alongside groupId.
function mockGroupEnrollments() {
  pgGetGroupEnrollments.mockImplementation(({ groupId } = {}) => Promise.resolve(
    useAppStore.getState().students
      .filter((st) => st.groupId && (!groupId || st.groupId === groupId))
      .map((st) => ({ id: `e-${st.id}`, studentId: st.id, groupId: st.groupId, role: 'primary', status: 'active' }))));
}

const GROUP_A = { id: 'g1', name: 'مجموعة أ', grade: 'الأول الثانوي', color: '#3b82f6' };
const GROUP_B = { id: 'g2', name: 'مجموعة ب', grade: 'الثاني الثانوي', color: '#10b981' };
const GROUP_C = { id: 'g3', name: 'مجموعة ج', grade: 'الثالث الثانوي', color: '#f59e0b' };
const S1 = { id: 's1', name: 'أحمد علي', code: 'C001', groupId: 'g1', status: 'active', grade: 'الأول الثانوي', phone: '0100000001' };
const S2 = { id: 's2', name: 'سارة محمد', code: 'C002', groupId: 'g1', status: 'active', grade: 'الأول الثانوي', phone: '0100000002' };
const S3_SUSPENDED = { id: 's3', name: 'محمد سعيد', code: 'C003', groupId: 'g1', status: 'suspended', grade: 'الأول الثانوي', phone: '0100000003' };
const S4 = { id: 's4', name: 'ليلى حسن', code: 'C004', groupId: 'g2', status: 'active', grade: 'الثاني الثانوي', phone: '0100000004' };
const S5_SUSPENDED_G3 = { id: 's5', name: 'كريم فتحي', code: 'C005', groupId: 'g3', status: 'suspended', grade: 'الثالث الثانوي', phone: '0100000005' };

function seed(students = [S1, S2]) {
  useAppStore.setState({ groups: [GROUP_A, GROUP_B, GROUP_C], students });
}

function selectGroup(groupId) {
  fireEvent.change(screen.getByDisplayValue('كل المجموعات'), { target: { value: groupId } });
}

function openAbsenteesTab() {
  render(<ToastProvider><AttendanceReports /></ToastProvider>);
  fireEvent.click(screen.getByText('كثيرو الغياب'));
}

function sortedStudentIds(call) {
  return call[0].studentIds.split(',').sort();
}

describe('AttendanceReports — "كثيرو الغياب" tab uses the scoped/aggregate GET (C4 Attendance migration Phase 2)', () => {
  beforeEach(() => { vi.clearAllMocks(); mockGroupEnrollments(); });

  it('fetches GET /api/attendance/aggregate?groupBy=student&studentIds=<active ids> exactly once on open, with no groupId', async () => {
    seed();
    pgGetAttendanceAggregate.mockResolvedValue([]);
    openAbsenteesTab();

    await waitFor(() => expect(pgGetAttendanceAggregate).toHaveBeenCalledTimes(1));
    const call = pgGetAttendanceAggregate.mock.calls[0];
    expect(call[0].groupBy).toBe('student');
    expect(sortedStudentIds(call)).toEqual(['s1', 's2']);
    expect(call[0].groupId).toBeUndefined();
  });

  it('renders the list from the aggregate response — names, absence count, percentage, severity, sorted most-absent-first', async () => {
    seed();
    pgGetAttendanceAggregate.mockResolvedValue([
      { key: 's1', total: 10, present: 3, absent: 7, late: 0 },
      { key: 's2', total: 10, present: 8, absent: 2, late: 0 },
    ]);
    openAbsenteesTab();

    const rows = await screen.findAllByText(/غياب$/);
    expect(rows).toBeTruthy();
    // s1 (7 absences, critical) must render before s2 (2 absences) — most-absent-first
    const names = await screen.findAllByText(/أحمد علي|سارة محمد/);
    expect(names[0]).toHaveTextContent('أحمد علي');
    expect(screen.getByText('30%')).toBeInTheDocument(); // s1: 3/10
    expect(screen.getByText('خطير')).toBeInTheDocument(); // s1: absent >= 7
  });

  it("each row's call action targets the right phone number", async () => {
    seed();
    pgGetAttendanceAggregate.mockResolvedValue([
      { key: 's1', total: 10, present: 3, absent: 7, late: 0 },
    ]);
    openAbsenteesTab();

    const callLink = await screen.findByText('📞 اتصال');
    expect(callLink.closest('a')).toHaveAttribute('href', `tel:${S1.phone}`);
  });

  it('when there are zero active students, pgGetAttendanceAggregate is never called and the empty state renders', async () => {
    seed([S3_SUSPENDED]);
    openAbsenteesTab();

    expect(await screen.findByText(/لا يوجد طلاب تجاوزوا/)).toBeInTheDocument();
    expect(pgGetAttendanceAggregate).not.toHaveBeenCalled();
  });

  it('shows no dedicated loading/spinner indicator while the fetch is pending (FR-011)', async () => {
    seed();
    let resolveFetch;
    pgGetAttendanceAggregate.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
    openAbsenteesTab();

    await waitFor(() => expect(pgGetAttendanceAggregate).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/جارٍ التحميل/)).not.toBeInTheDocument();
    expect(screen.queryByText(/جاري التحميل/)).not.toBeInTheDocument();
    // Pending state falls through to the same empty-state markup as "no results" —
    // never a dedicated loading UI — matching the other three tabs in this file.
    expect(screen.getByText(/لا يوجد طلاب تجاوزوا/)).toBeInTheDocument();

    resolveFetch([]);
  });

  // ── User Story 2 — threshold and group filtering (spec.md US2) ─────────────────────────
  it('changing the threshold re-filters the already-fetched list with zero additional requests (FR-009)', async () => {
    seed();
    pgGetAttendanceAggregate.mockResolvedValue([
      { key: 's1', total: 10, present: 3, absent: 7, late: 0 },
      { key: 's2', total: 10, present: 6, absent: 4, late: 0 },
    ]);
    openAbsenteesTab();
    await waitFor(() => expect(pgGetAttendanceAggregate).toHaveBeenCalledTimes(1));
    await screen.findByText('أحمد علي');
    expect(screen.getByText('سارة محمد')).toBeInTheDocument();

    fireEvent.click(screen.getByText('5+'));

    await waitFor(() => expect(screen.queryByText('سارة محمد')).not.toBeInTheDocument());
    expect(screen.getByText('أحمد علي')).toBeInTheDocument();
    expect(pgGetAttendanceAggregate).toHaveBeenCalledTimes(1);
  });

  it('selecting a single group triggers exactly one new request scoped to that group\'s active students only', async () => {
    seed([S1, S2, S4]);
    pgGetAttendanceAggregate.mockResolvedValue([]);
    openAbsenteesTab();
    await waitFor(() => expect(pgGetAttendanceAggregate).toHaveBeenCalledTimes(1));
    expect(sortedStudentIds(pgGetAttendanceAggregate.mock.calls[0])).toEqual(['s1', 's2', 's4']);

    selectGroup('g2');

    await waitFor(() => expect(pgGetAttendanceAggregate).toHaveBeenCalledTimes(2));
    const call = pgGetAttendanceAggregate.mock.calls[1];
    expect(call[0].groupId).toBe('g2');
    expect(sortedStudentIds(call)).toEqual(['s4']);
  });

  it('a threshold/group combination matching no students (though active students were fetched) shows the friendly empty state', async () => {
    seed();
    pgGetAttendanceAggregate.mockResolvedValue([
      { key: 's1', total: 10, present: 9, absent: 1, late: 0 },
      { key: 's2', total: 10, present: 10, absent: 0, late: 0 },
    ]);
    openAbsenteesTab();

    expect(await screen.findByText(/لا يوجد طلاب تجاوزوا/)).toBeInTheDocument();
    expect(pgGetAttendanceAggregate).toHaveBeenCalledTimes(1); // fetch did happen — this is a threshold-empty result, not a skipped fetch
  });

  it('selecting a group with zero active students makes no additional request and shows the empty state, not an error', async () => {
    seed([S1, S2, S5_SUSPENDED_G3]);
    pgGetAttendanceAggregate.mockResolvedValue([]);
    openAbsenteesTab();
    await waitFor(() => expect(pgGetAttendanceAggregate).toHaveBeenCalledTimes(1));

    selectGroup('g3');

    expect(await screen.findByText(/لا يوجد طلاب تجاوزوا/)).toBeInTheDocument();
    expect(pgGetAttendanceAggregate).toHaveBeenCalledTimes(1); // no second call — g3 has zero active students
  });

  // ── User Story 3 — reliability and scale-scoping (spec.md US3) ─────────────────────────
  it('shows a clear error toast (not a blank/stale list) when the fetch fails', async () => {
    seed();
    pgGetAttendanceAggregate.mockRejectedValue(new Error('PG GET /attendance/aggregate → 500'));
    openAbsenteesTab();

    expect(await screen.findByText(/PG GET \/attendance\/aggregate/)).toBeInTheDocument();
  });

  it('never includes an inactive/suspended student\'s id in the request, even if the mocked response would return rows for them (regression guard for /speckit-analyze finding I1)', async () => {
    seed([S1, S3_SUSPENDED]);
    // Mocked to return a row for the suspended student too — proves the exclusion is
    // enforced by the REQUEST scope (studentIds), not merely by filtering the response.
    pgGetAttendanceAggregate.mockResolvedValue([
      { key: 's1', total: 10, present: 3, absent: 7, late: 0 },
      { key: 's3', total: 10, present: 1, absent: 9, late: 0 },
    ]);
    openAbsenteesTab();

    await waitFor(() => expect(pgGetAttendanceAggregate).toHaveBeenCalledTimes(1));
    expect(sortedStudentIds(pgGetAttendanceAggregate.mock.calls[0])).toEqual(['s1']);
    await screen.findByText('أحمد علي');
    expect(screen.queryByText('محمد سعيد')).not.toBeInTheDocument();
  });
});
