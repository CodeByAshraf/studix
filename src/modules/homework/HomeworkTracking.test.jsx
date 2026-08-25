// src/modules/homework/HomeworkTracking.test.jsx
// Phase 3B-6 — نفس عقد GradeEntry.test.jsx: الحالة المحلية (Zustand) لا تتغيّر إلا
// بعد نجاح الخادم، وتُطابق استجابة الخادم بالضبط عند النجاح، وتبقى دون تغيير عند الفشل.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import HomeworkTracking from './HomeworkTracking';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgSaveHwSubmissions: vi.fn() };
});
import { pgSaveHwSubmissions } from '../../services/api';

const GROUP_ID = 'g1';
const HW = { id: 'hw1', groupId: GROUP_ID, title: 'Test HW', subject: 'رياضيات', totalScore: 10, dueDate: '2026-03-15' };
const S1 = 's1';
const S2 = 's2';

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <HomeworkTracking hw={HW} onClose={() => {}} />
      </ToastProvider>
    </AuthProvider>
  );
}

function seedStore() {
  useAppStore.setState({
    students: [
      { id: S1, name: 'Student One', code: 'C1', groupId: GROUP_ID, status: 'active' },
      { id: S2, name: 'Student Two', code: 'C2', groupId: GROUP_ID, status: 'active' },
    ],
    hwSubmissions: [],
  });
}

describe('HomeworkTracking — server-truth write path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
  });

  it('does NOT touch local hwSubmissions before the backend call resolves, and reconciles with the server response on success', async () => {
    const serverRecords = [
      { id: 'srv-1', hwId: HW.id, studentId: S1, status: 'missing', submittedAt: null, score: null, notes: '' },
      { id: 'srv-2', hwId: HW.id, studentId: S2, status: 'missing', submittedAt: null, score: null, notes: '' },
    ];
    let resolveCall;
    pgSaveHwSubmissions.mockImplementation(() => new Promise((resolve) => { resolveCall = resolve; }));

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /حفظ الحالات/ }));

    expect(useAppStore.getState().hwSubmissions).toEqual([]);

    resolveCall({ homeworkId: HW.id, records: serverRecords });

    await waitFor(() => {
      expect(useAppStore.getState().hwSubmissions).toEqual(serverRecords);
    });
  });

  it('leaves local hwSubmissions state completely unchanged when the backend call fails', async () => {
    pgSaveHwSubmissions.mockRejectedValue(new Error('PG PUT /hw-submissions/hw1 → 500'));

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /حفظ الحالات/ }));

    await waitFor(() => expect(pgSaveHwSubmissions).toHaveBeenCalledTimes(1));

    expect(useAppStore.getState().hwSubmissions).toEqual([]);
    expect(await screen.findByText(/PG PUT \/hw-submissions/)).toBeInTheDocument();
  });

  it('sends the correct homeworkId and default roster payload (status:missing, score:null by default)', async () => {
    pgSaveHwSubmissions.mockResolvedValue({ homeworkId: HW.id, records: [] });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /حفظ الحالات/ }));

    await waitFor(() => expect(pgSaveHwSubmissions).toHaveBeenCalledTimes(1));
    const [homeworkId, records] = pgSaveHwSubmissions.mock.calls[0];
    expect(homeworkId).toBe(HW.id);
    expect(records.sort((a, b) => a.studentId.localeCompare(b.studentId))).toEqual([
      { studentId: S1, status: 'missing', submittedAt: null, score: null, notes: '' },
      { studentId: S2, status: 'missing', submittedAt: null, score: null, notes: '' },
    ]);
  });

  it('replaces only the submissions for this homeworkId, preserving unrelated existing local submissions', async () => {
    useAppStore.setState({
      hwSubmissions: [{ id: 'unrelated-1', hwId: 'other-hw', studentId: 'sX', status: 'submitted', score: 5, submittedAt: '2026-01-01', notes: '' }],
    });
    const serverRecords = [{ id: 'srv-1', hwId: HW.id, studentId: S1, status: 'missing', submittedAt: null, score: null, notes: '' }];
    pgSaveHwSubmissions.mockResolvedValue({ homeworkId: HW.id, records: serverRecords });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /حفظ الحالات/ }));

    await waitFor(() => {
      const subs = useAppStore.getState().hwSubmissions;
      expect(subs).toHaveLength(2);
      expect(subs.find(s => s.id === 'unrelated-1')).toBeTruthy();
      expect(subs.find(s => s.id === 'srv-1')).toBeTruthy();
    });
  });
});
