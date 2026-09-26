// backend/src/routes/licenseMachineBinding.integration.test.js
// Machine-binding — the required "Machine A / Machine B" real-enforcement-pipeline proof.
// Real scratch database (setupScratchDb/teardownScratchDb, unmodified) — studix الحقيقية لا
// تُلمَس بأي خطوة هنا. The current-machine value is swapped via vi.mock at the exact
// platform boundary this codebase already uses DI for (see machineIdentity.js/
// windowsService.js) — NEVER by writing a machineId into Postgres (there is no such column;
// the only source of truth for "what machine is this" is the live provider call itself, and
// the only source of truth for "what machine a license belongs to" is inside the signed
// artifact — see license.js/machineIdentity.js headers).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

// vi.mock factories may not close over an ordinary outer `let` (Vitest's hoisting forbids
// it) — vi.hoisted() is the supported escape hatch for exactly this "mutable value the mock
// reads live" shape.
const { getMockMachineId, setMockMachineId } = vi.hoisted(() => {
  let current = 'machine-A-fingerprint';
  return {
    getMockMachineId: () => current,
    setMockMachineId: (value) => { current = value; },
  };
});

vi.mock('../lib/machineIdentity.js', () => ({
  computeCurrentMachineId: () => getMockMachineId(),
}));

function makeOwnerKeyPair() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('Machine binding — real enforcement pipeline (real scratch database)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let owner;
  let PRODUCT_ID, buildLicenseArtifactPayload;
  let getLicenseStatus, verifyAndActivateLicense;
  let requireActivation;

  function signPayload(privateKeyPem, payloadB64) {
    return crypto.sign(null, Buffer.from(payloadB64, 'utf8'), crypto.createPrivateKey(privateKeyPem)).toString('base64url');
  }

  function buildSignedArtifact({ installationId, machineId, overrides = {} }) {
    const now = Date.now();
    const payloadB64 = buildLicenseArtifactPayload({
      licenseId: overrides.licenseId || `lic_${crypto.randomUUID()}`,
      product: overrides.product ?? PRODUCT_ID,
      installationId: overrides.installationId ?? installationId,
      machineId: overrides.machineId ?? machineId,
      issuedAt: overrides.issuedAt ?? now,
      expiresAt: overrides.expiresAt !== undefined ? overrides.expiresAt : now + 365 * 24 * 60 * 60 * 1000,
      features: overrides.features ?? null,
    });
    return `${payloadB64}.${signPayload(owner.privateKey, payloadB64)}`;
  }

  function mockReqRes({ path }) {
    const req = { user: null, path };
    const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    const next = vi.fn();
    return { req, res, next };
  }

  beforeAll(async () => {
    scratch = await setupScratchDb('license_machinebinding');
    owner = makeOwnerKeyPair();
    ({ PRODUCT_ID, buildLicenseArtifactPayload } = await import('../lib/licenseArtifactFormat.js'));
    ({ getLicenseStatus, verifyAndActivateLicense } = await import('../lib/license.js'));
    ({ requireActivation } = await import('../middleware/activation.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  beforeEach(async () => {
    setMockMachineId('machine-A-fingerprint');
    await scratch.client.$executeRawUnsafe('DELETE FROM license_config');
    await scratch.client.$executeRawUnsafe('DELETE FROM support_access_config');
  });

  async function seedInstallation() {
    return scratch.client.support_access_config.create({ data: { id: 1 } });
  }

  async function seedLicenseConfig() {
    return scratch.client.license_config.create({ data: { id: 1, licensing_public_key: owner.publicKey } });
  }

  it('Machine A: a license signed and bound to the current machine fingerprint activates normally', async () => {
    const installation = await seedInstallation();
    await seedLicenseConfig();
    setMockMachineId('machine-A-fingerprint');
    const artifact = buildSignedArtifact({ installationId: installation.installation_id, machineId: 'machine-A-fingerprint' });

    const activateResult = await verifyAndActivateLicense({ artifact });
    expect(activateResult.ok).toBe(true);

    const status = await getLicenseStatus();
    expect(status.activated).toBe(true);
  });

  it('Machine B: the exact same stored artifact + installationId is rejected (wrong_machine) once the CURRENT machine fingerprint differs — no database write involved', async () => {
    const installation = await seedInstallation();
    await seedLicenseConfig();
    setMockMachineId('machine-A-fingerprint');
    const artifact = buildSignedArtifact({ installationId: installation.installation_id, machineId: 'machine-A-fingerprint' });
    await verifyAndActivateLicense({ artifact });
    expect((await getLicenseStatus()).activated).toBe(true);

    // Simulate the exact same license_config row (same stored artifact, unmodified — e.g. a
    // copied/restored pgdata directory) being read on a DIFFERENT physical machine, purely
    // by swapping what the injected machine-identity provider reports. Nothing in Postgres
    // is touched between these two calls.
    setMockMachineId('machine-B-fingerprint');
    const status = await getLicenseStatus();
    expect(status.activated).toBe(false);
    expect(status.reason).toBe('wrong_machine');
  });

  it('requireActivation genuinely 402-blocks a real business route once the machine fingerprint no longer matches, and un-blocks it again when it matches again', async () => {
    const installation = await seedInstallation();
    await seedLicenseConfig();
    setMockMachineId('machine-A-fingerprint');
    const artifact = buildSignedArtifact({ installationId: installation.installation_id, machineId: 'machine-A-fingerprint' });
    await verifyAndActivateLicense({ artifact });

    const onA = mockReqRes({ path: '/api/students' });
    await requireActivation(onA.req, onA.res, onA.next);
    expect(onA.next).toHaveBeenCalledOnce();
    expect(onA.res.statusCode).toBeNull();

    setMockMachineId('machine-B-fingerprint');
    const onB = mockReqRes({ path: '/api/students' });
    await requireActivation(onB.req, onB.res, onB.next);
    expect(onB.next).not.toHaveBeenCalled();
    expect(onB.res.statusCode).toBe(402);
    expect(onB.res.body.licenseRequired).toBe(true);

    // proves this is a live, per-request check (not a one-time flag) — moving the same
    // database back to the original machine restores access without any reactivation.
    setMockMachineId('machine-A-fingerprint');
    const backOnA = mockReqRes({ path: '/api/students' });
    await requireActivation(backOnA.req, backOnA.res, backOnA.next);
    expect(backOnA.next).toHaveBeenCalledOnce();
    expect(backOnA.res.statusCode).toBeNull();
  });

  it('an artifact issued for a different machine is rejected at activation time too (wrong_machine), not only at status-check time', async () => {
    const installation = await seedInstallation();
    await seedLicenseConfig();
    setMockMachineId('machine-A-fingerprint');
    const artifact = buildSignedArtifact({ installationId: installation.installation_id, machineId: 'machine-SOMEONE-ELSES' });

    const result = await verifyAndActivateLicense({ artifact });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('wrong_machine');

    const row = await scratch.client.license_config.findUnique({ where: { id: 1 } });
    expect(row.license_artifact).toBeNull(); // no partial activation on rejection
  });
});
