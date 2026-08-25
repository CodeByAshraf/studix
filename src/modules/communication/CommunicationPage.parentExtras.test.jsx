// src/modules/communication/CommunicationPage.parentExtras.test.jsx
// Phase 3B-16 — parentExtras (local Zustand map) was replaced with the real,
// already-writable Postgres `parents` table. This mocks fetch directly (not
// pgCreateParent/pgUpdateParent themselves) to verify the real network payload
// buildParentRequestBody builds, the phone-normalization-based find-or-create logic
// in CommunicationPage.jsx's handleSaveParent, and the 409-phone-conflict retry.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import CommunicationPage from './CommunicationPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

let fetchMock;
let postResponder;
let putResponder;
let getResponder;

function okJson(data, status = 200) {
  return { ok: true, status, json: async () => ({ ok: true, data }) };
}
function errJson(status, error, field) {
  return { ok: false, status, json: async () => ({ ok: false, error, field }) };
}

beforeEach(() => {
  postResponder = () => okJson({ id: '1', phone: '201012345678', fullName: 'ولي أمر تجريبي', altPhone: null, preferredMethod: null, preferredTime: null, notes: null });
  putResponder  = () => okJson({ id: '1', phone: '201012345678', fullName: 'ولي أمر تجريبي', altPhone: null, preferredMethod: null, preferredTime: null, notes: null });
  getResponder  = () => [];

  fetchMock = vi.fn((url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    if (u.endsWith('/api/parents') && method === 'POST') return Promise.resolve(postResponder(opts.body ? JSON.parse(opts.body) : {}));
    if (u.includes('/api/parents/') && method === 'PUT') {
      const id = u.split('/api/parents/')[1];
      return Promise.resolve(putResponder(decodeURIComponent(id), opts.body ? JSON.parse(opts.body) : {}));
    }
    if (u.endsWith('/api/parents') && method === 'GET') return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: getResponder() }) });
    return Promise.reject(new Error(`unexpected fetch: ${method} ${u}`));
  });
  globalThis.fetch = fetchMock;
});
afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <CommunicationPage />
      </ToastProvider>
    </AuthProvider>
  );
}

function seedStore(extra = {}) {
  useAppStore.setState({ communications: [], commTasks: [], parents: [], ...extra });
}

function postCalls() {
  return fetchMock.mock.calls.filter(([url, opts]) => String(url).endsWith('/api/parents') && (opts?.method || 'GET') === 'POST');
}
function putCalls() {
  return fetchMock.mock.calls.filter(([url, opts]) => String(url).includes('/api/parents/') && opts?.method === 'PUT');
}
function getCalls() {
  return fetchMock.mock.calls.filter(([url, opts]) => String(url).endsWith('/api/parents') && (opts?.method || 'GET') === 'GET');
}

const RECORD_WITH_PHONE = {
  id: 'c1', number: 'COM-000001', type: 'phoneCall', result: 'answered', reason: 'inquiry',
  priority: 'normal', status: 'open', parentName: 'أحمد علي', studentName: 'محمد أحمد',
  phone: '01012345678', notes: '', employee: 'الموظف الحالي', createdAt: '2026-01-01T10:00:00.000Z',
  followupDate: null, followupTime: null,
};

const RECORD_NAME_ONLY = {
  id: 'c2', number: 'COM-000002', type: 'phoneCall', result: 'answered', reason: 'inquiry',
  priority: 'normal', status: 'open', parentName: 'سارة محمود', studentName: 'ليلى سارة',
  phone: '', notes: '', employee: 'الموظف الحالي', createdAt: '2026-01-01T11:00:00.000Z',
  followupDate: null, followupTime: null,
};

function selectParent(studentName) {
  fireEvent.click(screen.getByText(studentName));
}
function openEditModal() {
  fireEvent.click(screen.getByRole('button', { name: 'تعديل' }));
}
function modalBody() {
  return screen.getByText('تعديل بيانات ولي الأمر').closest('div').parentElement;
}

