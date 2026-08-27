// src/modules/students/StudentProfile.revenue.test.jsx
// BUG-02 (remaining part) — both the header "إجمالي المدفوع" stat pill and the Payments
// tab's "إجمالي المدفوعات" stat summed payments.amount directly. Now both use the shared
// getNetRevenue() helper.
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentProfile from './StudentProfile';
import { useAppStore } from '../../store/app.store';
import { formatCurrency } from '../../utils/helpers';

const STUDENT = { id: 's1', name: 'أحمد', status: 'active', grade: 'الأول الثانوي', code: 'C1', phone: '', parentPhone: '' };

function seed(payments, treasuryTxn) {
  useAppStore.setState({
    students: [STUDENT], groups: [], attendance: [], grades: [], exams: [], parents: [], payments, treasuryTxn,
  });
}

describe('StudentProfile — header + Payments-tab "إجمالي المدفوع" are net of active refunds (BUG-02, remaining part)', () => {
  it('payment 1000, refund 300 -> header stat pill shows 700', () => {
    seed(
      [{ id: 'p1', studentId: 's1', amount: 1000, status: 'paid', date: '2026-01-01' }],
      [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    );
    render(<StudentProfile studentId="s1" onBack={() => {}} onEdit={() => {}} />);
    expect(screen.getByText(formatCurrency(700))).toBeInTheDocument();
    expect(screen.queryByText(formatCurrency(1000))).not.toBeInTheDocument();
  });

  it('the Payments tab total is also net of the same refund', () => {
    seed(
      [{ id: 'p1', studentId: 's1', amount: 1000, status: 'paid', date: '2026-01-01' }],
      [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    );
    render(<StudentProfile studentId="s1" onBack={() => {}} onEdit={() => {}} />);
    fireEvent.click(screen.getByText('المدفوعات'));
    // كلا الرقمين (الرأس وتبويب المدفوعات) صافيان الآن = 700
    expect(screen.getAllByText(formatCurrency(700)).length).toBeGreaterThanOrEqual(2);
  });

  it('regression: no refund -> both remain 1000', () => {
    seed([{ id: 'p1', studentId: 's1', amount: 1000, status: 'paid', date: '2026-01-01' }], []);
    render(<StudentProfile studentId="s1" onBack={() => {}} onEdit={() => {}} />);
    expect(screen.getByText(formatCurrency(1000))).toBeInTheDocument();
  });
});
