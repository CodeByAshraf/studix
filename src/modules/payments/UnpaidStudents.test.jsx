// src/modules/payments/UnpaidStudents.test.jsx
// MEDIUM-A Finding 1 — the "partial" tab's paidSoFar/remaining calculation counted any
// payment for the same month number regardless of year, hiding a real remaining balance
// once a student had a payment for that month number in a past year. Verifies the year
// guard added to both occurrences (aggregate + per-row).
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import UnpaidStudents from './UnpaidStudents';
import { useAppStore } from '../../store/app.store';
import { formatCurrency } from '../../utils/helpers';

describe('UnpaidStudents — partial-payment remaining balance is year-aware (MEDIUM-A Finding 1)', () => {
  it('excludes a payment from the same month number in a past year from paidSoFar/remaining', () => {
    const now = new Date();
    const thisMonth = now.getMonth() + 1;
    const thisYear  = now.getFullYear();

    useAppStore.setState({
      groups: [{ id: 'g1', name: 'مجموعة أ', price: 300 }],
      students: [{ id: 's1', name: 'طالب واحد', groupId: 'g1', status: 'active', monthlyFee: 300 }],
      payments: [
        { id: 'p-partial', studentId: 's1', month: thisMonth, year: thisYear, status: 'partial', amount: 100, date: `${thisYear}-01-05` },
        { id: 'p-old',     studentId: 's1', month: thisMonth, year: thisYear - 1, status: 'paid', amount: 250, date: `${thisYear - 1}-01-05` },
      ],
    });

    render(<UnpaidStudents onQuickPay={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /جزئي/ }));

    // paidSoFar الصحيح = 100 فقط (سنة حالية) — لا 350 (لو ضُمّت دفعة السنة الماضية خطأً)
    expect(screen.getByText(/دفع: 100 ج\.م/)).toBeInTheDocument();
    expect(screen.queryByText(/دفع: 350 ج\.م/)).not.toBeInTheDocument();
    // remaining الصحيح = 300-100 = 200 — لو كان الخطأ قائماً لكان 0 (العنصر لا يظهر إطلاقاً)
    expect(screen.getByText('200')).toBeInTheDocument();
  });
});

// BUG-02 (remaining part) — paidSoFar/partialRemaining summed this month's payments.amount
// directly, so a refunded partial payment kept counting as fully paid, understating the
// real remaining balance. Now nets out active refunds via getNetRevenue.
describe('UnpaidStudents — paidSoFar/partialRemaining are net of active refunds (BUG-02, remaining part)', () => {
  const now = new Date();
  const MONTH = now.getMonth() + 1;
  const YEAR = now.getFullYear();
  const GROUP = { id: 'g1', name: 'مجموعة أ', price: 1000 };
  const STUDENT = { id: 's1', name: 'طالب واحد', groupId: 'g1', status: 'active', monthlyFee: 1000 };

  it('a 300 refund on a partial payment raises the remaining balance (paidSoFar nets the refund)', () => {
    useAppStore.setState({
      groups: [GROUP], students: [STUDENT],
      payments: [{ id: 'p1', studentId: 's1', groupId: 'g1', month: MONTH, year: YEAR, status: 'partial', amount: 500 }],
      treasuryTxn: [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    });
    render(<UnpaidStudents onQuickPay={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /جزئي/ }));

    // paidSoFar الصافي = 500-300 = 200 (لا 500) -> remaining = 1000-200 = 800
    expect(screen.getByText(/دفع: 200 ج\.م/)).toBeInTheDocument();
    expect(screen.getByText('800')).toBeInTheDocument();
    expect(screen.getByText(/^متبقي:/)).toBeInTheDocument();
    expect(screen.getByText(formatCurrency(800))).toBeInTheDocument();
  });

  it('a cancelled (non-active) refund does not affect paidSoFar/remaining', () => {
    useAppStore.setState({
      groups: [GROUP], students: [STUDENT],
      payments: [{ id: 'p1', studentId: 's1', groupId: 'g1', month: MONTH, year: YEAR, status: 'partial', amount: 500 }],
      treasuryTxn: [{ paymentId: 'p1', refType: 'refund', status: 'cancelled', amount: 300 }],
    });
    render(<UnpaidStudents onQuickPay={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /جزئي/ }));

    expect(screen.getByText(/دفع: 500 ج\.م/)).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
  });
});
