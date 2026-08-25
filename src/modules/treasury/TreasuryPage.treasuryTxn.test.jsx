// src/modules/treasury/TreasuryPage.treasuryTxn.test.jsx
// Phase 3B-14B — treasury_txn's first real PostgreSQL write paths: a simple manual
// entry (generic CRUD, POST /api/treasuryTxn), and two dedicated atomic endpoints
// (PUT /api/treasuryTxn/:id/reverse, POST /api/treasuryTxn/transfer). We mock fetch
// directly (not the api.js module) so we verify the real, unmocked requests
// TreasuryPage builds — same technique used throughout this migration series.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TreasuryPage, { __resetCashboxSyncGuardForTests } from './TreasuryPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

let fetchMock;
let postTxnResponder;   // POST /api/treasuryTxn
let reverseResponder;   // PUT /api/treasuryTxn/:id/reverse
let transferResponder;  // POST /api/treasuryTxn/transfer

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
const CB2 = {
  id: 'cb2', name: 'الفرع', type: 'branch', color: '#3b82f6', icon: '🏪',
  openingBalance: 500, isDefault: false, active: true, notes: '', createdAt: '2026-01-01',
};
const EXISTING_TXN = {
  id: 'tx1', cashboxId: 'cb1', date: '2026-01-05', type: 'income', category: 'subscriptions',
  description: 'اشتراك أحمد', amount: 200, method: 'cash', party: 'أحمد', notes: '',
  refType: null, refId: null, status: 'active', createdBy: 'u1',
  createdAt: '2026-01-05T00:00:00.000Z', balance: 0,
};

// treasury_txn لا عمود description لها إطلاقاً في القاعدة الحيّة (اكتُشف فعلياً أثناء
// هذه المرحلة — انظر api.js/treasuryTxn.js) — كل استجابات الخادم المُحاكاة أدناه تعكس
// الشكل الخام الحقيقي (notes فقط، لا description) لتبقى العقود المُختبَرة صادقة.
beforeEach(() => {
  // Product Completion Phase 1, Issue 2: TreasuryPage also fires a background cb_main
  // sync POST on mount (see TreasuryPage.cashboxSync.test.jsx). Reset the module-level
  // once-per-session guard so this file's tests are deterministic regardless of order.
  __resetCashboxSyncGuardForTests();
  postTxnResponder = (body) => okJson({ id: 'srv-tx-1', ...body, status: 'active', createdAt: '2026-01-10T00:00:00.000Z' }, 201);
  reverseResponder = (id, body) => okJson({
    original: { id, cashboxId: EXISTING_TXN.cashboxId, date: EXISTING_TXN.date, type: EXISTING_TXN.type, category: EXISTING_TXN.category, amount: EXISTING_TXN.amount, method: EXISTING_TXN.method, party: EXISTING_TXN.party, notes: EXISTING_TXN.description, status: 'cancelled', createdBy: 'u1', createdAt: EXISTING_TXN.createdAt },
    reversal: {
      id: 'srv-rev-1', cashboxId: EXISTING_TXN.cashboxId, date: '2026-01-10', type: 'expense',
      category: EXISTING_TXN.category, amount: EXISTING_TXN.amount, method: EXISTING_TXN.method, party: EXISTING_TXN.party,
      notes: body.reason, refType: 'reversal', refId: id, status: 'active', createdBy: 'u1',
      createdAt: '2026-01-10T00:00:00.000Z',
    },
  });
  transferResponder = (body) => okJson({
    outTxn: {
      id: 'srv-out-1', cashboxId: body.fromCashboxId, date: body.date, type: 'expense', category: 'transfer',
      amount: Number(body.amount), method: body.method || 'cash', party: 'الفرع',
      notes: body.description || 'تحويل داخلي', refType: 'transfer', refId: 'srv-transfer-1', status: 'active', createdBy: 'u1', createdAt: '2026-01-10T00:00:00.000Z',
    },
    inTxn: {
      id: 'srv-in-1', cashboxId: body.toCashboxId, date: body.date, type: 'income', category: 'transfer',
      amount: Number(body.amount), method: body.method || 'cash', party: 'الرئيسية',
      notes: body.description || 'تحويل داخلي', refType: 'transfer', refId: 'srv-transfer-1', status: 'active', createdBy: 'u1', createdAt: '2026-01-10T00:00:00.000Z',
    },
  });

  fetchMock = vi.fn((url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (u.endsWith('/api/treasuryTxn') && method === 'POST') return Promise.resolve(postTxnResponder(body));
    if (u.endsWith('/api/treasuryTxn/transfer') && method === 'POST') return Promise.resolve(transferResponder(body));
    if (u.includes('/api/treasuryTxn/') && u.endsWith('/reverse') && method === 'PUT') {
      const id = decodeURIComponent(u.split('/api/treasuryTxn/')[1].replace('/reverse', ''));
      return Promise.resolve(reverseResponder(id, body));
    }
    // Issue 2's background cb_main sync — seeded cashboxes here are cb1/cb2, so it always
    // fires; treated as an already-exists conflict, exactly like the real steady state.
    if (u.endsWith('/api/cashboxes') && method === 'POST') return Promise.resolve(errJson(409, 'قيمة مكرّرة تنتهك قيد التفرّد.'));
    return Promise.reject(new Error(`unexpected fetch: ${method} ${u}`));
  });
  globalThis.fetch = fetchMock;
});
afterEach(() => { vi.restoreAllMocks(); });

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <TreasuryPage />
      </ToastProvider>
    </AuthProvider>
  );
}
function seedStore(extra = {}) {
  useAppStore.setState({ cashboxes: [CB1, CB2], treasuryTxn: [], ...extra });
}
function callsTo(matcher) {
  return fetchMock.mock.calls.filter(([url, opts]) => matcher(String(url), opts));
}
const postTxnCalls  = () => callsTo((u, o) => u.endsWith('/api/treasuryTxn') && o?.method === 'POST');
const transferCalls = () => callsTo((u, o) => u.endsWith('/api/treasuryTxn/transfer') && o?.method === 'POST');
const reverseCalls  = () => callsTo((u, o) => u.includes('/api/treasuryTxn/') && u.endsWith('/reverse') && o?.method === 'PUT');

