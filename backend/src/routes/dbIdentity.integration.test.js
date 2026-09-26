// backend/src/routes/dbIdentity.integration.test.js
// Phase 2C-3C Part 3 — real Postgres scratch database (setupScratchDb/teardownScratchDb,
// unmodified), used ONLY to exercise requireRole('admin')'s real live-state check (same
// established convention as dbSwitch.integration.test.js/license.integration.test.js — no
// supertest dependency anywhere in this codebase). The identity resolver itself never touches
// PostgreSQL at all (a plain file read under a temp directory here, never
// %ProgramData%\Studix) — this file's own database access is entirely about proving the AUTH
// GUARD, not the identity logic (already fully covered by dbIdentity.test.js).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('routes/dbIdentity.js — real scratch database (auth wiring), identity resolution against a disposable file only', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client;
  let requireRole;
  let getDatabaseIdentitySafe;
  let readActiveDatabaseIdentity;
  let clearAuthCache;

  beforeAll(async () => {
    scratch = await setupScratchDb('db_identity_route');
    client = scratch.client;
    ({ requireRole } = await import('../middleware/auth.js'));
    ({ getDatabaseIdentitySafe } = await import('./dbIdentity.js'));
    ({ readActiveDatabaseIdentity } = await import('../db/databaseIdentity.js'));
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

  describe('authentication / authorization — same guard already gating /api/license, /api/support-access, /api/db-switch', () => {
    it('1. an active admin session is allowed through requireRole(\'admin\')', async () => {
      const admin = await seedAdmin('dbidentity-admin-1');
      const { req, res, next } = mockReqRes(tokenClaimsFor(admin, 'admin'));

      await requireRole('admin')(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBeNull();
    });

    it('2. an unauthenticated request (no req.user at all) is rejected', async () => {
      const { req, res, next } = mockReqRes(null);

      await requireRole('admin')(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });

    it('3. a non-admin, authenticated user is rejected (this project\'s existing convention — role !== \'admin\' literal)', async () => {
      const user = await seedNonAdmin('dbidentity-nonadmin-1');
      const { req, res, next } = mockReqRes(tokenClaimsFor(user, 'user'));

      await requireRole('admin')(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });

    it('a deactivated admin with an old (still technically valid) session is rejected — live state, not the stale token', async () => {
      const admin = await seedAdmin('dbidentity-admin-2');
      const staleClaims = tokenClaimsFor(admin, 'admin');
      await client.users.update({ where: { id: admin.id }, data: { active: false, auth_version: { increment: 1 } } });

      const { req, res, next } = mockReqRes(staleClaims);
      await requireRole('admin')(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    });
  });

  describe('identity resolution — real file, real temp directory (never %ProgramData%\\Studix)', () => {
    function mkIdentityPath() {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-dbidentity-route-test-'));
      const p = path.join(tmpDir, 'db-identity.json');
      expect(p.toLowerCase()).not.toContain('programdata\\studix');
      return p;
    }

    it('4. a real, disposable identity file produces exactly {id, createdAt} through the route\'s own core function', () => {
      const configPath = mkIdentityPath();
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({ id: 'real-disposable-id', role: 'active', createdAt: '2026-02-01T00:00:00.000Z' }));

      const result = getDatabaseIdentitySafe({
        readActiveDatabaseIdentityFn: () => readActiveDatabaseIdentity({ configPath }),
      });
      expect(result).toEqual({ id: 'real-disposable-id', createdAt: '2026-02-01T00:00:00.000Z' });
    });

    it('7. a genuinely corrupt real identity file on disk produces a safe failure, not a crash or a leaked path', () => {
      const configPath = mkIdentityPath();
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, 'not valid json {{{');

      let caught;
      try {
        getDatabaseIdentitySafe({ readActiveDatabaseIdentityFn: () => readActiveDatabaseIdentity({ configPath }) });
      } catch (err) {
        caught = err;
      }
      expect(caught.status).toBe(500);
      expect(caught.message).not.toContain(configPath);
    });
  });
});
