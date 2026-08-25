// backend/src/lib/licenseArtifactFormat.test.js
// Phase 5b — pure unit tests for the licensing wire format/verification logic only (no DB,
// no Prisma). ensureLicenseConfig/getLicenseStatus/verifyAndActivateLicense touch the
// database and are covered instead in routes/license.integration.test.js (real scratch
// Postgres), matching this project's established convention (see supportAccess.test.js's
// own header for the same split).
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  PRODUCT_ID, buildLicenseArtifactPayload, parseLicenseArtifact, verifyLicenseArtifact,
  buildActivationRequestCode, parseActivationRequestCode,
} from './licenseArtifactFormat.js';

function makeKeyPair() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function signPayload(privateKeyPem, payloadB64) {
  return crypto.sign(null, Buffer.from(payloadB64, 'utf8'), crypto.createPrivateKey(privateKeyPem)).toString('base64url');
}

function makeArtifact({ privateKeyPem, overrides = {} }) {
  const now = Date.now();
  const payloadB64 = buildLicenseArtifactPayload({
    licenseId: 'lic_1', product: PRODUCT_ID, installationId: 'inst-1',
    issuedAt: now, expiresAt: now + 365 * 24 * 60 * 60 * 1000, features: null,
    ...overrides,
  });
  const signatureB64 = signPayload(privateKeyPem, payloadB64);
  return `${payloadB64}.${signatureB64}`;
}

describe('buildLicenseArtifactPayload / parseLicenseArtifact — wire format', () => {
  it('round-trips all fields intact, unsigned', () => {
    const now = Date.now();
    const payloadB64 = buildLicenseArtifactPayload({
      licenseId: 'lic_1', product: 'studix', installationId: 'inst-1',
      issuedAt: now, expiresAt: now + 1000, features: ['reports'],
    });
    // parseLicenseArtifact expects "<payload>.<sig>" — build a throwaway signature-shaped
    // suffix just to exercise the parser's payload decoding in isolation.
    const parsed = parseLicenseArtifact(`${payloadB64}.sig`);
    expect(parsed.payload).toEqual({
      v: 1, licenseId: 'lic_1', product: 'studix', installationId: 'inst-1',
      issuedAt: now, expiresAt: now + 1000, features: ['reports'],
    });
  });

  it('defaults expiresAt/features to null when omitted (perpetual, featureless)', () => {
    const now = Date.now();
    const payloadB64 = buildLicenseArtifactPayload({ licenseId: 'lic_1', product: 'studix', installationId: 'inst-1', issuedAt: now });
    const parsed = parseLicenseArtifact(`${payloadB64}.sig`);
    expect(parsed.payload.expiresAt).toBeNull();
    expect(parsed.payload.features).toBeNull();
  });

  it('rejects a garbage/non-base64url string', () => {
    expect(parseLicenseArtifact('not a real artifact!!!')).toBeNull();
  });

  it('rejects an artifact with the wrong number of "." parts', () => {
    expect(parseLicenseArtifact('onlyonepart')).toBeNull();
    expect(parseLicenseArtifact('a.b.c')).toBeNull();
  });

  it('rejects a non-string / empty input', () => {
    expect(parseLicenseArtifact(undefined)).toBeNull();
    expect(parseLicenseArtifact(null)).toBeNull();
    expect(parseLicenseArtifact('')).toBeNull();
  });

  it('rejects an unsupported protocol version', () => {
    const bad = Buffer.from(JSON.stringify({
      v: 2, licenseId: 'l', product: 'studix', installationId: 'i', issuedAt: 1, expiresAt: null, features: null,
    }), 'utf8').toString('base64url');
    expect(parseLicenseArtifact(`${bad}.sig`)).toBeNull();
  });

  it('rejects a structurally incomplete payload (missing installationId)', () => {
    const bad = Buffer.from(JSON.stringify({ v: 1, licenseId: 'l', product: 'studix', issuedAt: 1 }), 'utf8').toString('base64url');
    expect(parseLicenseArtifact(`${bad}.sig`)).toBeNull();
  });

  it('feature parsing: rejects a non-array, non-null features value', () => {
    const bad = Buffer.from(JSON.stringify({
      v: 1, licenseId: 'l', product: 'studix', installationId: 'i', issuedAt: 1, expiresAt: null, features: 'not-an-array',
    }), 'utf8').toString('base64url');
    expect(parseLicenseArtifact(`${bad}.sig`)).toBeNull();
  });
});

