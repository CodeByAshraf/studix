// backend/src/routes/cashboxBalanceAuth.integration.test.js
// Scalability Architecture Phase 3 (Treasury Safety Gate) — authorization-boundary check
// for GET /api/cashboxes/:cashboxId/balance. Same technique as
// materialDistributionPaymentAuth.integration.test.js: a real ephemeral-port Express app
// mounting the real middleware chain (requireAuth + requirePermission('treasury')) exactly
// as server.js does, driven with real HTTP requests (Node's built-in http.request — no
// supertest dependency in this project).
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

function request(port, { method = 'GET', path = '/', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method, headers },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch { /* no/invalid body */ }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('GET /cashboxes/:id/balance — authorization boundary (real Express + PostgreSQL)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, server, port;
  let seq = 0;

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  beforeAll(async () => {
    scratch = await setupScratchDb('cashbox_balance_auth');
    client = scratch.client;

    const { requirePermission } = await import('../middleware/permissions.js');
    const { errorHandler } = await import('../middleware/errorHandler.js');
    const cashboxBalanceRouter = (await import('./cashboxBalance.js')).default;

    const app = express();
    app.use(express.json());
    // requireAuth stub: hands req.user directly from a test-only header (same rationale
    // as materialDistributionPaymentAuth.integration.test.js) — this test's job is
    // requirePermission('treasury') wiring, not session-cookie verification (covered
    // separately by middleware/auth.integration.test.js).
    app.use('/api/cashboxes', (req, res, next) => {
      const raw = req.headers['x-test-user'];
      req.user = raw ? JSON.parse(raw) : undefined;
      next();
    }, requirePermission('treasury'), cashboxBalanceRouter);
    // نفس errorHandler.js الحقيقي المُستخدَم في server.js — بلا هذا، أخطاء badRequest()
    // (400) تصل لمعالج Express الافتراضي (صفحة HTML، لا JSON)، فيفشل JSON.parse صامتاً.
    app.use(errorHandler);

    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    port = server.address().port;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (scratch) await teardownScratchDb(scratch);
  });

  async function seedUser(id, permissions) {
    const user = await client.users.create({ data: { id, name: 'مستخدم اختبار', active: true, permissions } });
    return { id: user.id, userAuthVersion: user.auth_version, roleAuthVersion: null };
  }

  async function seedCashbox() {
    const id = nextId('cb');
    return client.cashboxes.create({ data: { id, name: 'خزنة اختبار', active: true, opening_balance: 500 } });
  }

  it('an authenticated user WITH the treasury permission gets a 200 with the correct balance', async () => {
    const cashbox = await seedCashbox();
    const user = await seedUser(nextId('u'), ['treasury']);

    const res = await request(port, {
      path: `/api/cashboxes/${cashbox.id}/balance`,
      headers: { 'x-test-user': JSON.stringify(user) },
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.balance).toBe(500);
  });

  it('an authenticated user WITHOUT the treasury permission is rejected with 403', async () => {
    const cashbox = await seedCashbox();
    const user = await seedUser(nextId('u'), ['students']); // any permission except treasury

    const res = await request(port, {
      path: `/api/cashboxes/${cashbox.id}/balance`,
      headers: { 'x-test-user': JSON.stringify(user) },
    });

    expect(res.status).toBe(403);
  });

  it('an unauthenticated request (no req.user at all) is rejected with 401', async () => {
    const cashbox = await seedCashbox();

    const res = await request(port, { path: `/api/cashboxes/${cashbox.id}/balance` });

    expect(res.status).toBe(401);
  });

  it('an invalid cashboxId returns a clear 400, not a raw 500', async () => {
    const user = await seedUser(nextId('u'), ['treasury']);

    const res = await request(port, {
      path: `/api/cashboxes/nonexistent-cashbox/balance`,
      headers: { 'x-test-user': JSON.stringify(user) },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('الخزنة غير موجودة');
  });

  it('an invalid asOf query param returns a clear 400, not a raw 500', async () => {
    const cashbox = await seedCashbox();
    const user = await seedUser(nextId('u'), ['treasury']);

    const res = await request(port, {
      path: `/api/cashboxes/${cashbox.id}/balance?asOf=not-a-date`,
      headers: { 'x-test-user': JSON.stringify(user) },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('asOf');
  });
});
