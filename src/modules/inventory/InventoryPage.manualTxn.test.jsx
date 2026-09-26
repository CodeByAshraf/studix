// src/modules/inventory/InventoryPage.manualTxn.test.jsx
// State Synchronization Audit fix — real defect: handleSaveTxn/handleSaveCount only ever
// inserted a client-generated inventoryTxn into local Zustand state, with zero backend
// call. The entry looked saved but PostgreSQL never received it, invisible to any other
// session/device and lost entirely on reload. Fixed by routing through the new
// pgCreateInventoryTxn (POST /api/inventoryTxn, backend/src/routes/inventoryTxn.js), same
// server-truth-first pattern already used by this page's own material CRUD
// (InventoryPage.materials.test.jsx). validateTxn/buildInventoryTxn/buildCountAdjustment's
// own calculation logic is untouched — this only changes what happens with the result.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import InventoryPage from './InventoryPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

let fetchMock;
let postTxnResponder;

function okJson(data, status = 201) {
  return { ok: true, status, json: async () => ({ ok: true, data }) };
}
function errJson(status, error) {
  return { ok: false, status, json: async () => ({ ok: false, error }) };
}

const MATERIAL = { id: '1', code: 'MAT-000001', name: 'مذكرة الرياضيات', subject: 'رياضيات', grade: 'الصف الأول الإعدادي', price: 200 };

beforeEach(() => {
  postTxnResponder = (body) => okJson({
    id: 'srv-itx-1', number: 'INV-000001', materialId: body.materialId, type: body.type,
    quantity: Number(body.quantity), date: body.date, employee: body.employee,
    reason: body.reason, notes: body.notes, batchNo: body.batchNo || null,
    unitCost: body.unitCost !== '' && body.unitCost != null ? Number(body.unitCost) : null,
    recipient: body.recipient || null, countedQty: body.countedQty ?? null, systemQty: body.systemQty ?? null,
    status: 'active', createdAt: '2026-08-19T00:00:00.000Z',
  });

  fetchMock = vi.fn((url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    if (u.endsWith('/api/inventoryTxn') && method === 'POST') {
      return Promise.resolve(postTxnResponder(opts.body ? JSON.parse(opts.body) : {}));
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
        <InventoryPage />
      </ToastProvider>
    </AuthProvider>
  );
}
function seedStore(extra = {}) {
  useAppStore.setState({
    invMaterials: [MATERIAL], inventoryTxn: [],
    inventorySettings: { defaultMinStock: 10, allowNegativeStock: false, reservationExpiryDays: 7 },
    ...extra,
  });
}
function postTxnCalls() {
  return fetchMock.mock.calls.filter(([url, opts]) => String(url).endsWith('/api/inventoryTxn') && opts?.method === 'POST');
}
function selectMaterial() {
  fireEvent.click(screen.getByText(MATERIAL.name));
}

describe('InventoryPage — manual transaction now persists through the real inventoryTxn Postgres path', () => {
  beforeEach(() => { seedStore(); });

  it('A. successful manual transaction calls the real backend and adopts the server response (authoritative id/number) into Zustand — no client-fabricated row', async () => {
    renderPage();
    selectMaterial();
    fireEvent.click(screen.getByText('+ حركة'));

    fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '10' } });
    fireEvent.click(screen.getByText('تسجيل الحركة'));

    await waitFor(() => expect(postTxnCalls()).toHaveLength(1));
    const sentBody = JSON.parse(postTxnCalls()[0][1].body);
    expect(sentBody.materialId).toBe(MATERIAL.id);
    expect(sentBody.quantity).toBe(10);

    await waitFor(() => {
      const txns = useAppStore.getState().inventoryTxn;
      expect(txns).toHaveLength(1);
      expect(txns[0].id).toBe('srv-itx-1'); // معرّف الخادم الحقيقي، لا itx_${Date.now()} المحلي القديم
      expect(txns[0].number).toBe('INV-000001'); // رقم الخادم الحقيقي، لا التسلسل المحلي غير الآمن
    });
  });

  it('B. server-authoritative fields (id/number) are preserved verbatim on the adopted record', async () => {
    renderPage();
    selectMaterial();
    fireEvent.click(screen.getByText('+ حركة'));
    fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '5' } });
    fireEvent.click(screen.getByText('تسجيل الحركة'));

    await waitFor(() => expect(useAppStore.getState().inventoryTxn).toHaveLength(1));
    const saved = useAppStore.getState().inventoryTxn[0];
    expect(saved.id).toBe('srv-itx-1');
    expect(saved.number).toBe('INV-000001');
    expect(saved.status).toBe('active');
  });

  it('C. a failed request does NOT insert any local transaction, and the existing validation error path is unaffected', async () => {
    postTxnResponder = () => errJson(400, 'المذكرة غير موجودة.');

    renderPage();
    selectMaterial();
    fireEvent.click(screen.getByText('+ حركة'));
    fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '5' } });
    fireEvent.click(screen.getByText('تسجيل الحركة'));

    expect(await screen.findByText('المذكرة غير موجودة.')).toBeInTheDocument();
    expect(useAppStore.getState().inventoryTxn).toEqual([]);
    expect(postTxnCalls()).toHaveLength(1);
  });

  it('D. existing client-side validation still blocks an invalid quantity before any network call is made', async () => {
    renderPage();
    selectMaterial();
    fireEvent.click(screen.getByText('+ حركة'));
    // الكمية فارغة — يجب أن يرفضها validateTxn محلياً قبل أي محاولة اتصال.
    fireEvent.click(screen.getByText('تسجيل الحركة'));

    expect(await screen.findByText('الكمية يجب أن تكون أكبر من صفر')).toBeInTheDocument();
    expect(postTxnCalls()).toHaveLength(0);
  });
});

