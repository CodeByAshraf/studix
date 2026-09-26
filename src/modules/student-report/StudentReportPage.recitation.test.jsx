// src/modules/student-report/StudentReportPage.recitation.test.jsx
// Recitation → Student Professional Report integration — on-screen tab (visibility +
// placement) and Simple Print ("🖨 طباعة / PDF") section behavior. The professional PDF
// path's section-toggle coverage lives in StudentReportPage.reportConfig.test.jsx (TITLE
// map extended there with showRecitation, reusing its existing loop-based assertions —
// no separate PDF test needed here per that file's own established convention).
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import StudentReportPage from './StudentReportPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';
import { DEFAULT_REPORT_CONFIG } from '../../reportEngine/reportMeta';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetStudentReportData: vi.fn() };
});
import { pgGetStudentReportData } from '../../services/api';

const STUDENT_ID = 's1';
const STUDENT = {
  id: STUDENT_ID, name: 'Test Student', code: 'C1', phone: '0100000000',
  parentPhone: '0111111111', groupId: null, enrollDate: '2026-01-01', monthlyFee: 1000,
};

const RECITATIONS = [
  { id: 'r1', sessionId: 'sess1', studentId: STUDENT_ID, groupId: 'g1', groupName: 'مجموعة أ', date: '2026-01-10', sessionTime: '10:00', score: 18, maxScore: 20, note: 'ممتاز' },
  { id: 'r2', sessionId: 'sess2', studentId: STUDENT_ID, groupId: 'g1', groupName: 'مجموعة أ', date: '2026-01-03', sessionTime: '09:00', score: 7, maxScore: 10, note: null },
];

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <StudentReportPage />
      </ToastProvider>
    </AuthProvider>
  );
}

function seed({ reportConfig = {}, recitations = [] } = {}) {
  useAppStore.setState({
    students: [STUDENT],
    groups: [], attendance: [], absenceFollowup: [], payments: [], exams: [], grades: [],
    homeworks: [], hwSubmissions: [], invMaterials: [], matDist: [], communications: [],
    inventoryTxn: [], centerProfile: {}, waReportLog: [], treasuryTxn: [], parents: [], enrollments: [],
    admissions: [],
    reportConfig: { ...DEFAULT_REPORT_CONFIG, ...reportConfig },
  });
  pgGetStudentReportData.mockResolvedValue({
    students: [STUDENT], groups: [], attendance: [], hwSubmissions: [], homeworks: [],
    grades: [], exams: [], payments: [], treasuryTxn: [], communications: [],
    inventoryTxn: [], invMaterials: [], parents: [], enrollments: [], admissions: [],
    recitations,
  });
}

function selectStudent() {
  fireEvent.change(screen.getByPlaceholderText('ابحث باسم الطالب أو الكود أو رقم الهاتف...'), {
    target: { value: 'Test Student' },
  });
  fireEvent.click(screen.getByText('Test Student'));
}

let writtenHtml;
function mockWindow() {
  writtenHtml = '';
  const win = { document: { open: vi.fn(), write: vi.fn((html) => { writtenHtml += html; }), close: vi.fn() }, focus: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(win);
  return win;
}

describe('StudentReportPage — Recitation tab (on-screen)', () => {
  beforeEach(() => { mockWindow(); vi.clearAllMocks(); });

  it('showRecitation=true: the tab is visible', async () => {
    seed({ recitations: RECITATIONS });
    renderPage();
    selectStudent();
    await screen.findByText('ملخص الحضور');

    expect(screen.getByText('🎤 التسميع')).toBeInTheDocument();
  });

  it('showRecitation=false: the tab is hidden', async () => {
    seed({ reportConfig: { showRecitation: false }, recitations: RECITATIONS });
    renderPage();
    selectStudent();
    await screen.findByText('ملخص الحضور');

    expect(screen.queryByText('🎤 التسميع')).not.toBeInTheDocument();
  });

  it('tab placement: Recitation appears immediately after Exams and before Homework', async () => {
    seed({ recitations: RECITATIONS });
    renderPage();
    selectStudent();
    await screen.findByText('ملخص الحضور');

    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    const examsIdx      = buttons.indexOf('📝 الامتحانات');
    const recitationIdx = buttons.indexOf('🎤 التسميع');
    const homeworksIdx  = buttons.indexOf('📋 الواجبات');
    expect(examsIdx).toBeGreaterThanOrEqual(0);
    expect(recitationIdx).toBeGreaterThan(examsIdx);
    expect(homeworksIdx).toBeGreaterThan(recitationIdx);
  });

  it('clicking the tab shows every historical recitation record as its own row, with date/group/session time/score/max/percentage/note', async () => {
    seed({ recitations: RECITATIONS });
    renderPage();
    selectStudent();
    await screen.findByText('ملخص الحضور');
    fireEvent.click(screen.getByText('🎤 التسميع'));

    expect(await screen.findAllByText('مجموعة أ')).toHaveLength(2); // one row per historical session
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText('09:00')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument(); // 18/20
    expect(screen.getByText('70%')).toBeInTheDocument(); // 7/10
    expect(screen.getByText('ممتاز')).toBeInTheDocument();
  });

  it('no recitation records: shows the existing empty-state convention, not a crash or blank tab', async () => {
    seed({ recitations: [] });
    renderPage();
    selectStudent();
    await screen.findByText('ملخص الحضور');
    fireEvent.click(screen.getByText('🎤 التسميع'));

    expect(await screen.findByText('لا توجد جلسات تسميع مسجّلة')).toBeInTheDocument();
  });
});

describe('StudentReportPage — Recitation in Simple Print ("🖨 طباعة / PDF")', () => {
  beforeEach(() => { mockWindow(); vi.clearAllMocks(); });

  it('populated: the printed report includes the recitation section with correct data', async () => {
    seed({ recitations: RECITATIONS });
    renderPage();
    selectStudent();
    await screen.findByText('ملخص الحضور');
    fireEvent.click(screen.getByText('🖨 طباعة / PDF'));

    await waitFor(() => expect(writtenHtml).toContain('التسميع'));
    expect(writtenHtml).toContain('مجموعة أ');
    expect(writtenHtml).toContain('90%');
    expect(writtenHtml).toContain('70%');
  });

  it('empty-state: no recitation records means the section is omitted entirely, matching examsHTML\'s own convention', async () => {
    seed({ recitations: [] });
    renderPage();
    selectStudent();
    await screen.findByText('ملخص الحضور');
    fireEvent.click(screen.getByText('🖨 طباعة / PDF'));

    await waitFor(() => expect(writtenHtml.length).toBeGreaterThan(0));
    expect(writtenHtml).not.toContain('جلسات تسميع');
  });

  it('showRecitation=false: the dedicated recitation section is excluded from the print even with data present (the always-on academic timeline may still reference the group name — same established behavior as showExams — so this checks the recitation table\'s own percentage marker instead)', async () => {
    seed({ reportConfig: { showRecitation: false }, recitations: RECITATIONS });
    renderPage();
    selectStudent();
    await screen.findByText('ملخص الحضور');
    fireEvent.click(screen.getByText('🖨 طباعة / PDF'));

    await waitFor(() => expect(writtenHtml.length).toBeGreaterThan(0));
    expect(writtenHtml).not.toContain('90%'); // only the recitation table renders a bare percentage like this
    expect(writtenHtml).not.toContain('ممتاز'); // the note, only shown in the recitation table
  });
});
