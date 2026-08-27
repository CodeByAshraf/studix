// src/modules/student-report/StudentReportPage.reportConfig.test.jsx
// New feature — Student Report configuration (Settings → أقسام تقرير الطالب الاحترافي).
// Renders the REAL StudentReportPage and clicks the REAL "⭐ تقرير احترافي (PDF)" button
// (same technique already proven in buildPrintReport.test.jsx for the sibling "🖨 طباعة /
// PDF" button) — proving the actual wiring: reportConfig (store) -> StudentReportPage.jsx
// -> generateStudentReport() -> buildStudentReport.js's section gating, not a hand-called
// function bypassing the real integration point.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentReportPage from './StudentReportPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';
import { DEFAULT_REPORT_CONFIG } from '../../reportEngine/reportMeta';
import { openStudentReportPrint } from './buildPrintReport';
import { generateMessage } from './studentWhatsappService';

const STUDENT_ID = 's1';

// Exact SectionHeader titles as they appear in buildStudentReport.js — used to assert a
// section's real presence/absence in the rendered report HTML, not an implementation detail.
const TITLE = {
  showSnapshot:         'الملخّص التنفيذي',
  showHealthScore:      'درجة الصحة الأكاديمية',
  showProfile:          'بيانات الطالب',
  showFinancials:       'الملخّص المالي',
  showAttendance:       'تحليل الحضور',
  showExams:            'أداء الامتحانات',
  showPayments:         'سجل المدفوعات',
  showCommunication:    'سجل التواصل',
  showAcademicTimeline: 'الخط الزمني الأكاديمي',
  showBooklets:         'سجل المذكرات',
  showCharts:           'الرسوم البيانية',
  showEvaluation:       'الملخّص التنفيذي الذكي',
};

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <StudentReportPage />
      </ToastProvider>
    </AuthProvider>
  );
}

function seed({ payments = [], treasuryTxn = [], reportConfig = {}, attendance = [], exams = [], grades = [], communications = [], inventoryTxn = [] } = {}) {
  useAppStore.setState({
    students: [{
      id: STUDENT_ID, name: 'Test Student', code: 'C1', phone: '0100000000',
      parentPhone: '0111111111', groupId: null, enrollDate: '2026-01-01', monthlyFee: 1000,
    }],
    groups: [], attendance, absenceFollowup: [], payments, exams, grades,
    homeworks: [], hwSubmissions: [], invMaterials: [], matDist: [], communications,
    inventoryTxn, centerProfile: {}, waReportLog: [], treasuryTxn,
    reportConfig: { ...DEFAULT_REPORT_CONFIG, ...reportConfig },
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

function clickProfessionalReport() {
  fireEvent.click(screen.getByText('⭐ تقرير احترافي (PDF)'));
}

const ALL_SAMPLE_DATA = {
  payments: [{ id: 'p1', studentId: STUDENT_ID, amount: 1000, month: 1, year: 2026, date: '2026-01-05', status: 'paid', method: 'cash' }],
  attendance: [{ id: 'a1', studentId: STUDENT_ID, date: '2026-01-05', status: 'present' }],
  exams: [{ id: 'e1', groupId: null, name: 'اختبار 1', date: '2026-01-05', total: 100 }],
  grades: [{ id: 'g1', examId: 'e1', studentId: STUDENT_ID, score: 90 }],
};

describe('Student Report configuration — default behavior is unchanged', () => {
  beforeEach(() => { mockWindow(); });

  it('with no saved config (defaults), every section renders exactly as before this feature', () => {
    seed(ALL_SAMPLE_DATA);
    renderPage();
    selectStudent();
    clickProfessionalReport();

    for (const title of Object.values(TITLE)) {
      expect(writtenHtml).toContain(title);
    }
  });
});

describe('Student Report configuration — disabling sections', () => {
  beforeEach(() => { mockWindow(); });

  it('disabling exactly one section removes only that section, every other section still renders', () => {
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showCharts: false } });
    renderPage();
    selectStudent();
    clickProfessionalReport();

    expect(writtenHtml).not.toContain(TITLE.showCharts);
    for (const [key, title] of Object.entries(TITLE)) {
      if (key === 'showCharts') continue;
      expect(writtenHtml).toContain(title);
    }
  });

  it('disabling multiple sections removes exactly those sections, nothing else', () => {
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showCharts: false, showCommunication: false, showBooklets: false } });
    renderPage();
    selectStudent();
    clickProfessionalReport();

    expect(writtenHtml).not.toContain(TITLE.showCharts);
    expect(writtenHtml).not.toContain(TITLE.showCommunication);
    expect(writtenHtml).not.toContain(TITLE.showBooklets);
    for (const [key, title] of Object.entries(TITLE)) {
      if (['showCharts', 'showCommunication', 'showBooklets'].includes(key)) continue;
      expect(writtenHtml).toContain(title);
    }
  });

  it('Health Score and AI Summary are independently toggleable (previously both tied to a single flag)', () => {
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showHealthScore: false } });
    renderPage();
    selectStudent();
    clickProfessionalReport();

    expect(writtenHtml).not.toContain(TITLE.showHealthScore);
    expect(writtenHtml).toContain(TITLE.showEvaluation); // AI Summary still renders — no longer coupled
  });

  it('re-enabling a previously-disabled section restores it', () => {
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showCharts: false } });
    renderPage();
    selectStudent();
    clickProfessionalReport();
    expect(writtenHtml).not.toContain(TITLE.showCharts);

    // Re-enable directly through the store's real action (same one the Settings UI calls)
    // — wrapped in act() so StudentReportPage's subscription re-renders (and its onClick
    // closure picks up the new reportConfig) before the next click, same as a real user
    // toggling the Settings switch and then clicking the report button.
    act(() => { useAppStore.getState().setReportConfig({ showCharts: true }); });
    writtenHtml = '';
    clickProfessionalReport();
    expect(writtenHtml).toContain(TITLE.showCharts);
  });
});

