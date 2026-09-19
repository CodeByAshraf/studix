// src/modules/homework/HomeworkSearch.whatsapp.test.jsx
// Homework Phase 3B — per-row WhatsApp parent follow-up on the Homework Search screen
// (Phase 3A). Must follow the Student Report two-step preview→open pattern (NOT the
// Attendance direct-open pattern) — WhatsApp must never open before the user explicitly
// reviews the message in WhatsappPreviewModal and clicks its own "فتح واتساب" button.
// openWhatsapp is mocked (not real window.open), same technique as
// AbsenceFollowup.whatsapp.test.jsx / StudentReportPage.waReportLog.test.jsx.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import HomeworkSearch from './HomeworkSearch';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

function renderSearch() {
  return render(<ToastProvider><HomeworkSearch /></ToastProvider>);
}

vi.mock('./homeworkWhatsappService', async () => {
  const actual = await vi.importActual('./homeworkWhatsappService');
  return { ...actual, openWhatsapp: vi.fn(() => ({ ok: true, url: 'https://wa.me/x' })) };
});
import { openWhatsapp } from './homeworkWhatsappService';

const GRADE_6 = 'الصف السادس الابتدائي';
const HW = { id: 'hw1', title: 'واجب الجبر', subject: 'رياضيات', grade: GRADE_6, academicYear: '2025/2026', totalScore: 20, dueDate: '2026-03-10', status: 'active', groupId: 'g1' };

const S1_GRADED   = { id: 's1', name: 'أحمد علي',  code: 'C001', grade: GRADE_6, status: 'active', parentPhone: '01111111111', phone: '01000000001' };
const S2_NO_PHONE = { id: 's2', name: 'سارة محمد', code: 'C002', grade: GRADE_6, status: 'active', parentPhone: '', phone: '' };

function seed() {
  useAppStore.setState({
    homeworks: [HW],
    students: [S1_GRADED, S2_NO_PHONE],
    hwSubmissions: [
      { hwId: 'hw1', studentId: 's1', status: 'submitted', submittedAt: '2026-03-09', score: 18, notes: '' },
      // s2: no submission row -> missing
    ],
    centerProfile: { name: 'م خالد جمعه' },
  });
}

function waButtonForRow(name) {
  const row = screen.getByText(name).closest('tr');
  return within(row).getByRole('button', { name: /📲/ });
}

describe('HomeworkSearch — WhatsApp parent follow-up (Homework Phase 3B)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('clicking the WhatsApp action opens a preview first — openWhatsapp is NOT called immediately', () => {
    seed();
    renderSearch();

    fireEvent.click(waButtonForRow('أحمد علي'));

    expect(screen.getByText('📲 معاينة رسالة ولي الأمر')).toBeInTheDocument();
    expect(openWhatsapp).not.toHaveBeenCalled();
  });

  it('only calls openWhatsapp after the user explicitly clicks the modal\'s own "فتح واتساب" button', () => {
    seed();
    renderSearch();

    fireEvent.click(waButtonForRow('أحمد علي'));
    fireEvent.click(screen.getByRole('button', { name: /فتح واتساب/ }));

    expect(openWhatsapp).toHaveBeenCalledTimes(1);
    const [phone, message] = openWhatsapp.mock.calls[0];
    expect(phone).toBe('01111111111');
    expect(message).toContain('أحمد علي');
    expect(message).toContain('واجب الجبر');
    expect(message).toContain('18/20'); // submitted + graded — real score
  });

  it('passes the correct, row-specific data into the message — not another row\'s data', () => {
    seed();
    // Give s2 her own usable phone here so the modal's open action isn't disabled — the
    // dedicated "no usable phone" test below covers that case separately.
    useAppStore.setState({ students: [S1_GRADED, { ...S2_NO_PHONE, phone: '01099998888' }] });
    renderSearch();

    fireEvent.click(waButtonForRow('سارة محمد'));
    fireEvent.click(screen.getByRole('button', { name: /فتح واتساب/ }));

    const [, message] = openWhatsapp.mock.calls[0];
    expect(message).toContain('سارة محمد');
    expect(message).toMatch(/لم يتم تسليم/); // s2 has no submission -> missing
    expect(message).not.toContain('أحمد علي');
    expect(message).not.toContain('18/20');
  });

  it('a student with no usable phone still gets a preview, but the WhatsApp-open action is disabled (copy remains available)', () => {
    seed();
    renderSearch();

    fireEvent.click(waButtonForRow('سارة محمد'));

    expect(screen.getByText('📲 معاينة رسالة ولي الأمر')).toBeInTheDocument();
    const openBtn = screen.getByRole('button', { name: /فتح واتساب/ });
    expect(openBtn).toBeDisabled();
    expect(screen.getByRole('button', { name: /نسخ الرسالة/ })).not.toBeDisabled();

    fireEvent.click(openBtn);
    expect(openWhatsapp).not.toHaveBeenCalled();
  });

  it('closing the preview without opening WhatsApp never calls openWhatsapp', () => {
    seed();
    renderSearch();

    fireEvent.click(waButtonForRow('أحمد علي'));
    fireEvent.click(screen.getByRole('button', { name: '✕' }));

    expect(screen.queryByText('📲 معاينة رسالة ولي الأمر')).not.toBeInTheDocument();
    expect(openWhatsapp).not.toHaveBeenCalled();
  });
});

