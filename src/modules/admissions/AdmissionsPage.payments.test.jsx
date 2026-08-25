// src/modules/admissions/AdmissionsPage.payments.test.jsx
// Phase 3B-14D — admission_payments' first real PostgreSQL write paths: atomic create
// (POST /api/admissionPayments) and atomic cancel-with-refund
// (PUT /api/admissions/:id/cancel-with-refund). We mock fetch directly (not the api.js
// module) so we verify the real, unmocked requests AdmissionsPage builds — same
// technique used throughout this migration series.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdmissionsPage from './AdmissionsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

let fetchMock;
let postPaymentResponder;   // POST /api/admissionPayments
let cancelRefundResponder;  // PUT /api/admissions/:id/cancel-with-refund

function okJson(data, status = 200) {
  return { ok: true, status, json: async () => ({ ok: true, data }) };
}
function errJson(status, error) {
  return { ok: false, status, json: async () => ({ ok: false, error }) };
}

const GROUP = { id: 'g1', name: 'مجموعة أ', grade: 'الصف الأول الثانوي' };
const CB1 = {
  id: 'cb1', name: 'الرئيسية', type: 'main', color: '#0d9488', icon: '🏦',
  openingBalance: 1000, isDefault: true, active: true, notes: '', createdAt: '2026-01-01',
};
const ADMISSION = {
  id: 'adm_1', admissionNo: 'ADM-000001', name: 'أحمد علي', phone: '01012345678', parentPhone: '01198765432',
  grade: 'الصف الأول الثانوي', school: '', notes: '', stage: 'confirmed', reservationStatus: 'reserved',
  confirmedGroupId: 'g1', group: 'مجموعة أ',
  createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'admin',
  lastModifiedAt: '2026-01-01T00:00:00.000Z', lastModifiedBy: 'admin',
};
const EXISTING_PAYMENT = {
  id: 'ap1', admissionId: 'adm_1', type: 'deposit', amount: 200, date: '2026-01-05',
  method: 'cash', notes: null, materialId: null, treasuryTxnId: 'tx1', createdAt: '2026-01-05T00:00:00.000Z',
};
const EXISTING_TXN = {
  id: 'tx1', cashboxId: 'cb1', date: '2026-01-05', type: 'income', category: 'revisions',
  description: 'دفعة حجز — أحمد علي (قبول)', amount: 200, method: 'cash', party: 'أحمد علي', notes: null,
  refType: 'admissionPayment', refId: 'ap1', admissionId: 'adm_1', status: 'active', createdBy: 'u1',
  createdAt: '2026-01-05T00:00:00.000Z',
};

