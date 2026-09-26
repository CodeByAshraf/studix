// src/modules/students/StudentsPage.test.jsx
// Phase 3B-5 — يتحقّق من guard الحذف الجديد: طالب له درجات (grades) يُمنع حذفه محلياً
// قبل الوصول للخادم إطلاقاً، بنفس نمط guard الحضور الموجود مسبقاً.
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
    pgDeleteStudent: vi.fn(), pgCreateStudent: vi.fn(), pgUpdateStudent: vi.fn(),
    pgCreateParent: vi.fn(), pgGetCollection: vi.fn(), pgGetPayments: vi.fn(),
    pgGetCommunications: vi.fn(), pgGetAttendance: vi.fn(),
    pgGetGrades: vi.fn(), pgGetHwSubmissions: vi.fn(),
  };
});
import { pgDeleteStudent, pgCreateStudent, pgCreateParent, pgGetCollection, pgGetPayments, pgGetCommunications, pgGetAttendance, pgGetGrades, pgGetHwSubmissions } from '../../services/api';

const GROUP_ID = 'g1';
const S1 = 's1';

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <StudentsPage />
      </ToastProvider>
    </AuthProvider>
  );
}

async function openConfirmAndClick() {
  fireEvent.click(screen.getByTitle('حذف'));
  fireEvent.click(await screen.findByRole('button', { name: 'نعم، احذف' }));
}

