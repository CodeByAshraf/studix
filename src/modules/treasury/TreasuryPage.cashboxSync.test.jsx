// src/modules/treasury/TreasuryPage.cashboxSync.test.jsx
// Product Completion Phase 1 — Issue 2, Option A. A fresh install has zero real
// cashboxes in Postgres, but INITIAL_CASHBOXES already seeds a local-only 'cb_main' —
// so PaymentForm.jsx's already-correct "no active cashbox" empty state never fires, and
// the server rejects the very first payment attempt late, after the form is filled.
// TreasuryPage now syncs that exact seed row to Postgres once, silently, on mount. We
// mock fetch directly (not the api.js module) — same technique as
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

function okJson(data, status = 200) {
  return { ok: true, status, json: async () => ({ ok: true, data }) };
}
function errJson(status, error) {
  return { ok: false, status, json: async () => ({ ok: false, error }) };
}

beforeEach(() => {
  __resetCashboxSyncGuardForTests();
  postCashboxResponder = (body) => okJson({ ...body, createdAt: '2026-01-02T00:00:00.000Z' }, 201);
  fetchMock = vi.fn((url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    if (u.endsWith('/api/cashboxes') && method === 'POST') {
      return Promise.resolve(postCashboxResponder(opts.body ? JSON.parse(opts.body) : {}));
    }
    return Promise.reject(new Error(`unexpected fetch: ${method} ${u}`));
  });
  globalThis.fetch = fetchMock;
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

function postCalls() {
  return fetchMock.mock.calls.filter(([url, opts]) => String(url).endsWith('/api/cashboxes') && opts?.method === 'POST');
}

describe('TreasuryPage — background cb_main sync on mount (Product Completion Phase 1, Issue 2)', () => {
  it('POSTs the exact local seed cashbox exactly once on mount', async () => {
    renderPage();

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    const sentBody = JSON.parse(postCalls()[0][1].body);
    expect(sentBody).toMatchObject({
      id: 'cb_main', name: 'الخزنة الرئيسية', type: 'main',
      isDefault: true, active: true,
    });
  });

  it('treats a 409 (already exists) as success — no error toast, no thrown/unhandled rejection', async () => {
    postCashboxResponder = () => errJson(409, 'قيمة مكرّرة تنتهك قيد التفرّد.');

    const { queryByText } = renderPage();
    await waitFor(() => expect(postCalls()).toHaveLength(1));

    // لا رسالة خطأ تظهر للمستخدم — هذا مسار خلفي صامت بتصميم صريح
    expect(queryByText(/قيمة مكرّرة/)).not.toBeInTheDocument();
    expect(queryByText(/فشل/)).not.toBeInTheDocument();
  });

  it('swallows any other failure (e.g. network) just as silently — no error surfaced', async () => {
    postCashboxResponder = () => errJson(500, 'خطأ داخلي');

    const { queryByText } = renderPage();
    await waitFor(() => expect(postCalls()).toHaveLength(1));

    expect(queryByText(/خطأ داخلي/)).not.toBeInTheDocument();
    expect(queryByText(/فشل/)).not.toBeInTheDocument();
  });

  it('does not re-attempt the sync on remount within the same session (module-level guard)', async () => {
    const first = renderPage();
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    first.unmount();

    renderPage();
    // إعادة تركيب TreasuryPage — لا محاولة مزامنة ثانية طالما لم يُستدعَ resetGuard
    await new Promise((r) => setTimeout(r, 20));
    expect(postCalls()).toHaveLength(1);
  });

  it('never mutates local cashboxes state as a side effect of the sync attempt itself', async () => {
    renderPage();
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    // الحالة المحلية تبقى بلا تغيير — هذا مسار مزامنة خلفي فقط، لا يكتب لـ Zustand إطلاقاً
    expect(useAppStore.getState().cashboxes).toEqual([]);
  });
});
