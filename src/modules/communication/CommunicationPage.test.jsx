// src/modules/communication/CommunicationPage.test.jsx
// Phase 3B-7 — نفس عقد ExamsPage/HomeworkPage: create لا يغيّر الحالة المحلية قبل
// نجاح الخادم، ويُطابق استجابة الخادم عند النجاح، ويبقى دون تغيير عند الفشل.
// قاعدة إضافية خاصة بهذه المرحلة: التواصل والمهمة عمليتان منفصلتان — فشل المهمة
// لا يُلغي التواصل الناجح بالفعل (لا آلية تراجع بالحذف، communications محمي بـ
// prevent_delete()).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import CommunicationPage from './CommunicationPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return {
    ...actual,
    pgCreateCommunication: vi.fn(), pgCreateCommTask: vi.fn(), pgGetCollection: vi.fn(),
    pgUpdateCommunication: vi.fn(), pgUpdateCommTask: vi.fn(),
  };
});
import { pgCreateCommunication, pgCreateCommTask, pgUpdateCommunication, pgUpdateCommTask } from '../../services/api';

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <CommunicationPage />
      </ToastProvider>
    </AuthProvider>
  );
}

function seedStore(extra = {}) {
  useAppStore.setState({ communications: [], commTasks: [], parents: [], students: [], admissions: [], ...extra });
}

async function openFormAndSave() {
  fireEvent.click(screen.getByRole('button', { name: '+ تسجيل تواصل' }));
  fireEvent.click(await screen.findByRole('button', { name: 'حفظ' }));
}

describe('CommunicationPage — server-truth write path (create only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
  });

  it('does NOT touch local communications before the backend call resolves, and reconciles with the server response on success', async () => {
    const serverRecord = { id: 'srv-c1', number: 'COM-000001', type: 'phoneCall', result: 'answered', reason: 'inquiry', priority: 'normal', status: 'open', parentName: '', studentName: '', phone: '', notes: '', employee: 'الموظف الحالي', followupDate: null, followupTime: null };
    let resolveCall;
    pgCreateCommunication.mockImplementation(() => new Promise((resolve) => { resolveCall = resolve; }));

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '+ تسجيل تواصل' }));
    fireEvent.click(await screen.findByRole('button', { name: 'حفظ' }));

    expect(useAppStore.getState().communications).toEqual([]);

    resolveCall(serverRecord);

    await waitFor(() => {
      expect(useAppStore.getState().communications).toEqual([serverRecord]);
    });
  });

  it('leaves local communications state unchanged and shows the real error when create fails', async () => {
    pgCreateCommunication.mockRejectedValue(new Error('PG POST /communications → 500'));

    renderPage();
    await openFormAndSave();

    await waitFor(() => expect(pgCreateCommunication).toHaveBeenCalledTimes(1));
    expect(useAppStore.getState().communications).toEqual([]);
    expect(await screen.findByText(/PG POST \/communications/)).toBeInTheDocument();
  });

  it('adopts the server response verbatim, not the locally-built optimistic record', async () => {
    const serverRecord = { id: 'srv-c1', number: 'COM-000042', type: 'phoneCall', result: 'answered', priority: 'normal', status: 'open' };
    pgCreateCommunication.mockResolvedValue(serverRecord);

    renderPage();
    await openFormAndSave();

    await waitFor(() => {
      const list = useAppStore.getState().communications;
      expect(list).toHaveLength(1);
      expect(list[0]).toEqual(serverRecord); // رقم السجل من الخادم (COM-000042) لا المحسوب محلياً
    });
  });

  it('does not attempt task creation when no follow-up date was set', async () => {
    pgCreateCommunication.mockResolvedValue({ id: 'srv-c1', number: 'COM-000001', type: 'phoneCall', result: 'answered' });

    renderPage();
    await openFormAndSave();

    await waitFor(() => expect(pgCreateCommunication).toHaveBeenCalledTimes(1));
    expect(pgCreateCommTask).not.toHaveBeenCalled();
  });

  it('follow-up task: adopts the server response on success', async () => {
    const savedComm = { id: 'srv-c1', number: 'COM-000001', type: 'phoneCall', result: 'answered' };
    const savedTask = { id: 'srv-t1', commId: 'srv-c1', title: 'متابعة: ', dueDate: '2026-12-01', status: 'pending', priority: 'normal' };
    pgCreateCommunication.mockResolvedValue(savedComm);
    pgCreateCommTask.mockResolvedValue(savedTask);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '+ تسجيل تواصل' }));
    const dateInput = document.querySelector('input[type="date"]');
    fireEvent.change(dateInput, { target: { value: '2026-12-01' } });
    fireEvent.click(await screen.findByRole('button', { name: 'حفظ' }));

    await waitFor(() => {
      expect(useAppStore.getState().commTasks).toEqual([savedTask]);
    });
    const [, taskArg] = pgCreateCommTask.mock.calls[0];
    // commId يجب أن يكون معرّف التواصل من استجابة الخادم، لا أي قيمة محلية مؤقتة
    expect(pgCreateCommTask.mock.calls[0][0].commId).toBe('srv-c1');
  });

  it('follow-up task failure: does NOT roll back the already-created communication, does not fabricate a local task, and shows the real error', async () => {
    const savedComm = { id: 'srv-c1', number: 'COM-000001', type: 'phoneCall', result: 'answered' };
    pgCreateCommunication.mockResolvedValue(savedComm);
    pgCreateCommTask.mockRejectedValue(new Error('PG POST /commTasks → 500'));

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '+ تسجيل تواصل' }));
    const dateInput = document.querySelector('input[type="date"]');
    fireEvent.change(dateInput, { target: { value: '2026-12-01' } });
    fireEvent.click(await screen.findByRole('button', { name: 'حفظ' }));

    await waitFor(() => expect(pgCreateCommTask).toHaveBeenCalledTimes(1));

    // التواصل يبقى محفوظاً بالضبط كما أعاده الخادم — لا حذف، لا تراجع
    expect(useAppStore.getState().communications).toEqual([savedComm]);
    // لا مهمة محلية مُلفَّقة
    expect(useAppStore.getState().commTasks).toEqual([]);
    expect(await screen.findByText(/PG POST \/commTasks/)).toBeInTheDocument();
  });
});

