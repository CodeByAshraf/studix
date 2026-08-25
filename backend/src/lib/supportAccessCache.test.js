// backend/src/lib/supportAccessCache.test.js
// Phase 4b — pure unit tests, no DB, no network. Mirrors migrationRunner.test.js's style
// (plain function calls, no mocking framework needed for a pure in-memory module).
import { describe, it, expect, beforeEach } from 'vitest';
import {
  isNonceConsumed, markNonceConsumed, isNonceRevoked, revokeNonce,
  registerSupportSession, isSupportSessionActive, revokeSupportSession,
  getActiveSupportSession, revokeActiveSupportSession, clearAll,
} from './supportAccessCache.js';

describe('supportAccessCache — in-memory challenge/session registry', () => {
  beforeEach(() => clearAll());

  describe('nonce consumption (anti-replay)', () => {
    it('a fresh nonce is neither consumed nor revoked', () => {
      expect(isNonceConsumed('n1')).toBe(false);
      expect(isNonceRevoked('n1')).toBe(false);
    });

    it('markNonceConsumed makes isNonceConsumed true, permanently for this process', () => {
      markNonceConsumed('n1');
      expect(isNonceConsumed('n1')).toBe(true);
      expect(isNonceConsumed('n2')).toBe(false);
    });

    it('revokeNonce makes isNonceRevoked true, independent of consumption', () => {
      revokeNonce('n1');
      expect(isNonceRevoked('n1')).toBe(true);
      expect(isNonceConsumed('n1')).toBe(false);
    });
  });

  describe('support session registry', () => {
    function register(id, overrides = {}) {
      const now = Date.now();
      registerSupportSession(id, { installationId: 'inst-1', issuedAt: now, expiresAt: now + 60_000, ...overrides });
    }

    it('an unregistered session id is never active', () => {
      expect(isSupportSessionActive('missing')).toBe(false);
    });

    it('a freshly registered, unexpired, unrevoked session is active', () => {
      register('s1');
      expect(isSupportSessionActive('s1')).toBe(true);
    });

    it('an expired session is not active, even though it was never revoked', () => {
      register('s1', { expiresAt: Date.now() - 1 });
      expect(isSupportSessionActive('s1')).toBe(false);
    });

    it('revokeSupportSession makes an active session inactive immediately', () => {
      register('s1');
      expect(isSupportSessionActive('s1')).toBe(true);
      const result = revokeSupportSession('s1');
      expect(result).toBe(true);
      expect(isSupportSessionActive('s1')).toBe(false);
    });

    it('revokeSupportSession on an unknown id returns false, does not throw', () => {
      expect(revokeSupportSession('nope')).toBe(false);
    });

    it('getActiveSupportSession returns null when nothing is active', () => {
      expect(getActiveSupportSession()).toBeNull();
    });

    it('getActiveSupportSession returns the most recently issued active session', () => {
      register('s1', { issuedAt: 1000, expiresAt: Date.now() + 60_000 });
      register('s2', { issuedAt: 2000, expiresAt: Date.now() + 60_000 });
      const active = getActiveSupportSession();
      expect(active.id).toBe('s2');
    });

    it('getActiveSupportSession skips expired and revoked sessions', () => {
      register('expired', { issuedAt: 3000, expiresAt: Date.now() - 1 });
      register('revoked', { issuedAt: 2000, expiresAt: Date.now() + 60_000 });
      revokeSupportSession('revoked');
      register('valid', { issuedAt: 1000, expiresAt: Date.now() + 60_000 });
      expect(getActiveSupportSession().id).toBe('valid');
    });

    it('revokeActiveSupportSession revokes the current active session and returns true', () => {
      register('s1');
      expect(revokeActiveSupportSession()).toBe(true);
      expect(isSupportSessionActive('s1')).toBe(false);
    });

    it('revokeActiveSupportSession returns false when nothing is active', () => {
      expect(revokeActiveSupportSession()).toBe(false);
    });
  });

  describe('clearAll — test isolation helper', () => {
    it('wipes nonces and sessions completely', () => {
      markNonceConsumed('n1');
      revokeNonce('n2');
      registerSupportSession('s1', { installationId: 'i', issuedAt: Date.now(), expiresAt: Date.now() + 1000 });
      clearAll();
      expect(isNonceConsumed('n1')).toBe(false);
      expect(isNonceRevoked('n2')).toBe(false);
      expect(isSupportSessionActive('s1')).toBe(false);
      expect(getActiveSupportSession()).toBeNull();
    });
  });
});
