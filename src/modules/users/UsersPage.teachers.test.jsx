// src/modules/users/UsersPage.teachers.test.jsx
// M-04 — teacher records are PostgreSQL records (/api/teachers), never browser localStorage:
// loaded from the server, written server-first, the server's response is what is displayed, a
// failed write changes nothing, and a fresh store/render (reload, another browser) sees the same
// records. The teacher-account link is users.teacher_id, sent as teacherId through /api/users.
// fetch is mocked as a small in-memory server so the real api.js helpers and their request
// bodies are exercised (no api module mock).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import UsersPage from './UsersPage';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';
import { useAppStore } from '../../store/app.store';

let server;      // { teachers: raw DB rows, users: client-shaped users, nextId }
let failNext;    // { method, path } -> answer 500 once
let fetchMock;

function ok(body, status = 200) { return Promise.resolve({ ok: true, status, json: async () => body }); }
function fail(status, error) { return Promise.resolve({ ok: false, status, json: async () => ({ ok: false, error }) }); }

beforeEach(() => {
  server = {
    teachers: [
      { id: '1', name: 'مدرس مرتبط', phone: '01011111111', subject: 'رياضيات', active: true, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: '2', name: 'مدرس متوقف', phone: '01022222222', subject: 'فيزياء', active: false, createdAt: '2026-01-01T00:00:00.000Z' },
    ],
    users: [
      { id: 'u-linked', name: 'حساب مرتبط', roleId: 'cashier', active: true, email: '', teacherId: '1' },
      { id: 'u-free', name: 'حساب حر', roleId: 'cashier', active: true, email: '', teacherId: null },
    ],
    nextId: 100,
  };
  failNext = null;
  fetchMock = vi.fn((url, opts = {}) => {
    const u = new URL(String(url));
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (failNext && failNext.method === method && u.pathname.startsWith(failNext.path)) {
      failNext = null;
      return fail(500, 'خطأ داخلي في الخادم.');
    }
    if (u.pathname === '/api/teachers' && method === 'GET') return ok({ ok: true, data: server.teachers });
    if (u.pathname === '/api/teachers' && method === 'POST') {
      // The server's response is the record of truth (id from the sequence, name as stored).
      const row = { ...body, id: String(server.nextId++), name: `${body.name} (محفوظ)`, createdAt: '2026-10-01T00:00:00.000Z' };
      server.teachers.push(row);
      return ok({ ok: true, data: row }, 201);
    }
    const tm = u.pathname.match(/^\/api\/teachers\/(\d+)$/);
    if (tm && method === 'PUT') {
      const i = server.teachers.findIndex((t) => t.id === tm[1]);
      server.teachers[i] = { ...server.teachers[i], ...body };
      return ok({ ok: true, data: server.teachers[i] });
    }
    if (tm && method === 'DELETE') {
      if (server.users.some((x) => x.teacherId === tm[1])) return fail(409, 'انتهاك مفتاح خارجي (سجل مرتبط غير موجود).');
      server.teachers = server.teachers.filter((t) => t.id !== tm[1]);
      return ok({ ok: true });
    }
    if (u.pathname === '/api/users' && method === 'GET') return ok({ ok: true, users: server.users });
    if (u.pathname === '/api/roles' && method === 'GET') return ok({ ok: true, roles: [{ id: 'cashier', label: 'كاشير', permissions: ['payments'] }] });
    const um = u.pathname.match(/^\/api\/users\/([^/]+)$/);
    if (um && method === 'PUT') {
      const i = server.users.findIndex((x) => x.id === decodeURIComponent(um[1]));
      server.users[i] = { ...server.users[i], ...body };
      return ok({ ok: true, user: server.users[i] });
    }
    if (u.pathname === '/api/activityLogs' && method === 'POST') return ok({ ok: true, data: { id: 'log1', ...body } }, 201);
    return Promise.reject(new Error(`unexpected fetch: ${method} ${u.pathname}`));
  });
  globalThis.fetch = fetchMock;
  sessionStorage.setItem('tc_session', JSON.stringify({
    id: 'owner', name: 'المالك', role: 'admin', active: true, isAdmin: true, permissions: ['users'],
  }));
  useAppStore.setState({ addLog: vi.fn(async () => {}) });
});
afterEach(() => { vi.restoreAllMocks(); });

