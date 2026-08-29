// backend/src/db/firstAdmin.integration.test.js
// INSTALL-04 — real scratch PostgreSQL database only (setupScratchDb/teardownScratchDb,
// unmodified), never the real studix database. Proves the actual transactional/advisory-lock
// safety contract that cannot be meaningfully verified with mocks: true concurrent requests
// racing a real advisory lock and a real transaction.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { ensureFirstAdmin, isSetupOpen, FirstAdminError, ALL_PERMISSION_PAGES } from './firstAdmin.js';
import { verifyPbkdf2, isPbkdf2Format } from '../lib/passwordVerify.js';

const dbCheck = await checkPostgresReachable();

describe('firstAdmin.js — real PostgreSQL integration (transaction/advisory-lock safety)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, scratchUrl;

  beforeAll(async () => {
    scratch = await setupScratchDb('first_admin');
    client = scratch.client;
    scratchUrl = scratch.scratchUrl;
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  beforeEach(async () => {
    await client.$executeRawUnsafe('DELETE FROM users');
    await client.$executeRawUnsafe('DELETE FROM roles');
  });

  describe('setup state (derived purely from users, no new table/column/flag)', () => {
    it('fresh database / zero users -> setup open', async () => {
      expect(await isSetupOpen(client)).toBe(true);
    });

    it('existing active admin -> setup closed', async () => {
      await client.users.create({ data: { id: 'admin', name: 'Admin', is_admin: true, active: true, permissions: ALL_PERMISSION_PAGES } });
      expect(await isSetupOpen(client)).toBe(false);
    });

    it('existing INACTIVE admin only -> setup remains open (invariant is active-admin count, not admin-row existence)', async () => {
      await client.users.create({ data: { id: 'admin', name: 'Admin', is_admin: true, active: false, permissions: ALL_PERMISSION_PAGES } });
      expect(await isSetupOpen(client)).toBe(true);
    });

    it('existing non-admin active user only -> setup remains open', async () => {
      await client.users.create({ data: { id: 'teacher1', name: 'Teacher', is_admin: false, active: true, permissions: ['dashboard'] } });
      expect(await isSetupOpen(client)).toBe(true);
    });

    it('"restart" (a fresh isSetupOpen call after the fact) does not change the state — purely derived, nothing cached', async () => {
      const before = await isSetupOpen(client);
      const after = await isSetupOpen(client);
      expect(before).toBe(after);
      await client.users.create({ data: { id: 'admin', name: 'Admin', is_admin: true, active: true, permissions: ALL_PERMISSION_PAGES } });
      expect(await isSetupOpen(client)).toBe(false);
    });
  });

  describe('first-admin creation — success path', () => {
    it('creates exactly one admin with is_admin/active true, hashed password, full permissions, no role_id', async () => {
      const created = await ensureFirstAdmin({
        id: 'admin', name: 'مدير النظام', password: 'correct-horse-battery-staple',
        prisma: client, databaseUrl: scratchUrl,
      });

      expect(created.id).toBe('admin');
      expect(created.is_admin).toBe(true);
      expect(created.active).toBe(true);

      const all = await client.users.findMany();
      expect(all).toHaveLength(1);

      const row = await client.users.findUnique({ where: { id: 'admin' } });
      expect(row.role_id).toBeNull();
      expect(Array.isArray(row.permissions)).toBe(true);
      expect(row.permissions.sort()).toEqual([...ALL_PERMISSION_PAGES].sort());
      expect(isPbkdf2Format(row.password_hash)).toBe(true);
      expect(row.password_hash).not.toContain('correct-horse-battery-staple');
      expect(verifyPbkdf2('correct-horse-battery-staple', row.password_hash)).toBe(true);
    });

    it('the created admin can immediately pass requirePermission for every page (no roles-table dependency)', async () => {
      await ensureFirstAdmin({ id: 'admin', name: 'Admin', password: 'correct-horse-battery-staple', prisma: client, databaseUrl: scratchUrl });

      // Zero rows in `roles` throughout this whole test — proves the fix doesn't depend on it.
      expect(await client.roles.count()).toBe(0);

      const { resolveEffectivePermissions } = await import('../middleware/permissions.js');
      const row = await client.users.findUnique({ where: { id: 'admin' } });
      const state = {
        userPermissions: row.permissions, roleFound: false, rolePermissions: null,
      };
      const effective = resolveEffectivePermissions(state);
      expect(effective).not.toBeNull();
      for (const page of ALL_PERMISSION_PAGES) expect(effective).toContain(page);
    });

    it('the returned object never contains the password or the hash', async () => {
      const created = await ensureFirstAdmin({ id: 'admin', name: 'Admin', password: 'correct-horse-battery-staple', prisma: client, databaseUrl: scratchUrl });
      expect(JSON.stringify(created)).not.toContain('correct-horse-battery-staple');
      expect(created).not.toHaveProperty('password_hash');
      expect(created).not.toHaveProperty('password');
    });
  });

  describe('closed setup — already an active admin', () => {
    it('rejects a second creation attempt with reason "already_initialized", creates nothing new', async () => {
      await ensureFirstAdmin({ id: 'admin', name: 'Admin', password: 'correct-horse-battery-staple', prisma: client, databaseUrl: scratchUrl });

      await expect(
        ensureFirstAdmin({ id: 'someone-else', name: 'Someone Else', password: 'another-strong-password', prisma: client, databaseUrl: scratchUrl })
      ).rejects.toMatchObject({ reason: 'already_initialized' });

      expect(await client.users.count()).toBe(1);
    });

    it('an inactive admin does NOT block a fresh creation (invariant is active-admin count)', async () => {
      await client.users.create({ data: { id: 'old-admin', name: 'Old', is_admin: true, active: false, permissions: ALL_PERMISSION_PAGES } });

      const created = await ensureFirstAdmin({ id: 'admin', name: 'Admin', password: 'correct-horse-battery-staple', prisma: client, databaseUrl: scratchUrl });
      expect(created.id).toBe('admin');
      expect(await client.users.count()).toBe(2); // the old inactive row is untouched, a new one created
    });
  });

  describe('duplicate id handling', () => {
    it('rejects creating a first admin whose chosen id is already taken by a non-admin user', async () => {
      await client.users.create({ data: { id: 'admin', name: 'Someone', is_admin: false, active: true, permissions: [] } });

      await expect(
        ensureFirstAdmin({ id: 'admin', name: 'New Admin', password: 'correct-horse-battery-staple', prisma: client, databaseUrl: scratchUrl })
      ).rejects.toMatchObject({ reason: 'id_taken' });

      expect(await client.users.count()).toBe(1); // untouched
    });
  });

  describe('race conditions — simultaneous first-admin attempts', () => {
    it('exactly one of many concurrent ensureFirstAdmin calls succeeds; the rest fail cleanly; exactly one admin exists', async () => {
      const attempts = Array.from({ length: 8 }, (_, i) =>
        ensureFirstAdmin({
          id: `admin-${i}`, name: `Admin ${i}`, password: `correct-horse-battery-staple-${i}`,
          prisma: client, databaseUrl: scratchUrl,
        }).then(
          (result) => ({ ok: true, result }),
          (err) => ({ ok: false, err })
        )
      );

      const outcomes = await Promise.all(attempts);
      const succeeded = outcomes.filter((o) => o.ok);
      const failed = outcomes.filter((o) => !o.ok);

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(7);
      for (const f of failed) {
        expect(f.err).toBeInstanceOf(FirstAdminError);
        expect(['already_initialized', 'setup_in_progress']).toContain(f.err.reason);
      }

      const finalUsers = await client.users.findMany({ where: { is_admin: true, active: true } });
      expect(finalUsers).toHaveLength(1);
      expect(finalUsers[0].id).toBe(succeeded[0].result.id);
    }, 30_000);

    it('no partial state survives a losing race: the loser\'s chosen id was never inserted', async () => {
      const [a, b] = await Promise.allSettled([
        ensureFirstAdmin({ id: 'winner-candidate', name: 'A', password: 'correct-horse-battery-staple', prisma: client, databaseUrl: scratchUrl }),
        ensureFirstAdmin({ id: 'loser-candidate', name: 'B', password: 'correct-horse-battery-staple', prisma: client, databaseUrl: scratchUrl }),
      ]);

      const results = [a, b];
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);

      const winnerId = fulfilled[0].value.id;
      const loserId = winnerId === 'winner-candidate' ? 'loser-candidate' : 'winner-candidate';
      expect(await client.users.findUnique({ where: { id: loserId } })).toBeNull();
      expect(await client.users.count()).toBe(1);
    }, 15_000);
  });

  describe('retry after a failed/losing attempt', () => {
    it('setup remains open and retryable when no admin was ever actually created', async () => {
      await expect(
        ensureFirstAdmin({ id: 'x', name: '', password: 'correct-horse-battery-staple', prisma: client, databaseUrl: scratchUrl })
      ).rejects.toThrow(FirstAdminError); // missing name -> nothing created

      expect(await isSetupOpen(client)).toBe(true);

      const created = await ensureFirstAdmin({ id: 'admin', name: 'Admin', password: 'correct-horse-battery-staple', prisma: client, databaseUrl: scratchUrl });
      expect(created.id).toBe('admin');
    });
  });
});
