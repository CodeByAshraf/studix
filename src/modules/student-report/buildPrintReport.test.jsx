// src/modules/student-report/buildPrintReport.test.jsx
// BUG-02 (newly discovered via the mandatory full re-search, printed historical statement)
// — this is the actual "🖨 طباعة / PDF" export of the student report: an itemized payments
// table (original per-transaction amounts, unchanged) sits directly under a "إجمالي
// المدفوع" KPI that used to be a plain Gross figure regardless of any refund. It now
// switches to an explicit Net figure (with the Gross/Refunded breakdown in its subtitle)
// whenever a refund exists, and adds separate "المسترد"/"الصافي" KPIs above the itemized
// payments table — driven by the exact same data object already proven correct in
// StudentReportPage.grossNet.test.jsx, so this test renders the real page and exercises
// the real "🖨 طباعة / PDF" button rather than hand-building a data fixture.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentReportPage from './StudentReportPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

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

function seed(payments, treasuryTxn) {
  useAppStore.setState({
    students: [{
      id: STUDENT_ID, name: 'Test Student', code: 'C1', phone: '0100000000',
      parentPhone: '0111111111', groupId: null, enrollDate: '2026-01-01', monthlyFee: 1000,
    }],
    groups: [], attendance: [], absenceFollowup: [], payments, exams: [], grades: [],
    homeworks: [], hwSubmissions: [], invMaterials: [], matDist: [], communications: [],
    inventoryTxn: [], centerProfile: {}, waReportLog: [], treasuryTxn,
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

describe('openStudentReportPrint (via the real "🖨 طباعة / PDF" button) — Gross/Refunded/Net', () => {
  beforeEach(() => { mockWindow(); });

  it('payment 1000, refund 300 -> printed report shows Net (700) as the headline figure, plus المسترد/الصافي', () => {
    seed(
      [{ id: 'p1', studentId: STUDENT_ID, amount: 1000, month: 1, year: 2026, date: '2026-01-05', status: 'paid', method: 'cash' }],
      [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    );
    renderPage();
    selectStudent();
    fireEvent.click(screen.getByText('🖨 طباعة / PDF'));

    expect(writtenHtml).toContain('صافي المدفوع');
    expect(writtenHtml).toContain('المسترد');
    expect(writtenHtml).toContain('الصافي');
  });

  it('no refund: printed report shows the plain "إجمالي المدفوع" with no المسترد clutter', () => {
    seed([{ id: 'p1', studentId: STUDENT_ID, amount: 1000, month: 1, year: 2026, date: '2026-01-05', status: 'paid', method: 'cash' }], []);
    renderPage();
    selectStudent();
    fireEvent.click(screen.getByText('🖨 طباعة / PDF'));

    expect(writtenHtml).toContain('إجمالي المدفوع');
    expect(writtenHtml).not.toContain('المسترد');
  });
});
