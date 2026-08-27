// backend/src/routes/users.integration.test.js
// Closes the highest-value remaining test-coverage gap identified by the final production
// readiness audit: users.js has zero test coverage, despite being the exact mechanism
// BUG-03 (requireRole's live-state check) was fixed around. This file proves — against the
// REAL router (backend/src/routes/users.js, invoked directly, no HTTP layer, same technique
// already used for crud.js in cryptoGlobalIndependence.integration.test.js) and the REAL
// requireRole/requirePermission middlewares — that every auth-affecting user change:
//   1. increments auth_version where required,
//   2. invalidates the affected user's authCache entry immediately after commit,
//   3. causes the next authenticated request to observe the new live state,
//   4. prevents stale authorization after deactivation or role/permission changes.
//
// Real scratch database only (setupScratchDb/teardownScratchDb, unmodified) — never the
// real studix database. npm run test:integration only; a single clear "SKIPPED" test is
// recorded if PostgreSQL is unreachable.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('users.js — real PostgreSQL integration (auth_version/authCache contract)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client;
  let usersRouter;
  let requireRole, requirePermission;
  let getAuthState, clearAuthCache;

  beforeAll(async () => {
    scratch = await setupScratchDb('users_route');
    client = scratch.client;
    ({ default: usersRouter } = await import('./users.js'));
    ({ requireRole } = await import('../middleware/auth.js'));
    ({ requirePermission } = await import('../middleware/permissions.js'));
    ({ getAuthState, clearAll: clearAuthCache } = await import('../lib/authCache.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  beforeEach(async () => {
    clearAuthCache();
    await client.$executeRawUnsafe('DELETE FROM users');
    await client.$executeRawUnsafe('DELETE FROM roles');
  });

  // ── Router invocation helper — same technique as cryptoGlobalIndependence.integration.
  // test.js's crud.js test: the real Express Router, invoked directly, no HTTP server. ──
  function invoke(router, { method, url, body, user }) {
    const req = { method, url, body: body || {}, user };
    return new Promise((resolve, reject) => {
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; resolve({ statusCode: this.statusCode, body: b }); return this; },
      };
      router.handle(req, res, (err) => (err ? reject(err) : reject(new Error(`no route matched: ${method} ${url}`))));
    });
  }

  function mockReqRes(user) {
    const req = { user };
    const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    return { req, res };
  }

  // The exact claims a real login (session.js's signSession) would have embedded at the
  // moment this user logged in — captured once, then reused unchanged as later DB state
  // moves on, simulating an already-issued, now possibly-stale cookie.
  function tokenClaimsFor(userRow, roleRow = null) {
    return {
      id: userRow.id,
      role: userRow.is_admin ? 'admin' : (userRow.role_id || 'user'),
      userAuthVersion: userRow.auth_version,
      roleAuthVersion: roleRow ? roleRow.auth_version : null,
    };
  }

  async function seedRole(id, permissions) {
    return client.roles.create({ data: { id, label: id, permissions, is_system: false } });
  }

  async function seedUser(id, overrides = {}) {
    return client.users.create({ data: { id, name: id, is_admin: false, active: true, role_id: null, ...overrides } });
  }

  describe('deactivation (active: false)', () => {
    it('increments auth_version, invalidates the cache, and a request already in flight with the pre-deactivation token is rejected on the next check', async () => {
      const user = await seedUser('u-deact', { role_id: null, permissions: ['dashboard'] });
      const staleClaims = tokenClaimsFor(user);

      // Sanity: the pre-deactivation token is genuinely valid right now.
      const { req: req1, res: res1 } = mockReqRes(staleClaims);
      await requirePermission('dashboard')(req1, res1, () => {});
      expect(res1.statusCode).toBeNull(); // next() was called, no rejection status set

      const result = await invoke(usersRouter, { method: 'PUT', url: `/${user.id}`, body: { active: false } });
      expect(result.statusCode).toBe(200);
      expect(result.body.user.active).toBe(false);

      const dbUser = await client.users.findUnique({ where: { id: user.id } });
      expect(dbUser.auth_version).toBe(user.auth_version + 1);

      // The exact same claims that worked a moment ago are now rejected — the cache was
      // genuinely invalidated (not just eventually stale), and the live active=false state
      // is observed on the very next request.
      const { req: req2, res: res2 } = mockReqRes(staleClaims);
      await requirePermission('dashboard')(req2, res2, () => {});
      expect(res2.statusCode).toBe(401);
    });
  });

  describe('role change', () => {
    it('increments auth_version, invalidates the cache, and grants/revokes permissions on the very next request — while the stale token is rejected, not silently honored with old permissions', async () => {
      const roleA = await seedRole('role-a', ['students']);
      await seedRole('role-b', ['payments']);
      const user = await seedUser('u-role', { role_id: 'role-a' });
      const staleClaims = tokenClaimsFor(user, roleA);

      // Before: role-a grants 'students', not 'payments'.
      const { req: reqBeforeAllowed, res: resBeforeAllowed } = mockReqRes(staleClaims);
      await requirePermission('students')(reqBeforeAllowed, resBeforeAllowed, () => {});
      expect(resBeforeAllowed.statusCode).toBeNull();

      const { req: reqBeforeDenied, res: resBeforeDenied } = mockReqRes(staleClaims);
      await requirePermission('payments')(reqBeforeDenied, resBeforeDenied, () => {});
      expect(resBeforeDenied.statusCode).toBe(403);

      const result = await invoke(usersRouter, { method: 'PUT', url: `/${user.id}`, body: { roleId: 'role-b' } });
      expect(result.statusCode).toBe(200);

      const dbUser = await client.users.findUnique({ where: { id: user.id } });
      expect(dbUser.auth_version).toBe(user.auth_version + 1);
      expect(dbUser.role_id).toBe('role-b');

      // Stale token (still claims role-a's version) is rejected outright — forced re-login,
      // never silently evaluated against role-a's now-superseded permissions.
      const { req: reqStale, res: resStale } = mockReqRes(staleClaims);
      await requirePermission('payments')(reqStale, resStale, () => {});
      expect(resStale.statusCode).toBe(401);

      // Fresh token (post-change claims) sees the new role's permissions immediately.
      const freshRole = await client.roles.findUnique({ where: { id: 'role-b' } });
      const freshClaims = tokenClaimsFor(dbUser, freshRole);
      const { req: reqAfter, res: resAfter } = mockReqRes(freshClaims);
      await requirePermission('payments')(reqAfter, resAfter, () => {});
      expect(resAfter.statusCode).toBeNull();
    });
  });

  describe('per-user permissions override', () => {
    it('increments auth_version, invalidates the cache, and a personal override takes effect on the next request', async () => {
      const roleC = await seedRole('role-c', ['students']);
      const user = await seedUser('u-perm', { role_id: 'role-c' });
      const staleClaims = tokenClaimsFor(user, roleC);

      const { req: reqBefore, res: resBefore } = mockReqRes(staleClaims);
      await requirePermission('treasury')(reqBefore, resBefore, () => {});
      expect(resBefore.statusCode).toBe(403);

      const result = await invoke(usersRouter, { method: 'PUT', url: `/${user.id}`, body: { permissions: ['treasury'] } });
      expect(result.statusCode).toBe(200);

      const dbUser = await client.users.findUnique({ where: { id: user.id } });
      expect(dbUser.auth_version).toBe(user.auth_version + 1);
      expect(dbUser.permissions).toEqual(['treasury']);

      const { req: reqStale, res: resStale } = mockReqRes(staleClaims);
      await requirePermission('treasury')(reqStale, resStale, () => {});
      expect(resStale.statusCode).toBe(401);

      const role = await client.roles.findUnique({ where: { id: 'role-c' } });
      const freshClaims = tokenClaimsFor(dbUser, role);
      const { req: reqAfter, res: resAfter } = mockReqRes(freshClaims);
      await requirePermission('treasury')(reqAfter, resAfter, () => {});
      expect(resAfter.statusCode).toBeNull();
    });
  });

  describe('non-auth-affecting change (name only)', () => {
    it('does NOT increment auth_version, and an already-issued token remains valid — no unnecessary forced re-login', async () => {
      const user = await seedUser('u-name', { role_id: null, permissions: ['dashboard'] });
      const claims = tokenClaimsFor(user);

      const result = await invoke(usersRouter, { method: 'PUT', url: `/${user.id}`, body: { name: 'اسم جديد' } });
      expect(result.statusCode).toBe(200);
      expect(result.body.user.name).toBe('اسم جديد');

      const dbUser = await client.users.findUnique({ where: { id: user.id } });
      expect(dbUser.auth_version).toBe(user.auth_version); // unchanged

      // The same token issued before the (non-auth-affecting) update is still accepted.
      const { req, res } = mockReqRes(claims);
      await requirePermission('dashboard')(req, res, () => {});
      expect(res.statusCode).toBeNull();
    });

    it('setting roleId to the SAME value it already had is not treated as auth-affecting', async () => {
      await seedRole('role-same', ['dashboard']);
      const user = await seedUser('u-samerole', { role_id: 'role-same' });

      const result = await invoke(usersRouter, { method: 'PUT', url: `/${user.id}`, body: { roleId: 'role-same' } });
      expect(result.statusCode).toBe(200);

      const dbUser = await client.users.findUnique({ where: { id: user.id } });
      expect(dbUser.auth_version).toBe(user.auth_version);
    });
  });

  describe('user deletion', () => {
    it('invalidates the cache — a request with the deleted user\'s token is rejected as if the session no longer exists', async () => {
      // A second admin must remain, or the last-active-admin guard would reject the delete
      // for an unrelated reason (not what this test is about) — this user is deliberately
      // non-admin so that guard never engages.
      const user = await seedUser('u-del', { role_id: null, permissions: ['dashboard'] });
      const claims = tokenClaimsFor(user);

      // Prime the cache with a live lookup before deletion, exactly like a real request would.
      const primed = await getAuthState(user.id);
      expect(primed.active).toBe(true);

      const requester = await seedUser('u-del-admin', { is_admin: true, role_id: null });
      const result = await invoke(usersRouter, {
        method: 'DELETE', url: `/${user.id}`, user: { id: requester.id },
      });
      expect(result.statusCode).toBe(200);
      expect(await client.users.findUnique({ where: { id: user.id } })).toBeNull();

      const { req, res } = mockReqRes(claims);
      await requirePermission('dashboard')(req, res, () => {});
      expect(res.statusCode).toBe(401);
    });

    it('rejects an admin deleting their own account, unaffected by the auth-cache mechanism', async () => {
      const admin = await seedUser('u-self', { is_admin: true, role_id: null });
      const result = await invoke(usersRouter, {
        method: 'DELETE', url: `/${admin.id}`, user: { id: admin.id },
      });
      expect(result.statusCode).toBe(409);
      expect(await client.users.findUnique({ where: { id: admin.id } })).not.toBeNull();
    });
  });

  describe('requireRole observes the same live state as requirePermission (BUG-03 contract, exercised through a real route mutation this time)', () => {
    it('an admin demoted via PUT immediately loses requireRole(\'admin\') access, even with their old token', async () => {
      // The last-admin guard (users.js PUT) counts by role_id === 'admin' literally, not by
      // the is_admin boolean — a real 'admin' roles row (same shape scripts/adminCreate.js
      // itself creates admins with) is required for both users, or the guard would block
      // this demotion for an unrelated reason (leaving the system with zero role_id='admin'
      // users), not what this test is about.
      const adminRole = await seedRole('admin', []);
      const admin = await seedUser('u-admin-demote', { is_admin: true, role_id: 'admin' });
      await seedUser('u-admin-other', { is_admin: true, role_id: 'admin' }); // keeps the last-admin guard satisfied
      const staleClaims = tokenClaimsFor(admin, adminRole);

      const { req: reqBefore, res: resBefore } = mockReqRes(staleClaims);
      await requireRole('admin')(reqBefore, resBefore, () => {});
      expect(resBefore.statusCode).toBeNull();

      const result = await invoke(usersRouter, { method: 'PUT', url: `/${admin.id}`, body: { roleId: null } });
      expect(result.statusCode).toBe(200);

      const { req: reqAfter, res: resAfter } = mockReqRes(staleClaims);
      await requireRole('admin')(reqAfter, resAfter, () => {});
      expect(resAfter.statusCode).toBe(401);
    });
  });
});
