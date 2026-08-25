// src/modules/attendance/AbsenceFollowup.test.jsx
// Phase 3B-8 — نفس عقد ExamsPage/SessionMarking/CommunicationPage: create/update لا
// يغيّران الحالة المحلية قبل نجاح الخادم، ويتبنّيان استجابة الخادم كما هي عند النجاح،
// ويبقيان دون تغيير عند الفشل مع رسالة الخطأ الحقيقية من الخادم.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import AbsenceFollowup from './AbsenceFollowup';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgCreateAbsenceFollowup: vi.fn(), pgUpdateAbsenceFollowup: vi.fn() };
});
import { pgCreateAbsenceFollowup, pgUpdateAbsenceFollowup } from '../../services/api';

const STUDENT_ID = 's1';
const GROUP_ID   = 'g1';
const ATT_ID     = 'att1';

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <AbsenceFollowup />
      </ToastProvider>
    </AuthProvider>
  );
}

function seedStore(extra = {}) {
  useAppStore.setState({
    students:        [{ id: STUDENT_ID, name: 'Test Student', phone: '0100000000', parentPhone: '0111111111' }],
    groups:          [{ id: GROUP_ID, name: 'Test Group' }],
    attendance:      [{ id: ATT_ID, studentId: STUDENT_ID, groupId: GROUP_ID, date: '2026-01-01', status: 'absent' }],
    absenceFollowup: [],
    ...extra,
  });
}

// يفتح المودال عبر زر الإجراء في الصف — "⚡ متابعة" لو لا يوجد followup، أو "✎ تعديل" لو موجود
function openModal() {
  fireEvent.click(screen.getByRole('button', { name: /متابعة|تعديل/ }));
}

function modalBody() {
  return document.querySelector('.modal-body');
}

