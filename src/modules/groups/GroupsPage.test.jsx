// src/modules/groups/GroupsPage.test.jsx
// Phase 3B-5 — يتحقّق من guard الحذف الثالث الجديد: مجموعة لها امتحانات (exams) يُمنع
// حذفها محلياً قبل الوصول للخادم إطلاقاً، حتى لو لم يعد بها طلاب حاليون.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import GroupsPage from './GroupsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return {
    ...actual,
    pgDeleteGroup: vi.fn(), pgCreateGroup: vi.fn(), pgUpdateGroup: vi.fn(),
    pgGetPayments: vi.fn(), pgGetPaymentAggregates: vi.fn(), pgGetCommunications: vi.fn(),
    pgGetAttendanceAggregate: vi.fn(), pgGetHomeworks: vi.fn(), pgGetGroupEnrollments: vi.fn(),
  };
});
import { pgDeleteGroup, pgCreateGroup, pgUpdateGroup, pgGetPayments, pgGetPaymentAggregates, pgGetCommunications, pgGetAttendanceAggregate, pgGetHomeworks, pgGetGroupEnrollments } from '../../services/api';

const GROUP_ID = 'g1';

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <GroupsPage />
      </ToastProvider>
    </AuthProvider>
  );
}

async function switchToListViewAndDelete() {
  fireEvent.click(screen.getByRole('button', { name: '≡ قائمة' }));
  fireEvent.click(await screen.findByTitle('حذف'));
  fireEvent.click(await screen.findByRole('button', { name: 'نعم، احذف' }));
}

