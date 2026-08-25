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
  return { ...actual, pgDeleteGroup: vi.fn(), pgCreateGroup: vi.fn(), pgUpdateGroup: vi.fn() };
});
import { pgDeleteGroup } from '../../services/api';

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

  it('blocks deletion when the group has communication history', async () => {
    useAppStore.setState({ ...BASE_GROUP_STATE, admissions: [], communications: [{ id: 'c1', groupId: GROUP_ID }], homeworks: [], payments: [] });
    renderPage();
    await switchToListViewAndDelete();
    expect(pgDeleteGroup).not.toHaveBeenCalled();
    expect(await screen.findByText(/سجل تواصل مرتبط/)).toBeInTheDocument();
  });

  it('blocks deletion when the group has homework history', async () => {
    useAppStore.setState({ ...BASE_GROUP_STATE, admissions: [], communications: [], homeworks: [{ id: 'h1', groupId: GROUP_ID }], payments: [] });
    renderPage();
    await switchToListViewAndDelete();
    expect(pgDeleteGroup).not.toHaveBeenCalled();
    expect(await screen.findByText(/واجب مسجَّل/)).toBeInTheDocument();
  });

  it('blocks deletion when the group has payment history', async () => {
    useAppStore.setState({ ...BASE_GROUP_STATE, admissions: [], communications: [], homeworks: [], payments: [{ id: 'p1', groupId: GROUP_ID }] });
    renderPage();
    await switchToListViewAndDelete();
    expect(pgDeleteGroup).not.toHaveBeenCalled();
    expect(await screen.findByText(/دفعة مسجَّلة/)).toBeInTheDocument();
  });
});
