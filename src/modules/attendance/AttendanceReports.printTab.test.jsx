// src/modules/attendance/AttendanceReports.printTab.test.jsx
// The "طباعة كشف" tab existed only as a dead TABS entry — clicking it rendered nothing,
// while the fully-working builder openGroupSessionReport() (buildAttendanceReport.js) sat
// imported-but-never-called. This proves the tab is now wired: picking a group, then one of
// its existing sessions (dates), and clicking the print action actually invokes the existing
// builder with the correct group/date/students/attendance/profile, producing the same
// professional report the builder already produced before this change (KPIs, full roster,
// absent-first ordering) — no new attendance query or report logic was introduced.
//
// Group Closure (Attendance Integration) — the print action now fetches the eligible
// roster for that exact historical group/date via pgGetEligibleStudentsForSession before
// calling openGroupSessionReport (which unions it with any real recorded session, so an
// actual attendance record is never dropped — see buildAttendanceReport.js's own header).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToastProvider } from '../../components/Toast';
import AttendanceReports from './AttendanceReports';
import { useAppStore } from '../../store/app.store';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetEligibleStudentsForSession: vi.fn(), pgGetAttendance: vi.fn() };
});
import { pgGetEligibleStudentsForSession, pgGetAttendance } from '../../services/api';

const GROUP_A = { id: 'g1', name: 'مجموعة أ', grade: 'الأول الثانوي', color: '#3b82f6' };
const GROUP_B = { id: 'g2', name: 'مجموعة ب', grade: 'الثاني الثانوي' };

const STUDENT_1 = { id: 's1', name: 'أحمد علي',  code: 'C001', groupId: 'g1', status: 'active', phone: '0100', parentPhone: '0111' };
const STUDENT_2 = { id: 's2', name: 'سارة محمد', code: 'C002', groupId: 'g1', status: 'active', phone: '0200', parentPhone: '0222' };

const ATTENDANCE = [
  { id: 'a1', studentId: 's1', groupId: 'g1', date: '2026-01-05', status: 'present' },
  { id: 'a2', studentId: 's2', groupId: 'g1', date: '2026-01-05', status: 'absent' },
  { id: 'a3', studentId: 's1', groupId: 'g1', date: '2026-01-12', status: 'late' },
];

function seed() {
  useAppStore.setState({
    groups: [GROUP_A, GROUP_B],
    students: [STUDENT_1, STUDENT_2],
    centerProfile: { name: 'م خالد جمعه' },
  });
  pgGetEligibleStudentsForSession.mockResolvedValue(['s1', 's2']);
  // C4 Attendance migration Phase 2 — ReportPrint (and ReportByGroup) now fetch
  // GET /api/attendance?groupId= instead of filtering the store's global attendance array.
  pgGetAttendance.mockImplementation(({ groupId }) =>
    Promise.resolve(ATTENDANCE.filter((r) => r.groupId === groupId)));
}

