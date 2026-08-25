// backend/src/lib/supportAccess.test.js
// Phase 4b — pure unit tests for the crypto/challenge-shape logic only (no DB, no Prisma).
// ensureInstallationConfig/generateChallenge/verifySupportChallenge touch the database and
// are covered instead in routes/supportAccess.integration.test.js (real scratch Postgres),
// matching this project's established convention (DB-touching logic → *.integration.test.js
// only; see payments.integration.test.js's own header comment for the same split).
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { buildChallengeString, parseChallengeString, verifyChallengeSignature } from './supportAccess.js';

function makeKeyPair() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function sign(privateKeyPem, challenge) {
  return crypto.sign(null, Buffer.from(challenge, 'utf8'), crypto.createPrivateKey(privateKeyPem)).toString('base64url');
}

function makeChallenge(overrides = {}) {
  const now = Date.now();
  return buildChallengeString({
    installationId: 'inst-1', nonce: crypto.randomBytes(8).toString('base64url'),
    iat: now, exp: now + 15 * 60 * 1000, ...overrides,
  });
}

describe('supportAccess — challenge string shape', () => {
  it('builds and parses a challenge round-trip with all fields intact', () => {
    const nonce = 'abc123';
    const iat = 1000;
    const exp = 2000;
    const challenge = buildChallengeString({ installationId: 'inst-1', nonce, iat, exp });
    const parsed = parseChallengeString(challenge);
    expect(parsed).toEqual({ v: 1, installationId: 'inst-1', nonce, iat, exp });
  });

  it('parseChallengeString returns null for non-base64url / non-JSON garbage', () => {
    expect(parseChallengeString('not valid base64url json!!!')).toBeNull();
  });

  it('parseChallengeString returns null for a well-formed but structurally incomplete payload', () => {
    const bad = Buffer.from(JSON.stringify({ v: 1, installationId: 'inst-1' }), 'utf8').toString('base64url');
    expect(parseChallengeString(bad)).toBeNull();
  });

  it('parseChallengeString returns null for a non-string input', () => {
    expect(parseChallengeString(undefined)).toBeNull();
    expect(parseChallengeString(null)).toBeNull();
    expect(parseChallengeString(42)).toBeNull();
  });

  it('parseChallengeString returns null for an unsupported version', () => {
    const bad = Buffer.from(JSON.stringify({ v: 2, installationId: 'i', nonce: 'n', iat: 1, exp: 2 }), 'utf8').toString('base64url');
    expect(parseChallengeString(bad)).toBeNull();
  });
});

describe('supportAccess — verifyChallengeSignature (Ed25519, no DB)', () => {
  it('accepts a validly signed, unexpired, correctly-bound challenge', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const challenge = makeChallenge();
    const response = sign(privateKey, challenge);

    const result = verifyChallengeSignature({ challenge, response, installationId: 'inst-1', publicKeyPem: publicKey });
    expect(result.ok).toBe(true);
    expect(result.installationId).toBe('inst-1');
    expect(typeof result.nonce).toBe('string');
  });

  it('rejects a malformed challenge string', () => {
    const { publicKey } = makeKeyPair();
    const result = verifyChallengeSignature({ challenge: 'garbage', response: 'whatever', installationId: 'inst-1', publicKeyPem: publicKey });
    expect(result).toEqual({ ok: false, reason: 'malformed_challenge', nonce: null });
  });

  it('rejects when the challenge is bound to a different installation than expected', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const challenge = makeChallenge({ installationId: 'inst-OTHER' });
    const response = sign(privateKey, challenge);

    const result = verifyChallengeSignature({ challenge, response, installationId: 'inst-1', publicKeyPem: publicKey });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('wrong_installation');
  });

  it('rejects an expired challenge, even with a genuinely valid signature', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const challenge = makeChallenge({ iat: Date.now() - 20 * 60 * 1000, exp: Date.now() - 1 });
    const response = sign(privateKey, challenge);

    const result = verifyChallengeSignature({ challenge, response, installationId: 'inst-1', publicKeyPem: publicKey });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('rejects a tampered challenge — signature was produced over a different challenge string', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const original = makeChallenge();
    const response = sign(privateKey, original); // owner genuinely signed `original`

    // admin/attacker presents a *different* (but still well-formed, correctly parseable)
    // challenge alongside that same signature — e.g. a different nonce, everything else equal
    const parsed = parseChallengeString(original);
    const tampered = buildChallengeString({ ...parsed, nonce: parsed.nonce + '_TAMPERED' });

    const result = verifyChallengeSignature({ challenge: tampered, response, installationId: 'inst-1', publicKeyPem: publicKey });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_signature');
  });

  it('rejects a signature produced by the wrong (non-matching) keypair', () => {
    const owner = makeKeyPair();
    const impostor = makeKeyPair();
    const challenge = makeChallenge();
    const response = sign(impostor.privateKey, challenge); // signed with the WRONG private key

    const result = verifyChallengeSignature({ challenge, response, installationId: 'inst-1', publicKeyPem: owner.publicKey });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_signature');
  });

  it('rejects a missing/empty response', () => {
    const { publicKey } = makeKeyPair();
    const challenge = makeChallenge();
    expect(verifyChallengeSignature({ challenge, response: '', installationId: 'inst-1', publicKeyPem: publicKey }).reason)
      .toBe('malformed_response');
    expect(verifyChallengeSignature({ challenge, response: undefined, installationId: 'inst-1', publicKeyPem: publicKey }).reason)
      .toBe('malformed_response');
  });

  it('rejects a garbage public key without throwing', () => {
    const { privateKey } = makeKeyPair();
    const challenge = makeChallenge();
    const response = sign(privateKey, challenge);
    const result = verifyChallengeSignature({ challenge, response, installationId: 'inst-1', publicKeyPem: 'not a real PEM key' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('bad_public_key');
  });

  it('never throws even on a garbage base64url response against a real key', () => {
    const { publicKey } = makeKeyPair();
    const challenge = makeChallenge();
    expect(() => verifyChallengeSignature({ challenge, response: '!!!not-base64url!!!', installationId: 'inst-1', publicKeyPem: publicKey }))
      .not.toThrow();
  });
});