function renderPage() {
  return render(<AuthProvider><ToastProvider><UsersPage /></ToastProvider></AuthProvider>);
}
const rowOf = async (name) => (await screen.findByText(name)).closest('tr');
const calls = (method, pathRe) => fetchMock.mock.calls.filter(([url, o]) => (o?.method || 'GET') === method && pathRe.test(new URL(String(url)).pathname));
const setField = (name, value) => {
  const el = document.querySelector(`[name="${name}"]`);
  fireEvent.change(el, { target: { name, value } });
};

describe('UsersPage — teachers are server-backed records (M-04)', () => {
  it('loads teachers from GET /api/teachers (status from `active`) and never touches localStorage for them', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    renderPage();

    expect(within(await rowOf('مدرس مرتبط')).getByText('✓ نشط')).toBeInTheDocument();
    expect(within(await rowOf('مدرس متوقف')).getByText('✗ غير نشط')).toBeInTheDocument();
    expect(calls('GET', /^\/api\/teachers$/)).toHaveLength(1);

    expect(setItem.mock.calls.some(([k]) => k === 'studix-auth-teachers')).toBe(false);
    expect(getItem.mock.calls.some(([k]) => k === 'studix-auth-teachers')).toBe(false);
  });

  it('create: POSTs only the stored fields, then shows the server\'s record (not the local form)', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderPage();
    await rowOf('مدرس مرتبط');
    fireEvent.click(screen.getByText('+ إضافة مدرس'));
    setField('name', 'أحمد سامي');
    setField('phone', '01033333333');
    setField('subject', 'كيمياء');
    expect(document.querySelector('[name="hireDate"]')).toBeNull();
    expect(document.querySelector('[name="email"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /إضافة المدرس/ }));

    await waitFor(() => expect(calls('POST', /^\/api\/teachers$/)).toHaveLength(1));
    const [, opts] = calls('POST', /^\/api\/teachers$/)[0];
    expect(JSON.parse(opts.body)).toEqual({ name: 'أحمد سامي', phone: '01033333333', subject: 'كيمياء', active: true });
    expect(await screen.findByText('أحمد سامي (محفوظ)')).toBeInTheDocument();
    expect(screen.queryByText(/^أحمد سامي$/)).not.toBeInTheDocument();
    expect(setItem.mock.calls.some(([k]) => k === 'studix-auth-teachers')).toBe(false);
  });

  it('edit: PUTs /api/teachers/:id and shows the server response (deactivation included)', async () => {
    renderPage();
    fireEvent.click(within(await rowOf('مدرس مرتبط')).getByText('✎'));
    setField('name', 'مدرس معدَّل');
    setField('status', 'inactive');
    fireEvent.click(screen.getByRole('button', { name: /حفظ/ }));

    await waitFor(() => expect(calls('PUT', /^\/api\/teachers\/1$/)).toHaveLength(1));
    const [, opts] = calls('PUT', /^\/api\/teachers\/1$/)[0];
    expect(JSON.parse(opts.body)).toEqual({ name: 'مدرس معدَّل', phone: '01011111111', subject: 'رياضيات', active: false });
    expect(within(await rowOf('مدرس معدَّل')).getByText('✗ غير نشط')).toBeInTheDocument();
  });

  it('delete: DELETEs behind the confirmation and removes the row only after the server succeeds', async () => {
    renderPage();
    fireEvent.click(within(await rowOf('مدرس متوقف')).getByText('🗑'));
    fireEvent.click(screen.getByRole('button', { name: 'نعم، احذف' }));
    await waitFor(() => expect(calls('DELETE', /^\/api\/teachers\/2$/)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('مدرس متوقف')).not.toBeInTheDocument());
  });

  it('a teacher linked to an account: the server 409 is surfaced and the row stays', async () => {
    renderPage();
    fireEvent.click(within(await rowOf('مدرس مرتبط')).getByText('🗑'));
    fireEvent.click(screen.getByRole('button', { name: 'نعم، احذف' }));
    expect(await screen.findByText(/مرتبط بحساب مستخدم أو بمجموعة/)).toBeInTheDocument();
    expect(screen.getByText('مدرس مرتبط')).toBeInTheDocument();
  });

  it('a failed create changes nothing locally (no row added)', async () => {
    renderPage();
    await rowOf('مدرس مرتبط');
    failNext = { method: 'POST', path: '/api/teachers' };
    fireEvent.click(screen.getByText('+ إضافة مدرس'));
    setField('name', 'لن يُحفَظ');
    setField('phone', '01044444444');
    setField('subject', 'أحياء');
    fireEvent.click(screen.getByRole('button', { name: /إضافة المدرس/ }));
    await waitFor(() => expect(calls('POST', /^\/api\/teachers$/)).toHaveLength(1));
    expect(screen.queryByText(/لن يُحفَظ \(محفوظ\)/)).not.toBeInTheDocument();
    expect(screen.queryAllByText('لن يُحفَظ').filter((el) => el.closest('tr'))).toHaveLength(0);
  });

  it('a fresh store/render (reload, another browser profile) shows the same server records', async () => {
    renderPage();
    fireEvent.click(screen.getByText('+ إضافة مدرس'));
    await rowOf('مدرس مرتبط');
    setField('name', 'مدرس جديد');
    setField('phone', '01055555555');
    setField('subject', 'عربي');
    fireEvent.click(screen.getByRole('button', { name: /إضافة المدرس/ }));
    await screen.findByText('مدرس جديد (محفوظ)');

    cleanup();
    localStorage.clear();
    useAppStore.setState({ addLog: vi.fn(async () => {}) });
    renderPage();
    expect(await screen.findByText('مدرس جديد (محفوظ)')).toBeInTheDocument();
    expect(screen.getByText('مدرس مرتبط')).toBeInTheDocument();
  });
});

