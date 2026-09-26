// src/modules/materials/MaterialDistribution.payment.test.jsx
// Delivery-tracking → cashbox integration (frontend contract). Selecting "مدفوع"/"مدفوع
// جزئياً" must open a confirmation dialog and call the dedicated atomic endpoint
// (pgConfirmMaterialPayment) — never write payStatus/paidAmount to local state directly,
// and never touch the bulk pgSaveMaterialDistribution endpoint for this. "غير مدفوع"
// keeps the old local-only behavior (deferred to "حفظ التوزيع"), with no dialog and no
// server call. See backend/src/routes/materialDistributionPayment.integration.test.js for
// the atomic transaction itself.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import MaterialDistribution from './MaterialDistribution';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgSaveMaterialDistribution: vi.fn(), pgGetCollection: vi.fn(), pgConfirmMaterialPayment: vi.fn() };
});
import { pgSaveMaterialDistribution, pgGetCollection, pgConfirmMaterialPayment } from '../../services/api';

const MATERIAL = { id: '7', name: 'مذكرة الرياضيات', subject: 'رياضيات', teacher: '', grade: 'الصف الأول الثانوي', price: 200 };

function renderPage(onClose = vi.fn()) {
  return render(
    <ToastProvider>
      <MaterialDistribution material={MATERIAL} onClose={onClose} />
    </ToastProvider>
  );
}

function seedStore(extra = {}) {
  useAppStore.setState({
    students: [{ id: 's1', name: 'أشرف', code: 'C1', status: 'active', grade: MATERIAL.grade, groupId: 'g1' }],
    groups: [{ id: 'g1', name: 'مجموعة أ' }],
    inventoryTxn: [],
    payments: [],
    treasuryTxn: [],
    cashboxes: [{ id: 'cb1', name: 'الخزنة الرئيسية', active: true }],
    ...extra,
  });
}

// استجابة واقعية الشكل (لا كائنات فارغة {}) — نفس شكل json.data الفعلي من confirmMaterialPayment
// (backend/src/routes/materialDistribution.js عبر createPaymentInTx المُشترَكة مع payments.js).
function confirmResponse(overrides = {}) {
  return {
    payment: {
      id: 'srv-pay-1', studentId: 's1', groupId: null, materialId: '7', month: 8, year: 2026,
      amount: 200, method: 'cash', payType: 'material', date: '2026-08-19', status: 'paid',
      notes: null, treasuryTxnId: 'srv-tx-1', createdAt: '2026-08-19T00:00:00.000Z',
      ...overrides.payment,
    },
    treasuryTxn: {
      id: 'srv-tx-1', cashboxId: 'cb1', date: '2026-08-19', type: 'income', category: 'materials',
      amount: 200, method: 'cash', party: 'أشرف', notes: null, refType: 'payment', refId: 'srv-pay-1',
      status: 'active', createdBy: 'u1', createdAt: '2026-08-19T00:00:00.000Z',
      ...overrides.treasuryTxn,
    },
  };
}

function paidTxn({ paidAmount = 200, payStatus = 'paid' } = {}) {
  return {
    id: 'srv-1', number: 'INV-000001', materialId: '7', type: 'studentDelivery', quantity: 1,
    studentId: 's1', status: 'active', createdAt: '2026-08-19T00:00:00.000Z',
    legacyMetadata: { payStatus, paidAmount, receivedAt: '2026-08-19' },
  };
}

