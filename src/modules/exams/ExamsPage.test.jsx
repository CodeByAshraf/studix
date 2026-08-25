// src/modules/exams/ExamsPage.test.jsx
// Phase 3B-5 — نفس عقد SessionMarking/GradeEntry: create/delete لا يغيّران الحالة
// المحلية قبل نجاح الخادم، ويُطابقان استجابة الخادم عند النجاح، ويبقيان دون تغيير
// عند الفشل.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ExamsPage from './ExamsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgCreateExam: vi.fn(), pgUpdateExam: vi.fn(), pgDeleteExam: vi.fn() };
});
import { pgCreateExam, pgDeleteExam } from '../../services/api';

const GROUP_ID = 'g1';

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <ExamsPage />
      </ToastProvider>
    </AuthProvider>
  );
}

function seedStore() {
  useAppStore.setState({
    groups: [{ id: GROUP_ID, name: 'Test Group' }],
    students: [],
    exams: [],
    grades: [],
  });
}

describe('ExamsPage — server-truth write path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
  });

  it('create: does not touch local exams before the backend resolves, then adopts the server response', async () => {
    let resolveCall;
    pgCreateExam.mockImplementation(() => new Promise((resolve) => { resolveCall = resolve; }));

    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: '+ إنشاء امتحان' })[0]);

    // ExamsPage's own filter bar (status/group selects) is always in the DOM outside
    // the modal — scope queries to the modal body so we only touch the form's fields.
    const modalBody = document.querySelector('.modal-body');
    fireEvent.change(within(modalBody).getByPlaceholderText('مثال: امتحان شهري مارس — رياضيات'), { target: { value: 'اختبار', name: 'name' } });
    const formSelects = within(modalBody).getAllByRole('combobox');
    fireEvent.change(formSelects[0], { target: { value: GROUP_ID, name: 'groupId' } }); // المجموعة
    fireEvent.change(formSelects[1], { target: { value: 'رياضيات', name: 'subject' } }); // المادة

    fireEvent.click(within(modalBody).getByRole('button', { name: /إنشاء الامتحان/ }));

    expect(useAppStore.getState().exams).toEqual([]);

    const saved = { id: 'srv-e1', name: 'اختبار', groupId: GROUP_ID, subject: 'رياضيات', date: '2026-01-01', total: 100, pass: 50, type: 'monthly', teacher: '', status: 'upcoming' };
    resolveCall(saved);

    await waitFor(() => {
      expect(useAppStore.getState().exams).toEqual([saved]);
    });
  });

  it('delete: calls pgDeleteExam, cascades grades locally on success, leaves state untouched on failure', async () => {
    useAppStore.setState({
      exams: [{ id: 'e1', name: 'Exam One', groupId: GROUP_ID, subject: 'رياضيات', date: '2026-01-01', total: 100, pass: 50 }],
      grades: [{ id: 'gr1', examId: 'e1', studentId: 's1', score: 90, absent: false }],
    });

    // failure first
    pgDeleteExam.mockRejectedValueOnce(new Error('الامتحان غير موجود.'));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /حذف/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'نعم، احذف' }));

    await waitFor(() => expect(pgDeleteExam).toHaveBeenCalledTimes(1));
    expect(useAppStore.getState().exams).toHaveLength(1);
    expect(useAppStore.getState().grades).toHaveLength(1);
    expect(await screen.findByText('الامتحان غير موجود.')).toBeInTheDocument();

    // now success — the confirm modal stays open after a failed attempt (handleDelete
    // only closes it on success), so just retry the confirm button, no need to re-trigger
    pgDeleteExam.mockResolvedValueOnce({ deletedGrades: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'نعم، احذف' }));

    await waitFor(() => {
      expect(useAppStore.getState().exams).toHaveLength(0);
      expect(useAppStore.getState().grades).toHaveLength(0);
    });
  });
});