let writtenHtml;
function mockWindow() {
  writtenHtml = '';
  const win = { document: { open: vi.fn(), write: vi.fn((html) => { writtenHtml += html; }), close: vi.fn() }, focus: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(win);
  return win;
}

function openPrintTab() {
  render(<ToastProvider><AttendanceReports /></ToastProvider>);
  // "🖨" و"طباعة كشف" عُقدتان نصيتان منفصلتان داخل نفس الزر (نمط {icon} {label}) — مطابقة
  // جزئية أضمن من نص حرفي كامل هنا.
  fireEvent.click(screen.getByText(/طباعة كشف/));
}

describe('AttendanceReports — "طباعة كشف" tab is wired to the existing openGroupSessionReport builder', () => {
  beforeEach(() => { mockWindow(); vi.clearAllMocks(); });

  it('renders the group selector, and prompts for a group before showing session/print controls', () => {
    seed();
    openPrintTab();

    expect(screen.getByText('اختر مجموعة لطباعة كشف حضور إحدى جلساتها')).toBeInTheDocument();
    expect(screen.queryByText('🖨 طباعة كشف الحضور')).not.toBeInTheDocument();
  });

  it('after picking a group, lists its existing sessions (dates) and disables print until one is chosen', async () => {
    seed();
    openPrintTab();

    fireEvent.change(screen.getByDisplayValue('اختر مجموعة...'), { target: { value: 'g1' } });

    // C4 Attendance migration Phase 2: sessions now resolve from an async
    // GET /api/attendance?groupId= fetch — the date select starts out showing the same
    // "no sessions" placeholder as the truly-empty case until that fetch resolves.
    const dateSelect = await screen.findByDisplayValue(/اختر الجلسة/);
    expect(dateSelect).toBeInTheDocument();
    expect(screen.getByText('🖨 طباعة كشف الحضور').closest('button')).toBeDisabled();
  });

  it('a group with no recorded sessions shows an honest empty state instead of a fake session list', async () => {
    seed();
    openPrintTab();
    fireEvent.change(screen.getByDisplayValue('اختر مجموعة...'), { target: { value: 'g2' } }); // no attendance rows
    expect(await screen.findByDisplayValue('لا توجد جلسات مسجّلة لهذه المجموعة')).toBeInTheDocument();
  });

  it('selecting group + session and clicking print fetches the eligible roster for that date, then invokes the existing builder with the correct data, opening the real printable report', async () => {
    seed();
    openPrintTab();

    fireEvent.change(screen.getByDisplayValue('اختر مجموعة...'), { target: { value: 'g1' } });
    fireEvent.change(await screen.findByDisplayValue(/اختر الجلسة/), { target: { value: '2026-01-05' } });

    const printBtn = screen.getByText('🖨 طباعة كشف الحضور').closest('button');
    expect(printBtn).not.toBeDisabled();
    fireEvent.click(printBtn);

    await waitFor(() => expect(pgGetEligibleStudentsForSession).toHaveBeenCalledWith('g1', '2026-01-05'));
    await waitFor(() => expect(window.open).toHaveBeenCalled());
    // نفس محتوى openGroupSessionReport الموجود بالفعل: اسم المجموعة، حاضر/غائب لهذا
    // التاريخ تحديداً (وليس تاريخ 01-12 الآخر)، وكود/هاتف كل طالب في القائمة.
    expect(writtenHtml).toContain('مجموعة أ');
    expect(writtenHtml).toContain('أحمد علي');
    expect(writtenHtml).toContain('سارة محمد');
    expect(writtenHtml).toContain('C001');
    expect(writtenHtml).toContain('C002');
    expect(writtenHtml).toContain('م خالد جمعه'); // centerProfile.name يصل فعلياً كـ profile
  });

  it('a student who actually has a recorded attendance row for this session still appears even if the server no longer reports them eligible (a real record is never dropped)', async () => {
    seed();
    pgGetEligibleStudentsForSession.mockResolvedValue(['s1']); // s2 no longer "eligible" (e.g. later withdrawn), but s2 DOES have a real a2 record for 2026-01-05
    openPrintTab();

    fireEvent.change(screen.getByDisplayValue('اختر مجموعة...'), { target: { value: 'g1' } });
    fireEvent.change(await screen.findByDisplayValue(/اختر الجلسة/), { target: { value: '2026-01-05' } });
    fireEvent.click(screen.getByText('🖨 طباعة كشف الحضور').closest('button'));

    await waitFor(() => expect(window.open).toHaveBeenCalled());
    expect(writtenHtml).toContain('سارة محمد'); // s2's real absent record for this session is preserved
  });

  it('switching groups resets the session selection (no stale date carried over to a different group)', async () => {
    seed();
    openPrintTab();
    fireEvent.change(screen.getByDisplayValue('اختر مجموعة...'), { target: { value: 'g1' } });
    fireEvent.change(await screen.findByDisplayValue(/اختر الجلسة/), { target: { value: '2026-01-05' } });
    expect(screen.getByText('🖨 طباعة كشف الحضور').closest('button')).not.toBeDisabled();

    fireEvent.change(screen.getByDisplayValue('مجموعة أ'), { target: { value: 'g2' } });
    expect(await screen.findByDisplayValue('لا توجد جلسات مسجّلة لهذه المجموعة')).toBeInTheDocument();
  });

  it('existing tabs (by-student, by-group, frequent-absentees) remain unaffected by the new print tab', async () => {
    seed();
    render(<ToastProvider><AttendanceReports /></ToastProvider>);

    fireEvent.click(screen.getByText('تقرير المجموعة'));
    fireEvent.change(screen.getByDisplayValue('اختر مجموعة...'), { target: { value: 'g1' } });
    expect(await screen.findByText('الجلسات (2)')).toBeInTheDocument();

    fireEvent.click(screen.getByText('كثيرو الغياب'));
    expect(screen.getByText('المجموعة')).toBeInTheDocument();
  });
});