describe('MaterialDistribution — booklet payment confirmation dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pgGetCollection.mockResolvedValue([]);
    seedStore();
  });

  it('clicking "مدفوع" opens a dialog with the full price pre-filled and not editable, requires a cashbox, and on confirm calls pgConfirmMaterialPayment (never the bulk endpoint)', async () => {
    pgConfirmMaterialPayment.mockResolvedValue({ payment: {}, treasuryTxn: {} });
    pgGetCollection.mockResolvedValueOnce([paidTxn()]);

    renderPage();
    fireEvent.click(screen.getByText('مدفوع'));

    expect(await screen.findByText('تأكيد دفع مذكرة')).toBeInTheDocument();
    const amountInput = screen.getByDisplayValue('200');
    expect(amountInput).toBeDisabled();

    const confirmBtn = screen.getByText('💰 تأكيد الدفع');
    expect(confirmBtn).toBeDisabled(); // لا خزنة مختارة بعد

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cb1' } });
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(pgConfirmMaterialPayment).toHaveBeenCalledWith('7', 's1', expect.objectContaining({
      payStatus: 'paid', amount: 200, cashboxId: 'cb1',
    })));
    expect(pgSaveMaterialDistribution).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(useAppStore.getState().inventoryTxn).toEqual([paidTxn()]);
    });
  });

  it('clicking "مدفوع جزئياً" opens a dialog with an editable amount, rejects an amount greater than the price, and sends the typed amount on confirm', async () => {
    pgConfirmMaterialPayment.mockResolvedValue({ payment: {}, treasuryTxn: {} });
    pgGetCollection.mockResolvedValueOnce([paidTxn({ paidAmount: 100, payStatus: 'partial' })]);

    renderPage();
    fireEvent.click(screen.getByText('مدفوع جزئياً'));

    const dialog = await screen.findByText('تأكيد دفع جزئي — مذكرة');
    expect(dialog).toBeInTheDocument();
    const amountInput = screen.getByDisplayValue('200');
    expect(amountInput).not.toBeDisabled();

    fireEvent.change(amountInput, { target: { value: '100' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cb1' } });
    fireEvent.click(screen.getByText('💰 تأكيد الدفع'));

    await waitFor(() => expect(pgConfirmMaterialPayment).toHaveBeenCalledWith('7', 's1', expect.objectContaining({
      payStatus: 'partial', amount: 100, cashboxId: 'cb1',
    })));
  });

  it('clicking "غير مدفوع" never opens a dialog and never calls the payment endpoint — stays a local-only change deferred to "حفظ التوزيع"', async () => {
    renderPage();
    fireEvent.click(screen.getByText('غير مدفوع'));

    expect(screen.queryByText('تأكيد دفع مذكرة')).not.toBeInTheDocument();
    expect(screen.queryByText('تأكيد دفع جزئي — مذكرة')).not.toBeInTheDocument();
    expect(pgConfirmMaterialPayment).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('💾 حفظ التوزيع'));
    await waitFor(() => expect(pgSaveMaterialDistribution).toHaveBeenCalledTimes(1));
    const sentRecords = pgSaveMaterialDistribution.mock.calls[0][1];
    expect(sentRecords.find((r) => r.studentId === 's1')).toEqual(
      expect.objectContaining({ payStatus: 'unpaid', paidAmount: 0 })
    );
  });

  it('double-clicking "تأكيد الدفع" cannot call pgConfirmMaterialPayment twice — the button disables itself on the first click, before the request resolves', async () => {
    let resolveConfirm;
    pgConfirmMaterialPayment.mockImplementation(() => new Promise((resolve) => { resolveConfirm = resolve; }));
    pgGetCollection.mockResolvedValueOnce([paidTxn()]);

    renderPage();
    fireEvent.click(screen.getByText('مدفوع'));
    await screen.findByText('تأكيد دفع مذكرة');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cb1' } });

    const confirmBtn = screen.getByText('💰 تأكيد الدفع');
    fireEvent.click(confirmBtn);
    // الزر يُعطَّل فوراً (submitting=true) قبل أن يُحلّ الطلب الأول — نقرة ثانية هنا يجب
    // ألا تُنتج نداءً ثانياً إطلاقاً.
    expect(confirmBtn).toBeDisabled();
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);

    expect(pgConfirmMaterialPayment).toHaveBeenCalledTimes(1);
    resolveConfirm({ payment: {}, treasuryTxn: {} });
    await waitFor(() => expect(pgGetCollection).toHaveBeenCalled());
    expect(pgConfirmMaterialPayment).toHaveBeenCalledTimes(1); // ما زال مرة واحدة بعد الاكتمال أيضاً
  });

  it('server failure during confirmation keeps the dialog open with an error and never marks the booklet paid locally', async () => {
    pgConfirmMaterialPayment.mockRejectedValueOnce(new Error('الخزنة المحدَّدة غير موجودة أو غير نشطة.'));

    renderPage();
    fireEvent.click(screen.getByText('مدفوع'));
    await screen.findByText('تأكيد دفع مذكرة');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cb1' } });
    fireEvent.click(screen.getByText('💰 تأكيد الدفع'));

    expect(await screen.findByText(/الخزنة المحدَّدة غير موجودة أو غير نشطة/)).toBeInTheDocument();
    expect(useAppStore.getState().inventoryTxn).toEqual([]);
    expect(pgGetCollection).not.toHaveBeenCalled();
    // D. فشل الدفع لا يُضيف أي حركة خزنة/دفعة محلياً — لا تفاؤل قبل نجاح الخادم.
    expect(useAppStore.getState().treasuryTxn).toEqual([]);
    expect(useAppStore.getState().payments).toEqual([]);
  });

  // P2-2 — the confirmation dialog owns one idempotency key: a retry after a failed attempt
  // resends the same clientRequestId, so the server can never record that payment twice.
  it('a retry of the same confirmation dialog resends the same clientRequestId', async () => {
    pgConfirmMaterialPayment
      .mockRejectedValueOnce(new Error('انقطاع مؤقت'))
      .mockResolvedValueOnce({ payment: { id: 'p-x' }, treasuryTxn: { id: 't-x' } });

    renderPage();
    fireEvent.click(screen.getByText('مدفوع'));
    await screen.findByText('تأكيد دفع مذكرة');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cb1' } });
    fireEvent.click(screen.getByText('💰 تأكيد الدفع'));
    await screen.findByText(/انقطاع مؤقت/);
    fireEvent.click(screen.getByText('💰 تأكيد الدفع'));
    await waitFor(() => expect(pgConfirmMaterialPayment).toHaveBeenCalledTimes(2));

    const [k1, k2] = pgConfirmMaterialPayment.mock.calls.map((c) => c[2].clientRequestId);
    expect(k1).toMatch(/^[A-Za-z0-9-]{16,64}$/);
    expect(k2).toBe(k1);
  });
});