// Product Completion Phase 2 — Finding 3: إكمال مهمة متابعة / سجل تواصل من الواجهة —
// نفس عقد server-truth-first أعلاه (لا تعديل محلي قبل رد الخادم، النجاح فقط بعد التأكيد).
describe('CommunicationPage — mark-complete (Product Completion Phase 2, Finding 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
  });

  it('task completion — success: calls pgUpdateCommTask, merges the server response, task drops out of the priority list', async () => {
    const task = { id: 't1', commId: null, title: 'متابعة هامة', dueDate: '2026-01-01', dueTime: null, priority: 'high', employee: 'موظف', status: 'pending' };
    useAppStore.setState({ communications: [], commTasks: [task], parents: [] });
    const saved = { ...task, status: 'completed' };
    pgUpdateCommTask.mockResolvedValue(saved);

    renderPage();
    fireEvent.click(await screen.findByTitle('إكمال'));

    await waitFor(() => expect(pgUpdateCommTask).toHaveBeenCalledWith('t1', expect.objectContaining({ status: 'completed' })));
    await waitFor(() => {
      const stored = useAppStore.getState().commTasks.find((t) => t.id === 't1');
      expect(stored.status).toBe('completed');
    });
    // مهمة مكتملة تخرج من "مهام هامة" (تصفية status === pending في reminderService)
    expect(screen.queryByText('متابعة هامة')).not.toBeInTheDocument();
  });

  it('task completion — failure: leaves commTasks unchanged and shows the real error', async () => {
    const task = { id: 't1', commId: null, title: 'متابعة هامة', dueDate: '2026-01-01', dueTime: null, priority: 'high', employee: 'موظف', status: 'pending' };
    useAppStore.setState({ communications: [], commTasks: [task], parents: [] });
    pgUpdateCommTask.mockRejectedValue(new Error('PG PUT /commTasks/t1 → 500'));

    renderPage();
    fireEvent.click(await screen.findByTitle('إكمال'));

    await waitFor(() => expect(pgUpdateCommTask).toHaveBeenCalledTimes(1));
    expect(useAppStore.getState().commTasks).toEqual([task]);
    expect(await screen.findByText(/PG PUT \/commTasks\/t1/)).toBeInTheDocument();
  });

  it('communication completion — success: calls pgUpdateCommunication, merges the server response', async () => {
    const record = { id: 'c1', number: 'COM-000001', type: 'phoneCall', result: 'answered', status: 'open', phone: '01000000001', parentName: '', studentName: '', employee: 'موظف', notes: '', priority: 'normal', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    useAppStore.setState({ communications: [record], commTasks: [], parents: [] });
    const saved = { ...record, status: 'completed', updatedAt: '2026-01-02T00:00:00.000Z' };
    pgUpdateCommunication.mockResolvedValue(saved);

    renderPage();
    // اختيار ولي الأمر عبر بطاقة الإنبوكس لعرض سجله في ParentProfile
    fireEvent.click(await screen.findByText('COM-000001', { exact: false }));
    fireEvent.click(await screen.findByTitle('إكمال'));

    await waitFor(() => expect(pgUpdateCommunication).toHaveBeenCalledWith('c1', expect.objectContaining({ status: 'completed' })));
    await waitFor(() => {
      const stored = useAppStore.getState().communications.find((r) => r.id === 'c1');
      expect(stored.status).toBe('completed');
    });
  });

  it('communication completion — failure: leaves communications unchanged and shows the real error', async () => {
    const record = { id: 'c1', number: 'COM-000001', type: 'phoneCall', result: 'answered', status: 'open', phone: '01000000001', parentName: '', studentName: '', employee: 'موظف', notes: '', priority: 'normal', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    useAppStore.setState({ communications: [record], commTasks: [], parents: [] });
    pgUpdateCommunication.mockRejectedValue(new Error('PG PUT /communications/c1 → 500'));

    renderPage();
    fireEvent.click(await screen.findByText('COM-000001', { exact: false }));
    fireEvent.click(await screen.findByTitle('إكمال'));

    await waitFor(() => expect(pgUpdateCommunication).toHaveBeenCalledTimes(1));
    expect(useAppStore.getState().communications).toEqual([record]);
    expect(await screen.findByText(/PG PUT \/communications\/c1/)).toBeInTheDocument();
  });
});

