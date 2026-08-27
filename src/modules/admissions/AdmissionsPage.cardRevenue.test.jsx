// src/modules/admissions/AdmissionsPage.cardRevenue.test.jsx
// BUG-02 — the reserved-admission card's "المدفوع" figure summed r.payments.amount
// directly, ignoring any refund recorded against a cancelled/adjusted admission payment.
// The reference source of truth (already correct elsewhere in this same file, in
// DetailsPanel) is treasury_txn linked by admissionId. The card now reuses that exact
// same derivation (getAdmissionTreasuryTotals) instead of a second, divergent calculation.
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdmissionsPage from './AdmissionsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

const ADMISSION = {
  id: 'adm_1', admissionNo: 'ADM-000001', name: 'أحمد علي', phone: '01012345678', parentPhone: '01198765432',
  grade: 'الصف الأول الثانوي', school: '', notes: '', stage: 'reserved', reservationStatus: 'reserved',
  group: 'مجموعة أ', createdAt: '2026-01-01', secretary: 'الموظف الحالي',
};
const ADMISSION_PAYMENT = {
  id: 'ap1', admissionId: 'adm_1', type: 'deposit', amount: 1000, date: '2026-01-05',
  method: 'cash', notes: null, materialId: null, treasuryTxnId: 'tx1', createdAt: '2026-01-05T00:00:00.000Z',
};

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <AdmissionsPage />
      </ToastProvider>
    </AuthProvider>
  );
}

function seed(treasuryTxn) {
  useAppStore.setState({
    admissions: [ADMISSION], admissionFollowups: [], admissionSystemLog: [], admissionPayments: [ADMISSION_PAYMENT],
    groups: [], students: [], invMaterials: [], treasuryTxn, cashboxes: [],
  });
}

function openReservedTab() {
  fireEvent.click(screen.getByText('📋 الحجز'));
}

describe('AdmissionsPage — reserved-admission card "المدفوع" is net of active refunds (BUG-02)', () => {
  it('no refund: shows the full paid amount (1000)', () => {
    seed([{ admissionId: 'adm_1', status: 'active', type: 'income', amount: 1000 }]);
    renderPage();
    openReservedTab();
    expect(screen.getByText('1000 ج.م')).toBeInTheDocument();
  });

  it('a linked refund (expense treasury_txn) of 300 -> card shows the net 700, not the gross 1000', () => {
    seed([
      { admissionId: 'adm_1', status: 'active', type: 'income', amount: 1000 },
      { admissionId: 'adm_1', status: 'active', type: 'expense', amount: 300 },
    ]);
    renderPage();
    openReservedTab();
    expect(screen.getByText('700 ج.م')).toBeInTheDocument();
    expect(screen.queryByText('1000 ج.م')).not.toBeInTheDocument();
  });

  it('a cancelled (non-active) refund transaction is never deducted', () => {
    seed([
      { admissionId: 'adm_1', status: 'active', type: 'income', amount: 1000 },
      { admissionId: 'adm_1', status: 'cancelled', type: 'expense', amount: 300 },
    ]);
    renderPage();
    openReservedTab();
    expect(screen.getByText('1000 ج.م')).toBeInTheDocument();
  });
});
