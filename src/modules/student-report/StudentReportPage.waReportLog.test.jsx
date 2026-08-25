// src/modules/student-report/StudentReportPage.waReportLog.test.jsx
// Phase 3B-9 — waReportLog write path. Unlike every previously migrated collection,
// the user-visible action here (opening WhatsApp) is irreversible and already committed
// by the time the audit-log write happens, so the contract is deliberately different:
// - the success toast is never gated on the server call
// - a failed audit-log write shows a non-blocking toast.warning, never toast.error
// - createdBy must be the real session user id (FK to users.id), never a display name
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentReportPage from './StudentReportPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgCreateWaReportLog: vi.fn() };
});
import { pgCreateWaReportLog } from '../../services/api';

vi.mock('./studentWhatsappService', async () => {
  const actual = await vi.importActual('./studentWhatsappService');
  return { ...actual, openWhatsapp: vi.fn(() => ({ ok: true, url: 'https://wa.me/x' })) };
});
import { openWhatsapp } from './studentWhatsappService';

const STUDENT_ID = 's1';

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <StudentReportPage />
      </ToastProvider>
    </AuthProvider>
  );
}

function seedStore() {
  useAppStore.setState({
    students: [{
      id: STUDENT_ID, name: 'Test Student', code: 'C1', phone: '0100000000',
      parentPhone: '0111111111', groupId: null, enrollDate: '2026-01-01', monthlyFee: 100,
    }],
    groups: [], attendance: [], absenceFollowup: [], payments: [], exams: [], grades: [],
    homeworks: [], hwSubmissions: [], invMaterials: [], matDist: [], communications: [],
    inventoryTxn: [], centerProfile: {}, waReportLog: [],
  });
}

function loginSession(user) {
  sessionStorage.setItem('tc_session', JSON.stringify(user));
}

// يبحث عن الطالب، يختاره، يفتح معاينة واتساب، ثم يضغط "فتح واتساب" داخل المودال
async function openWhatsappFromReport() {
  fireEvent.change(screen.getByPlaceholderText('ابحث باسم الطالب أو الكود أو رقم الهاتف...'), {
    target: { value: 'Test Student' },
  });
  fireEvent.click(await screen.findByText('Test Student'));
  fireEvent.click(await screen.findByRole('button', { name: /إرسال ملخص لولي الأمر/ }));
  fireEvent.click(await screen.findByRole('button', { name: /فتح واتساب/ }));
}

describe('StudentReportPage — waReportLog write path (best-effort, after an irreversible action)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    seedStore();
  });

  it('shows WhatsApp success immediately, without waiting for the audit-log write, and sends createdBy as the real session user id (not a display name)', async () => {
    loginSession({ id: 'u_admin', name: 'Admin User', role: 'admin', isAdmin: true });

    let resolveCall;
    pgCreateWaReportLog.mockImplementation(() => new Promise((resolve) => { resolveCall = resolve; }));

    renderPage();
    await openWhatsappFromReport();

    expect(openWhatsapp).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('تم فتح واتساب بالرسالة الجاهزة')).toBeInTheDocument();

    // لا تعديل محلي على waReportLog قبل استجابة الخادم
    expect(useAppStore.getState().waReportLog).toEqual([]);

    expect(pgCreateWaReportLog).toHaveBeenCalledTimes(1);
    const sentPayload = pgCreateWaReportLog.mock.calls[0][0];
    expect(sentPayload).toEqual({
      studentId:   STUDENT_ID,
      parentPhone: '0111111111',
      reportType:  expect.any(String),
      messageType: sentPayload.reportType,
      createdBy:   'u_admin',
      status:      'prepared',
    });
    expect(sentPayload.id).toBeUndefined();
    expect(sentPayload.createdAt).toBeUndefined();

    const saved = { id: 'srv-wal-1', ...sentPayload };
    resolveCall(saved);

    await waitFor(() => {
      expect(useAppStore.getState().waReportLog).toEqual([saved]);
    });
  });

  it('sends createdBy: null when there is no logged-in session (never falls back to a display name)', async () => {
    pgCreateWaReportLog.mockResolvedValueOnce({ id: 'srv-wal-2' });

    renderPage();
    await openWhatsappFromReport();

    await waitFor(() => expect(pgCreateWaReportLog).toHaveBeenCalledTimes(1));
    expect(pgCreateWaReportLog.mock.calls[0][0].createdBy).toBeNull();
  });

  it('audit-log failure: still shows the WhatsApp success toast, surfaces a non-blocking warning (not an error), and does not add a local record', async () => {
    pgCreateWaReportLog.mockRejectedValueOnce(new Error('انتهاك مفتاح خارجي (سجل مرتبط غير موجود).'));

    renderPage();
    await openWhatsappFromReport();

    expect(await screen.findByText('تم فتح واتساب بالرسالة الجاهزة')).toBeInTheDocument();

    const warningToast = await waitFor(() => {
      const el = document.querySelector('.toast.warning');
      expect(el).toBeInTheDocument();
      return el;
    });
    expect(within(warningToast).getByText('انتهاك مفتاح خارجي (سجل مرتبط غير موجود).')).toBeInTheDocument();

    // تحذير غير حاجب فقط — لا رسالة خطأ (toast.error) لفشل قيد التدقيق
    expect(document.querySelector('.toast.error')).not.toBeInTheDocument();

    expect(useAppStore.getState().waReportLog).toEqual([]);
  });
});