describe('verifyLicenseArtifact — Ed25519 signature + binding + expiry (no DB)', () => {
  it('accepts a validly signed, correctly-bound, unexpired artifact', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const artifact = makeArtifact({ privateKeyPem: privateKey });

    const result = verifyLicenseArtifact({ artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey });
    expect(result.ok).toBe(true);
    expect(result.payload.licenseId).toBe('lic_1');
  });

  it('accepts a perpetual license (expiresAt: null), arbitrarily far in the future', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const artifact = makeArtifact({ privateKeyPem: privateKey, overrides: { expiresAt: null } });

    const farFuture = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000;
    const result = verifyLicenseArtifact({ artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, now: farFuture });
    expect(result.ok).toBe(true);
  });

  it('feature parsing: preserves a real feature array through full verification', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const artifact = makeArtifact({ privateKeyPem: privateKey, overrides: { features: ['reports', 'multi-branch'] } });

    const result = verifyLicenseArtifact({ artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey });
    expect(result.ok).toBe(true);
    expect(result.payload.features).toEqual(['reports', 'multi-branch']);
  });

  it('rejects a malformed artifact string, no exception thrown', () => {
    const { publicKey } = makeKeyPair();
    const result = verifyLicenseArtifact({ artifact: 'garbage', installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey });
    expect(result).toEqual({ ok: false, reason: 'malformed_artifact', payload: null });
  });

  it('rejects a license bound to a different installation', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const artifact = makeArtifact({ privateKeyPem: privateKey, overrides: { installationId: 'inst-OTHER' } });

    const result = verifyLicenseArtifact({ artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('wrong_installation');
  });

  it('rejects a license issued for a different product', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const artifact = makeArtifact({ privateKeyPem: privateKey, overrides: { product: 'some-other-app' } });

    const result = verifyLicenseArtifact({ artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('wrong_product');
  });

  it('rejects an expired license, even with a genuinely valid signature', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const past = Date.now() - 1000;
    const artifact = makeArtifact({ privateKeyPem: privateKey, overrides: { issuedAt: past - 1000, expiresAt: past } });

    const result = verifyLicenseArtifact({ artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('rejects a tampered payload — signature was produced over a different payload', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const original = makeArtifact({ privateKeyPem: privateKey });
    const [payloadB64, signatureB64] = original.split('.');
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

    // admin/attacker presents a different (but still well-formed) payload alongside the
    // same genuine signature — e.g. a different licenseId, everything else equal
    const tamperedPayloadB64 = buildLicenseArtifactPayload({ ...parsed, licenseId: 'lic_TAMPERED' });
    const tampered = `${tamperedPayloadB64}.${signatureB64}`;

    const result = verifyLicenseArtifact({ artifact: tampered, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_signature');
  });

  it('rejects a signature produced by the wrong (non-matching) keypair', () => {
    const owner = makeKeyPair();
    const impostor = makeKeyPair();
    const artifact = makeArtifact({ privateKeyPem: impostor.privateKey }); // signed by the WRONG private key

    const result = verifyLicenseArtifact({ artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: owner.publicKey });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_signature');
  });

  it('rejects a garbage public key without throwing', () => {
    const { privateKey } = makeKeyPair();
    const artifact = makeArtifact({ privateKeyPem: privateKey });
    const result = verifyLicenseArtifact({ artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: 'not a real PEM key' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('bad_public_key');
  });

  it('never throws even on a garbage base64url signature segment against a real key', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const artifact = makeArtifact({ privateKeyPem: privateKey });
    const [payloadB64] = artifact.split('.');
    const tampered = `${payloadB64}.!!!not-base64url!!!`;
    expect(() => verifyLicenseArtifact({ artifact: tampered, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey }))
      .not.toThrow();
  });

  it('activation consistency: the same valid artifact verifies identically across repeated calls (no hidden state)', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const artifact = makeArtifact({ privateKeyPem: privateKey });
    const first = verifyLicenseArtifact({ artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey });
    const second = verifyLicenseArtifact({ artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey });
    expect(first).toEqual(second);
  });
});

describe('buildActivationRequestCode / parseActivationRequestCode', () => {
  it('round-trips installationId/product', () => {
    const code = buildActivationRequestCode({ installationId: 'inst-1', product: PRODUCT_ID });
    const parsed = parseActivationRequestCode(code);
    expect(parsed).toEqual({ v: 1, installationId: 'inst-1', product: PRODUCT_ID });
  });

  it('rejects a malformed code', () => {
    expect(parseActivationRequestCode('garbage')).toBeNull();
  });

  it('rejects an empty/non-string code', () => {
    expect(parseActivationRequestCode('')).toBeNull();
    expect(parseActivationRequestCode(undefined)).toBeNull();
  });
});
