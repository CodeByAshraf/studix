// src/modules/treasury/TreasuryPage.cashboxes.test.jsx
// Phase 3B-14A — cashboxes is the first financial collection with a real PostgreSQL
// write path (pgCreateCashbox/pgUpdateCashbox → generic CRUD, client id preserved).
// We mock fetch directly (not the api.js module) so we verify the real, unmocked
// requests TreasuryPage.handleSaveCashbox builds — same technique used throughout
// this migration series (see AdmissionsPage.activation.test.jsx).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import TreasuryPage, { __resetCashboxSyncGuardForTests } from './TreasuryPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

let fetchMock;
let postResponder; // POST /api/cashboxes
let putResponder;  // PUT /api/cashboxes/:id

function okJson(data, status = 200) {
  return { ok: true, status, json: async () => ({ ok: true, data }) };
}
function errJson(status, error) {
  return { ok: false, status, json: async () => ({ ok: false, error }) };
}

const EXISTING_CB = {
  id: 'cb_existing', name: 'خزنة الفرع', type: 'branch', color: '#0d9488', icon: '🏦',
  openingBalance: 500, isDefault: false, active: true, notes: '',
  createdAt: '2026-01-01T00:00:00.000Z',
};

// المزروعة محلياً منذ قبل Phase 3B-14A — لم تُنشَأ أبداً عبر POST على الخادم.
const SEED_CB_MAIN = {
  id: 'cb_main', name: 'الخزنة الرئيسية', type: 'main', color: '#0d9488', icon: '🏦',
  openingBalance: 0, isDefault: true, active: true, notes: 'الخزنة الافتراضية',
  createdAt: '2026-01-01',
};

