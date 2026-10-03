// src/modules/treasury/TreasuryPage.cashboxSync.test.jsx
// Product Completion Phase 1 — Issue 2, Option A. A fresh install has zero real
// cashboxes in Postgres, but INITIAL_CASHBOXES already seeds a local-only 'cb_main' —
// so PaymentForm.jsx's already-correct "no active cashbox" empty state never fires, and
// the server rejects the very first payment attempt late, after the form is filled.
// TreasuryPage now syncs that exact seed row to Postgres once, silently, on mount: it
// looks the row up first (GET /api/cashboxes/cb_main) and POSTs only on 404. We mock
// fetch directly (not the api.js module) — same technique as
// TreasuryPage.cashboxes.test.jsx — so we verify the real, unmocked request body.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TreasuryPage, { __resetCashboxSyncGuardForTests } from './TreasuryPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

let fetchMock;
let postCashboxResponder;
let getSeedResponses; // consumed in order; the last one repeats
let warnSpy;

function okJson(data, status = 200) {
  return { ok: true, status, json: async () => ({ ok: true, data }) };
}
function errJson(status, error) {
  return { ok: false, status, json: async () => ({ ok: false, error }) };
}
const SEED_ROW = { id: 'cb_main', name: 'الخزنة الرئيسية', type: 'main', isDefault: true, active: true };
const NOT_FOUND = () => errJson(404, 'السجل غير موجود.');
const FOUND = () => okJson(SEED_ROW);

