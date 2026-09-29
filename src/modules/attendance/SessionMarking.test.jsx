// src/modules/attendance/SessionMarking.test.jsx
// Phase 3B-4 — يتحقق من العقد الحرج: الحالة المحلية (Zustand) لا تتغيّر إلا بعد
// نجاح الخادم، وتُطابق استجابة الخادم بالضبط عند النجاح، وتبقى دون تغيير عند الفشل.
//
// Group Closure (Attendance Integration) — the roster is now fetched from
// pgGetSessionRoster(groupId, date) (GET .../roster, attendanceEligibility.js
// on the server) instead of a plain local students.groupId filter. Mocked here to resolve
// [S1, S2] for GROUP_ID/TODAY, same as the old synchronous filter used to produce — every
// test below still exercises exactly the same server-truth write path this file was
// written to prove, just with one added await for the roster fetch to resolve first.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import SessionMarking from './SessionMarking';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgSaveAttendanceSession: vi.fn(), pgGetSessionRoster: vi.fn(), pgGetAttendance: vi.fn(), pgGetGroupOptions: vi.fn() };
});
import { pgSaveAttendanceSession, pgGetSessionRoster, pgGetAttendance, pgGetGroupOptions } from '../../services/api';

const GROUP_ID = 'g1';
const S1 = 's1';
const S2 = 's2';
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
    // M2 (Group Options): the picker is served by GET /api/groups/options; the Groups-only
    // collection stays empty (an attendance-only user never loads it).
    groups: [],
    students: [
      { id: S1, name: 'Student One', code: 'C1', groupId: GROUP_ID, status: 'active' },
      { id: S2, name: 'Student Two', code: 'C2', groupId: GROUP_ID, status: 'active' },
    ],
    attendance: [],
  });
  pgGetGroupOptions.mockResolvedValue([{ id: GROUP_ID, name: 'Test Group', grade: null, max: 20, price: 0, activeCount: 2 }]);
  pgGetSessionRoster.mockResolvedValue([{ id: S1, name: 'Student One', code: 'C1' }, { id: S2, name: 'Student Two', code: 'C2' }]);
  // C4 Attendance migration Phase 2: existingSession now comes from
  // GET /api/attendance?groupId=&date= instead of filtering the store's global attendance
  // array — default to "no existing session" so these write-path tests are unaffected.
  pgGetAttendance.mockResolvedValue([]);
}

// The picker fills asynchronously once GET /api/groups/options resolves (M2 Group Options).
async function waitForGroupOption(id) {
  await waitFor(() => expect(document.querySelector(`option[value="${id}"]`)).not.toBeNull());
}

async function selectGroupAndWaitForRoster() {
  await waitForGroupOption(GROUP_ID);
  const select = screen.getByRole('combobox');
  fireEvent.change(select, { target: { value: GROUP_ID } });
  await waitFor(() => expect(screen.getByRole('button', { name: /بدء تسجيل الحضور/ })).not.toBeDisabled());
}

async function startSessionAndSave() {
  await selectGroupAndWaitForRoster();
  fireEvent.click(screen.getByRole('button', { name: /بدء تسجيل الحضور/ }));
  fireEvent.click(await screen.findByRole('button', { name: /حفظ الجلسة/ }));
}

