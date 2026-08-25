// backend/src/middleware/activation.test.js
// Phase 5b — pure unit tests for isActivationExempt's path-matching logic only (no DB).
// requireActivation's full DB-backed behavior (actually blocking/passing based on real
// license state) is covered in routes/license.integration.test.js (real scratch Postgres).
import { describe, it, expect } from 'vitest';
import { isActivationExempt } from './activation.js';

describe('isActivationExempt — allowlist path matching', () => {
  it('exempts any non-/api/ path entirely (static assets, SPA routes, root)', () => {
    expect(isActivationExempt('/')).toBe(true);
    expect(isActivationExempt('/students')).toBe(true);
    expect(isActivationExempt('/assets/index-abc123.js')).toBe(true);
    expect(isActivationExempt('/index.html')).toBe(true);
  });

  it('exempts /health (not under /api/ at all)', () => {
    expect(isActivationExempt('/health')).toBe(true);
  });

  it('exempts /api/session and its sub-paths', () => {
    expect(isActivationExempt('/api/session')).toBe(true);
    expect(isActivationExempt('/api/session/')).toBe(true);
  });

  it('exempts /api/license and its sub-paths', () => {
    expect(isActivationExempt('/api/license')).toBe(true);
    expect(isActivationExempt('/api/license/status')).toBe(true);
    expect(isActivationExempt('/api/license/activate')).toBe(true);
    expect(isActivationExempt('/api/license/request-code')).toBe(true);
  });

  it('exempts /api/support-access and its sub-paths', () => {
    expect(isActivationExempt('/api/support-access')).toBe(true);
    expect(isActivationExempt('/api/support-access/challenge')).toBe(true);
    expect(isActivationExempt('/api/support-access/verify')).toBe(true);
    expect(isActivationExempt('/api/support-access/status')).toBe(true);
    expect(isActivationExempt('/api/support-access/revoke')).toBe(true);
  });

  it('does NOT exempt ordinary business API routes', () => {
    expect(isActivationExempt('/api/students')).toBe(false);
    expect(isActivationExempt('/api/users')).toBe(false);
    expect(isActivationExempt('/api/payments')).toBe(false);
    expect(isActivationExempt('/api/roles')).toBe(false);
    expect(isActivationExempt('/api/activityLogs')).toBe(false);
  });

  it('does not accidentally exempt a route that merely starts with an allowlisted prefix as a substring (no false positive on e.g. /api/sessionx)', () => {
    expect(isActivationExempt('/api/sessionx')).toBe(false);
    expect(isActivationExempt('/api/licensexyz')).toBe(false);
    expect(isActivationExempt('/api/support-accessorama')).toBe(false);
  });
});
