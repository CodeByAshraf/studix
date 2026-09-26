// backend/src/routes/materialDistributionPaymentAuth.integration.test.js
// Focused authorization-boundary check for POST /api/material-distributions/:materialId/
// students/:studentId/payment — this route creates a real cashbox transaction, so it must
// require BOTH the router-level 'materials' permission (server.js mounts the whole router
// behind requirePermission('materials')) AND its own extra requirePermission('payments')
// (materialDistribution.js), so a "materials"-only account cannot bypass the financial
// permission gate through delivery-tracking. materialDistributionPayment.integration.test.js
// covers the transaction logic itself via direct function calls (no HTTP/auth layer); this
// file is the one place that exercises the real Express middleware chain and route order,
// same technique as setup.integration.test.js (real ephemeral-port server, Node's built-in
// http.request — no supertest dependency in this project).
//
// requireAuth (session-cookie verification) is deliberately stubbed here with a trivial
// middleware that copies a test-only header into req.user — that responsibility is already
// covered by middleware/auth.integration.test.js. What this file verifies is specifically
// requirePermission('materials') + requirePermission('payments') stacking/order on the real
// router, which is the actual risk this endpoint introduced.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

function request(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
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
    if (payload) req.write(payload);
    req.end();
  });
}

describe('POST /material-distributions/:materialId/students/:studentId/payment — authorization boundary (real Express + PostgreSQL)', () => {
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
    scratch = await setupScratchDb('material_distribution_payment_auth');
    client = scratch.client;

    const { requirePermission } = await import('../middleware/permissions.js');
    const materialDistributionRouter = (await import('./materialDistribution.js')).default;

    const app = express();
    app.use(express.json());
    // Stub for requireAuth: real server.js reads req.user from a verified session token;
    // here a test-only header hands the same shape directly, so the real requirePermission
    // stack (the thing under test) runs unmodified — same rationale as the file header.
    app.use('/api/material-distributions', (req, res, next) => {
      const raw = req.headers['x-test-user'];
      req.user = raw ? JSON.parse(raw) : undefined;
      next();
    }, requirePermission('materials'), materialDistributionRouter);

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
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

  async function seedStudent() {
    const id = nextId('s');
    return client.students.create({ data: { id, code: id, name: 'أشرف', status: 'active' } });
  }

  async function seedMaterial() {
    const code = nextId('MAT');
    return client.inv_materials.create({ data: { code, name: 'مذكرة اختبار', price: 200 } });
  }

  async function seedCashbox() {
    const id = nextId('cb');
    return client.cashboxes.create({ data: { id, name: 'خزنة اختبار', active: true, opening_balance: 0 } });
  }

  it('a user with "materials" permission but WITHOUT "payments" is rejected with 403, and no payment/treasury row is created', async () => {
    const student = await seedStudent();
    const material = await seedMaterial();
    const cashbox = await seedCashbox();
    const user = await seedUser(nextId('u'), ['materials']); // materials only — no payments

    const res = await request(port, {
      method: 'POST',
      path: `/api/material-distributions/${material.id}/students/${student.id}/payment`,
      headers: { 'x-test-user': JSON.stringify(user) },
      body: { payStatus: 'paid', cashboxId: cashbox.id, date: '2026-01-05' },
    });

    expect(res.status).toBe(403);
    expect(await client.payments.count({ where: { student_id: student.id } })).toBe(0);
    expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(0);
  });

  it('a user with only "payments" (no "materials") never even reaches this route — rejected at the router-level guard', async () => {
    const student = await seedStudent();
    const material = await seedMaterial();
    const cashbox = await seedCashbox();
    const user = await seedUser(nextId('u'), ['payments']); // payments only — no materials

    const res = await request(port, {
      method: 'POST',
      path: `/api/material-distributions/${material.id}/students/${student.id}/payment`,
      headers: { 'x-test-user': JSON.stringify(user) },
      body: { payStatus: 'paid', cashboxId: cashbox.id, date: '2026-01-05' },
    });

    expect(res.status).toBe(403);
    expect(await client.payments.count({ where: { student_id: student.id } })).toBe(0);
  });

  it('a user with BOTH "materials" and "payments" succeeds end-to-end through the real route', async () => {
    const student = await seedStudent();
    const material = await seedMaterial();
    const cashbox = await seedCashbox();
    const user = await seedUser(nextId('u'), ['materials', 'payments']);

    // P2-2 — the route requires an idempotency key; without it nothing is created.
    const path = `/api/material-distributions/${material.id}/students/${student.id}/payment`;
    const headers = { 'x-test-user': JSON.stringify(user) };
    const missingKey = await request(port, { method: 'POST', path, headers, body: { payStatus: 'paid', cashboxId: cashbox.id, date: '2026-01-05' } });
    expect(missingKey.status).toBe(400);
    expect(await client.payments.count({ where: { student_id: student.id } })).toBe(0);

    const res = await request(port, {
      method: 'POST',
      path,
      headers,
      body: { payStatus: 'paid', cashboxId: cashbox.id, date: '2026-01-05', clientRequestId: globalThis.crypto.randomUUID() },
    });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(Number(res.body.data.payment.amount)).toBe(200);
    expect(await client.payments.count({ where: { student_id: student.id } })).toBe(1);
    expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(1);
  });

  it('an unauthenticated request (no req.user at all) is rejected with 401 before any permission check', async () => {
    const student = await seedStudent();
    const material = await seedMaterial();
    const cashbox = await seedCashbox();

    const res = await request(port, {
      method: 'POST',
      path: `/api/material-distributions/${material.id}/students/${student.id}/payment`,
      body: { payStatus: 'paid', cashboxId: cashbox.id, date: '2026-01-05' },
    });

    expect(res.status).toBe(401);
  });
});
