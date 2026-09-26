// tools/license-manager-gui/main/licenseHandlers.test.js
// Phase 3 required coverage, exercised through the actual "GUI-facing core" entrypoint
// (licenseHandlers.js + sessionState.js) — the same functions ipcRegister.js's IPC handlers
// call. verifyLicenseArtifact/buildActivationRequestCode are imported directly from
// backend/src/lib/licenseArtifactFormat.js (the real, unmodified customer-side verifier), so
// these tests prove genuine end-to-end compatibility through the GUI wiring, not just
// self-consistency with Phase 2's core.
import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'crypto';
import {
  PRODUCT_ID, parseRequestCode, issueLicenseWithSessionKey,
} from './licenseHandlers.js';
import {
  setSessionKey, getSafeSessionInfo, clearSession, isUnlocked,
} from './sessionState.js';
import {
  verifyLicenseArtifact, buildActivationRequestCode,
} from '../../../backend/src/lib/licenseArtifactFormat.js';

function makeOwnerKeyPair() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

afterEach(() => {
  clearSession();
});

describe('request parsing through the GUI-facing core', () => {
  it('parses a real Activation Request Code', () => {
    const code = buildActivationRequestCode({ installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1' });
    expect(parseRequestCode(code)).toEqual({ v: 2, installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1' });
  });

  it('rejects a malformed request code with a clear error', () => {
    expect(() => parseRequestCode('garbage')).toThrow(/not a valid/i);
  });
});

describe('issueLicenseWithSessionKey — wrong-key / not-unlocked rejection', () => {
  it('refuses to issue when no key is unlocked for the session', () => {
    expect(isUnlocked()).toBe(false);
    expect(() => issueLicenseWithSessionKey({ installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1' }))
      .toThrow(/no signing key is unlocked/i);
  });
});

describe('issueLicenseWithSessionKey — successful generation, verified against the real Studix verifier', () => {
  it('a license issued through the session-key path is accepted by the real verifier', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    setSessionKey({ privateKeyPem: privateKey, publicKeyPem: publicKey, keyFingerprint: 'fp', source: 'external_import' });

    const result = issueLicenseWithSessionKey({ installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1' });
    const check = verifyLicenseArtifact({
      artifact: result.artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: 'machine-1',
    });
    expect(check.ok).toBe(true);
  });

  it('tampering with a session-key-issued artifact is rejected by the real verifier', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    setSessionKey({ privateKeyPem: privateKey, publicKeyPem: publicKey, keyFingerprint: 'fp', source: 'key_store' });

    const result = issueLicenseWithSessionKey({ installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1' });
    const tampered = result.artifact.slice(0, -2) + (result.artifact.slice(-2) === 'AA' ? 'BB' : 'AA');

    const check = verifyLicenseArtifact({
      artifact: tampered, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: 'machine-1',
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('invalid_signature');
  });

  it('an artifact issued by an unlocked key that does not match the customer-trusted public key is rejected', () => {
    const owner = makeOwnerKeyPair();
    const impostor = makeOwnerKeyPair();
    setSessionKey({ privateKeyPem: impostor.privateKey, publicKeyPem: impostor.publicKey, keyFingerprint: 'fp', source: 'key_store' });

    const result = issueLicenseWithSessionKey({ installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1' });
    const check = verifyLicenseArtifact({
      artifact: result.artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: owner.publicKey, currentMachineId: 'machine-1',
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('invalid_signature');
  });

  it('an expiring license issued through the session-key path is rejected once expired', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    setSessionKey({ privateKeyPem: privateKey, publicKeyPem: publicKey, keyFingerprint: 'fp', source: 'key_store' });

    const result = issueLicenseWithSessionKey({
      installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1', expiresAt: Date.now() + 1000,
    });
    const check = verifyLicenseArtifact({
      artifact: result.artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: 'machine-1', now: Date.now() + 2000,
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('expired');
  });

  it('a perpetual license issued through the session-key path verifies indefinitely', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    setSessionKey({ privateKeyPem: privateKey, publicKeyPem: publicKey, keyFingerprint: 'fp', source: 'key_store' });

    const result = issueLicenseWithSessionKey({ installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1', expiresAt: null });
    const farFuture = Date.now() + 50 * 365 * 24 * 60 * 60 * 1000;
    const check = verifyLicenseArtifact({
      artifact: result.artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: 'machine-1', now: farFuture,
    });
    expect(check.ok).toBe(true);
  });

  it('features and notes entered through the GUI-facing core round-trip through the real verifier', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    setSessionKey({ privateKeyPem: privateKey, publicKeyPem: publicKey, keyFingerprint: 'fp', source: 'key_store' });

    const result = issueLicenseWithSessionKey({
      installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1', features: ['reports', 'multi-branch'], notes: 'Al-Noor Tutoring Center',
    });
    const check = verifyLicenseArtifact({
      artifact: result.artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: 'machine-1',
    });
    expect(check.ok).toBe(true);
    expect(check.payload.features).toEqual(['reports', 'multi-branch']);
    expect(check.payload.notes).toBe('Al-Noor Tutoring Center');
  });
});

describe('private-key material never reaches renderer/UI-facing state', () => {
  it('getSafeSessionInfo never includes privateKeyPem, and its serialized form never contains the raw PEM text', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    setSessionKey({ privateKeyPem: privateKey, publicKeyPem: publicKey, keyFingerprint: 'fp-123', source: 'key_store' });

    const info = getSafeSessionInfo();
    expect(info).not.toHaveProperty('privateKeyPem');
    expect(Object.keys(info).sort()).toEqual(['keyFingerprint', 'publicKeyPem', 'source', 'unlocked'].sort());
    expect(JSON.stringify(info)).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(info)).not.toContain(privateKey);
  });

  it('issueLicenseWithSessionKey\'s own return value never includes privateKeyPem', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    setSessionKey({ privateKeyPem: privateKey, publicKeyPem: publicKey, keyFingerprint: 'fp', source: 'key_store' });

    const result = issueLicenseWithSessionKey({ installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1' });
    expect(result).not.toHaveProperty('privateKeyPem');
    expect(JSON.stringify(result)).not.toContain('PRIVATE KEY');
  });

  it('clearSession() actually locks the session — getSafeSessionInfo reports unlocked: false and issuing throws again', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    setSessionKey({ privateKeyPem: privateKey, publicKeyPem: publicKey, keyFingerprint: 'fp', source: 'key_store' });
    expect(isUnlocked()).toBe(true);

    clearSession();

    expect(isUnlocked()).toBe(false);
    expect(getSafeSessionInfo()).toEqual({ unlocked: false });
    expect(() => issueLicenseWithSessionKey({ installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1' })).toThrow();
  });
});
