// backend/src/middleware/permissions.integration.test.js
// Production blocker fix — requirePermission is async and calls getAuthState() (Postgres,
// via authCache.js) with no try/catch and without asyncHandler. Under Express 4.21 (this
// project's version), an async middleware's rejection is NOT auto-forwarded to the error
// handler — it becomes an unhandled promise rejection at the process level, which (now that
// backend/src/lib/shutdown.js's registerFatalErrorHandlers exists) triggers a full graceful
// shutdown of the entire backend for what should be a single recoverable request failure.
// Fixed by wrapping the returned middleware with the same asyncHandler already used by every
// route handler in this project (backend/src/middleware/errorHandler.js).
//
// Real scratch database only (setupScratchDb/teardownScratchDb, unmodified) — never the real
// studix database. Mirrors auth.integration.test.js's exact style (direct middleware call via
// a mockReqRes helper, no HTTP layer, no Prisma mocking) for consistency with that file's
// already-established convention for this exact class of middleware.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('requirePermission — success/denied/DB-error (real scratch database)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client;
  let requirePermission;

  beforeAll(async () => {
    scratch = await setupScratchDb('permissions_mw');
    client = scratch.client;
    ({ requirePermission } = await import('./permissions.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  beforeEach(async () => {
    await client.$executeRawUnsafe('DELETE FROM activity_logs'); // child of users (user_id FK)
    await client.$executeRawUnsafe('DELETE FROM users');
  });

  function mockReqRes(user) {
    const req = { user };
    const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    const next = vi.fn();
    return { req, res, next };
  }

  async function seedUser(id, overrides = {}) {
    return client.users.create({ data: { id, name: 'مستخدم اختبار', active: true, permissions: ['students'], ...overrides } });
  }

  function tokenClaimsFor(userRow) {
    return { id: userRow.id, userAuthVersion: userRow.auth_version, roleAuthVersion: null };
  }

  // A. success
  it('A: a user whose cached permissions include the required page -> next() called, no response written', async () => {
    const user = await seedUser('perm-a-user');
    const { req, res, next } = mockReqRes(tokenClaimsFor(user));

    await requirePermission('students')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(); // no error argument
    expect(res.statusCode).toBeNull();
  });

  // B. denied
  it('B: a user whose cached permissions do NOT include the required page -> 403, next() not called', async () => {
    const user = await seedUser('perm-b-user', { permissions: ['exams'] });
    const { req, res, next } = mockReqRes(tokenClaimsFor(user));

    await requirePermission('students')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  // C. unexpected DB/auth-cache error
  // Deterministic, no-mocking-Prisma reproduction of "getAuthState throws an unexpected
  // error" (same technique/rationale as payments.integration.test.js's crypto.randomUUID
  // spy elsewhere in this project — force a REAL Prisma error rather than fabricate one):
  // req.user.id of the wrong type makes prisma.users.findUnique's own argument validation
  // throw a real PrismaClientValidationError (confirmed empirically: no .code property,
  // exactly the same error shape an unclassified transient connection error would have).
  it('C: an unexpected auth-cache/database error is forwarded to next(err) — no unhandled rejection, no thrown exception, response untouched', async () => {
    const { req, res, next } = mockReqRes({ id: 12345, userAuthVersion: 1, roleAuthVersion: null });

    await expect(requirePermission('students')(req, res, next)).resolves.toBeUndefined();

    expect(next).toHaveBeenCalledOnce();
    const [err] = next.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    // must NOT look like a hand-authored badRequest (status+expose) or a mapped Prisma code —
    // this proves it falls through errorHandler.js's generic branch (safe 500, no leaked
    // internals in the HTTP response), not through some accidental 4xx classification.
    expect(err.status).toBeUndefined();
    expect(err.expose).toBeUndefined();
    expect(err.code).toBeUndefined();
    // res.status/res.json were never called directly by the middleware itself for this path —
    // it is errorHandler.js (untouched by this fix, already verified separately) that would
    // turn this into the actual HTTP response in a real running app.
    expect(res.statusCode).toBeNull();
  });
});