describe('HomeworkSearch — WhatsApp action visibility (Phase 3B clarification: only Not-Submitted and Graded/Score)', () => {
  const S3_SUBMITTED_UNGRADED = { id: 's3', name: 'خالد سعيد', code: 'C003', grade: GRADE_6, status: 'active', parentPhone: '01133333333' };
  const S4_LATE_UNGRADED      = { id: 's4', name: 'منى فتحي',  code: 'C004', grade: GRADE_6, status: 'active', parentPhone: '01144444444' };
  const S5_LATE_GRADED        = { id: 's5', name: 'ليلى أحمد', code: 'C005', grade: GRADE_6, status: 'active', parentPhone: '01155555555' };

  function seedVisibility() {
    useAppStore.setState({
      homeworks: [HW],
      students: [S1_GRADED, S2_NO_PHONE, S3_SUBMITTED_UNGRADED, S4_LATE_UNGRADED, S5_LATE_GRADED],
      hwSubmissions: [
        { hwId: 'hw1', studentId: 's1', status: 'submitted', submittedAt: '2026-03-09', score: 18, notes: '' }, // graded -> shown
        // s2: no submission -> missing -> shown
        { hwId: 'hw1', studentId: 's3', status: 'submitted', submittedAt: '2026-03-09', score: null, notes: '' }, // submitted, ungraded -> hidden
        { hwId: 'hw1', studentId: 's4', status: 'late',      submittedAt: '2026-03-12', score: null, notes: '' }, // late, ungraded -> hidden
        { hwId: 'hw1', studentId: 's5', status: 'late',      submittedAt: '2026-03-12', score: 10,   notes: '' }, // late, graded -> shown
      ],
      centerProfile: { name: 'م خالد جمعه' },
    });
  }

  it('shows the WhatsApp action for Not Submitted and for a graded submission (submitted or late)', () => {
    seedVisibility();
    renderSearch();
    expect(waButtonForRow('أحمد علي')).toBeInTheDocument(); // submitted + graded
    expect(waButtonForRow('سارة محمد')).toBeInTheDocument(); // missing
    expect(waButtonForRow('ليلى أحمد')).toBeInTheDocument(); // late + graded
  });

  it('hides the WhatsApp action for submitted-but-ungraded and late-but-ungraded rows', () => {
    seedVisibility();
    renderSearch();
    const khaledRow = screen.getByText('خالد سعيد').closest('tr');
    const monaRow    = screen.getByText('منى فتحي').closest('tr');
    expect(within(khaledRow).queryByRole('button', { name: /📲/ })).not.toBeInTheDocument();
    expect(within(monaRow).queryByRole('button', { name: /📲/ })).not.toBeInTheDocument();
  });
});
