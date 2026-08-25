// backend/src/routes/supportAccess.integration.test.js
// Phase 4b — real Postgres scratch database (setupScratchDb/teardownScratchDb, unmodified —
// see backend/src/test-helpers/scratchDb.js). No mocking of Prisma. Dynamic import after
// injecting globalThis.prisma, exactly like payments.integration.test.js/
// admissionActivation.js's own test convention in this project.
//
// Authorization note (server.js): only requireAuth + requireRole('admin') actually gate
// these HTTP routes — requireRole is pre-existing, unmodified code (auth.js), already
// trusted. This project's own convention (see admissionActivation.js/payments.js) is to
// test the exported core functions directly, not spin up a real HTTP server (no supertest
// dependency anywhere in this codebase) — so "non-admin cannot generate support access" is
// proven here by exercising requireRole('admin') directly with mock req/res, the exact
// guard server.js mounts in front of this router, rather than reconstructing Express
// routing by hand.
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

function ownerSign(privateKeyPem, challenge) {
  return crypto.sign(null, Buffer.from(challenge, 'utf8'), crypto.createPrivateKey(privateKeyPem)).toString('base64url');
}

describe('Support Access — Phase 4b backend core (real scratch database)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let client;
  let owner;
  let impostor;

  // dynamically imported after globalThis.prisma injection — see setupScratchDb's own docs
  let requestSupportChallenge, redeemSupportChallenge, getSupportAccessStatus, revokeSupportAccess;
  let clearAll;
  let requireSupportSession, requireRole;
  let verifySupportSessionToken;
  let verifySession, signSession;

  beforeAll(async () => {
    scratch = await setupScratchDb('supportaccess');
    client = scratch.client;
    owner = makeOwnerKeyPair();
    impostor = makeOwnerKeyPair();

    ({ requestSupportChallenge, redeemSupportChallenge, getSupportAccessStatus, revokeSupportAccess } =
      await import('./supportAccess.js'));
    ({ clearAll } = await import('../lib/supportAccessCache.js'));
    ({ requireSupportSession, requireRole } = await import('../middleware/auth.js'));
    ({ verifySupportSessionToken } = await import('../lib/supportSession.js'));
    ({ verifySession, signSession } = await import('../lib/session.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  beforeEach(async () => {
    clearAll();
    // one config row per test, cleanly reset — this table is a strict singleton (id=1,
    // CHECK id=1) so each test truncates and reseeds it rather than trying to reuse rows
    // across tests with different keys/installation setups.
    await client.$executeRawUnsafe('DELETE FROM support_access_config');
    await client.$executeRawUnsafe('DELETE FROM activity_logs'); // child of users (user_id FK) — clear first
    await client.$executeRawUnsafe('DELETE FROM users');
  });

  async function seedConfiguredInstallation(publicKeyPem = owner.publicKey) {
    return client.support_access_config.create({ data: { id: 1, support_public_key: publicKeyPem } });
  }

  async function seedAdminUser(id = 'admin1') {
    return client.users.create({
      data: { id, name: 'مدير الاختبار', is_admin: true, active: true, role_id: null },
    });
  }

  function mockReqRes({ role, cookie } = {}) {
    const req = { user: role ? { id: 'admin1', role } : null, headers: { cookie: cookie || '' } };
    const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    const next = vi.fn();
    return { req, res, next };
  }

  describe('generateChallenge / requestSupportChallenge — installation binding and fail-closed config', () => {
    it('fails closed (409) when no public key is configured yet', async () => {
      await client.support_access_config.create({ data: { id: 1 } }); // no support_public_key
      await expect(requestSupportChallenge({ userId: null })).rejects.toMatchObject({ status: 409 });
    });

    it('lazily creates the singleton config row if entirely missing (Phase 4a fresh-install gap, closed here)', async () => {
      await expect(client.support_access_config.findUnique({ where: { id: 1 } })).resolves.toBeNull();
      await expect(requestSupportChallenge({ userId: null })).rejects.toMatchObject({ status: 409 }); // still no key
      const row = await client.support_access_config.findUnique({ where: { id: 1 } });
      expect(row).not.toBeNull();
      expect(typeof row.installation_id).toBe('string');
      expect(row.installation_id.length).toBeGreaterThan(0);
    });

    it('a valid challenge is bound to this installation\'s real installation_id', async () => {
      const config = await seedConfiguredInstallation();
      const result = await requestSupportChallenge({ userId: null });
      expect(result.installationId).toBe(config.installation_id);
      expect(typeof result.challenge).toBe('string');
      expect(typeof result.nonce).toBe('string');
    });

    it('logs a support_challenge_generated activity event, actor derived server-side', async () => {
      await seedConfiguredInstallation();
      const admin = await seedAdminUser();
      const result = await requestSupportChallenge({ userId: admin.id });
      const logs = await client.activity_logs.findMany({ where: { module: 'support', action: 'support_challenge_generated' } });
      expect(logs).toHaveLength(1);
      expect(logs[0].user_id).toBe(admin.id);
      expect(logs[0].user_name).toBe(admin.name);
      expect(logs[0].entity_id).toBe(result.nonce);
    });
  });

  describe('redeemSupportChallenge — full verify → grant flow', () => {
    it('successfully issues a support session on a valid, correctly signed challenge', async () => {
      await seedConfiguredInstallation();
      const admin = await seedAdminUser();
      const { challenge } = await requestSupportChallenge({ userId: admin.id });
      const response = ownerSign(owner.privateKey, challenge);

      const result = await redeemSupportChallenge({ challenge, response }, { userId: admin.id });
      expect(typeof result.sessionId).toBe('string');
      expect(typeof result.token).toBe('string');
      expect(result.expiresAt).toBeGreaterThan(Date.now());

      const status = getSupportAccessStatus();
      expect(status.active).toBe(true);
      expect(status.session.id).toBe(result.sessionId);
    });

    it('the issued token verifies via verifySupportSessionToken and is recognized by requireSupportSession', async () => {
      await seedConfiguredInstallation();
      const { challenge } = await requestSupportChallenge({ userId: null });
      const response = ownerSign(owner.privateKey, challenge);
      const { token } = await redeemSupportChallenge({ challenge, response }, { userId: null });

      expect(verifySupportSessionToken(token)).not.toBeNull();

      const { req, res, next } = mockReqRes({ cookie: `studix_support_session=${token}` });
      requireSupportSession(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(req.supportSession.purpose).toBe('support');
    });

    it('logs support_access_granted with the redeeming admin as actor', async () => {
      await seedConfiguredInstallation();
      const admin = await seedAdminUser();
      const { challenge } = await requestSupportChallenge({ userId: null });
      const response = ownerSign(owner.privateKey, challenge);
      const result = await redeemSupportChallenge({ challenge, response }, { userId: admin.id });

      const logs = await client.activity_logs.findMany({ where: { module: 'support', action: 'support_access_granted' } });
      expect(logs).toHaveLength(1);
      expect(logs[0].user_id).toBe(admin.id);
      expect(logs[0].entity_id).toBe(result.sessionId);
    });

    it('rejects and logs a failed verification for an invalid signature (wrong keypair)', async () => {
      await seedConfiguredInstallation();
      const admin = await seedAdminUser();
      const { challenge } = await requestSupportChallenge({ userId: null });
      const response = ownerSign(impostor.privateKey, challenge); // signed by the wrong key

      await expect(redeemSupportChallenge({ challenge, response }, { userId: admin.id }))
        .rejects.toMatchObject({ status: 401 });

      const logs = await client.activity_logs.findMany({ where: { module: 'support', action: 'support_verification_failed' } });
      expect(logs).toHaveLength(1);
      expect(logs[0].details).toBe('invalid_signature');
      expect(getSupportAccessStatus().active).toBe(false);
    });

    it('rejects a tampered challenge', async () => {
      await seedConfiguredInstallation();
      const { challenge } = await requestSupportChallenge({ userId: null });
      const response = ownerSign(owner.privateKey, challenge);
      const tampered = challenge.slice(0, -2) + (challenge.slice(-2) === 'AA' ? 'BB' : 'AA');

      await expect(redeemSupportChallenge({ challenge: tampered, response }, { userId: null }))
        .rejects.toMatchObject({ status: 401 });
    });

    it('rejects an expired challenge', async () => {
      await seedConfiguredInstallation();
      const originalNow = Date.now;
      let challenge;
      try {
        Date.now = () => originalNow() - 20 * 60 * 1000; // 20 min in the past — TTL is 15 min
        ({ challenge } = await requestSupportChallenge({ userId: null }));
      } finally {
        Date.now = originalNow;
      }
      const response = ownerSign(owner.privateKey, challenge);
      await expect(redeemSupportChallenge({ challenge, response }, { userId: null }))
        .rejects.toMatchObject({ status: 401 });
    });

    it('rejects a challenge issued for a different installation', async () => {
      await seedConfiguredInstallation();
      const { challenge, nonce, iat, exp } = await requestSupportChallenge({ userId: null });
      // forge a challenge string identical except for installationId — still signable by
      // the real owner key, but must not bind to *this* installation's config row.
      const { buildChallengeString } = await import('../lib/supportAccess.js');
      const forged = buildChallengeString({ installationId: 'some-other-installation', nonce, iat, exp });
      const response = ownerSign(owner.privateKey, forged);

      await expect(redeemSupportChallenge({ challenge: forged, response }, { userId: null }))
        .rejects.toMatchObject({ status: 401 });
    });

    it('rejects an already-consumed challenge on a second redemption attempt, grants only once', async () => {
      await seedConfiguredInstallation();
      const { challenge } = await requestSupportChallenge({ userId: null });
      const response = ownerSign(owner.privateKey, challenge);

      const first = await redeemSupportChallenge({ challenge, response }, { userId: null });
      expect(first.sessionId).toBeTruthy();

      await expect(redeemSupportChallenge({ challenge, response }, { userId: null }))
        .rejects.toMatchObject({ status: 401 });

      const grantedLogs = await client.activity_logs.findMany({ where: { module: 'support', action: 'support_access_granted' } });
      expect(grantedLogs).toHaveLength(1); // still exactly one grant, not two
    });

    it('rejects a challenge that was explicitly revoked before it was ever redeemed', async () => {
      await seedConfiguredInstallation();
      const { challenge, nonce } = await requestSupportChallenge({ userId: null });
      await revokeSupportAccess({ nonce }, { userId: null });

      const response = ownerSign(owner.privateKey, challenge);
      await expect(redeemSupportChallenge({ challenge, response }, { userId: null }))
        .rejects.toMatchObject({ status: 401 });
      expect(getSupportAccessStatus().active).toBe(false);
    });

    it('concurrent/replay: two simultaneous redemptions of the same challenge grant exactly one session', async () => {
      await seedConfiguredInstallation();
      const { challenge } = await requestSupportChallenge({ userId: null });
      const response = ownerSign(owner.privateKey, challenge);

      const [a, b] = await Promise.allSettled([
        redeemSupportChallenge({ challenge, response }, { userId: null }),
        redeemSupportChallenge({ challenge, response }, { userId: null }),
      ]);
      const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
      const rejected = [a, b].filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const grantedLogs = await client.activity_logs.findMany({ where: { module: 'support', action: 'support_access_granted' } });
      expect(grantedLogs).toHaveLength(1);
    });
  });

  describe('support session expiration and manual revocation', () => {
    it('an issued support session becomes unusable once its TTL elapses (token exp + registry exp both close)', async () => {
      await seedConfiguredInstallation();
      const { challenge } = await requestSupportChallenge({ userId: null });
      const response = ownerSign(owner.privateKey, challenge);
      const { token } = await redeemSupportChallenge({ challenge, response }, { userId: null });
      expect(getSupportAccessStatus().active).toBe(true);
      expect(verifySupportSessionToken(token)).not.toBeNull();

      const originalNow = Date.now;
      try {
        Date.now = () => originalNow() + 31 * 60 * 1000; // fast-forward past the 30-min session TTL
        // token-embedded expiry rejects it on its own, independent of the in-memory registry
        // (registry-level expiry semantics are covered directly in supportAccessCache.test.js)
        expect(verifySupportSessionToken(token)).toBeNull();
        const { req, res, next } = mockReqRes({ cookie: `studix_support_session=${token}` });
        requireSupportSession(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
      } finally {
        Date.now = originalNow;
      }
    });

    it('revokeSupportAccess (no nonce) revokes the current active session and logs it', async () => {
      await seedConfiguredInstallation();
      const admin = await seedAdminUser();
      const { challenge } = await requestSupportChallenge({ userId: null });
      const response = ownerSign(owner.privateKey, challenge);
      const { sessionId } = await redeemSupportChallenge({ challenge, response }, { userId: null });
      expect(getSupportAccessStatus().active).toBe(true);

      const result = await revokeSupportAccess({}, { userId: admin.id });
      expect(result.revokedSession).toBe(true);
      expect(getSupportAccessStatus().active).toBe(false);

      const logs = await client.activity_logs.findMany({ where: { module: 'support', action: 'support_access_revoked' } });
      expect(logs).toHaveLength(1);
      expect(logs[0].entity_id).toBe(sessionId);
      expect(logs[0].user_id).toBe(admin.id);
    });

    it('a revoked support session is rejected by requireSupportSession even though its token signature is still valid', async () => {
      await seedConfiguredInstallation();
      const { challenge } = await requestSupportChallenge({ userId: null });
      const response = ownerSign(owner.privateKey, challenge);
      const { token } = await redeemSupportChallenge({ challenge, response }, { userId: null });

      await revokeSupportAccess({}, { userId: null });

      expect(verifySupportSessionToken(token)).not.toBeNull(); // signature/shape still valid
      const { req, res, next } = mockReqRes({ cookie: `studix_support_session=${token}` });
      requireSupportSession(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    });

    it('revokeSupportAccess with no active session returns revokedSession:false, no log entry', async () => {
      await seedConfiguredInstallation();
      const result = await revokeSupportAccess({}, { userId: null });
      expect(result.revokedSession).toBe(false);
      const logs = await client.activity_logs.findMany({ where: { module: 'support', action: 'support_access_revoked' } });
      expect(logs).toHaveLength(0);
    });
  });

  describe('cross-domain isolation — support artifacts cannot be used as normal login sessions', () => {
    it('a support session token is rejected by verifySession (normal /api/session verifier)', async () => {
      await seedConfiguredInstallation();
      const { challenge } = await requestSupportChallenge({ userId: null });
      const response = ownerSign(owner.privateKey, challenge);
      const { token } = await redeemSupportChallenge({ challenge, response }, { userId: null });

      expect(verifySession(token)).toBeNull();
    });

    it('a normal login session token is rejected by requireSupportSession', () => {
      const normalToken = signSession({ id: 'admin1', role: 'admin', userAuthVersion: 1, roleAuthVersion: 1 });
      const { req, res, next } = mockReqRes({ cookie: `studix_support_session=${normalToken}` });
      requireSupportSession(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    });

    it('normal authentication is unaffected: a real admin session still verifies correctly', () => {
      const token = signSession({ id: 'admin1', role: 'admin', userAuthVersion: 1, roleAuthVersion: 1 });
      expect(verifySession(token)).toEqual({ id: 'admin1', role: 'admin', userAuthVersion: 1, roleAuthVersion: 1 });
    });
  });

  describe('authorization — only an authenticated local admin (requireRole(\'admin\'), the exact guard server.js mounts)', () => {
    it('a non-admin role is rejected with 403, next() never called', () => {
      const { req, res, next } = mockReqRes({ role: 'teacher' });
      requireRole('admin')(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });

    it('no session at all is rejected with 403', () => {
      const { req, res, next } = mockReqRes({});
      requireRole('admin')(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });

    it('an admin role passes through to next()', () => {
      const { req, res, next } = mockReqRes({ role: 'admin' });
      requireRole('admin')(req, res, next);
      expect(next).toHaveBeenCalledOnce();
    });
  });
});