describe('StudentsPage — delete guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Scalability Architecture Phase 4 Cutover 1: paymentsCount guard now calls
    // pgGetPayments({studentId}) instead of reading the store's payments array —
    // default to "no payments" so the other six guards' tests are unaffected; the one
    // payments-specific test below overrides this explicitly.
    pgGetPayments.mockResolvedValue([]);
    // Pre-Installer Audit C4: communicationsCount guard now calls
    // pgGetCommunications({studentId}) instead of reading the store's communications
    // array (no longer boot-loaded) — same default-then-override pattern as payments.
    pgGetCommunications.mockResolvedValue([]);
    // C4 Attendance migration Phase 2: per-row heat map + attendance guard now come from
    // one batched GET /api/attendance?studentIds= call — default to "no attendance" so the
    // other guards' tests are unaffected (see StudentsPage.attendance.test.jsx for
    // dedicated attendance-guard/batching coverage).
    pgGetAttendance.mockResolvedValue([]);
    // C4 Grades/hwSubmissions Frontend Migration (Batch A, feature 004): gradesCount/
    // hwSubmissionsCount guards now call pgGetGrades({studentId})/pgGetHwSubmissions({studentId})
    // instead of reading the store's grades/hwSubmissions arrays — same default-then-override
    // pattern as payments/communications/attendance above.
    pgGetGrades.mockResolvedValue([]);
    pgGetHwSubmissions.mockResolvedValue([]);
  });

  it('blocks deletion when the student has grade history, never calling pgDeleteStudent', async () => {
    useAppStore.setState({
      groups: [{ id: GROUP_ID, name: 'Test Group' }],
      students: [{ id: S1, name: 'Student One', code: 'C1', groupId: GROUP_ID, status: 'active', phone: '0100' }],
      attendance: [], admissions: [], communications: [], inventoryTxn: [], payments: [], waReportLog: [],
    });
    pgGetGrades.mockResolvedValue([{ id: 'gr1', examId: 'e1', studentId: S1, score: 90, absent: false }]);

    renderPage();
    await openConfirmAndClick();

    expect(pgGetGrades).toHaveBeenCalledWith({ studentId: S1 });
    expect(pgDeleteStudent).not.toHaveBeenCalled();
    expect(await screen.findByText(/درجة مسجّلة/)).toBeInTheDocument();
    // الطالب لا يزال في الحالة المحلية
    expect(useAppStore.getState().students).toHaveLength(1);
  });

  it('surfaces a clear error and does not proceed if the grades check itself fails', async () => {
    useAppStore.setState({
      groups: [{ id: GROUP_ID, name: 'Test Group' }],
      students: [{ id: S1, name: 'Student One', code: 'C1', groupId: GROUP_ID, status: 'active', phone: '0100' }],
      attendance: [], admissions: [], communications: [], inventoryTxn: [], payments: [], waReportLog: [],
    });
    pgGetGrades.mockRejectedValue(new Error('PG GET /grades → 500'));

    renderPage();
    await openConfirmAndClick();

    expect(pgDeleteStudent).not.toHaveBeenCalled();
    expect(await screen.findByText(/PG GET \/grades/)).toBeInTheDocument();
  });

  it('blocks deletion when the student has homework submission history via pgGetHwSubmissions', async () => {
    useAppStore.setState({
      groups: [{ id: GROUP_ID, name: 'Test Group' }],
      students: [{ id: S1, name: 'Student One', code: 'C1', groupId: GROUP_ID, status: 'active', phone: '0100' }],
      attendance: [], admissions: [], communications: [], inventoryTxn: [], payments: [], waReportLog: [],
    });
    pgGetHwSubmissions.mockResolvedValue([{ id: 'h1', studentId: S1 }]);

    renderPage();
    await openConfirmAndClick();

    expect(await screen.findByText(/تسليم واجب/)).toBeInTheDocument();
    expect(pgGetHwSubmissions).toHaveBeenCalledWith({ studentId: S1 });
    expect(pgDeleteStudent).not.toHaveBeenCalled();
  });

  it('surfaces a clear error and does not proceed if the hwSubmissions check itself fails', async () => {
    useAppStore.setState({
      groups: [{ id: GROUP_ID, name: 'Test Group' }],
      students: [{ id: S1, name: 'Student One', code: 'C1', groupId: GROUP_ID, status: 'active', phone: '0100' }],
      attendance: [], admissions: [], communications: [], inventoryTxn: [], payments: [], waReportLog: [],
    });
    pgGetHwSubmissions.mockRejectedValue(new Error('PG GET /hwSubmissions → 500'));

    renderPage();
    await openConfirmAndClick();

    expect(pgDeleteStudent).not.toHaveBeenCalled();
    expect(await screen.findByText(/PG GET \/hwSubmissions/)).toBeInTheDocument();
  });

  it('allows deletion to proceed to the server when there is no attendance, grade, or homework-submission history', async () => {
    useAppStore.setState({
      groups: [{ id: GROUP_ID, name: 'Test Group' }],
      students: [{ id: S1, name: 'Student One', code: 'C1', groupId: GROUP_ID, status: 'active', phone: '0100' }],
      attendance: [],
      admissions: [], communications: [], inventoryTxn: [], payments: [], waReportLog: [],
    });
    pgDeleteStudent.mockResolvedValue(true);

    renderPage();
    await openConfirmAndClick();

    await waitFor(() => expect(pgDeleteStudent).toHaveBeenCalledWith(S1));
    await waitFor(() => expect(useAppStore.getState().students).toHaveLength(0));
  });

  // MEDIUM-A Finding 3: نفس نمط guard الحضور/الدرجات أعلاه، للجداول الستة المتبقية التي
  // تشير لـ students.id بقيد NO ACTION (admissions/communications/hwSubmissions/
  // inventoryTxn/payments/waReportLog).
  const BASE_STATE = {
    groups: [{ id: GROUP_ID, name: 'Test Group' }],
    students: [{ id: S1, name: 'Student One', code: 'C1', groupId: GROUP_ID, status: 'active', phone: '0100' }],
    attendance: [],
  };

  it('blocks deletion when the student has admission history', async () => {
    useAppStore.setState({ ...BASE_STATE, admissions: [{ id: 'a1', studentId: S1 }], communications: [], hwSubmissions: [], inventoryTxn: [], payments: [], waReportLog: [] });
    renderPage();
    await openConfirmAndClick();
    expect(pgDeleteStudent).not.toHaveBeenCalled();
    expect(await screen.findByText(/سجل قبول/)).toBeInTheDocument();
  });

  it('blocks deletion when the student has communication history', async () => {
    useAppStore.setState({ ...BASE_STATE, admissions: [], hwSubmissions: [], inventoryTxn: [], payments: [], waReportLog: [] });
    pgGetCommunications.mockResolvedValue([{ id: 'c1', studentId: S1 }]);
    renderPage();
    await openConfirmAndClick();
    expect(pgGetCommunications).toHaveBeenCalledWith({ studentId: S1 });
    expect(pgDeleteStudent).not.toHaveBeenCalled();
    expect(await screen.findByText(/سجل تواصل/)).toBeInTheDocument();
  });

  it('surfaces a clear error and does not proceed if the communications check itself fails', async () => {
    useAppStore.setState({ ...BASE_STATE, admissions: [], hwSubmissions: [], inventoryTxn: [], payments: [], waReportLog: [] });
    pgGetCommunications.mockRejectedValue(new Error('PG GET /communications → 500'));
    renderPage();
    await openConfirmAndClick();
    expect(pgDeleteStudent).not.toHaveBeenCalled();
    expect(await screen.findByText(/PG GET \/communications/)).toBeInTheDocument();
  });

  it('blocks deletion when the student has inventory transaction history', async () => {
    useAppStore.setState({ ...BASE_STATE, admissions: [], communications: [], inventoryTxn: [{ id: 'i1', studentId: S1 }], payments: [], waReportLog: [] });
    renderPage();
    await openConfirmAndClick();
    expect(pgDeleteStudent).not.toHaveBeenCalled();
    expect(await screen.findByText(/حركة مخزون/)).toBeInTheDocument();
  });

  it('blocks deletion when the student has payment history', async () => {
    useAppStore.setState({ ...BASE_STATE, admissions: [], communications: [], hwSubmissions: [], inventoryTxn: [], payments: [], waReportLog: [] });
    pgGetPayments.mockResolvedValue([{ id: 'p1', studentId: S1 }]);
    renderPage();
    await openConfirmAndClick();
    expect(pgDeleteStudent).not.toHaveBeenCalled();
    expect(await screen.findByText(/دفعة مسجّلة/)).toBeInTheDocument();
  });

  it('blocks deletion when the student has WhatsApp report log history', async () => {
    useAppStore.setState({ ...BASE_STATE, admissions: [], communications: [], hwSubmissions: [], inventoryTxn: [], payments: [], waReportLog: [{ id: 'w1', studentId: S1 }] });
    renderPage();
    await openConfirmAndClick();
    expect(pgDeleteStudent).not.toHaveBeenCalled();
    expect(await screen.findByText(/سجل تقرير واتساب/)).toBeInTheDocument();
  });
});

