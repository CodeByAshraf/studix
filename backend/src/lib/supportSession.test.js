// backend/src/lib/supportSession.test.js
// Phase 4b — pure unit tests, no DB. Sets its own SESSION_SECRET explicitly (self-contained,
// deterministic regardless of the developer's local backend/.env — mirrors no existing
// precedent in this codebase since session.js itself has no prior unit test file, so this
// establishes the pattern rather than following one).
import { describe, it, expect, beforeAll } from 'vitest';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'studix-test-session-secret-not-for-production';

let signSupportSession;
let verifySupportSessionToken;
let SUPPORT_SESSION_COOKIE_NAME;
let signSession; // from the normal session.js — used only for the cross-domain rejection proofs
let verifySession;

beforeAll(async () => {
  ({ signSupportSession, verifySupportSessionToken, SUPPORT_SESSION_COOKIE_NAME } = await import('./supportSession.js'));
  ({ signSession, verifySession } = await import('./session.js'));
});

describe('supportSession — signed support-session tokens (separate from normal login sessions)', () => {
  it('exports a cookie name distinct from the normal session cookie', () => {
    expect(SUPPORT_SESSION_COOKIE_NAME).toBe('studix_support_session');
    expect(SUPPORT_SESSION_COOKIE_NAME).not.toBe('studix_session');
  });

  it('signs and verifies a valid token round-trip', () => {
    const token = signSupportSession({ sessionId: 'sess-1', installationId: 'inst-1' });
    const payload = verifySupportSessionToken(token);
    expect(payload).toMatchObject({ purpose: 'support', sessionId: 'sess-1', installationId: 'inst-1' });
    expect(typeof payload.exp).toBe('number');
    expect(payload.exp).toBeGreaterThan(Date.now());
  });

  it('rejects a malformed token (no dot separator)', () => {
    expect(verifySupportSessionToken('not-a-real-token')).toBeNull();
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const token = signSupportSession({ sessionId: 'sess-1', installationId: 'inst-1' });
    const [payloadB64, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({
      purpose: 'support', sessionId: 'sess-EVIL', installationId: 'inst-1', exp: Date.now() + 60_000,
    }), 'utf8').toString('base64url');
    expect(verifySupportSessionToken(`${forged}.${sig}`)).toBeNull();
  });

  it('rejects a token once its embedded expiry has passed (real timing, not forged)', async () => {
    const originalNow = Date.now;
    try {
      // freeze "issue time" 31 minutes in the past relative to real now — SUPPORT_SESSION_TTL_MS is 30 min
      const past = originalNow() - 31 * 60 * 1000;
      Date.now = () => past;
      var token = signSupportSession({ sessionId: 'sess-old', installationId: 'inst-1' });
    } finally {
      Date.now = originalNow;
    }
    expect(verifySupportSessionToken(token)).toBeNull();
  });

  it('rejects a payload missing sessionId/installationId (wrong shape)', () => {
    // Can't construct this via signSupportSession (it requires both) — proves the function
    // itself refuses to sign an incomplete session identity in the first place.
    expect(() => signSupportSession({ sessionId: '', installationId: 'inst-1' })).toThrow();
    expect(() => signSupportSession({ sessionId: 'sess-1', installationId: '' })).toThrow();
  });

  it('cross-domain separation: a normal login session token is never accepted as a support session', () => {
    const normalToken = signSession({ id: 'u1', role: 'admin', userAuthVersion: 1, roleAuthVersion: 1 });
    expect(verifySupportSessionToken(normalToken)).toBeNull();
  });

  it('cross-domain separation: a support session token is never accepted as a normal login session', () => {
    const supportToken = signSupportSession({ sessionId: 'sess-1', installationId: 'inst-1' });
    expect(verifySession(supportToken)).toBeNull();
  });

  it('normal authentication (session.js) is unaffected by this module existing', () => {
    const token = signSession({ id: 'u1', role: 'teacher', userAuthVersion: 3, roleAuthVersion: 2 });
    const payload = verifySession(token);
    expect(payload).toEqual({ id: 'u1', role: 'teacher', userAuthVersion: 3, roleAuthVersion: 2 });
  });
});
