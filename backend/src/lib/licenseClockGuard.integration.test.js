// backend/src/lib/licenseClockGuard.integration.test.js
// Phase 5e — clock-rollback mitigation (checkClockAndUpdateHighWaterMark), tested against a
// real scratch database (setupScratchDb, unmodified) — studix الحقيقية لا تُلمَس بأي خطوة
// هنا. This is a DETERRENT, not a cryptographic guarantee — see license.js's own header
// comment for the full, honest limitation statement; these tests prove the deterrent works
// as designed, not that it is unbreakable.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

function makeOwnerKeyPair() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('Licensing clock-rollback mitigation — Phase 5e (real scratch database)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let owner;
  let checkClockAndUpdateHighWaterMark, getLicenseStatus, verifyAndActivateLicense, CLOCK_ROLLBACK_TOLERANCE_MS;
  let buildLicenseArtifactPayload;

  function signPayload(privateKeyPem, payloadB64) {
    return crypto.sign(null, Buffer.from(payloadB64, 'utf8'), crypto.createPrivateKey(privateKeyPem)).toString('base64url');
  }

  function buildSignedArtifact({ installationId, overrides = {} }) {
    const now = Date.now();
    const payloadB64 = buildLicenseArtifactPayload({
      licenseId: overrides.licenseId || `lic_${crypto.randomUUID()}`,
      product: 'studix',
      installationId,
      issuedAt: overrides.issuedAt ?? now,
      expiresAt: overrides.expiresAt !== undefined ? overrides.expiresAt : now + 365 * 24 * 60 * 60 * 1000,
      features: null,
    });
    return `${payloadB64}.${signPayload(owner.privateKey, payloadB64)}`;
  }

  beforeAll(async () => {
    scratch = await setupScratchDb('license_clockguard');
    owner = makeOwnerKeyPair();
    ({ checkClockAndUpdateHighWaterMark, getLicenseStatus, verifyAndActivateLicense, CLOCK_ROLLBACK_TOLERANCE_MS } = await import('./license.js'));
    ({ buildLicenseArtifactPayload } = await import('./licenseArtifactFormat.js'));
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

  async function seedLicenseConfig() {
    return scratch.client.license_config.create({ data: { id: 1, licensing_public_key: owner.publicKey } });
  }

  function withMockedNow(ms, fn) {
    const original = Date.now;
    Date.now = () => ms;
    return Promise.resolve(fn()).finally(() => { Date.now = original; });
  }

  describe('checkClockAndUpdateHighWaterMark — core behavior', () => {
    it('establishes a baseline on first call (NULL is never treated as a rollback)', async () => {
      await seedLicenseConfig();
      const result = await checkClockAndUpdateHighWaterMark();
      expect(result.rollbackDetected).toBe(false);

      const row = await scratch.client.license_config.findUnique({ where: { id: 1 } });
      expect(row.clock_high_water_mark_at).not.toBeNull();
    });

    it('normal forward time: no rollback, high-water-mark advances', async () => {
      await seedLicenseConfig();
      await withMockedNow(1_000_000_000_000, () => checkClockAndUpdateHighWaterMark());
      // forward by a full day — comfortably past the write-throttle window too
      const result = await withMockedNow(1_000_000_000_000 + 24 * 60 * 60 * 1000, () => checkClockAndUpdateHighWaterMark());
      expect(result.rollbackDetected).toBe(false);

      const row = await scratch.client.license_config.findUnique({ where: { id: 1 } });
      expect(row.clock_high_water_mark_at.getTime()).toBe(1_000_000_000_000 + 24 * 60 * 60 * 1000);
    });

    it('a small clock adjustment within tolerance (e.g. DST, -30 minutes) is not treated as a rollback', async () => {
      await seedLicenseConfig();
      const t0 = 1_000_000_000_000;
      await withMockedNow(t0, () => checkClockAndUpdateHighWaterMark());
      const result = await withMockedNow(t0 - 30 * 60 * 1000, () => checkClockAndUpdateHighWaterMark());
      expect(result.rollbackDetected).toBe(false);
    });

    it('a small clock adjustment right at the tolerance boundary is not treated as a rollback', async () => {
      await seedLicenseConfig();
      const t0 = 1_000_000_000_000;
      await withMockedNow(t0, () => checkClockAndUpdateHighWaterMark());
      const result = await withMockedNow(t0 - CLOCK_ROLLBACK_TOLERANCE_MS, () => checkClockAndUpdateHighWaterMark());
      expect(result.rollbackDetected).toBe(false);
    });

    it('a significant rollback (well beyond tolerance) is detected', async () => {
      await seedLicenseConfig();
      const t0 = 1_000_000_000_000;
      await withMockedNow(t0, () => checkClockAndUpdateHighWaterMark());
      const result = await withMockedNow(t0 - CLOCK_ROLLBACK_TOLERANCE_MS - 60_000, () => checkClockAndUpdateHighWaterMark());
      expect(result.rollbackDetected).toBe(true);
    });

    it('detected rollback never lowers the persisted high-water-mark (no reward for attempting it)', async () => {
      await seedLicenseConfig();
      const t0 = 1_000_000_000_000;
      await withMockedNow(t0, () => checkClockAndUpdateHighWaterMark());
      await withMockedNow(t0 - 30 * 24 * 60 * 60 * 1000, () => checkClockAndUpdateHighWaterMark()); // 30 days back

      const row = await scratch.client.license_config.findUnique({ where: { id: 1 } });
      expect(row.clock_high_water_mark_at.getTime()).toBe(t0);
    });

    it('restart/persistence: the high-water-mark is read from the database itself, not from any in-process memory', async () => {
      await seedLicenseConfig();
      const t0 = 2_000_000_000_000;
      await withMockedNow(t0, () => checkClockAndUpdateHighWaterMark());

      // simulate a server restart: a completely fresh dynamic import of the module under a
      // clean module registry would be the purest simulation, but this module holds no
      // in-memory state at all to begin with (confirmed here by reading the DB value
      // directly rather than trusting anything cached in this test's own closures) — the
      // next call to checkClockAndUpdateHighWaterMark must and does re-derive entirely from
      // the persisted row.
      const persisted = await scratch.client.license_config.findUnique({ where: { id: 1 } });
      expect(persisted.clock_high_water_mark_at.getTime()).toBe(t0);

      const rollbackAfterRestart = await withMockedNow(t0 - 10 * 24 * 60 * 60 * 1000, () => checkClockAndUpdateHighWaterMark());
      expect(rollbackAfterRestart.rollbackDetected).toBe(true);
    });
  });

  describe('getLicenseStatus — rollback only blocks expiring licenses, never perpetual ones', () => {
    it('perpetual license: a significant rollback does NOT block access (nothing to bypass)', async () => {
      const installation = await seedInstallation();
      await seedLicenseConfig();
      const artifact = buildSignedArtifact({ installationId: installation.installation_id, overrides: { expiresAt: null } });
      await verifyAndActivateLicense({ artifact });

      const t0 = 3_000_000_000_000;
      await withMockedNow(t0, () => getLicenseStatus());
      const status = await withMockedNow(t0 - 30 * 24 * 60 * 60 * 1000, () => getLicenseStatus());
      expect(status.activated).toBe(true);
    });

    it('expiring license: a significant rollback blocks access with reason clock_rollback_detected', async () => {
      const installation = await seedInstallation();
      await seedLicenseConfig();
      const t0 = 4_000_000_000_000;
      const artifact = buildSignedArtifact({
        installationId: installation.installation_id,
        overrides: { issuedAt: t0, expiresAt: t0 + 365 * 24 * 60 * 60 * 1000 },
      });
      await withMockedNow(t0, () => verifyAndActivateLicense({ artifact }));
      expect((await withMockedNow(t0, () => getLicenseStatus())).activated).toBe(true);

      const status = await withMockedNow(t0 - 10 * 24 * 60 * 60 * 1000, () => getLicenseStatus());
      expect(status.activated).toBe(false);
      expect(status.reason).toBe('clock_rollback_detected');
    });

    it('threat model: rolling the clock back cannot un-expire an already-expired term license', async () => {
      const installation = await seedInstallation();
      await seedLicenseConfig();
      const t0 = 5_000_000_000_000;
      const tenDaysMs = 10 * 24 * 60 * 60 * 1000;
      const shortLived = buildSignedArtifact({
        installationId: installation.installation_id,
        overrides: { issuedAt: t0, expiresAt: t0 + tenDaysMs },
      });
      await withMockedNow(t0, () => verifyAndActivateLicense({ artifact: shortLived }));

      // real expiry, forward in time — establishes a high-water-mark well past the expiry
      const expiredStatus = await withMockedNow(t0 + tenDaysMs + 10 * 24 * 60 * 60 * 1000, () => getLicenseStatus());
      expect(expiredStatus.activated).toBe(false);
      expect(expiredStatus.reason).toBe('expired');

      // now the attacker rolls the clock back to BEFORE the artifact's expiresAt (a rollback
      // of 15 days — far beyond the 6-hour tolerance), hoping the plain expiry check alone
      // would pass again — the rollback guard must catch this before expiry is even checked
      const afterRollback = await withMockedNow(t0 + tenDaysMs - 5 * 24 * 60 * 60 * 1000, () => getLicenseStatus());
      expect(afterRollback.activated).toBe(false);
      expect(afterRollback.reason).toBe('clock_rollback_detected');
    });

    it('normal forward-time expiration still works exactly as before (no rollback involved)', async () => {
      const installation = await seedInstallation();
      await seedLicenseConfig();
      const t0 = 6_000_000_000_000;
      const shortLived = buildSignedArtifact({
        installationId: installation.installation_id,
        overrides: { issuedAt: t0, expiresAt: t0 + 1000 },
      });
      await withMockedNow(t0, () => verifyAndActivateLicense({ artifact: shortLived }));
      expect((await withMockedNow(t0, () => getLicenseStatus())).activated).toBe(true);

      const status = await withMockedNow(t0 + 5000, () => getLicenseStatus());
      expect(status.activated).toBe(false);
      expect(status.reason).toBe('expired'); // not clock_rollback_detected — this is genuine forward-time expiry
    });
  });
});
