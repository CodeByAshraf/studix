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

const TEST_MACHINE_ID = 'machine-1';

function makeArtifact({ privateKeyPem, overrides = {} }) {
  const now = Date.now();
  const payloadB64 = buildLicenseArtifactPayload({
    licenseId: 'lic_1', product: PRODUCT_ID, installationId: 'inst-1', machineId: TEST_MACHINE_ID,
    issuedAt: now, expiresAt: now + 365 * 24 * 60 * 60 * 1000, features: null,
    ...overrides,
  });
  const signatureB64 = signPayload(privateKeyPem, payloadB64);
  return `${payloadB64}.${signatureB64}`;
}

// buildV1LegacyArtifact: hand-builds the exact pre-machine-binding wire shape (no machineId
// field at all) — buildLicenseArtifactPayload itself always emits v:2 now, so a genuine v1
// artifact (needed to test the legacy-rejection path) can only be constructed by hand, same
// as the existing "rejects an unsupported protocol version" test already does for v:99.
function buildV1LegacyArtifact({ privateKeyPem, overrides = {} }) {
  const now = Date.now();
  const payloadObj = {
    v: 1, licenseId: 'lic_1', product: PRODUCT_ID, installationId: 'inst-1',
    issuedAt: now, expiresAt: now + 365 * 24 * 60 * 60 * 1000, features: null,
    ...overrides,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const signatureB64 = signPayload(privateKeyPem, payloadB64);
  return `${payloadB64}.${signatureB64}`;
}

describe('buildLicenseArtifactPayload / parseLicenseArtifact — wire format', () => {
  it('round-trips all fields intact, unsigned (v2, includes machineId)', () => {
    const now = Date.now();
    const payloadB64 = buildLicenseArtifactPayload({
      licenseId: 'lic_1', product: 'studix', installationId: 'inst-1', machineId: 'machine-1',
      issuedAt: now, expiresAt: now + 1000, features: ['reports'],
    });
    // parseLicenseArtifact expects "<payload>.<sig>" — build a throwaway signature-shaped
    // suffix just to exercise the parser's payload decoding in isolation.
    const parsed = parseLicenseArtifact(`${payloadB64}.sig`);
    expect(parsed.payload).toEqual({
      v: 2, licenseId: 'lic_1', product: 'studix', installationId: 'inst-1', machineId: 'machine-1',
      issuedAt: now, expiresAt: now + 1000, features: ['reports'],
    });
  });

  it('defaults expiresAt/features to null when omitted (perpetual, featureless)', () => {
    const now = Date.now();
    const payloadB64 = buildLicenseArtifactPayload({
      licenseId: 'lic_1', product: 'studix', installationId: 'inst-1', machineId: 'machine-1', issuedAt: now,
    });
    const parsed = parseLicenseArtifact(`${payloadB64}.sig`);
    expect(parsed.payload.expiresAt).toBeNull();
    expect(parsed.payload.features).toBeNull();
  });

  it('machine binding: rejects a v2 payload with a missing machineId', () => {
    const now = Date.now();
    const payloadB64 = buildLicenseArtifactPayload({ licenseId: 'lic_1', product: 'studix', installationId: 'inst-1', issuedAt: now });
    expect(parseLicenseArtifact(`${payloadB64}.sig`)).toBeNull();
  });

  it('machine binding: rejects a v2 payload with an empty-string machineId', () => {
    const bad = Buffer.from(JSON.stringify({
      v: 2, licenseId: 'l', product: 'studix', installationId: 'i', machineId: '', issuedAt: 1, expiresAt: null, features: null,
    }), 'utf8').toString('base64url');
    expect(parseLicenseArtifact(`${bad}.sig`)).toBeNull();
  });

  it('machine binding: a v1 (legacy, pre-binding) payload with no machineId at all still parses structurally (rejection happens in verifyLicenseArtifact, not here)', () => {
    const now = Date.now();
    const payloadObj = {
      v: 1, licenseId: 'lic_1', product: 'studix', installationId: 'inst-1',
      issuedAt: now, expiresAt: null, features: null,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
    const parsed = parseLicenseArtifact(`${payloadB64}.sig`);
    expect(parsed).not.toBeNull();
    expect(parsed.payload.v).toBe(1);
    expect('machineId' in parsed.payload).toBe(false);
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
      v: 99, licenseId: 'l', product: 'studix', installationId: 'i', machineId: 'm', issuedAt: 1, expiresAt: null, features: null,
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

  it('Phase 5d: notes is entirely omitted from the payload when not provided (exact backward compatibility)', () => {
    const now = Date.now();
    const payloadB64 = buildLicenseArtifactPayload({
      licenseId: 'lic_1', product: 'studix', installationId: 'inst-1', machineId: 'machine-1', issuedAt: now,
    });
    const parsed = parseLicenseArtifact(`${payloadB64}.sig`);
    expect('notes' in parsed.payload).toBe(false);
  });

  it('Phase 5d: notes round-trips when provided', () => {
    const now = Date.now();
    const payloadB64 = buildLicenseArtifactPayload({
      licenseId: 'lic_1', product: 'studix', installationId: 'inst-1', machineId: 'machine-1', issuedAt: now, notes: 'مركز النور للدروس الخصوصية',
    });
    const parsed = parseLicenseArtifact(`${payloadB64}.sig`);
    expect(parsed.payload.notes).toBe('مركز النور للدروس الخصوصية');
  });

  it('Phase 5d: rejects a non-string, non-null/undefined notes value', () => {
    const bad = Buffer.from(JSON.stringify({
      v: 1, licenseId: 'l', product: 'studix', installationId: 'i', issuedAt: 1, expiresAt: null, features: null, notes: 12345,
    }), 'utf8').toString('base64url');
    expect(parseLicenseArtifact(`${bad}.sig`)).toBeNull();
  });

  it('Phase 5d: an explicit notes:null is accepted (tolerant, even though the builder never emits it)', () => {
    const bad = Buffer.from(JSON.stringify({
      v: 1, licenseId: 'l', product: 'studix', installationId: 'i', issuedAt: 1, expiresAt: null, features: null, notes: null,
    }), 'utf8').toString('base64url');
    expect(parseLicenseArtifact(`${bad}.sig`)).not.toBeNull();
  });
});

describe('verifyLicenseArtifact — Ed25519 signature + binding + expiry (no DB)', () => {
  it('accepts a validly signed, correctly-bound, unexpired artifact', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const artifact = makeArtifact({ privateKeyPem: privateKey });

    const result = verifyLicenseArtifact({ artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: TEST_MACHINE_ID });
    expect(result.ok).toBe(true);
    expect(result.payload.licenseId).toBe('lic_1');
  });

  it('accepts a perpetual license (expiresAt: null), arbitrarily far in the future', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const artifact = makeArtifact({ privateKeyPem: privateKey, overrides: { expiresAt: null } });

    const farFuture = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000;
    const result = verifyLicenseArtifact({
      artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: TEST_MACHINE_ID, now: farFuture,
    });
    expect(result.ok).toBe(true);
  });

  it('feature parsing: preserves a real feature array through full verification', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const artifact = makeArtifact({ privateKeyPem: privateKey, overrides: { features: ['reports', 'multi-branch'] } });

    const result = verifyLicenseArtifact({ artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: TEST_MACHINE_ID });
    expect(result.ok).toBe(true);
    expect(result.payload.features).toEqual(['reports', 'multi-branch']);
  });

  it('rejects a malformed artifact string, no exception thrown', () => {
    const { publicKey } = makeKeyPair();
    const result = verifyLicenseArtifact({ artifact: 'garbage', installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: TEST_MACHINE_ID });
    expect(result).toEqual({ ok: false, reason: 'malformed_artifact', payload: null });
  });

  it('rejects a license bound to a different installation', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const artifact = makeArtifact({ privateKeyPem: privateKey, overrides: { installationId: 'inst-OTHER' } });

    const result = verifyLicenseArtifact({ artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: TEST_MACHINE_ID });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('wrong_installation');
  });

  it('rejects a license issued for a different product', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const artifact = makeArtifact({ privateKeyPem: privateKey, overrides: { product: 'some-other-app' } });

    const result = verifyLicenseArtifact({ artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: TEST_MACHINE_ID });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('wrong_product');
  });

  it('rejects an expired license, even with a genuinely valid signature', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const past = Date.now() - 1000;
    const artifact = makeArtifact({ privateKeyPem: privateKey, overrides: { issuedAt: past - 1000, expiresAt: past } });

    const result = verifyLicenseArtifact({ artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: TEST_MACHINE_ID });
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

    const result = verifyLicenseArtifact({ artifact: tampered, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: TEST_MACHINE_ID });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_signature');
  });

  it('rejects a signature produced by the wrong (non-matching) keypair', () => {
    const owner = makeKeyPair();
    const impostor = makeKeyPair();
    const artifact = makeArtifact({ privateKeyPem: impostor.privateKey }); // signed by the WRONG private key

    const result = verifyLicenseArtifact({
      artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: owner.publicKey, currentMachineId: TEST_MACHINE_ID,
    });
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
    const first = verifyLicenseArtifact({ artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: TEST_MACHINE_ID });
    const second = verifyLicenseArtifact({ artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: TEST_MACHINE_ID });
    expect(first).toEqual(second);
  });
});

