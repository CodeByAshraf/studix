// src/modules/groups/GroupsPage.revenue.test.jsx
// BUG-02 (remaining part) — the "الإيراد الكلي" overview KPI and the list-view per-group
// revenue column both summed payments.amount directly, bypassing any refund check. Now
// both use the shared getNetRevenue() helper (same single source of truth used everywhere
// else in the app).
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import GroupsPage from './GroupsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';
import { formatCurrency } from '../../utils/helpers';

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <GroupsPage />
      </ToastProvider>
    </AuthProvider>
  );
}

const GROUP = { id: 'g1', name: 'مجموعة أ', subject: 'رياضيات', grade: 'الأول الثانوي', teacher: 'أ. محمد', price: 1000, max: 30, days: [], time: '5:00' };

function seed(payments, treasuryTxn) {
  useAppStore.setState({
    groups: [GROUP], students: [{ id: 's1', name: 'طالب', groupId: 'g1', status: 'active' }],
    payments, treasuryTxn, attendance: [], admissions: [], communications: [], exams: [], homeworks: [],
  });
}

describe('GroupsPage — OverviewBar "الإيراد الكلي" is net of active refunds (BUG-02, remaining part)', () => {
  it('payment 1000, refund 0 -> shows 1000', () => {
    seed([{ id: 'p1', studentId: 's1', groupId: 'g1', amount: 1000, status: 'paid' }], []);
    renderPage();
    expect(screen.getByText(formatCurrency(1000))).toBeInTheDocument();
  });

  it('payment 1000, refund 300 -> shows 700, not 1000', () => {
    seed(
      [{ id: 'p1', studentId: 's1', groupId: 'g1', amount: 1000, status: 'paid' }],
      [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    );
    renderPage();
    expect(screen.getByText(formatCurrency(700))).toBeInTheDocument();
    expect(screen.queryByText(formatCurrency(1000))).not.toBeInTheDocument();
  });
});

describe('GroupsPage — list view per-group revenue is net of active refunds (BUG-02, remaining part)', () => {
  it('a refunded payment reduces the group\'s list-row revenue', () => {
    seed(
      [{ id: 'p1', studentId: 's1', groupId: 'g1', amount: 1000, status: 'paid' }],
      [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }],
    );
    renderPage();
    fireEvent.click(screen.getByText('≡ قائمة'));
    expect(screen.getByText(formatCurrency(700).replace(' ج.م', ''))).toBeInTheDocument();
  });
});