describe('GroupsPage — delete guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Scalability Architecture Phase 4 Cutover 1: paymentsCount guard + OverviewBar/
    // list-view revenue now call pgGetPayments/pgGetPaymentAggregates instead of reading
    // the store's payments array — default to "nothing" so the other four guards' tests
    // are unaffected; the payments-specific test below overrides pgGetPayments.
    pgGetPayments.mockResolvedValue([]);
    pgGetPaymentAggregates.mockResolvedValue([]);
    // Pre-Installer Audit C4: communicationsCount guard now calls
    // pgGetCommunications({groupId}) instead of reading the store's communications array.
    pgGetCommunications.mockResolvedValue([]);
    // C4 Attendance migration Phase 2: attendanceCount guard + GroupCard's per-group %
    // now call pgGetAttendanceAggregate instead of reading the store's attendance array.
    pgGetAttendanceAggregate.mockResolvedValue([]);
    // Group Membership unification: members come from active enrollments — none by default.
    pgGetGroupEnrollments.mockResolvedValue([]);
    // Phase 2.1: the homework guard moved server-side (DELETE /api/groups/:id); the page must
    // not call pgGetHomeworks at all — left mocked (unresolved) only to assert that.
  });

  // M2/F3 — members (active enrollments), attendance, communications and payments are checked
  // by the SERVER inside DELETE /api/groups/:id ('groups' permission only). The page no longer
  // makes those per-group reads, so a groups-only user (for whom they are 403) can delete, and
  // the server's 409 (GROUP_HAS_RELATED_RECORDS) message is shown as-is.
  const EMPTY_GROUP_STATE = {
    groups: [{ id: GROUP_ID, name: 'Test Group', subject: 'رياضيات', grade: 'الأول', time: '09:00', days: [], max: 20, color: '#000' }],
    students: [], exams: [], payments: [], admissions: [], communications: [], homeworks: [],
  };

  it('M2/F3: a groups-only user can delete — no per-group enrollment/attendance/communication/payment read is made (they would be 403)', async () => {
    useAppStore.setState(EMPTY_GROUP_STATE);
    const forbidden = () => Promise.reject(new Error('لا تملك صلاحية الوصول لهذا الإجراء.'));
    // Only the per-group (delete-time) variants are forbidden; the page's own card-level
    // reads (no groupId) keep resolving so the page renders as usual.
    pgGetGroupEnrollments.mockImplementation((params) => (params?.groupId ? forbidden() : Promise.resolve([])));
    pgGetAttendanceAggregate.mockImplementation((params) => (params?.groupId ? forbidden() : Promise.resolve([])));
    pgGetPayments.mockImplementation((params) => (params?.groupId ? forbidden() : Promise.resolve([])));
    pgGetCommunications.mockImplementation(forbidden);
    pgDeleteGroup.mockResolvedValue(true);

    renderPage();
    await switchToListViewAndDelete();

    await waitFor(() => expect(pgDeleteGroup).toHaveBeenCalledWith(GROUP_ID));
    await waitFor(() => expect(useAppStore.getState().groups).toHaveLength(0));
    expect(pgGetGroupEnrollments).not.toHaveBeenCalledWith({ groupId: GROUP_ID });
    expect(pgGetAttendanceAggregate).not.toHaveBeenCalledWith(expect.objectContaining({ groupId: GROUP_ID }));
    expect(pgGetPayments).not.toHaveBeenCalledWith(expect.objectContaining({ groupId: GROUP_ID }));
    expect(pgGetCommunications).not.toHaveBeenCalled();
  });

  it.each([
    ['members (incl. an Additional enrollment)', 'لا يمكن حذف المجموعة — بها 1 طالب. انقل الطلاب أولاً.'],
    ['attendance history', 'لا يمكن حذف المجموعة — لها 3 سجل حضور تاريخي.'],
    ['communication history', 'لا يمكن حذف المجموعة — لها 1 سجل تواصل مرتبط.'],
    ['payment history', 'لا يمكن حذف المجموعة — لها 1 دفعة مسجَّلة.'],
  ])('M2/F3: %s — the server\'s 409 message is shown and the group stays', async (_label, message) => {
    useAppStore.setState(EMPTY_GROUP_STATE);
    pgDeleteGroup.mockRejectedValue(Object.assign(new Error(message), { code: 'GROUP_HAS_RELATED_RECORDS' }));

    renderPage();
    await switchToListViewAndDelete();

    await waitFor(() => expect(pgDeleteGroup).toHaveBeenCalledWith(GROUP_ID));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(useAppStore.getState().groups).toHaveLength(1);
  });

  it('blocks deletion when the group has exam history, even with zero current students', async () => {
    useAppStore.setState({
      groups: [{ id: GROUP_ID, name: 'Test Group', subject: 'رياضيات', grade: 'الأول', time: '09:00', days: [], max: 20, color: '#000' }],
      students: [], // no current students — the older studentCount guard would NOT catch this
      attendance: [],
      exams: [{ id: 'e1', groupId: GROUP_ID, name: 'Old Exam', date: '2025-01-01', total: 100, pass: 50 }],
      payments: [],
    });

    renderPage();
    await switchToListViewAndDelete();

    expect(pgDeleteGroup).not.toHaveBeenCalled();
    expect(await screen.findByText(/امتحان/)).toBeInTheDocument();
    expect(useAppStore.getState().groups).toHaveLength(1);
  });

  it('allows deletion to proceed to the server when there is no student, attendance, or exam history', async () => {
    useAppStore.setState({
      groups: [{ id: GROUP_ID, name: 'Test Group', subject: 'رياضيات', grade: 'الأول', time: '09:00', days: [], max: 20, color: '#000' }],
      students: [],
      attendance: [],
      exams: [],
      payments: [],
      admissions: [], communications: [], homeworks: [],
    });
    pgDeleteGroup.mockResolvedValue(true);

    renderPage();
    await switchToListViewAndDelete();

    await waitFor(() => expect(pgDeleteGroup).toHaveBeenCalledWith(GROUP_ID));
    await waitFor(() => expect(useAppStore.getState().groups).toHaveLength(0));
  });

  // MEDIUM-A Finding 3: نفس نمط guard الطلاب/الحضور/الامتحانات أعلاه، للجداول الأربعة
  // المتبقية التي تشير لـ groups.id بقيد NO ACTION (admissions/communications/
  // homeworks/payments).
  const BASE_GROUP_STATE = {
    groups: [{ id: GROUP_ID, name: 'Test Group', subject: 'رياضيات', grade: 'الأول', time: '09:00', days: [], max: 20, color: '#000' }],
    students: [], attendance: [], exams: [],
  };

  it('blocks deletion when the group has admission history', async () => {
    useAppStore.setState({ ...BASE_GROUP_STATE, admissions: [{ id: 'a1', groupId: GROUP_ID }], communications: [], homeworks: [], payments: [] });
    renderPage();
    await switchToListViewAndDelete();
    expect(pgDeleteGroup).not.toHaveBeenCalled();
    expect(await screen.findByText(/سجل قبول مرتبط/)).toBeInTheDocument();
  });

  // C3 regression fix: the homework guard matches by the group's grade (Homework 2.0 records
  // are grade-targeted, groupId=null). Phase 2.1: that guard now runs on the server inside
  // DELETE /api/groups/:id ('groups' permission — see backend/src/routes/groupDelete.js and
  // its integration test), so the page never reads homework data itself and needs no
  // 'homework' permission; it only surfaces the server's 409 message.
  it('surfaces the server\'s homework-guard rejection (409 GROUP_HAS_HOMEWORK) as-is', async () => {
    useAppStore.setState({ ...BASE_GROUP_STATE, admissions: [], communications: [], homeworks: [], payments: [] });
    pgDeleteGroup.mockRejectedValue(Object.assign(new Error('لا يمكن حذف المجموعة — لها 2 واجب مسجَّل.'), { code: 'GROUP_HAS_HOMEWORK' }));
    renderPage();
    await switchToListViewAndDelete();
    expect(await screen.findByText(/لها 2 واجب مسجَّل/)).toBeInTheDocument();
    expect(pgDeleteGroup).toHaveBeenCalledWith(GROUP_ID);
  });

  it('keeps the generic failure message for any other delete error', async () => {
    useAppStore.setState({ ...BASE_GROUP_STATE, admissions: [], communications: [], homeworks: [], payments: [] });
    pgDeleteGroup.mockRejectedValue(new Error('PG DELETE /groups/g1 → 500'));
    renderPage();
    await switchToListViewAndDelete();
    expect(await screen.findByText('فشل حذف المجموعة')).toBeInTheDocument();
    expect(screen.queryByText(/PG DELETE/)).not.toBeInTheDocument();
  });

  it('never reads homework data client-side (no GET /api/homeworks, store homeworks ignored)', async () => {
    useAppStore.setState({ ...BASE_GROUP_STATE, admissions: [], communications: [], homeworks: [{ id: 'stale', groupId: null, grade: 'الأول' }], payments: [] });
    pgDeleteGroup.mockResolvedValue(true);
    renderPage();
    await switchToListViewAndDelete();
    await waitFor(() => expect(pgDeleteGroup).toHaveBeenCalledWith(GROUP_ID));
    expect(pgGetHomeworks).not.toHaveBeenCalled();
  });
});

