// src/modules/student-report/StudentReportPage.reportConfig.test.jsx
// New feature — Student Report configuration (Settings → أقسام تقرير الطالب الاحترافي).
// Renders the REAL StudentReportPage and clicks the REAL "⭐ تقرير احترافي (PDF)" button
// (same technique already proven in buildPrintReport.test.jsx for the sibling "🖨 طباعة /
// PDF" button) — proving the actual wiring: reportConfig (store) -> StudentReportPage.jsx
// -> generateStudentReport() -> buildStudentReport.js's section gating, not a hand-called
// function bypassing the real integration point.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentReportPage from './StudentReportPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';
import { DEFAULT_REPORT_CONFIG } from '../../reportEngine/reportMeta';
import { openStudentReportPrint } from './buildPrintReport';
import { generateMessage } from './studentWhatsappService';

// Scalability Architecture Phase 2 — "⭐ تقرير احترافي" now fetches the student's scoped
// report-data bundle (GET /students/:id/report-data) before calling generateStudentReport,
// instead of reading a locally-assembled store object synchronously. Mocked here to mirror
// whatever the current test's seed() just put in the store (single-student fixtures, no
// cross-student scoping to verify here — that's covered by studentReport.integration.test.js
// and reportData.scopedBundle.test.js), so every existing assertion on the rendered report's
// content keeps working unchanged.
vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetStudentReportData: vi.fn() };
});
import { pgGetStudentReportData } from '../../services/api';

function mockScopedBundleFromStore() {
  pgGetStudentReportData.mockImplementation(async () => {
    const s = useAppStore.getState();
    return {
      students: s.students, groups: s.groups, attendance: s.attendance, hwSubmissions: s.hwSubmissions,
      grades: s.grades, exams: s.exams, payments: s.payments, treasuryTxn: s.treasuryTxn,
      communications: s.communications, inventoryTxn: s.inventoryTxn, invMaterials: s.invMaterials,
      // Professional Report audit fix (Phase 1) — homeworks/parents/enrollments now part of
      // the real backend bundle (backend/src/routes/studentReport.js); added here so this
      // mock mirrors it, same principle as every other key above.
      homeworks: s.homeworks, parents: s.parents, enrollments: s.enrollments,
      // Student Report Phase 2 — admissions now part of the real backend bundle
      // (backend/src/routes/studentReport.js); mirrored here for the same reason as above.
      admissions: s.admissions,
    };
  });
}

const STUDENT_ID = 's1';

// Exact SectionHeader titles as they appear in buildStudentReport.js — used to assert a
// section's real presence/absence in the rendered report HTML, not an implementation detail.
const TITLE = {
  showSnapshot:         'الملخّص التنفيذي',
  showHealthScore:      'درجة الصحة الأكاديمية',
  showProfile:          'بيانات الطالب',
  showFinancialSummary: 'الملخّص المالي',
  showAttendance:       'تحليل الحضور',
  showExams:            'أداء الامتحانات',
  showRecitation:       'أداء التسميع',
  showPaymentHistory:   'سجل المدفوعات',
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

function seed({
  payments = [], treasuryTxn = [], reportConfig = {}, attendance = [], exams = [], grades = [],
  communications = [], inventoryTxn = [], groups = [], homeworks = [], hwSubmissions = [],
  parents = [], enrollments = [], admissions = [], student: studentOverrides = {},
} = {}) {
  useAppStore.setState({
    students: [{
      id: STUDENT_ID, name: 'Test Student', code: 'C1', phone: '0100000000',
      parentPhone: '0111111111', groupId: null, enrollDate: '2026-01-01', monthlyFee: 1000,
      ...studentOverrides,
    }],
    groups, attendance, absenceFollowup: [], payments, exams, grades,
    homeworks, hwSubmissions, invMaterials: [], matDist: [], communications,
    inventoryTxn, centerProfile: {}, waReportLog: [], treasuryTxn, parents, enrollments,
    admissions,
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

async function clickProfessionalReport() {
  fireEvent.click(screen.getByText('⭐ تقرير احترافي (PDF)'));
  await waitFor(() => expect(window.open).toHaveBeenCalled());
}

const ALL_SAMPLE_DATA = {
  payments: [{ id: 'p1', studentId: STUDENT_ID, amount: 1000, month: 1, year: 2026, date: '2026-01-05', status: 'paid', method: 'cash' }],
  attendance: [{ id: 'a1', studentId: STUDENT_ID, date: '2026-01-05', status: 'present' }],
  exams: [{ id: 'e1', groupId: null, name: 'اختبار 1', date: '2026-01-05', total: 100 }],
  grades: [{ id: 'g1', examId: 'e1', studentId: STUDENT_ID, score: 90 }],
};

describe('Student Report configuration — default behavior is unchanged', () => {
  beforeEach(() => { mockWindow(); mockScopedBundleFromStore(); });

  it('with no saved config (defaults), every section renders exactly as before this feature', async () => {
    seed(ALL_SAMPLE_DATA);
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    for (const title of Object.values(TITLE)) {
      expect(writtenHtml).toContain(title);
    }
  });
});

describe('Student Report configuration — disabling sections', () => {
  beforeEach(() => { mockWindow(); mockScopedBundleFromStore(); });

  it('disabling exactly one section removes only that section, every other section still renders', async () => {
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showCharts: false } });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).not.toContain(TITLE.showCharts);
    for (const [key, title] of Object.entries(TITLE)) {
      if (key === 'showCharts') continue;
      expect(writtenHtml).toContain(title);
    }
  });

  it('disabling multiple sections removes exactly those sections, nothing else', async () => {
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showCharts: false, showCommunication: false, showBooklets: false } });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).not.toContain(TITLE.showCharts);
    expect(writtenHtml).not.toContain(TITLE.showCommunication);
    expect(writtenHtml).not.toContain(TITLE.showBooklets);
    for (const [key, title] of Object.entries(TITLE)) {
      if (['showCharts', 'showCommunication', 'showBooklets'].includes(key)) continue;
      expect(writtenHtml).toContain(title);
    }
  });

  it('Health Score and AI Summary are independently toggleable (previously both tied to a single flag)', async () => {
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showHealthScore: false } });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).not.toContain(TITLE.showHealthScore);
    expect(writtenHtml).toContain(TITLE.showEvaluation); // AI Summary still renders — no longer coupled
  });

  it('re-enabling a previously-disabled section restores it', async () => {
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showCharts: false } });
    renderPage();
    selectStudent();
    await clickProfessionalReport();
    expect(writtenHtml).not.toContain(TITLE.showCharts);

    // Re-enable directly through the store's real action (same one the Settings UI calls)
    // — wrapped in act() so StudentReportPage's subscription re-renders (and its onClick
    // closure picks up the new reportConfig) before the next click, same as a real user
    // toggling the Settings switch and then clicking the report button.
    act(() => { useAppStore.getState().setReportConfig({ showCharts: true }); });
    writtenHtml = '';
    vi.mocked(window.open).mockClear();
    await clickProfessionalReport();
    expect(writtenHtml).toContain(TITLE.showCharts);
  });
});

