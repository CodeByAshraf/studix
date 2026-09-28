// src/modules/users/UsersPage.rolePermissions.test.jsx
// The Roles form builds its permission checkboxes from SYSTEM_PAGES. The Recitation screen
// (route /recitation, sidebar "التسميع") and its API are guarded by the 'recitation'
// permission, which is deliberately never granted automatically — an admin grants it here.
// This proves the Roles form offers that permission and sends it when a role is saved.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import UsersPage from './UsersPage';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';
import { useAppStore } from '../../store/app.store';
import { SYSTEM_PAGES } from '../../services/usersService';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetUsers: vi.fn(), pgGetRoles: vi.fn(), pgCreateRole: vi.fn() };
});
import { pgGetUsers, pgGetRoles, pgCreateRole } from '../../services/api';

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.setItem('tc_session', JSON.stringify({
    id: 'admin', name: 'Admin', role: 'admin', active: true, isAdmin: true, permissions: ['users'],
  }));
  useAppStore.setState({ addLog: vi.fn(async () => {}) });
  pgGetUsers.mockResolvedValue([]);
  pgGetRoles.mockResolvedValue([]);
  pgCreateRole.mockImplementation(async (role) => ({ ...role, isSystem: false }));
});

async function openNewRoleForm() {
  render(<AuthProvider><ToastProvider><UsersPage /></ToastProvider></AuthProvider>);
  fireEvent.click(await screen.findByText('الأدوار والصلاحيات'));
  fireEvent.click(await screen.findByText('+ إضافة دور'));
}

describe('Roles form — Recitation permission', () => {
  it('SYSTEM_PAGES exposes recitation in the academic group', () => {
    expect(SYSTEM_PAGES).toContainEqual(expect.objectContaining({ id: 'recitation', label: 'التسميع', group: 'الأكاديمي' }));
  });

  it('the Roles form shows a التسميع permission checkbox and saves it as "recitation"', async () => {
    await openNewRoleForm();

    const recitation = await screen.findByRole('button', { name: /التسميع/ });
    fireEvent.click(recitation);
    expect(screen.getByText(`1 صلاحية من ${SYSTEM_PAGES.length} محددة`)).toBeInTheDocument();

    fireEvent.change(document.querySelector('input[name="id"]'), { target: { name: 'id', value: 'reciter' } });
    fireEvent.change(document.querySelector('input[name="label"]'), { target: { name: 'label', value: 'مُسمِّع' } });
    fireEvent.click(screen.getByRole('button', { name: /إنشاء الدور/ }));

    await waitFor(() => expect(pgCreateRole).toHaveBeenCalledWith(expect.objectContaining({
      id: 'reciter', permissions: ['recitation'],
    })));
  });
});
