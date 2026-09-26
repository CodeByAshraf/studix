// src/hooks/useDB.identity.test.jsx
// Phase 2C-3C Part 4 — the database-identity check useDB() now runs BEFORE
// loadFromPostgres(). pgGetDatabaseIdentity/checkDatabaseIdentityAndInvalidate/
// loadFromPostgres are all mocked — no real network, no real localStorage cache mutation
// beyond what these mocks report.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDB } from './useDB';

const pgGetDatabaseIdentityMock = vi.fn();
const checkDatabaseIdentityAndInvalidateMock = vi.fn();
const loadFromPostgresMock = vi.fn();

vi.mock('../services/api', () => ({
  pgGetDatabaseIdentity: (...args) => pgGetDatabaseIdentityMock(...args),
}));
vi.mock('../store/dbIdentity', () => ({
  checkDatabaseIdentityAndInvalidate: (...args) => checkDatabaseIdentityAndInvalidateMock(...args),
}));
vi.mock('../store/db.middleware', () => ({
  loadFromPostgres: (...args) => loadFromPostgresMock(...args),
}));

beforeEach(() => {
  pgGetDatabaseIdentityMock.mockReset();
  checkDatabaseIdentityAndInvalidateMock.mockReset();
  loadFromPostgresMock.mockReset();
  loadFromPostgresMock.mockResolvedValue({ ok: true, applied: [], empty: [], failed: [] });
});
afterEach(() => vi.clearAllMocks());

describe('useDB — database identity check runs before loadFromPostgres (point A)', () => {
  it('an authenticated (admin) identity result is passed through to checkDatabaseIdentityAndInvalidate', async () => {
    const identity = { id: 'db-1', createdAt: '2026-01-01T00:00:00.000Z' };
    pgGetDatabaseIdentityMock.mockResolvedValue({ ok: true, identity });

    renderHook(() => useDB());

    await waitFor(() => expect(checkDatabaseIdentityAndInvalidateMock).toHaveBeenCalledWith(identity));
    await waitFor(() => expect(loadFromPostgresMock).toHaveBeenCalledTimes(1));
  });

  it('the identity check runs BEFORE loadFromPostgres is called', async () => {
    const callOrder = [];
    pgGetDatabaseIdentityMock.mockImplementation(async () => {
      callOrder.push('identity');
      return { ok: true, identity: { id: 'x', createdAt: 'now' } };
    });
    loadFromPostgresMock.mockImplementation(async () => {
      callOrder.push('load');
      return { ok: true, applied: [], empty: [], failed: [] };
    });

    renderHook(() => useDB());

    await waitFor(() => expect(callOrder).toEqual(['identity', 'load']));
  });

  it('a null identity (fresh install) is handled safely — still passed through, never crashes, load still proceeds', async () => {
    pgGetDatabaseIdentityMock.mockResolvedValue({ ok: true, identity: null });

    renderHook(() => useDB());

    await waitFor(() => expect(checkDatabaseIdentityAndInvalidateMock).toHaveBeenCalledWith(null));
    await waitFor(() => expect(loadFromPostgresMock).toHaveBeenCalledTimes(1));
  });

  it('a non-admin/unauthenticated result ({ok:false}) is a safe no-op — invalidate is never called, boot proceeds normally', async () => {
    pgGetDatabaseIdentityMock.mockResolvedValue({ ok: false, identity: null });

    const { result } = renderHook(() => useDB());

    await waitFor(() => expect(loadFromPostgresMock).toHaveBeenCalledTimes(1));
    expect(checkDatabaseIdentityAndInvalidateMock).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current).toBe('connected'));
  });

  it('a failed identity request (network error) does not corrupt/block the rest of boot — loadFromPostgres still runs, status still resolves', async () => {
    pgGetDatabaseIdentityMock.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useDB());

    await waitFor(() => expect(loadFromPostgresMock).toHaveBeenCalledTimes(1));
    expect(checkDatabaseIdentityAndInvalidateMock).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current).toBe('connected'));
  });

  it('a single mount performs exactly ONE identity check and ONE load — no duplicate bootstrap calls', async () => {
    pgGetDatabaseIdentityMock.mockResolvedValue({ ok: true, identity: { id: 'x', createdAt: 'now' } });

    renderHook(() => useDB());

    await waitFor(() => expect(loadFromPostgresMock).toHaveBeenCalledTimes(1));
    expect(pgGetDatabaseIdentityMock).toHaveBeenCalledTimes(1);
    expect(checkDatabaseIdentityAndInvalidateMock).toHaveBeenCalledTimes(1);
  });

  it('remounting (e.g. a later full page load) performs the check again — no stale singleton state carried across mounts', async () => {
    pgGetDatabaseIdentityMock.mockResolvedValue({ ok: true, identity: { id: 'x', createdAt: 'now' } });

    const { unmount } = renderHook(() => useDB());
    await waitFor(() => expect(pgGetDatabaseIdentityMock).toHaveBeenCalledTimes(1));
    unmount();

    renderHook(() => useDB());
    await waitFor(() => expect(pgGetDatabaseIdentityMock).toHaveBeenCalledTimes(2));
  });
});