// Financial Integrity Fix — real defect: pgConfirmMaterialPayment's response (payment +
// treasuryTxn) was silently discarded here, so a newly-confirmed booklet payment was
// correctly written to PostgreSQL (proven separately by materialDistributionPayment.
// integration.test.js) but never appeared in the "حركات الخزنة" (Treasury Movements) screen
// until the next full boot-sync reload — TreasuryPage.jsx reads treasuryTxn purely from
// local Zustand state, never re-fetching it. Fixed by adopting the response the exact same
// way PaymentsPage.jsx/AdmissionsPage.jsx already do (setPayments/setTreasuryTxn), not a new
// pattern.
describe('MaterialDistribution — treasury/payment local state sync (Financial Integrity Fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pgGetCollection.mockResolvedValue([]);
    seedStore();
  });

  it('A. a successful payment adds the returned treasury transaction to local state immediately — no reload required', async () => {
    pgConfirmMaterialPayment.mockResolvedValue(confirmResponse());
    pgGetCollection.mockResolvedValueOnce([paidTxn()]);

    renderPage();
    fireEvent.click(screen.getByText('مدفوع'));
    await screen.findByText('تأكيد دفع مذكرة');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cb1' } });
    fireEvent.click(screen.getByText('💰 تأكيد الدفع'));

    await waitFor(() => expect(useAppStore.getState().treasuryTxn).toHaveLength(1));
    expect(useAppStore.getState().treasuryTxn[0].id).toBe('srv-tx-1');
    expect(useAppStore.getState().payments).toHaveLength(1);
    expect(useAppStore.getState().payments[0].id).toBe('srv-pay-1');
  });

  it('B. the added treasury transaction preserves the fields Treasury Movements/cashbox-balance calculations rely on', async () => {
    pgConfirmMaterialPayment.mockResolvedValue(confirmResponse());
    pgGetCollection.mockResolvedValueOnce([paidTxn()]);

    renderPage();
    fireEvent.click(screen.getByText('مدفوع'));
    await screen.findByText('تأكيد دفع مذكرة');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cb1' } });
    fireEvent.click(screen.getByText('💰 تأكيد الدفع'));

    await waitFor(() => expect(useAppStore.getState().treasuryTxn).toHaveLength(1));
    const txn = useAppStore.getState().treasuryTxn[0];
    expect(txn).toMatchObject({
      id: 'srv-tx-1', type: 'income', category: 'materials', amount: 200,
      cashboxId: 'cb1', refType: 'payment', refId: 'srv-pay-1', status: 'active',
    });
  });

  it('C. the existing inventoryTxn refresh behavior still occurs alongside the new state sync', async () => {
    pgConfirmMaterialPayment.mockResolvedValue(confirmResponse());
    pgGetCollection.mockResolvedValueOnce([paidTxn()]);

    renderPage();
    fireEvent.click(screen.getByText('مدفوع'));
    await screen.findByText('تأكيد دفع مذكرة');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cb1' } });
    fireEvent.click(screen.getByText('💰 تأكيد الدفع'));

    await waitFor(() => expect(pgGetCollection).toHaveBeenCalledWith('inventoryTxn'));
    await waitFor(() => expect(useAppStore.getState().inventoryTxn).toEqual([paidTxn()]));
  });
});
