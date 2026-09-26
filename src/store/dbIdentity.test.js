// src/store/dbIdentity.test.js
// Phase 2C-1 — unit tests for the frontend half of the database-identity cache-invalidation
// foundation. Exercises the localStorage-backed cache directly (same technique
// reportSettings.slice.test.js already uses) and injects a fake `reset` so these tests never
// depend on useAppStore's own full persisted state/slices.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DB_IDENTITY_STORAGE_KEY, getCachedDatabaseIdentity, setCachedDatabaseIdentity,
  checkDatabaseIdentityAndInvalidate,
} from './dbIdentity';

beforeEach(() => {
  localStorage.clear();
});

describe('getCachedDatabaseIdentity / setCachedDatabaseIdentity', () => {
  it('returns null when nothing has been cached yet', () => {
    expect(getCachedDatabaseIdentity()).toBeNull();
  });

  it('round-trips a stored identity through the real localStorage key', () => {
    const identity = { id: 'abc-123', role: 'active', createdAt: '2026-01-01T00:00:00.000Z' };
    setCachedDatabaseIdentity(identity);

    expect(getCachedDatabaseIdentity()).toEqual(identity);
    expect(JSON.parse(localStorage.getItem(DB_IDENTITY_STORAGE_KEY))).toEqual(identity);
  });
});

describe('checkDatabaseIdentityAndInvalidate — database identity changes / cache invalidation detection', () => {
  it('no remote identity provided -> no-op, nothing cached, reset never called', () => {
    const reset = vi.fn();
    const result = checkDatabaseIdentityAndInvalidate(null, { reset });

    expect(result).toEqual({ changed: false, reason: 'no_remote_identity' });
    expect(reset).not.toHaveBeenCalled();
    expect(getCachedDatabaseIdentity()).toBeNull();
  });

  it('a malformed remote identity (no id) is treated the same as no remote identity', () => {
    const reset = vi.fn();
    const result = checkDatabaseIdentityAndInvalidate({ role: 'active' }, { reset });

    expect(result.changed).toBe(false);
    expect(reset).not.toHaveBeenCalled();
  });

  it('first run ever (nothing cached) — remembers the remote identity, does NOT wipe anything', () => {
    const reset = vi.fn();
    const remote = { id: 'remote-1', role: 'active', createdAt: '2026-01-01T00:00:00.000Z' };

    const result = checkDatabaseIdentityAndInvalidate(remote, { reset });

    expect(result).toEqual({ changed: false, reason: 'first_run' });
    expect(reset).not.toHaveBeenCalled();
    expect(getCachedDatabaseIdentity()).toEqual(remote);
  });

  it('unchanged identity on a later check — no-op, reset never called', () => {
    const reset = vi.fn();
    const remote = { id: 'remote-1', role: 'active', createdAt: '2026-01-01T00:00:00.000Z' };
    setCachedDatabaseIdentity(remote);

    const result = checkDatabaseIdentityAndInvalidate({ ...remote }, { reset });

    expect(result).toEqual({ changed: false, reason: 'unchanged' });
    expect(reset).not.toHaveBeenCalled();
  });

  it('a genuinely different identity (e.g. after a future restore/switch) triggers reset and updates the cache', () => {
    const reset = vi.fn();
    const oldIdentity = { id: 'old-db', role: 'active', createdAt: '2026-01-01T00:00:00.000Z' };
    const newIdentity = { id: 'new-db', role: 'active', createdAt: '2026-02-01T00:00:00.000Z' };
    setCachedDatabaseIdentity(oldIdentity);

    const result = checkDatabaseIdentityAndInvalidate(newIdentity, { reset });

    expect(result).toEqual({ changed: true, reason: 'identity_mismatch' });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(getCachedDatabaseIdentity()).toEqual(newIdentity);
  });

  it('reset is called BEFORE the cache is updated to the new identity (order matters for a real reset that reads the old cache)', () => {
    const order = [];
    const reset = vi.fn(() => order.push('reset'));
    const setCached = vi.fn((identity) => { order.push('setCached'); setCachedDatabaseIdentity(identity); });
    setCachedDatabaseIdentity({ id: 'old-db', role: 'active', createdAt: '2026-01-01T00:00:00.000Z' });

    checkDatabaseIdentityAndInvalidate({ id: 'new-db', role: 'active', createdAt: '2026-02-01T00:00:00.000Z' }, {
      reset, setCached, getCached: getCachedDatabaseIdentity,
    });

    expect(order).toEqual(['reset', 'setCached']);
  });
});