// Product Completion Phase 1 — Issue 3: direct student creation links a real parents row
// via find-or-create-by-normalized-phone before pgCreateStudent is called.
const GRADE = 'الصف الأول الثانوي';

// Phase 3B: المجموعة الرئيسية أصبحت اختيارية — skipGroup يترك الطالب بلا مجموعة رئيسية
// (لا يختار أي قيمة في القائمة، تبقى على '').
function fillAndSubmitAddForm({ parentPhone, skipGroup = false } = {}) {
  fireEvent.click(screen.getByText('+ طالب جديد'));
  fireEvent.change(screen.getByPlaceholderText('الاسم الرباعي على الأقل...'), { target: { value: 'أحمد محمد علي حسن' } });
  const phoneInputs = screen.getAllByPlaceholderText('01XXXXXXXXX');
  fireEvent.change(phoneInputs[0], { target: { value: '01012345678' } });
  if (parentPhone !== undefined) fireEvent.change(phoneInputs[1], { target: { value: parentPhone } });
  fireEvent.change(screen.getByDisplayValue('اختر السنة...'), { target: { value: GRADE } });
  if (!skipGroup) {
    fireEvent.change(screen.getByDisplayValue('بدون مجموعة رئيسية (اختياري)'), { target: { value: GROUP_ID } });
  }
  fireEvent.click(screen.getByText('💾 تسجيل الطالب'));
}