describe('Student Report configuration — existing calculations remain unchanged', () => {
  beforeEach(() => { mockWindow(); mockScopedBundleFromStore(); });

  it('a refund is still netted correctly in the Financials section (BUG-02 contract, unaffected by the new config wiring)', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      payments: [{ id: 'p1', studentId: STUDENT_ID, amount: 1000, month: 1, year: 2026, date: '2026-01-05', status: 'paid', method: 'cash' }],
      treasuryTxn: [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    // netPaid = 1000 - 300 = 700 ج.م — same computation reportData.js/getRefundedAmount
    // already proved elsewhere (StudentReportPage.grossNet.test.jsx), just confirming this
    // report pipeline still reflects it after the config split.
    expect(writtenHtml).toContain('700');
    expect(writtenHtml).toContain('المسترد');
  });

  it('the exam score/percentage still appears correctly when Exams is enabled', async () => {
    seed(ALL_SAMPLE_DATA);
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain('اختبار 1');
    expect(writtenHtml).toContain('90'); // score
  });
});

describe('Student Report configuration — empty-data behavior remains safe', () => {
  beforeEach(() => { mockWindow(); mockScopedBundleFromStore(); });

  it('a student with zero records anywhere does not crash the professional report, with every section enabled', async () => {
    seed({}); // no payments/attendance/exams/grades/communications/inventoryTxn at all
    renderPage();
    selectStudent();

    await expect(clickProfessionalReport()).resolves.not.toThrow();
    expect(writtenHtml.length).toBeGreaterThan(0);
    // Empty-state text already produced by the untouched section builders (DataTable's
    // emptyText) — confirms sections still self-render safely, not silently broken.
    expect(writtenHtml).toContain('لا توجد امتحانات مسجّلة');
    expect(writtenHtml).toContain('لا توجد مدفوعات');
  });

  it('a student with zero records does not crash even with several sections disabled', async () => {
    seed({ reportConfig: { showCharts: false, showBooklets: false, showCommunication: false } });
    renderPage();
    selectStudent();

    await expect(clickProfessionalReport()).resolves.not.toThrow();
    expect(writtenHtml).not.toContain(TITLE.showCharts);
  });
});