describe('TreasuryPage — treasury_txn write flows (Phase 3B-14B)', () => {
  it('manual entry: creates via exactly one POST, no premature local mutation, adopts server response', async () => {
    let resolvePost;
    postTxnResponder = () => new Promise((resolve) => { resolvePost = resolve; });

    seedStore();
    renderPage();
    fireEvent.click(screen.getByText('↑ إيراد'));
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: 'subscriptions' } }); // النوع
    fireEvent.change(screen.getByPlaceholderText('مثال: اشتراك أحمد — مارس'), { target: { value: 'اشتراك سارة' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '150' } });
    fireEvent.click(screen.getByText('↑ تسجيل الإيراد'));

    await waitFor(() => expect(postTxnCalls()).toHaveLength(1));
    const [, sentOpts] = postTxnCalls()[0];
    const sentBody = JSON.parse(sentOpts.body);
    expect(sentBody.cashboxId).toBe('cb1');
    expect(sentBody.category).toBe('subscriptions');
    // treasury_txn لا عمود description لها إطلاقاً — description المحلي يُدمَج في notes
    // الوحيد المتاح قبل الإرسال (pgCreateTreasuryTxn)؛ لا description في الجسم المُرسَل.
    expect(sentBody.description).toBeUndefined();
    expect(sentBody.notes).toBe('اشتراك سارة');
    expect(sentBody.amount).toBe(150);
    expect(sentBody.type).toBe('income');

    // لا تعديل محلي قبل نجاح الاستدعاء
    expect(useAppStore.getState().treasuryTxn).toEqual([]);

    resolvePost(okJson({ ...sentBody, id: 'srv-tx-1', status: 'active', createdAt: '2026-01-10T00:00:00.000Z' }, 201));

    await waitFor(() => expect(useAppStore.getState().treasuryTxn).toHaveLength(1));
    expect(useAppStore.getState().treasuryTxn[0].id).toBe('srv-tx-1');
    expect(useAppStore.getState().treasuryTxn[0].description).toBe('اشتراك سارة');
    // نداءان: مزامنة cb_main الخلفية (Issue 2) + إنشاء الحركة اليدوية التي يقودها المستخدم
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('manual entry failure: leaves treasuryTxn untouched', async () => {
    postTxnResponder = () => errJson(400, 'المبلغ يجب أن يكون أكبر من صفر');

    seedStore();
    renderPage();
    fireEvent.click(screen.getByText('↑ إيراد'));
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: 'subscriptions' } });
    fireEvent.change(screen.getByPlaceholderText('مثال: اشتراك أحمد — مارس'), { target: { value: 'اشتراك فاشل' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '50' } });
    fireEvent.click(screen.getByText('↑ تسجيل الإيراد'));

    await waitFor(() => expect(postTxnCalls()).toHaveLength(1));
    expect(useAppStore.getState().treasuryTxn).toEqual([]);
  });

  it('reversal requires a reason: no fetch call is made without one, and an inline error is shown', async () => {
    seedStore({ treasuryTxn: [EXISTING_TXN] });
    renderPage();
    fireEvent.click(screen.getByText('📋 كشف الحركات'));
    fireEvent.click(await screen.findByText('↩ عكس'));
    fireEvent.click(screen.getByText('نعم، عكس العملية'));

    expect(await screen.findByText((t) => t.includes('سبب العكس مطلوب'))).toBeInTheDocument();
    expect(reverseCalls()).toHaveLength(0);
  });

  it('reversal: single PUT with the user-provided reason, no premature mutation, adopts BOTH the updated original (cancelled) and the new compensating transaction, original amount/description preserved unchanged', async () => {
    let resolveReverse;
    reverseResponder = () => new Promise((resolve) => { resolveReverse = resolve; });

    seedStore({ treasuryTxn: [EXISTING_TXN] });
    renderPage();
    fireEvent.click(screen.getByText('📋 كشف الحركات'));
    fireEvent.click(await screen.findByText('↩ عكس'));
    fireEvent.change(screen.getByPlaceholderText('مثال: خطأ في القيد، إلغاء العملية...'), { target: { value: 'خطأ في إدخال المبلغ' } });
    fireEvent.click(screen.getByText('نعم، عكس العملية'));

    await waitFor(() => expect(reverseCalls()).toHaveLength(1));
    const [sentUrl, sentOpts] = reverseCalls()[0];
    expect(decodeURIComponent(sentUrl.split('/api/treasuryTxn/')[1].replace('/reverse', ''))).toBe('tx1');
    expect(JSON.parse(sentOpts.body).reason).toBe('خطأ في إدخال المبلغ');

    // لا تعديل محلي قبل النجاح — السجل الأصلي كما هو تماماً حتى الآن
    expect(useAppStore.getState().treasuryTxn).toEqual([EXISTING_TXN]);

    // الشكل الخام الحقيقي من الخادم: notes فقط، لا description إطلاقاً (لا عمود له).
    resolveReverse(okJson({
      original: { id: 'tx1', cashboxId: 'cb1', date: EXISTING_TXN.date, type: 'income', category: 'subscriptions', amount: 200, method: 'cash', party: 'أحمد', notes: EXISTING_TXN.description, status: 'cancelled', createdBy: 'u1', createdAt: EXISTING_TXN.createdAt },
      reversal: {
        id: 'srv-rev-1', cashboxId: 'cb1', date: '2026-01-10', type: 'expense', category: 'subscriptions',
        amount: 200, method: 'cash', party: 'أحمد',
        notes: 'خطأ في إدخال المبلغ', refType: 'reversal', refId: 'tx1', status: 'active',
        createdBy: 'u1', createdAt: '2026-01-10T00:00:00.000Z',
      },
    }));

    await waitFor(() => expect(useAppStore.getState().treasuryTxn).toHaveLength(2));
    const [original, reversal] = useAppStore.getState().treasuryTxn;
    // الأصل: status تغيّر فقط، المبلغ/الوصف لم يُمسّا إطلاقاً (append-only)
    expect(original.status).toBe('cancelled');
    expect(original.amount).toBe(EXISTING_TXN.amount);
    expect(original.description).toBe(EXISTING_TXN.description);
    // الحركة المعاكسة الجديدة: تحمل السبب الفعلي الذي كتبه المستخدم فعلياً (بعد تطبيع
    // notes الخادم → description محلياً، بنفس مبدأ كل استجابات treasury_txn الأخرى)
    expect(reversal.description).toBe('خطأ في إدخال المبلغ');
    expect(reversal.refType).toBe('reversal');
    expect(reversal.refId).toBe('tx1');
    expect(reversal.type).toBe('expense'); // معاكس لنوع الأصل (income)
    // نداءان: مزامنة cb_main الخلفية (Issue 2) + العكس الذرّي الوحيد
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reversal failure: leaves treasuryTxn completely untouched (no partial adoption of original or reversal)', async () => {
    reverseResponder = () => errJson(400, 'العملية ليست نشطة — قد تكون مُعكوسة بالفعل.');

    seedStore({ treasuryTxn: [EXISTING_TXN] });
    renderPage();
    fireEvent.click(screen.getByText('📋 كشف الحركات'));
    fireEvent.click(await screen.findByText('↩ عكس'));
    fireEvent.change(screen.getByPlaceholderText('مثال: خطأ في القيد، إلغاء العملية...'), { target: { value: 'محاولة فاشلة' } });
    fireEvent.click(screen.getByText('نعم، عكس العملية'));

    await waitFor(() => expect(reverseCalls()).toHaveLength(1));
    expect(useAppStore.getState().treasuryTxn).toEqual([EXISTING_TXN]);
  });

  it('transfer: single POST, no premature mutation, adopts BOTH sides of the pair together — never only one side', async () => {
    let resolveTransfer;
    transferResponder = () => new Promise((resolve) => { resolveTransfer = resolve; });

    seedStore();
    renderPage();
    fireEvent.click(screen.getByText('⇄ تحويل بين الخزن'));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'cb1' } }); // من
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'cb2' } }); // إلى
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '300' } });
    fireEvent.click(screen.getByText('⇄ تنفيذ التحويل'));

    await waitFor(() => expect(transferCalls()).toHaveLength(1));
    const [, sentOpts] = transferCalls()[0];
    const sentBody = JSON.parse(sentOpts.body);
    expect(sentBody.fromCashboxId).toBe('cb1');
    expect(sentBody.toCashboxId).toBe('cb2');
    expect(sentBody.amount).toBe('300');

    // لا تعديل محلي قبل النجاح — لا طرف واحد من الزوج يظهر منفرداً أبداً
    expect(useAppStore.getState().treasuryTxn).toEqual([]);

    resolveTransfer(okJson({
      outTxn: {
        id: 'srv-out-1', cashboxId: 'cb1', date: sentBody.date, type: 'expense', category: 'transfer',
        amount: 300, method: 'cash', party: 'الفرع', notes: 'تحويل داخلي',
        refType: 'transfer', refId: 'srv-transfer-1', status: 'active', createdBy: 'u1', createdAt: '2026-01-10T00:00:00.000Z',
      },
      inTxn: {
        id: 'srv-in-1', cashboxId: 'cb2', date: sentBody.date, type: 'income', category: 'transfer',
        amount: 300, method: 'cash', party: 'الرئيسية', notes: 'تحويل داخلي',
        refType: 'transfer', refId: 'srv-transfer-1', status: 'active', createdBy: 'u1', createdAt: '2026-01-10T00:00:00.000Z',
      },
    }));

    // كلا الطرفين معاً بعد النجاح — أبداً طرف واحد منفرداً
    await waitFor(() => expect(useAppStore.getState().treasuryTxn).toHaveLength(2));
    const ids = useAppStore.getState().treasuryTxn.map(t => t.id);
    expect(ids).toContain('srv-out-1');
    expect(ids).toContain('srv-in-1');
    const out = useAppStore.getState().treasuryTxn.find(t => t.id === 'srv-out-1');
    const inn = useAppStore.getState().treasuryTxn.find(t => t.id === 'srv-in-1');
    expect(out.refId).toBe(inn.refId); // نفس رابط التحويل المشترَك
    // نداءان: مزامنة cb_main الخلفية (Issue 2) + التحويل الذرّي الوحيد
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('transfer failure: neither side of the pair is ever adopted locally', async () => {
    transferResponder = () => errJson(400, 'الخزنة الوجهة غير موجودة.');

    seedStore();
    renderPage();
    fireEvent.click(screen.getByText('⇄ تحويل بين الخزن'));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'cb1' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'cb2' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '100' } });
    fireEvent.click(screen.getByText('⇄ تنفيذ التحويل'));

    await waitFor(() => expect(transferCalls()).toHaveLength(1));
    expect(useAppStore.getState().treasuryTxn).toEqual([]);
  });
});
