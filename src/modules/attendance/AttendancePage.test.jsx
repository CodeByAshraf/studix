// src/modules/attendance/AttendancePage.test.jsx
// Deep link من إشعار غياب متأخر ("متابعة الآن"، ?view=followup&attendanceId=...) — يفتح
// تبويب المتابعة مباشرة ويُحدِّد السجل المستهدَف تلقائياً، بلا كسر تبديل التبويب المحلي
// الحالي (session/followup/reports/qr عبر useState داخل AttendancePage.jsx نفسه).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import AttendancePage from './AttendancePage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

// C4 Attendance Batch A — the overview's present/absent/pct KPIs now come from
// GET /api/attendance/aggregate?groupBy=status; sessions/pendingFollowup/absentees are NOT
// migrated by this feature and keep reading the full `attendance` store array.
vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetAttendanceAggregate: vi.fn() };
});
import { pgGetAttendanceAggregate } from '../../services/api';

beforeEach(() => { pgGetAttendanceAggregate.mockResolvedValue([]); });
afterEach(() => { vi.restoreAllMocks(); });

const STUDENT = { id: 's1', name: 'أحمد محمد', phone: '0100000000' };
const GROUP   = { id: 'g1', name: 'مجموعة أ' };

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <ToastProvider>
          <AttendancePage />
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function seedStore(extra = {}) {
  useAppStore.setState({
    students: [STUDENT], groups: [GROUP],
    attendance: [{ id: 'att1', studentId: 's1', groupId: 'g1', date: '2026-01-01', status: 'absent' }],
    absenceFollowup: [],
    ...extra,
  });
}

// Regression for the C4 Attendance Phase 2 signature change to getFrequentAbsentees
// (src/services/attendanceService.js) — this KPI is one of the two consumers that still pass
// it a raw attendance-records array via the new statsByStudentFromRecords() adapter, not the
// migrated tab's aggregate response. Proves the adapter produces the right end-to-end count
// here, not just in isolation (see attendanceService.frequentAbsentees.test.js).
describe('AttendancePage — "كثيرو الغياب" KPI (regression for getFrequentAbsentees signature change)', () => {
  it('counts only active students whose absences meet the 3-absence threshold, via statsByStudentFromRecords', () => {
    const s1 = { id: 's1', name: 'أحمد محمد', phone: '0100000001', status: 'active' };
    const s2 = { id: 's2', name: 'سارة علي',  phone: '0100000002', status: 'active' };
    const s3 = { id: 's3', name: 'محمد خالد', phone: '0100000003', status: 'active' };
    const absentRecord = (studentId, date) => ({ id: `att-${studentId}-${date}`, studentId, groupId: 'g1', date, status: 'absent' });

    useAppStore.setState({
      students: [s1, s2, s3],
      groups: [GROUP],
      attendance: [
        // s1: 3 absences — meets the threshold
        absentRecord('s1', '2026-01-01'), absentRecord('s1', '2026-01-02'), absentRecord('s1', '2026-01-03'),
        // s2: 4 absences — meets the threshold
        absentRecord('s2', '2026-01-01'), absentRecord('s2', '2026-01-02'), absentRecord('s2', '2026-01-03'), absentRecord('s2', '2026-01-04'),
        // s3: 2 absences — below the threshold, must NOT be counted
        absentRecord('s3', '2026-01-01'), absentRecord('s3', '2026-01-02'),
      ],
      absenceFollowup: [],
    });
    renderAt('/attendance');

    const kpiCard = screen.getByText(/كثيرو الغياب/).parentElement;
    expect(within(kpiCard).getByText('2')).toBeInTheDocument();
    expect(within(kpiCard).getByText('اضغط للمتابعة')).toBeInTheDocument();
  });
});

describe('AttendancePage — internal tab navigation (no deep link)', () => {
  it('16. defaults to the session tab, and clicking "متابعة الغياب" still switches to it locally (existing internal navigation preserved)', () => {
    seedStore();
    renderAt('/attendance');

    // بلا deep link، قسم "متابعة تحتاج إجراء" (خاص بـ AbsenceFollowup) غير معروض بعد
    expect(screen.queryByText('متابعة تحتاج إجراء')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /متابعة الغياب/ }));
    expect(screen.getByText('متابعة تحتاج إجراء')).toBeInTheDocument();
  });
});

