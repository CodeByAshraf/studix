// src/modules/homework/HomeworkPage.test.jsx
// Phase 3B-6 — نفس عقد ExamsPage.test.jsx: create/delete لا يغيّران الحالة المحلية
// قبل نجاح الخادم، ويُطابقان استجابة الخادم عند النجاح، ويبقيان دون تغيير عند الفشل.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import HomeworkPage from './HomeworkPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgCreateHomework: vi.fn(), pgUpdateHomework: vi.fn(), pgDeleteHomework: vi.fn() };
});
import { pgCreateHomework, pgDeleteHomework } from '../../services/api';

const GROUP_ID = 'g1';

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <HomeworkPage />
      </ToastProvider>
    </AuthProvider>
  );
}

function seedStore() {
  useAppStore.setState({
    groups: [{ id: GROUP_ID, name: 'Test Group' }],
    students: [],
    homeworks: [],
    hwSubmissions: [],
  });
}

describe('HomeworkPage — server-truth write path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
  });

  it('create: does not touch local homeworks before the backend resolves, then adopts the server response', async () => {
    let resolveCall;
    pgCreateHomework.mockImplementation(() => new Promise((resolve) => { resolveCall = resolve; }));

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '+ واجب جديد' }));

    const modalBody = document.querySelector('.modal-body');
    fireEvent.change(within(modalBody).getByPlaceholderText('مثال: تدريبات المعادلات التربيعية'), { target: { value: 'واجب اختبار', name: 'title' } });
    const formSelects = within(modalBody).getAllByRole('combobox');
    fireEvent.change(formSelects[0], { target: { value: GROUP_ID, name: 'groupId' } }); // المجموعة
    fireEvent.change(formSelects[1], { target: { value: 'رياضيات', name: 'subject' } }); // المادة
    fireEvent.change(modalBody.querySelector('input[name="dueDate"]'), { target: { value: '2026-12-01', name: 'dueDate' } });

    fireEvent.click(within(modalBody).getByRole('button', { name: /إنشاء الواجب/ }));

    expect(useAppStore.getState().homeworks).toEqual([]);

    const saved = { id: 'srv-hw1', title: 'واجب اختبار', groupId: GROUP_ID, subject: 'رياضيات', dueDate: '2026-12-01', createdAt: '2026-08-18', totalScore: 10, status: 'active', description: '', teacher: '' };
    resolveCall(saved);

    await waitFor(() => {
      expect(useAppStore.getState().homeworks).toEqual([saved]);
    });
  });

  it('delete: calls pgDeleteHomework, cascades submissions locally on success, leaves state untouched on failure', async () => {
    useAppStore.setState({
      homeworks: [{ id: 'hw1', title: 'HW One', groupId: GROUP_ID, subject: 'رياضيات', dueDate: '2026-04-01', createdAt: '2026-03-01', totalScore: 10, status: 'active' }],
      hwSubmissions: [{ id: 'sub1', hwId: 'hw1', studentId: 's1', status: 'submitted', score: 8, submittedAt: '2026-03-20', notes: '' }],
    });

    // failure first
    pgDeleteHomework.mockRejectedValueOnce(new Error('الواجب غير موجود.'));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /حذف/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'نعم، احذف' }));

    await waitFor(() => expect(pgDeleteHomework).toHaveBeenCalledTimes(1));
    expect(useAppStore.getState().homeworks).toHaveLength(1);
    expect(useAppStore.getState().hwSubmissions).toHaveLength(1);
    expect(await screen.findByText('الواجب غير موجود.')).toBeInTheDocument();

    // now success — the confirm modal stays open after a failed attempt, retry the confirm button
    pgDeleteHomework.mockResolvedValueOnce({ deletedSubmissions: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'نعم، احذف' }));

    await waitFor(() => {
      expect(useAppStore.getState().homeworks).toHaveLength(0);
      expect(useAppStore.getState().hwSubmissions).toHaveLength(0);
    });
  });
});
