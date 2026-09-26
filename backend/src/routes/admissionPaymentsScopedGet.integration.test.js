// backend/src/routes/admissionPaymentsScopedGet.integration.test.js
// Scalability Architecture Phase 4 (admissionPayments) — real PostgreSQL integration
// (scratch database only). Proves the new GET /api/admissionPayments (backend/src/routes/
// admissionPayments.js) supports an optional admissionId filter (returning only that
// admission's payments, with no leakage from other admissions), that an admission with no
// payments returns an empty array (not an error), and that the unfiltered GET (used by
// AdmissionsPage.jsx's single page-mount fetch) still returns every row — replacing the
// previous unfiltered generic CRUD GET that served this path before this phase.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

function request(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
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

describe('GET /api/admissionPayments — admissionId filter + unfiltered compatibility (real PostgreSQL + Express, Phase 4)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, server, port, createAdmissionPayment;
  let seq = 0;

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  beforeAll(async () => {
    scratch = await setupScratchDb('admission_payments_scoped_get');
    client = scratch.client;

    const admissionPaymentsModule = await import('./admissionPayments.js');
    const admissionPaymentsRouter = admissionPaymentsModule.default;
    createAdmissionPayment = admissionPaymentsModule.createAdmissionPayment;
    const { errorHandler } = await import('../middleware/errorHandler.js');

    const app = express();
    app.use(express.json());
    app.use('/api/admissionPayments', admissionPaymentsRouter);
    app.use(errorHandler);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    port = server.address().port;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (scratch) await teardownScratchDb(scratch);
  });

  // كل اختبار يتحقّق من محتوى الجدول كاملاً — تفريغه قبل كل اختبار يعزل كل اختبار تماماً
  // (نفس أسلوب activityLogsScopedGet.integration.test.js's beforeEach). admission_payments
  // سجلات ثابتة (trg_no_delete_admission_payments) — deleteMany هنا يعمل فقط لأن هذا هو
  // scratch DB الاختباري المُعاد إنشاؤه من الصفر، لا القاعدة الحقيقية.
  beforeEach(async () => {
    // createAdmissionPayment (المُستخدَمة في seedPayment أدناه) تُنشئ أيضاً سجل نشاط نظامي
    // (admission_system_log، paymentReceived) يشير لِـ admission_id — يُحذَف أولاً قبل
    // admissions نفسها، وإلا يفشل الحذف بقيد FK.
    await client.admission_payments.deleteMany({});
    await client.admission_system_log.deleteMany({});
    await client.treasury_txn.deleteMany({});
    await client.admissions.deleteMany({});
    await client.cashboxes.deleteMany({});
  });

  async function seedAdmission(overrides = {}) {
    const id = nextId('adm');
    return client.admissions.create({
      data: { id, number: nextId('NUM'), name: 'قبول اختبار', stage: 'reserved', ...overrides },
    });
  }

  async function seedCashbox(overrides = {}) {
    const id = nextId('cb');
    return client.cashboxes.create({
      data: { id, name: 'خزنة اختبار', active: true, opening_balance: 0, ...overrides },
    });
  }

  async function seedPayment(admissionId, cashboxId, overrides = {}) {
    const { payment } = await createAdmissionPayment({
      admissionId, type: 'deposit', amount: 200, date: '2026-01-10', cashboxId, ...overrides,
    }, { userId: null });
    return payment;
  }

  it('no rows: returns an empty array, not an error', async () => {
    const res = await request(port, '/api/admissionPayments');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  it('unfiltered GET returns every row across every admission (used by AdmissionsPage.jsx single page-mount fetch)', async () => {
    const cashbox = await seedCashbox();
    const admission1 = await seedAdmission();
    const admission2 = await seedAdmission();
    const p1 = await seedPayment(admission1.id, cashbox.id);
    const p2 = await seedPayment(admission2.id, cashbox.id);

    const res = await request(port, '/api/admissionPayments');
    expect(res.status).toBe(200);
    const ids = res.body.data.map((r) => r.id);
    expect(ids.sort()).toEqual([p1.id, p2.id].sort());
  });

  it('admissionId filter returns only that admission\'s payments', async () => {
    const cashbox = await seedCashbox();
    const admission1 = await seedAdmission();
    const admission2 = await seedAdmission();
    const p1 = await seedPayment(admission1.id, cashbox.id);
    await seedPayment(admission2.id, cashbox.id);

    const res = await request(port, `/api/admissionPayments?admissionId=${admission1.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(p1.id);
    expect(res.body.data[0].admissionId).toBe(admission1.id);
  });

  it('another admission\'s payments never leak into a filtered request', async () => {
    const cashbox = await seedCashbox();
    const admission1 = await seedAdmission();
    const admission2 = await seedAdmission();
    await seedPayment(admission1.id, cashbox.id);
    const p2 = await seedPayment(admission2.id, cashbox.id);

    const res = await request(port, `/api/admissionPayments?admissionId=${admission2.id}`);
    expect(res.body.data.map((r) => r.id)).toEqual([p2.id]);
    expect(res.body.data.every((r) => r.admissionId === admission2.id)).toBe(true);
  });

  it('an admission with no payments returns an empty array for a filtered request', async () => {
    const cashbox = await seedCashbox();
    const admissionWithPayment = await seedAdmission();
    const admissionWithoutPayment = await seedAdmission();
    await seedPayment(admissionWithPayment.id, cashbox.id);

    const res = await request(port, `/api/admissionPayments?admissionId=${admissionWithoutPayment.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('returns amount/date normalized (camelCase, Decimal serialized) matching normalizeAdmissionPaymentResponse expectations', async () => {
    const cashbox = await seedCashbox();
    const admission = await seedAdmission();
    await seedPayment(admission.id, cashbox.id, { amount: 350.5 });

    const res = await request(port, `/api/admissionPayments?admissionId=${admission.id}`);
    const row = res.body.data[0];
    expect(row.admissionId).toBe(admission.id);
    expect(row.treasuryTxnId).toBeDefined();
    expect(typeof row.amount === 'string' || typeof row.amount === 'number').toBe(true);
  });

  it('PUT/PATCH/DELETE remain blocked with 405 (append-only, unchanged by this phase)', async () => {
    const cashbox = await seedCashbox();
    const admission = await seedAdmission();
    const payment = await seedPayment(admission.id, cashbox.id);

    const methods = ['PUT', 'PATCH', 'DELETE'];
    for (const method of methods) {
      const res = await new Promise((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port, path: `/api/admissionPayments/${payment.id}`, method },
          (res) => {
            let raw = '';
            res.on('data', (c) => { raw += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') }));
          }
        );
        req.on('error', reject);
        req.end();
      });
      expect(res.status, method).toBe(405);
    }
  });

  it('POST / (existing atomic creation) remains unchanged by this phase', async () => {
    const cashbox = await seedCashbox();
    const admission = await seedAdmission();

    const res = await new Promise((resolve, reject) => {
      const body = JSON.stringify({
        admissionId: admission.id, type: 'deposit', amount: 150, date: '2026-01-12', cashboxId: cashbox.id,
      });
      const req = http.request(
        { host: '127.0.0.1', port, path: '/api/admissionPayments', method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (res) => {
          let raw = '';
          res.on('data', (c) => { raw += c; });
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') }));
        }
      );
      req.on('error', reject);
      req.end(body);
    });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.payment.admissionId).toBe(admission.id);
  });
});
