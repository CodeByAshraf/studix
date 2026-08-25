// src/layouts/Sidebar.test.jsx
// Product Completion Phase 1 — Issue 1 (Navigation).
// Proves the actual fix: canSeeItem's PAGE_ID_OVERRIDES maps 'communication' -> 'students'
// permission and 'inventory' -> 'materials' permission (their route ids don't literally
// match any real permission key). A test that only checked NAV_ITEMS contains the two
// entries would pass even if the permission mapping were still wrong (items added but
// permanently hidden), so this renders the real Sidebar behind real AuthProvider/UIProvider
// and asserts visibility both with and without the backing permissions.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from './Sidebar';
import { AuthProvider } from '../store/auth.context';
import { UIProvider } from '../store/ui.context';

function loginSession(user) {
  sessionStorage.setItem('tc_session', JSON.stringify(user));
}

function renderSidebar() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <UIProvider>
          <Sidebar collapsed={false} onToggleCollapse={() => {}} mobileOpen={false} onMobileClose={() => {}} />
        </UIProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

afterEach(() => {
  sessionStorage.clear();
});

describe('Sidebar — Communication/Inventory permission-mapped visibility', () => {
  it('shows both new items when the user holds the students and materials permissions', () => {
    loginSession({ id: 'u1', name: 'Test User', role: 'admin', active: true, permissions: ['students', 'materials'] });
    renderSidebar();
    expect(screen.getByText('مركز التواصل')).toBeInTheDocument();
    expect(screen.getByText('مخزون المواد')).toBeInTheDocument();
  });

  it('hides both new items when the user lacks the students and materials permissions', () => {
    loginSession({ id: 'u2', name: 'Test User', role: 'limited', active: true, permissions: ['dashboard'] });
    renderSidebar();
    expect(screen.queryByText('مركز التواصل')).not.toBeInTheDocument();
    expect(screen.queryByText('مخزون المواد')).not.toBeInTheDocument();
  });

  it('maps communication to the students permission and inventory to materials independently', () => {
    loginSession({ id: 'u3', name: 'Test User', role: 'partial', active: true, permissions: ['materials'] });
    renderSidebar();
    expect(screen.queryByText('مركز التواصل')).not.toBeInTheDocument();
    expect(screen.getByText('مخزون المواد')).toBeInTheDocument();
  });
});

// Phase 4c — Support Access nav item is adminOnly: true (constants/nav.js), gated on
// isAdmin directly (Sidebar.jsx's canSeeItem), NOT on canAccess/the delegable permissions
// array — same reason server.js guards /api/support-access with requireRole('admin')
// instead of requirePermission. A permissions array containing 'support-access' must NOT
// be sufficient on its own; only isAdmin decides.
describe('Sidebar — Support Access nav item is admin-gated, not permission-array-gated', () => {
  it('shows the item for role: admin even with an unrelated permissions array', () => {
    loginSession({ id: 'a1', name: 'Admin', role: 'admin', active: true, permissions: ['dashboard'] });
    renderSidebar();
    expect(screen.getByText('وصول الدعم الفني')).toBeInTheDocument();
  });

  it('hides the item for a non-admin role even if "support-access" is explicitly in the permissions array', () => {
    loginSession({ id: 'u4', name: 'Teacher', role: 'teacher', active: true, permissions: ['dashboard', 'support-access'] });
    renderSidebar();
    expect(screen.queryByText('وصول الدعم الفني')).not.toBeInTheDocument();
  });
});