// Final installer release verification regression (found live against the installed
// build): editing an existing group with a teacher assigned, then saving without
// changing any field, made the group's displayed teacher go blank immediately — even
// though PostgreSQL still had the correct teacher_name (confirmed via GET /api/groups
// right after, and the name reappeared correctly on a full page reload). Root cause:
// pgUpdateGroup/pgCreateGroup's raw server response (teacherName, no "teacher" — the
// real backend shape) was written straight into state, bypassing the exact same
// normalizeCollectionForMerge('groups', ...) fixup the boot/sync path already applies
// to every group it loads. GroupsPage.handleSave now runs the server response through
// that same shared helper before storing it. These tests drive the real save flow
// through the UI with a deliberately raw (un-normalized) mocked server response — the
// same shape the real backend actually returns — to prove the fix without bypassing it.
describe('GroupsPage — teacher normalization after save (installer release regression)', () => {
  const FULL_GROUP = {
    id: GROUP_ID, name: 'Test Group', subject: 'رياضيات', grade: 'الصف الأول الثانوي',
    time: '09:00', days: ['sat', 'mon'], price: 100, max: 20, color: '#000',
    teacher: 'TEST - Ahmed Teacher', teacherName: 'TEST - Ahmed Teacher', notes: '',
  };
  const EMPTY_STATE = { students: [], attendance: [], exams: [], admissions: [], communications: [], homeworks: [], payments: [] };

  beforeEach(() => {
    vi.clearAllMocks();
    pgGetPayments.mockResolvedValue([]);
    pgGetPaymentAggregates.mockResolvedValue([]);
    pgGetGroupEnrollments.mockResolvedValue([]);
  });

  async function openEditAndSaveUnchanged() {
    fireEvent.click(screen.getByRole('button', { name: '≡ قائمة' }));
    fireEvent.click(await screen.findByTitle('تعديل'));
    fireEvent.click(await screen.findByRole('button', { name: /حفظ التعديلات/ }));
  }

  it('A. update preserves the teacher field in local state when the server response only contains teacherName', async () => {
    useAppStore.setState({ groups: [FULL_GROUP], ...EMPTY_STATE });
    // Deliberately the raw, un-normalized shape the real backend returns (teacherName,
    // no "teacher") — not a bypass of the fix, but the exact input it must handle.
    pgUpdateGroup.mockResolvedValue({
      id: GROUP_ID, name: 'Test Group', subject: 'رياضيات', grade: 'الصف الأول الثانوي',
      time: '09:00', days: ['sat', 'mon'], price: 100, max: 20, color: '#000',
      teacherName: 'TEST - Ahmed Teacher', notes: '',
    });

    renderPage();
    await openEditAndSaveUnchanged();

    await waitFor(() => expect(pgUpdateGroup).toHaveBeenCalled());
    const saved = useAppStore.getState().groups.find(g => g.id === GROUP_ID);
    expect(saved.teacher).toBe('TEST - Ahmed Teacher');
    expect(saved.teacherName).toBe('TEST - Ahmed Teacher');
    // The card must show the teacher name immediately — no reload required.
    expect(await screen.findByText(/TEST - Ahmed Teacher/)).toBeInTheDocument();
  });

  it('B. update with an empty/absent teacherName normalizes the local teacher field to an empty string, never leaving it undefined', async () => {
    useAppStore.setState({ groups: [{ ...FULL_GROUP, teacher: '', teacherName: '' }], ...EMPTY_STATE });
    pgUpdateGroup.mockResolvedValue({
      id: GROUP_ID, name: 'Test Group', subject: 'رياضيات', grade: 'الصف الأول الثانوي',
      time: '09:00', days: ['sat', 'mon'], price: 100, max: 20, color: '#000',
      teacherName: null, notes: '',
    });

    renderPage();
    await openEditAndSaveUnchanged();

    await waitFor(() => expect(pgUpdateGroup).toHaveBeenCalled());
    const saved = useAppStore.getState().groups.find(g => g.id === GROUP_ID);
    expect(saved.teacher).toBe('');
  });

  it('D. create also normalizes the teacher field from the server\'s raw teacherName response', async () => {
    useAppStore.setState({ groups: [], ...EMPTY_STATE });
    pgCreateGroup.mockResolvedValue({
      id: 'g-new', name: 'New Group', subject: 'رياضيات', grade: 'الصف الأول الثانوي',
      time: '09:00', days: ['sat'], price: 0, max: 10, color: '#000',
      teacherName: 'TEST - New Teacher', notes: '',
    });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '+ مجموعة جديدة' }));

    fireEvent.change(await screen.findByPlaceholderText('مثال: رياضيات ثانوي — أ'), { target: { value: 'New Group' } });
    fireEvent.change(screen.getByPlaceholderText('اسم المدرس...'), { target: { value: 'TEST - New Teacher' } });
    fireEvent.change(screen.getByDisplayValue('اختر المادة...'), { target: { value: 'رياضيات' } });
    fireEvent.change(screen.getByDisplayValue('اختر السنة...'), { target: { value: 'الصف الأول الثانوي' } });
    fireEvent.change(screen.getByPlaceholderText('20'), { target: { value: '10' } });
    fireEvent.click(screen.getByText('السبت')); // toggle "sat" on — days is required

    fireEvent.click(screen.getByRole('button', { name: /إنشاء المجموعة/ }));

    await waitFor(() => expect(pgCreateGroup).toHaveBeenCalled());
    const saved = useAppStore.getState().groups.find(g => g.id === 'g-new');
    expect(saved).toBeDefined();
    expect(saved.teacher).toBe('TEST - New Teacher');
  });
});
