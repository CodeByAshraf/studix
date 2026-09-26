// src/modules/student-report/StudentReportPage.hwMaterialsFix.test.jsx
// Scalability Architecture Phase 2 — documented pre-existing bug fix bundled into this
// phase: StudentReportPage.jsx's old "fullStore" object (fed into gatherStudentData for
// both the professional PDF report and the WhatsApp summary) never included
// hwSubmissions/invMaterials, even though gatherStudentData reads both. So the printed
// report's "الواجبات" health-score factor was always the hardcoded neutral fallback
// (8/15, from computeHealthScore's own null-branch — already fixed to 0/15 in the earlier
// "no invented positive default" pass) or, with real homework data now flowing through,
// the REAL computed percentage — and every booklet delivery's material name/price/paid/
// remaining was always blank. This file proves the fix against the ACTUAL rendered output
// (the real HTML the print button writes, the real message text the WhatsApp preview
// shows) — not just the intermediate data object (already covered by
// reportData.scopedBundle.test.js).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentReportPage from './StudentReportPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetStudentReportData: vi.fn(), pgCreateWaReportLog: vi.fn() };
});
import { pgGetStudentReportData } from '../../services/api';

const STUDENT_ID = 's1';

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <StudentReportPage />
      </ToastProvider>
    </AuthProvider>
  );
}

function seedStore() {
  useAppStore.setState({
    students: [{
      id: STUDENT_ID, name: 'Test Student', code: 'C1', phone: '0100000000',
      parentPhone: '0111111111', groupId: null, enrollDate: '2026-01-01', monthlyFee: 0,
    }],
    groups: [], attendance: [], absenceFollowup: [], payments: [], exams: [], grades: [],
    homeworks: [], hwSubmissions: [], invMaterials: [], matDist: [], communications: [],
    inventoryTxn: [], centerProfile: {}, waReportLog: [], treasuryTxn: [],
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

// حزمة "حقيقية" فيها واجبات ومذكرات — 3 من 4 واجبات مُسلَّمة (75% → 11/15، رقم مختلف
// تماماً عن القيمة الوهمية القديمة 8/15، لإثبات أنه محسوب فعلاً لا مصادفة رقمية).
const REAL_BUNDLE = {
  students: [{ id: STUDENT_ID, name: 'Test Student', groupId: null, monthlyFee: 0 }],
  groups: [], attendance: [], grades: [], exams: [], payments: [], treasuryTxn: [], communications: [],
  hwSubmissions: [
    { id: 'sub1', homeworkId: 'hw1', studentId: STUDENT_ID, status: 'submitted' },
    { id: 'sub2', homeworkId: 'hw2', studentId: STUDENT_ID, status: 'submitted' },
    { id: 'sub3', homeworkId: 'hw3', studentId: STUDENT_ID, status: 'submitted' },
    { id: 'sub4', homeworkId: 'hw4', studentId: STUDENT_ID, status: 'missing' },
  ],
  inventoryTxn: [{
    id: 'inv1', materialId: 'mat1', type: 'studentDelivery', studentId: STUDENT_ID,
    legacyMetadata: { payStatus: 'partial', paidAmount: 150, receivedAt: '2026-01-05' },
  }],
  invMaterials: [{ id: 'mat1', name: 'مذكرة الرياضيات', price: 200 }],
};

const EMPTY_BUNDLE = {
  students: [{ id: STUDENT_ID, name: 'Test Student', groupId: null, monthlyFee: 0 }],
  groups: [], attendance: [], grades: [], exams: [], payments: [], treasuryTxn: [], communications: [],
  hwSubmissions: [], inventoryTxn: [], invMaterials: [],
};

describe('StudentReportPage — hwSubmissions/invMaterials fix, verified against actual rendered output', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
  });

  it('PRINT: the professional report\'s health-score breakdown shows the real computed homework score (11/15), not the old hardcoded 8/15 fallback', async () => {
    mockWindow();
    pgGetStudentReportData.mockResolvedValue(REAL_BUNDLE);
    renderPage();
    selectStudent();
    fireEvent.click(screen.getByText('⭐ تقرير احترافي (PDF)'));

    await waitFor(() => expect(window.open).toHaveBeenCalled());
    expect(writtenHtml).toContain('الواجبات (11/15)');
    expect(writtenHtml).not.toContain('الواجبات (8/15)');
  });

  it('PRINT: the booklet section shows the real material name, price, paid amount, and remaining balance', async () => {
    mockWindow();
    pgGetStudentReportData.mockResolvedValue(REAL_BUNDLE);
    renderPage();
    selectStudent();
    fireEvent.click(screen.getByText('⭐ تقرير احترافي (PDF)'));

    await waitFor(() => expect(window.open).toHaveBeenCalled());
    expect(writtenHtml).toContain('مذكرة الرياضيات'); // real name — was always null before the fix
    // fmtMoney renders Arabic-Indic digits (confirmed against the actual rendered HTML)
    expect(writtenHtml).toContain('٢٠٠ ج.م'); // price (200)
    expect(writtenHtml).toContain('١٥٠ ج.م'); // paid (150)
    expect(writtenHtml).toContain('٥٠ ج.م');  // remaining (200-150=50)
  });

  it('PRINT: zero-activity student shows 0/15 homework (not 8/15) and the empty-booklets state, not blank/invented content', async () => {
    mockWindow();
    pgGetStudentReportData.mockResolvedValue(EMPTY_BUNDLE);
    renderPage();
    selectStudent();
    fireEvent.click(screen.getByText('⭐ تقرير احترافي (PDF)'));

    await waitFor(() => expect(window.open).toHaveBeenCalled());
    expect(writtenHtml).toContain('الواجبات (0/15)');
    expect(writtenHtml).not.toContain('الواجبات (8/15)');
    expect(writtenHtml).toContain('لا توجد مذكرات مسلّمة');
  });

  it('WHATSAPP: the preview message shows the real booklet material name, not the generic "مذكرة" fallback', async () => {
    pgGetStudentReportData.mockResolvedValue(REAL_BUNDLE);
    renderPage();
    selectStudent();
    fireEvent.click(screen.getByText('📲 إرسال ملخص لولي الأمر'));

    await waitFor(() => expect(pgGetStudentReportData).toHaveBeenCalledWith(STUDENT_ID));
    const modalText = await screen.findByText(/المذكرات المستلمة/);
    expect(modalText.textContent).toContain('مذكرة الرياضيات');
  });

  it('WHATSAPP: zero-activity student produces no booklet section at all in the message (buildBookletMessage returns empty for zero deliveries)', async () => {
    pgGetStudentReportData.mockResolvedValue(EMPTY_BUNDLE);
    renderPage();
    selectStudent();
    fireEvent.click(screen.getByText('📲 إرسال ملخص لولي الأمر'));

    await waitFor(() => expect(pgGetStudentReportData).toHaveBeenCalledWith(STUDENT_ID));
    expect(screen.queryByText(/المذكرات المستلمة/)).not.toBeInTheDocument();
  });
});
