// backend/src/routes/cashboxOptions.integration.test.js
// M2/F1 — GET /api/cashboxes/options lets the payment roles pick a cashbox without Treasury
// access, while every payment route keeps its own authorization and cashbox validation, and
// Treasury's own /api/cashboxes stays 'treasury'-only. A real ephemeral-port Express app driven
// with real HTTP requests; each router is mounted with exactly the guards server.js gives it
// (the mount ORDER in server.js itself is pinned by crudPolicies.test.js's wiring checks).
// requireAuth (signed-cookie verification) is stubbed by a test header, as in the other
// *Auth.integration tests — every authorization decision under test is the real one.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

describe('GET /api/cashboxes/options — payment roles pick a cashbox without Treasury access (M2/F1, real Express + PostgreSQL)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, server, port, invalidateUser;
  let seq = 0;

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  beforeAll(async () => {
    scratch = await setupScratchDb('cashbox_options');
    client = scratch.client;

    const { requirePermission, requireAnyPermission } = await import('../middleware/permissions.js');
    const { errorHandler } = await import('../middleware/errorHandler.js');
    const { makeCrudRouter } = await import('./crud.js');
    const { CRUD_POLICIES } = await import('./crudPolicies.js');
    const cashboxOptionsModule = await import('./cashboxOptions.js');
    const cashboxBalanceRouter = (await import('./cashboxBalance.js')).default;
    const paymentsRouter = (await import('./payments.js')).default;
    const admissionPaymentsRouter = (await import('./admissionPayments.js')).default;
    const materialDistributionRouter = (await import('./materialDistribution.js')).default;
    ({ invalidateUser } = await import('../lib/authCache.js'));

    function stubAuth(req, res, next) {
      const raw = req.headers['x-test-user'];
      req.user = raw ? JSON.parse(raw) : undefined;
      next();
    }

    const app = express();
    app.use(express.json());
    // Same guards, same order as server.js: options first, then Treasury's own cashbox stack.
    app.use('/api/cashboxes/options', stubAuth,
      requireAnyPermission(...cashboxOptionsModule.CASHBOX_OPTION_PERMISSIONS), cashboxOptionsModule.default);
    app.use('/api/cashboxes', stubAuth, requirePermission('treasury'), (req, res, next) => {
      if (req.method === 'DELETE') return res.status(405).json({ ok: false, error: 'حذف الخزن غير متاح حالياً.' });
      next();
    });
    app.use('/api/cashboxes', stubAuth, requirePermission('treasury'), cashboxBalanceRouter);
    app.use('/api/cashboxes', stubAuth, requirePermission('treasury'),
      makeCrudRouter('cashboxes', { writable: true, preserveClientId: true, policy: CRUD_POLICIES.cashboxes }));
    app.use('/api/payments', stubAuth, requirePermission('payments'), paymentsRouter);
    app.use('/api/admissionPayments', stubAuth, requirePermission('admissions'), admissionPaymentsRouter);
    app.use('/api/material-distributions', stubAuth, requirePermission('materials'), materialDistributionRouter);
    app.use(errorHandler);

    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    port = server.address().port;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (scratch) await teardownScratchDb(scratch);
  });

  // Session claims exactly as requireAuth attaches them at login.
  async function seedUser(permissions) {
    const user = await client.users.create({ data: { id: nextId('u'), name: 'مستخدم اختبار', active: true, permissions } });
    return { id: user.id, userAuthVersion: user.auth_version, roleAuthVersion: null };
  }
  async function seedCashbox({ active = true } = {}) {
    return client.cashboxes.create({
      data: { id: nextId('cb'), name: 'خزنة اختبار', active, opening_balance: 750, notes: 'ملاحظة داخلية', type: 'main' },
    });
  }
  async function seedStudent() {
    const id = nextId('s');
    return client.students.create({ data: { id, code: id, name: 'أشرف', status: 'active' } });
  }
  async function seedAdmission() {
    const id = nextId('adm');
    return client.admissions.create({ data: { id, number: id, name: 'طالب قبول', stage: 'reserved' } });
  }
  async function seedMaterial() {
    return client.inv_materials.create({ data: { code: nextId('MAT'), name: 'مذكرة اختبار', price: 200 } });
  }
  async function optionsFor(user) {
    return request(port, 'GET', '/api/cashboxes/options', { user });
  }
  const key = () => globalThis.crypto.randomUUID();

  // ── 1–4: each payment-related permission alone may read the options ──
  it.each([['payments'], ['admissions'], ['materials'], ['treasury']])(
    'a user with only "%s" can GET the cashbox options (200)',
    async (permission) => {
      const cashbox = await seedCashbox();
      const res = await optionsFor(await seedUser([permission]));
      expect(res.status).toBe(200);
      expect(res.body.data.map((c) => c.id)).toContain(cashbox.id);
    },
  );

  // ── 5: none of them -> 403; the usual session checks still apply ──
  it('a user with none of payments/admissions/materials/treasury gets 403', async () => {
    const res = await optionsFor(await seedUser(['students', 'groups', 'reports']));
    expect(res.status).toBe(403);
  });

  it('unauthenticated -> 401; deactivated or stale session -> 401 (same checks as requirePermission)', async () => {
    expect((await request(port, 'GET', '/api/cashboxes/options')).status).toBe(401);

    const deactivated = await seedUser(['payments']);
    await client.users.update({ where: { id: deactivated.id }, data: { active: false } });
    invalidateUser(deactivated.id);
    expect((await optionsFor(deactivated)).status).toBe(401);

    const stale = await seedUser(['payments']);
    await client.users.update({ where: { id: stale.id }, data: { permissions: ['payments', 'groups'], auth_version: { increment: 1 } } });
    invalidateUser(stale.id);
    expect((await optionsFor(stale)).status).toBe(401);
  });

  // ── 6: only id/name/active ──
  it('the response carries ONLY id, name and active — no balance, opening balance, notes or other Treasury data', async () => {
    const cashbox = await seedCashbox();
    const res = await optionsFor(await seedUser(['payments']));
    const row = res.body.data.find((c) => c.id === cashbox.id);
    expect(row).toEqual({ id: cashbox.id, name: 'خزنة اختبار', active: true });
    for (const r of res.body.data) expect(Object.keys(r).sort()).toEqual(['active', 'id', 'name']);
  });

  // ── 7: inactive cashboxes ──
  it('an inactive cashbox is listed with active:false, and the server still refuses a payment into it', async () => {
    const inactive = await seedCashbox({ active: false });
    const user = await seedUser(['payments']);
    const row = (await optionsFor(user)).body.data.find((c) => c.id === inactive.id);
    expect(row).toEqual({ id: inactive.id, name: 'خزنة اختبار', active: false });

    const student = await seedStudent();
    const res = await request(port, 'POST', '/api/payments', {
      user,
      body: { studentId: student.id, cashboxId: inactive.id, month: 1, year: 2026, amount: 100, method: 'cash', payType: 'extra', date: '2026-01-05', clientRequestId: key() },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('الخزنة المحدَّدة غير موجودة أو غير نشطة.');
    expect(await client.payments.count({ where: { student_id: student.id } })).toBe(0);
  });

  // ── 8–10: each flow end-to-end with a cashbox taken from the options, no 'treasury' ──
  it('regular payment: a payments-only user picks a cashbox from the options and records the payment (201)', async () => {
    const cashbox = await seedCashbox();
    const user = await seedUser(['payments']);
    expect((await optionsFor(user)).body.data.some((c) => c.id === cashbox.id && c.active)).toBe(true);

    const student = await seedStudent();
    const res = await request(port, 'POST', '/api/payments', {
      user,
      body: { studentId: student.id, cashboxId: cashbox.id, month: 1, year: 2026, amount: 300, method: 'cash', payType: 'extra', date: '2026-01-05', clientRequestId: key() },
    });
    expect(res.status).toBe(201);
    expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(1);
  });

  it('admission deposit: an admissions-only user picks a cashbox from the options and records the deposit (201)', async () => {
    const cashbox = await seedCashbox();
    const user = await seedUser(['admissions']);
    expect((await optionsFor(user)).body.data.some((c) => c.id === cashbox.id && c.active)).toBe(true);

    const admission = await seedAdmission();
    const res = await request(port, 'POST', '/api/admissionPayments', {
      user,
      body: { admissionId: admission.id, type: 'deposit', amount: 200, method: 'cash', date: '2026-01-05', cashboxId: cashbox.id, clientRequestId: key() },
    });
    expect(res.status).toBe(201);
    expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(1);
  });

  it('material payment: materials + payments WITHOUT treasury picks a cashbox from the options and records it (201); materials-only is still 403 at the payment route (unchanged)', async () => {
    const cashbox = await seedCashbox();
    const materialsOnly = await seedUser(['materials']);
    expect((await optionsFor(materialsOnly)).status).toBe(200); // may see the picker…

    const student = await seedStudent();
    const material = await seedMaterial();
    const path = `/api/material-distributions/${material.id}/students/${student.id}/payment`;
    const body = () => ({ payStatus: 'paid', cashboxId: cashbox.id, date: '2026-01-05', clientRequestId: key() });

    const denied = await request(port, 'POST', path, { user: materialsOnly, body: body() });
    expect(denied.status).toBe(403); // …but recording money still needs 'payments'
    expect(await client.payments.count({ where: { student_id: student.id } })).toBe(0);

    const allowed = await request(port, 'POST', path, { user: await seedUser(['materials', 'payments']), body: body() });
    expect(allowed.status).toBe(201);
    expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(1);
  });

  // ── 11: Treasury's own cashbox authorization is unchanged ──
  it('Treasury cashbox management stays treasury-only: payment roles get 403 on /api/cashboxes (read, create, update, balance) and on non-GET /options', async () => {
    const cashbox = await seedCashbox();
    for (const permission of ['payments', 'admissions', 'materials']) {
      const user = await seedUser([permission]);
      const attempts = [
        ['GET', '/api/cashboxes', undefined],
        ['GET', `/api/cashboxes/${cashbox.id}`, undefined],
        ['GET', `/api/cashboxes/${cashbox.id}/balance`, undefined],
        ['POST', '/api/cashboxes', { id: nextId('cb'), name: 'خزنة جديدة' }],
        ['PUT', `/api/cashboxes/${cashbox.id}`, { name: 'تعديل' }],
        ['DELETE', `/api/cashboxes/${cashbox.id}`, undefined],
        ['POST', '/api/cashboxes/options', { name: 'x' }],
      ];
      for (const [method, urlPath, body] of attempts) {
        const res = await request(port, method, urlPath, { user, body });
        expect(res.status, `${permission}: ${method} ${urlPath}`).toBe(403);
      }
    }
    expect((await client.cashboxes.findUnique({ where: { id: cashbox.id } })).name).toBe('خزنة اختبار');

    const treasurer = await seedUser(['treasury']);
    const list = await request(port, 'GET', '/api/cashboxes', { user: treasurer });
    expect(list.status).toBe(200);
    expect(list.body.data.find((c) => c.id === cashbox.id).openingBalance).toBeDefined(); // full Treasury data
    expect((await request(port, 'DELETE', `/api/cashboxes/${cashbox.id}`, { user: treasurer })).status).toBe(405);
  });

  // ── 12: payment-route authorization is unchanged ──
  it('payment routes keep their own permissions: admissions-only cannot POST /api/payments; payments-only cannot POST /api/admissionPayments', async () => {
    const cashbox = await seedCashbox();
    const student = await seedStudent();
    const admission = await seedAdmission();

    const regular = await request(port, 'POST', '/api/payments', {
      user: await seedUser(['admissions']),
      body: { studentId: student.id, cashboxId: cashbox.id, month: 1, year: 2026, amount: 100, method: 'cash', payType: 'extra', date: '2026-01-05', clientRequestId: key() },
    });
    expect(regular.status).toBe(403);

    const deposit = await request(port, 'POST', '/api/admissionPayments', {
      user: await seedUser(['payments']),
      body: { admissionId: admission.id, type: 'deposit', amount: 100, method: 'cash', date: '2026-01-05', cashboxId: cashbox.id, clientRequestId: key() },
    });
    expect(deposit.status).toBe(403);
    expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(0);
  });
});
