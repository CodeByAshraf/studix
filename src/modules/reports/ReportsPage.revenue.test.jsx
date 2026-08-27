// src/modules/reports/ReportsPage.revenue.test.jsx
// BUG-02 (remaining part) — the "نظرة عامة" overview dashboard's "إيراد هذا الشهر" and the
// "من إجمالي ..." subtitle both summed payments.amount directly, bypassing any refund
// check. Now both use the shared getNetRevenue() helper.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReportsPage from './ReportsPage';
import { useAppStore } from '../../store/app.store';
import { formatCurrency } from '../../utils/helpers';

function seed(payments, treasuryTxn) {
  useAppStore.setState({
    groups: [], students: [{ id: 's1', name: 'طالب', status: 'active' }],
    payments, treasuryTxn, attendance: [], grades: [], exams: [],
  });
}

describe('ReportsPage — overview "إيراد هذا الشهر" / "من إجمالي" are net of active refunds (BUG-02, remaining part)', () => {
  it('payment 1000, refund 0 -> both show 1000', () => {
    const month = new Date().getMonth() + 1;
    const year = new Date().getFullYear();
    seed([{ id: 'p1', studentId: 's1', amount: 1000, month, year, status: 'paid' }], []);
    render(<ReportsPage />);
    expect(screen.getByText(formatCurrency(1000))).toBeInTheDocument();
    expect(screen.getByText(`من إجمالي ${formatCurrency(1000)}`)).toBeInTheDocument();
  });

  it('payment 1000, refund 300 -> both show 700, not 1000', () => {
    const month = new Date().getMonth() + 1;
    const year = new Date().getFullYear();
    seed(
      [{ id: 'p1', studentId: 's1', amount: 1000, month, year, status: 'paid' }],
      [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    );
    render(<ReportsPage />);
    expect(screen.getByText(formatCurrency(700))).toBeInTheDocument();
    expect(screen.getByText(`من إجمالي ${formatCurrency(700)}`)).toBeInTheDocument();
    expect(screen.queryByText(formatCurrency(1000))).not.toBeInTheDocument();
  });
});