describe('Student Report configuration — existing calculations remain unchanged', () => {
  beforeEach(() => { mockWindow(); });

  it('a refund is still netted correctly in the Financials section (BUG-02 contract, unaffected by the new config wiring)', () => {
    seed({
      ...ALL_SAMPLE_DATA,
      payments: [{ id: 'p1', studentId: STUDENT_ID, amount: 1000, month: 1, year: 2026, date: '2026-01-05', status: 'paid', method: 'cash' }],
      treasuryTxn: [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    });
    renderPage();
    selectStudent();
    clickProfessionalReport();

    // netPaid = 1000 - 300 = 700 ج.م — same computation reportData.js/getRefundedAmount
    // already proved elsewhere (StudentReportPage.grossNet.test.jsx), just confirming this
    // report pipeline still reflects it after the config split.
    expect(writtenHtml).toContain('700');
    expect(writtenHtml).toContain('المسترد');
  });

  it('the exam score/percentage still appears correctly when Exams is enabled', () => {
    seed(ALL_SAMPLE_DATA);
    renderPage();
    selectStudent();
    clickProfessionalReport();

    expect(writtenHtml).toContain('اختبار 1');
    expect(writtenHtml).toContain('90'); // score
  });
});

describe('Student Report configuration — empty-data behavior remains safe', () => {
  beforeEach(() => { mockWindow(); });

  it('a student with zero records anywhere does not crash the professional report, with every section enabled', () => {
    seed({}); // no payments/attendance/exams/grades/communications/inventoryTxn at all
    renderPage();
    selectStudent();

    expect(() => clickProfessionalReport()).not.toThrow();
    expect(writtenHtml.length).toBeGreaterThan(0);
    // Empty-state text already produced by the untouched section builders (DataTable's
    // emptyText) — confirms sections still self-render safely, not silently broken.
    expect(writtenHtml).toContain('لا توجد امتحانات مسجّلة');
    expect(writtenHtml).toContain('لا توجد مدفوعات');
  });

  it('a student with zero records does not crash even with several sections disabled', () => {
    seed({ reportConfig: { showCharts: false, showBooklets: false, showCommunication: false } });
    renderPage();
    selectStudent();

    expect(() => clickProfessionalReport()).not.toThrow();
    expect(writtenHtml).not.toContain(TITLE.showCharts);
  });
});

describe('Student Report configuration — the Simple Print report and WhatsApp summary are unaffected', () => {
  it('openStudentReportPrint (🖨 طباعة / PDF) still renders normally with several report-config sections disabled', () => {
    mockWindow();
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showCharts: false, showPayments: false, showAttendance: false } });
    renderPage();
    selectStudent();
    fireEvent.click(screen.getByText('🖨 طباعة / PDF'));

    // openStudentReportPrint({ student, group, data, profile }) — no config parameter at
    // all (confirmed by reading buildPrintReport.js) — its own fixed sections render
    // regardless of reportConfig's state.
    expect(writtenHtml).toContain('إجمالي المدفوع');
    cleanup();
  });

  it('openStudentReportPrint (🖨 طباعة / PDF) produces the same section under the default config, for comparison', () => {
    mockWindow();
    seed({ ...ALL_SAMPLE_DATA }); // default config
    renderPage();
    selectStudent();
    fireEvent.click(screen.getByText('🖨 طباعة / PDF'));

    expect(writtenHtml).toContain('إجمالي المدفوع');
  });

  it('generateMessage (WhatsApp summary) has no config parameter and is unaffected by reportConfig', () => {
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showFinancials: false, showAttendance: false, showExams: false } });
    const store = useAppStore.getState();
    // generateMessage(studentId, store, { profile, type }) — reads directly from the raw
    // store slices (students/payments/attendance/...), never reportConfig.
    const result = generateMessage(STUDENT_ID, store, { profile: {} });
    expect(result).not.toBeNull();
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
  });
});