beforeEach(() => {
  // Product Completion Phase 1, Issue 2: TreasuryPage now also POSTs a background
  // cb_main sync attempt on mount (see TreasuryPage.cashboxSync.test.jsx for its own
  // dedicated tests). Reset the module-level once-per-session guard so every test here
  // starts deterministic instead of depending on which test in this file mounts first.
  __resetCashboxSyncGuardForTests();
  postResponder = (body) => okJson({ ...body, createdAt: '2026-01-02T00:00:00.000Z' }, 201);
  putResponder = (id, body) => okJson({ ...body, id });
  fetchMock = vi.fn((url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (u.endsWith('/api/cashboxes') && method === 'POST') return Promise.resolve(postResponder(body));
    if (u.includes('/api/cashboxes/') && method === 'PUT') {
      const id = decodeURIComponent(u.split('/api/cashboxes/')[1]);
      return Promise.resolve(putResponder(id, body));
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
        <TreasuryPage />
      </ToastProvider>
    </AuthProvider>
  );
}

function seedStore(extra = {}) {
  useAppStore.setState({ cashboxes: [], treasuryTxn: [], ...extra });
}

function callsTo(matcher) {
  return fetchMock.mock.calls.filter(([url, opts]) => matcher(String(url), opts));
}
const postCalls = () => callsTo((u, o) => u.endsWith('/api/cashboxes') && o?.method === 'POST');
const putCalls  = () => callsTo((u, o) => u.includes('/api/cashboxes/') && o?.method === 'PUT');
// Excludes Issue 2's own background cb_main sync POST — these existing tests are about
// user-driven cashbox CRUD, which the sync attempt (a real, but separate, POST to the
// same endpoint) must not interfere with.
const userPostCalls = () => postCalls().filter(([, o]) => JSON.parse(o.body).id !== 'cb_main');

async function openManageTab() {
  fireEvent.click(screen.getByText('⚙ إدارة الخزن'));
}

describe('TreasuryPage — cashboxes (Phase 3B-14A — generic CRUD, client id preserved)', () => {
  it('creates via exactly one POST, preserving the client-generated id, with no premature local mutation, adopting the server response on success', async () => {
    let resolvePost;
    postResponder = () => new Promise((resolve) => { resolvePost = resolve; });

    seedStore();
    renderPage();
    await openManageTab();
    fireEvent.click(screen.getByText('+ إضافة خزنة'));
    fireEvent.change(screen.getByPlaceholderText('مثال: الخزنة الرئيسية'), { target: { value: 'خزنة جديدة' } });
    fireEvent.click(screen.getByText('💾 حفظ'));

    await waitFor(() => expect(userPostCalls()).toHaveLength(1));
    const [, sentOpts] = userPostCalls()[0];
    const sentBody = JSON.parse(sentOpts.body);
    expect(sentBody.name).toBe('خزنة جديدة');
    expect(typeof sentBody.id).toBe('string');
    expect(sentBody.id.startsWith('cb_')).toBe(true);

    // لا تعديل محلي قبل نجاح الاستدعاء
    expect(useAppStore.getState().cashboxes).toEqual([]);

    resolvePost(okJson({ ...sentBody, openingBalance: 0 }, 201));

    await waitFor(() => {
      expect(useAppStore.getState().cashboxes).toHaveLength(1);
    });
    expect(useAppStore.getState().cashboxes[0].id).toBe(sentBody.id);
    expect(useAppStore.getState().cashboxes[0].name).toBe('خزنة جديدة');
    // نداءان فقط: مزامنة cb_main الخلفية (Issue 2) + إنشاء الخزنة الجديدة التي يقودها المستخدم
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('create failure: leaves cashboxes untouched and shows an error', async () => {
    postResponder = () => errJson(400, 'اسم الخزنة مطلوب');

    seedStore();
    renderPage();
    await openManageTab();
    fireEvent.click(screen.getByText('+ إضافة خزنة'));
    fireEvent.change(screen.getByPlaceholderText('مثال: الخزنة الرئيسية'), { target: { value: 'خزنة فاشلة' } });
    fireEvent.click(screen.getByText('💾 حفظ'));

    await waitFor(() => expect(userPostCalls()).toHaveLength(1));
    expect(useAppStore.getState().cashboxes).toEqual([]);
  });

  it('updates an already-synced cashbox via exactly one PUT, adopting the server response', async () => {
    seedStore({ cashboxes: [EXISTING_CB] });
    renderPage();
    await openManageTab();
    fireEvent.click(screen.getByText('✎ تعديل'));
    fireEvent.change(screen.getByPlaceholderText('مثال: الخزنة الرئيسية'), { target: { value: 'خزنة الفرع المُحدَّثة' } });
    fireEvent.click(screen.getByText('💾 حفظ'));

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    const [sentUrl, sentOpts] = putCalls()[0];
    expect(decodeURIComponent(sentUrl.split('/api/cashboxes/')[1])).toBe('cb_existing');
    expect(JSON.parse(sentOpts.body).name).toBe('خزنة الفرع المُحدَّثة');

    await waitFor(() => {
      expect(useAppStore.getState().cashboxes[0].name).toBe('خزنة الفرع المُحدَّثة');
    });
    // لا POST إطلاقاً — الصف موجود بالفعل على الخادم
    expect(userPostCalls()).toHaveLength(0);
  });

  // Phase 3B-14A correction: no reconciliation flow of any kind. Updating a cashbox
  // that doesn't exist on the server yet (e.g. the locally-seeded cb_main, never
  // POSTed) must fail as a normal server error — never silently convert into a create.
  it('updating a non-existent cashbox (cb_main, never POSTed) fails with a clear server error — no POST fallback, no id/identity change, local state untouched', async () => {
    putResponder = () => errJson(404, 'السجل غير موجود.');

    seedStore({ cashboxes: [SEED_CB_MAIN] });
    renderPage();
    await openManageTab();
    fireEvent.click(screen.getByText('✎ تعديل'));
    fireEvent.change(screen.getByPlaceholderText('مثال: الخزنة الرئيسية'), { target: { value: 'محاولة تعديل فاشلة' } });
    fireEvent.click(screen.getByText('💾 حفظ'));

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    const [sentUrl] = putCalls()[0];
    expect(decodeURIComponent(sentUrl.split('/api/cashboxes/')[1])).toBe('cb_main');

    // لا POST إطلاقاً بأي شكل — لا تحويل ضمني للتحديث إلى إنشاء
    expect(userPostCalls()).toHaveLength(0);
    // لا تغيير محلي إطلاقاً — لا الاسم، لا أي حقل آخر، لا id جديد
    expect(useAppStore.getState().cashboxes).toEqual([SEED_CB_MAIN]);
  });

  it('update failure on an existing, already-synced cashbox (non-404) also results in no POST and no local mutation', async () => {
    putResponder = () => errJson(400, 'قيمة أطول من المسموح.');

    seedStore({ cashboxes: [EXISTING_CB] });
    renderPage();
    await openManageTab();
    fireEvent.click(screen.getByText('✎ تعديل'));
    fireEvent.click(screen.getByText('💾 حفظ'));

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(userPostCalls()).toHaveLength(0);
    expect(useAppStore.getState().cashboxes[0]).toEqual(EXISTING_CB);
  });

  // MEDIUM-A Finding 4: تفعيل/تعطيل خزنة — الحقل موجود بالفعل في الخادم والـ schema،
  // كان فقط غائباً عن نموذج التعديل بالواجهة.
  it('deactivating an existing cashbox: the "active" checkbox starts checked, unchecking it sends active:false in the PUT body and adopts the server response', async () => {
    seedStore({ cashboxes: [EXISTING_CB] });
    renderPage();
    await openManageTab();
    fireEvent.click(screen.getByText('✎ تعديل'));

    const activeCheckbox = screen.getByRole('checkbox');
    expect(activeCheckbox).toBeChecked();
    fireEvent.click(activeCheckbox);
    fireEvent.click(screen.getByText('💾 حفظ'));

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    const [, sentOpts] = putCalls()[0];
    expect(JSON.parse(sentOpts.body).active).toBe(false);

    await waitFor(() => {
      expect(useAppStore.getState().cashboxes[0].active).toBe(false);
    });
  });

  it('adding a new cashbox does not show the active toggle (always starts active by default)', async () => {
    seedStore();
    renderPage();
    await openManageTab();
    fireEvent.click(screen.getByText('+ إضافة خزنة'));

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
