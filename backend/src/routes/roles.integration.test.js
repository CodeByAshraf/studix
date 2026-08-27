// backend/src/routes/roles.integration.test.js
// Closes the highest-value remaining test-coverage gap identified by the final production
// readiness audit: roles.js has zero test coverage, despite being the exact mechanism
// BUG-03 (requireRole's live-state check) was fixed around, on the role side of the same
// contract users.integration.test.js proves for individual users. This file proves —
// against the REAL router (backend/src/routes/roles.js, invoked directly, no HTTP layer,
// same technique already used for crud.js in cryptoGlobalIndependence.integration.test.js)
// and the REAL requirePermission middleware — that every role mutation:
//   1. increments auth_version where required,
//   2. invalidates every cached user of that role immediately after commit,
//   3. causes the next authenticated request to observe the new live state,
//   4. prevents stale authorization after a role's permissions change.
//
// Real scratch database only (setupScratchDb/teardownScratchDb, unmodified) — never the
// real studix database. npm run test:integration only; a single clear "SKIPPED" test is
// recorded if PostgreSQL is unreachable.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('roles.js — real PostgreSQL integration (auth_version/authCache contract)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client;
  let rolesRouter;
  let requirePermission;
  let clearAuthCache;

  beforeAll(async () => {
    scratch = await setupScratchDb('roles_route');
    client = scratch.client;
    ({ default: rolesRouter } = await import('./roles.js'));
    ({ requirePermission } = await import('../middleware/permissions.js'));
    ({ clearAll: clearAuthCache } = await import('../lib/authCache.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  beforeEach(async () => {
    clearAuthCache();
    await client.$executeRawUnsafe('DELETE FROM users');
    await client.$executeRawUnsafe('DELETE FROM roles');
  });

  // Same router-invocation technique as cryptoGlobalIndependence.integration.test.js's
  // crud.js test and users.integration.test.js — the real Express Router, no HTTP server.
  function invoke(router, { method, url, body }) {
    const req = { method, url, body: body || {} };
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

  function tokenClaimsFor(userRow, roleRow) {
    return {
      id: userRow.id,
      role: userRow.role_id || 'user',
      userAuthVersion: userRow.auth_version,
      roleAuthVersion: roleRow.auth_version,
    };
  }

  async function seedRole(id, permissions, overrides = {}) {
    return client.roles.create({ data: { id, label: id, permissions, is_system: false, ...overrides } });
  }

  async function seedUser(id, roleId) {
    return client.users.create({ data: { id, name: id, is_admin: false, active: true, role_id: roleId } });
  }

  describe('permissions change', () => {
    it('increments the role\'s auth_version, invalidates every cached user of that role, and the new permissions apply on the next request — while a stale token is rejected outright', async () => {
      const role = await seedRole('teacher', ['students']);
      const user = await seedUser('u1', 'teacher');
      const staleClaims = tokenClaimsFor(user, role);

      // Sanity: role grants 'students', not 'payments', right now.
      const { req: reqBeforeAllowed, res: resBeforeAllowed } = mockReqRes(staleClaims);
      await requirePermission('students')(reqBeforeAllowed, resBeforeAllowed, () => {});
      expect(resBeforeAllowed.statusCode).toBeNull();

      const { req: reqBeforeDenied, res: resBeforeDenied } = mockReqRes(staleClaims);
      await requirePermission('payments')(reqBeforeDenied, resBeforeDenied, () => {});
      expect(resBeforeDenied.statusCode).toBe(403);

      const result = await invoke(rolesRouter, { method: 'PUT', url: '/teacher', body: { permissions: ['payments'] } });
      expect(result.statusCode).toBe(200);
      expect(result.body.role.permissions).toEqual(['payments']);

      const dbRole = await client.roles.findUnique({ where: { id: 'teacher' } });
      expect(dbRole.auth_version).toBe(role.auth_version + 1);

      // Stale token (still claims the pre-change role auth_version) is rejected outright —
      // never silently evaluated against the role's now-superseded permissions.
      const { req: reqStale, res: resStale } = mockReqRes(staleClaims);
      await requirePermission('payments')(reqStale, resStale, () => {});
      expect(resStale.statusCode).toBe(401);
      const { req: reqStaleOld, res: resStaleOld } = mockReqRes(staleClaims);
      await requirePermission('students')(reqStaleOld, resStaleOld, () => {});
      expect(resStaleOld.statusCode).toBe(401); // even the OLD, previously-granted permission — forced re-login, not partial trust

      // Fresh token (post-change claims) sees the new permissions immediately.
      const dbUser = await client.users.findUnique({ where: { id: user.id } });
      const freshClaims = tokenClaimsFor(dbUser, dbRole);
      const { req: reqAfterAllowed, res: resAfterAllowed } = mockReqRes(freshClaims);
      await requirePermission('payments')(reqAfterAllowed, resAfterAllowed, () => {});
      expect(resAfterAllowed.statusCode).toBeNull();
      const { req: reqAfterDenied, res: resAfterDenied } = mockReqRes(freshClaims);
      await requirePermission('students')(reqAfterDenied, resAfterDenied, () => {});
      expect(resAfterDenied.statusCode).toBe(403); // the OLD permission is genuinely gone, not just re-validated
    });

    it('a second, unrelated user on a DIFFERENT role is unaffected by another role\'s permissions change', async () => {
      const roleA = await seedRole('role-a', ['students']);
      const roleB = await seedRole('role-b', ['payments']);
      const userB = await seedUser('u-b', 'role-b');
      const claimsB = tokenClaimsFor(userB, roleB);

      await invoke(rolesRouter, { method: 'PUT', url: '/role-a', body: { permissions: ['treasury'] } });

      // userB's own role (role-b) was never touched — their still-fresh token keeps working.
      const { req, res } = mockReqRes(claimsB);
      await requirePermission('payments')(req, res, () => {});
      expect(res.statusCode).toBeNull();

      const dbRoleA = await client.roles.findUnique({ where: { id: roleA.id } });
      expect(dbRoleA.auth_version).toBe(roleA.auth_version + 1);
      const dbRoleB = await client.roles.findUnique({ where: { id: roleB.id } });
      expect(dbRoleB.auth_version).toBe(roleB.auth_version); // unchanged
    });
  });

  describe('non-permission field change (label only)', () => {
    it('STILL increments auth_version and forces re-login — the documented, deliberately conservative contract ("every supported role mutation", not just permission edits)', async () => {
      const role = await seedRole('coordinator', ['groups']);
      const user = await seedUser('u2', 'coordinator');
      const staleClaims = tokenClaimsFor(user, role);

      const { req: reqBefore, res: resBefore } = mockReqRes(staleClaims);
      await requirePermission('groups')(reqBefore, resBefore, () => {});
      expect(resBefore.statusCode).toBeNull();

      const result = await invoke(rolesRouter, { method: 'PUT', url: '/coordinator', body: { label: 'اسم جديد للدور' } });
      expect(result.statusCode).toBe(200);
      expect(result.body.role.label).toBe('اسم جديد للدور');
      expect(result.body.role.permissions).toEqual(['groups']); // permissions themselves untouched

      const dbRole = await client.roles.findUnique({ where: { id: 'coordinator' } });
      expect(dbRole.auth_version).toBe(role.auth_version + 1);

      // Even though permissions didn't semantically change, the stale token is still
      // rejected — matching the route's own documented "every mutation invalidates" intent.
      const { req: reqAfter, res: resAfter } = mockReqRes(staleClaims);
      await requirePermission('groups')(reqAfter, resAfter, () => {});
      expect(resAfter.statusCode).toBe(401);
    });
  });

  describe('role deletion', () => {
    it('deletes cleanly and invalidates the role cache when no user references it', async () => {
      await seedRole('unused-role', ['dashboard']);

      const result = await invoke(rolesRouter, { method: 'DELETE', url: '/unused-role' });
      expect(result.statusCode).toBe(200);
      expect(await client.roles.findUnique({ where: { id: 'unused-role' } })).toBeNull();
    });

    it('refuses to delete a system role', async () => {
      await seedRole('system-role', ['dashboard'], { is_system: true });

      const result = await invoke(rolesRouter, { method: 'DELETE', url: '/system-role' });
      expect(result.statusCode).toBe(409);
      expect(await client.roles.findUnique({ where: { id: 'system-role' } })).not.toBeNull();
    });

    it('refuses to delete a role still referenced by a user — the database FK rejects it, the role and the user\'s role_id both survive untouched', async () => {
      await seedRole('in-use-role', ['dashboard']);
      await seedUser('u3', 'in-use-role');

      // invoke() calls the router in isolation (no app-level errorHandler middleware
      // mounted, same as every other test in this file) — the raw Prisma FK error
      // (P2003, mapped to a clean 409 by errorHandler.js in the real running app) is what
      // reaches asyncHandler's next(err) here, which this helper surfaces as a rejection.
      let caught;
      try {
        await invoke(rolesRouter, { method: 'DELETE', url: '/in-use-role' });
      } catch (err) {
        caught = err;
      }
      expect(caught?.code).toBe('P2003');
      expect(await client.roles.findUnique({ where: { id: 'in-use-role' } })).not.toBeNull();
      expect((await client.users.findUnique({ where: { id: 'u3' } })).role_id).toBe('in-use-role');
    });
  });

  describe('role creation', () => {
    it('a newly created role starts at auth_version 1 and its permissions are usable immediately by a user assigned to it', async () => {
      const created = await invoke(rolesRouter, { method: 'POST', url: '/', body: { id: 'fresh_role', label: 'دور جديد', permissions: ['reports'] } });
      expect(created.statusCode).toBe(201);
      expect(created.body.role.authVersion).toBe(1);

      const user = await seedUser('u4', 'fresh_role');
      const role = await client.roles.findUnique({ where: { id: 'fresh_role' } });
      const claims = tokenClaimsFor(user, role);

      const { req, res } = mockReqRes(claims);
      await requirePermission('reports')(req, res, () => {});
      expect(res.statusCode).toBeNull();
    });
  });
});
