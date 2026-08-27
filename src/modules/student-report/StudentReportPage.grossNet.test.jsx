// src/modules/student-report/StudentReportPage.grossNet.test.jsx
// BUG-02 (printed historical statement) — the Payments tab shows an itemized table of the
// original per-transaction amounts (unchanged, historically accurate). "إجمالي المدفوع"
// used to be silently replaced-in-place across the page, which would either (a) desync
// from the itemized rows if netted, or (b) overstate the student's real financial position
// if left gross. Now the page surfaces all three: Gross (matches the itemized rows and
// table footer exactly), Refunded, and Net = Gross − Refunded — and the top-level "quick
// KPI"/finance-summary numbers (which have no adjacent itemized row list) show the Net
// figure under an explicit "صافي المدفوع" label.
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentReportPage from './StudentReportPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';
import { formatCurrency } from '../../utils/helpers';

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

describe('StudentReportPage — Gross/Refunded/Net (BUG-02, printed historical statement)', () => {
  it('no refund: quick KPI shows the plain total, no "المسترد" clutter anywhere', () => {
    seed([{ id: 'p1', studentId: STUDENT_ID, amount: 1000, month: 1, year: 2026, date: '2026-01-05', status: 'paid', method: 'cash' }], []);
    renderPage();
    selectStudent();
    expect(screen.getAllByText(formatCurrency(1000)).length).toBeGreaterThan(0);
    expect(screen.queryByText('المسترد')).not.toBeInTheDocument();
  });

  it('payment 1000, refund 300: quick KPI shows Net (700), Payments tab shows Gross(1000)/Refunded(300)/Net(700), itemized row stays 1000', () => {
    seed(
      [{ id: 'p1', studentId: STUDENT_ID, amount: 1000, month: 1, year: 2026, date: '2026-01-05', status: 'paid', method: 'cash' }],
      [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    );
    renderPage();
    selectStudent();

    // Quick KPI + ملخص المالية (تبويب النظرة العامة) = صافي كلاهما، بلا جدول مجاور
    expect(screen.getAllByText('صافي المدفوع').length).toBeGreaterThan(0);
    expect(screen.getAllByText(formatCurrency(700)).length).toBeGreaterThan(0);

    // Payments tab: الجدول يعرض المبلغ الخام 1000، والملخص يعرض الثلاثة أرقام
    fireEvent.click(screen.getByText('💰 المدفوعات'));
    expect(screen.getByText('المسترد')).toBeInTheDocument();
    expect(screen.getByText('الصافي')).toBeInTheDocument();
    expect(screen.getAllByText(formatCurrency(1000)).length).toBeGreaterThan(0); // الإجمالي + الصف الخام
    expect(screen.getAllByText(formatCurrency(300)).length).toBeGreaterThan(0);  // المسترد
    expect(screen.getAllByText(formatCurrency(700)).length).toBeGreaterThan(0);  // الصافي
  });
});