describe('AttendancePage — deep link from an absence notification', () => {
  it('15. ?view=followup opens the follow-up tab directly on first render', () => {
    seedStore();
    renderAt('/attendance?view=followup&attendanceId=att1');
    expect(screen.getByText('متابعة تحتاج إجراء')).toBeInTheDocument();
    expect(screen.getByText('متابعات متأخرة')).toBeInTheDocument();
  });

  it('opens the exact targeted record\'s follow-up modal automatically', () => {
    seedStore();
    renderAt('/attendance?view=followup&attendanceId=att1');
    expect(screen.getByText('📞 تسجيل متابعة غياب')).toBeInTheDocument();
    // الاسم يظهر مرتين (صف الجدول + داخل المودال) — نتحقّق من نسخة المودال تحديداً
    const modalBody = document.querySelector('.modal-body');
    expect(within(modalBody).getByText('أحمد محمد')).toBeInTheDocument();
  });

  it('an unknown attendanceId in the deep link opens the follow-up tab without crashing or opening any modal', () => {
    seedStore();
    renderAt('/attendance?view=followup&attendanceId=does-not-exist');
    expect(screen.getByText('متابعة تحتاج إجراء')).toBeInTheDocument();
    expect(screen.queryByText('📞 تسجيل متابعة غياب')).not.toBeInTheDocument();
  });
});

describe('AttendancePage — overview KPIs (C4 Attendance Batch A)', () => {
  it('present/absent/pct come from GET /api/attendance/aggregate?groupBy=status, exactly once', async () => {
    useAppStore.setState({
      students: [{ id: 's1', name: 'أحمد', status: 'active' }],
      groups: [GROUP], attendance: [], absenceFollowup: [],
    });
    pgGetAttendanceAggregate.mockResolvedValue([
      { key: 'present', count: 6 }, { key: 'absent', count: 3 }, { key: 'late', count: 1 },
    ]);
    renderAt('/attendance');

    await waitFor(() => expect(pgGetAttendanceAggregate).toHaveBeenCalledTimes(1));
    expect(pgGetAttendanceAggregate).toHaveBeenCalledWith({ groupBy: 'status' });

    expect((await screen.findByText(/معدل الحضور/)).nextElementSibling).toHaveTextContent('60%'); // 6/10
    expect(screen.getByText(/حاضر \(إجمالي\)/).nextElementSibling).toHaveTextContent('6');
    expect(screen.getByText(/غائب \(إجمالي\)/).nextElementSibling).toHaveTextContent('3');
  });

  it('sessions and pendingFollowup stay computed from the store array, unaffected by the aggregate response, with no separate request for either', async () => {
    useAppStore.setState({
      students: [{ id: 's1', name: 'أحمد', status: 'active' }],
      groups: [GROUP],
      // 2 distinct group+date pairs (both g1); 1 absent record with no completed followup
      attendance: [
        { id: 'a1', studentId: 's1', groupId: 'g1', date: '2026-01-01', status: 'present' },
        { id: 'a2', studentId: 's1', groupId: 'g1', date: '2026-01-02', status: 'absent' },
      ],
      absenceFollowup: [],
    });
    // Deliberately different numbers from the store data, to prove sessions/pendingFollowup
    // don't accidentally derive from this aggregate response.
    pgGetAttendanceAggregate.mockResolvedValue([{ key: 'present', count: 999 }]);
    renderAt('/attendance');

    await waitFor(() => expect(pgGetAttendanceAggregate).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/عدد الجلسات/).nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText(/تحتاج متابعة/).nextElementSibling).toHaveTextContent('1');
    // Still exactly one call — neither figure triggered a second request
    expect(pgGetAttendanceAggregate).toHaveBeenCalledTimes(1);
  });

  it('shows "—" and zero counts when there is no attendance data at all, not an error', async () => {
    useAppStore.setState({ students: [], groups: [], attendance: [], absenceFollowup: [] });
    pgGetAttendanceAggregate.mockResolvedValue([]);
    renderAt('/attendance');

    expect((await screen.findByText(/معدل الحضور/)).nextElementSibling).toHaveTextContent('—');
  });
});
