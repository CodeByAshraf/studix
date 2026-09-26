// tools/license-manager-gui/core/licenseCore.compat.test.js
// Compatibility proof for the Phase 2 standalone core: every artifact produced through
// tools/license-manager-gui/core/licenseCore.js — imported from its own standalone location,
// exactly as the future GUI will import it — must be accepted by the REAL, unmodified Studix
// customer-side verification logic. verifyLicenseArtifact/buildActivationRequestCode below are
// imported directly from backend/src/lib/licenseArtifactFormat.js (not through the new core
// module), so this test proves genuine compatibility against the actual verifier, not just
// internal self-consistency.
//
// Mirrors the key compatibility assertions already proven for the existing CLI issuer in
// tools/license-issuer.test.js — same protocol, same test shape, different entrypoint. Uses
// only freshly generated, in-memory, ephemeral Ed25519 test keypairs — never touches
// tools/lib/licenseKeyStorage.js or any real key file (Phase 2 explicitly generates/embeds no
// keys).
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { PRODUCT_ID, parseCustomerRequestCode, issueLicense } from './licenseCore.js';
import {
  verifyLicenseArtifact, buildActivationRequestCode,
} from '../../../backend/src/lib/licenseArtifactFormat.js';

function makeOwnerKeyPair() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('standalone core — minimal export surface (Phase 2 scope)', () => {
  it('exports exactly the issuing primitives a future GUI needs — no key storage, no I/O, no GUI code', async () => {
    const mod = await import('./licenseCore.js');
    expect(Object.keys(mod).sort()).toEqual(['PRODUCT_ID', 'issueLicense', 'parseCustomerRequestCode']);
  });

  it('re-exports the exact same PRODUCT_ID the real verifier uses', () => {
    expect(PRODUCT_ID).toBe('studix');
  });
});

describe('standalone core — parseCustomerRequestCode', () => {
  it('decodes a real Activation Request Code built by the existing (unmodified) format module', () => {
    const code = buildActivationRequestCode({ installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1' });
    const parsed = parseCustomerRequestCode(code);
    expect(parsed).toEqual({ v: 2, installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1' });
  });

  it('rejects a malformed/garbage code with a clear error, not a crash', () => {
    expect(() => parseCustomerRequestCode('not a real code')).toThrow(/not a valid/i);
  });
});

describe('standalone core — issueLicense produces artifacts the REAL Studix verifier accepts', () => {
  it('a valid license issued via the standalone core verifies successfully against the real, independently-imported verifyLicenseArtifact', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    const result = issueLicense({ installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1' }, privateKey);

    const check = verifyLicenseArtifact({
      artifact: result.artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: 'machine-1',
    });
    expect(check.ok).toBe(true);
    expect(check.payload.licenseId).toBe(result.licenseId);
    expect(check.payload.v).toBe(2);
  });

  it('tampering with a standalone-core-issued artifact is rejected by the real verifier', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    const result = issueLicense({ installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1' }, privateKey);
    const tampered = result.artifact.slice(0, -2) + (result.artifact.slice(-2) === 'AA' ? 'BB' : 'AA');

    const check = verifyLicenseArtifact({
      artifact: tampered, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: 'machine-1',
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('invalid_signature');
  });

  it('a standalone-core-issued artifact is rejected on the wrong machine', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    const result = issueLicense({ installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-A' }, privateKey);

    const check = verifyLicenseArtifact({
      artifact: result.artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: 'machine-B',
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('wrong_machine');
  });

  it('a standalone-core-issued artifact is rejected for the wrong installation', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    const result = issueLicense({ installationId: 'inst-A', product: PRODUCT_ID, machineId: 'machine-1' }, privateKey);

    const check = verifyLicenseArtifact({
      artifact: result.artifact, installationId: 'inst-B', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: 'machine-1',
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('wrong_installation');
  });

  it('an expiring standalone-core-issued artifact is rejected once expired', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    const result = issueLicense({
      installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1', expiresAt: Date.now() + 1000,
    }, privateKey);

    const check = verifyLicenseArtifact({
      artifact: result.artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: 'machine-1',
      now: Date.now() + 2000,
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('expired');
  });

  it('a perpetual standalone-core-issued artifact verifies indefinitely', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    const result = issueLicense({
      installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1', expiresAt: null,
    }, privateKey);

    const farFuture = Date.now() + 50 * 365 * 24 * 60 * 60 * 1000;
    const check = verifyLicenseArtifact({
      artifact: result.artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: 'machine-1', now: farFuture,
    });
    expect(check.ok).toBe(true);
  });

  it('features and notes issued via the standalone core round-trip through the real verifier', () => {
    const { publicKey, privateKey } = makeOwnerKeyPair();
    const result = issueLicense({
      installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1', features: ['reports', 'multi-branch'], notes: 'Al-Noor Tutoring Center',
    }, privateKey);

    const check = verifyLicenseArtifact({
      artifact: result.artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: publicKey, currentMachineId: 'machine-1',
    });
    expect(check.ok).toBe(true);
    expect(check.payload.features).toEqual(['reports', 'multi-branch']);
    expect(check.payload.notes).toBe('Al-Noor Tutoring Center');
  });

  it('an artifact signed by a different keypair than the one the verifier trusts is rejected', () => {
    const owner = makeOwnerKeyPair();
    const impostor = makeOwnerKeyPair();
    const result = issueLicense({ installationId: 'inst-1', product: PRODUCT_ID, machineId: 'machine-1' }, impostor.privateKey);

    const check = verifyLicenseArtifact({
      artifact: result.artifact, installationId: 'inst-1', product: PRODUCT_ID, publicKeyPem: owner.publicKey, currentMachineId: 'machine-1',
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('invalid_signature');
  });
});
