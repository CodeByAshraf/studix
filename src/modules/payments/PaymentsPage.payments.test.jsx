// src/modules/payments/PaymentsPage.payments.test.jsx
// Phase 3B-14C — payments' first real PostgreSQL write paths: atomic create
// (POST /api/payments) and atomic full refund (POST /api/payments/:id/refund). We mock
// fetch directly (not the api.js module) so we verify the real, unmocked requests
// PaymentsPage builds — same technique used throughout this migration series
// (TreasuryPage.treasuryTxn.test.jsx, AdmissionsPage.activation.test.jsx).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PaymentsPage from './PaymentsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

let fetchMock;
let postPaymentResponder;   // POST /api/payments
let refundResponder;        // POST /api/payments/:id/refund

function okJson(data, status = 200) {
  return { ok: true, status, json: async () => ({ ok: true, data }) };
}
function errJson(status, error) {
  return { ok: false, status, json: async () => ({ ok: false, error }) };
}

const CB1 = {
  id: 'cb1', name: 'الرئيسية', type: 'main', color: '#0d9488', icon: '🏦',
  openingBalance: 1000, isDefault: true, active: true, notes: '', createdAt: '2026-01-01',
};
const GROUP1 = { id: 'g1', name: 'مجموعة أ', price: 300 };
const STUDENT1 = { id: 's1', name: 'أحمد', code: 'C1', groupId: 'g1', status: 'active' };

const EXISTING_PAYMENT = {
  id: 'p1', studentId: 's1', groupId: 'g1', materialId: null, month: 1, year: 2026,
  amount: 300, method: 'cash', payType: 'subscription', date: '2026-01-05',
  status: 'paid', notes: null, treasuryTxnId: 'tx1', createdAt: '2026-01-05T00:00:00.000Z',
};
const EXISTING_TXN = {
  id: 'tx1', cashboxId: 'cb1', date: '2026-01-05', type: 'income', category: 'subscriptions',
  description: 'اشتراك أحمد', amount: 300, method: 'cash', party: 'أحمد', notes: null,
  refType: 'payment', refId: 'p1', paymentId: 'p1', status: 'active', createdBy: 'u1',
  createdAt: '2026-01-05T00:00:00.000Z',
};

beforeEach(() => {
  postPaymentResponder = (body) => okJson({
    payment: { id: 'srv-p-1', studentId: body.studentId, groupId: body.groupId ?? null, materialId: body.materialId ?? null, month: Number(body.month), year: Number(body.year), amount: Number(body.amount), method: body.method, payType: body.payType, date: body.date, status: 'paid', notes: body.notes ?? null, treasuryTxnId: 'srv-tx-1', createdAt: '2026-01-10T00:00:00.000Z' },
    treasuryTxn: { id: 'srv-tx-1', cashboxId: body.cashboxId, date: body.date, type: 'income', category: 'subscriptions', notes: 'اشتراك أحمد', amount: Number(body.amount), method: body.method, party: 'أحمد', refType: 'payment', refId: 'srv-p-1', paymentId: 'srv-p-1', status: 'active', createdBy: 'u1', createdAt: '2026-01-10T00:00:00.000Z' },
  }, 201);

  refundResponder = (id, body) => okJson({
    refundTxn: { id: 'srv-refund-1', cashboxId: 'cb1', date: '2026-01-10', type: 'expense', category: 'refund', notes: body.reason, amount: Number(body.amount), method: 'cash', party: 'أحمد', refType: 'refund', refId: id, paymentId: id, status: 'active', createdBy: 'u1', createdAt: '2026-01-10T00:00:00.000Z' },
    payment: EXISTING_PAYMENT,
    totalRefunded: Number(body.amount),
  });

  fetchMock = vi.fn((url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (u.endsWith('/api/payments') && method === 'POST') return Promise.resolve(postPaymentResponder(body));
    if (u.includes('/api/payments/') && u.endsWith('/refund') && method === 'POST') {
      const id = decodeURIComponent(u.split('/api/payments/')[1].replace('/refund', ''));
      return Promise.resolve(refundResponder(id, body));
    }
    // Phase 3B-15: addLog يستدعي هذا فعلياً الآن — best-effort، لا نختبره هنا تحديداً.
    if (u.endsWith('/api/activityLogs') && method === 'POST') {
      return Promise.resolve(okJson({ id: 'al-1', timestamp: '2026-01-10T00:00:00.000Z', ...body }, 201));
    }
    return Promise.reject(new Error(`unexpected fetch: ${method} ${u}`));
  });
  globalThis.fetch = fetchMock;
});
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
function seedStore(extra = {}) {
  useAppStore.setState({
    cashboxes: [CB1], groups: [GROUP1], students: [STUDENT1],
    payments: [], treasuryTxn: [], ...extra,
  });
}
function callsTo(matcher) {
  return fetchMock.mock.calls.filter(([url, opts]) => matcher(String(url), opts));
}
const postPaymentCalls = () => callsTo((u, o) => u.endsWith('/api/payments') && o?.method === 'POST');
const refundCalls       = () => callsTo((u, o) => u.includes('/api/payments/') && u.endsWith('/refund') && o?.method === 'POST');
const anyDeleteCalls    = () => callsTo((u, o) => o?.method === 'DELETE');

