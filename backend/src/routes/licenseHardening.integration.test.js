// backend/src/routes/licenseHardening.integration.test.js
// Phase 5e — Licensing end-to-end hardening: the specific new coverage areas that Phase 5b's
// existing license.integration.test.js does not already exercise (renewal/no-revocation
// consequence, backup/restore, cross-key-namespace separation named explicitly, cached-column
// distrust without any stored artifact, duplicated/cloned DB — documented limitation, and
// future-route fail-closed behavior). Real scratch databases only (setupScratchDb/
// teardownScratchDb, unmodified) — studix الحقيقية لا تُلمَس بأي خطوة في هذا الملف.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

function makeKeyPair() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('Licensing — Phase 5e hardening (real scratch database)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let licensingKeyPair, supportAccessKeyPair;
  let PRODUCT_ID, buildLicenseArtifactPayload;
  let getLicenseStatus, verifyAndActivateLicense;
  let requireActivation;

  function signPayload(privateKeyPem, payloadB64) {
    return crypto.sign(null, Buffer.from(payloadB64, 'utf8'), crypto.createPrivateKey(privateKeyPem)).toString('base64url');
  }

  function buildSignedArtifact({ privateKeyPem, installationId, overrides = {} }) {
    const now = Date.now();
    const payloadB64 = buildLicenseArtifactPayload({
      licenseId: overrides.licenseId || `lic_${crypto.randomUUID()}`,
      product: overrides.product ?? PRODUCT_ID,
      installationId: overrides.installationId ?? installationId,
      issuedAt: overrides.issuedAt ?? now,
      expiresAt: overrides.expiresAt !== undefined ? overrides.expiresAt : now + 365 * 24 * 60 * 60 * 1000,
      features: overrides.features ?? null,
    });
    return `${payloadB64}.${signPayload(privateKeyPem, payloadB64)}`;
  }

  function mockReqRes({ path }) {
    const req = { user: null, path };
    const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    const next = vi.fn();
    return { req, res, next };
  }

  beforeAll(async () => {
    scratch = await setupScratchDb('license_hardening');
    licensingKeyPair = makeKeyPair();
    supportAccessKeyPair = makeKeyPair(); // structurally identical Ed25519 keypair, different trust namespace

    ({ PRODUCT_ID, buildLicenseArtifactPayload } = await import('../lib/licenseArtifactFormat.js'));
    ({ getLicenseStatus, verifyAndActivateLicense } = await import('../lib/license.js'));
    ({ requireActivation } = await import('../middleware/activation.js'));
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
    return scratch.client.license_config.create({ data: { id: 1, licensing_public_key: licensingKeyPair.publicKey } });
  }

  describe('Area 2/5 — no revocation list: a replaced (stale) artifact remains cryptographically valid and can be resubmitted', () => {
    it('documents the deliberate deferral: after a valid renewal, resubmitting the OLD artifact still succeeds (no denylist exists)', async () => {
      const installation = await seedInstallation();
      await seedLicenseConfig();
      const first = buildSignedArtifact({
        privateKeyPem: licensingKeyPair.privateKey, installationId: installation.installation_id,
        overrides: { licenseId: 'lic_OLD', expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000 },
      });
      const second = buildSignedArtifact({
        privateKeyPem: licensingKeyPair.privateKey, installationId: installation.installation_id,
        overrides: { licenseId: 'lic_NEW', expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000 },
      });

      await verifyAndActivateLicense({ artifact: first });
      expect((await getLicenseStatus()).licenseId).toBe('lic_OLD');

      await verifyAndActivateLicense({ artifact: second });
      expect((await getLicenseStatus()).licenseId).toBe('lic_NEW');

      // the "old-artifact-reuse-after-replacement" case: nothing about the OLD artifact's
      // own signature/expiry/installation binding became invalid just because a newer one
      // was applied — verifyLicenseArtifact has no concept of "superseded". Resubmitting it
      // is accepted exactly like any other valid artifact, reverting the stored license.
      const revert = await verifyAndActivateLicense({ artifact: first });
      expect(revert.ok).toBe(true);
      expect((await getLicenseStatus()).licenseId).toBe('lic_OLD');

      // Phase 5e deferral decision (see final report / tools/LICENSING.md): implementing a
      // revocation/denylist would require persisting every superseded license_id forever
      // (unbounded local growth) or an online check (explicitly out of scope — no cloud
      // dependency for this fully offline product). Since a still-cryptographically-valid
      // OLD artifact can only be resubmitted by whoever already possesses it — the
      // installation's own legitimate admin, or the owner who issued it — this does not
      // grant any access beyond what the customer's own currently/previously issued
      // artifacts already allow. Deliberately deferred, not an oversight.
    });
  });

  describe('Area 9 — threat model: an artifact signed with an unrelated (e.g. Support Access) key namespace is rejected', () => {
    it('rejects an otherwise-well-formed artifact signed by a different Ed25519 keypair than the configured licensing_public_key', async () => {
      const installation = await seedInstallation();
      await seedLicenseConfig(); // registers licensingKeyPair.publicKey as the trusted key
      const foreignSigned = buildSignedArtifact({
        privateKeyPem: supportAccessKeyPair.privateKey, installationId: installation.installation_id,
      });

      const result = await verifyAndActivateLicense({ artifact: foreignSigned });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('invalid_signature');
      expect((await getLicenseStatus()).activated).toBe(false);
    });
  });

  describe('Area 9 — threat model: cached license_config columns are never trusted without a genuinely stored+verifiable artifact', () => {
    it('a row with activated_at/expires_at set via raw SQL but license_artifact left NULL is reported as not_activated', async () => {
      await seedInstallation();
      await scratch.client.license_config.create({ data: { id: 1, licensing_public_key: licensingKeyPair.publicKey } });
      // simulate direct DB tampering / a corrupted backup restore that carried over stale
      // "looks activated" cached columns without the artifact that would justify them
      await scratch.client.$executeRawUnsafe(`
        UPDATE license_config
        SET activated_at = now(), expires_at = now() + interval '1 year', license_id = 'lic_FAKE'
        WHERE id = 1`);

      const status = await getLicenseStatus();
      expect(status.activated).toBe(false);
      expect(status.reason).toBe('not_activated');
    });
  });

  describe('Area 9 — threat model: duplicated/cloned database (documented known limitation, not solved by this phase)', () => {
    it('the exact same (artifact, installationId, publicKey) tuple verifies identically no matter how many "machines" present it — proof there is no per-machine binding', async () => {
      // verifyLicenseArtifact is a pure function of its three inputs (no DB access, no
      // machine identity of any kind) — see licenseArtifactFormat.js. A real database clone
      // (e.g. restoring the same backup onto two machines) reproduces this exact tuple
      // verbatim on both, so this pure-function proof is equivalent to — and far simpler
      // than — spinning up a second live scratch database with copied rows.
      const { verifyLicenseArtifact } = await import('../lib/licenseArtifactFormat.js');
      const installationId = crypto.randomUUID();
      const artifact = buildSignedArtifact({ privateKeyPem: licensingKeyPair.privateKey, installationId });

      const onMachineOne = verifyLicenseArtifact({
        artifact, installationId, product: PRODUCT_ID, publicKeyPem: licensingKeyPair.publicKey,
      });
      const onMachineTwo = verifyLicenseArtifact({
        artifact, installationId, product: PRODUCT_ID, publicKeyPem: licensingKeyPair.publicKey,
      });
      expect(onMachineOne.ok).toBe(true);
      expect(onMachineTwo.ok).toBe(true);

      // KNOWN, ACCEPTED LIMITATION (documented, not a defect): this product deliberately
      // implements no hardware fingerprinting and no online activation server (both
      // explicitly excluded from Phase 5e's scope by the user). A byte-for-byte database
      // clone — e.g. restoring the same backup onto two machines — is therefore
      // indistinguishable from a single legitimate installation, and both will report
      // activated. Preventing this would require exactly the two mechanisms this project
      // has deliberately chosen not to build for a fully offline desktop product.
    });
  });

  describe('Area 6 — activation-gate regression: an unrecognized future route stays fail-closed', () => {
    it('a route that does not exist yet in this codebase is still blocked (402) when not activated, not passed through by default', async () => {
      await seedInstallation(); // never activated
      const { req, res, next } = mockReqRes({ path: '/api/some-future-module-not-yet-written' });
      await requireActivation(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(402);
    });

    it('the same unrecognized future route is allowed once genuinely activated (no special-casing by path string)', async () => {
      const installation = await seedInstallation();
      await seedLicenseConfig();
      const artifact = buildSignedArtifact({ privateKeyPem: licensingKeyPair.privateKey, installationId: installation.installation_id });
      await verifyAndActivateLicense({ artifact });

      const { req, res, next } = mockReqRes({ path: '/api/some-future-module-not-yet-written' });
      await requireActivation(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBeNull();
    });
  });
});
