// src/modules/reports/StudentPerformance.revenue.test.jsx
// BUG-02 (remaining part) — the per-student deep-dive profile's "إجمالي المدفوع" summed
// payments.amount directly. Now uses the shared getNetRevenue() helper.
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentPerformance from './StudentPerformance';
import { useAppStore } from '../../store/app.store';
import { formatCurrency } from '../../utils/helpers';

const STUDENT = { id: 's1', name: 'أحمد', status: 'active', grade: 'الأول الثانوي', code: 'C1' };

function seed(payments, treasuryTxn) {
  useAppStore.setState({
    students: [STUDENT], groups: [], attendance: [], grades: [], exams: [], payments, treasuryTxn,
  });
}

function selectStudent() {
  render(<StudentPerformance />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 's1' } });
}

describe('StudentPerformance — student profile "إجمالي المدفوع" is net of active refunds (BUG-02, remaining part)', () => {
  it('payment 1000, refund 0 -> shows 1000', () => {
    seed([{ id: 'p1', studentId: 's1', amount: 1000 }], []);
    selectStudent();
    expect(screen.getByText(formatCurrency(1000))).toBeInTheDocument();
  });

  it('payment 1000, refund 300 -> shows 700, not 1000', () => {
    seed([{ id: 'p1', studentId: 's1', amount: 1000 }], [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }]);
    selectStudent();
    expect(screen.getByText(formatCurrency(700))).toBeInTheDocument();
    expect(screen.queryByText(formatCurrency(1000))).not.toBeInTheDocument();
  });
});