describe('AbsenceFollowup — server-truth write path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
  });

  it('create: sends only the DB-backed fields (no id/studentId/date), does not touch local state before the backend resolves, then adopts the server response verbatim (including its server-issued id)', async () => {
    let resolveCall;
    pgCreateAbsenceFollowup.mockImplementation(() => new Promise((resolve) => { resolveCall = resolve; }));

    renderPage();
    openModal();

    fireEvent.click(within(modalBody()).getByRole('button', { name: /غياب مبرر/ })); // excused
    fireEvent.click(within(modalBody()).getByRole('button', { name: /حفظ المتابعة/ }));

    expect(pgCreateAbsenceFollowup).toHaveBeenCalledTimes(1);
    const sentPayload = pgCreateAbsenceFollowup.mock.calls[0][0];

    expect(sentPayload).toEqual({
      attendanceId:      ATT_ID,
      absenceReason:     '',
      parentContactedUs: false,
      followedBy:        '',
      followedAt:        expect.any(String),
      followStatus:      'excused',
      notes:              '',
    });
    expect(sentPayload.id).toBeUndefined();
    expect(sentPayload.studentId).toBeUndefined();
    expect(sentPayload.date).toBeUndefined();

    // لا تعديل محلي قبل نجاح الخادم
    expect(useAppStore.getState().absenceFollowup).toEqual([]);

    const saved = {
      id: 'srv-uuid-1', attendanceId: ATT_ID, absenceReason: '', parentContactedUs: false,
      followedBy: '', followedAt: sentPayload.followedAt, followStatus: 'excused', notes: '',
    };
    resolveCall(saved);

    await waitFor(() => {
      expect(useAppStore.getState().absenceFollowup).toEqual([saved]);
    });
  });

  it('create failure: leaves local state untouched and shows the real server error', async () => {
    pgCreateAbsenceFollowup.mockRejectedValueOnce(new Error('انتهاك مفتاح خارجي (سجل مرتبط غير موجود).'));

    renderPage();
    openModal();
    fireEvent.click(within(modalBody()).getByRole('button', { name: /حفظ المتابعة/ }));

    expect(await screen.findByText('انتهاك مفتاح خارجي (سجل مرتبط غير موجود).')).toBeInTheDocument();
    expect(useAppStore.getState().absenceFollowup).toEqual([]);
    expect(pgCreateAbsenceFollowup).toHaveBeenCalledTimes(1);
  });

  it('update: calls pgUpdateAbsenceFollowup(existing.id, payload), never pgCreateAbsenceFollowup, and adopts the server response verbatim', async () => {
    const existing = {
      id: 'srv-existing-1', attendanceId: ATT_ID, absenceReason: 'مرض', parentContactedUs: false,
      followedBy: 'Reception', followedAt: '2026-01-01T10:00:00.000Z', followStatus: 'contacted', notes: '',
    };
    seedStore({ absenceFollowup: [existing] });

    const saved = { ...existing, followStatus: 'unexcused', notes: 'محدث' };
    pgUpdateAbsenceFollowup.mockResolvedValueOnce(saved);

    renderPage();
    openModal(); // فيه followup موجود بالفعل → زر "✎ تعديل"

    fireEvent.click(within(modalBody()).getByRole('button', { name: /غياب غير مبرر/ })); // unexcused
    fireEvent.change(within(modalBody()).getByPlaceholderText('تفاصيل المكالمة أو الملاحظات...'), { target: { value: 'محدث' } });
    fireEvent.click(within(modalBody()).getByRole('button', { name: /حفظ المتابعة/ }));

    expect(pgCreateAbsenceFollowup).not.toHaveBeenCalled();
    await waitFor(() => expect(pgUpdateAbsenceFollowup).toHaveBeenCalledTimes(1));
    expect(pgUpdateAbsenceFollowup).toHaveBeenCalledWith(
      existing.id,
      expect.objectContaining({ attendanceId: ATT_ID, followStatus: 'unexcused', notes: 'محدث' }),
    );

    await waitFor(() => {
      expect(useAppStore.getState().absenceFollowup).toEqual([saved]);
    });
  });

  it('update failure: leaves the existing local record untouched and shows the real server error', async () => {
    const existing = {
      id: 'srv-existing-1', attendanceId: ATT_ID, absenceReason: 'مرض', parentContactedUs: false,
      followedBy: 'Reception', followedAt: '2026-01-01T10:00:00.000Z', followStatus: 'contacted', notes: '',
    };
    seedStore({ absenceFollowup: [existing] });
    pgUpdateAbsenceFollowup.mockRejectedValueOnce(new Error('السجل غير موجود.'));

    renderPage();
    openModal();
    fireEvent.click(within(modalBody()).getByRole('button', { name: /حفظ المتابعة/ }));

    expect(await screen.findByText('السجل غير موجود.')).toBeInTheDocument();
    expect(useAppStore.getState().absenceFollowup).toEqual([existing]);
  });
});

describe.each([
  ['pending',   'لم تتم المتابعة'],
  ['contacted', 'تم التواصل'],
  ['excused',   'غياب مبرر'],
  ['unexcused', 'غياب غير مبرر'],
])('AbsenceFollowup — followStatus = %s', (value, label) => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
  });

  it(`is sent to the server exactly as selected ("${label}")`, async () => {
    pgCreateAbsenceFollowup.mockResolvedValueOnce({
      id: `srv-${value}`, attendanceId: ATT_ID, followStatus: value,
      absenceReason: '', parentContactedUs: false, followedBy: '', followedAt: new Date().toISOString(), notes: '',
    });

    renderPage();
    openModal();
    fireEvent.click(within(modalBody()).getByRole('button', { name: new RegExp(label) }));
    fireEvent.click(within(modalBody()).getByRole('button', { name: /حفظ المتابعة/ }));

    await waitFor(() => {
      expect(pgCreateAbsenceFollowup).toHaveBeenCalledWith(expect.objectContaining({ followStatus: value }));
    });
  });
});
