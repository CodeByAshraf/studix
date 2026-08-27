// backend/src/middleware/auth.integration.test.js
// BUG-03 fix verification — requireRole('admin') now consults the live auth state
// (authCache/Postgres) instead of trusting only the role frozen inside an already-issued
// session token, matching requirePermission's existing contract exactly. This is the sole
// guard on /api/support-access/* and /api/license/* (server.js) — the two most sensitive
// capability sets in the app — so a demoted/deactivated admin must lose access immediately,
// not merely after their token's natural 12-hour expiry.
//
// Real scratch database only (setupScratchDb/teardownScratchDb, unmodified) — never the
// real studix database. Mirrors the invalidation contract exactly as routes/users.js and
// routes/roles.js actually perform it (auth_version incremented + invalidateUser/
// invalidateRole called immediately after a successful commit) rather than inventing a
// different simulation of "stale".
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('requireRole — live auth-state check (real scratch database)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client;
  let requireRole;
  let invalidateUser, clearAuthCache;

  beforeAll(async () => {
    scratch = await setupScratchDb('auth_requirerole');
    client = scratch.client;
    ({ requireRole } = await import('./auth.js'));
    ({ invalidateUser, clearAll: clearAuthCache } = await import('../lib/authCache.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  beforeEach(async () => {
    clearAuthCache();
    await client.$executeRawUnsafe('DELETE FROM activity_logs'); // child of users (user_id FK)
    await client.$executeRawUnsafe('DELETE FROM users');
  });

  function mockReqRes(user) {
    const req = { user };
    const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    const next = vi.fn();
    return { req, res, next };
  }

  async function seedAdmin(id) {
    return client.users.create({ data: { id, name: 'Admin', is_admin: true, active: true, role_id: null } });
  }

  // The "session token claims" a real login (session.js's signSession) would have embedded
  // at the moment this admin logged in — captured once, then reused unchanged as later DB
  // state moves on, exactly simulating an already-issued, now possibly-stale cookie.
  function tokenClaimsFor(userRow) {
    return { id: userRow.id, role: 'admin', userAuthVersion: userRow.auth_version, roleAuthVersion: null };
  }

  it('1. Active admin -> allowed', async () => {
    const admin = await seedAdmin('scenario1-admin');
    const { req, res, next } = mockReqRes(tokenClaimsFor(admin));

    await requireRole('admin')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeNull();
  });

  it('2. Deactivated admin with an old session -> denied', async () => {
    const admin = await seedAdmin('scenario2-admin');
    const staleClaims = tokenClaimsFor(admin); // captured BEFORE deactivation

    // Exactly mirrors routes/users.js's real deactivation path: active=false,
    // auth_version incremented, cache invalidated immediately after commit.
    await client.users.update({ where: { id: admin.id }, data: { active: false, auth_version: { increment: 1 } } });
    invalidateUser(admin.id);

    const { req, res, next } = mockReqRes(staleClaims);
    await requireRole('admin')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('3. Admin whose role was changed (demoted) -> denied', async () => {
    const admin = await seedAdmin('scenario3-admin');
    const staleClaims = tokenClaimsFor(admin); // captured BEFORE demotion

    // Demoted to a non-admin — mirrors routes/users.js's real role-change path: auth_version
    // incremented, cache invalidated immediately after commit. Still active=true, so this is
    // a genuinely different transition from scenario 2 (deactivation), not a duplicate of it.
    await client.users.update({ where: { id: admin.id }, data: { is_admin: false, auth_version: { increment: 1 } } });
    invalidateUser(admin.id);

    const { req, res, next } = mockReqRes(staleClaims);
    await requireRole('admin')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    // version mismatch is caught before the role-string comparison, so this specific
    // rejection is a 401 ("re-login required"), not a 403 — same convention requirePermission
    // already uses for a stale token, distinguishing it from "authenticated but not allowed".
    expect(res.statusCode).toBe(401);
  });

  it('4. Unchanged valid admin session -> still allowed (no regression for the normal case)', async () => {
    const admin = await seedAdmin('scenario4-admin');
    const { req, res, next } = mockReqRes(tokenClaimsFor(admin));

    await requireRole('admin')(req, res, next);
    expect(next).toHaveBeenCalledOnce();

    // A second, later request with the exact same still-valid token behaves identically —
    // proves this isn't a one-shot fluke tied to cache-population order.
    const { req: req2, res: res2, next: next2 } = mockReqRes(tokenClaimsFor(admin));
    await requireRole('admin')(req2, res2, next2);
    expect(next2).toHaveBeenCalledOnce();
  });

  it('a non-admin role is still rejected with 403 when the session itself is otherwise perfectly live/valid', async () => {
    const teacher = await client.users.create({ data: { id: 'scenario-teacher', name: 'Teacher', is_admin: false, active: true, role_id: null } });
    const { req, res, next } = mockReqRes({ id: teacher.id, role: 'user', userAuthVersion: teacher.auth_version, roleAuthVersion: null });

    await requireRole('admin')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('a user id with no corresponding row at all (e.g. deleted account) is denied with 401, not a crash', async () => {
    const { req, res, next } = mockReqRes({ id: 'does-not-exist', role: 'admin', userAuthVersion: 1, roleAuthVersion: null });

    await requireRole('admin')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('no req.user at all is rejected with 403, same as before this fix (unchanged behavior)', async () => {
    const { req, res, next } = mockReqRes(null);
    await requireRole('admin')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});
