// backend/src/lib/licenseBackupRestore.integration.test.js
// Phase 5e Area 3 — backup/restore behavior. Real scratch database only (setupScratchDb/
// teardownScratchDb, unmodified) — studix الحقيقية لا تُلمَس بأي خطوة هنا.
//
// A Postgres backup/restore (pg_dump/pg_restore, or a full data-directory copy) replaces a
// database's row contents in place — from the application's point of view, a freshly
// restored database is byte-for-byte indistinguishable from the original at the moment the
// backup was taken. This file simulates that by wiping and reinserting row data via raw SQL
// against the SAME live scratch database connection (license.js's module-level prisma
// singleton is captured once per test file — see licenseHardening.integration.test.js's own
// note on this — so a genuinely separate second live database cannot be swapped in
// mid-file; wiping+reinserting achieves an equivalent, faithful simulation of what
// pg_restore actually does to a running database).
//
// Sequenced deliberately: the "fresh empty database requires activation" case runs FIRST,
// before any row has ever been seeded, then the "restore recognizes a previously-activated
// license" case runs second, using the same connection.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

function makeKeyPair() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('Licensing backup/restore behavior — Phase 5e Area 3 (real scratch database)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let owner;
  let PRODUCT_ID, buildLicenseArtifactPayload;
  let getLicenseStatus, verifyAndActivateLicense;

  function signPayload(privateKeyPem, payloadB64) {
    return crypto.sign(null, Buffer.from(payloadB64, 'utf8'), crypto.createPrivateKey(privateKeyPem)).toString('base64url');
  }

  function buildSignedArtifact({ installationId }) {
    const now = Date.now();
    const payloadB64 = buildLicenseArtifactPayload({
      licenseId: `lic_${crypto.randomUUID()}`, product: PRODUCT_ID, installationId,
      issuedAt: now, expiresAt: now + 365 * 24 * 60 * 60 * 1000, features: null,
    });
    return `${payloadB64}.${signPayload(owner.privateKey, payloadB64)}`;
  }

  beforeAll(async () => {
    scratch = await setupScratchDb('license_backuprestore');
    owner = makeKeyPair();
    ({ PRODUCT_ID, buildLicenseArtifactPayload } = await import('../lib/licenseArtifactFormat.js'));
    ({ getLicenseStatus, verifyAndActivateLicense } = await import('./license.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  it('a fresh, never-configured database requires activation (not_configured)', async () => {
    const status = await getLicenseStatus();
    expect(status.activated).toBe(false);
    expect(status.reason).toBe('not_configured');
  });

  it('restore recognizes a previously-activated license: identical row data reinserted after a wipe is accepted exactly as before', async () => {
    // the previous test's getLicenseStatus() call lazily created an empty license_config
    // row (ensureLicenseConfig) — clear both singleton tables before seeding this test's own.
    await scratch.client.$executeRawUnsafe('DELETE FROM license_config');
    await scratch.client.$executeRawUnsafe('DELETE FROM support_access_config');
    const installation = await scratch.client.support_access_config.create({ data: { id: 1 } });
    await scratch.client.license_config.create({ data: { id: 1, licensing_public_key: owner.publicKey } });
    const artifact = buildSignedArtifact({ installationId: installation.installation_id });
    await verifyAndActivateLicense({ artifact });

    const beforeWipe = await getLicenseStatus();
    expect(beforeWipe.activated).toBe(true);
    const licenseIdBeforeWipe = beforeWipe.licenseId;

    // capture exactly what a real pg_dump would have captured
    const backedUpLicenseRow = await scratch.client.license_config.findUnique({ where: { id: 1 } });
    const backedUpSupportRow = await scratch.client.support_access_config.findUnique({ where: { id: 1 } });

    // simulate the database being wiped and then restored from that backup (pg_restore
    // replaces row contents; it does not invent a new installation_id or regenerate keys)
    await scratch.client.$executeRawUnsafe('DELETE FROM license_config');
    await scratch.client.$executeRawUnsafe('DELETE FROM support_access_config');
    expect((await getLicenseStatus()).reason).toBe('not_configured'); // confirms the wipe genuinely took effect
    // getLicenseStatus() above lazily recreated an empty license_config row (ensureLicenseConfig) — clear it again before restoring the real backed-up row
    await scratch.client.$executeRawUnsafe('DELETE FROM license_config');

    await scratch.client.support_access_config.create({
      data: { id: 1, installation_id: backedUpSupportRow.installation_id },
    });
    await scratch.client.license_config.create({
      data: {
        id: 1,
        licensing_public_key: backedUpLicenseRow.licensing_public_key,
        license_artifact: backedUpLicenseRow.license_artifact,
        license_id: backedUpLicenseRow.license_id,
        product: backedUpLicenseRow.product,
        expires_at: backedUpLicenseRow.expires_at,
        activated_at: backedUpLicenseRow.activated_at,
      },
    });

    const afterRestore = await getLicenseStatus();
    expect(afterRestore.activated).toBe(true);
    expect(afterRestore.licenseId).toBe(licenseIdBeforeWipe);

    // no duplicated installation_id, no hardware fingerprint mechanism: the restored
    // installation_id is the exact same value as before the restore — support_access_config
    // remains the single source of truth (Phase 4a), and this module still stores nothing
    // else that could identify a specific machine.
    const restoredSupportRow = await scratch.client.support_access_config.findUnique({ where: { id: 1 } });
    expect(restoredSupportRow.installation_id).toBe(backedUpSupportRow.installation_id);
    const supportRowCount = await scratch.client.support_access_config.count();
    expect(supportRowCount).toBe(1); // singleton — a restore never produces a second row
  });
});
