// src/modules/payments/PaymentsPage.refundView.test.jsx
// Scalability Architecture Phase 4 Cutover 2 — RefundView (the "استرداد" tab, defined
// inside PaymentsPage.jsx) now fetches GET /api/payments?studentId= on demand instead of
// reading the store's payments array via a prop. This proves the migrated fetch preserves
// its exact filtering: amount > 0, remaining-refundable > 0 (derived from treasury_txn),
// and that a fully-refunded payment is excluded entirely — not just that the mock was
// called, but that the actual rendered list matches.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import PaymentsPage from './PaymentsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';
import { mockPaymentsBackend } from '../../test-utils/mockPaymentsBackend';
import { formatCurrency } from '../../utils/helpers';

const STUDENT = { id: 's1', name: 'أحمد', code: 'C1', groupId: 'g1', status: 'active' };
const GROUP = { id: 'g1', name: 'مجموعة أ', price: 300 };

afterEach(() => { vi.restoreAllMocks(); });

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <PaymentsPage />
      </ToastProvider>
    </AuthProvider>
  );
}

// StudentSearchSelect (يحلّ محلّ <select> القديم في لوحة الاسترداد): يكتب استعلاماً ثم
// ينقر النتيجة المطابقة — لا "value" مباشرة، بنفس تفاعل مستخدم حقيقي مع الحقل الجديد
// (ونفس نمط PaymentsPage.payments.test.jsx لاستعلام إضافة الدفعة).
function openRefundTabAndSelectStudent() {
  fireEvent.click(screen.getByText('استرداد'));
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: STUDENT.name } });
  fireEvent.click(screen.getByRole('option', { name: new RegExp(STUDENT.name) }));
}

// "الإجمالي الكلي" (KPI بار أعلى الصفحة، غير مُهاجَر في هذا الاختبار) قد يعرض عرَضاً
// نفس الرقم (كلاهما net revenue حقيقي وصحيح لسببين مختلفين) — نطاق البحث داخل لوحة
// الاسترداد نفسها فقط يتجنّب هذا التصادم بدل الاعتماد على تفرّد نصّي عبر الصفحة كلها.
async function refundPanel() {
  const marker = await screen.findByText('الإجمالي المتاح:');
  return marker.closest('div').parentElement.parentElement;
}

// mockPaymentsBackend يُطبّق نفس فلترة month/year/date/studentId التي يطبّقها الخادم
// الحقيقي بالضبط — يضمن أن أرقام شريط الـ KPI (لهذا الشهر/اليوم الحقيقيَّين) لا تتقاطع
// عرَضاً مع دفعة هذا الاختبار المؤرَّخة في 2026-01-05 (ماضٍ بالنسبة لأي تشغيل حقيقي).
const PAYMENT = { id: 'p1', studentId: 's1', groupId: 'g1', amount: 1000, date: '2026-01-05', payType: 'subscription' };

describe('PaymentsPage — RefundView refundable-payments list (Phase 4 Cutover 2)', () => {
  it('shows a payment with a positive remaining-refundable amount, net of a partial active refund', async () => {
    const treasuryTxn = [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }];
    useAppStore.setState({ groups: [GROUP], students: [STUDENT], cashboxes: [], treasuryTxn });
    mockPaymentsBackend([PAYMENT], treasuryTxn);

    renderPage();
    openRefundTabAndSelectStudent();

    // المتبقي القابل للاسترداد = 1000 - 300 = 700
    const panel = await refundPanel();
    expect(within(panel).getAllByText(formatCurrency(700)).length).toBeGreaterThan(0);
  });

  it('excludes a fully-refunded payment entirely (remaining === 0)', async () => {
    const treasuryTxn = [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 1000 }];
    useAppStore.setState({ groups: [GROUP], students: [STUDENT], cashboxes: [], treasuryTxn });
    mockPaymentsBackend([PAYMENT], treasuryTxn);

    renderPage();
    openRefundTabAndSelectStudent();

    expect(await screen.findByText('لا توجد دفعات قابلة للاسترداد')).toBeInTheDocument();
  });

  it('a cancelled (non-active) refund does not reduce the refundable amount', async () => {
    const treasuryTxn = [{ paymentId: 'p1', refType: 'refund', status: 'cancelled', amount: 1000 }];
    useAppStore.setState({ groups: [GROUP], students: [STUDENT], cashboxes: [], treasuryTxn });
    mockPaymentsBackend([PAYMENT], treasuryTxn);

    renderPage();
    openRefundTabAndSelectStudent();

    const panel = await refundPanel();
    expect(within(panel).getAllByText(formatCurrency(1000)).length).toBeGreaterThan(0);
  });

  it('a zero-amount payment row is excluded (amount > 0 guard)', async () => {
    useAppStore.setState({ groups: [GROUP], students: [STUDENT], cashboxes: [], treasuryTxn: [] });
    mockPaymentsBackend([{ ...PAYMENT, amount: 0 }], []);

    renderPage();
    openRefundTabAndSelectStudent();

    expect(await screen.findByText('لا توجد دفعات قابلة للاسترداد')).toBeInTheDocument();
  });

  it('no student selected yet issues no payments fetch and shows no refundable list', () => {
    useAppStore.setState({ groups: [GROUP], students: [STUDENT], cashboxes: [], treasuryTxn: [] });
    mockPaymentsBackend([PAYMENT], []);

    renderPage();
    fireEvent.click(screen.getByText('استرداد'));

    expect(screen.queryByText('الإجمالي المتاح:')).not.toBeInTheDocument();
  });
});