beforeEach(() => {
  __resetCashboxSyncGuardForTests();
  getSeedResponses = [NOT_FOUND];
  postCashboxResponder = (body) => okJson({ ...body, createdAt: '2026-01-02T00:00:00.000Z' }, 201);
  fetchMock = vi.fn((url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    if (u.endsWith('/api/cashboxes/cb_main') && method === 'GET') {
      const responder = getSeedResponses.length > 1 ? getSeedResponses.shift() : getSeedResponses[0];
      return Promise.resolve(responder());
    }
    if (u.endsWith('/api/cashboxes') && method === 'POST') {
      return Promise.resolve(postCashboxResponder(opts.body ? JSON.parse(opts.body) : {}));
    }
    return Promise.reject(new Error(`unexpected fetch: ${method} ${u}`));
  });
  globalThis.fetch = fetchMock;
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  useAppStore.setState({ cashboxes: [], treasuryTxn: [] });
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

function getCalls() {
  return fetchMock.mock.calls.filter(([url, opts]) => String(url).endsWith('/api/cashboxes/cb_main') && (opts?.method || 'GET') === 'GET');
}
function postCalls() {
  return fetchMock.mock.calls.filter(([url, opts]) => String(url).endsWith('/api/cashboxes') && opts?.method === 'POST');
}
function seedSyncWarnings() {
  return warnSpy.mock.calls.filter(([msg]) => String(msg).includes('cb_main'));
}
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('TreasuryPage — background cb_main sync on mount (Product Completion Phase 1, Issue 2)', () => {
  it('cashbox already on the server (GET 200) → no POST, synced, nothing reported', async () => {
    getSeedResponses = [FOUND];

    const { queryByText } = renderPage();
    await waitFor(() => expect(getCalls()).toHaveLength(1));
    await settle();

    expect(postCalls()).toHaveLength(0);
    expect(seedSyncWarnings()).toHaveLength(0);
    expect(queryByText(/فشل/)).not.toBeInTheDocument();
  });

  it('cashbox missing (GET 404) → POSTs the exact local seed cashbox exactly once', async () => {
    renderPage();

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    const sentBody = JSON.parse(postCalls()[0][1].body);
    expect(sentBody).toMatchObject({
      id: 'cb_main', name: 'الخزنة الرئيسية', type: 'main',
      isDefault: true, active: true,
    });
    expect(getCalls()[0][1]).toMatchObject({ credentials: 'include' });
  });

  it('GET 404 + POST 201 → success: no re-check, nothing reported, no error surfaced', async () => {
    const { queryByText } = renderPage();
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    await settle();

    expect(getCalls()).toHaveLength(1);
    expect(seedSyncWarnings()).toHaveLength(0);
    expect(queryByText(/فشل/)).not.toBeInTheDocument();
  });

  it('GET 404 + POST 409 (another client won the race) → treated as already existing: no error toast, nothing reported', async () => {
    getSeedResponses = [NOT_FOUND, FOUND]; // the re-check after 409 sees the row the winner created
    postCashboxResponder = () => errJson(409, 'قيمة مكرّرة تنتهك قيد التفرّد.');

    const { queryByText } = renderPage();
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    await waitFor(() => expect(getCalls()).toHaveLength(2));
    await settle();

    // لا رسالة خطأ تظهر للمستخدم — هذا مسار خلفي صامت بتصميم صريح
    expect(queryByText(/قيمة مكرّرة/)).not.toBeInTheDocument();
    expect(queryByText(/فشل/)).not.toBeInTheDocument();
    expect(seedSyncWarnings()).toHaveLength(0);
  });

  it.each([
    ['server error (500)', () => errJson(500, 'خطأ داخلي في الخادم.')],
    ['not activated (402)', () => errJson(402, 'Studix غير مُفعَّل.')],
    ['forbidden (403)', () => errJson(403, 'لا تملك صلاحية.')],
  ])('GET failure other than 404 — %s → no POST, failure reported (not treated as synced), no toast', async (_label, failure) => {
    getSeedResponses = [failure];

    const { queryByText } = renderPage();
    await waitFor(() => expect(seedSyncWarnings()).toHaveLength(1));
    await settle();

    expect(postCalls()).toHaveLength(0);
    expect(queryByText(/فشل/)).not.toBeInTheDocument();
  });

  it('GET network failure → no POST, failure reported', async () => {
    getSeedResponses = [() => { throw new TypeError('Failed to fetch'); }];

    renderPage();
    await waitFor(() => expect(seedSyncWarnings()).toHaveLength(1));
    expect(String(seedSyncWarnings()[0][0])).toContain('Failed to fetch');
    expect(postCalls()).toHaveLength(0);
  });

  it('a failed GET is not counted as synced — the next Treasury mount retries', async () => {
    getSeedResponses = [() => errJson(500, 'خطأ داخلي في الخادم.'), FOUND];

    const first = renderPage();
    await waitFor(() => expect(seedSyncWarnings()).toHaveLength(1));
    first.unmount();

    renderPage();
    await waitFor(() => expect(getCalls()).toHaveLength(2));
    await settle();
    expect(postCalls()).toHaveLength(0);
    expect(seedSyncWarnings()).toHaveLength(1);
  });

  it('GET 404 + POST failure while the row is still missing → reported, no error surfaced', async () => {
    postCashboxResponder = () => errJson(500, 'خطأ داخلي');

    const { queryByText } = renderPage();
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    await waitFor(() => expect(seedSyncWarnings()).toHaveLength(1));

    expect(queryByText(/خطأ داخلي/)).not.toBeInTheDocument();
    expect(queryByText(/فشل/)).not.toBeInTheDocument();
  });

  it('does not re-attempt the sync on remount within the same session (module-level guard)', async () => {
    const first = renderPage();
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    first.unmount();

    renderPage();
    // إعادة تركيب TreasuryPage — لا محاولة مزامنة ثانية طالما لم يُستدعَ resetGuard
    await settle();
    expect(getCalls()).toHaveLength(1);
    expect(postCalls()).toHaveLength(1);
  });

  it('never mutates local cashboxes state as a side effect of the sync attempt itself', async () => {
    renderPage();
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    // الحالة المحلية تبقى بلا تغيير — هذا مسار مزامنة خلفي فقط، لا يكتب لـ Zustand إطلاقاً
    expect(useAppStore.getState().cashboxes).toEqual([]);
  });
});