describe('InventoryPage — physical count adjustment now persists through the real inventoryTxn Postgres path', () => {
  beforeEach(() => { seedStore(); });

  it('E. a successful count adjustment calls the real backend and adopts the server response into Zustand', async () => {
    // لا حركات سابقة → المخزون المحسوب = 0؛ عدّ 7 يُنتج فرقاً +7 (تسوية حقيقية، لا صفر).
    renderPage();
    selectMaterial();
    fireEvent.click(screen.getByText('📋 جرد فعلي'));
    fireEvent.change(screen.getByPlaceholderText('عُدّ الرف وأدخل العدد'), { target: { value: '7' } });
    fireEvent.click(screen.getByText('تسجيل الجرد'));

    await waitFor(() => expect(postTxnCalls()).toHaveLength(1));
    const sentBody = JSON.parse(postTxnCalls()[0][1].body);
    expect(sentBody.type).toBe('adjustment');
    expect(sentBody.quantity).toBe(7);
    expect(sentBody.countedQty).toBe(7);
    expect(sentBody.systemQty).toBe(0);

    await waitFor(() => {
      const txns = useAppStore.getState().inventoryTxn;
      expect(txns).toHaveLength(1);
      expect(txns[0].id).toBe('srv-itx-1');
    });
  });

  it('F. a failed count-adjustment request does NOT insert any local transaction', async () => {
    postTxnResponder = () => errJson(400, 'خطأ في الخادم.');

    renderPage();
    selectMaterial();
    fireEvent.click(screen.getByText('📋 جرد فعلي'));
    fireEvent.change(screen.getByPlaceholderText('عُدّ الرف وأدخل العدد'), { target: { value: '7' } });
    fireEvent.click(screen.getByText('تسجيل الجرد'));

    expect(await screen.findByText('خطأ في الخادم.')).toBeInTheDocument();
    expect(useAppStore.getState().inventoryTxn).toEqual([]);
  });

  it('G. existing "no difference → no-op" calculation is unaffected — zero network calls when counted matches system quantity', async () => {
    renderPage();
    selectMaterial();
    fireEvent.click(screen.getByText('📋 جرد فعلي'));
    // لا حركات سابقة → المحسوب = 0؛ عدّ 0 = لا فرق.
    fireEvent.change(screen.getByPlaceholderText('عُدّ الرف وأدخل العدد'), { target: { value: '0' } });
    fireEvent.click(screen.getByText('تسجيل الجرد'));

    expect(await screen.findByText('الكمية المعدودة مطابقة للمحسوبة — لا حاجة لتسوية')).toBeInTheDocument();
    expect(postTxnCalls()).toHaveLength(0);
  });
});