describe('Student Report configuration — Simple Print now respects the same configuration; WhatsApp remains independent', () => {
  beforeEach(() => { mockWindow(); mockScopedBundleFromStore(); });

  it('openStudentReportPrint (🖨 طباعة / PDF) omits the Payment History section when showPaymentHistory is off, independently of the Financial Summary KPI', async () => {
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showPaymentHistory: false } });
    renderPage();
    selectStudent();
    // انتظار حتى يكتمل جلب حزمة التقرير المُصفّاة الخاصة بالتبويبات التفاعلية (data) —
    // زر الطباعة نفسه موجود فور اختيار الطالب، لكنه no-op بلا data (انظر buildPrintReport
    // .js's openStudentReportPrint). "نظرة عامة" لا تظهر إلا بعد اكتمال هذا الجلب.
    await screen.findByText('ملخص الحضور');
    fireEvent.click(screen.getByText('🖨 طباعة / PDF'));

    // openStudentReportPrint now receives config: reportConfig (StudentReportPage.jsx) and
    // buildPrintReport.js gates paymentsHTML by it — no more hard-coded rendering bypassing
    // the setting. showFinancialSummary stays at its default (true), so the top summary
    // KPI ("إجمالي المدفوع") is untouched — proving the two sections are independent.
    expect(writtenHtml).not.toContain('المدفوعات<'); // sectionTitle('💰','المدفوعات',...)
    expect(writtenHtml).toContain('إجمالي المدفوع'); // summaryHTML's KPI, gated separately
    // untouched sections still render — hiding one section doesn't hide another
    expect(writtenHtml).toContain('اختبار 1');
    cleanup();
  });

  it('openStudentReportPrint (🖨 طباعة / PDF) omits the Financial Summary money KPI when showFinancialSummary is off, independently of Payment History', async () => {
    // "إجمالي المدفوع" appears twice under the default config: once in the top summary KPI
    // row (summaryHTML, gated by showFinancialSummary), once inside the Payment History
    // section's own totals (paymentsHTML, gated by showPaymentHistory) — disabling only
    // showFinancialSummary must remove exactly the first occurrence, proving independence
    // rather than accidentally also hiding Payment History's content.
    const countOccurrences = (html, needle) => html.split(needle).length - 1;

    seed({ ...ALL_SAMPLE_DATA });
    renderPage();
    selectStudent();
    await screen.findByText('ملخص الحضور');
    fireEvent.click(screen.getByText('🖨 طباعة / PDF'));
    const defaultCount = countOccurrences(writtenHtml, 'إجمالي المدفوع');
    expect(defaultCount).toBeGreaterThanOrEqual(2);
    cleanup();

    mockWindow(); // fresh writtenHtml — the previous print's output must not carry over
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showFinancialSummary: false } });
    renderPage();
    selectStudent();
    await screen.findByText('ملخص الحضور');
    fireEvent.click(screen.getByText('🖨 طباعة / PDF'));
    expect(countOccurrences(writtenHtml, 'إجمالي المدفوع')).toBe(defaultCount - 1);
    expect(writtenHtml).toContain('المدفوعات<'); // the payment history table itself still renders
    cleanup();
  });

  it('openStudentReportPrint (🖨 طباعة / PDF) still renders every section under the default config, for comparison', async () => {
    seed({ ...ALL_SAMPLE_DATA }); // default config
    renderPage();
    selectStudent();
    await screen.findByText('ملخص الحضور');
    fireEvent.click(screen.getByText('🖨 طباعة / PDF'));

    expect(writtenHtml).toContain('إجمالي المدفوع');
    expect(writtenHtml).toContain('المدفوعات<');
    cleanup();
  });

  it('generateMessage (WhatsApp summary) has no config parameter and remains unaffected by reportConfig — unchanged, out of scope for this feature', () => {
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showFinancialSummary: false, showAttendance: false, showExams: false } });
    const store = useAppStore.getState();
    // generateMessage(studentId, store, { profile, type }) — reads directly from the raw
    // store slices (students/payments/attendance/...), never reportConfig.
    const result = generateMessage(STUDENT_ID, store, { profile: {} });
    expect(result).not.toBeNull();
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// On-screen surface — a bug audit (predating this feature) found StudentReportPage.jsx's
// own tab bar and overview KPI row never read reportConfig at all: financial/payment data
// stayed visible on screen no matter the setting. This describe block proves the fix:
// tabs and their corresponding overview-tab summary cards / KPIs now respect the same
// reportConfig the Professional PDF and Simple Print use.
// ─────────────────────────────────────────────────────────────────────────────
describe('Student Report configuration — on-screen surface (StudentReportPage tabs and overview KPIs)', () => {
  beforeEach(() => { mockWindow(); mockScopedBundleFromStore(); });

  // TABS only render once (student && data) — waiting on the always-present "نظرة عامة"
  // tab button is a stable "report finished loading" gate regardless of which other
  // sections are enabled/disabled in a given test.
  async function waitForReportLoaded() {
    await screen.findByRole('button', { name: /نظرة عامة/ });
  }

  it('default config: every tab is present', async () => {
    seed(ALL_SAMPLE_DATA);
    renderPage();
    selectStudent();
    await waitForReportLoaded();

    for (const name of [/نظرة عامة/, /الحضور/, /الامتحانات/, /الواجبات/, /المذكرات/, /المدفوعات/, /التاريخ/]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('hiding showAttendance removes the Attendance tab and its overview KPIs, leaving other tabs/KPIs untouched', async () => {
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showAttendance: false } });
    renderPage();
    selectStudent();
    await waitForReportLoaded();

    expect(screen.queryByRole('button', { name: /^✓ الحضور$/ })).not.toBeInTheDocument();
    expect(screen.queryByText('نسبة الحضور')).not.toBeInTheDocument();
    expect(screen.queryByText('جلسات الحضور')).not.toBeInTheDocument();
    // independence — every other tab and KPI is unaffected
    expect(screen.getByRole('button', { name: /الامتحانات/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /المدفوعات/ })).toBeInTheDocument();
    expect(screen.getAllByText('متوسط الامتحانات').length).toBeGreaterThan(0);
    expect(screen.getAllByText('صافي المدفوع').length).toBeGreaterThan(0);
  });

  it('hiding showExams removes the Exams tab, independently of every other section', async () => {
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showExams: false } });
    renderPage();
    selectStudent();
    await waitForReportLoaded();

    expect(screen.queryByRole('button', { name: /الامتحانات/ })).not.toBeInTheDocument();
    expect(screen.queryByText('متوسط الامتحانات')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /الحضور/ })).toBeInTheDocument();
  });

  it('hiding showHomework removes the Homework tab and its overview KPI, independently of every other section', async () => {
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showHomework: false } });
    renderPage();
    selectStudent();
    await waitForReportLoaded();

    expect(screen.queryByRole('button', { name: /الواجبات/ })).not.toBeInTheDocument();
    expect(screen.queryByText('إنجاز الواجبات')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /المذكرات/ })).toBeInTheDocument();
  });

  it('hiding showBooklets removes the Materials tab and its overview KPI, independently of every other section', async () => {
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showBooklets: false } });
    renderPage();
    selectStudent();
    await waitForReportLoaded();

    expect(screen.queryByRole('button', { name: /المذكرات/ })).not.toBeInTheDocument();
    expect(screen.queryByText('مذكرات استُلمت')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /المدفوعات/ })).toBeInTheDocument();
  });

  it('hiding showPaymentHistory removes the Payments tab, independently of the Financial Summary KPI', async () => {
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showPaymentHistory: false } });
    renderPage();
    selectStudent();
    await waitForReportLoaded();

    expect(screen.queryByRole('button', { name: /المدفوعات/ })).not.toBeInTheDocument();
    // showFinancialSummary is untouched (still default true) — the KPI stays
    expect(screen.getAllByText('صافي المدفوع').length).toBeGreaterThan(0);
  });

  it('hiding showFinancialSummary removes the overview "صافي المدفوع" KPI, independently of the Payments tab', async () => {
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showFinancialSummary: false } });
    renderPage();
    selectStudent();
    await waitForReportLoaded();

    expect(screen.queryByText('صافي المدفوع')).not.toBeInTheDocument();
    // showPaymentHistory is untouched (still default true) — the tab stays
    expect(screen.getByRole('button', { name: /المدفوعات/ })).toBeInTheDocument();
  });

  it('hiding showAcademicTimeline removes the Timeline tab', async () => {
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showAcademicTimeline: false } });
    renderPage();
    selectStudent();
    await waitForReportLoaded();

    expect(screen.queryByRole('button', { name: /التاريخ/ })).not.toBeInTheDocument();
  });

  it('the currently-active tab safely falls back to Overview if a config change hides it, instead of showing a hidden tab\'s orphaned content', async () => {
    seed(ALL_SAMPLE_DATA); // default config — Payments tab visible
    renderPage();
    selectStudent();
    await waitForReportLoaded();

    fireEvent.click(screen.getByRole('button', { name: /المدفوعات/ }));
    expect(screen.getByText('سجل المدفوعات')).toBeInTheDocument(); // Payments tab content now showing

    // Setting is disabled while the Payments tab is the active one — same real store action
    // the Settings UI calls (setReportConfig), not a hand-crafted prop.
    act(() => { useAppStore.getState().setReportConfig({ showPaymentHistory: false }); });

    expect(screen.queryByRole('button', { name: /المدفوعات/ })).not.toBeInTheDocument();
    expect(screen.queryByText('سجل المدفوعات')).not.toBeInTheDocument(); // no orphaned content
    expect(screen.getByText('ملخص الامتحانات')).toBeInTheDocument(); // fell back to Overview
  });

  it('disabling multiple independent sections at once removes exactly those, nothing else', async () => {
    seed({ ...ALL_SAMPLE_DATA, reportConfig: { showAttendance: false, showBooklets: false, showAcademicTimeline: false } });
    renderPage();
    selectStudent();
    await waitForReportLoaded();

    expect(screen.queryByRole('button', { name: /^✓ الحضور$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /المذكرات/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /التاريخ/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /الامتحانات/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /الواجبات/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /المدفوعات/ })).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Professional Report audit — Phase 1 fixes (items 2, 3, 5, 6 of the implementation plan)
// ─────────────────────────────────────────────────────────────────────────────
describe('Professional PDF audit fix — parent name (item 2)', () => {
  beforeEach(() => { mockWindow(); mockScopedBundleFromStore(); });

  it('shows the real parent full name from the parents record, via the authoritative parentId relation', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      student: { parentId: 'par1' },
      parents: [{ id: 'par1', fullName: 'Ahmed Hassan', phone: '0111111111' }],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain('Ahmed Hassan');
    expect(writtenHtml).not.toContain('undefined');
  });

  it('renders the existing neutral fallback ("—"), not "undefined", when the student has no linked parent record', async () => {
    seed({ ...ALL_SAMPLE_DATA, student: { parentId: null }, parents: [] });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain('>ولي الأمر<');
    expect(writtenHtml).not.toContain('undefined');
  });

  it('does not confuse one student\'s parent with another\'s — only the linked parentId resolves', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      student: { parentId: 'par1' },
      parents: [
        { id: 'par1', fullName: 'Correct Parent' },
        { id: 'par2', fullName: 'Unrelated Parent' },
      ],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain('Correct Parent');
    expect(writtenHtml).not.toContain('Unrelated Parent');
  });
});

