// src/modules/settings/SettingsPage.dbSwitch.test.jsx
// Phase 2C-3C Part 4 — the admin-only database switch/rollback UI in SettingsPage.jsx.
// Real AuthProvider/ToastProvider/UIProvider (same convention as GroupsPage.test.jsx),
// services/api mocked (no real network), store/dbIdentity's checkDatabaseIdentityAndInvalidate
// spied (so window.location.reload can be asserted precisely without needing a real identity
// change to actually occur).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SettingsPage from './SettingsPage';
import { AuthProvider } from '../../store/auth.context';
import { UIProvider } from '../../store/ui.context';
import { ToastProvider } from '../../components/Toast';
import { useAppStore } from '../../store/app.store';
import * as dbIdentityStore from '../../store/dbIdentity';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return {
    ...actual,
    pgCheckHealth: vi.fn(async () => ({ ok: true, tableCount: 10, connection: { database: 'studix', host: '127.0.0.1', port: 5432, user: 'studix_app' } })),
    pgTriggerDatabaseSwitch: vi.fn(),
    pgGetDatabaseIdentity: vi.fn(async () => ({ ok: false, identity: null })),
  };
});
import { pgTriggerDatabaseSwitch, pgGetDatabaseIdentity } from '../../services/api';

const SESSION_KEY = 'tc_session';
const ADMIN = { id: 'admin-1', name: 'Admin', role: 'admin', isAdmin: true, active: true, permissions: ['settings'] };
const NON_ADMIN = { id: 'user-1', name: 'Teacher', role: 'user', isAdmin: false, active: true, permissions: ['settings'] };

function renderAsAdmin() {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(ADMIN));
  return render(
    <AuthProvider>
      <UIProvider canAccess={() => true}>
        <ToastProvider>
          <SettingsPage/>
        </ToastProvider>
      </UIProvider>
    </AuthProvider>
  );
}

function renderAsNonAdmin() {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(NON_ADMIN));
  return render(
    <AuthProvider>
      <UIProvider canAccess={() => true}>
        <ToastProvider>
          <SettingsPage/>
        </ToastProvider>
      </UIProvider>
    </AuthProvider>
  );
}

let reloadSpy;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  useAppStore.setState({ centerProfile: {} });
  pgGetDatabaseIdentity.mockResolvedValue({ ok: false, identity: null });
  vi.spyOn(dbIdentityStore, 'checkDatabaseIdentityAndInvalidate').mockReturnValue({ changed: false, reason: 'unchanged' });
  reloadSpy = vi.fn();
  Object.defineProperty(window, 'location', { value: { ...window.location, reload: reloadSpy }, writable: true, configurable: true });
});
afterEach(() => vi.restoreAllMocks());

describe('SettingsPage — database switch/rollback UI (point D — authorization)', () => {
  it('a non-admin user never sees the switch/rollback section at all', async () => {
    renderAsNonAdmin();
    await screen.findByText('الإعدادات');
    expect(screen.queryByText('تبديل قاعدة البيانات')).not.toBeInTheDocument();
    expect(screen.queryByText('التراجع عن التبديل')).not.toBeInTheDocument();
  });

  it('an admin user sees the switch/rollback section', async () => {
    renderAsAdmin();
    expect(await screen.findByText('🔁 تبديل قاعدة البيانات')).toBeInTheDocument();
    expect(screen.getByText('↩ التراجع عن التبديل')).toBeInTheDocument();
  });
});

