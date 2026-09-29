// src/modules/users/UsersPage.selfEdit.test.jsx
// Pre-installer audit H1 — on a fresh install the roles table is empty and the owner created by
// the setup wizard has no roleId (explicit per-user permissions instead). Editing one's own
// account must therefore neither require a role in the form nor send a roleId: the server
// rejects any roleId that has no roles row. Editing ANOTHER user keeps the existing role
// requirement and still sends roleId.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import UsersPage from './UsersPage';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';
import { useAppStore } from '../../store/app.store';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetUsers: vi.fn(), pgGetRoles: vi.fn(), pgUpdateUser: vi.fn() };
});
import { pgGetUsers, pgGetRoles, pgUpdateUser } from '../../services/api';

const OWNER = { id: 'owner', name: 'مالك المركز', roleId: null, active: true, email: '' };
const OTHER = { id: 'u-other', name: 'موظف آخر', roleId: null, active: true, email: '' };

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.setItem('tc_session', JSON.stringify({
    id: 'owner', name: OWNER.name, role: 'admin', active: true, isAdmin: true, permissions: ['users', 'recitation'],
  }));
  useAppStore.setState({ addLog: vi.fn(async () => {}) });
  pgGetUsers.mockResolvedValue([OWNER, OTHER]);
  pgGetRoles.mockResolvedValue([]); // fresh install: no roles rows at all
  pgUpdateUser.mockImplementation(async (id, data) => ({ ...(id === OWNER.id ? OWNER : OTHER), ...data }));
});

async function openEditFor(user) {
  render(<AuthProvider><ToastProvider><UsersPage /></ToastProvider></AuthProvider>);
  fireEvent.click(await screen.findByText('حسابات المستخدمين'));
  const row = (await screen.findByText(user.name)).closest('tr');
  fireEvent.click(within(row).getByText('✎'));
  await screen.findByText(`تعديل حساب — ${user.name}`);
}

const setField = (name, value) =>
  fireEvent.change(document.querySelector(`input[name="${name}"]`), { target: { name, value } });

describe('Users page — owner self-edit on a fresh install (no roles)', () => {
  it('saves a name/email change without requiring a role and without sending roleId', async () => {
    await openEditFor(OWNER);
    setField('name', 'المالك الجديد');
    setField('email', 'owner@example.com');
    fireEvent.click(screen.getByRole('button', { name: /حفظ التعديلات/ }));

    await waitFor(() => expect(pgUpdateUser).toHaveBeenCalledTimes(1));
    const [id, payload] = pgUpdateUser.mock.calls[0];
    expect(id).toBe('owner');
    expect(payload).toEqual({ name: 'المالك الجديد', email: 'owner@example.com', active: true });
    expect(payload).not.toHaveProperty('roleId');
    expect(payload).not.toHaveProperty('permissions');
    expect(screen.queryByText('⚠ اختر الدور')).not.toBeInTheDocument();
  });

  it('sends a new password on self-edit, still without roleId', async () => {
    await openEditFor(OWNER);
    setField('password', 'Brand-new-pass2');
    fireEvent.click(screen.getByRole('button', { name: /حفظ التعديلات/ }));

    await waitFor(() => expect(pgUpdateUser).toHaveBeenCalledTimes(1));
    const [, payload] = pgUpdateUser.mock.calls[0];
    expect(payload.password).toBe('Brand-new-pass2');
    expect(payload).not.toHaveProperty('roleId');
  });

  it('the role selector stays disabled for one\'s own account', async () => {
    await openEditFor(OWNER);
    expect(document.querySelector('select[name="roleId"]')).toBeDisabled();
  });
});

describe('Users page — editing another user keeps the role requirement', () => {
  it('without a role: shows the "اختر الدور" error and never calls pgUpdateUser', async () => {
    await openEditFor(OTHER);
    fireEvent.click(screen.getByRole('button', { name: /حفظ التعديلات/ }));

    expect(await screen.findByText('⚠ اختر الدور')).toBeInTheDocument();
    expect(pgUpdateUser).not.toHaveBeenCalled();
  });

  it('with a role selected: sends that roleId', async () => {
    pgGetRoles.mockResolvedValue([{ id: 'cashier', label: 'كاشير', permissions: ['payments'] }]);
    await openEditFor(OTHER);
    fireEvent.change(document.querySelector('select[name="roleId"]'), { target: { name: 'roleId', value: 'cashier' } });
    fireEvent.click(screen.getByRole('button', { name: /حفظ التعديلات/ }));

    await waitFor(() => expect(pgUpdateUser).toHaveBeenCalledWith('u-other', expect.objectContaining({ roleId: 'cashier' })));
  });
});

// Security review finding 1 — the account-active toggle is never offered on one's own account
// (the server also refuses an administrator deactivating themselves); other users keep it.
describe('Users page — no self-deactivation toggle', () => {
  it('editing one\'s own account shows no "الحساب نشط" toggle', async () => {
    await openEditFor(OWNER);
    expect(screen.queryByText('الحساب نشط')).toBeNull();
    expect(document.querySelector('input[name="active"]')).toBeNull();
  });

  it('editing another user still shows the toggle', async () => {
    await openEditFor(OTHER);
    expect(screen.getByText('الحساب نشط')).toBeInTheDocument();
    expect(document.querySelector('input[name="active"]')).not.toBeNull();
  });
});

// Profile edit of ANOTHER administrator who has no role (like the setup-created owner): no role
// must be chosen, so the edit can never demote them; the server treats the empty roleId as
// "no role change" for an administrator.
describe('Users page — editing another administrator without a role', () => {
  const ADMIN2 = { id: 'admin2', name: 'مدير ثانٍ', roleId: null, isAdmin: true, active: true, email: '' };

  it('saves a name change without requiring a role, and requests no admin role change', async () => {
    pgGetUsers.mockResolvedValue([OWNER, OTHER, ADMIN2]);
    pgUpdateUser.mockImplementation(async (id, data) => ({ ...ADMIN2, ...data }));
    await openEditFor(ADMIN2);
    setField('name', 'مدير ثانٍ معدَّل');
    fireEvent.click(screen.getByRole('button', { name: /حفظ التعديلات/ }));

    await waitFor(() => expect(pgUpdateUser).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('⚠ اختر الدور')).toBeNull();
    const [id, payload] = pgUpdateUser.mock.calls[0];
    expect(id).toBe('admin2');
    expect(payload.name).toBe('مدير ثانٍ معدَّل');
    expect(payload.roleId || null).toBeNull(); // empty — never a non-admin role that would demote
  });
});