describe('Professional PDF audit fix — Academic Timeline join event (item 3)', () => {
  beforeEach(() => { mockWindow(); mockScopedBundleFromStore(); });

  it('generates the "joining" timeline event from student.enrollDate (the real field), not the non-existent student.joinDate', async () => {
    // ALL_SAMPLE_DATA's seeded student already has enrollDate: '2026-01-01' (see seed()) —
    // before this fix, academicTimelineSection read student.joinDate (always undefined),
    // so "الانضمام للسنتر" could never appear, for any student, ever.
    seed(ALL_SAMPLE_DATA);
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain('الانضمام للسنتر');
  });
});

describe('Professional PDF audit fix — teacher name (item 4, Screen + Simple Print)', () => {
  beforeEach(() => { mockWindow(); mockScopedBundleFromStore(); });

  it('the on-screen student header shows the real teacher name (group.teacherName), not a permanent "—"', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      student: { groupId: 'g1' },
      groups: [{ id: 'g1', name: 'Group A', teacherName: 'Mr. Khaled' }],
    });
    renderPage();
    selectStudent();
    await screen.findByText('ملخص الحضور');

    expect(screen.getByText('Mr. Khaled')).toBeInTheDocument();
  });

  it('the Simple Print (🖨) student card shows the real teacher name, not a permanent "—"', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      student: { groupId: 'g1' },
      groups: [{ id: 'g1', name: 'Group A', teacherName: 'Mr. Khaled' }],
    });
    renderPage();
    selectStudent();
    await screen.findByText('ملخص الحضور');
    fireEvent.click(screen.getByText('🖨 طباعة / PDF'));

    expect(writtenHtml).toContain('Mr. Khaled');
  });

  it('the Professional PDF already read the correct field before this fix — unaffected regression check', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      student: { groupId: 'g1' },
      groups: [{ id: 'g1', name: 'Group A', teacherName: 'Mr. Khaled' }],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain('Mr. Khaled');
  });
});