describe('CommunicationPage — parents write path (parentExtras replaced by real Postgres parents)', () => {
  beforeEach(() => {
    seedStore();
  });

  it('create: no matching real parents row exists — sends normalized phone + fullName + the 4 fields, does not touch local state before the backend resolves, then adopts the server response into parents', async () => {
    let resolvePost;
    postResponder = () => new Promise((resolve) => { resolvePost = resolve; });

    seedStore({ communications: [RECORD_WITH_PHONE] });
    renderPage();
    selectParent('محمد أحمد');
    openEditModal();

    const body = modalBody();
    fireEvent.change(within(body).getByPlaceholderText('01xxxxxxxxx'), { target: { value: '01099998888' } });
    fireEvent.change(within(body).getByPlaceholderText('مثال: بعد العصر'), { target: { value: 'بعد العصر' } });
    fireEvent.click(within(body).getByRole('button', { name: 'حفظ' }));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    const sentBody = JSON.parse(postCalls()[0][1].body);
    // preferredMethod/notes لم تُلمَس — تُرسَل كنص فارغ (نفس اتفاقية الحقول النصية غير
    // الملموسة في كل مكان آخر بالتطبيق، مثل materialService.js)، لا null.
    expect(sentBody).toEqual({
      phone: '201012345678', fullName: 'أحمد علي',
      altPhone: '01099998888', preferredMethod: '', preferredTime: 'بعد العصر', notes: '',
    });

    // لا تعديل محلي قبل نجاح الخادم
    expect(useAppStore.getState().parents).toEqual([]);

    resolvePost(okJson({
      id: '5', phone: '201012345678', fullName: 'أحمد علي',
      altPhone: '01099998888', preferredMethod: null, preferredTime: 'بعد العصر', notes: null,
    }));

    await waitFor(() => {
      const parents = useAppStore.getState().parents;
      expect(parents).toHaveLength(1);
      expect(parents[0].id).toBe('5');
      expect(parents[0].altPhone).toBe('01099998888');
    });
  });

  it('update: a real parents row is already matched by normalized phone — sends only the 4 fields to PUT /api/parents/:id (no phone/fullName), pre-fills the form from the matched row, does not touch local state before success', async () => {
    const existingRow = {
      id: '9', phone: '201012345678', fullName: 'أحمد علي',
      altPhone: '01011112222', preferredMethod: 'whatsapp', preferredTime: 'مساءً', notes: 'ملاحظة قديمة',
    };
    seedStore({ communications: [RECORD_WITH_PHONE], parents: [existingRow] });

    let resolvePut;
    putResponder = () => new Promise((resolve) => { resolvePut = resolve; });

    renderPage();
    selectParent('محمد أحمد');
    openEditModal();

    const body = modalBody();
    // الحقول مُعبّأة مسبقاً من الصف الحقيقي المطابَق (لا يوجد notice "لا يوجد هاتف صالح")
    expect(within(body).queryByText(/لا يوجد رقم هاتف صالح/)).not.toBeInTheDocument();
    expect(within(body).getByPlaceholderText('01xxxxxxxxx').value).toBe('01011112222');

    fireEvent.click(within(body).getByRole('button', { name: 'حفظ' }));

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    const [sentId, sentBody] = [putCalls()[0][0].split('/api/parents/')[1], JSON.parse(putCalls()[0][1].body)];
    expect(decodeURIComponent(sentId)).toBe('9');
    expect(sentBody).toEqual({ altPhone: '01011112222', preferredMethod: 'whatsapp', preferredTime: 'مساءً', notes: 'ملاحظة قديمة' });
    expect(sentBody.phone).toBeUndefined();
    expect(sentBody.fullName).toBeUndefined();

    expect(useAppStore.getState().parents).toEqual([existingRow]);

    resolvePut(okJson({ ...existingRow, notes: 'ملاحظة محدَّثة' }));

    await waitFor(() => {
      const parents = useAppStore.getState().parents;
      expect(parents).toHaveLength(1);
      expect(parents[0].notes).toBe('ملاحظة محدَّثة');
    });
  });

  it('409 phone conflict on create: retries as an update against the real id resolved from a fresh GET /api/parents (not from stale local state)', async () => {
    postResponder = () => errJson(409, 'قيمة مكرّرة تنتهك قيد التفرّد.', ['phone']);
    getResponder = () => [{ id: '42', phone: '201012345678', fullName: 'أحمد علي', altPhone: null, preferredMethod: null, preferredTime: null, notes: null }];
    putResponder = () => okJson({ id: '42', phone: '201012345678', fullName: 'أحمد علي', altPhone: '01055556666', preferredMethod: null, preferredTime: null, notes: null });

    seedStore({ communications: [RECORD_WITH_PHONE] });
    renderPage();
    selectParent('محمد أحمد');
    openEditModal();

    const body = modalBody();
    fireEvent.change(within(body).getByPlaceholderText('01xxxxxxxxx'), { target: { value: '01055556666' } });
    fireEvent.click(within(body).getByRole('button', { name: 'حفظ' }));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    await waitFor(() => expect(getCalls()).toHaveLength(1));
    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(decodeURIComponent(putCalls()[0][0].split('/api/parents/')[1])).toBe('42');

    await waitFor(() => {
      const parents = useAppStore.getState().parents;
      expect(parents).toHaveLength(1);
      expect(parents[0].altPhone).toBe('01055556666');
    });
  });

  it('create failure: leaves parents state untouched and surfaces the real server error', async () => {
    postResponder = () => errJson(400, 'قيمة غير صالحة.');

    seedStore({ communications: [RECORD_WITH_PHONE] });
    renderPage();
    selectParent('محمد أحمد');
    openEditModal();
    fireEvent.click(within(modalBody()).getByRole('button', { name: 'حفظ' }));

    expect(await screen.findByText('قيمة غير صالحة.')).toBeInTheDocument();
    expect(useAppStore.getState().parents).toEqual([]);
  });

  it('no valid phone (name-only derived parent): Save is disabled, no network call is ever made', async () => {
    seedStore({ communications: [RECORD_NAME_ONLY] });
    renderPage();
    selectParent('ليلى سارة');
    openEditModal();

    const body = modalBody();
    expect(within(body).getByText(/لا يوجد رقم هاتف صالح/)).toBeInTheDocument();
    const saveBtn = within(body).getByRole('button', { name: 'حفظ' });
    expect(saveBtn).toBeDisabled();

    fireEvent.click(saveBtn);
    expect(postCalls()).toHaveLength(0);
    expect(useAppStore.getState().parents).toEqual([]);
  });
});