describe('SessionMarking — group picker from GET /api/groups/options (M2 Group Options)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore(); // Groups collection empty — an attendance-only user cannot read it
  });

  it('an attendance-only user can choose a group: options fill the picker with the server activeCount, and the session starts', async () => {
    pgGetGroupOptions.mockResolvedValue([
      { id: GROUP_ID, name: 'Test Group', grade: null, max: 20, price: 0, activeCount: 2 },
      { id: 'g2', name: 'Other Group', grade: null, max: 10, price: 0, activeCount: 7 },
    ]);
    expect(useAppStore.getState().groups).toEqual([]);
    renderPage();

    await waitForGroupOption('g2');
    expect(screen.getByRole('option', { name: 'Test Group (2 طالب)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Other Group (7 طالب)' })).toBeInTheDocument();
    expect(pgGetGroupOptions).toHaveBeenCalledTimes(1);

    await selectGroupAndWaitForRoster();
    fireEvent.click(screen.getByRole('button', { name: /بدء تسجيل الحضور/ }));
    // the selected group's name (from the option) labels the marking step
    expect(await screen.findAllByText(/Test Group/)).not.toHaveLength(0);
    expect(pgGetSessionRoster).toHaveBeenCalledWith(GROUP_ID, TODAY);
  });

  // M2 (Attendance roster): a truly attendance-only user — neither the Groups nor the
  // Students collection is readable — sees the roster and marks/saves the session.
  it('an attendance-only user (no Groups/Students collections) sees the roster from the server and marks/saves it', async () => {
    useAppStore.setState({ groups: [], students: [] });
    pgSaveAttendanceSession.mockImplementation((groupId, date, sessionTime, records) => Promise.resolve({
      groupId, date, sessionTime,
      records: records.map((r, i) => ({ id: `srv-${i}`, studentId: r.studentId, groupId, date, status: r.status })),
    }));
    renderPage();

    await selectGroupAndWaitForRoster();
    expect(screen.getByText('2', { selector: 'span' })).toBeInTheDocument(); // roster size in the setup preview
    fireEvent.click(screen.getByRole('button', { name: /بدء تسجيل الحضور/ }));

    // both students are listed by name and code, straight from the roster entries
    expect(await screen.findByText('Student One')).toBeInTheDocument();
    expect(screen.getByText('C1')).toBeInTheDocument();
    expect(screen.getByText('Student Two')).toBeInTheDocument();
    expect(screen.getByText('C2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /حفظ الجلسة/ }));
    await waitFor(() => expect(pgSaveAttendanceSession).toHaveBeenCalledTimes(1));
    const [, , , records] = pgSaveAttendanceSession.mock.calls[0];
    expect(records.map((r) => r.studentId).sort()).toEqual([S1, S2]);
    expect(records.every((r) => r.status === 'present')).toBe(true); // default mark
    await waitFor(() => expect(useAppStore.getState().attendance.map((r) => r.studentId).sort()).toEqual([S1, S2]));
  });
});

