// src/store/auth.dbIdentityBoot.test.jsx
// Phase 2C-3C Part 4 — login() now also fires the database-identity check
// (pgGetDatabaseIdentity → checkDatabaseIdentityAndInvalidate), the same best-effort,
// non-blocking style already established for resetAppStore()/loadFromPostgres() right next
// to it. Mirrors auth.sessionReset.test.jsx's exact harness (real login()/logout() against a
// mocked services/api, real useAppStore) — not a re-implementation of that file's own
// coverage, a focused addition for this new call.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AuthProvider, useAuth } from './auth.context';
import { useAppStore } from './app.store';
import * as dbIdentityStore from './dbIdentity';

const USERS = {
  'admin-a': { id: 'admin-a', name: 'Admin A', role: 'admin', active: true, permissions: ['dashboard'] },
};

let pgGetDatabaseIdentityMock;

vi.mock('../services/api', async () => {
  const actual = await vi.importActual('../services/api');
  return {
    ...actual,
    pgLogin: vi.fn(async (id, password) => {
      const user = USERS[id];
      if (!user || password !== 'correct-pw') return { ok: false, status: 401 };
      return { ok: true, user };
    }),
    pgLogout: vi.fn(async () => {}),
    pgCheckHealth: vi.fn(async () => ({ ok: true, tableCount: 0, connection: 'ok' })),
    pgGetCollection: vi.fn(async () => []),
    get pgGetDatabaseIdentity() { return pgGetDatabaseIdentityMock; },
  };
});

function Harness() {
  const { login, currentUser } = useAuth();
  return (
    <div>
      <div data-testid="current-user">{currentUser?.id || 'none'}</div>
      <button onClick={() => login('admin-a', 'correct-pw')}>login-admin</button>
    </div>
  );
}

function renderHarness() {
  return render(<AuthProvider><Harness/></AuthProvider>);
}

beforeEach(() => {
  sessionStorage.clear();
  useAppStore.setState({ students: [], groups: [], payments: [], treasuryTxn: [], attendance: [], admissions: [] });
  pgGetDatabaseIdentityMock = vi.fn(async () => ({ ok: false, identity: null }));
  vi.spyOn(dbIdentityStore, 'checkDatabaseIdentityAndInvalidate');
  vi.clearAllMocks();
});

describe('login() — database identity check (point A, login boot path)', () => {
  it('a successful login triggers pgGetDatabaseIdentity, and a valid identity is passed to checkDatabaseIdentityAndInvalidate', async () => {
    const identity = { id: 'db-1', createdAt: '2026-01-01T00:00:00.000Z' };
    pgGetDatabaseIdentityMock.mockResolvedValue({ ok: true, identity });

    renderHarness();
    fireEvent.click(screen.getByText('login-admin'));

    await waitFor(() => expect(screen.getByTestId('current-user')).toHaveTextContent('admin-a'));
    await waitFor(() => expect(pgGetDatabaseIdentityMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(dbIdentityStore.checkDatabaseIdentityAndInvalidate).toHaveBeenCalledWith(identity));
  });

  it('a null identity result is a safe no-op — checkDatabaseIdentityAndInvalidate is still called (it handles null internally), login is never blocked', async () => {
    pgGetDatabaseIdentityMock.mockResolvedValue({ ok: true, identity: null });

    renderHarness();
    fireEvent.click(screen.getByText('login-admin'));

    await waitFor(() => expect(screen.getByTestId('current-user')).toHaveTextContent('admin-a'));
    await waitFor(() => expect(dbIdentityStore.checkDatabaseIdentityAndInvalidate).toHaveBeenCalledWith(null));
  });

  it('a non-admin/failed identity fetch ({ok:false}) never calls checkDatabaseIdentityAndInvalidate, and login still succeeds normally', async () => {
    pgGetDatabaseIdentityMock.mockResolvedValue({ ok: false, identity: null });

    renderHarness();
    fireEvent.click(screen.getByText('login-admin'));

    await waitFor(() => expect(screen.getByTestId('current-user')).toHaveTextContent('admin-a'));
    expect(dbIdentityStore.checkDatabaseIdentityAndInvalidate).not.toHaveBeenCalled();
  });

  it('a rejected identity-check promise (network error) never blocks or breaks login', async () => {
    pgGetDatabaseIdentityMock.mockRejectedValue(new Error('network down'));

    renderHarness();
    fireEvent.click(screen.getByText('login-admin'));

    await waitFor(() => expect(screen.getByTestId('current-user')).toHaveTextContent('admin-a'));
    // login itself completed successfully despite the identity check rejecting — proven by
    // reaching the assertion above without an unhandled rejection failing the test.
  });

  it('login remains synchronous/immediate for currentUser — the identity check never gates showing the authenticated UI (matches this file\'s own "لا حجب الدخول نفسه" philosophy)', async () => {
    // an identity check that never resolves (simulates a slow admin-only endpoint) — login
    // must still complete and currentUser must still update promptly.
    pgGetDatabaseIdentityMock.mockImplementation(() => new Promise(() => {}));

    renderHarness();
    fireEvent.click(screen.getByText('login-admin'));

    await waitFor(() => expect(screen.getByTestId('current-user')).toHaveTextContent('admin-a'));
  });
});
