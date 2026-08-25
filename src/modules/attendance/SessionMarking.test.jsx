// src/modules/attendance/SessionMarking.test.jsx
// Phase 3B-4 — يتحقق من العقد الحرج: الحالة المحلية (Zustand) لا تتغيّر إلا بعد
// نجاح الخادم، وتُطابق استجابة الخادم بالضبط عند النجاح، وتبقى دون تغيير عند الفشل.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SessionMarking from './SessionMarking';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgSaveAttendanceSession: vi.fn() };
});
import { pgSaveAttendanceSession } from '../../services/api';

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
    groups: [{ id: GROUP_ID, name: 'Test Group' }],
    students: [
      { id: S1, name: 'Student One', code: 'C1', groupId: GROUP_ID, status: 'active' },
      { id: S2, name: 'Student Two', code: 'C2', groupId: GROUP_ID, status: 'active' },
    ],
    attendance: [],
  });
}

async function startSessionAndSave() {
  const select = screen.getByRole('combobox');
  fireEvent.change(select, { target: { value: GROUP_ID } });
  fireEvent.click(screen.getByRole('button', { name: /بدء تسجيل الحضور/ }));
  fireEvent.click(await screen.findByRole('button', { name: /حفظ الجلسة/ }));
}

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
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: GROUP_ID } });
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
