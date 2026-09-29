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

  it('3+4. the last active admin cannot be deactivated or deleted by another user holding users', async () => {
    await seedOwner();
    await seedRole('staff', ['users']);
    await seedUser('mgr', { role_id: 'staff' });

    const deact = await request(port, 'PUT', '/api/users/owner', { user: await claims('mgr'), body: { active: false } });
    expect(deact.status).toBe(409);
    const demote = await request(port, 'PUT', '/api/users/owner', { user: await claims('mgr'), body: { roleId: 'staff' } });
    expect(demote.status).toBe(409);
    const del = await request(port, 'DELETE', '/api/users/owner', { user: await claims('mgr') });
    expect(del.status).toBe(409);

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
    await seedRole('staff', ['users']);
    await seedUser('mgr', { role_id: 'staff' });
    const mgr = await claims('mgr');
    const [a, b] = await Promise.all([
      request(port, 'PUT', '/api/users/adminA', { user: mgr, body: { active: false } }),
      request(port, 'PUT', '/api/users/adminB', { user: mgr, body: { active: false } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
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

    // the owner is now the last active admin: demoting them is refused
    const last = await request(port, 'PUT', '/api/users/owner', { user: await claims('admin2'), body: { roleId: 'staff' } });
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
});
