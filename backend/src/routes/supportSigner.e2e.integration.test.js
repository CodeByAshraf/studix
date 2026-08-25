// backend/src/routes/supportSigner.e2e.integration.test.js
// Phase 4d — true end-to-end proof: challenge → offline signer → verify → support session,
// using the REAL backend functions (requestSupportChallenge/redeemSupportChallenge from
// routes/supportAccess.js, unmodified) against a real scratch database (setupScratchDb,
// unmodified) — studix الحقيقية لا تُلمَس بأي خطوة هنا. The "signer" step imports
// tools/lib/challengeSigning.js directly (relative path out of backend/ into tools/) — the
// exact same offline tool an owner would run, not a re-implementation of it.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { signChallenge } from '../../../tools/lib/challengeSigning.js';

const dbCheck = await checkPostgresReachable();

function makeOwnerKeyPair() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('Support Signer — end-to-end (real scratch database)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let owner;
  let requestSupportChallenge, redeemSupportChallenge, getSupportAccessStatus;
  let clearAll;

  beforeAll(async () => {
    scratch = await setupScratchDb('supportsigner_e2e');
    owner = makeOwnerKeyPair();
    ({ requestSupportChallenge, redeemSupportChallenge, getSupportAccessStatus } = await import('./supportAccess.js'));
    ({ clearAll } = await import('../lib/supportAccessCache.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  beforeEach(async () => {
    clearAll();
    await scratch.client.$executeRawUnsafe('DELETE FROM support_access_config');
    await scratch.client.$executeRawUnsafe('DELETE FROM activity_logs');
    await scratch.client.support_access_config.create({ data: { id: 1, support_public_key: owner.publicKey } });
  });

  it('challenge → offline signer → verify → active support session, start to finish', async () => {
    // 1) the customer's app generates a challenge (real backend function)
    const { challenge } = await requestSupportChallenge({ userId: null });
    expect(typeof challenge).toBe('string');

    // 2) the owner, offline, signs it with tools/lib/challengeSigning.js — the exact same
    //    module the real tools/support-signer.js CLI uses
    const { response } = signChallenge(challenge, owner.privateKey);
    expect(typeof response).toBe('string');

    // 3) the customer pastes the response back — real backend verify/grant function
    const result = await redeemSupportChallenge({ challenge, response }, { userId: null });
    expect(typeof result.sessionId).toBe('string');
    expect(result.expiresAt).toBeGreaterThan(Date.now());

    // 4) a real, active support session now exists
    const status = getSupportAccessStatus();
    expect(status.active).toBe(true);
    expect(status.session.id).toBe(result.sessionId);
  });

  it('a response signed with the wrong (non-owner) key is rejected end-to-end', async () => {
    const impostor = makeOwnerKeyPair();
    const { challenge } = await requestSupportChallenge({ userId: null });
    const { response } = signChallenge(challenge, impostor.privateKey);

    await expect(redeemSupportChallenge({ challenge, response }, { userId: null }))
      .rejects.toMatchObject({ status: 401 });
    expect(getSupportAccessStatus().active).toBe(false);
  });

  it('signing the same challenge twice and redeeming both end-to-end grants exactly one session', async () => {
    const { challenge } = await requestSupportChallenge({ userId: null });
    const { response } = signChallenge(challenge, owner.privateKey);

    const first = await redeemSupportChallenge({ challenge, response }, { userId: null });
    expect(first.sessionId).toBeTruthy();

    await expect(redeemSupportChallenge({ challenge, response }, { userId: null }))
      .rejects.toMatchObject({ status: 401 });
  });
});
