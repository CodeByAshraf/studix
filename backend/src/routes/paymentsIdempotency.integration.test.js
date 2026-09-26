// backend/src/routes/paymentsIdempotency.integration.test.js
// P2-2 — real-PostgreSQL proof of server-side payment idempotency (clientRequestId), for every
// payment-creating path: POST /api/payments (createPayment), the booklet payment confirmation
// (confirmMaterialPayment) and admission payments (createAdmissionPayment). Full production DDL
// (triggers included — trg_payment_needs_treasury etc.) is applied to the scratch database.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED" test is
// recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import http from 'http';
import express from 'express';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { applyFullSchemaDDL } from '../test-helpers/scratchDbFullSchema.js';

const dbCheck = await checkPostgresReachable();

describe('payment idempotency — clientRequestId (P2-2, real PostgreSQL integration)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, server, port;
  let createPayment, refundPayment, confirmMaterialPayment, createAdmissionPayment;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('payments_idempotency');
    client = scratch.client;
    await applyFullSchemaDDL(client);
    const paymentsModule = await import('./payments.js');
    ({ createPayment, refundPayment } = paymentsModule);
    ({ confirmMaterialPayment } = await import('./materialDistribution.js'));
    ({ createAdmissionPayment } = await import('./admissionPayments.js'));
    const admissionPaymentsRouter = (await import('./admissionPayments.js')).default;
    const { errorHandler } = await import('../middleware/errorHandler.js');

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: null }; next(); });
    app.use('/api/payments', paymentsModule.default);
    app.use('/api/admissionPayments', admissionPaymentsRouter);
    app.use(errorHandler);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    port = server.address().port;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }
  const key = () => crypto.randomUUID();

  async function seedStudent(overrides = {}) {
    const id = nextId('s');
    return client.students.create({ data: { id, code: id, name: 'طالب', status: 'active', monthly_fee: 300, ...overrides } });
  }
  async function seedCashbox(overrides = {}) {
    return client.cashboxes.create({ data: { id: nextId('cb'), name: 'خزنة', active: true, opening_balance: 1000, ...overrides } });
  }
  async function seedMaterial(overrides = {}) {
    return client.inv_materials.create({ data: { code: nextId('MAT'), name: 'مذكرة', price: 200, ...overrides } });
  }
  async function seedAdmission() {
    const id = nextId('adm');
    await client.admissions.create({ data: { id, number: nextId('ADM'), name: 'متقدّم', stage: 'reserved' } });
    return id;
  }

  function paymentInput(student, cashbox, overrides = {}) {
    return {
      studentId: student.id, month: 4, year: 2026, amount: 300, method: 'cash',
      payType: 'subscription', date: '2026-04-05', cashboxId: cashbox.id, ...overrides,
    };
  }

  async function effects(studentId, cashboxId) {
    return {
      payments: await client.payments.count({ where: { student_id: studentId } }),
      treasury: await client.treasury_txn.count({ where: { cashbox_id: cashboxId } }),
    };
  }

  function post(path, body) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (res) => {
          let raw = '';
          res.on('data', (c) => { raw += c; });
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') }));
        }
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  }

  // ── POST /api/payments (createPayment) ────────────────────────────────────────────────────
  describe('createPayment', () => {
    it('same request retried with the same key -> one payment, one treasury effect, the retry returns the original', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      const clientRequestId = key();

      const first = await createPayment({ ...paymentInput(student, cashbox), clientRequestId }, { userId: null });
      const second = await createPayment({ ...paymentInput(student, cashbox), clientRequestId }, { userId: null });

      expect(first.payment.id).toBe(clientRequestId);
      expect(first.replay).toBeUndefined();
      expect(second.replay).toBe(true);
      expect(second.payment.id).toBe(first.payment.id);
      expect(second.treasuryTxn.id).toBe(first.treasuryTxn.id);
      expect(Number(second.payment.amount)).toBe(300);
      expect(await effects(student.id, cashbox.id)).toEqual({ payments: 1, treasury: 1 });
    });

    it('concurrent identical requests with the same key -> exactly one committed payment and one treasury effect', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      const clientRequestId = key();

      const results = await Promise.all(Array.from({ length: 5 }, () =>
        createPayment({ ...paymentInput(student, cashbox), clientRequestId }, { userId: null })));

      expect(new Set(results.map((r) => r.payment.id))).toEqual(new Set([clientRequestId]));
      expect(new Set(results.map((r) => r.treasuryTxn.id)).size).toBe(1);
      expect(results.filter((r) => !r.replay)).toHaveLength(1);
      expect(await effects(student.id, cashbox.id)).toEqual({ payments: 1, treasury: 1 });
    });

    it('same key with a materially different payload -> 409, the original stays unchanged, no second effect', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      const clientRequestId = key();
      await createPayment({ ...paymentInput(student, cashbox), clientRequestId }, { userId: null });
      const before = await client.payments.findUnique({ where: { id: clientRequestId } });

      for (const change of [{ amount: 150 }, { month: 5 }, { payType: 'extra' }, { method: 'visa' }, { notes: 'أخرى' }, { date: '2026-04-06' }]) {
        // eslint-disable-next-line no-await-in-loop
        await expect(createPayment({ ...paymentInput(student, cashbox, change), clientRequestId }, { userId: null }))
          .rejects.toMatchObject({ status: 409 });
      }
      const otherCashbox = await seedCashbox();
      await expect(createPayment({ ...paymentInput(student, otherCashbox), clientRequestId }, { userId: null }))
        .rejects.toMatchObject({ status: 409 });
      const otherStudent = await seedStudent();
      await expect(createPayment({ ...paymentInput(otherStudent, cashbox), clientRequestId }, { userId: null }))
        .rejects.toMatchObject({ status: 409 });

      expect(await client.payments.findUnique({ where: { id: clientRequestId } })).toEqual(before);
      expect(await effects(student.id, cashbox.id)).toEqual({ payments: 1, treasury: 1 });
      expect(await client.treasury_txn.count({ where: { cashbox_id: otherCashbox.id } })).toBe(0);
      expect(await client.payments.count({ where: { student_id: otherStudent.id } })).toBe(0);
    });

    it('concurrent requests reusing one key for DIFFERENT payloads -> exactly one wins, the other gets 409, one effect', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      const clientRequestId = key();

      const settled = await Promise.allSettled([
        createPayment({ ...paymentInput(student, cashbox, { amount: 300 }), clientRequestId }, { userId: null }),
        createPayment({ ...paymentInput(student, cashbox, { amount: 100 }), clientRequestId }, { userId: null }),
      ]);
      expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
      const rejected = settled.filter((s) => s.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason.status).toBe(409);
      expect(await effects(student.id, cashbox.id)).toEqual({ payments: 1, treasury: 1 });
    });

    it('a failed transaction does not consume the key: nothing is committed, and a retry with the same key succeeds', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      const clientRequestId = key();
      const groupId = nextId('g-not-yet');
      const input = { ...paymentInput(student, cashbox, { groupId }), clientRequestId };

      // the group does not exist yet: payments.create (step 2) violates its FK AFTER the
      // treasury_txn (step 1) was written — the whole transaction must roll back.
      await expect(createPayment(input, { userId: null })).rejects.toThrow();
      expect(await client.payments.findUnique({ where: { id: clientRequestId } })).toBeNull();
      expect(await effects(student.id, cashbox.id)).toEqual({ payments: 0, treasury: 0 });

      await client.groups.create({ data: { id: groupId, name: 'مجموعة', subject: 'رياضيات', grade: 'الثالث', time: '10:00', days: [], max: 10, color: '#000' } });
      const retried = await createPayment(input, { userId: null });
      expect(retried.payment.id).toBe(clientRequestId);
      expect(retried.replay).toBeUndefined();
      expect(await effects(student.id, cashbox.id)).toEqual({ payments: 1, treasury: 1 });
    });

    it('different keys -> two legitimate, separate payments (even with an identical payload)', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      const a = await createPayment({ ...paymentInput(student, cashbox, { amount: 100 }), clientRequestId: key() }, { userId: null });
      const b = await createPayment({ ...paymentInput(student, cashbox, { amount: 100 }), clientRequestId: key() }, { userId: null });
      expect(a.payment.id).not.toBe(b.payment.id);
      expect(await effects(student.id, cashbox.id)).toEqual({ payments: 2, treasury: 2 });
    });

    it('existing rules still apply with a key: an inactive cashbox is refused with no residue, and the key stays usable', async () => {
      const student = await seedStudent();
      const inactive = await seedCashbox({ active: false });
      const clientRequestId = key();
      await expect(createPayment({ ...paymentInput(student, inactive), clientRequestId }, { userId: null }))
        .rejects.toThrow('الخزنة المحدَّدة غير موجودة أو غير نشطة.');
      expect(await client.payments.findUnique({ where: { id: clientRequestId } })).toBeNull();

      const active = await seedCashbox();
      const ok = await createPayment({ ...paymentInput(student, active), clientRequestId }, { userId: null });
      expect(ok.payment.id).toBe(clientRequestId);
    });

    it('a malformed key is rejected (400) before anything is written', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      for (const bad of ['short', 'has space in it 123456', "x'; DROP TABLE payments;--", 'a'.repeat(65), 42]) {
        // eslint-disable-next-line no-await-in-loop
        await expect(createPayment({ ...paymentInput(student, cashbox), clientRequestId: bad }, { userId: null }))
          .rejects.toMatchObject({ status: 400 });
      }
      expect(await effects(student.id, cashbox.id)).toEqual({ payments: 0, treasury: 0 });
    });

    it('refunds still work on an idempotently created payment, and a replay after the refund still returns the original unchanged payment', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      const clientRequestId = key();
      await createPayment({ ...paymentInput(student, cashbox), clientRequestId }, { userId: null });
      const refund = await refundPayment({ id: clientRequestId, amount: 100, reason: 'استرداد جزئي' }, { userId: null });
      expect(Number(refund.refundTxn.amount)).toBe(100);

      const replay = await createPayment({ ...paymentInput(student, cashbox), clientRequestId }, { userId: null });
      expect(replay.replay).toBe(true);
      expect(Number(replay.payment.amount)).toBe(300);
      expect(await client.payments.count({ where: { student_id: student.id } })).toBe(1);
      // original income + the one refund, nothing more
      expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(2);
    });
  });

  // ── HTTP contract ─────────────────────────────────────────────────────────────────────────
  describe('POST /api/payments (HTTP)', () => {
    it('requires clientRequestId: without it -> 400 and nothing is written', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      const res = await post('/api/payments', paymentInput(student, cashbox));
      expect(res.status).toBe(400);
      expect(await effects(student.id, cashbox.id)).toEqual({ payments: 0, treasury: 0 });
    });

    it('first request 201; retry 200 with the same body and replay: true; key reuse with another payload 409', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      const clientRequestId = key();
      const first = await post('/api/payments', { ...paymentInput(student, cashbox), clientRequestId });
      const retry = await post('/api/payments', { ...paymentInput(student, cashbox), clientRequestId });
      const reused = await post('/api/payments', { ...paymentInput(student, cashbox, { amount: 1 }), clientRequestId });

      expect(first.status).toBe(201);
      expect(retry.status).toBe(200);
      expect(retry.body.data.replay).toBe(true);
      expect(retry.body.data.payment.id).toBe(first.body.data.payment.id);
      expect(retry.body.data.treasuryTxn.id).toBe(first.body.data.treasuryTxn.id);
      expect(reused.status).toBe(409);
      expect(reused.body.ok).toBe(false);
      expect(await effects(student.id, cashbox.id)).toEqual({ payments: 1, treasury: 1 });
    });
  });

  // ── booklet payment confirmation (confirmMaterialPayment) ─────────────────────────────────
  describe('confirmMaterialPayment', () => {
    it('a retried PARTIAL confirmation with the same key is recorded once (previously it was recorded twice)', async () => {
      const student = await seedStudent();
      const material = await seedMaterial({ price: 200 });
      const cashbox = await seedCashbox();
      const clientRequestId = key();
      const input = { materialId: String(material.id), studentId: student.id, payStatus: 'partial', amount: 50, cashboxId: cashbox.id, date: '2026-04-05', clientRequestId };

      const first = await confirmMaterialPayment(input, { userId: null });
      const second = await confirmMaterialPayment(input, { userId: null });

      expect(second.replay).toBe(true);
      expect(second.payment.id).toBe(first.payment.id);
      expect(await effects(student.id, cashbox.id)).toEqual({ payments: 1, treasury: 1 });
      const inv = await client.inventory_txn.findMany({ where: { student_id: student.id, material_id: material.id } });
      expect(inv).toHaveLength(1);
      expect(Number(inv[0].legacy_metadata.paidAmount)).toBe(50);
    });

    it('a retried FULL confirmation replays instead of failing with "already fully paid"', async () => {
      const student = await seedStudent();
      const material = await seedMaterial({ price: 200 });
      const cashbox = await seedCashbox();
      const input = { materialId: String(material.id), studentId: student.id, payStatus: 'paid', cashboxId: cashbox.id, date: '2026-04-05', clientRequestId: key() };
      const first = await confirmMaterialPayment(input, { userId: null });
      const second = await confirmMaterialPayment(input, { userId: null });
      expect(second.replay).toBe(true);
      expect(second.payment.id).toBe(first.payment.id);
      expect(Number(second.payment.amount)).toBe(200);
      expect(await effects(student.id, cashbox.id)).toEqual({ payments: 1, treasury: 1 });
    });

    it('concurrent identical confirmations with one key -> one payment, one treasury effect', async () => {
      const student = await seedStudent();
      const material = await seedMaterial({ price: 200 });
      const cashbox = await seedCashbox();
      const input = { materialId: String(material.id), studentId: student.id, payStatus: 'partial', amount: 40, cashboxId: cashbox.id, date: '2026-04-05', clientRequestId: key() };
      const results = await Promise.all([1, 2, 3].map(() => confirmMaterialPayment(input, { userId: null })));
      expect(new Set(results.map((r) => r.payment.id)).size).toBe(1);
      expect(await effects(student.id, cashbox.id)).toEqual({ payments: 1, treasury: 1 });
    });

    it('same key for a different confirmation (another amount / another student) -> 409, no second effect', async () => {
      const student = await seedStudent();
      const material = await seedMaterial({ price: 200 });
      const cashbox = await seedCashbox();
      const clientRequestId = key();
      await confirmMaterialPayment({ materialId: String(material.id), studentId: student.id, payStatus: 'partial', amount: 50, cashboxId: cashbox.id, date: '2026-04-05', clientRequestId }, { userId: null });

      await expect(confirmMaterialPayment({ materialId: String(material.id), studentId: student.id, payStatus: 'partial', amount: 60, cashboxId: cashbox.id, date: '2026-04-05', clientRequestId }, { userId: null }))
        .rejects.toMatchObject({ status: 409 });
      const other = await seedStudent();
      await expect(confirmMaterialPayment({ materialId: String(material.id), studentId: other.id, payStatus: 'partial', amount: 50, cashboxId: cashbox.id, date: '2026-04-05', clientRequestId }, { userId: null }))
        .rejects.toMatchObject({ status: 409 });

      expect(await effects(student.id, cashbox.id)).toEqual({ payments: 1, treasury: 1 });
      expect(await client.payments.count({ where: { student_id: other.id } })).toBe(0);
    });

    it('two different keys -> two legitimate partial payments', async () => {
      const student = await seedStudent();
      const material = await seedMaterial({ price: 200 });
      const cashbox = await seedCashbox();
      const base = { materialId: String(material.id), studentId: student.id, payStatus: 'partial', amount: 50, cashboxId: cashbox.id, date: '2026-04-05' };
      await confirmMaterialPayment({ ...base, clientRequestId: key() }, { userId: null });
      await confirmMaterialPayment({ ...base, clientRequestId: key() }, { userId: null });
      expect(await effects(student.id, cashbox.id)).toEqual({ payments: 2, treasury: 2 });
    });

    it('the HTTP route requires the key (requireKey)', async () => {
      const student = await seedStudent();
      const material = await seedMaterial();
      const cashbox = await seedCashbox();
      await expect(confirmMaterialPayment(
        { materialId: String(material.id), studentId: student.id, payStatus: 'paid', cashboxId: cashbox.id },
        { userId: null, requireKey: true },
      )).rejects.toMatchObject({ status: 400 });
      expect(await effects(student.id, cashbox.id)).toEqual({ payments: 0, treasury: 0 });
    });
  });

  // ── admission payments (same contract) ────────────────────────────────────────────────────
  describe('createAdmissionPayment', () => {
    const admissionInput = (admissionId, cashboxId, overrides = {}) => ({
      admissionId, type: 'deposit', amount: 200, date: '2026-04-05', cashboxId, ...overrides,
    });

    it('retry with the same key returns the original; one payment, one treasury effect', async () => {
      const admissionId = await seedAdmission();
      const cashbox = await seedCashbox();
      const clientRequestId = key();
      const first = await createAdmissionPayment({ ...admissionInput(admissionId, cashbox.id), clientRequestId }, { userId: null });
      const second = await createAdmissionPayment({ ...admissionInput(admissionId, cashbox.id), clientRequestId }, { userId: null });
      expect(second.replay).toBe(true);
      expect(second.payment.id).toBe(first.payment.id);
      expect(await client.admission_payments.count({ where: { admission_id: admissionId } })).toBe(1);
      expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(1);
    });

    it('same key with a different payload -> 409 (previously the unrelated original was silently returned)', async () => {
      const admissionId = await seedAdmission();
      const cashbox = await seedCashbox();
      const clientRequestId = key();
      await createAdmissionPayment({ ...admissionInput(admissionId, cashbox.id), clientRequestId }, { userId: null });
      await expect(createAdmissionPayment({ ...admissionInput(admissionId, cashbox.id, { amount: 999 }), clientRequestId }, { userId: null }))
        .rejects.toMatchObject({ status: 409 });
      await expect(createAdmissionPayment({ ...admissionInput(admissionId, cashbox.id, { type: 'course' }), clientRequestId }, { userId: null }))
        .rejects.toMatchObject({ status: 409 });
      expect(await client.admission_payments.count({ where: { admission_id: admissionId } })).toBe(1);
      expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(1);
    });

    it('concurrent identical requests with one key -> one payment, one treasury effect', async () => {
      const admissionId = await seedAdmission();
      const cashbox = await seedCashbox();
      const clientRequestId = key();
      const results = await Promise.all([1, 2, 3].map(() =>
        createAdmissionPayment({ ...admissionInput(admissionId, cashbox.id), clientRequestId }, { userId: null })));
      expect(new Set(results.map((r) => r.payment.id)).size).toBe(1);
      expect(await client.admission_payments.count({ where: { admission_id: admissionId } })).toBe(1);
      expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(1);
    });

    it('HTTP: missing key -> 400; first 201; retry 200 replay', async () => {
      const admissionId = await seedAdmission();
      const cashbox = await seedCashbox();
      expect((await post('/api/admissionPayments', admissionInput(admissionId, cashbox.id))).status).toBe(400);
      const clientRequestId = key();
      const first = await post('/api/admissionPayments', { ...admissionInput(admissionId, cashbox.id), clientRequestId });
      const retry = await post('/api/admissionPayments', { ...admissionInput(admissionId, cashbox.id), clientRequestId });
      expect(first.status).toBe(201);
      expect(retry.status).toBe(200);
      expect(retry.body.data.payment.id).toBe(first.body.data.payment.id);
      expect(await client.admission_payments.count({ where: { admission_id: admissionId } })).toBe(1);
    });
  });
});
