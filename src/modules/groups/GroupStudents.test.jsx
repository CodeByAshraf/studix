// src/modules/groups/GroupStudents.test.jsx
// Product Completion Phase 2 — Finding 1: يتحقّق أن نقل الطلاب بين المجموعات يمرّ فعلياً
// عبر pgUpdateStudent (PUT /api/students/:id لكل طالب محدَّد)، ولا يُطبَّق أي تعديل محلي
// إلا بعد رد الخادم — نجاح كامل، فشل كامل، ونجاح جزئي.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TransferModal } from './GroupStudents';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgUpdateStudent: vi.fn() };
});
import { pgUpdateStudent } from '../../services/api';

const GROUP_A = 'gA';
const GROUP_B = 'gB';

const S1 = { id: 's1', name: 'طالب واحد', code: 'TC001', grade: 'الأول', phone: '01000000001', groupId: GROUP_A, status: 'active', enrollDate: '2025-01-01', monthlyFee: 100 };
const S2 = { id: 's2', name: 'طالب اثنان', code: 'TC002', grade: 'الأول', phone: '01000000002', groupId: GROUP_A, status: 'active', enrollDate: '2025-01-01', monthlyFee: 100 };

function setBaseState() {
  useAppStore.setState({
    groups: [
      { id: GROUP_A, name: 'مجموعة أ', grade: 'الأول', subject: 'رياضيات', time: '09:00', days: [], max: 20, color: '#000' },
      { id: GROUP_B, name: 'مجموعة ب', grade: 'الأول', subject: 'رياضيات', time: '10:00', days: [], max: 20, color: '#000' },
    ],
    students: [S1, S2],
    payments: [],
  });
}

function renderModal(onClose = vi.fn()) {
  render(
    <ToastProvider>
      <TransferModal group={{ id: GROUP_A, name: 'مجموعة أ' }} onClose={onClose} />
    </ToastProvider>
  );
  return onClose;
}

function selectAllAndPickTarget() {
  fireEvent.click(screen.getByText('تحديد الكل'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: GROUP_B } });
}

describe('TransferModal — group student transfer (Product Completion Phase 2, Finding 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('all success: calls pgUpdateStudent per selected student, merges the server response, closes the modal', async () => {
    setBaseState();
    pgUpdateStudent.mockImplementation((id, data) => Promise.resolve({ ...data, id, updatedAt: '2026-01-01T00:00:00.000Z' }));
    const onClose = renderModal();

    selectAllAndPickTarget();
    fireEvent.click(screen.getByRole('button', { name: /نقل \(2\)/ }));

    await waitFor(() => expect(pgUpdateStudent).toHaveBeenCalledTimes(2));
    expect(pgUpdateStudent).toHaveBeenCalledWith('s1', expect.objectContaining({ groupId: GROUP_B }));
    expect(pgUpdateStudent).toHaveBeenCalledWith('s2', expect.objectContaining({ groupId: GROUP_B }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const finalStudents = useAppStore.getState().students;
    expect(finalStudents.find((s) => s.id === 's1').groupId).toBe(GROUP_B);
    expect(finalStudents.find((s) => s.id === 's2').groupId).toBe(GROUP_B);
  });

  it('all failure: does not mutate local state and keeps the modal open (no fake success)', async () => {
    setBaseState();
    pgUpdateStudent.mockRejectedValue(new Error('PG PUT /students → 500'));
    const onClose = renderModal();

    selectAllAndPickTarget();
    fireEvent.click(screen.getByRole('button', { name: /نقل \(2\)/ }));

    await waitFor(() => expect(pgUpdateStudent).toHaveBeenCalledTimes(2));

    expect(onClose).not.toHaveBeenCalled();
    const finalStudents = useAppStore.getState().students;
    expect(finalStudents.find((s) => s.id === 's1').groupId).toBe(GROUP_A);
    expect(finalStudents.find((s) => s.id === 's2').groupId).toBe(GROUP_A);
  });

  it('partial failure: merges only the succeeded student, keeps the failed one selected for retry, keeps the modal open', async () => {
    setBaseState();
    pgUpdateStudent.mockImplementation((id, data) => {
      if (id === 's1') return Promise.resolve({ ...data, id, updatedAt: '2026-01-01T00:00:00.000Z' });
      return Promise.reject(new Error('PG PUT /students/s2 → 500'));
    });
    const onClose = renderModal();

    selectAllAndPickTarget();
    fireEvent.click(screen.getByRole('button', { name: /نقل \(2\)/ }));

    await waitFor(() => expect(pgUpdateStudent).toHaveBeenCalledTimes(2));

    expect(onClose).not.toHaveBeenCalled();
    const finalStudents = useAppStore.getState().students;
    expect(finalStudents.find((s) => s.id === 's1').groupId).toBe(GROUP_B);
    expect(finalStudents.find((s) => s.id === 's2').groupId).toBe(GROUP_A);

    // الطالب الفاشل (s2) يبقى محدَّداً — زر النقل يعكس عنصراً واحداً متبقياً لإعادة المحاولة
    await waitFor(() => expect(screen.getByRole('button', { name: /نقل \(1\)/ })).toBeInTheDocument());
  });
});
