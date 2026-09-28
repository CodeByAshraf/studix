// src/modules/recitation/RecitationPage.test.jsx
// Recitation Assessment — Phase 3 teacher UI. The backend (mocked here) is the sole
// source of truth: every assertion checks what was actually sent to/received from the
// API, not just local state, matching GradeEntry.test.jsx's established convention.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import RecitationPage from './RecitationPage';
import { ToastProvider } from '../../components/Toast';
import { useAppStore } from '../../store/app.store';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return {
    ...actual,
    pgListRecitationSessions: vi.fn(),
    pgGetRecitationSession: vi.fn(),
    pgSaveRecitations: vi.fn(),
    pgCompleteRecitationSession: vi.fn(),
  };
});
import {
  pgListRecitationSessions, pgGetRecitationSession, pgSaveRecitations, pgCompleteRecitationSession,
} from '../../services/api';

vi.mock('./buildRecitationReport', () => ({
  openRecitationSessionReport: vi.fn(),
  openRecitationNotEvaluatedReport: vi.fn(),
  openRecitationSummaryReport: vi.fn(),
}));
import {
  openRecitationSessionReport, openRecitationNotEvaluatedReport, openRecitationSummaryReport,
} from './buildRecitationReport';

// getRecitationContactPhone wraps the REAL implementation (parent phone only) so these page
// tests exercise the actual recipient rule; only the message text and window.open are mocked.
vi.mock('./recitationWhatsappService', async () => {
  const actual = await vi.importActual('./recitationWhatsappService');
  return {
    getRecitationContactPhone: vi.fn(actual.getRecitationContactPhone),
    buildRecitationMessage: vi.fn(() => 'mock message'),
    openWhatsapp: vi.fn(() => ({ ok: true })),
  };
});
import { getRecitationContactPhone, buildRecitationMessage, openWhatsapp } from './recitationWhatsappService';

const GROUP_ID = 'g1';
const DATE = '2026-01-03';

const SESSION_ROW = {
  id: 'sess1', groupId: GROUP_ID, groupName: 'مجموعة أ', date: DATE, sessionTime: '09:00',
  recitationStatus: 'not_started', attendeeCount: 2, evaluatedCount: 0,
};

function makeSessionDetail({ maxScore = null, recitationStatus = 'not_started', roster } = {}) {
  return {
    session: { id: 'sess1', groupId: GROUP_ID, date: DATE, sessionTime: '09:00', maxScore, status: 'completed', recitationStatus },
    group: { id: GROUP_ID, name: 'مجموعة أ' },
    roster: roster || [
      { studentId: 's1', studentName: 'أحمد', studentCode: 'C1', attendanceStatus: 'present', score: null, maxScore: null, note: null, phone: '01099998888', parentPhone: '01011112222' },
      { studentId: 's2', studentName: 'مريم', studentCode: 'C2', attendanceStatus: 'late', score: null, maxScore: null, note: null, phone: '01088887777', parentPhone: null },
    ],
  };
}

function renderPage() {
  return render(
    <ToastProvider>
      <RecitationPage />
    </ToastProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  pgListRecitationSessions.mockResolvedValue([SESSION_ROW]);
  useAppStore.setState({ centerProfile: { name: 'مركز الاختبار', phone1: '0100000000' } });
});

describe('RecitationPage — session picker', () => {
  it('1. renders completed sessions from the API', async () => {
    renderPage();
    expect(await screen.findByText('مجموعة أ')).toBeInTheDocument();
    expect(screen.getByText(DATE, { exact: false })).toBeInTheDocument();
    expect(pgListRecitationSessions).toHaveBeenCalledWith({ limit: 30 });
  });
});

