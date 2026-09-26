// src/modules/student-report/reportHeaderName.test.jsx
// BUG: Settings → Print Settings "اسم المركز / المدرس" (stored as centerProfile.name) was
// entered as "م خالد جمعه" and printed reports showed a garbled "مخ خالد جمعه"-looking
// header. Root cause: when no logo is uploaded, both the "⭐ تقرير احترافي" report
// (reportEngine's ReportHeader) and the "🖨 طباعة / PDF" simple report (buildPrintReport.js's
// headerHTML) rendered a small colored placeholder badge showing initials(profile.name) —
// for "م خالد جمعه" that's the first letter of the first TWO words joined ("م"+"خ" = "مخ"),
// sitting immediately next to the actual (unmodified) full name text. This proves the fix:
// the badge is removed (matching PrintHeader.jsx's existing no-logo behavior of rendering
// nothing), and the name itself renders exactly as entered, with no derived initials
// anywhere in the printed output — same technique already proven in
// StudentReportPage.reportConfig.test.jsx / buildPrintReport.test.jsx (real page, real
// buttons, inspect the written HTML).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentReportPage from './StudentReportPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

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

function seed(centerProfile) {
  useAppStore.setState({
    students: [STUDENT],
    groups: [], attendance: [], absenceFollowup: [], payments: [], exams: [], grades: [],
    homeworks: [], hwSubmissions: [], invMaterials: [], matDist: [], communications: [],
    inventoryTxn: [], centerProfile, waReportLog: [], treasuryTxn: [],
  });
  pgGetStudentReportData.mockResolvedValue({
    students: [STUDENT], groups: [], attendance: [], hwSubmissions: [], homeworks: [],
    grades: [], exams: [], payments: [], treasuryTxn: [], communications: [],
    inventoryTxn: [], invMaterials: [],
  });
}

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <StudentReportPage />
      </ToastProvider>
    </AuthProvider>
  );
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

async function clickSimplePrint() {
  await screen.findByText('ملخص الحضور');
  fireEvent.click(screen.getByText('🖨 طباعة / PDF'));
}

async function clickProfessionalReport() {
  fireEvent.click(screen.getByText('⭐ تقرير احترافي (PDF)'));
  await waitFor(() => expect(window.open).toHaveBeenCalled());
}

describe('Print header — center/teacher name renders exactly as entered, no derived initials badge', () => {
  beforeEach(() => { mockWindow(); vi.clearAllMocks(); });

  it('🖨 طباعة / PDF (buildPrintReport.js): Arabic name with a single-letter first word does not produce a "مخ"-style badge', async () => {
    seed({ name: 'م خالد جمعه' });
    renderPage();
    selectStudent();
    await clickSimplePrint();

    expect(writtenHtml).toContain('م خالد جمعه');
    expect(writtenHtml).not.toContain('مخ خالد جمعه');
    // .rh-logo-ph يبقى موجوداً كتعريف CSS غير مُستخدَم (تغيير غير ضار، خارج نطاق هذا
    // الإصلاح) — العنصر الفعلي الذي كان يحمل هذا الصنف واختصار الاسم بداخله هو ما يجب
    // ألا يظهر إطلاقاً في الجسم نفسه.
    expect(writtenHtml).not.toContain('class="rh-logo rh-logo-ph"');
  });

  it('⭐ تقرير احترافي (PDF) (reportEngine ReportHeader): same Arabic name does not produce a "مخ"-style badge', async () => {
    seed({ name: 'م خالد جمعه' });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain('م خالد جمعه');
    expect(writtenHtml).not.toContain('مخ خالد جمعه');
    // الشارة القديمة كانت <div ...>مخ</div> ملاصقة لاسم السنتر — التأكّد من عدم ظهور
    // "مخ" كنص مستقل داخل نفس رأس التقرير (لا كجزء من الاسم الكامل نفسه).
    const nameBlockIndex = writtenHtml.indexOf('م خالد جمعه');
    const beforeName = writtenHtml.slice(Math.max(0, nameBlockIndex - 80), nameBlockIndex);
    expect(beforeName).not.toContain('>مخ<');
  });

  it('🖨 طباعة / PDF: a normal Latin name renders exactly as entered, with no derived initials', async () => {
    seed({ name: 'Ahmed Khaled' });
    renderPage();
    selectStudent();
    await clickSimplePrint();

    expect(writtenHtml).toContain('Ahmed Khaled');
    expect(writtenHtml).not.toContain('class="rh-logo rh-logo-ph"');
  });

  it('⭐ تقرير احترافي (PDF): a normal Latin name renders exactly as entered, with no derived initials', async () => {
    seed({ name: 'Ahmed Khaled' });
    renderPage();
    selectStudent();
    await clickProfessionalReport();

    expect(writtenHtml).toContain('Ahmed Khaled');
    const nameBlockIndex = writtenHtml.indexOf('Ahmed Khaled');
    const beforeName = writtenHtml.slice(Math.max(0, nameBlockIndex - 80), nameBlockIndex);
    expect(beforeName).not.toContain('>AK<');
  });

  it('a logo IS uploaded: still renders the <img> logo normally (unrelated behavior untouched)', async () => {
    seed({ name: 'م خالد جمعه', logoUrl: 'https://example.com/logo.png' });
    renderPage();
    selectStudent();
    await clickSimplePrint();

    expect(writtenHtml).toContain('https://example.com/logo.png');
    expect(writtenHtml).toContain('م خالد جمعه');
  });
});