describe('StudentsPage — direct creation links a real parents row (Issue 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      groups: [{ id: GROUP_ID, name: 'Test Group', grade: GRADE }],
      students: [],
      attendance: [],
      grades: [],
    });
  });

  it('finds-or-creates a parent by normalized phone and includes parentId in the create payload', async () => {
    pgCreateParent.mockResolvedValue({ conflict: false, data: { id: '7', phone: '201123456789' } });
    pgCreateStudent.mockResolvedValue({ id: 'srv-s1', name: 'أحمد محمد علي حسن', parentId: '7' });

    renderPage();
    fillAndSubmitAddForm({ parentPhone: '01123456789' });

    await waitFor(() => expect(pgCreateParent).toHaveBeenCalledWith(
      { phone: '201123456789' },
      expect.objectContaining({ onPhoneConflict: expect.any(Function) })
    ));
    await waitFor(() => expect(pgCreateStudent).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: '7' })
    ));
    expect(useAppStore.getState().students).toHaveLength(1);
  });

  it('re-resolves the existing parent id on a 409 phone conflict instead of failing', async () => {
    // pgCreateParent's real implementation invokes the caller's onPhoneConflict on a 409 —
    // mirror that here so the component's own callback (which calls pgGetCollection) runs.
    pgCreateParent.mockImplementation(async (_data, { onPhoneConflict } = {}) => ({
      conflict: true, existingId: await onPhoneConflict(),
    }));
    pgGetCollection.mockResolvedValue([{ id: '9', phone: '201123456789' }]);
    pgCreateStudent.mockResolvedValue({ id: 'srv-s2', name: 'أحمد محمد علي حسن', parentId: '9' });

    renderPage();
    fillAndSubmitAddForm({ parentPhone: '01123456789' });

    await waitFor(() => expect(pgGetCollection).toHaveBeenCalledWith('parents'));
    await waitFor(() => expect(pgCreateStudent).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: '9' })
    ));
  });

  it('leaves parent_id unset (no pgCreateParent call, no parentId key) when no parent phone is given', async () => {
    pgCreateStudent.mockResolvedValue({ id: 'srv-s3', name: 'أحمد محمد علي حسن' });

    renderPage();
    fillAndSubmitAddForm();

    await waitFor(() => expect(pgCreateStudent).toHaveBeenCalled());
    expect(pgCreateParent).not.toHaveBeenCalled();
    const sentBody = pgCreateStudent.mock.calls[0][0];
    expect(sentBody.parentId).toBeUndefined();
  });

  // Phase 3B (Multi-Group Enrollment UI) — groupId is no longer required: a student can be
  // created with zero Primary Groups. The form must submit successfully (validation no
  // longer blocks it), and the payload must send real null, never '' (an empty string would
  // fail as an FK violation on the backend — see studentService.test.js for the unit-level
  // proof of this normalization).
  it('creates a student successfully with no Primary Group selected, sending groupId: null (not "")', async () => {
    pgCreateStudent.mockResolvedValue({ id: 'srv-s4', name: 'أحمد محمد علي حسن', groupId: null });

    renderPage();
    fillAndSubmitAddForm({ skipGroup: true });

    await waitFor(() => expect(pgCreateStudent).toHaveBeenCalled());
    const sentBody = pgCreateStudent.mock.calls[0][0];
    expect(sentBody.groupId).toBeNull();
    expect(useAppStore.getState().students).toHaveLength(1);
  });
});