describe('SessionMarking — server-truth write path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
  });

  it('does NOT touch local attendance before the backend call resolves, and reconciles with the server response on success', async () => {
    const serverRecords = [
      { id: 'srv-1', studentId: S1, groupId: GROUP_ID, date: TODAY, status: 'present', sessionTime: '09:00', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'srv-2', studentId: S2, groupId: GROUP_ID, date: TODAY, status: 'present', sessionTime: '09:00', createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    let resolveCall;
    pgSaveAttendanceSession.mockImplementation(() => new Promise((resolve) => { resolveCall = resolve; }));

    renderPage();
    await selectGroupAndWaitForRoster();
    fireEvent.click(screen.getByRole('button', { name: /بدء تسجيل الحضور/ }));
    fireEvent.click(await screen.findByRole('button', { name: /حفظ الجلسة/ }));

    // بينما الطلب معلَّق: يجب ألا تتغيّر الحالة المحلية إطلاقاً
    expect(useAppStore.getState().attendance).toEqual([]);

    resolveCall({ groupId: GROUP_ID, date: TODAY, sessionTime: '09:00', records: serverRecords });

    await waitFor(() => {
      expect(useAppStore.getState().attendance).toEqual(serverRecords);
    });
  });

  it('leaves local attendance state completely unchanged when the backend call fails', async () => {
    pgSaveAttendanceSession.mockRejectedValue(new Error('PG PUT /attendance-sessions/g1/today → 500'));

    renderPage();
    await startSessionAndSave();

    await waitFor(() => {
      expect(pgSaveAttendanceSession).toHaveBeenCalledTimes(1);
    });

    // فشل الطلب: الحالة المحلية يجب أن تبقى كما كانت قبل الحفظ تماماً
    expect(useAppStore.getState().attendance).toEqual([]);
    // رسالة الخطأ الموجودة (toast) يجب أن تظهر
    expect(await screen.findByText(/PG PUT \/attendance-sessions/)).toBeInTheDocument();
  });

  it('sends the correct groupId/date/sessionTime/records payload', async () => {
    pgSaveAttendanceSession.mockResolvedValue({
      groupId: GROUP_ID, date: TODAY, sessionTime: '09:00', records: [],
    });

    renderPage();
    await startSessionAndSave();

    await waitFor(() => expect(pgSaveAttendanceSession).toHaveBeenCalledTimes(1));
    const [groupId, date, sessionTime, records] = pgSaveAttendanceSession.mock.calls[0];
    expect(groupId).toBe(GROUP_ID);
    expect(date).toBe(TODAY);
    expect(sessionTime).toBe('09:00');
    // الافتراضي عند بدء الجلسة: كل الطلاب present
    expect(records.sort((a, b) => a.studentId.localeCompare(b.studentId))).toEqual([
      { studentId: S1, status: 'present' },
      { studentId: S2, status: 'present' },
    ]);
  });

  it('replaces only the records for this groupId+date, preserving unrelated existing local attendance', async () => {
    // سجل موجود مسبقاً من جلسة/مجموعة أخرى — يجب ألا يُمسّ إطلاقاً
    useAppStore.setState({
      attendance: [{ id: 'unrelated-1', studentId: 'sX', groupId: 'other-group', date: '1999-01-01', status: 'present' }],
    });
    const serverRecords = [
      { id: 'srv-1', studentId: S1, groupId: GROUP_ID, date: TODAY, status: 'present', sessionTime: '09:00', createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    pgSaveAttendanceSession.mockResolvedValue({ groupId: GROUP_ID, date: TODAY, sessionTime: '09:00', records: serverRecords });

    renderPage();
    await startSessionAndSave();

    await waitFor(() => {
      const attendance = useAppStore.getState().attendance;
      expect(attendance).toHaveLength(2);
      expect(attendance.find((r) => r.id === 'unrelated-1')).toBeTruthy();
      expect(attendance.find((r) => r.id === 'srv-1')).toBeTruthy();
    });
  });
});

// C4 Attendance migration Phase 2 — existingSession (pre-fill + "session already exists"
// warning) now comes from a scoped GET /api/attendance?groupId=&date= fetch instead of
// filtering the store's global attendance array with getSessionRecords.
describe('SessionMarking — existing-session detection (C4 Attendance migration Phase 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
  });

  it('fetches the existing session with the correct groupId+date params', async () => {
    renderPage();
    await selectGroupAndWaitForRoster();
    expect(pgGetAttendance).toHaveBeenCalledWith({ groupId: GROUP_ID, date: TODAY });
  });

  it('shows the "will be replaced" warning and pre-fills marks from a real existing session, exactly as the old getSessionRecords filter did', async () => {
    pgGetAttendance.mockResolvedValue([
      { id: 'a1', studentId: S1, groupId: GROUP_ID, date: TODAY, status: 'absent', sessionTime: '09:00' },
      { id: 'a2', studentId: S2, groupId: GROUP_ID, date: TODAY, status: 'late', sessionTime: '09:00' },
    ]);
    renderPage();

    await waitForGroupOption(GROUP_ID);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: GROUP_ID } });
    expect(await screen.findByText(/توجد بيانات محفوظة لهذه الجلسة/)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole('button', { name: /بدء تسجيل الحضور/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /بدء تسجيل الحضور/ }));

    // pre-filled from the real existing records (S1=absent, S2=late), not the "everyone
    // present" default — checked via the session header's AttendanceStats counts (each
    // stat is its own {value,label} pair, not one combined text node).
    const absentLabel = await screen.findByText('غائب', { selector: 'span' });
    expect(within(absentLabel.parentElement).getByText('1')).toBeInTheDocument();
    const lateLabel = screen.getByText('متأخر', { selector: 'span' });
    expect(within(lateLabel.parentElement).getByText('1')).toBeInTheDocument();
  });

  it('an empty session (no existing records) shows no warning and pre-fills everyone as present (the default)', async () => {
    pgGetAttendance.mockResolvedValue([]);
    renderPage();

    await waitForGroupOption(GROUP_ID);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: GROUP_ID } });
    await waitFor(() => expect(screen.getByRole('button', { name: /بدء تسجيل الحضور/ })).not.toBeDisabled());

    expect(screen.queryByText(/توجد بيانات محفوظة لهذه الجلسة/)).not.toBeInTheDocument();
  });

  it('disables "بدء تسجيل الحضور" while the existing-session check is still loading, preventing a stale prior session from being pre-filled', async () => {
    let resolveExisting;
    pgGetAttendance.mockImplementation(() => new Promise((resolve) => { resolveExisting = resolve; }));
    renderPage();

    await waitForGroupOption(GROUP_ID);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: GROUP_ID } });
    await waitFor(() => expect(pgGetSessionRoster).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /بدء تسجيل الحضور/ })).toBeDisabled();

    resolveExisting([]);
    await waitFor(() => expect(screen.getByRole('button', { name: /بدء تسجيل الحضور/ })).not.toBeDisabled());
  });
});
