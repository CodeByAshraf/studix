// backend/src/routes/license.integration.test.js
// Phase 5b — real Postgres scratch database (setupScratchDb/teardownScratchDb, unmodified —
// see backend/src/test-helpers/scratchDb.js). No mocking of Prisma. Dynamic import after
// injecting globalThis.prisma, exactly like supportAccess.integration.test.js's own
// convention in this project.
//
// Authorization note (server.js): only requireAuth + requireRole('admin') gate
// /api/license/* — pre-existing, unmodified code (auth.js), already trusted (proven in
// Phase 4b). This project's own convention (see admissionActivation.js/supportAccess.js)
// is to test the exported core functions directly, not spin up a real HTTP server (no
// supertest dependency anywhere in this codebase).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'studix-test-session-secret-not-for-production';

const dbCheck = await checkPostgresReachable();

function makeOwnerKeyPair() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('Licensing — Phase 5b backend core (real scratch database)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let client;
  let owner;
  let impostor;

  // dynamically imported after globalThis.prisma injection — see setupScratchDb's own docs
  let PRODUCT_ID, buildLicenseArtifactPayload;
  let getLicenseStatus, requestActivationCode, verifyAndActivateLicense;
  let getLicenseStatusForActor, requestLicenseActivationCode, activateLicense;
  let requireActivation, isActivationExempt;
  let requireRole;
  let verifySession, signSession;

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
    const signatureB64 = signPayload(privateKeyPem, payloadB64);
    return `${payloadB64}.${signatureB64}`;
  }

  beforeAll(async () => {
    scratch = await setupScratchDb('license');
    client = scratch.client;
    owner = makeOwnerKeyPair();
    impostor = makeOwnerKeyPair();

    ({ PRODUCT_ID, buildLicenseArtifactPayload } = await import('../lib/licenseArtifactFormat.js'));
    ({ getLicenseStatus, requestActivationCode, verifyAndActivateLicense } = await import('../lib/license.js'));
    ({ getLicenseStatusForActor, requestLicenseActivationCode, activateLicense } = await import('./license.js'));
    ({ requireActivation, isActivationExempt } = await import('../middleware/activation.js'));
    ({ requireRole } = await import('../middleware/auth.js'));
    ({ verifySession, signSession } = await import('../lib/session.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  beforeEach(async () => {
    // one config row per test, cleanly reset — both are strict singletons (id=1)
    await client.$executeRawUnsafe('DELETE FROM license_config');
    await client.$executeRawUnsafe('DELETE FROM support_access_config');
    await client.$executeRawUnsafe('DELETE FROM activity_logs');
    await client.$executeRawUnsafe('DELETE FROM users');
  });

  async function seedInstallation() {
    return client.support_access_config.create({ data: { id: 1 } }); // installation_id auto-generated
  }

  async function seedLicenseConfig(publicKeyPem = owner.publicKey) {
    return client.license_config.create({ data: { id: 1, licensing_public_key: publicKeyPem } });
  }

  async function seedAdminUser(id = 'admin1') {
    return client.users.create({ data: { id, name: 'مدير الاختبار', is_admin: true, active: true, role_id: null } });
  }

  function mockReqRes({ role, path = '/api/students' } = {}) {
    const req = { user: role ? { id: 'admin1', role } : null, path };
    const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    const next = vi.fn();
    return { req, res, next };
  }

  describe('requestActivationCode / requestLicenseActivationCode — installation binding', () => {
    it('the activation request code is bound to this installation\'s real installation_id', async () => {
      const installation = await seedInstallation();
      const result = await requestActivationCode();
      expect(result.installationId).toBe(installation.installation_id);
      expect(result.product).toBe(PRODUCT_ID);
    });

    it('does not require licensing_public_key to be configured (a request code is never verified locally)', async () => {
      await seedInstallation(); // no license_config row seeded at all
      const result = await requestActivationCode();
      expect(typeof result.code).toBe('string');
    });

    it('logs a license_activation_requested activity event, actor derived server-side', async () => {
      const installation = await seedInstallation();
      const admin = await seedAdminUser();
      await requestLicenseActivationCode({ userId: admin.id });
      const logs = await client.activity_logs.findMany({ where: { module: 'license', action: 'license_activation_requested' } });
      expect(logs).toHaveLength(1);
      expect(logs[0].user_id).toBe(admin.id);
      expect(logs[0].entity_id).toBe(installation.installation_id);
    });
  });

  describe('getLicenseStatus — fail-closed re-verification, never trusts cached columns alone', () => {
    it('not_configured: no licensing_public_key at all', async () => {
      await seedInstallation();
      await client.license_config.create({ data: { id: 1 } }); // no key
      const status = await getLicenseStatus();
      expect(status).toEqual({ activated: false, reason: 'not_configured', payload: null });
    });

    it('not_activated: key configured, but no artifact stored yet', async () => {
      await seedInstallation();
      await seedLicenseConfig();
      const status = await getLicenseStatus();
      expect(status.activated).toBe(false);
      expect(status.reason).toBe('not_activated');
    });

    it('activated: a genuinely valid, currently-stored artifact re-verifies successfully', async () => {
      const installation = await seedInstallation();
      await seedLicenseConfig();
      const artifact = buildSignedArtifact({ privateKeyPem: owner.privateKey, installationId: installation.installation_id });
      await verifyAndActivateLicense({ artifact });

      const status = await getLicenseStatus();
      expect(status.activated).toBe(true);
      expect(status.licenseId).toBeTruthy();
    });

    it('a stored artifact that has since expired re-verifies as NOT activated on every fresh check (no stale trust)', async () => {
      const installation = await seedInstallation();
      await seedLicenseConfig();
      const almostExpired = buildSignedArtifact({
        privateKeyPem: owner.privateKey, installationId: installation.installation_id,
        overrides: { issuedAt: Date.now() - 2000, expiresAt: Date.now() + 500 },
      });
      await verifyAndActivateLicense({ artifact: almostExpired });
      expect((await getLicenseStatus()).activated).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 700));
      const status = await getLicenseStatus();
      expect(status.activated).toBe(false);
      expect(status.reason).toBe('expired');
    });

    it('directly corrupting license_artifact via raw SQL (simulating DB row tampering) is caught, not trusted', async () => {
      const installation = await seedInstallation();
      await seedLicenseConfig();
      const artifact = buildSignedArtifact({ privateKeyPem: owner.privateKey, installationId: installation.installation_id });
      await verifyAndActivateLicense({ artifact });
      expect((await getLicenseStatus()).activated).toBe(true);

      // simulate a customer editing the stored artifact directly in Postgres — this must
      // never be trusted just because activated_at/license_id columns still look "activated"
      await client.$executeRawUnsafe(
        `UPDATE license_config SET license_artifact = 'not-a-real-artifact.fake-signature' WHERE id = 1`
      );
      const status = await getLicenseStatus();
      expect(status.activated).toBe(false);
      expect(status.reason).toBe('malformed_artifact');
    });
  });

  describe('verifyAndActivateLicense / activateLicense — full verify → activate flow', () => {
    it('successfully activates on a valid, correctly signed artifact', async () => {
      const installation = await seedInstallation();
      await seedLicenseConfig();
      const admin = await seedAdminUser();
      const artifact = buildSignedArtifact({ privateKeyPem: owner.privateKey, installationId: installation.installation_id });

      const result = await activateLicense({ artifact }, { userId: admin.id });
      expect(result.ok).toBe(true);
      expect(result.payload.licenseId).toBeTruthy();

      const row = await client.license_config.findUnique({ where: { id: 1 } });
      expect(row.license_artifact).toBe(artifact);
      expect(row.activated_at).not.toBeNull();
    });

    it('logs license_activated with the activating admin as actor', async () => {
      const installation = await seedInstallation();
      await seedLicenseConfig();
      const admin = await seedAdminUser();
      const artifact = buildSignedArtifact({ privateKeyPem: owner.privateKey, installationId: installation.installation_id });

      const result = await activateLicense({ artifact }, { userId: admin.id });
      const logs = await client.activity_logs.findMany({ where: { module: 'license', action: 'license_activated' } });
      expect(logs).toHaveLength(1);
      expect(logs[0].user_id).toBe(admin.id);
      expect(logs[0].entity_id).toBe(result.payload.licenseId);
    });

    it('rejects and logs a failed verification for an invalid signature (wrong keypair), no partial write', async () => {
      const installation = await seedInstallation();
      await seedLicenseConfig();
      const admin = await seedAdminUser();
      const artifact = buildSignedArtifact({ privateKeyPem: impostor.privateKey, installationId: installation.installation_id });

      await expect(activateLicense({ artifact }, { userId: admin.id })).rejects.toMatchObject({ status: 401 });

      const logs = await client.activity_logs.findMany({ where: { module: 'license', action: 'license_verification_failed' } });
      expect(logs).toHaveLength(1);
      expect(logs[0].details).toBe('invalid_signature');

      const row = await client.license_config.findUnique({ where: { id: 1 } });
      expect(row.license_artifact).toBeNull();
      expect(row.activated_at).toBeNull();
    });

    it('rejects an artifact bound to a different installation', async () => {
      await seedInstallation();
      await seedLicenseConfig();
      const artifact = buildSignedArtifact({ privateKeyPem: owner.privateKey, installationId: 'some-other-installation' });

      await expect(activateLicense({ artifact }, { userId: null })).rejects.toMatchObject({ status: 401 });
      const logs = await client.activity_logs.findMany({ where: { module: 'license', action: 'license_verification_failed' } });
      expect(logs[0].details).toBe('wrong_installation');
    });

    it('rejects a tampered artifact', async () => {
      const installation = await seedInstallation();
      await seedLicenseConfig();
      const artifact = buildSignedArtifact({ privateKeyPem: owner.privateKey, installationId: installation.installation_id });
      const [payloadB64, sig] = artifact.split('.');
      const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
      const tamperedPayloadB64 = buildLicenseArtifactPayload({ ...parsed, licenseId: 'lic_TAMPERED' });
      const tampered = `${tamperedPayloadB64}.${sig}`;

      await expect(activateLicense({ artifact: tampered }, { userId: null })).rejects.toMatchObject({ status: 401 });
    });

    it('rejects an expired artifact at activation time', async () => {
      const installation = await seedInstallation();
      await seedLicenseConfig();
      const artifact = buildSignedArtifact({
        privateKeyPem: owner.privateKey, installationId: installation.installation_id,
        overrides: { issuedAt: Date.now() - 20000, expiresAt: Date.now() - 1000 },
      });

      await expect(activateLicense({ artifact }, { userId: null })).rejects.toMatchObject({ status: 401 });
      const logs = await client.activity_logs.findMany({ where: { module: 'license', action: 'license_verification_failed' } });
      expect(logs[0].details).toBe('expired');
    });

    it('rejects a malformed artifact, fails closed', async () => {
      await seedInstallation();
      await seedLicenseConfig();
      await expect(activateLicense({ artifact: 'garbage-not-an-artifact' }, { userId: null })).rejects.toMatchObject({ status: 401 });
    });

    it('rejects when no artifact is provided at all', async () => {
      await seedInstallation();
      await seedLicenseConfig();
      await expect(activateLicense({ artifact: '' }, { userId: null })).rejects.toMatchObject({ status: 400 });
    });

    it('fails closed with 409 when no licensing public key is configured yet', async () => {
      const installation = await seedInstallation();
      await client.license_config.create({ data: { id: 1 } }); // no key
      const artifact = buildSignedArtifact({ privateKeyPem: owner.privateKey, installationId: installation.installation_id });
      await expect(verifyAndActivateLicense({ artifact })).rejects.toMatchObject({ status: 409 });
    });

    it('reactivation/replacement: a second valid artifact fully replaces the first (renewal scenario)', async () => {
      const installation = await seedInstallation();
      await seedLicenseConfig();
      const first = buildSignedArtifact({
        privateKeyPem: owner.privateKey, installationId: installation.installation_id,
        overrides: { licenseId: 'lic_FIRST', expiresAt: Date.now() + 1000 * 60 },
      });
      await activateLicense({ artifact: first }, { userId: null });
      const afterFirst = await client.license_config.findUnique({ where: { id: 1 } });
      expect(afterFirst.license_id).toBe('lic_FIRST');

      const second = buildSignedArtifact({
        privateKeyPem: owner.privateKey, installationId: installation.installation_id,
        overrides: { licenseId: 'lic_SECOND', expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30 },
      });
      await activateLicense({ artifact: second }, { userId: null });
      const afterSecond = await client.license_config.findUnique({ where: { id: 1 } });
      expect(afterSecond.license_id).toBe('lic_SECOND');
      expect(afterSecond.license_artifact).toBe(second);

      const status = await getLicenseStatus();
      expect(status.licenseId).toBe('lic_SECOND');
    });
  });

  describe('license_expiration_detected audit event', () => {
    it('is logged when an explicit status check discovers a previously-valid license has expired', async () => {
      const installation = await seedInstallation();
      await seedLicenseConfig();
      const admin = await seedAdminUser();
      const artifact = buildSignedArtifact({
        privateKeyPem: owner.privateKey, installationId: installation.installation_id,
        overrides: { issuedAt: Date.now() - 2000, expiresAt: Date.now() + 500 },
      });
      await activateLicense({ artifact }, { userId: admin.id });

      await new Promise((resolve) => setTimeout(resolve, 700));
      const status = await getLicenseStatusForActor({ userId: admin.id });
      expect(status.activated).toBe(false);
      expect(status.reason).toBe('expired');

      const logs = await client.activity_logs.findMany({ where: { module: 'license', action: 'license_expiration_detected' } });
      expect(logs).toHaveLength(1);
      expect(logs[0].user_id).toBe(admin.id);
    });

    it('is not logged for a never-activated installation (reason not_activated, not expired)', async () => {
      await seedInstallation();
      await seedLicenseConfig();
      await getLicenseStatusForActor({ userId: null });
      const logs = await client.activity_logs.findMany({ where: { module: 'license', action: 'license_expiration_detected' } });
      expect(logs).toHaveLength(0);
    });
  });

  describe('requireActivation — enforcement, allowlist, and restoring access', () => {
    it('allowlisted paths pass through even on a completely unconfigured installation', async () => {
      await seedInstallation(); // no license_config row at all
      for (const path of ['/api/session', '/api/session/', '/api/license', '/api/license/status', '/api/support-access', '/api/support-access/challenge']) {
        const { req, res, next } = mockReqRes({ path });
        // eslint-disable-next-line no-await-in-loop
        await requireActivation(req, res, next);
        expect(next).toHaveBeenCalledOnce();
        expect(res.statusCode).toBeNull();
      }
    });

    it('non-API and /health paths pass through untouched', async () => {
      for (const path of ['/', '/students', '/assets/index.js', '/health']) {
        const { req, res, next } = mockReqRes({ path });
        // eslint-disable-next-line no-await-in-loop
        await requireActivation(req, res, next);
        expect(next).toHaveBeenCalledOnce();
      }
    });

    it('blocks a non-allowlisted business route (402) when not activated', async () => {
      await seedInstallation();
      const { req, res, next } = mockReqRes({ path: '/api/students' });
      await requireActivation(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(402);
      expect(res.body.licenseRequired).toBe(true);
    });

    it('a valid license restores normal application access on the same route', async () => {
      const installation = await seedInstallation();
      await seedLicenseConfig();
      const artifact = buildSignedArtifact({ privateKeyPem: owner.privateKey, installationId: installation.installation_id });
      await verifyAndActivateLicense({ artifact });

      const { req, res, next } = mockReqRes({ path: '/api/students' });
      await requireActivation(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBeNull();
    });

    it('an expired license blocks access again (402), even though it was previously valid', async () => {
      const installation = await seedInstallation();
      await seedLicenseConfig();
      const artifact = buildSignedArtifact({
        privateKeyPem: owner.privateKey, installationId: installation.installation_id,
        overrides: { issuedAt: Date.now() - 2000, expiresAt: Date.now() + 500 },
      });
      await verifyAndActivateLicense({ artifact });
      await new Promise((resolve) => setTimeout(resolve, 700));

      const { req, res, next } = mockReqRes({ path: '/api/payments' });
      await requireActivation(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(402);
    });
  });

  describe('authorization — activateLicense/status/request-code have no built-in auth check; the router guard (requireRole(\'admin\')) is the real gate', () => {
    it('a non-admin role is rejected by requireRole(\'admin\') — the exact guard server.js mounts', () => {
      const { req, res, next } = mockReqRes({ role: 'teacher' });
      requireRole('admin')(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });

    it('an admin role passes requireRole(\'admin\')', () => {
      const { req, res, next } = mockReqRes({ role: 'admin' });
      requireRole('admin')(req, res, next);
      expect(next).toHaveBeenCalledOnce();
    });

    it('a support session (no req.user at all) cannot satisfy requireRole(\'admin\') and therefore cannot reach activateLicense via the router', () => {
      // A support session never populates req.user (see requireSupportSession in auth.js —
      // it sets req.supportSession, never req.user). requireAuth (which populates req.user)
      // is a completely separate, unrelated check that a support session token cannot pass
      // either (proven exhaustively in Phase 4b's supportSession.test.js /
      // supportAccess.integration.test.js — not re-proven here). This test documents and
      // proves the consequence for licensing specifically: no req.user means requireRole
      // rejects the request before activateLicense (which has no auth check of its own,
      // by design — see routes/license.js's header) is ever reached.
      const req = { user: null, supportSession: { purpose: 'support', sessionId: 'sess-1', installationId: 'inst-1' }, path: '/api/license/activate' };
      const res = { statusCode: null, status(c) { this.statusCode = c; return this; }, json() { return this; } };
      const next = vi.fn();
      requireRole('admin')(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });
  });

  describe('cross-domain isolation — a license artifact cannot be used as a normal login credential', () => {
    it('a valid license artifact is rejected by verifySession (normal /api/session verifier)', async () => {
      const installation = await seedInstallation();
      const artifact = buildSignedArtifact({ privateKeyPem: owner.privateKey, installationId: installation.installation_id });
      expect(verifySession(artifact)).toBeNull();
    });

    it('normal authentication is unaffected: a real admin session still verifies correctly', () => {
      const token = signSession({ id: 'admin1', role: 'admin', userAuthVersion: 1, roleAuthVersion: 1 });
      expect(verifySession(token)).toEqual({ id: 'admin1', role: 'admin', userAuthVersion: 1, roleAuthVersion: 1 });
    });
  });
});