describe('Professional PDF — Additional Groups section (item 5)', () => {
  beforeEach(() => { mockWindow(); mockScopedBundleFromStore(); });

  it('no additional groups: the section does not render at all (no empty card)', async () => {
    seed({ ...ALL_SAMPLE_DATA, enrollments: [] });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).not.toContain('المجموعات الإضافية');
  });

  it('one active additional group: shows group name, teacher, start date, and "نشط" status', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      groups: [{ id: 'gAdd', name: 'Additional Group X', teacherName: 'Ms. Sara' }],
      enrollments: [{
        id: 'en1', studentId: STUDENT_ID, groupId: 'gAdd', role: 'additional', status: 'active',
        startDate: '2026-01-10', endDate: null, attendDays: ['sat', 'mon'],
      }],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain('المجموعات الإضافية');
    expect(writtenHtml).toContain('Additional Group X');
    expect(writtenHtml).toContain('Ms. Sara');
    expect(writtenHtml).toContain('نشط');
    expect(writtenHtml).toContain('السبت'); // attendDays mapped through the real DAYS_AR labels
  });

  it('multiple additional groups: every one appears, with the correct count', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      groups: [
        { id: 'gA', name: 'Group Alpha', teacherName: 'T1' },
        { id: 'gB', name: 'Group Beta', teacherName: 'T2' },
      ],
      enrollments: [
        { id: 'en1', studentId: STUDENT_ID, groupId: 'gA', role: 'additional', status: 'active', startDate: '2026-01-01', endDate: null, attendDays: [] },
        { id: 'en2', studentId: STUDENT_ID, groupId: 'gB', role: 'additional', status: 'active', startDate: '2026-01-05', endDate: null, attendDays: [] },
      ],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain('Group Alpha');
    expect(writtenHtml).toContain('Group Beta');
    expect(writtenHtml).toMatch(/المجموعات الإضافية[\s\S]*?>2</); // count badge = 2
  });

  it('a historical/withdrawn additional group is still shown, not silently dropped, with its "منسحب" status and end date', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      groups: [{ id: 'gOld', name: 'Old Group', teacherName: 'T-Old' }],
      enrollments: [{
        id: 'en1', studentId: STUDENT_ID, groupId: 'gOld', role: 'additional', status: 'withdrawn',
        startDate: '2025-01-01', endDate: '2025-06-01', attendDays: [],
      }],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain('Old Group');
    expect(writtenHtml).toContain('منسحب');
  });

  it('a primary-role enrollment row is never listed as an "additional" group (independence from Primary Group)', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      student: { groupId: 'gPrime' },
      groups: [{ id: 'gPrime', name: 'Primary Group Name', teacherName: 'T-Prime' }],
      enrollments: [{
        id: 'en1', studentId: STUDENT_ID, groupId: 'gPrime', role: 'primary', status: 'active',
        startDate: '2026-01-01', endDate: null, attendDays: [],
      }],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).not.toContain('المجموعات الإضافية');
  });

  it('reuses showProfile — disabling it hides Additional Groups too (no separate/redundant setting introduced)', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      reportConfig: { showProfile: false },
      groups: [{ id: 'gAdd', name: 'Additional Group X', teacherName: 'Ms. Sara' }],
      enrollments: [{
        id: 'en1', studentId: STUDENT_ID, groupId: 'gAdd', role: 'additional', status: 'active',
        startDate: '2026-01-10', endDate: null, attendDays: [],
      }],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).not.toContain('المجموعات الإضافية');
    expect(writtenHtml).not.toContain('Additional Group X');
  });
});

describe('Professional PDF — Homework section (item 6)', () => {
  beforeEach(() => { mockWindow(); mockScopedBundleFromStore(); });

  it('showHomework=true (default): renders a submitted, a late, and a missing homework row, plus a graded score', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      student: { grade: 'Grade 7' },
      homeworks: [
        { id: 'hw1', grade: 'Grade 7', title: 'Math Homework Alpha', dueDate: '2026-01-10', subject: 'Math', totalScore: 20 },
        { id: 'hw2', grade: 'Grade 7', title: 'Science Homework Beta', dueDate: '2026-01-12', subject: 'Science', totalScore: 10 },
        { id: 'hw3', grade: 'Grade 7', title: 'Arabic Homework Gamma', dueDate: '2026-01-14', subject: 'Arabic', totalScore: 10 },
      ],
      hwSubmissions: [
        { id: 's1', hwId: 'hw1', studentId: STUDENT_ID, status: 'submitted', submittedAt: '2026-01-09', score: 18 },
        { id: 's2', hwId: 'hw2', studentId: STUDENT_ID, status: 'late', submittedAt: '2026-01-13', score: 6 },
        // hw3 has no submission row at all -> status 'missing'
      ],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain('Math Homework Alpha');
    expect(writtenHtml).toContain('Science Homework Beta');
    expect(writtenHtml).toContain('Arabic Homework Gamma');
    expect(writtenHtml).toContain('سُلِّم');
    expect(writtenHtml).toContain('متأخر');
    expect(writtenHtml).toContain('لم يُسلَّم');
    expect(writtenHtml).toContain('18/20'); // graded score
  });

  it('showHomework=false: the section (and its specific homework rows) is completely absent', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      reportConfig: { showHomework: false },
      student: { grade: 'Grade 7' },
      homeworks: [{ id: 'hw1', grade: 'Grade 7', title: 'Math Homework Alpha', dueDate: '2026-01-10', subject: 'Math', totalScore: 20 }],
      hwSubmissions: [{ id: 's1', hwId: 'hw1', studentId: STUDENT_ID, status: 'submitted', submittedAt: '2026-01-09', score: 18 }],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).not.toContain('Math Homework Alpha');
  });

  it('no homework data for the student\'s grade: the section renders its own empty state, not an error', async () => {
    seed({ ...ALL_SAMPLE_DATA, student: { grade: 'Grade 7' }, homeworks: [], hwSubmissions: [] });
    renderPage();
    selectStudent();
    await expect(clickProfessionalReport()).resolves.not.toThrow();

    expect(writtenHtml).toContain('لا توجد واجبات مسجّلة لصف الطالب');
  });

  it('reuses the same grade-based eligibility as Screen/Print (Homework 2.0 — grade, not group): a homework for a different grade never appears', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      student: { grade: 'Grade 7' },
      homeworks: [{ id: 'hwOther', grade: 'Grade 9', title: 'Wrong Grade Homework', dueDate: '2026-01-10', subject: 'Math', totalScore: 20 }],
      hwSubmissions: [],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).not.toContain('Wrong Grade Homework');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Professional Report audit — Phase 1, item 7: data-level leak verification. Existing