// MEDIUM-C (Finding 5) — CommFormModal's unified student/admission search now sets real
// FKs on selection, while preserving the exact free-text fallback for a genuinely new
// inquiry (no fabricated linkage from a name/phone match that wasn't explicitly picked).
describe('CommunicationPage — student/admission linking on communication create (MEDIUM-C, Finding 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const STUDENT_TEXT_INPUT = 'ابحث لربط سجل حقيقي، أو اكتب استفساراً جديداً...';

  it('selecting a matched student sends the real studentId and the derived parentId (student already has a linked parent)', async () => {
    seedStore({
      students: [{ id: 's1', name: 'أحمد محمد', code: 'TC001', phone: '01000000001', parentId: 'p1', parentPhone: '01099999999', status: 'active' }],
      parents: [{ id: 'p1', phone: '01099999999', fullName: 'محمد أحمد' }],
    });
    pgCreateCommunication.mockResolvedValue({ id: 'srv-c1', number: 'COM-000001', type: 'phoneCall', result: 'answered' });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '+ تسجيل تواصل' }));
    fireEvent.change(screen.getByPlaceholderText(STUDENT_TEXT_INPUT), { target: { value: 'أحمد' } });
    fireEvent.click(await screen.findByText('أحمد محمد'));
    fireEvent.click(screen.getByText('حفظ'));

    await waitFor(() => expect(pgCreateCommunication).toHaveBeenCalledTimes(1));
    const [sentRec] = pgCreateCommunication.mock.calls[0];
    expect(sentRec.studentId).toBe('s1');
    expect(sentRec.admissionId).toBeNull();
    expect(sentRec.parentId).toBe('p1');
    expect(sentRec.studentName).toBe('أحمد محمد');
    expect(sentRec.parentName).toBe('محمد أحمد');
  });

  it('selecting a matched admission sends the real admissionId and the derived parentId (admission already has a linked parent)', async () => {
    seedStore({
      admissions: [{ id: 'a1', name: 'ليلى سارة', phone: '01000000002', parentName: 'سارة محمود', parentPhone: '01088888888', parentId: 'p2' }],
    });
    pgCreateCommunication.mockResolvedValue({ id: 'srv-c2', number: 'COM-000002', type: 'phoneCall', result: 'answered' });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '+ تسجيل تواصل' }));
    fireEvent.change(screen.getByPlaceholderText(STUDENT_TEXT_INPUT), { target: { value: 'ليلى' } });
    fireEvent.click(await screen.findByText('ليلى سارة'));
    fireEvent.click(screen.getByText('حفظ'));

    await waitFor(() => expect(pgCreateCommunication).toHaveBeenCalledTimes(1));
    const [sentRec] = pgCreateCommunication.mock.calls[0];
    expect(sentRec.admissionId).toBe('a1');
    expect(sentRec.studentId).toBeNull();
    expect(sentRec.parentId).toBe('p2');
    expect(sentRec.studentName).toBe('ليلى سارة');
    expect(sentRec.parentName).toBe('سارة محمود');
  });

  it('typing free text matching no existing student/admission keeps all three FK fields null and preserves the typed text (new-inquiry fallback, unchanged)', async () => {
    seedStore({
      students: [{ id: 's1', name: 'أحمد محمد', code: 'TC001', status: 'active' }],
      admissions: [{ id: 'a1', name: 'ليلى سارة' }],
    });
    pgCreateCommunication.mockResolvedValue({ id: 'srv-c3', number: 'COM-000003', type: 'phoneCall', result: 'answered' });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '+ تسجيل تواصل' }));
    fireEvent.change(screen.getByPlaceholderText(STUDENT_TEXT_INPUT), { target: { value: 'استفسار جديد كلياً' } });
    fireEvent.click(screen.getByText('حفظ'));

    await waitFor(() => expect(pgCreateCommunication).toHaveBeenCalledTimes(1));
    const [sentRec] = pgCreateCommunication.mock.calls[0];
    expect(sentRec.studentId).toBeNull();
    expect(sentRec.admissionId).toBeNull();
    expect(sentRec.parentId).toBeNull();
    expect(sentRec.studentName).toBe('استفسار جديد كلياً');
  });
});