describe('RecitationPage — session detail', () => {
  it('2. selecting a session loads its roster', async () => {
    pgGetRecitationSession.mockResolvedValue(makeSessionDetail());
    renderPage();

    fireEvent.click(await screen.findByText('مجموعة أ'));

    expect(await screen.findByText('أحمد')).toBeInTheDocument();
    expect(screen.getByText('مريم')).toBeInTheDocument();
    expect(pgGetRecitationSession).toHaveBeenCalledWith(GROUP_ID, DATE);
  });

  it('3. only the API-provided roster appears — no extra/global students rendered', async () => {
    pgGetRecitationSession.mockResolvedValue(makeSessionDetail());
    renderPage();
    fireEvent.click(await screen.findByText('مجموعة أ'));
    await screen.findByText('أحمد');

    expect(screen.queryByText('غياب')).not.toBeInTheDocument(); // no absent student ever rendered
    expect(screen.getByTestId('recitation-row-s1')).toBeInTheDocument();
    expect(screen.getByTestId('recitation-row-s2')).toBeInTheDocument();
    expect(screen.queryByTestId('recitation-row-s3')).not.toBeInTheDocument(); // absent student never in the roster
  });

  it('4. max score can be entered before first save (no server value yet)', async () => {
    pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: null }));
    renderPage();
    fireEvent.click(await screen.findByText('مجموعة أ'));
    await screen.findByText('أحمد');

    const input = screen.getByDisplayValue('10'); // sensible UI-only default
    fireEvent.change(input, { target: { value: '20' } });
    expect(input.value).toBe('20');
    expect(pgSaveRecitations).not.toHaveBeenCalled(); // never persisted just by typing
  });

  it('5. an already-established max score is displayed read-only (no input)', async () => {
    pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 20, recitationStatus: 'in_progress' }));
    renderPage();
    fireEvent.click(await screen.findByText('مجموعة أ'));
    await screen.findByText('أحمد');

    expect(screen.getAllByText('20').length).toBeGreaterThan(0);
    expect(screen.queryByRole('spinbutton', { name: /الدرجة من/ })).not.toBeInTheDocument();
  });

  it('6. entering a score works and updates the percentage live', async () => {
    pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 10, recitationStatus: 'in_progress' }));
    renderPage();
    fireEvent.click(await screen.findByText('مجموعة أ'));
    await screen.findByText('أحمد');
    const row = screen.getByTestId('recitation-row-s1');

    const scoreInput = within(row).getByPlaceholderText('—');
    fireEvent.change(scoreInput, { target: { value: '8' } });

    expect(scoreInput.value).toBe('8');
    expect(within(row).getByText('80%')).toBeInTheDocument();
  });

  it('7. an out-of-range score is clamped, never invalid', async () => {
    pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 10, recitationStatus: 'in_progress' }));
    renderPage();
    fireEvent.click(await screen.findByText('مجموعة أ'));
    await screen.findByText('أحمد');
    const row = screen.getByTestId('recitation-row-s1');
    const scoreInput = within(row).getByPlaceholderText('—');

    fireEvent.change(scoreInput, { target: { value: '999' } });
    expect(scoreInput.value).toBe('10'); // clamped to max

    fireEvent.change(scoreInput, { target: { value: '-5' } });
    expect(scoreInput.value).toBe('0'); // clamped to zero
  });

  it('8. All / Not Evaluated / Evaluated filters work', async () => {
    pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 10, recitationStatus: 'in_progress' }));
    renderPage();
    fireEvent.click(await screen.findByText('مجموعة أ'));
    await screen.findByText('أحمد');
    const ahmedRow = screen.getByTestId('recitation-row-s1');
    fireEvent.change(within(ahmedRow).getByPlaceholderText('—'), { target: { value: '5' } });

    fireEvent.click(screen.getByRole('button', { name: 'تم التسميع' }));
    expect(screen.getByText('أحمد')).toBeInTheDocument();
    expect(screen.queryByText('مريم')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'لم يُسمَّع' }));
    expect(screen.queryByText('أحمد')).not.toBeInTheDocument();
    expect(screen.getByText('مريم')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'الكل' }));
    expect(screen.getByText('أحمد')).toBeInTheDocument();
    expect(screen.getByText('مريم')).toBeInTheDocument();
  });

  it('9. student search works', async () => {
    pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 10, recitationStatus: 'in_progress' }));
    renderPage();
    fireEvent.click(await screen.findByText('مجموعة أ'));
    await screen.findByText('أحمد');

    fireEvent.change(screen.getByPlaceholderText('بحث عن طالب...'), { target: { value: 'مريم' } });

    expect(screen.queryByText('أحمد')).not.toBeInTheDocument();
    expect(screen.getByText('مريم')).toBeInTheDocument();
  });

  it('10. progress count updates as scores are entered', async () => {
    pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 10, recitationStatus: 'in_progress' }));
    renderPage();
    fireEvent.click(await screen.findByText('مجموعة أ'));
    await screen.findByText('أحمد');

    expect(screen.getByText('0 / 2')).toBeInTheDocument();

    const ahmedRow = screen.getByTestId('recitation-row-s1');
    fireEvent.change(within(ahmedRow).getByPlaceholderText('—'), { target: { value: '5' } });

    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('11. partial save works — records only include students with an entered score', async () => {
    pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 10, recitationStatus: 'in_progress' }));
    pgSaveRecitations.mockResolvedValue({
      session: { id: 'sess1', groupId: GROUP_ID, date: DATE, maxScore: 10, recitationStatus: 'in_progress' },
      records: [{ studentId: 's1', score: 7, maxScore: 10, note: null }],
    });
    renderPage();
    fireEvent.click(await screen.findByText('مجموعة أ'));
    await screen.findByText('أحمد');
    const ahmedRow = screen.getByTestId('recitation-row-s1');
    fireEvent.change(within(ahmedRow).getByPlaceholderText('—'), { target: { value: '7' } });

    fireEvent.click(screen.getByRole('button', { name: /حفظ$/ }));

    await waitFor(() => expect(pgSaveRecitations).toHaveBeenCalledTimes(1));
    const [gId, d, max, records] = pgSaveRecitations.mock.calls[0];
    expect(gId).toBe(GROUP_ID);
    expect(d).toBe(DATE);
    expect(max).toBe(10);
    expect(records).toEqual([{ studentId: 's1', score: 7, note: undefined }]);
  });

  it('12. Save does not navigate away — session detail stays open', async () => {
    pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 10, recitationStatus: 'in_progress' }));
    pgSaveRecitations.mockResolvedValue({
      session: { id: 'sess1', groupId: GROUP_ID, date: DATE, maxScore: 10, recitationStatus: 'in_progress' },
      records: [],
    });
    renderPage();
    fireEvent.click(await screen.findByText('مجموعة أ'));
    await screen.findByText('أحمد');

    fireEvent.click(screen.getByRole('button', { name: /حفظ$/ }));

    await waitFor(() => expect(pgSaveRecitations).toHaveBeenCalledTimes(1));
    expect(screen.getByText('أحمد')).toBeInTheDocument(); // still on the same screen
  });

  it('13. Save & Complete shows a confirmation before acting', async () => {
    pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 10, recitationStatus: 'in_progress' }));
    renderPage();
    fireEvent.click(await screen.findByText('مجموعة أ'));
    await screen.findByText('أحمد');

    fireEvent.click(screen.getByRole('button', { name: /حفظ واعتماد نهائي/ }));

    expect(await screen.findByText(/سيُصبح تسميع هذه الجلسة دائماً/)).toBeInTheDocument();
    expect(pgCompleteRecitationSession).not.toHaveBeenCalled(); // not yet — only after explicit confirm
  });

  it('14. completing with partial coverage (1/2 evaluated) is allowed', async () => {
    pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 10, recitationStatus: 'in_progress' }));
    pgSaveRecitations.mockResolvedValue({
      session: { id: 'sess1', groupId: GROUP_ID, date: DATE, maxScore: 10, recitationStatus: 'in_progress' },
      records: [{ studentId: 's1', score: 7, maxScore: 10, note: null }],
    });
    pgCompleteRecitationSession.mockResolvedValue({
      id: 'sess1', groupId: GROUP_ID, date: DATE, maxScore: 10, recitationStatus: 'completed', recitationCompletedAt: '2026-01-03T10:00:00Z',
    });
    renderPage();
    fireEvent.click(await screen.findByText('مجموعة أ'));
    await screen.findByText('أحمد');
    const ahmedRow = screen.getByTestId('recitation-row-s1');
    fireEvent.change(within(ahmedRow).getByPlaceholderText('—'), { target: { value: '7' } }); // only 1 of 2 scored

    fireEvent.click(screen.getByRole('button', { name: /حفظ واعتماد نهائي/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'اعتماد وقفل' }));

    await waitFor(() => expect(pgCompleteRecitationSession).toHaveBeenCalledWith(GROUP_ID, DATE));
    expect(pgSaveRecitations).toHaveBeenCalledTimes(1); // saved the 1 pending score first
  });

  it('15. a completed recitation renders fully read-only', async () => {
    pgGetRecitationSession.mockResolvedValue(makeSessionDetail({
      maxScore: 10, recitationStatus: 'completed',
      roster: [{ studentId: 's1', studentName: 'أحمد', studentCode: 'C1', attendanceStatus: 'present', score: 7, maxScore: 10, note: null }],
    }));
    renderPage();
    fireEvent.click(await screen.findByText('مجموعة أ'));
    await screen.findByText('أحمد');

    expect(screen.getByDisplayValue('7')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /حفظ$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /حفظ واعتماد نهائي/ })).not.toBeInTheDocument();
    expect(screen.getByText(/مكتمل ومقفل/)).toBeInTheDocument();
  });

  it('16. a 409 (already completed) save error is shown via the existing toast pattern', async () => {
    pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 10, recitationStatus: 'in_progress' }));
    pgSaveRecitations.mockRejectedValue(new Error('التسميع مكتمل بالفعل لهذه الجلسة — لا يمكن التعديل بعد اكتماله.'));
    renderPage();
    fireEvent.click(await screen.findByText('مجموعة أ'));
    await screen.findByText('أحمد');

    fireEvent.click(screen.getByRole('button', { name: /حفظ$/ }));

    expect(await screen.findByText(/التسميع مكتمل بالفعل/)).toBeInTheDocument();
  });

  it('17. the three print actions each invoke the correct report function with session/group/roster/profile', async () => {
    pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 10, recitationStatus: 'in_progress' }));
    renderPage();
    fireEvent.click(await screen.findByText('مجموعة أ'));
    await screen.findByText('أحمد');

    fireEvent.click(screen.getByRole('button', { name: /طباعة التسميع/ }));
    expect(openRecitationSessionReport).toHaveBeenCalledTimes(1);
    let arg = openRecitationSessionReport.mock.calls[0][0];
    expect(arg.session.groupId).toBe(GROUP_ID);
    expect(arg.group).toEqual({ id: GROUP_ID, name: 'مجموعة أ' });
    expect(arg.roster).toHaveLength(2);
    expect(arg.profile).toEqual({ name: 'مركز الاختبار', phone1: '0100000000' });

    fireEvent.click(screen.getByRole('button', { name: /طباعة غير المقيّمين/ }));
    expect(openRecitationNotEvaluatedReport).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /طباعة الملخص/ }));
    expect(openRecitationSummaryReport).toHaveBeenCalledTimes(1);
  });

  it('18. group name for the print header comes from the API response, not a derived value', async () => {
    pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 10, recitationStatus: 'in_progress' }));
    renderPage();
    fireEvent.click(await screen.findByText('مجموعة أ'));
    await screen.findByText('أحمد');

    // The on-screen header itself must show the API-provided group name, not the raw id.
    expect(screen.getByText(/مجموعة أ/)).toBeInTheDocument();
    expect(screen.queryByText(GROUP_ID)).not.toBeInTheDocument();
  });

  it('19. printing uses the server-reconciled roster, never an unsaved local draft score', async () => {
    pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 10, recitationStatus: 'in_progress' }));
    renderPage();
    fireEvent.click(await screen.findByText('مجموعة أ'));
    await screen.findByText('أحمد');
    const ahmedRow = screen.getByTestId('recitation-row-s1');
    // Enter a score but do NOT save it.
    fireEvent.change(within(ahmedRow).getByPlaceholderText('—'), { target: { value: '9' } });

    fireEvent.click(screen.getByRole('button', { name: /طباعة التسميع/ }));

    const arg = openRecitationSessionReport.mock.calls[0][0];
    const printedAhmed = arg.roster.find((r) => r.studentId === 's1');
    expect(printedAhmed.score).toBeNull(); // still null — the unsaved "9" never reached the print call
    expect(pgSaveRecitations).not.toHaveBeenCalled(); // printing must never trigger a save either
  });

  describe('Recitation WhatsApp', () => {
    const EVALUATED_ROSTER = [
      { studentId: 's1', studentName: 'أحمد', studentCode: 'C1', attendanceStatus: 'present', score: 18, maxScore: 20, note: 'ممتاز', phone: '01099998888', parentPhone: '01011112222' },
      { studentId: 's2', studentName: 'مريم', studentCode: 'C2', attendanceStatus: 'late', score: null, maxScore: null, note: null, phone: '01088887777', parentPhone: null },
      { studentId: 's3', studentName: 'سارة', studentCode: 'C3', attendanceStatus: 'present', score: 15, maxScore: 20, note: null, phone: null, parentPhone: null },
      { studentId: 's4', studentName: 'يوسف', studentCode: 'C4', attendanceStatus: 'present', score: 12, maxScore: 20, note: null, phone: '01077776666', parentPhone: null },
    ];

    it('WhatsApp button is absent for an unevaluated row (score === null), even when the session is locked', async () => {
      pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 20, recitationStatus: 'completed', roster: EVALUATED_ROSTER }));
      renderPage();
      fireEvent.click(await screen.findByText('مجموعة أ'));
      await screen.findByText('أحمد');

      const maryamRow = screen.getByTestId('recitation-row-s2'); // unevaluated
      expect(within(maryamRow).queryByText(/واتساب/)).not.toBeInTheDocument();
    });

    it('WhatsApp button is disabled (not absent) for an evaluated row with no usable phone, using the existing disabled-button convention', async () => {
      pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 20, recitationStatus: 'completed', roster: EVALUATED_ROSTER }));
      renderPage();
      fireEvent.click(await screen.findByText('مجموعة أ'));
      await screen.findByText('أحمد');

      const saraRow = screen.getByTestId('recitation-row-s3'); // evaluated, no phone at all
      const btn = within(saraRow).getByText('📲 لا يوجد رقم ولي أمر');
      expect(btn).toBeDisabled();
    });

    it('no parent phone but a student phone → never falls back to the student: disabled with a clear Arabic label/title, openWhatsapp NOT called', async () => {
      pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 20, recitationStatus: 'completed', roster: EVALUATED_ROSTER }));
      renderPage();
      fireEvent.click(await screen.findByText('مجموعة أ'));
      await screen.findByText('أحمد');

      const yousefRow = screen.getByTestId('recitation-row-s4'); // evaluated, student phone only
      expect(within(yousefRow).queryByText('📲 واتساب')).not.toBeInTheDocument();
      const btn = within(yousefRow).getByText('📲 لا يوجد رقم ولي أمر');
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute('title', 'لا يوجد رقم هاتف لولي الأمر');
      fireEvent.click(btn);
      expect(openWhatsapp).not.toHaveBeenCalled();
    });

    it('WhatsApp button is absent for every row while the session is still draft/in-progress, even for an evaluated student', async () => {
      pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 20, recitationStatus: 'in_progress', roster: EVALUATED_ROSTER }));
      renderPage();
      fireEvent.click(await screen.findByText('مجموعة أ'));
      await screen.findByText('أحمد');

      const ahmedRow = screen.getByTestId('recitation-row-s1'); // evaluated + has phone, but not locked
      expect(within(ahmedRow).queryByText(/واتساب/)).not.toBeInTheDocument();
    });

    it('WhatsApp button appears and is enabled for an evaluated student with a phone, once the session is completed', async () => {
      pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 20, recitationStatus: 'completed', roster: EVALUATED_ROSTER }));
      renderPage();
      fireEvent.click(await screen.findByText('مجموعة أ'));
      await screen.findByText('أحمد');

      const ahmedRow = screen.getByTestId('recitation-row-s1');
      const btn = within(ahmedRow).getByText('📲 واتساب');
      expect(btn).not.toBeDisabled();
    });

    it('clicking WhatsApp calls buildRecitationMessage/openWhatsapp with the SERVER-SAVED score, never an unsaved local draft edit', async () => {
      pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 20, recitationStatus: 'completed', roster: EVALUATED_ROSTER }));
      renderPage();
      fireEvent.click(await screen.findByText('مجموعة أ'));
      await screen.findByText('أحمد');

      const ahmedRow = screen.getByTestId('recitation-row-s1');
      // Attempt to edit the score locally — the session is locked so the input is disabled,
      // but this also proves the WhatsApp click path never reads whatever local state exists.
      const scoreInput = within(ahmedRow).getByDisplayValue('18');
      expect(scoreInput).toBeDisabled();

      fireEvent.click(within(ahmedRow).getByText('📲 واتساب'));

      expect(getRecitationContactPhone).toHaveBeenCalledWith(expect.objectContaining({ studentId: 's1', score: 18, maxScore: 20 }));
      expect(buildRecitationMessage).toHaveBeenCalledWith(expect.objectContaining({
        studentName: 'أحمد', groupName: 'مجموعة أ', score: 18, maxScore: 20, percentage: 90, note: 'ممتاز',
      }));
      expect(openWhatsapp).toHaveBeenCalledWith('01011112222', 'mock message'); // the parent phone, not the student's
    });

    it('never calls pgSaveRecitations as a side effect of sending WhatsApp', async () => {
      pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 20, recitationStatus: 'completed', roster: EVALUATED_ROSTER }));
      renderPage();
      fireEvent.click(await screen.findByText('مجموعة أ'));
      const ahmedRow = await screen.findByTestId('recitation-row-s1');

      fireEvent.click(within(ahmedRow).getByText('📲 واتساب'));

      expect(pgSaveRecitations).not.toHaveBeenCalled();
    });

    it('a failed openWhatsapp result ({ok:false, error}) shows toast.error using the existing toast convention', async () => {
      openWhatsapp.mockReturnValueOnce({ ok: false, error: 'رقم هاتف ولي الأمر غير صالح.' });
      pgGetRecitationSession.mockResolvedValue(makeSessionDetail({ maxScore: 20, recitationStatus: 'completed', roster: EVALUATED_ROSTER }));
      renderPage();
      fireEvent.click(await screen.findByText('مجموعة أ'));
      const ahmedRow = await screen.findByTestId('recitation-row-s1');

      fireEvent.click(within(ahmedRow).getByText('📲 واتساب'));

      expect(await screen.findByText('رقم هاتف ولي الأمر غير صالح.')).toBeInTheDocument();
    });
  });
});