// tests (above, and pre-existing) only ever proved a section's SectionHeader title
// disappears. These prove the underlying sensitive/derived DATA is actually absent from
// the whole document — not just its titled section — closing the two leak paths the audit
// found (Executive Snapshot's InfoCards/alerts, AI Summary's generated sentences).
// ─────────────────────────────────────────────────────────────────────────────
describe('Professional PDF — data-level visibility (item 7)', () => {
  beforeEach(() => { mockWindow(); mockScopedBundleFromStore(); });

  const LEAK_DATA = {
    ...ALL_SAMPLE_DATA,
    payments: [{ id: 'p1', studentId: STUDENT_ID, amount: 1234, month: 1, year: 2026, date: '2026-01-05', status: 'paid', method: 'cash' }],
    attendance: [
      { id: 'a1', studentId: STUDENT_ID, date: '2026-01-05', status: 'present' },
      { id: 'a2', studentId: STUDENT_ID, date: '2026-01-06', status: 'absent' },
      { id: 'a3', studentId: STUDENT_ID, date: '2026-01-07', status: 'absent' },
      { id: 'a4', studentId: STUDENT_ID, date: '2026-01-08', status: 'absent' },
    ],
    grades: [
      { id: 'g1', examId: 'e1', studentId: STUDENT_ID, score: 20 },
      { id: 'g2', examId: 'e2', studentId: STUDENT_ID, score: 15 },
    ],
    exams: [
      { id: 'e1', groupId: null, name: 'اختبار 1', date: '2026-01-05', total: 100, pass: 50 },
      { id: 'e2', groupId: null, name: 'اختبار 2', date: '2026-01-06', total: 100, pass: 50 },
    ],
    inventoryTxn: [{ id: 't1', type: 'studentDelivery', studentId: STUDENT_ID, materialId: 'm1', date: '2026-01-05', quantity: 1, legacyMetadata: { paidAmount: 77, payStatus: 'paid' } }],
    invMaterials: [{ id: 'm1', name: 'دفتر التمارين', price: 77 }],
    communications: [{ id: 'c1', phone: '0111111111', reason: 'استفسار عن الرسوم', createdAt: '2026-01-01', employee: 'أحمد' }],
    student: { monthlyFee: 5000, parentPhone: '0111111111' },
  };

  it('showFinancialSummary=false: no fee/paid/balance figure or financial sentence anywhere in the PDF, including Snapshot and AI Summary', async () => {
    seed({ ...LEAK_DATA, reportConfig: { showFinancialSummary: false } });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).not.toContain('1234'); // raw payment amount
    expect(writtenHtml).not.toContain('5,000'); // monthlyFee, ar-EG grouped
    expect(writtenHtml).not.toContain('5000');
    expect(writtenHtml).not.toContain('الرسوم الشهرية'); // financialSection's fee row label
    expect(writtenHtml).not.toContain('المدفوع (صافي)'); // Snapshot's paid-net row label
    expect(writtenHtml).not.toContain('المتبقّي'); // Snapshot's remaining-balance row label
    expect(writtenHtml).not.toContain('رصيد متبقٍّ'); // AI Summary financial sentence
    expect(writtenHtml).not.toContain('لا توجد مدفوعات مسجّلة حتى الآن'); // AI Summary financial sentence
    // the dedicated Financial Summary section title is gone too
    expect(writtenHtml).not.toContain(TITLE.showFinancialSummary);
    // unrelated sections are unaffected (independence) — Snapshot's financial InfoCard may
    // still exist (it's shared with the exam/booklet counts, both still enabled here), just
    // with none of its financial rows — proven by the label absences above, not the card title.
    expect(writtenHtml).toContain(TITLE.showAttendance);
  });

  it('showFinancialSummary=true (default): the same figures/sentences DO appear, for contrast', async () => {
    seed({ ...LEAK_DATA });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain('الوضع المالي');
  });

  it('showAttendance=false: no attendance-derived number or sentence anywhere, including Snapshot and AI Summary', async () => {
    seed({ ...LEAK_DATA, reportConfig: { showAttendance: false } });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).not.toContain('نسبة الحضور'); // Snapshot donut label
    expect(writtenHtml).not.toContain('حالات غياب'); // Snapshot/AI alert sentence fragment
    expect(writtenHtml).not.toContain('غياب متتالية'); // AI Summary sentence fragment
    // unrelated section unaffected
    expect(writtenHtml).toContain(TITLE.showExams);
  });

  it('showExams=false: no exam-derived number or sentence anywhere, including Snapshot and AI Summary', async () => {
    seed({ ...LEAK_DATA, reportConfig: { showExams: false } });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).not.toContain('آخر الامتحانات'); // Snapshot InfoCard title
    expect(writtenHtml).not.toContain('اختبار 1');
    expect(writtenHtml).not.toContain('اختبار 2');
    expect(writtenHtml).not.toContain('عدد الامتحانات'); // Snapshot financial-card exam count row
    // unrelated section unaffected
    expect(writtenHtml).toContain(TITLE.showAttendance);
  });

  it('showBooklets=false: no material/booklet-derived number anywhere, including Snapshot', async () => {
    seed({ ...LEAK_DATA, reportConfig: { showBooklets: false } });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).not.toContain('المذكرات المسلّمة'); // Snapshot InfoCard title
    expect(writtenHtml).not.toContain('دفتر التمارين');
    expect(writtenHtml).not.toContain('عدد المذكرات'); // Snapshot financial-card booklet count row
  });

  it('showCommunication=false: no communication-derived statement anywhere, including Snapshot and AI Summary', async () => {
    seed({ ...LEAK_DATA, reportConfig: { showCommunication: false } });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).not.toContain('آخر تواصل ومتابعة'); // Snapshot InfoCard title
    expect(writtenHtml).not.toContain('استفسار عن الرسوم');
    expect(writtenHtml).not.toContain('لا يوجد تواصل مسجّل'); // AI Summary sentence
  });

  it('showHomework=false: no homework-derived content anywhere', async () => {
    seed({
      ...LEAK_DATA,
      reportConfig: { showHomework: false },
      student: { ...LEAK_DATA.student, grade: 'Grade 7' },
      homeworks: [{ id: 'hw1', grade: 'Grade 7', title: 'Leak Homework Title', dueDate: '2026-01-10', subject: 'Math', totalScore: 20 }],
      hwSubmissions: [{ id: 's1', hwId: 'hw1', studentId: STUDENT_ID, status: 'submitted', submittedAt: '2026-01-09', score: 18 }],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).not.toContain('Leak Homework Title');
  });

  it('independence: disabling ALL leak-prone sections at once still leaves unrelated sections (e.g. Health Score) intact', async () => {
    seed({
      ...LEAK_DATA,
      reportConfig: {
        showFinancialSummary: false, showAttendance: false, showExams: false,
        showBooklets: false, showCommunication: false, showHomework: false,
      },
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain(TITLE.showHealthScore);
    // Charts is correctly ABSENT here too, not a regression: both its data sources
    // (exams, attendance) are disabled in this exact scenario, so it has nothing left to
    // draw — chartsSection self-omits rather than rendering an empty titled section (see
    // its own leak-fix comment in buildStudentReport.js). Covered on its own, with only
    // ONE of its two sources disabled, at a later point below.
    expect(writtenHtml).not.toContain(TITLE.showCharts);
    expect(writtenHtml).toContain(TITLE.showSnapshot); // the page itself still renders — just leaner
  });

  it('Charts (a 4th leak path found during test-writing): showExams=false removes the exam-name chart but keeps the attendance chart, and vice versa', async () => {
    seed({ ...LEAK_DATA, reportConfig: { showExams: false } });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain(TITLE.showCharts); // still present — attendance chart remains
    expect(writtenHtml).not.toContain('اتجاه أداء الامتحانات'); // exam LineChart's own title
    expect(writtenHtml).not.toContain('اختبار 1');
    expect(writtenHtml).toContain('توزيع الحضور'); // attendance BarChart unaffected
    cleanup();

    mockWindow();
    seed({ ...LEAK_DATA, reportConfig: { showAttendance: false } });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain(TITLE.showCharts); // still present — exam chart remains
    expect(writtenHtml).not.toContain('توزيع الحضور');
    expect(writtenHtml).toContain('اتجاه أداء الامتحانات');
    expect(writtenHtml).toContain('اختبار 1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Student Report Phase 2 — Primary Group History + Admissions Summary
// ─────────────────────────────────────────────────────────────────────────────
describe('Professional PDF — Primary Group History (Phase 2)', () => {
  beforeEach(() => { mockWindow(); mockScopedBundleFromStore(); });

  it('shows the current primary enrollment (group, teacher, start date, status)', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      student: { groupId: 'gCur' },
      groups: [{ id: 'gCur', name: 'Current Primary Group', teacherName: 'Mr. Omar' }],
      enrollments: [{
        id: 'en1', studentId: STUDENT_ID, groupId: 'gCur', role: 'primary', status: 'active',
        startDate: '2026-01-01', endDate: null, attendDays: [],
      }],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain('سجل المجموعة الأساسية');
    expect(writtenHtml).toContain('Current Primary Group');
    expect(writtenHtml).toContain('Mr. Omar');
    expect(writtenHtml).toContain('نشط');
  });

  it('shows a historical transferred primary enrollment alongside the current one', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      student: { groupId: 'gNew' },
      groups: [
        { id: 'gOld', name: 'Old Primary Group', teacherName: 'Mr. Old' },
        { id: 'gNew', name: 'New Primary Group', teacherName: 'Mr. New' },
      ],
      enrollments: [
        { id: 'en1', studentId: STUDENT_ID, groupId: 'gNew', role: 'primary', status: 'active', startDate: '2026-02-01', endDate: null, attendDays: [] },
        { id: 'en2', studentId: STUDENT_ID, groupId: 'gOld', role: 'primary', status: 'transferred', startDate: '2025-01-01', endDate: '2026-02-01', attendDays: [] },
      ],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain('Old Primary Group');
    expect(writtenHtml).toContain('New Primary Group');
    expect(writtenHtml).toContain('محوَّل'); // transferred status label
    expect(writtenHtml).toMatch(/سجل المجموعة الأساسية[\s\S]*?>2</); // count badge = 2
  });

  it('an additional-role enrollment is never listed as primary history (no cross-contamination)', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      groups: [{ id: 'gAdd', name: 'Additional Only Group', teacherName: 'T' }],
      enrollments: [{
        id: 'en1', studentId: STUDENT_ID, groupId: 'gAdd', role: 'additional', status: 'active',
        startDate: '2026-01-10', endDate: null, attendDays: [],
      }],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).not.toContain('سجل المجموعة الأساسية');
    // Additional Groups section still works exactly as before (no regression)
    expect(writtenHtml).toContain('المجموعات الإضافية');
    expect(writtenHtml).toContain('Additional Only Group');
  });

  it('no primary enrollment rows at all: the section does not render (no empty card)', async () => {
    seed({ ...ALL_SAMPLE_DATA, enrollments: [] });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).not.toContain('سجل المجموعة الأساسية');
  });

  it('reuses showProfile — disabling it hides Primary Group History too (no new setting introduced)', async () => {
    // Note: the group's name/teacher may still appear elsewhere in the PDF regardless of
    // showProfile (e.g. Snapshot's identity card shows the student's *current* group/
    // teacher unconditionally, gated by showSnapshot — a separate, pre-existing,
    // out-of-scope display). The precise signal that THIS section specifically is gone is
    // its own SectionHeader title, which cannot appear from anywhere else.
    seed({
      ...ALL_SAMPLE_DATA,
      reportConfig: { showProfile: false },
      student: { groupId: 'gCur' },
      groups: [{ id: 'gCur', name: 'Current Primary Group', teacherName: 'Mr. Omar' }],
      enrollments: [{ id: 'en1', studentId: STUDENT_ID, groupId: 'gCur', role: 'primary', status: 'active', startDate: '2026-01-01', endDate: null, attendDays: [] }],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).not.toContain('سجل المجموعة الأساسية');
  });

  it('Additional Groups + Primary Group History coexist correctly, each showing only its own role', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      student: { groupId: 'gPrime' },
      groups: [
        { id: 'gPrime', name: 'Primary Grp', teacherName: 'T1' },
        { id: 'gAdd', name: 'Additional Grp', teacherName: 'T2' },
      ],
      enrollments: [
        { id: 'en1', studentId: STUDENT_ID, groupId: 'gPrime', role: 'primary', status: 'active', startDate: '2026-01-01', endDate: null, attendDays: [] },
        { id: 'en2', studentId: STUDENT_ID, groupId: 'gAdd', role: 'additional', status: 'active', startDate: '2026-01-05', endDate: null, attendDays: [] },
      ],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain('سجل المجموعة الأساسية');
    expect(writtenHtml).toContain('المجموعات الإضافية');
    expect(writtenHtml).toContain('Primary Grp');
    expect(writtenHtml).toContain('Additional Grp');
  });
});

describe('Professional PDF — Admissions Summary (Phase 2)', () => {
  beforeEach(() => { mockWindow(); mockScopedBundleFromStore(); });

  it('shows reservation date, stage, and source for the linked admission', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      admissions: [{
        id: 'adm1', studentId: STUDENT_ID, number: 'A-0001', stage: 'active',
        reservationDate: '2025-12-01', source: 'فيسبوك', createdAt: '2025-12-01T10:00:00Z',
      }],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain('ملخّص القبول');
    expect(writtenHtml).toContain('طالب نشط'); // STAGES.active.label
    expect(writtenHtml).toContain('فيسبوك');
  });

  it('shows a conversion date when the admission is linked to a student and has lastModifiedAt', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      admissions: [{
        id: 'adm1', studentId: STUDENT_ID, number: 'A-0001', stage: 'active',
        reservationDate: '2025-12-01', source: 'إعلان',
        lastModifiedAt: '2026-01-01T12:00:00Z', createdAt: '2025-12-01T10:00:00Z',
      }],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain('تاريخ التحويل لطالب');
  });

  it('no linked admission: the section does not render at all (no empty card)', async () => {
    seed({ ...ALL_SAMPLE_DATA, admissions: [] });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).not.toContain('ملخّص القبول');
  });

  it('reuses showProfile — disabling it hides Admissions Summary too (no new setting introduced)', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      reportConfig: { showProfile: false },
      admissions: [{ id: 'adm1', studentId: STUDENT_ID, stage: 'active', reservationDate: '2025-12-01', source: 'فيسبوك' }],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).not.toContain('ملخّص القبول');
  });

  it('an admission belonging to a DIFFERENT student never leaks in (student_id FK, no name/phone matching)', async () => {
    seed({
      ...ALL_SAMPLE_DATA,
      admissions: [{
        id: 'adm1', studentId: 'someOtherStudentId', stage: 'active',
        reservationDate: '2025-12-01', source: 'مصدر غير ذي صلة',
      }],
    });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).not.toContain('ملخّص القبول');
    expect(writtenHtml).not.toContain('مصدر غير ذي صلة');
  });
});