beforeEach(() => {
  postPaymentResponder = (body) => okJson({
    payment: { id: 'srv-ap-1', admissionId: body.admissionId, type: body.type, amount: Number(body.amount), date: body.date, method: body.method, notes: body.notes ?? null, materialId: body.materialId ?? null, treasuryTxnId: 'srv-tx-1', createdAt: '2026-01-10T00:00:00.000Z' },
    treasuryTxn: { id: 'srv-tx-1', cashboxId: body.cashboxId, date: body.date, type: 'income', category: 'revisions', notes: 'دفعة حجز — أحمد علي (قبول)', amount: Number(body.amount), method: body.method, party: 'أحمد علي', refType: 'admissionPayment', refId: 'srv-ap-1', admissionId: body.admissionId, status: 'active', createdBy: 'u1', createdAt: '2026-01-10T00:00:00.000Z' },
    logs: [{ id: 'sl-pay-1', admissionId: body.admissionId, activityType: 'paymentReceived', byUser: 'u1', details: `${body.type}: ${body.amount} ج.م`, timestamp: '2026-01-10T00:00:00.000Z' }],
  }, 201);

  cancelRefundResponder = () => okJson({
    admission: { ...ADMISSION, reservationStatus: 'cancelled', stage: 'lead' },
    refundTxns: [{ id: 'srv-refund-1', cashboxId: 'cb1', date: '2026-01-10', type: 'expense', category: 'refund', notes: 'استرداد إلغاء حجز', amount: 200, method: 'cash', party: 'أحمد علي', refType: 'admissionRefund', refId: 'ap1', admissionId: 'adm_1', status: 'active', createdBy: 'u1', createdAt: '2026-01-10T00:00:00.000Z' }],
    logs: [
      { id: 'sl-can-1', admissionId: 'adm_1', activityType: 'cancelled', byUser: 'u1', details: '', timestamp: '2026-01-10T00:00:00.000Z' },
      { id: 'sl-can-2', admissionId: 'adm_1', activityType: 'refundIssued', byUser: 'u1', details: '1 دفعة', timestamp: '2026-01-10T00:00:01.000Z' },
    ],
  });

  fetchMock = vi.fn((url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (u.endsWith('/api/admissionPayments') && method === 'POST') return Promise.resolve(postPaymentResponder(body));
    if (u.includes('/api/admissions/') && u.endsWith('/cancel-with-refund') && method === 'PUT') {
      return Promise.resolve(cancelRefundResponder(body));
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
        <AdmissionsPage />
      </ToastProvider>
    </AuthProvider>
  );
}
function seedStore(extra = {}) {
  useAppStore.setState({
    admissions: [ADMISSION], admissionFollowups: [], admissionSystemLog: [], admissionPayments: [],
    groups: [GROUP], students: [], invMaterials: [], treasuryTxn: [], cashboxes: [CB1],
    ...extra,
  });
}
function callsTo(matcher) {
  return fetchMock.mock.calls.filter(([url, opts]) => matcher(String(url), opts));
}
const postPaymentCalls = () => callsTo((u, o) => u.endsWith('/api/admissionPayments') && o?.method === 'POST');
const cancelRefundCalls = () => callsTo((u, o) => u.includes('/api/admissions/') && u.endsWith('/cancel-with-refund') && o?.method === 'PUT');

function openPaymentModal() {
  fireEvent.click(screen.getByText('📋 الحجز'));
  fireEvent.click(screen.getByText('💰 تسجيل دفعة'));
}

describe('AdmissionsPage — admission payment creation (Phase 3B-14D)', () => {
  it('successful atomic creation: exact request contract, no premature mutation, adopts payment + treasuryTxn + logs together', async () => {
    let resolvePost;
    postPaymentResponder = () => new Promise((resolve) => { resolvePost = resolve; });

    seedStore();
    renderPage();
    openPaymentModal();
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[selects.length - 1], { target: { value: 'cb1' } }); // cashbox select (last one)
    fireEvent.change(screen.getByPlaceholderText('200'), { target: { value: '200' } });
    fireEvent.click(screen.getByText('حفظ الدفعة'));

    await waitFor(() => expect(postPaymentCalls()).toHaveLength(1));
    const [, sentOpts] = postPaymentCalls()[0];
    const sentBody = JSON.parse(sentOpts.body);
    expect(sentBody.admissionId).toBe('adm_1');
    expect(sentBody.cashboxId).toBe('cb1');
    expect(sentBody.amount).toBe(200);
    expect(sentBody.type).toBe('deposit');

    expect(useAppStore.getState().admissionPayments).toEqual([]);
    expect(useAppStore.getState().treasuryTxn).toEqual([]);

    resolvePost(okJson({
      payment: { id: 'srv-ap-1', admissionId: 'adm_1', type: 'deposit', amount: 200, date: sentBody.date, method: 'cash', notes: null, materialId: null, treasuryTxnId: 'srv-tx-1', createdAt: '2026-01-10T00:00:00.000Z' },
      treasuryTxn: { id: 'srv-tx-1', cashboxId: 'cb1', date: sentBody.date, type: 'income', category: 'revisions', notes: 'دفعة حجز — أحمد علي (قبول)', amount: 200, method: 'cash', party: 'أحمد علي', refType: 'admissionPayment', refId: 'srv-ap-1', admissionId: 'adm_1', status: 'active', createdBy: 'u1', createdAt: '2026-01-10T00:00:00.000Z' },
      logs: [{ id: 'sl-pay-1', admissionId: 'adm_1', activityType: 'paymentReceived', byUser: 'u1', details: 'deposit: 200 ج.م', timestamp: '2026-01-10T00:00:00.000Z' }],
    }, 201));

    await waitFor(() => expect(useAppStore.getState().admissionPayments).toHaveLength(1));
    expect(useAppStore.getState().admissionPayments[0].id).toBe('srv-ap-1');
    expect(useAppStore.getState().treasuryTxn).toHaveLength(1);
    expect(useAppStore.getState().treasuryTxn[0].refType).toBe('admissionPayment');
    expect(useAppStore.getState().admissionSystemLog).toHaveLength(1);
    expect(useAppStore.getState().admissionSystemLog[0].type).toBe('paymentReceived');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('creation failure: leaves admissionPayments and treasuryTxn completely untouched', async () => {
    postPaymentResponder = () => errJson(400, 'الخزنة المحدَّدة غير موجودة أو غير نشطة.');

    seedStore();
    renderPage();
    openPaymentModal();
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[selects.length - 1], { target: { value: 'cb1' } });
    fireEvent.change(screen.getByPlaceholderText('200'), { target: { value: '200' } });
    fireEvent.click(screen.getByText('حفظ الدفعة'));

    await waitFor(() => expect(postPaymentCalls()).toHaveLength(1));
    expect(useAppStore.getState().admissionPayments).toEqual([]);
    expect(useAppStore.getState().treasuryTxn).toEqual([]);
  });

  it('cashbox selection: no active cashbox blocks submission entirely — zero fetch calls', async () => {
    seedStore({ cashboxes: [{ ...CB1, active: false }] });
    renderPage();
    openPaymentModal();

    expect(screen.getByText('حفظ الدفعة').closest('button')).toBeDisabled();
    expect(postPaymentCalls()).toHaveLength(0);
  });
});

describe('AdmissionsPage — cancel-with-refund (Phase 3B-14D, ONE atomic transaction)', () => {
  it('successful cancel-with-refund: exact request contract, no premature mutation, adopts admission status change + refund treasuryTxn + logs together', async () => {
    let resolveCancel;
    cancelRefundResponder = () => new Promise((resolve) => { resolveCancel = resolve; });

    seedStore({ admissionPayments: [EXISTING_PAYMENT], treasuryTxn: [EXISTING_TXN] });
    renderPage();
    fireEvent.click(screen.getByText('📋 الحجز'));
    fireEvent.click(screen.getByText('إلغاء'));
    fireEvent.click(await screen.findByText('تأكيد الإلغاء والاسترداد'));

    await waitFor(() => expect(cancelRefundCalls()).toHaveLength(1));
    const [sentUrl] = cancelRefundCalls()[0];
    expect(decodeURIComponent(sentUrl.split('/api/admissions/')[1].replace('/cancel-with-refund', ''))).toBe('adm_1');

    // لا تعديل محلي قبل النجاح
    expect(useAppStore.getState().admissions[0].reservationStatus).toBe('reserved');
    expect(useAppStore.getState().treasuryTxn).toEqual([EXISTING_TXN]);

    resolveCancel(okJson({
      admission: { ...ADMISSION, reservationStatus: 'cancelled', stage: 'lead' },
      refundTxns: [{ id: 'srv-refund-1', cashboxId: 'cb1', date: '2026-01-10', type: 'expense', category: 'refund', notes: 'استرداد', amount: 200, method: 'cash', party: 'أحمد علي', refType: 'admissionRefund', refId: 'ap1', admissionId: 'adm_1', status: 'active', createdBy: 'u1', createdAt: '2026-01-10T00:00:00.000Z' }],
      logs: [
        { id: 'sl-can-1', admissionId: 'adm_1', activityType: 'cancelled', byUser: 'u1', details: '', timestamp: '2026-01-10T00:00:00.000Z' },
        { id: 'sl-can-2', admissionId: 'adm_1', activityType: 'refundIssued', byUser: 'u1', details: '1 دفعة', timestamp: '2026-01-10T00:00:01.000Z' },
      ],
    }));

    await waitFor(() => expect(useAppStore.getState().admissions[0].reservationStatus).toBe('cancelled'));
    expect(useAppStore.getState().treasuryTxn).toHaveLength(2);
    const refundTxn = useAppStore.getState().treasuryTxn.find(t => t.id === 'srv-refund-1');
    expect(refundTxn.refType).toBe('admissionRefund');
    expect(refundTxn.cashboxId).toBe('cb1'); // نفس خزنة الدفعة الأصلية EXISTING_TXN
    expect(useAppStore.getState().admissionSystemLog).toHaveLength(2);
    // الدفعة الأصلية لا تتغيّر أبداً (immutable)
    expect(useAppStore.getState().admissionPayments).toEqual([EXISTING_PAYMENT]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cancel-with-refund failure (e.g. already cancelled): leaves admission, payments, and treasuryTxn completely untouched', async () => {
    cancelRefundResponder = () => errJson(400, 'لا يمكن إلغاء هذا السجل — قد يكون ملغياً بالفعل أو في حالة غير قابلة للإلغاء.');

    seedStore({ admissionPayments: [EXISTING_PAYMENT], treasuryTxn: [EXISTING_TXN] });
    renderPage();
    fireEvent.click(screen.getByText('📋 الحجز'));
    fireEvent.click(screen.getByText('إلغاء'));
    fireEvent.click(await screen.findByText('تأكيد الإلغاء والاسترداد'));

    await waitFor(() => expect(cancelRefundCalls()).toHaveLength(1));
    expect(useAppStore.getState().admissions[0].reservationStatus).toBe('reserved');
    expect(useAppStore.getState().treasuryTxn).toEqual([EXISTING_TXN]);
    expect(useAppStore.getState().admissionPayments).toEqual([EXISTING_PAYMENT]);
  });
});
