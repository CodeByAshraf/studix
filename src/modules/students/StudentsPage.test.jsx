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
    pgCreateParent: vi.fn(), pgGetCollection: vi.fn(),
  };
});
import { pgDeleteStudent, pgCreateStudent, pgCreateParent, pgGetCollection } from '../../services/api';

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
  });

  it('blocks deletion when the student has grade history, never calling pgDeleteStudent', async () => {
    useAppStore.setState({
      groups: [{ id: GROUP_ID, name: 'Test Group' }],
      students: [{ id: S1, name: 'Student One', code: 'C1', groupId: GROUP_ID, status: 'active', phone: '0100' }],
      attendance: [],
      grades: [{ id: 'gr1', examId: 'e1', studentId: S1, score: 90, absent: false }],
    });

    renderPage();
    await openConfirmAndClick();

    expect(pgDeleteStudent).not.toHaveBeenCalled();
    expect(await screen.findByText(/درجة مسجّلة/)).toBeInTheDocument();
    // الطالب لا يزال في الحالة المحلية
    expect(useAppStore.getState().students).toHaveLength(1);
  });

  it('allows deletion to proceed to the server when there is no attendance or grade history', async () => {
    useAppStore.setState({
      groups: [{ id: GROUP_ID, name: 'Test Group' }],
      students: [{ id: S1, name: 'Student One', code: 'C1', groupId: GROUP_ID, status: 'active', phone: '0100' }],
      attendance: [],
      grades: [],
      admissions: [], communications: [], hwSubmissions: [], inventoryTxn: [], payments: [], waReportLog: [],
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
    attendance: [], grades: [],
  };

  it('blocks deletion when the student has admission history', async () => {
    useAppStore.setState({ ...BASE_STATE, admissions: [{ id: 'a1', studentId: S1 }], communications: [], hwSubmissions: [], inventoryTxn: [], payments: [], waReportLog: [] });
    renderPage();
    await openConfirmAndClick();
    expect(pgDeleteStudent).not.toHaveBeenCalled();
    expect(await screen.findByText(/سجل قبول/)).toBeInTheDocument();
  });

  it('blocks deletion when the student has communication history', async () => {
    useAppStore.setState({ ...BASE_STATE, admissions: [], communications: [{ id: 'c1', studentId: S1 }], hwSubmissions: [], inventoryTxn: [], payments: [], waReportLog: [] });
    renderPage();
    await openConfirmAndClick();
    expect(pgDeleteStudent).not.toHaveBeenCalled();
    expect(await screen.findByText(/سجل تواصل/)).toBeInTheDocument();
  });

  it('blocks deletion when the student has homework submission history', async () => {
    useAppStore.setState({ ...BASE_STATE, admissions: [], communications: [], hwSubmissions: [{ id: 'h1', studentId: S1 }], inventoryTxn: [], payments: [], waReportLog: [] });
    renderPage();
    await openConfirmAndClick();
    expect(pgDeleteStudent).not.toHaveBeenCalled();
    expect(await screen.findByText(/تسليم واجب/)).toBeInTheDocument();
  });

  it('blocks deletion when the student has inventory transaction history', async () => {
    useAppStore.setState({ ...BASE_STATE, admissions: [], communications: [], hwSubmissions: [], inventoryTxn: [{ id: 'i1', studentId: S1 }], payments: [], waReportLog: [] });
    renderPage();
    await openConfirmAndClick();
    expect(pgDeleteStudent).not.toHaveBeenCalled();
    expect(await screen.findByText(/حركة مخزون/)).toBeInTheDocument();
  });

  it('blocks deletion when the student has payment history', async () => {
    useAppStore.setState({ ...BASE_STATE, admissions: [], communications: [], hwSubmissions: [], inventoryTxn: [], payments: [{ id: 'p1', studentId: S1 }], waReportLog: [] });
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

function fillAndSubmitAddForm({ parentPhone } = {}) {
  fireEvent.click(screen.getByText('+ طالب جديد'));
  fireEvent.change(screen.getByPlaceholderText('الاسم الرباعي على الأقل...'), { target: { value: 'أحمد محمد علي حسن' } });
  const phoneInputs = screen.getAllByPlaceholderText('01XXXXXXXXX');
  fireEvent.change(phoneInputs[0], { target: { value: '01012345678' } });
  if (parentPhone !== undefined) fireEvent.change(phoneInputs[1], { target: { value: parentPhone } });
  fireEvent.change(screen.getByDisplayValue('اختر السنة...'), { target: { value: GRADE } });
  fireEvent.change(screen.getByDisplayValue('اختر المجموعة...'), { target: { value: GROUP_ID } });
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
});
