// backend/src/routes/adminProtection.integration.test.js
// Pre-installer security review — findings 1 (BLOCKER) and 2 (HIGH):
//   1. the last active administrator (is_admin AND active — the setup-created owner has
//      role_id = null) can never be deactivated or deleted, an admin can never deactivate or
//      delete themselves, and so /api/setup never reopens while an admin exists;
//   2. the reserved 'admin' role (assigning it sets is_admin) can only be created, managed or
//      assigned by an active real administrator — never through the 'users' permission alone.
// Real PostgreSQL + Express with the chains server.js mounts (requireAuth stand-in +
// requirePermission('users') for /api/users and /api/roles; the real /api/setup router),
// driven with real HTTP.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED" test is
// recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

function request(port, method, urlPath, { user, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (user) headers['x-test-user'] = JSON.stringify(user);
    if (payload) headers['content-type'] = 'application/json';
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* n/a */ }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('administrator protection + reserved admin role (security review, real Express + PostgreSQL)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, server, port, clearAuthCache, invalidateUser;

  beforeAll(async () => {
    scratch = await setupScratchDb('admin_protection');
    client = scratch.client;

    const { requirePermission } = await import('../middleware/permissions.js');
    const { errorHandler } = await import('../middleware/errorHandler.js');
    const usersRouter = (await import('./users.js')).default;
    const rolesRouter = (await import('./roles.js')).default;
    const setupRouter = (await import('./setup.js')).default;
    ({ clearAll: clearAuthCache, invalidateUser } = await import('../lib/authCache.js'));

    function stubAuth(req, res, next) {
      const raw = req.headers['x-test-user'];
      req.user = raw ? JSON.parse(raw) : undefined;
      next();
    }

    const app = express();
    app.use(express.json());
    app.use('/api/setup', setupRouter);
    app.use('/api/users', stubAuth, requirePermission('users'), usersRouter);
    app.use('/api/roles', stubAuth, requirePermission('users'), rolesRouter);
    app.use(errorHandler);

    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    port = server.address().port;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (scratch) await teardownScratchDb(scratch);
  });

  beforeEach(async () => {
    clearAuthCache();
    await client.$executeRawUnsafe('DELETE FROM users');
    await client.$executeRawUnsafe('DELETE FROM roles');
  });

  // Seeds mirroring real rows: the setup-created owner (is_admin, role_id NULL, explicit
  // permissions — db/firstAdmin.js), and staff on a role holding only 'users'.
  const seedOwner = (id = 'owner') => client.users.create({
    data: { id, name: id, is_admin: true, active: true, role_id: null, permissions: ['users', 'dashboard'] },
  });
  const seedRole = (id, permissions) => client.roles.create({ data: { id, label: id, permissions } });
  const seedUser = (id, extra = {}) => client.users.create({ data: { id, name: id, is_admin: false, active: true, role_id: null, ...extra } });

  // Session claims exactly as a real login would have embedded them now.
  async function claims(id) {
    const u = await client.users.findUnique({ where: { id } });
    const r = u.role_id ? await client.roles.findUnique({ where: { id: u.role_id } }) : null;
    return { id, userAuthVersion: u.auth_version, roleAuthVersion: r ? r.auth_version : null };
  }
  const user = (id) => client.users.findUnique({ where: { id } });
  const setupOpen = async () => (await request(port, 'GET', '/api/setup/status')).body.open;

  // ═══ Finding 1 — last active administrator ═══
  it('1. an admin (the setup owner, role_id NULL) cannot deactivate themselves', async () => {
    await seedOwner();
    const res = await request(port, 'PUT', '/api/users/owner', { user: await claims('owner'), body: { name: 'owner', email: '', active: false } });
    expect(res.status).toBe(409);
    expect((await user('owner')).active).toBe(true);
    expect(await setupOpen()).toBe(false);
  });

  it('1b. …even when another active admin exists (self-deactivation is refused, not just the last one)', async () => {
    await seedOwner();
    await seedOwner('admin2');
    const res = await request(port, 'PUT', '/api/users/owner', { user: await claims('owner'), body: { active: false } });
    expect(res.status).toBe(409);
    expect((await user('owner')).active).toBe(true);
  });

  it('2. an admin cannot delete themselves', async () => {
    await seedOwner();
    await seedOwner('admin2');
    const res = await request(port, 'DELETE', '/api/users/owner', { user: await claims('owner') });
    expect(res.status).toBe(409);
    expect(await user('owner')).not.toBeNull();
  });

  it('3+4. the last active admin cannot be deactivated, demoted or deleted by another user holding users', async () => {
    await seedOwner();
    await seedRole('staff', ['users']);
    await seedUser('mgr', { role_id: 'staff' });

    // a non-admin is refused outright (403): administrator accounts are admin-only
    const deact = await request(port, 'PUT', '/api/users/owner', { user: await claims('mgr'), body: { active: false } });
    expect(deact.status).toBe(403);
    const demote = await request(port, 'PUT', '/api/users/owner', { user: await claims('mgr'), body: { roleId: 'staff' } });
    expect(demote.status).toBe(403);
    const del = await request(port, 'DELETE', '/api/users/owner', { user: await claims('mgr') });
    expect(del.status).toBe(403);
    // the owner demoting themselves as the last active admin still hits the last-admin guard
    const selfDemote = await request(port, 'PUT', '/api/users/owner', { user: await claims('owner'), body: { roleId: 'staff' } });
    expect(selfDemote.status).toBe(409);

    const owner = await user('owner');
    expect(owner.active).toBe(true);
    expect(owner.is_admin).toBe(true);
    expect(await setupOpen()).toBe(false);
  });

  it('5. with two active admins, one can deactivate and then delete the other — the remaining admin stays active', async () => {
    await seedOwner();
    await seedOwner('admin2');
    const deact = await request(port, 'PUT', '/api/users/admin2', { user: await claims('owner'), body: { active: false } });
    expect(deact.status).toBe(200);
    expect((await user('admin2')).active).toBe(false);

    const del = await request(port, 'DELETE', '/api/users/admin2', { user: await claims('owner') });
    expect(del.status).toBe(200);
    expect(await user('admin2')).toBeNull();

    const owner = await user('owner');
    expect(owner.active && owner.is_admin).toBe(true);
    expect(await setupOpen()).toBe(false);
  });

  it('5b. two concurrent deactivations of the only two admins never leave zero active admins', async () => {
    await seedOwner('adminA');
    await seedOwner('adminB');
    // each admin deactivates the other at the same time
    const [a, b] = await Promise.all([
      request(port, 'PUT', '/api/users/adminA', { user: await claims('adminB'), body: { active: false } }),
      request(port, 'PUT', '/api/users/adminB', { user: await claims('adminA'), body: { active: false } }),
    ]);
    // the loser is refused either by the last-admin guard (409) or, if its requester was
    // already deactivated by the winner, by the session check (401) — never both succeed
    const [first, second] = [a.status, b.status].sort();
    expect(first).toBe(200);
    expect([401, 409]).toContain(second);
    expect(await client.users.count({ where: { is_admin: true, active: true } })).toBe(1);
    expect(await setupOpen()).toBe(false);
  });

  it('6. /api/setup stays closed (status and an unauthenticated POST) while an active admin exists', async () => {
    await seedOwner();
    expect(await setupOpen()).toBe(false);
    const post = await request(port, 'POST', '/api/setup', { body: { id: 'intruder', name: 'x', password: 'secret123', confirmPassword: 'secret123' } });
    expect(post.status).toBe(404);
    expect(await user('intruder')).toBeNull();
  });

  it('7. normal (non-admin) user deactivation, reactivation and deletion are unchanged', async () => {
    await seedOwner();
    await seedRole('staff', ['users']);
    await seedUser('mgr', { role_id: 'staff' });
    await seedUser('clerk', { permissions: ['students'] });

    expect((await request(port, 'PUT', '/api/users/clerk', { user: await claims('mgr'), body: { active: false } })).status).toBe(200);
    expect((await user('clerk')).active).toBe(false);
    expect((await request(port, 'PUT', '/api/users/clerk', { user: await claims('mgr'), body: { active: true } })).status).toBe(200);
    expect((await request(port, 'DELETE', '/api/users/clerk', { user: await claims('owner') })).status).toBe(200);
    expect(await user('clerk')).toBeNull();
    // a non-admin editing or deactivating their own account is unchanged (the new rule is admin-only)
    expect((await request(port, 'PUT', '/api/users/mgr', { user: await claims('mgr'), body: { name: 'mgr2' } })).status).toBe(200);
    expect((await request(port, 'PUT', '/api/users/mgr', { user: await claims('mgr'), body: { active: false } })).status).toBe(200);
    expect((await user('mgr')).active).toBe(false);
  });

  // ═══ Finding 2 — reserved admin role ═══
  it('8. a non-admin with users cannot create, edit or delete the role "admin"', async () => {
    await seedOwner();
    await seedRole('staff', ['users']);
    await seedUser('mgr', { role_id: 'staff' });
    const mgr = await claims('mgr');

    const create = await request(port, 'POST', '/api/roles', { user: mgr, body: { id: 'admin', label: 'x', permissions: [] } });
    expect(create.status).toBe(403);
    expect(await client.roles.findUnique({ where: { id: 'admin' } })).toBeNull();

    await seedRole('admin', []); // an existing admin role (e.g. created by a real admin)
    expect((await request(port, 'PUT', '/api/roles/admin', { user: mgr, body: { label: 'y', permissions: ['users'] } })).status).toBe(403);
    expect((await request(port, 'DELETE', '/api/roles/admin', { user: mgr })).status).toBe(403);
    expect((await client.roles.findUnique({ where: { id: 'admin' } })).label).toBe('admin');
  });

  it('9+10. a non-admin with users cannot assign "admin" to themselves, to another user, or to a new user', async () => {
    await seedOwner();
    await seedRole('admin', []);
    await seedRole('staff', ['users']);
    await seedUser('mgr', { role_id: 'staff' });
    await seedUser('clerk');
    const mgr = await claims('mgr');

    expect((await request(port, 'PUT', '/api/users/mgr', { user: mgr, body: { roleId: 'admin' } })).status).toBe(403);
    expect((await request(port, 'PUT', '/api/users/clerk', { user: mgr, body: { roleId: 'admin' } })).status).toBe(403);
    expect((await request(port, 'POST', '/api/users', { user: mgr, body: { id: 'newbie', name: 'n', password: 'secret123', roleId: 'admin' } })).status).toBe(403);

    expect((await user('mgr')).is_admin).toBe(false);
    expect((await user('clerk')).is_admin).toBe(false);
    expect(await user('newbie')).toBeNull();
  });

  it('11. an active real admin can still create the admin role and assign it (existing capability)', async () => {
    await seedOwner();
    const owner = await claims('owner');
    expect((await request(port, 'POST', '/api/roles', { user: owner, body: { id: 'admin', label: 'مدير', permissions: [] } })).status).toBe(201);
    await seedUser('clerk');
    expect((await request(port, 'PUT', '/api/users/clerk', { user: owner, body: { roleId: 'admin' } })).status).toBe(200);
    expect((await user('clerk')).is_admin).toBe(true);
    expect((await request(port, 'POST', '/api/users', { user: owner, body: { id: 'second', name: 's', password: 'secret123', roleId: 'admin' } })).status).toBe(201);
    expect((await user('second')).is_admin).toBe(true);
    expect((await request(port, 'PUT', '/api/roles/admin', { user: owner, body: { label: 'مدير النظام' } })).status).toBe(200);
  });

  it('12. normal non-admin role creation, editing and assignment by a users-holder still work', async () => {
    await seedOwner();
    await seedRole('staff', ['users']);
    await seedUser('mgr', { role_id: 'staff' });
    await seedUser('clerk');
    const mgr = await claims('mgr');

    expect((await request(port, 'POST', '/api/roles', { user: mgr, body: { id: 'cashier', label: 'كاشير', permissions: ['payments'] } })).status).toBe(201);
    expect((await request(port, 'PUT', '/api/roles/cashier', { user: mgr, body: { permissions: ['payments', 'students'] } })).status).toBe(200);
    expect((await request(port, 'PUT', '/api/users/clerk', { user: mgr, body: { roleId: 'cashier' } })).status).toBe(200);
    expect((await user('clerk')).role_id).toBe('cashier');
    expect((await request(port, 'POST', '/api/users', { user: mgr, body: { id: 'c2', name: 'c2', password: 'secret123', roleId: 'cashier' } })).status).toBe(201);
    expect((await request(port, 'DELETE', '/api/roles/cashier', { user: mgr })).status).toBe(409); // still referenced (FK), unchanged
  });

  // ═══ Session behavior unchanged ═══
  it('stale or deactivated sessions stay rejected (401), and an admin whose token predates a change is not trusted', async () => {
    await seedOwner();
    await seedOwner('admin2');
    await seedRole('staff', ['users']);
    await seedUser('mgr', { role_id: 'staff' });

    const staleMgr = await claims('mgr');
    await client.users.update({ where: { id: 'mgr' }, data: { auth_version: { increment: 1 } } });
    invalidateUser('mgr');
    expect((await request(port, 'GET', '/api/users', { user: staleMgr })).status).toBe(401);

    const admin2 = await claims('admin2');
    expect((await request(port, 'PUT', '/api/users/admin2', { user: await claims('owner'), body: { active: false } })).status).toBe(200);
    // the deactivated admin2's session no longer counts as an admin requester
    expect((await request(port, 'POST', '/api/roles', { user: admin2, body: { id: 'admin', label: 'x' } })).status).toBe(401);
    expect((await request(port, 'GET', '/api/users', {})).status).toBe(401);
  });

  // ═══ Profile edits never demote an administrator ═══
  it.each([[''], [null]])('another admin editing the owner\'s profile with roleId %j keeps is_admin (no role change, no forced re-login)', async (emptyRoleId) => {
    await seedOwner();
    await seedOwner('admin2');
    const before = await user('owner');

    const res = await request(port, 'PUT', '/api/users/owner', {
      user: await claims('admin2'),
      body: { name: 'المالك الجديد', email: 'owner@example.com', active: true, roleId: emptyRoleId },
    });
    expect(res.status).toBe(200);

    const after = await user('owner');
    expect(after.is_admin).toBe(true);
    expect(after.role_id).toBeNull();
    expect(after.name).toBe('المالك الجديد');
    expect(after.auth_version).toBe(before.auth_version); // not treated as an auth-affecting change
  });

  it('an empty roleId never demotes an admin who has the admin role either', async () => {
    await seedOwner();
    await seedRole('admin', []);
    await client.users.create({ data: { id: 'roleAdmin', name: 'r', is_admin: true, active: true, role_id: 'admin' } });
    const res = await request(port, 'PUT', '/api/users/roleAdmin', { user: await claims('owner'), body: { name: 'r2', roleId: '' } });
    expect(res.status).toBe(200);
    const after = await user('roleAdmin');
    expect(after.is_admin).toBe(true);
    expect(after.role_id).toBe('admin');
  });

  it('intentional demotion (an explicit non-admin roleId) still works, and still obeys the last-active-admin guard', async () => {
    await seedOwner();
    await seedOwner('admin2');
    await seedRole('staff', ['users']);

    // two active admins: demoting one to a normal role is allowed
    const demote = await request(port, 'PUT', '/api/users/admin2', { user: await claims('owner'), body: { roleId: 'staff' } });
    expect(demote.status).toBe(200);
    const admin2 = await user('admin2');
    expect(admin2.is_admin).toBe(false);
    expect(admin2.role_id).toBe('staff');

    // the owner is now the last active admin: demoting them is refused — by the demoted admin2
    // (no longer an admin: 403) and by the owner themselves (last-admin guard: 409)
    const byFormerAdmin = await request(port, 'PUT', '/api/users/owner', { user: await claims('admin2'), body: { roleId: 'staff' } });
    expect(byFormerAdmin.status).toBe(403);
    const last = await request(port, 'PUT', '/api/users/owner', { user: await claims('owner'), body: { roleId: 'staff' } });
    expect(last.status).toBe(409);
    expect((await user('owner')).is_admin).toBe(true);
  });

  it('non-admin users: role assignment, and clearing the role with an empty roleId, work exactly as before', async () => {
    await seedOwner();
    await seedRole('cashier', ['payments']);
    await seedUser('clerk');
    const owner = await claims('owner');

    expect((await request(port, 'PUT', '/api/users/clerk', { user: owner, body: { roleId: 'cashier' } })).status).toBe(200);
    expect((await user('clerk')).role_id).toBe('cashier');
    expect((await request(port, 'PUT', '/api/users/clerk', { user: owner, body: { name: 'clerk2', roleId: '' } })).status).toBe(200);
    const clerk = await user('clerk');
    expect(clerk.role_id).toBeNull();
    expect(clerk.is_admin).toBe(false);
    expect(clerk.name).toBe('clerk2');
  });

  // ═══ Final audit HIGH 1 — administrator accounts are admin-only ═══
  describe('a non-admin users-holder cannot modify or delete an administrator account', () => {
    let mgr;
    beforeEach(async () => {
      await seedOwner();
      await seedOwner('admin2');
      await seedRole('staff', ['users']);
      await seedUser('mgr', { role_id: 'staff' });
      mgr = await claims('mgr');
    });

    it('1. password: 403, and the owner\'s password hash is unchanged', async () => {
      const before = await user('owner');
      const res = await request(port, 'PUT', '/api/users/owner', { user: mgr, body: { password: 'attacker-pw' } });
      expect(res.status).toBe(403);
      expect((await user('owner')).password_hash).toBe(before.password_hash);
    });

    it('2. permissions: 403, the owner keeps their permissions', async () => {
      const res = await request(port, 'PUT', '/api/users/owner', { user: mgr, body: { permissions: ['dashboard'] } });
      expect(res.status).toBe(403);
      expect((await user('owner')).permissions).toEqual(['users', 'dashboard']);
    });

    it('3. active status: cannot deactivate an active admin or reactivate an inactive one (403)', async () => {
      expect((await request(port, 'PUT', '/api/users/admin2', { user: mgr, body: { active: false } })).status).toBe(403);
      expect((await user('admin2')).active).toBe(true);

      await client.users.create({ data: { id: 'oldAdmin', name: 'o', is_admin: true, active: false, permissions: ['users'] } });
      const res = await request(port, 'PUT', '/api/users/oldAdmin', { user: mgr, body: { active: true, password: 'x-1234567' } });
      expect(res.status).toBe(403);
      expect((await user('oldAdmin')).active).toBe(false);
    });

    it('4. role: cannot demote an admin (403), even with another active admin remaining', async () => {
      expect((await request(port, 'PUT', '/api/users/admin2', { user: mgr, body: { roleId: 'staff' } })).status).toBe(403);
      const admin2 = await user('admin2');
      expect(admin2.is_admin).toBe(true);
      expect(admin2.role_id).toBeNull();
    });

    it('5. delete: cannot delete an active or an inactive admin (403)', async () => {
      expect((await request(port, 'DELETE', '/api/users/admin2', { user: mgr })).status).toBe(403);
      expect(await user('admin2')).not.toBeNull();
      await client.users.create({ data: { id: 'oldAdmin', name: 'o', is_admin: true, active: false } });
      expect((await request(port, 'DELETE', '/api/users/oldAdmin', { user: mgr })).status).toBe(403);
      expect(await user('oldAdmin')).not.toBeNull();
    });

    it('6. an active admin can still manage another admin (password, permissions, demote, delete)', async () => {
      const { verifyPbkdf2 } = await import('../lib/passwordVerify.js');
      const owner = await claims('owner');
      expect((await request(port, 'PUT', '/api/users/admin2', { user: owner, body: { password: 'new-pass-123' } })).status).toBe(200);
      expect(verifyPbkdf2('new-pass-123', (await user('admin2')).password_hash)).toBe(true);
      expect((await request(port, 'PUT', '/api/users/admin2', { user: owner, body: { permissions: ['dashboard'] } })).status).toBe(200);
      expect((await user('admin2')).permissions).toEqual(['dashboard']);
      expect((await request(port, 'PUT', '/api/users/admin2', { user: owner, body: { roleId: 'staff' } })).status).toBe(200);
      expect((await user('admin2')).is_admin).toBe(false);
      expect((await request(port, 'DELETE', '/api/users/admin2', { user: owner })).status).toBe(200);
      expect(await user('admin2')).toBeNull();
      expect(await setupOpen()).toBe(false);
    });

    it('9. normal non-admin permission editing by the users-holder is unchanged', async () => {
      await seedUser('clerk', { permissions: ['students'] });
      expect((await request(port, 'PUT', '/api/users/clerk', { user: mgr, body: { permissions: ['students', 'payments'] } })).status).toBe(200);
      expect((await user('clerk')).permissions).toEqual(['students', 'payments']);
      expect((await request(port, 'PUT', '/api/users/clerk', { user: await claims('mgr'), body: { permissions: [] } })).status).toBe(200);
      expect((await user('clerk')).permissions).toBeNull();
    });
  });

  // ═══ Final audit MEDIUM 2 — the last admin keeps user management ═══
  describe('the last active administrator cannot strip their own users-management access', () => {
    it.each([[[]], [['dashboard']], [null]])('8. owner as the only admin: PUT self {permissions: %j} → 409, permissions unchanged', async (permissions) => {
      await seedOwner();
      const res = await request(port, 'PUT', '/api/users/owner', { user: await claims('owner'), body: { permissions } });
      expect(res.status).toBe(409);
      expect((await user('owner')).permissions).toEqual(['users', 'dashboard']);
      // the owner's session still works for user management
      expect((await request(port, 'GET', '/api/users', { user: await claims('owner') })).status).toBe(200);
    });

    it('another active admin who lacks users does not count; one who has users does', async () => {
      await seedOwner();
      await client.users.create({ data: { id: 'viewer', name: 'v', is_admin: true, active: true, permissions: ['dashboard'] } });
      expect((await request(port, 'PUT', '/api/users/owner', { user: await claims('owner'), body: { permissions: ['dashboard'] } })).status).toBe(409);

      await seedOwner('admin2');
      expect((await request(port, 'PUT', '/api/users/owner', { user: await claims('owner'), body: { permissions: ['dashboard'] } })).status).toBe(200);
      expect((await user('owner')).permissions).toEqual(['dashboard']);
      expect((await user('owner')).is_admin).toBe(true);
    });

    it('an admin can still change their own permissions while keeping users', async () => {
      await seedOwner();
      const res = await request(port, 'PUT', '/api/users/owner', { user: await claims('owner'), body: { permissions: ['users', 'payments'] } });
      expect(res.status).toBe(200);
      expect((await user('owner')).permissions).toEqual(['users', 'payments']);
    });
  });

  // ═══ Final audit LOW 4 — a password change ends earlier sessions ═══
  describe('password changes invalidate previously issued sessions', () => {
    it('10+11. the change succeeds, bumps auth_version, and the old session gets 401', async () => {
      const { verifyPbkdf2 } = await import('../lib/passwordVerify.js');
      await seedOwner();
      await seedRole('staff', ['users']);
      await seedUser('mgr', { role_id: 'staff' });
      const oldMgr = await claims('mgr');
      const before = await user('mgr');

      const res = await request(port, 'PUT', '/api/users/mgr', { user: await claims('owner'), body: { password: 'fresh-pass-1' } });
      expect(res.status).toBe(200);
      const after = await user('mgr');
      expect(verifyPbkdf2('fresh-pass-1', after.password_hash)).toBe(true);
      expect(after.auth_version).toBe(before.auth_version + 1);

      expect((await request(port, 'GET', '/api/users', { user: oldMgr })).status).toBe(401);
      // a session issued after the change (a fresh login) works
      expect((await request(port, 'GET', '/api/users', { user: await claims('mgr') })).status).toBe(200);
    });

    it('an administrator changing their own password also ends their older sessions', async () => {
      await seedOwner();
      const oldOwner = await claims('owner');
      expect((await request(port, 'PUT', '/api/users/owner', { user: oldOwner, body: { password: 'fresh-pass-1' } })).status).toBe(200);
      expect((await request(port, 'GET', '/api/users', { user: oldOwner })).status).toBe(401);
    });

    it('a profile edit without a password does not bump auth_version (no forced re-login)', async () => {
      await seedOwner();
      await seedUser('clerk');
      const oldClerk = await claims('clerk');
      expect((await request(port, 'PUT', '/api/users/clerk', { user: await claims('owner'), body: { name: 'c2', email: 'c@x.com', password: '' } })).status).toBe(200);
      expect((await user('clerk')).auth_version).toBe(oldClerk.userAuthVersion);
    });
  });
});