describe('verifyLicenseArtifact — machine binding', () => {
  it('accepts a v2 artifact whose signed machineId matches the current machine fingerprint', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const artifact = makeArtifact({ privateKeyPem: privateKey, overrides: { machineId: 'machine-A' } });
    const result = verifyLicenseArtifact({
      artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: 'machine-A',
    });
    expect(result.ok).toBe(true);
  });

  it('cloning scenario: the exact same byte-for-byte artifact rejects with wrong_machine when presented on a different current machine', () => {
    const { publicKey, privateKey } = makeKeyPair();
    // artifact genuinely, validly signed and bound to machine-A — untampered — just
    // replayed (e.g. via a copied database) where the CURRENT machine fingerprint differs.
    const artifact = makeArtifact({ privateKeyPem: privateKey, overrides: { machineId: 'machine-A' } });
    const result = verifyLicenseArtifact({
      artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: 'machine-B',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('wrong_machine');
  });

  it('a payload with the machineId field tampered (re-encoded, original signature kept) fails signature verification, not wrong_machine', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const original = makeArtifact({ privateKeyPem: privateKey, overrides: { machineId: 'machine-A' } });
    const [payloadB64, signatureB64] = original.split('.');
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

    // attacker swaps in a different machineId (e.g. their own machine's fingerprint) while
    // keeping the original, now-mismatched signature — this must be caught as tampering
    // (invalid_signature), never silently accepted or misreported as a plain wrong_machine.
    const tamperedPayloadB64 = buildLicenseArtifactPayload({ ...parsed, machineId: 'machine-ATTACKER' });
    const tampered = `${tamperedPayloadB64}.${signatureB64}`;

    const result = verifyLicenseArtifact({
      artifact: tampered, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: 'machine-ATTACKER',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_signature');
  });

  it('rejects a legacy v1 (pre-machine-binding) artifact with reason unbound_license, even though genuinely, validly signed', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const artifact = buildV1LegacyArtifact({ privateKeyPem: privateKey });
    const result = verifyLicenseArtifact({
      artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: 'machine-A',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unbound_license');
  });

  it('a v1 artifact is rejected as unbound_license regardless of what the current machine fingerprint is', () => {
    const { publicKey, privateKey } = makeKeyPair();
    const artifact = buildV1LegacyArtifact({ privateKeyPem: privateKey });
    const result = verifyLicenseArtifact({
      artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: 'literally-anything',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unbound_license');
  });
});

describe('buildActivationRequestCode / parseActivationRequestCode', () => {
  it('round-trips installationId/product/machineId', () => {
    const code = buildActivationRequestCode({ installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1' });
    const parsed = parseActivationRequestCode(code);
    expect(parsed).toEqual({ v: 2, installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1' });
  });

  it('rejects a request code missing machineId', () => {
    const bad = Buffer.from(JSON.stringify({ v: 2, installationId: 'inst-1', product: PRODUCT_ID }), 'utf8').toString('base64url');
    expect(parseActivationRequestCode(bad)).toBeNull();
  });

  it('rejects a legacy v1 request code (predates machine binding) — forces regeneration from the current app', () => {
    const bad = Buffer.from(JSON.stringify({ v: 1, installationId: 'inst-1', product: PRODUCT_ID }), 'utf8').toString('base64url');
    expect(parseActivationRequestCode(bad)).toBeNull();
  });

  it('rejects a malformed code', () => {
    expect(parseActivationRequestCode('garbage')).toBeNull();
  });

  it('rejects an empty/non-string code', () => {
    expect(parseActivationRequestCode('')).toBeNull();
    expect(parseActivationRequestCode(undefined)).toBeNull();
  });
});
