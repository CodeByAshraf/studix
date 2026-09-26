// src/modules/attendance/AbsenceFollowup.whatsapp.test.jsx
// Attendance → غياب المتابعة: per-absent-student WhatsApp action (V1). One explicit
// user click per parent — no "send to all", no window.open loop. openWhatsapp is
// mocked (not real window.open), same technique already used in
// StudentReportPage.waReportLog.test.jsx.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AbsenceFollowup from './AbsenceFollowup';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('./absenceWhatsappService', async () => {
  const actual = await vi.importActual('./absenceWhatsappService');
  return { ...actual, openWhatsapp: vi.fn(() => ({ ok: true, url: 'https://wa.me/x' })) };
});
import { openWhatsapp } from './absenceWhatsappService';

const GROUP = { id: 'g1', name: 'مجموعة أ', teacherName: 'أ. محمد سعيد' };

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <AbsenceFollowup />
      </ToastProvider>
    </AuthProvider>
  );
}

function seedStore(students, extra = {}) {
  useAppStore.setState({
    students,
    groups: [GROUP],
    attendance: [{ id: 'att1', studentId: students[0].id, groupId: 'g1', date: '2026-01-05', status: 'absent' }],
    absenceFollowup: [],
    centerProfile: { name: 'سنتر الاختبار', teacherName: 'أ. مدرّس المركز الافتراضي' },
    ...extra,
  });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('AbsenceFollowup — WhatsApp action (V1)', () => {
  it('shows an enabled WhatsApp button for an absent student with a parent phone, and opens WhatsApp with the parent phone + a message identifying the student/group/teacher (not the center name)', () => {
    seedStore([{ id: 's1', name: 'أحمد علي', phone: '01000000000', parentPhone: '01111111111' }]);
    renderPage();

    const btn = screen.getByRole('button', { name: /واتساب/ });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);

    expect(openWhatsapp).toHaveBeenCalledTimes(1);
    const [phone, message] = openWhatsapp.mock.calls[0];
    expect(phone).toBe('01111111111'); // parentPhone preferred over student's own phone
    expect(message).toContain('أحمد علي');
    expect(message).toContain('مجموعة أ');
    expect(message).toContain('أ. محمد سعيد'); // group.teacherName — the session's real teacher
    expect(message).not.toContain('سنتر الاختبار'); // centerProfile.name is no longer the message identity
  });

  it('falls back to centerProfile.teacherName when the group has no teacher assigned', () => {
    seedStore(
      [{ id: 's1', name: 'أحمد علي', phone: '01000000000', parentPhone: '01111111111' }],
      { groups: [{ id: 'g1', name: 'مجموعة أ', teacherName: '' }] },
    );
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /واتساب/ }));
    const [, message] = openWhatsapp.mock.calls[0];
    expect(message).toContain('أ. مدرّس المركز الافتراضي');
  });

  it('falls back to the student phone when parentPhone is missing', () => {
    seedStore([{ id: 's1', name: 'سارة', phone: '01000000000', parentPhone: '' }]);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /واتساب/ }));
    expect(openWhatsapp).toHaveBeenCalledWith('01000000000', expect.any(String));
  });

  it('disables the action with a clear Arabic label when there is no usable phone at all, and never calls openWhatsapp', () => {
    seedStore([{ id: 's1', name: 'مريم', phone: '', parentPhone: '' }]);
    renderPage();

    const btn = screen.getByRole('button', { name: /لا يوجد هاتف/ });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(openWhatsapp).not.toHaveBeenCalled();
  });

  it('shows the existing-style error toast when openWhatsapp reports an invalid phone, without crashing the page', async () => {
    openWhatsapp.mockReturnValueOnce({ ok: false, error: 'رقم هاتف ولي الأمر غير صالح.' });
    seedStore([{ id: 's1', name: 'خالد', phone: '01000000000', parentPhone: 'not-a-phone' }]);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /واتساب/ }));
    expect(await screen.findByText('رقم هاتف ولي الأمر غير صالح.')).toBeInTheDocument();
  });

  it("clicking one student's WhatsApp button only opens that student's message — multiple absent students never trigger multiple opens from a single click", () => {
    seedStore(
      [
        { id: 's1', name: 'طالب أول',  phone: '01000000001', parentPhone: '01111111111' },
        { id: 's2', name: 'طالب ثاني', phone: '01000000002', parentPhone: '01222222222' },
      ],
      {
        attendance: [
          { id: 'att1', studentId: 's1', groupId: 'g1', date: '2026-01-05', status: 'absent' },
          { id: 'att2', studentId: 's2', groupId: 'g1', date: '2026-01-05', status: 'absent' },
        ],
      },
    );
    renderPage();

    const buttons = screen.getAllByRole('button', { name: /واتساب/ });
    expect(buttons).toHaveLength(2); // one action per absent student — no "send to all" button exists

    fireEvent.click(buttons[0]);

    expect(openWhatsapp).toHaveBeenCalledTimes(1);
    expect(openWhatsapp).toHaveBeenCalledWith('01111111111', expect.stringContaining('طالب أول'));
  });

  it('renders and transmits Arabic student names correctly in the generated message (no corruption)', () => {
    seedStore([{ id: 's1', name: 'عبدالرحمن يوسف', phone: '01000000000', parentPhone: '01111111111' }]);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /واتساب/ }));
    const [, message] = openWhatsapp.mock.calls[0];
    expect(message).toContain('عبدالرحمن يوسف');
  });

  it('does not affect the existing follow-up action — its button still opens the follow-up modal', () => {
    seedStore([{ id: 's1', name: 'أحمد', phone: '01000000000', parentPhone: '01111111111' }]);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /متابعة/ }));
    expect(screen.getByText('📞 تسجيل متابعة غياب')).toBeInTheDocument();
    // فتح مودال المتابعة لا يستدعي واتساب إطلاقاً
    expect(openWhatsapp).not.toHaveBeenCalled();
  });
});
