// backend/src/routes/licenseIssuer.e2e.integration.test.js
// Phase 5d — true end-to-end proof: activation request code → offline issuer → activate →
// active license, using the REAL backend functions (requestActivationCode/
// verifyAndActivateLicense from lib/license.js, unmodified) against a real scratch database
// (setupScratchDb, unmodified) — studix الحقيقية لا تُلمَس بأي خطوة هنا. The "issuer" step
// imports tools/lib/licenseIssuing.js directly (relative path out of backend/ into tools/)
// — the exact same offline tool an owner would run, not a re-implementation of it.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { issueLicense } from '../../../tools/lib/licenseIssuing.js';

const dbCheck = await checkPostgresReachable();

function makeOwnerKeyPair() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('License Issuer — end-to-end (real scratch database)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let owner;
  let impostor;
  let requestActivationCode, verifyAndActivateLicense, getLicenseStatus, PRODUCT_ID;

  beforeAll(async () => {
    scratch = await setupScratchDb('licenseissuer_e2e');
    owner = makeOwnerKeyPair();
    impostor = makeOwnerKeyPair();
    ({ requestActivationCode, verifyAndActivateLicense, getLicenseStatus } = await import('../lib/license.js'));
    ({ PRODUCT_ID } = await import('../lib/licenseArtifactFormat.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  beforeEach(async () => {
    await scratch.client.$executeRawUnsafe('DELETE FROM license_config');
    await scratch.client.$executeRawUnsafe('DELETE FROM support_access_config');
  });

  async function seedInstallation() {
    return scratch.client.support_access_config.create({ data: { id: 1 } });
  }

  async function seedLicenseConfig(publicKeyPem = owner.publicKey) {
    return scratch.client.license_config.create({ data: { id: 1, licensing_public_key: publicKeyPem } });
  }

  it('request code → offline issuer → activate → active license, start to finish (perpetual)', async () => {
    // 1) the customer's app generates an activation request code (real backend function)
    await seedInstallation();
    await seedLicenseConfig();
    const requestInfo = await requestActivationCode();
    expect(requestInfo.product).toBe(PRODUCT_ID);

    // 2) the owner, offline, parses the code and issues a license with
    //    tools/lib/licenseIssuing.js — the exact same module the real
    //    tools/license-issuer.js CLI uses
    const issued = issueLicense({
      installationId: requestInfo.installationId, product: requestInfo.product,
    }, owner.privateKey);
    expect(issued.expiresAt).toBeNull();

    // 3) the customer pastes the artifact back — real backend verify/activate function
    const result = await verifyAndActivateLicense({ artifact: issued.artifact });
    expect(result.ok).toBe(true);
    expect(result.payload.licenseId).toBe(issued.licenseId);

    // 4) the installation is now genuinely, re-verifiably activated
    const status = await getLicenseStatus();
    expect(status.activated).toBe(true);
    expect(status.licenseId).toBe(issued.licenseId);
  });

  it('an expiring license issued offline activates and later re-verifies as expired', async () => {
    await seedInstallation();
    await seedLicenseConfig();
    const requestInfo = await requestActivationCode();

    const issued = issueLicense({
      installationId: requestInfo.installationId, product: requestInfo.product, expiresAt: Date.now() + 500,
    }, owner.privateKey);

    const result = await verifyAndActivateLicense({ artifact: issued.artifact });
    expect(result.ok).toBe(true);
    expect((await getLicenseStatus()).activated).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 700));
    const status = await getLicenseStatus();
    expect(status.activated).toBe(false);
    expect(status.reason).toBe('expired');
  });

  it('a license issued for a different (wrong) installation is rejected by the real verifier end-to-end', async () => {
    await seedInstallation();
    await seedLicenseConfig();

    const issued = issueLicense({
      installationId: 'some-other-installation-entirely', product: PRODUCT_ID,
    }, owner.privateKey);

    const result = await verifyAndActivateLicense({ artifact: issued.artifact });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('wrong_installation');
    expect((await getLicenseStatus()).activated).toBe(false);
  });

  it('a tampered artifact is rejected end-to-end', async () => {
    await seedInstallation();
    await seedLicenseConfig();
    const requestInfo = await requestActivationCode();
    const issued = issueLicense({ installationId: requestInfo.installationId, product: requestInfo.product }, owner.privateKey);
    const tampered = issued.artifact.slice(0, -2) + (issued.artifact.slice(-2) === 'AA' ? 'BB' : 'AA');

    const result = await verifyAndActivateLicense({ artifact: tampered });
    expect(result.ok).toBe(false);
  });

  it('a license signed by the wrong (non-owner) key is rejected end-to-end', async () => {
    await seedInstallation();
    await seedLicenseConfig(); // configured with owner.publicKey
    const requestInfo = await requestActivationCode();

    const issued = issueLicense({ installationId: requestInfo.installationId, product: requestInfo.product }, impostor.privateKey);

    const result = await verifyAndActivateLicense({ artifact: issued.artifact });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_signature');
  });
});