describe('SettingsPage — database switch/rollback UI (point B — request shape / confirmation)', () => {
  it('clicking "switch" opens a confirmation dialog distinguishing it from rollback, and does NOT call the API yet', async () => {
    renderAsAdmin();
    fireEvent.click(await screen.findByText('🔁 تبديل قاعدة البيانات'));

    expect(await screen.findByText('تبديل قاعدة البيانات', { selector: '.modal-title' })).toBeInTheDocument();
    expect(pgTriggerDatabaseSwitch).not.toHaveBeenCalled();
  });

  it('clicking "rollback" opens a distinct confirmation dialog', async () => {
    renderAsAdmin();
    fireEvent.click(await screen.findByText('↩ التراجع عن التبديل'));

    expect(await screen.findByText('التراجع عن التبديل', { selector: '.modal-title' })).toBeInTheDocument();
    expect(pgTriggerDatabaseSwitch).not.toHaveBeenCalled();
  });

  it('confirming "switch" sends exactly action:"switch"', async () => {
    pgTriggerDatabaseSwitch.mockResolvedValue({ ok: true, action: 'switch', status: 'active' });
    renderAsAdmin();
    fireEvent.click(await screen.findByText('🔁 تبديل قاعدة البيانات'));
    fireEvent.click(await screen.findByText('نعم، بدِّل'));

    await waitFor(() => expect(pgTriggerDatabaseSwitch).toHaveBeenCalledWith('switch'));
    expect(pgTriggerDatabaseSwitch).toHaveBeenCalledTimes(1);
  });

  it('confirming "rollback" sends exactly action:"rollback"', async () => {
    pgTriggerDatabaseSwitch.mockResolvedValue({ ok: true, action: 'rollback', status: 'rolled_back' });
    renderAsAdmin();
    fireEvent.click(await screen.findByText('↩ التراجع عن التبديل'));
    fireEvent.click(await screen.findByText('نعم، تراجع'));

    await waitFor(() => expect(pgTriggerDatabaseSwitch).toHaveBeenCalledWith('rollback'));
  });
});

describe('SettingsPage — database switch/rollback UI (point B — loading state / duplicate submission)', () => {
  it('the confirm button enters a loading/disabled state during the request, preventing a duplicate submission', async () => {
    let resolveSwitch;
    pgTriggerDatabaseSwitch.mockReturnValue(new Promise((resolve) => { resolveSwitch = resolve; }));

    renderAsAdmin();
    fireEvent.click(await screen.findByText('🔁 تبديل قاعدة البيانات'));
    const confirmBtn = await screen.findByText('نعم، بدِّل');
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(confirmBtn.closest('button')).toBeDisabled());
    // a second click while busy must not trigger a second call
    fireEvent.click(confirmBtn);
    expect(pgTriggerDatabaseSwitch).toHaveBeenCalledTimes(1);

    resolveSwitch({ ok: true, action: 'switch', status: 'active' });
    await waitFor(() => expect(screen.queryByText('نعم، بدِّل')).not.toBeInTheDocument());
  });
});

