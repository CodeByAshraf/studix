// src/modules/payments/PaymentReports.test.jsx
// MEDIUM-A Finding 1 — the by-group "نسبة السداد" (payment rate) counted a payment for
// the current month number regardless of year. Verifies the year guard added to
// currentMonthRevenue (scoped to the report's own selected `year`, not just "this month").
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import PaymentReports from './PaymentReports';
import { useAppStore } from '../../store/app.store';

describe('PaymentReports — by-group payment rate is year-aware (MEDIUM-A Finding 1)', () => {
  it('does not count a payment from the same month number in a past year toward the current year\'s payment rate', () => {
    const now = new Date();
    const thisMonth = now.getMonth() + 1;
    const thisYear  = now.getFullYear();

    useAppStore.setState({
      groups: [{ id: 'g1', name: 'مجموعة أ', subject: 'رياضيات', price: 100 }],
      students: [{ id: 's1', name: 'طالب', groupId: 'g1', status: 'active', monthlyFee: 100 }],
      payments: [
        { id: 'p-old', studentId: 's1', groupId: 'g1', month: thisMonth, year: thisYear - 1, amount: 100, date: `${thisYear - 1}-01-01` },
      ],
      centerProfile: {},
    });

    render(<PaymentReports />);
    fireEvent.click(screen.getByText('حسب المجموعة'));

    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });
});
