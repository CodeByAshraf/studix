// backend/src/routes/setupDefaultCashbox.integration.test.js
// M1 — the default cashbox (cb_main) must exist in Postgres right after first-run setup, so the
// very first regular/admission/material payment succeeds without TreasuryPage ever having been
// opened. Real scratch PostgreSQL database only (setupScratchDb/teardownScratchDb), never the
// real studix database. Drives the real POST /api/setup over HTTP (same pattern as
// setup.integration.test.js), then calls the real, unmodified payment functions with cb_main.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

function request(port, { method = 'GET', path = '/', body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1', port, path, method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
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

describe('first-run setup initializes the default cashbox (M1) — real PostgreSQL + real HTTP', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, server, port, savedPort;
  let createPayment, createAdmissionPayment, confirmMaterialPayment;
  let seq = 0;
  const nextId = (prefix) => `${prefix}_${++seq}_${Date.now()}`;

  const runSetup = () => request(port, {
    method: 'POST', path: '/api/setup',
    body: { id: 'admin', name: 'مدير النظام', password: 'correct-horse-battery-staple' },
  });

  beforeAll(async () => {
    scratch = await setupScratchDb('setup_default_cashbox');
    client = scratch.client;
    savedPort = process.env.PORT;

    const { default: setupRouter } = await import('./setup.js');
    const { makeCrudRouter } = await import('./crud.js');
    const { CRUD_POLICIES } = await import('./crudPolicies.js');
    const { errorHandler } = await import('../middleware/errorHandler.js');
    ({ createPayment } = await import('./payments.js'));
    ({ createAdmissionPayment } = await import('./admissionPayments.js'));
    ({ confirmMaterialPayment } = await import('./materialDistribution.js'));

    const app = express();
    app.use(express.json());
    app.use('/api/setup', setupRouter);
    // Same flags server.js mounts /api/cashboxes with — the endpoint TreasuryPage's
    // background cb_main sync POSTs to.
    app.use('/api/cashboxes', makeCrudRouter('cashboxes', { writable: true, preserveClientId: true, policy: CRUD_POLICIES.cashboxes }));
    app.use(errorHandler);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
    process.env.PORT = String(port);
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (scratch) await teardownScratchDb(scratch);
    if (savedPort === undefined) delete process.env.PORT; else process.env.PORT = savedPort;
  });

  beforeEach(async () => {
    // Fresh-install state for every case: no users, no cashboxes, no money rows.
    await client.$executeRawUnsafe('TRUNCATE users, cashboxes, treasury_txn, payments, admission_payments, inventory_txn, admissions, students, inv_materials CASCADE');
  });

  it('fresh install: setup creates cb_main, and a regular payment to it succeeds without Treasury ever being opened', async () => {
    expect(await client.cashboxes.count()).toBe(0);

    const res = await runSetup();
    expect(res.status).toBe(201);

    const cb = await client.cashboxes.findUnique({ where: { id: 'cb_main' } });
    expect(cb).not.toBeNull();
    expect(cb.active).toBe(true);
    expect(cb.is_default).toBe(true);
    expect(Number(cb.opening_balance)).toBe(0);
    expect(await client.cashboxes.count()).toBe(1);

    const studentId = nextId('s');
    await client.students.create({ data: { id: studentId, code: studentId, name: 'طالب', status: 'active', monthly_fee: 300 } });
    const { payment, treasuryTxn } = await createPayment({
      studentId, month: 1, year: 2026, amount: 300,
      method: 'cash', payType: 'subscription', date: '2026-01-05', cashboxId: 'cb_main',
    }, { userId: 'admin' });

    expect(payment.treasuryTxnId).toBe(treasuryTxn.id);
    expect(treasuryTxn.cashboxId).toBe('cb_main');
    const dbTxn = await client.treasury_txn.findUnique({ where: { id: treasuryTxn.id } });
    expect(dbTxn.cashbox_id).toBe('cb_main');
  });

  it('fresh install: an admission payment to cb_main succeeds right after setup', async () => {
    expect((await runSetup()).status).toBe(201);

    const admissionId = nextId('adm');
    await client.admissions.create({ data: { id: admissionId, number: nextId('NUM'), name: 'قبول', stage: 'reserved' } });
    const { treasuryTxn } = await createAdmissionPayment({
      admissionId, type: 'deposit', amount: 200, date: '2026-05-20', cashboxId: 'cb_main',
    }, { userId: 'admin' });

    const dbTxn = await client.treasury_txn.findUnique({ where: { id: treasuryTxn.id } });
    expect(dbTxn.cashbox_id).toBe('cb_main');
  });

  it('fresh install: a material payment to cb_main succeeds right after setup', async () => {
    expect((await runSetup()).status).toBe(201);

    const studentId = nextId('s');
    await client.students.create({ data: { id: studentId, code: studentId, name: 'طالب', status: 'active' } });
    const material = await client.inv_materials.create({ data: { code: nextId('M'), name: 'مذكرة', price: 200 } });
    const { treasuryTxn } = await confirmMaterialPayment({
      materialId: String(material.id), studentId, payStatus: 'paid', cashboxId: 'cb_main', date: '2026-01-05',
    }, { userId: 'admin' });

    const dbTxn = await client.treasury_txn.findUnique({ where: { id: treasuryTxn.id } });
    expect(dbTxn.cashbox_id).toBe('cb_main');
  });

  it('existing cb_main is neither duplicated nor overwritten by setup', async () => {
    await client.cashboxes.create({
      data: { id: 'cb_main', name: 'خزنتي', type: 'custom', opening_balance: 750, is_default: false, active: false, notes: 'user data' },
    });

    expect((await runSetup()).status).toBe(201);

    const rows = await client.cashboxes.findMany({ where: { id: 'cb_main' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('خزنتي');
    expect(rows[0].type).toBe('custom');
    expect(Number(rows[0].opening_balance)).toBe(750);
    expect(rows[0].is_default).toBe(false);
    expect(rows[0].active).toBe(false);
    expect(rows[0].notes).toBe('user data');
    expect(await client.cashboxes.count()).toBe(1);
  });

  it('a rejected second setup (already initialized) creates nothing extra', async () => {
    expect((await runSetup()).status).toBe(201);
    const second = await request(port, {
      method: 'POST', path: '/api/setup',
      body: { id: 'admin2', name: 'آخر', password: 'correct-horse-battery-staple' },
    });
    expect(second.status).toBe(404);
    expect(await client.cashboxes.count()).toBe(1);
  });

  it('Treasury still works after setup: its cb_main sync POST gets a 409 (treated as success), the row is unchanged, and the list shows it', async () => {
    expect((await runSetup()).status).toBe(201);
    const before = await client.cashboxes.findUnique({ where: { id: 'cb_main' } });

    // Exactly what TreasuryPage's syncSeedCashboxOnce sends (INITIAL_CASHBOXES' cb_main seed).
    const sync = await request(port, {
      method: 'POST', path: '/api/cashboxes',
      body: { id: 'cb_main', name: 'الخزنة الرئيسية', type: 'main', color: '#0d9488', icon: '🏦', openingBalance: 0, isDefault: true, active: true },
    });
    expect(sync.status).toBe(409);

    const after = await client.cashboxes.findUnique({ where: { id: 'cb_main' } });
    expect(after).toEqual(before);

    const list = await request(port, { path: '/api/cashboxes' });
    expect(list.status).toBe(200);
    expect(list.body.data.map((c) => c.id)).toEqual(['cb_main']);

    // A user-created cashbox from Treasury still works normally.
    const created = await request(port, { method: 'POST', path: '/api/cashboxes', body: { id: 'cb_user_1', name: 'خزنة فرعية', openingBalance: 0 } });
    expect(created.status).toBe(201);
    expect(await client.cashboxes.count()).toBe(2);
  });
});
