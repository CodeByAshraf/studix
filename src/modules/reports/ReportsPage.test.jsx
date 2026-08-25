// src/modules/reports/ReportsPage.test.jsx
// MEDIUM-A Finding 1 — "هذا الشهر" (overview payments quick-stat) filtered by month
// number only, counting the same calendar month across every past year. Verifies the
// year guard added to ReportsPage.jsx's OverviewDashboard.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReportsPage from './ReportsPage';
import { useAppStore } from '../../store/app.store';

describe('ReportsPage — overview payments quick-stat is year-aware (MEDIUM-A Finding 1)', () => {
  it('"هذا الشهر" only counts payments from the current month AND current year, not the same month number in a past year', () => {
    const now = new Date();
    const thisMonth = now.getMonth() + 1;
    const thisYear  = now.getFullYear();

    useAppStore.setState({
      students: [], groups: [], attendance: [], grades: [], exams: [],
      payments: [
        { id: 'p-this', studentId: 's1', month: thisMonth, year: thisYear, amount: 100, date: `${thisYear}-01-01` },
        { id: 'p-old',  studentId: 's1', month: thisMonth, year: thisYear - 1, amount: 100, date: `${thisYear - 1}-01-01` },
      ],
    });

    render(<ReportsPage />);

    const label = screen.getByText('هذا الشهر');
    const valueSpan = label.parentElement.querySelector('span:last-child');
    expect(valueSpan).toHaveTextContent('1');
  });
});