function fillAddForm({ cashboxId = 'cb1', amount = '300' } = {}) {
  fireEvent.click(screen.getByText('+ تسجيل دفعة'));
  const selects = screen.getAllByRole('combobox');
  fireEvent.change(selects.find(sel => sel.name === 'studentId'), { target: { value: 's1' } });
  // placeholder المبلغ ديناميكي (رسوم الطالب/المجموعة) — GROUP1.price=300 هنا
  fireEvent.change(screen.getByPlaceholderText('300'), { target: { value: amount } });
  if (cashboxId) {
    fireEvent.change(screen.getAllByRole('combobox').find(sel => sel.name === 'cashboxId'), { target: { value: cashboxId } });
  }
}

describe('PaymentsPage — payments write flows (Phase 3B-14C)', () => {
  it('successful atomic payment creation: exact request contract, no premature mutation, adopts server response (payment + treasuryTxn together)', async () => {
    let resolvePost;
    postPaymentResponder = () => new Promise((resolve) => { resolvePost = resolve; });

    seedStore();
    renderPage();
    fillAddForm();
    fireEvent.click(screen.getByText('💰 تسجيل الدفعة'));

    await waitFor(() => expect(postPaymentCalls()).toHaveLength(1));
    const [, sentOpts] = postPaymentCalls()[0];
    const sentBody = JSON.parse(sentOpts.body);
    expect(sentBody.studentId).toBe('s1');
    expect(sentBody.cashboxId).toBe('cb1');
    expect(sentBody.amount).toBe(300);
    expect(sentBody.groupId).toBe('g1');
    // لا id/status يُرسَلان من العميل كسلطة — الخادم يتجاهلهما ويحسبهما بنفسه
    expect(sentBody.id).toBeUndefined();
    expect(sentBody.status).toBeUndefined();

    // لا تعديل محلي قبل نجاح الاستدعاء
    expect(useAppStore.getState().payments).toEqual([]);
    expect(useAppStore.getState().treasuryTxn).toEqual([]);

    resolvePost(okJson({
      payment: { id: 'srv-p-1', studentId: 's1', groupId: 'g1', materialId: null, month: sentBody.month, year: sentBody.year, amount: 300, method: 'cash', payType: 'subscription', date: sentBody.date, status: 'paid', notes: null, treasuryTxnId: 'srv-tx-1', createdAt: '2026-01-10T00:00:00.000Z' },
      treasuryTxn: { id: 'srv-tx-1', cashboxId: 'cb1', date: sentBody.date, type: 'income', category: 'subscriptions', notes: 'اشتراك أحمد', amount: 300, method: 'cash', party: 'أحمد', refType: 'payment', refId: 'srv-p-1', paymentId: 'srv-p-1', status: 'active', createdBy: 'u1', createdAt: '2026-01-10T00:00:00.000Z' },
    }, 201));

    // خادم-الحقيقة: بعد النجاح، الدفعة والحركة المرتبطة تُتبنَّيان معاً
    await waitFor(() => expect(useAppStore.getState().payments).toHaveLength(1));
    expect(useAppStore.getState().payments[0].id).toBe('srv-p-1');
    expect(useAppStore.getState().treasuryTxn).toHaveLength(1);
    expect(useAppStore.getState().treasuryTxn[0].id).toBe('srv-tx-1');
    expect(useAppStore.getState().treasuryTxn[0].refType).toBe('payment');
    // نداء واحد فقط لـ /api/payments (لا تكرار) — نداء ثانٍ منفصل لـ addLog (Phase
    // 3B-15، best-effort، لا يُختبَر هنا تحديداً) هو المتوقَّع الوحيد الإضافي.
    expect(postPaymentCalls()).toHaveLength(1);
  });

  it('creation failure: leaves both payments and treasuryTxn completely untouched', async () => {
    postPaymentResponder = () => errJson(400, 'الخزنة المحدَّدة غير موجودة أو غير نشطة.');

    seedStore();
    renderPage();
    fillAddForm();
    fireEvent.click(screen.getByText('💰 تسجيل الدفعة'));

    await waitFor(() => expect(postPaymentCalls()).toHaveLength(1));
    expect(useAppStore.getState().payments).toEqual([]);
    expect(useAppStore.getState().treasuryTxn).toEqual([]);
  });

  it('cashbox selection: no active cashbox available blocks submission entirely — zero fetch calls', async () => {
    seedStore({ cashboxes: [{ ...CB1, active: false }] });
    renderPage();
    fireEvent.click(screen.getByText('+ تسجيل دفعة'));

    expect(await screen.findByText((t) => t.includes('لا توجد خزنة نشطة'))).toBeInTheDocument();
    // زر التسجيل معطّل بلا خزنة نشطة — لا محاولة إرسال ممكنة إطلاقاً
    expect(screen.getByText('💰 تسجيل الدفعة').closest('button')).toBeDisabled();
    expect(postPaymentCalls()).toHaveLength(0);
  });

  it('full refund (replaces old delete-payment): single POST to /:id/refund with a reason, no cashboxId sent (server always uses the original payment\'s own cashbox), adopts only the new refund treasuryTxn, original payment object stays byte-for-byte unchanged (immutability)', async () => {
    let resolveRefund;
    refundResponder = () => new Promise((resolve) => { resolveRefund = resolve; });

    seedStore({ payments: [EXISTING_PAYMENT], treasuryTxn: [EXISTING_TXN] });
    renderPage();
    fireEvent.click(screen.getByText('سجل المدفوعات'));
    fireEvent.click(await screen.findByTitle('استرداد كامل'));
    fireEvent.change(screen.getByPlaceholderText('مثال: خطأ في التسجيل'), { target: { value: 'خطأ في التسجيل فعلاً' } });
    fireEvent.click(screen.getByText('تأكيد الاسترداد الكامل'));

    await waitFor(() => expect(refundCalls()).toHaveLength(1));
    const [sentUrl, sentOpts] = refundCalls()[0];
    expect(decodeURIComponent(sentUrl.split('/api/payments/')[1].replace('/refund', ''))).toBe('p1');
    const sentBody = JSON.parse(sentOpts.body);
    expect(sentBody.amount).toBe(300); // كامل المبلغ المتبقي
    expect(sentBody.reason).toBe('خطأ في التسجيل فعلاً');
    // قرار صريح: لا cashboxId يُرسَل من العميل عند الاسترداد إطلاقاً — نفس خزنة الدفعة
    // الأصلية تُستخدَم على الخادم دائماً، لا إعادة اختيار.
    expect(sentBody.cashboxId).toBeUndefined();

    // لا تعديل محلي قبل النجاح — الدفعة الأصلية كما هي تماماً حتى الآن
    expect(useAppStore.getState().payments).toEqual([EXISTING_PAYMENT]);

    resolveRefund(okJson({
      refundTxn: { id: 'srv-refund-1', cashboxId: 'cb1', date: '2026-01-10', type: 'expense', category: 'refund', notes: 'خطأ في التسجيل فعلاً', amount: 300, method: 'cash', party: 'أحمد', refType: 'refund', refId: 'p1', paymentId: 'p1', status: 'active', createdBy: 'u1', createdAt: '2026-01-10T00:00:00.000Z' },
      payment: EXISTING_PAYMENT,
      totalRefunded: 300,
    }));

    await waitFor(() => expect(useAppStore.getState().treasuryTxn).toHaveLength(2));
    // الدفعة الأصلية لم تُعدَّل بأي حقل إطلاقاً — لا حذف، لا تعديل (immutable)
    expect(useAppStore.getState().payments).toEqual([EXISTING_PAYMENT]);
    const refundTxn = useAppStore.getState().treasuryTxn.find(t => t.id === 'srv-refund-1');
    expect(refundTxn.refType).toBe('refund');
    expect(refundTxn.paymentId).toBe('p1');
    expect(refundTxn.cashboxId).toBe('cb1'); // نفس خزنة الحركة الأصلية EXISTING_TXN
    expect(refundCalls()).toHaveLength(1);
  });

  it('refund failure: leaves payments and treasuryTxn completely untouched', async () => {
    refundResponder = () => errJson(400, 'مبلغ الاسترداد أكبر من المتبقي القابل للاسترداد.');

    seedStore({ payments: [EXISTING_PAYMENT], treasuryTxn: [EXISTING_TXN] });
    renderPage();
    fireEvent.click(screen.getByText('سجل المدفوعات'));
    fireEvent.click(await screen.findByTitle('استرداد كامل'));
    fireEvent.change(screen.getByPlaceholderText('مثال: خطأ في التسجيل'), { target: { value: 'محاولة فاشلة' } });
    fireEvent.click(screen.getByText('تأكيد الاسترداد الكامل'));

    await waitFor(() => expect(refundCalls()).toHaveLength(1));
    expect(useAppStore.getState().payments).toEqual([EXISTING_PAYMENT]);
    expect(useAppStore.getState().treasuryTxn).toEqual([EXISTING_TXN]);
  });

  it('no DELETE request is ever issued by this page — hard delete has no UI path anymore', async () => {
    seedStore({ payments: [EXISTING_PAYMENT], treasuryTxn: [EXISTING_TXN] });
    renderPage();
    fireEvent.click(screen.getByText('سجل المدفوعات'));
    fireEvent.click(await screen.findByTitle('استرداد كامل'));
    fireEvent.click(screen.getByText('إلغاء'));

    expect(anyDeleteCalls()).toHaveLength(0);
  });

  // MEDIUM-A Finding 1: "alreadyPaidSubscription" (PaymentForm.jsx) كان يقارن الشهر فقط
  // بلا سنة — طالب دفع اشتراك شهر رقم N في سنة سابقة كان يُمنَع من دفع نفس رقم الشهر في
  // سنة جديدة. هذان الاختباران يثبتان: يُمنَع فعلاً لنفس السنة، ولا يُمنَع لسنة مختلفة.
  describe('duplicate-subscription guard is year-aware (MEDIUM-A Finding 1)', () => {
    it('blocks a second subscription payment for the same student/month/year', async () => {
      const now = new Date();
      const thisMonth = now.getMonth() + 1;
      const thisYear  = now.getFullYear();
      const SAME_YEAR_PAYMENT = {
        id: 'p-same', studentId: 's1', groupId: 'g1', materialId: null, month: thisMonth, year: thisYear,
        amount: 300, method: 'cash', payType: 'subscription', date: `${thisYear}-01-05`, status: 'paid',
        notes: null, treasuryTxnId: 'tx-same', createdAt: `${thisYear}-01-05T00:00:00.000Z`,
      };
      seedStore({ payments: [SAME_YEAR_PAYMENT] });
      renderPage();
      fireEvent.click(screen.getByText('+ تسجيل دفعة'));
      const selects = screen.getAllByRole('combobox');
      fireEvent.change(selects.find(sel => sel.name === 'studentId'), { target: { value: 's1' } });

      expect(await screen.findByText(/دفع اشتراك.*من قبل/)).toBeInTheDocument();
      expect(postPaymentCalls()).toHaveLength(0);
    });

    it('does NOT block a subscription payment for the same month number in a different year', async () => {
      const now = new Date();
      const thisMonth = now.getMonth() + 1;
      const thisYear  = now.getFullYear();
      const OLD_YEAR_PAYMENT = {
        id: 'p-old', studentId: 's1', groupId: 'g1', materialId: null, month: thisMonth, year: thisYear - 1,
        amount: 300, method: 'cash', payType: 'subscription', date: `${thisYear - 1}-01-05`, status: 'paid',
        notes: null, treasuryTxnId: 'tx-old', createdAt: `${thisYear - 1}-01-05T00:00:00.000Z`,
      };
      seedStore({ payments: [OLD_YEAR_PAYMENT] });
      renderPage();
      fillAddForm();

      expect(screen.queryByText(/دفع اشتراك.*من قبل/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByText('💰 تسجيل الدفعة'));

      await waitFor(() => expect(postPaymentCalls()).toHaveLength(1));
    });
  });
});
