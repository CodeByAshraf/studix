// src/modules/payments/PaymentForm.revenue.test.jsx
// BUG-02 (remaining part) — "متبقي هذا الشهر" (totalPaid/remaining) summed this month's
// payments.amount directly, so a refunded payment kept counting as fully paid toward the
// student's monthly fee, hiding a real remaining balance. Now nets out active refunds via
// getNetRevenue (same single source of truth used everywhere else).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PaymentForm from './PaymentForm';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

const now = new Date();
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();
const GROUP = { id: 'g1', name: 'مجموعة أ', price: 1000 };
const STUDENT = { id: 's1', name: 'طالب', groupId: 'g1', status: 'active', monthlyFee: 1000 };

function seed(payments, treasuryTxn) {
  useAppStore.setState({
    groups: [GROUP], students: [STUDENT], payments, invMaterials: [],
    cashboxes: [{ id: 'cb1', name: 'الرئيسية', active: true }], treasuryTxn,
  });
}

function renderForm() {
  return render(
    <ToastProvider>
      <PaymentForm onSubmit={() => {}} onCancel={() => {}} loading={false} prefilledStudentId="s1"/>
    </ToastProvider>
  );
}

describe('PaymentForm — "متبقي هذا الشهر" is net of active refunds (BUG-02, remaining part)', () => {
  it('a fully-paid month with no refund shows no remaining-balance hint', () => {
    seed([{ id: 'p1', studentId: 's1', groupId: 'g1', month: MONTH, year: YEAR, amount: 1000, payType: 'subscription' }], []);
    renderForm();
    expect(screen.queryByText('متبقي هذا الشهر')).not.toBeInTheDocument();
  });

  it('a 300 refund on the only monthly payment surfaces a 300 remaining-balance hint', () => {
    seed(
      [{ id: 'p1', studentId: 's1', groupId: 'g1', month: MONTH, year: YEAR, amount: 1000, payType: 'subscription' }],
      [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    );
    renderForm();
    expect(screen.getByText('متبقي هذا الشهر')).toBeInTheDocument();
    expect(screen.getByText('300 ج.م')).toBeInTheDocument();
  });

  it('a cancelled (non-active) refund transaction does not create a remaining balance', () => {
    seed(
      [{ id: 'p1', studentId: 's1', groupId: 'g1', month: MONTH, year: YEAR, amount: 1000, payType: 'subscription' }],
      [{ paymentId: 'p1', refType: 'refund', status: 'cancelled', amount: 300 }],
    );
    renderForm();
    expect(screen.queryByText('متبقي هذا الشهر')).not.toBeInTheDocument();
  });
});
