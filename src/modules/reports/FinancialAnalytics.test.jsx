// src/modules/reports/FinancialAnalytics.test.jsx
// MEDIUM-A Finding 1 — "لم يدفعوا هذا الشهر" (unpaidCount) treated a payment for the
// same month number in a PAST year as "paid this month", hiding a genuinely-unpaid
// student from this KPI. Verifies the year guard added to paidThisMonth.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FinancialAnalytics from './FinancialAnalytics';
import { useAppStore } from '../../store/app.store';

describe('FinancialAnalytics — unpaidCount is year-aware (MEDIUM-A Finding 1)', () => {
  it('counts an active student as unpaid this month even if they paid the same month number last year', () => {
    const now = new Date();
    const thisMonth = now.getMonth() + 1;
    const thisYear  = now.getFullYear();

    useAppStore.setState({
      groups: [],
      students: [{ id: 's1', name: 'طالب', status: 'active' }],
      payments: [
        { id: 'p-old', studentId: 's1', month: thisMonth, year: thisYear - 1, status: 'paid', amount: 100, date: `${thisYear - 1}-01-01` },
      ],
    });

    render(<FinancialAnalytics />);

    const label = screen.getByText('لم يدفعوا هذا الشهر');
    const valueDiv = label.closest('div').nextElementSibling;
    expect(valueDiv).toHaveTextContent('1');
  });
});
