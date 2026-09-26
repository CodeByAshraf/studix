// backend/src/routes/dbSwitch.integration.test.js
// Phase 2C-3C Part 2 — real Postgres scratch database (setupScratchDb/teardownScratchDb,
// unmodified — see backend/src/test-helpers/scratchDb.js), never the real studix database.
// Dynamic import after injecting globalThis.prisma, exactly like license.integration.test.js's
// own convention.
//
// Authorization note (server.js): only requireAuth + requireRole('admin') gate
// /api/db-switch — pre-existing, unmodified middleware (auth.js), already proven correct in
// Phase 4b/auth.integration.test.js. This project's own established convention (see
// license.integration.test.js's own header) is to test requireRole directly against a mocked
// req/res, not spin up a real HTTP server (no supertest dependency anywhere in this codebase) —
// followed here unchanged.
//
// The spawned CLI itself is ALWAYS a fake/injected function in this file — no real
// databaseSwitch.js CLI process, no real Windows service, no real StudixApp, no real
// %ProgramData%\Studix is ever touched by anything in this file.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('routes/dbSwitch.js — real scratch database (auth wiring + activity-log proof, CLI always faked)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client;
  let requireRole;
  let triggerDatabaseSwitch;
  let clearAuthCache;

  beforeAll(async () => {
    scratch = await setupScratchDb('db_switch_route');
    client = scratch.client;
    ({ requireRole } = await import('../middleware/auth.js'));
    ({ triggerDatabaseSwitch } = await import('./dbSwitch.js'));
    ({ clearAll: clearAuthCache } = await import('../lib/authCache.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  beforeEach(async () => {
    clearAuthCache();
    await client.$executeRawUnsafe('DELETE FROM activity_logs');
    await client.$executeRawUnsafe('DELETE FROM users');
  });

  function mockReqRes(user) {
    const req = { user };
    const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    const next = vi.fn();
    return { req, res, next };
  }

  async function seedAdmin(id) {
    return client.users.create({ data: { id, name: 'مدير الاختبار', is_admin: true, active: true, role_id: null } });
  }

  async function seedNonAdmin(id) {
    return client.users.create({ data: { id, name: 'مستخدم عادي', is_admin: false, active: true, role_id: null } });
  }

  function tokenClaimsFor(userRow, role) {
    return { id: userRow.id, role, userAuthVersion: userRow.auth_version, roleAuthVersion: null };
  }

  function fakeSuccessfulSpawn() {
    return async () => ({ ok: true, code: 0, stdout: JSON.stringify({ ok: true, action: 'switch', status: 'active' }), stderr: '' });
  }

  describe('authentication / authorization — same guard already gating /api/license and /api/support-access', () => {
    it('1. an active admin session is allowed through requireRole(\'admin\')', async () => {
      const admin = await seedAdmin('dbswitch-admin-1');
      const { req, res, next } = mockReqRes(tokenClaimsFor(admin, 'admin'));

      await requireRole('admin')(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBeNull();
    });

    it('2. an unauthenticated request (no req.user at all) is rejected — never reaches the route logic', async () => {
      const { req, res, next } = mockReqRes(null);

      await requireRole('admin')(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });

    it('3. a non-admin, authenticated user is rejected — this route is admin-only, not requirePermission-delegable', async () => {
      const user = await seedNonAdmin('dbswitch-nonadmin-1');
      const { req, res, next } = mockReqRes(tokenClaimsFor(user, 'user'));

      await requireRole('admin')(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });

    it('4. a deactivated admin with an old (still technically valid) session is rejected — live state, not the stale token', async () => {
      const admin = await seedAdmin('dbswitch-admin-2');
      const staleClaims = tokenClaimsFor(admin, 'admin');
      await client.users.update({ where: { id: admin.id }, data: { active: false, auth_version: { increment: 1 } } });

      const { req, res, next } = mockReqRes(staleClaims);
      await requireRole('admin')(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    });
  });

  describe('activity logging — the real logDbSwitchEvent (real prisma.activity_logs)', () => {
    it('a successful trigger logs exactly a "triggered" then a "succeeded" event, module=db-switch, correct actor', async () => {
      const admin = await seedAdmin('dbswitch-admin-3');

      const result = await triggerDatabaseSwitch('switch', {
        userId: admin.id,
        spawnDbSwitchCliFn: fakeSuccessfulSpawn(),
        existsSyncFn: () => false,
      });

      expect(result).toEqual({ ok: true, action: 'switch', status: 'active' });

      const logs = await client.activity_logs.findMany({ where: { module: 'db-switch' }, orderBy: { timestamp: 'asc' } });
      expect(logs).toHaveLength(2);
      expect(logs[0].action).toBe('db_switch_triggered');
      expect(logs[1].action).toBe('db_switch_succeeded');
      for (const log of logs) {
        expect(log.user_id).toBe(admin.id);
        expect(log.user_name).toBe(admin.name);
      }
    });

    it('a failed trigger (CLI reports a real failure) logs "triggered" then "failed", never silently swallowed', async () => {
      const admin = await seedAdmin('dbswitch-admin-4');
      const failingSpawn = async () => ({
        ok: false, code: 1, stdout: '', stderr: '❌ [app_start_failed] فشل بدء التطبيق بعد التبديل.',
      });

      let caught;
      try {
        await triggerDatabaseSwitch('switch', {
          userId: admin.id, spawnDbSwitchCliFn: failingSpawn, existsSyncFn: () => false,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught.status).toBe(500);

      const logs = await client.activity_logs.findMany({ where: { module: 'db-switch' }, orderBy: { timestamp: 'asc' } });
      expect(logs.map((l) => l.action)).toEqual(['db_switch_triggered', 'db_switch_failed']);
    });

    it('an anonymous/system-attributed call (no userId) still logs, with a null actor rather than throwing', async () => {
      const result = await triggerDatabaseSwitch('rollback', {
        userId: null, spawnDbSwitchCliFn: fakeSuccessfulSpawn(), existsSyncFn: () => false,
      });
      expect(result.ok).toBe(true);
      const logs = await client.activity_logs.findMany({ where: { module: 'db-switch' } });
      expect(logs.every((l) => l.user_id === null)).toBe(true);
    });
  });

  describe('concurrency — real activity-log side effects confirm only ONE operation proceeds when the CLI itself enforces the lock', () => {
    it('16/17/18. a second trigger, racing while the (faked) CLI reports the lock already held, is rejected — no second operation is ever logged as succeeded', async () => {
      const admin = await seedAdmin('dbswitch-admin-5');

      const first = await triggerDatabaseSwitch('switch', {
        userId: admin.id, spawnDbSwitchCliFn: fakeSuccessfulSpawn(), existsSyncFn: () => false,
      });
      expect(first.ok).toBe(true);

      // A second, concurrent-style trigger — the pre-check now sees the lock file (simulated),
      // so it never even spawns a child, exactly mirroring what happens when the CLI's own
      // acquireRestoreLock() is genuinely held by a still-running first operation.
      const spawnDbSwitchCliFn = vi.fn();
      let caught;
      try {
        await triggerDatabaseSwitch('switch', {
          userId: admin.id, spawnDbSwitchCliFn, existsSyncFn: () => true,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught.status).toBe(409);
      expect(spawnDbSwitchCliFn).not.toHaveBeenCalled();

      // no second db_switch_succeeded was ever logged
      const successLogs = await client.activity_logs.findMany({ where: { module: 'db-switch', action: 'db_switch_succeeded' } });
      expect(successLogs).toHaveLength(1);
    });
  });
});
