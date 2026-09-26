// src/modules/students/StudentProfile.revenue.test.jsx
// BUG-02 (remaining part) — both the header "إجمالي المدفوع" stat pill and the Payments
// tab's "إجمالي المدفوعات" stat summed payments.amount directly. Now both use the shared
// getNetRevenue() helper.
//
// Scalability Architecture Phase 4 Cutover 2: StudentProfile.jsx now fetches
// GET /api/payments?studentId= once and feeds it to both the header stat and the
// Payments tab, instead of reading the store's payments array directly. We mock fetch
// directly (same technique as PaymentsPage.payments.test.jsx).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentProfile from './StudentProfile';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';
import { formatCurrency } from '../../utils/helpers';

const STUDENT = { id: 's1', name: 'أحمد', status: 'active', grade: 'الأول الثانوي', code: 'C1', phone: '', parentPhone: '' };

function mockPaymentsFetch(payments) {
  globalThis.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.includes('/api/payments?')) {
      const qp = new URL(u).searchParams;
      const studentId = qp.get('studentId');
      let rows = payments;
      if (studentId) rows = rows.filter((p) => p.studentId === studentId);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: rows }) });
    }
    return Promise.reject(new Error(`unexpected fetch: ${u}`));
  });
}
afterEach(() => { vi.restoreAllMocks(); });

function seedStoreOnly(treasuryTxn) {
  useAppStore.setState({
    students: [STUDENT], groups: [], attendance: [], grades: [], exams: [], parents: [], treasuryTxn,
  });
}

function renderProfile() {
  return render(
    <ToastProvider>
      <StudentProfile studentId="s1" onBack={() => {}} onEdit={() => {}} />
    </ToastProvider>
  );
}

describe('StudentProfile — header + Payments-tab "إجمالي المدفوع" are net of active refunds (BUG-02, remaining part)', () => {
  it('payment 1000, refund 300 -> header stat pill shows 700', async () => {
    seedStoreOnly([{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }]);
    mockPaymentsFetch([{ id: 'p1', studentId: 's1', amount: 1000, status: 'paid', date: '2026-01-01' }]);

    renderProfile();

    expect(await screen.findByText(formatCurrency(700))).toBeInTheDocument();
    expect(screen.queryByText(formatCurrency(1000))).not.toBeInTheDocument();
  });

  it('the Payments tab total is also net of the same refund', async () => {
    seedStoreOnly([{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }]);
    mockPaymentsFetch([{ id: 'p1', studentId: 's1', amount: 1000, status: 'paid', date: '2026-01-01' }]);

    renderProfile();
    await screen.findByText(formatCurrency(700)); // header first (already-loaded fetch)
    fireEvent.click(screen.getByText('المدفوعات'));

    // كلا الرقمين (الرأس وتبويب المدفوعات) صافيان الآن = 700
    expect(screen.getAllByText(formatCurrency(700)).length).toBeGreaterThanOrEqual(2);
  });

  it('regression: no refund -> both remain 1000', async () => {
    seedStoreOnly([]);
    mockPaymentsFetch([{ id: 'p1', studentId: 's1', amount: 1000, status: 'paid', date: '2026-01-01' }]);

    renderProfile();

    expect(await screen.findByText(formatCurrency(1000))).toBeInTheDocument();
  });

  // Phase 4 Cutover 2 explicit instruction: do NOT "fix" the pre-existing difference
  // between the header total (all statuses) and the Payments-tab total (excludes
  // status==='unpaid') — this proves the migration preserved that exact discrepancy
  // rather than accidentally unifying the two numbers.
  it('preserves the existing header-vs-tab discrepancy: header includes an unpaid-status row, the Payments tab excludes it', async () => {
    seedStoreOnly([]);
    mockPaymentsFetch([
      { id: 'p1', studentId: 's1', amount: 1000, status: 'paid', date: '2026-01-01' },
      { id: 'p2', studentId: 's1', amount: 500, status: 'unpaid', date: '2026-02-01' },
    ]);

    renderProfile();

    // الرأس: صافي كل الحالات = 1000 + 500 = 1500
    expect(await screen.findByText(formatCurrency(1500))).toBeInTheDocument();

    fireEvent.click(screen.getByText('المدفوعات'));

    // تبويب المدفوعات: يستبعد status==='unpaid' -> 1000 فقط (يظهر مرّتين: بطاقة
    // الإحصائية + صفّ الجدول). الرأس (أعلى الصفحة، يبقى ظاهراً بغضّ النظر عن التبويب
    // النشط) لا يزال يعرض 1500 — الرقمان مختلفان فعلياً، بلا أي توحيد بينهما (سلوك
    // حالي مقصود، غير مُصلَح هنا).
    expect((await screen.findAllByText(formatCurrency(1000))).length).toBeGreaterThan(0);
    expect(screen.getByText(formatCurrency(1500))).toBeInTheDocument();
  });
});