describe('SettingsPage — database switch/rollback UI (point B/C — success and every error status)', () => {
  it('success (200): shows a success toast, re-checks identity afterward', async () => {
    pgTriggerDatabaseSwitch.mockResolvedValue({ ok: true, action: 'switch', status: 'active' });
    pgGetDatabaseIdentity.mockResolvedValue({ ok: true, identity: { id: 'new-id', createdAt: 'now' } });

    renderAsAdmin();
    fireEvent.click(await screen.findByText('🔁 تبديل قاعدة البيانات'));
    fireEvent.click(await screen.findByText('نعم، بدِّل'));

    await waitFor(() => expect(screen.getByText('اكتمل تبديل قاعدة البيانات بنجاح')).toBeInTheDocument());
    await waitFor(() => expect(pgGetDatabaseIdentity).toHaveBeenCalled());
    await waitFor(() => expect(dbIdentityStore.checkDatabaseIdentityAndInvalidate).toHaveBeenCalledWith({ id: 'new-id', createdAt: 'now' }));
  });

  it.each([
    ['400', 'إجراء غير مدعوم.'],
    ['401', 'يجب تسجيل الدخول للوصول لهذا المسار.'],
    ['403', 'لا تملك صلاحية الوصول لهذا الإجراء.'],
    ['409', 'عملية استعادة/تبديل أخرى قيد التنفيذ بالفعل — يُرجى الانتظار حتى تنتهي.'],
    ['500', 'تعذّر بدء عملية قاعدة البيانات.'],
    ['504', 'تجاوزت عملية قاعدة البيانات المهلة المتاحة.'],
  ])('%s failure: shows exactly the server\'s own safe message, never raw internals', async (_status, serverMessage) => {
    pgTriggerDatabaseSwitch.mockRejectedValue(new Error(serverMessage));

    renderAsAdmin();
    fireEvent.click(await screen.findByText('🔁 تبديل قاعدة البيانات'));
    fireEvent.click(await screen.findByText('نعم، بدِّل'));

    await waitFor(() => expect(screen.getByText(serverMessage)).toBeInTheDocument());
  });

  it('never renders a raw connection-string/credential-shaped error message', async () => {
    pgTriggerDatabaseSwitch.mockRejectedValue(new Error('تعذّر بدء عملية قاعدة البيانات.'));

    renderAsAdmin();
    fireEvent.click(await screen.findByText('🔁 تبديل قاعدة البيانات'));
    fireEvent.click(await screen.findByText('نعم، بدِّل'));

    await waitFor(() => expect(pgTriggerDatabaseSwitch).toHaveBeenCalled());
    expect(document.body.textContent).not.toMatch(/postgres(?:ql)?:\/\//i);
    expect(document.body.textContent).not.toMatch(/DATABASE_URL/);
  });
});

describe('SettingsPage — post-switch behavior (point C)', () => {
  it('a successful switch that DID change the identity triggers a full reload (the established, safe reload pattern already used for handleClearAll)', async () => {
    pgTriggerDatabaseSwitch.mockResolvedValue({ ok: true, action: 'switch', status: 'active' });
    pgGetDatabaseIdentity.mockResolvedValue({ ok: true, identity: { id: 'new-id', createdAt: 'now' } });
    dbIdentityStore.checkDatabaseIdentityAndInvalidate.mockReturnValue({ changed: true, reason: 'identity_mismatch' });

    renderAsAdmin();
    fireEvent.click(await screen.findByText('🔁 تبديل قاعدة البيانات'));
    fireEvent.click(await screen.findByText('نعم، بدِّل'));

    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
  });

  it('a successful switch where the identity check reports NO change does NOT reload — no unnecessary disruption', async () => {
    pgTriggerDatabaseSwitch.mockResolvedValue({ ok: true, action: 'switch', status: 'active' });
    pgGetDatabaseIdentity.mockResolvedValue({ ok: true, identity: { id: 'same-id', createdAt: 'now' } });
    dbIdentityStore.checkDatabaseIdentityAndInvalidate.mockReturnValue({ changed: false, reason: 'unchanged' });

    renderAsAdmin();
    fireEvent.click(await screen.findByText('🔁 تبديل قاعدة البيانات'));
    fireEvent.click(await screen.findByText('نعم، بدِّل'));

    await waitFor(() => expect(screen.getByText('اكتمل تبديل قاعدة البيانات بنجاح')).toBeInTheDocument());
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('a FAILED switch attempt still re-checks identity — the POST response failing does not necessarily mean the operation didn\'t succeed on the server (Part 2\'s own documented process-restart caveat)', async () => {
    pgTriggerDatabaseSwitch.mockRejectedValue(new Error('انقطع الاتصال بالخادم.'));
    pgGetDatabaseIdentity.mockResolvedValue({ ok: true, identity: { id: 'new-id', createdAt: 'now' } });
    dbIdentityStore.checkDatabaseIdentityAndInvalidate.mockReturnValue({ changed: true, reason: 'identity_mismatch' });

    renderAsAdmin();
    fireEvent.click(await screen.findByText('🔁 تبديل قاعدة البيانات'));
    fireEvent.click(await screen.findByText('نعم، بدِّل'));

    await waitFor(() => expect(pgGetDatabaseIdentity).toHaveBeenCalled());
    // the identity genuinely changed despite the POST "failing" from the browser's point of
    // view — the reload still correctly happens, and the (safe) error is still shown too.
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
    expect(screen.getByText('انقطع الاتصال بالخادم.')).toBeInTheDocument();
  });
});