describe('UsersPage — the teacher-account link is users.teacher_id (M-04)', () => {
  it('the linked account is derived from users.teacherId', async () => {
    renderPage();
    expect(within(await rowOf('مدرس مرتبط')).getByText(/u-linked/)).toBeInTheDocument();
    expect(within(await rowOf('مدرس متوقف')).getByText('+ إنشاء حساب')).toBeInTheDocument();
  });

  it('linking an account sends teacherId through PUT /api/users/:id; an untouched link is not sent', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('حسابات المستخدمين'));
    fireEvent.click(within(await rowOf('حساب حر')).getByText('✎'));
    setField('teacherId', '2');
    fireEvent.click(screen.getByRole('button', { name: /حفظ التعديلات/ }));
    await waitFor(() => expect(calls('PUT', /^\/api\/users\/u-free$/)).toHaveLength(1));
    expect(JSON.parse(calls('PUT', /^\/api\/users\/u-free$/)[0][1].body).teacherId).toBe('2');

    fireEvent.click(within(await rowOf('حساب مرتبط')).getByText('✎'));
    setField('name', 'حساب مرتبط معدَّل');
    fireEvent.click(screen.getByRole('button', { name: /حفظ التعديلات/ }));
    await waitFor(() => expect(calls('PUT', /^\/api\/users\/u-linked$/)).toHaveLength(1));
    expect(JSON.parse(calls('PUT', /^\/api\/users\/u-linked$/)[0][1].body)).not.toHaveProperty('teacherId');
  });

  it('unlinking sends teacherId: null', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('حسابات المستخدمين'));
    fireEvent.click(within(await rowOf('حساب مرتبط')).getByText('✎'));
    setField('teacherId', '');
    fireEvent.click(screen.getByRole('button', { name: /حفظ التعديلات/ }));
    await waitFor(() => expect(calls('PUT', /^\/api\/users\/u-linked$/)).toHaveLength(1));
    expect(JSON.parse(calls('PUT', /^\/api\/users\/u-linked$/)[0][1].body).teacherId).toBeNull();
  });
});
