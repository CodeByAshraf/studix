// src/modules/students/StudentsPage.activityLog.test.jsx
// Phase 3B-15 — addLog is now server-truth-first (activity_logs via PostgreSQL), no
// localStorage fallback of any kind. Verifies: (a) the real entity (student id) is
// attached correctly, (b) no userName/userId is ever sent from the call site (the
// server derives identity from the session — Phase 3B-15 §14/§16.2), (c) a failed
// activity-log write is surfaced (toast) without reverting the primary action, which
// already succeeded on its own before addLog is even called.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentsPage from './StudentsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgDeleteStudent: vi.fn(), pgCreateActivityLog: vi.fn() };
});
import { pgDeleteStudent, pgCreateActivityLog } from '../../services/api';

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

function seedStore() {
  useAppStore.setState({
    groups: [{ id: GROUP_ID, name: 'Test Group' }],
    students: [{ id: S1, name: 'Student One', code: 'C1', groupId: GROUP_ID, status: 'active', phone: '0100' }],
    attendance: [],
    grades: [],
  });
}

async function openConfirmAndClick() {
  fireEvent.click(screen.getByTitle('حذف'));
  fireEvent.click(await screen.findByRole('button', { name: 'نعم، احذف' }));
}

describe('StudentsPage — activity log integration (Phase 3B-15)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('delete: calls addLog with the real entity (entityType/entityId), never a client-supplied user field', async () => {
    seedStore();
    pgDeleteStudent.mockResolvedValue(true);
    pgCreateActivityLog.mockResolvedValue({ id: 'al1', ts: '2026-01-10T00:00:00.000Z', user: 'مدير النظام', action: 'delete', module: 'students', description: 'حذف: Student One' });

    renderPage();
    await openConfirmAndClick();

    await waitFor(() => expect(pgCreateActivityLog).toHaveBeenCalledTimes(1));
    const sentEntry = pgCreateActivityLog.mock.calls[0][0];
    expect(sentEntry.entityType).toBe('student');
    expect(sentEntry.entityId).toBe(S1);
    expect(sentEntry.action).toBe('delete');
    // لا userId/userName يُرسَلان من موقع الاستدعاء إطلاقاً — الخادم يشتقّهما من الجلسة
    expect(sentEntry.userId).toBeUndefined();
    expect(sentEntry.userName).toBeUndefined();
  });

  it('a failed activity-log write does not revert the already-successful primary action, and is surfaced (not silently swallowed, no localStorage fallback)', async () => {
    seedStore();
    pgDeleteStudent.mockResolvedValue(true);
    pgCreateActivityLog.mockRejectedValue(new Error('يجب تسجيل الدخول للوصول لهذا المسار.'));

    renderPage();
    await openConfirmAndClick();

    // الإجراء الأساسي (حذف الطالب) نجح بالفعل ولا يتراجع بسبب فشل تسجيل النشاط لاحقاً
    await waitFor(() => expect(useAppStore.getState().students).toHaveLength(0));
    await waitFor(() => expect(pgDeleteStudent).toHaveBeenCalledWith(S1));

    // الفشل يُعرَض بوضوح (toast)، لا يُبتلَع صامتاً ولا يُخزَّن محلياً كبديل
    expect(await screen.findByText('يجب تسجيل الدخول للوصول لهذا المسار.')).toBeInTheDocument();
  });
});
