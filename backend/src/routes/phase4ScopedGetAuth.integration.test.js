// backend/src/routes/phase4ScopedGetAuth.integration.test.js
// Scalability Architecture Phase 4 — authorization-boundary check for the two new scoped
// GET endpoints (GET /api/payments?studentId=..., GET /api/communications?studentId=...).
// Same technique as materialDistributionPaymentAuth.integration.test.js/
// cashboxBalanceAuth.integration.test.js: a real ephemeral-port Express app mounting the
// real middleware chain (requireAuth + requirePermission) exactly as server.js does,
// driven with real HTTP requests.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

function request(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* n/a */ }
        resolve({ status: res.statusCode, body: json });
      });
    }).on('error', reject);
  });
}

describe('Phase 4 scoped GET endpoints — authorization boundary (real Express + PostgreSQL)', () => {
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
    scratch = await setupScratchDb('phase4_scoped_get_auth');
    client = scratch.client;

    const { requirePermission } = await import('../middleware/permissions.js');
    const { errorHandler } = await import('../middleware/errorHandler.js');
    const paymentsRouter = (await import('./payments.js')).default;
    const communicationsRouter = (await import('./communications.js')).default;
    const activityLogsRouter = (await import('./activityLogs.js')).default;
    const admissionPaymentsRouter = (await import('./admissionPayments.js')).default;

    function stubAuth(req, res, next) {
      const raw = req.headers['x-test-user'];
      req.user = raw ? JSON.parse(raw) : undefined;
      next();
    }

    const app = express();
    app.use('/api/payments', stubAuth, requirePermission('payments'), paymentsRouter);
    app.use('/api/communications', stubAuth, requirePermission('students'), communicationsRouter);
    app.use('/api/activityLogs', stubAuth, requirePermission('activity-log'), activityLogsRouter);
    app.use('/api/admissionPayments', stubAuth, requirePermission('admissions'), admissionPaymentsRouter);
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

  it('GET /api/payments: a user WITH the payments permission succeeds', async () => {
    const user = await seedUser(nextId('u'), ['payments']);
    const res = await request(port, '/api/payments', { 'x-test-user': JSON.stringify(user) });
    expect(res.status).toBe(200);
  });

  it('GET /api/payments: a user WITHOUT the payments permission is rejected with 403', async () => {
    const user = await seedUser(nextId('u'), ['students']);
    const res = await request(port, '/api/payments', { 'x-test-user': JSON.stringify(user) });
    expect(res.status).toBe(403);
  });

  it('GET /api/payments: unauthenticated is rejected with 401', async () => {
    const res = await request(port, '/api/payments');
    expect(res.status).toBe(401);
  });

  it('GET /api/payments/search: a user WITH the payments permission succeeds', async () => {
    const user = await seedUser(nextId('u'), ['payments']);
    const res = await request(port, '/api/payments/search', { 'x-test-user': JSON.stringify(user) });
    expect(res.status).toBe(200);
  });

  it('GET /api/payments/search: a user WITHOUT the payments permission is rejected with 403', async () => {
    const user = await seedUser(nextId('u'), ['students']);
    const res = await request(port, '/api/payments/search', { 'x-test-user': JSON.stringify(user) });
    expect(res.status).toBe(403);
  });

  it('GET /api/payments/search: unauthenticated is rejected with 401', async () => {
    const res = await request(port, '/api/payments/search');
    expect(res.status).toBe(401);
  });

  it('GET /api/communications: a user WITH the students permission succeeds', async () => {
    const user = await seedUser(nextId('u'), ['students']);
    const res = await request(port, '/api/communications', { 'x-test-user': JSON.stringify(user) });
    expect(res.status).toBe(200);
  });

  it('GET /api/communications: a user WITHOUT the students permission is rejected with 403', async () => {
    const user = await seedUser(nextId('u'), ['payments']);
    const res = await request(port, '/api/communications', { 'x-test-user': JSON.stringify(user) });
    expect(res.status).toBe(403);
  });

  it('GET /api/communications: unauthenticated is rejected with 401', async () => {
    const res = await request(port, '/api/communications');
    expect(res.status).toBe(401);
  });

  it('GET /api/activityLogs: a user WITH the activity-log permission succeeds', async () => {
    const user = await seedUser(nextId('u'), ['activity-log']);
    const res = await request(port, '/api/activityLogs', { 'x-test-user': JSON.stringify(user) });
    expect(res.status).toBe(200);
  });

  it('GET /api/activityLogs: a user WITHOUT the activity-log permission is rejected with 403', async () => {
    const user = await seedUser(nextId('u'), ['students']);
    const res = await request(port, '/api/activityLogs', { 'x-test-user': JSON.stringify(user) });
    expect(res.status).toBe(403);
  });

  it('GET /api/activityLogs: unauthenticated is rejected with 401', async () => {
    const res = await request(port, '/api/activityLogs');
    expect(res.status).toBe(401);
  });

  it('GET /api/admissionPayments: a user WITH the admissions permission succeeds', async () => {
    const user = await seedUser(nextId('u'), ['admissions']);
    const res = await request(port, '/api/admissionPayments', { 'x-test-user': JSON.stringify(user) });
    expect(res.status).toBe(200);
  });

  it('GET /api/admissionPayments: a user WITHOUT the admissions permission is rejected with 403', async () => {
    const user = await seedUser(nextId('u'), ['students']);
    const res = await request(port, '/api/admissionPayments', { 'x-test-user': JSON.stringify(user) });
    expect(res.status).toBe(403);
  });

  it('GET /api/admissionPayments: unauthenticated is rejected with 401', async () => {
    const res = await request(port, '/api/admissionPayments');
    expect(res.status).toBe(401);
  });
});
