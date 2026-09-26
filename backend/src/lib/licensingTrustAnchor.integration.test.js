// backend/src/lib/licensingTrustAnchor.integration.test.js
// P1-3 — automatic licensing public key provisioning + runtime trust-anchor pin, against a real
// PostgreSQL scratch database.
//
// Two anchors are in play on purpose:
//   - provisionLicensingPublicKey() called with NO argument uses the REAL release anchor
//     embedded in licensingTrustAnchor.js (its default is resolved inside that module) — this
//     proves a fresh install gets exactly the shipped key, with no manual psql step;
//   - license.js reads the anchor through getExpectedLicensingPublicKeyPem(), mocked here to a
//     throwaway test keypair (we never have, and must never have, the real private key), so the
//     runtime tests can sign real artifacts.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED" test is
// recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const TEST_MACHINE_ID = 'test-machine-fixed';
vi.mock('./machineIdentity.js', () => ({ computeCurrentMachineId: () => TEST_MACHINE_ID }));
const trustAnchor = vi.hoisted(() => ({ pem: null }));
vi.mock('./licensingTrustAnchor.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getExpectedLicensingPublicKeyPem: () => trustAnchor.pem,
}));

const dbCheck = await checkPostgresReachable();

function makeKeyPair() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('licensing trust anchor — provisioning + runtime pin (real PostgreSQL, P1-3)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, owner, impostor;
  let provisionLicensingPublicKey, EXPECTED_LICENSING_PUBLIC_KEY_PEM, EXPECTED_LICENSING_PUBLIC_KEY_SHA256;
  let getLicenseStatus, verifyAndActivateLicense;
  let PRODUCT_ID, buildLicenseArtifactPayload;

  beforeAll(async () => {
    scratch = await setupScratchDb('licensing_trust_anchor');
    client = scratch.client;
    owner = makeKeyPair();
    impostor = makeKeyPair();
    trustAnchor.pem = owner.publicKey;
    ({ provisionLicensingPublicKey, EXPECTED_LICENSING_PUBLIC_KEY_PEM, EXPECTED_LICENSING_PUBLIC_KEY_SHA256 } = await import('./licensingTrustAnchor.js'));
    ({ getLicenseStatus, verifyAndActivateLicense } = await import('./license.js'));
    ({ PRODUCT_ID, buildLicenseArtifactPayload } = await import('./licenseArtifactFormat.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  beforeEach(async () => {
    await client.$executeRawUnsafe('DELETE FROM license_config');
    await client.$executeRawUnsafe('DELETE FROM support_access_config');
  });

  async function installationId() {
    const row = await client.support_access_config.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    return row.installation_id;
  }

  async function signedArtifact(privateKeyPem) {
    const payloadB64 = buildLicenseArtifactPayload({
      licenseId: `lic_${crypto.randomUUID()}`, product: PRODUCT_ID, installationId: await installationId(),
      machineId: TEST_MACHINE_ID, issuedAt: Date.now(), expiresAt: null, features: null,
    });
    const sig = crypto.sign(null, Buffer.from(payloadB64, 'utf8'), crypto.createPrivateKey(privateKeyPem)).toString('base64url');
    return `${payloadB64}.${sig}`;
  }

  const configRow = () => client.license_config.findUnique({ where: { id: 1 } });

  // ── Provisioning ────────────────────────────────────────────────────────────────────
  it('fresh install (no license_config row): creates the row holding the REAL release key — no manual step', async () => {
    const result = await provisionLicensingPublicKey(client);

    expect(result).toMatchObject({ action: 'created', fingerprint: EXPECTED_LICENSING_PUBLIC_KEY_SHA256 });
    expect((await configRow()).licensing_public_key).toBe(EXPECTED_LICENSING_PUBLIC_KEY_PEM);
    expect(await client.license_config.count()).toBe(1);
  });

  it('repeated initialization is idempotent: unchanged, still exactly one row, value preserved', async () => {
    await provisionLicensingPublicKey(client);
    const second = await provisionLicensingPublicKey(client);
    const third = await provisionLicensingPublicKey(client);

    expect(second.action).toBe('unchanged');
    expect(third.action).toBe('unchanged');
    expect(await client.license_config.count()).toBe(1);
    expect((await configRow()).licensing_public_key).toBe(EXPECTED_LICENSING_PUBLIC_KEY_PEM);
  });

  it('an existing row with a NULL key (lazily created by the runtime) is provisioned; other columns untouched', async () => {
    const mark = new Date('2026-05-01T10:00:00.000Z');
    await client.license_config.create({ data: { id: 1, clock_high_water_mark_at: mark } });

    const result = await provisionLicensingPublicKey(client);

    expect(result.action).toBe('provisioned');
    const row = await configRow();
    expect(row.licensing_public_key).toBe(EXPECTED_LICENSING_PUBLIC_KEY_PEM);
    expect(row.clock_high_water_mark_at.toISOString()).toBe(mark.toISOString());
  });

  it('an existing CORRECT key stored with different line endings is left unchanged (compared as a key, not as text)', async () => {
    const crlf = EXPECTED_LICENSING_PUBLIC_KEY_PEM.replace(/\n/g, '\r\n');
    await client.license_config.create({ data: { id: 1, licensing_public_key: crlf } });

    expect((await provisionLicensingPublicKey(client)).action).toBe('unchanged');
    expect((await configRow()).licensing_public_key).toBe(crlf);
  });

  it('a mismatched key is restored to the anchor and reported; license/activation state is not touched', async () => {
    const artifact = 'some.artifact';
    const activatedAt = new Date('2026-04-01T00:00:00.000Z');
    await client.license_config.create({
      data: { id: 1, licensing_public_key: impostor.publicKey, license_artifact: artifact, license_id: 'lic_x', product: PRODUCT_ID, activated_at: activatedAt },
    });

    const result = await provisionLicensingPublicKey(client);

    expect(result.action).toBe('corrected');
    expect(result.previousFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.previousFingerprint).not.toBe(EXPECTED_LICENSING_PUBLIC_KEY_SHA256);
    const row = await configRow();
    expect(row.licensing_public_key).toBe(EXPECTED_LICENSING_PUBLIC_KEY_PEM);
    expect(row).toMatchObject({ license_artifact: artifact, license_id: 'lic_x' });
    expect(row.activated_at.toISOString()).toBe(activatedAt.toISOString());
  });

  // ── Runtime pin (license.js) — anchor = the test owner key ─────────────────────────────
  it('an already-activated valid license stays activated after re-provisioning (anchor unchanged)', async () => {
    await provisionLicensingPublicKey(client, { expectedPublicKeyPem: owner.publicKey });
    const activation = await verifyAndActivateLicense({ artifact: await signedArtifact(owner.privateKey) });
    expect(activation.ok).toBe(true);

    expect((await provisionLicensingPublicKey(client, { expectedPublicKeyPem: owner.publicKey })).action).toBe('unchanged');
    const status = await getLicenseStatus();
    expect(status).toMatchObject({ activated: true, reason: null });
  });

  it('a database key replaced by an untrusted one fails closed: no activation, and a self-signed license never verifies', async () => {
    await client.license_config.create({ data: { id: 1, licensing_public_key: impostor.publicKey } });

    await expect(verifyAndActivateLicense({ artifact: await signedArtifact(impostor.privateKey) }))
      .rejects.toMatchObject({ status: 409 });
    expect((await configRow()).license_artifact).toBeNull();
    expect(await getLicenseStatus()).toMatchObject({ activated: false, reason: 'trust_anchor_mismatch' });
  });

  it('a stored self-signed license under a tampered key is reported as trust_anchor_mismatch, and re-provisioning restores trust (the forged license stays invalid)', async () => {
    await client.license_config.create({
      data: {
        id: 1, licensing_public_key: impostor.publicKey, license_artifact: await signedArtifact(impostor.privateKey),
        license_id: 'lic_forged', product: PRODUCT_ID, activated_at: new Date(),
      },
    });
    expect(await getLicenseStatus()).toMatchObject({ activated: false, reason: 'trust_anchor_mismatch' });

    expect((await provisionLicensingPublicKey(client, { expectedPublicKeyPem: owner.publicKey })).action).toBe('corrected');
    const status = await getLicenseStatus();
    expect(status.activated).toBe(false);
    expect(status.reason).not.toBe('trust_anchor_mismatch');
  });

  it('a NULL key still reports not_configured (unchanged behavior)', async () => {
    await client.license_config.create({ data: { id: 1 } });
    expect(await getLicenseStatus()).toMatchObject({ activated: false, reason: 'not_configured' });
  });
});
