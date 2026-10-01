// backend/src/routes/paymentsSubscriptionMonth.integration.test.js
// M-01 — monthly subscription state is derived from the net of the month's subscription
// payments (minus active refunds), never from payments.status. Server-side rules under test:
//   * a subscription payment may not exceed the month's remaining amount when the fee > 0
//     (409, `remaining` exposed, NO payment row and NO treasury_txn row);
//   * the check runs under a per-student/month transaction lock (concurrent top-ups);
//   * payments.status is a record-level snapshot: the month state right after this payment for
//     a subscription, always 'paid' for any other pay type;
//   * idempotent retries (same clientRequestId) still replay instead of hitting the cap.
//
// npm run test:integration only, against a throwaway PostgreSQL (see test-helpers/scratchDb.js).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import http from 'http';
import express from 'express';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('M-01 — subscription month state and top-ups (real PostgreSQL integration)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, server, port;
  let createPayment, refundPayment, getSubscriptionMonthNet;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('payments_subscription_month');
    client = scratch.client;
    const paymentsModule = await import('./payments.js');
    ({ createPayment, refundPayment, getSubscriptionMonthNet } = paymentsModule);
    const { errorHandler } = await import('../middleware/errorHandler.js');

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: null }; next(); });
    app.use('/api/payments', paymentsModule.default);
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

  async function seedGroup(price) {
    const id = nextId('g');
    return client.groups.create({ data: { id, name: 'مجموعة', price } });
  }
  async function seedStudent({ fee = 500, groupId = null } = {}) {
    const id = nextId('s');
    return client.students.create({
      data: { id, code: id, name: 'طالب', status: 'active', monthly_fee: fee, group_id: groupId },
    });
  }
  async function seedCashbox(opening = 10_000) {
    return client.cashboxes.create({ data: { id: nextId('cb'), name: 'خزنة', active: true, opening_balance: opening } });
  }

  // Default month: 3/2026. Every call carries its own clientRequestId unless overridden.
  function pay(student, cashbox, amount, extra = {}) {
    return createPayment({
      studentId: student.id, month: 3, year: 2026, amount, method: 'cash',
      payType: 'subscription', date: '2026-03-05', cashboxId: cashbox.id,
      clientRequestId: key(), ...extra,
    }, { userId: null });
  }

  const net = (student, month = 3, year = 2026) => getSubscriptionMonthNet(client, { studentId: student.id, year, month });

  async function rowCounts(student, cashbox) {
    return {
      payments: await client.payments.count({ where: { student_id: student.id } }),
      txns: await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } }),
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

  describe('instalments', () => {
    it('1. a single full payment -> status paid, month net = fee', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      const { payment } = await pay(student, cashbox, 500);
      expect(payment.status).toBe('paid');
      expect(await net(student)).toBe(500);
    });

    it('2-4. partial, top-up and exact completion: 300 -> partial, +200 -> paid', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      const first = await pay(student, cashbox, 300);
      expect(first.payment.status).toBe('partial');
      expect(await net(student)).toBe(300);

      const second = await pay(student, cashbox, 200);
      expect(second.payment.status).toBe('paid');
      expect(await net(student)).toBe(500);
    });

    it('5. overpayment (fee 500, net 400, +150) -> 409 with remaining 100, NO payment row, NO treasury row', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      await pay(student, cashbox, 400);
      const before = await rowCounts(student, cashbox);

      const err = await pay(student, cashbox, 150).catch((e) => e);
      expect(err.status).toBe(409);
      expect(err.code).toBe('SUBSCRIPTION_OVERPAYMENT');
      expect(err.remaining).toBe(100);

      expect(await rowCounts(student, cashbox)).toEqual(before);
      expect(await net(student)).toBe(400);
    });

    it('5b. a fully-paid month refuses any further subscription payment (remaining 0)', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      await pay(student, cashbox, 500);
      const err = await pay(student, cashbox, 1).catch((e) => e);
      expect(err.status).toBe(409);
      expect(err.remaining).toBe(0);
    });

    it('5c. HTTP: POST /api/payments overpayment answers 409 { code, remaining } and writes nothing', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      await pay(student, cashbox, 400);
      const before = await rowCounts(student, cashbox);

      const res = await post('/api/payments', {
        studentId: student.id, month: 3, year: 2026, amount: 150, method: 'cash',
        payType: 'subscription', date: '2026-03-05', cashboxId: cashbox.id, clientRequestId: key(),
      });
      expect(res.status).toBe(409);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBe('SUBSCRIPTION_OVERPAYMENT');
      expect(res.body.remaining).toBe(100);
      expect(await rowCounts(student, cashbox)).toEqual(before);
    });
  });

  describe('refunds are netted (active refunds only)', () => {
    it('6. 500 paid, 500 refunded -> net 0, a new full payment is accepted (paid again)', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      const { payment } = await pay(student, cashbox, 500);
      await refundPayment({ id: payment.id, amount: 500, reason: 'استرداد كامل' }, { userId: null });
      expect(await net(student)).toBe(0);

      const again = await pay(student, cashbox, 500);
      expect(again.payment.status).toBe('paid');
      expect(await net(student)).toBe(500);
    });

    it('7. 500 paid, 200 refunded -> net 300; top-up capped at 200 (250 refused, 200 accepted)', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      const { payment } = await pay(student, cashbox, 500);
      await refundPayment({ id: payment.id, amount: 200, reason: 'استرداد جزئي' }, { userId: null });
      expect(await net(student)).toBe(300);

      const err = await pay(student, cashbox, 250).catch((e) => e);
      expect(err.status).toBe(409);
      expect(err.remaining).toBe(200);

      const topUp = await pay(student, cashbox, 200);
      expect(topUp.payment.status).toBe('paid');
    });

    it('8. 300 + 200 paid, 100 refunded -> net 400; 300 paid, 300 refunded -> net 0', async () => {
      const a = await seedStudent();
      const cashbox = await seedCashbox();
      const p1 = await pay(a, cashbox, 300);
      await pay(a, cashbox, 200);
      await refundPayment({ id: p1.payment.id, amount: 100, reason: 'استرداد' }, { userId: null });
      expect(await net(a)).toBe(400);

      const b = await seedStudent();
      const q = await pay(b, cashbox, 300);
      await refundPayment({ id: q.payment.id, amount: 300, reason: 'استرداد' }, { userId: null });
      expect(await net(b)).toBe(0);
    });
  });

  describe('month scope, fee resolution and pay types', () => {
    it('10. historical month: the same month number in another year is independent', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      await pay(student, cashbox, 500, { month: 1, year: 2024, date: '2024-01-05' });
      const current = await pay(student, cashbox, 500, { month: 1, year: 2026, date: '2026-01-05' });
      expect(current.payment.status).toBe('paid');
      expect(await net(student, 1, 2024)).toBe(500);
      expect(await net(student, 1, 2026)).toBe(500);
    });

    it('11. changed fee: the current fee caps the month (lowered -> 0 remaining, raised -> top-up allowed)', async () => {
      const student = await seedStudent({ fee: 500 });
      const cashbox = await seedCashbox();
      await pay(student, cashbox, 300);

      await client.students.update({ where: { id: student.id }, data: { monthly_fee: 300 } });
      const err = await pay(student, cashbox, 1).catch((e) => e);
      expect(err.status).toBe(409);
      expect(err.remaining).toBe(0);

      await client.students.update({ where: { id: student.id }, data: { monthly_fee: 600 } });
      const topUp = await pay(student, cashbox, 300);
      expect(topUp.payment.status).toBe('paid');
    });

    it('fee falls back to the student\'s own primary group price (not a client-sent groupId)', async () => {
      const group = await seedGroup(400);
      const cheap = await seedGroup(10);
      const student = await seedStudent({ fee: null, groupId: group.id });
      const cashbox = await seedCashbox();
      const err = await pay(student, cashbox, 450, { groupId: cheap.id }).catch((e) => e);
      expect(err.status).toBe(409);
      expect(err.remaining).toBe(400);
      expect((await pay(student, cashbox, 400, { groupId: group.id })).payment.status).toBe('paid');
    });

    it('I-1: a zero/unset fee is never "paid" and is not capped — snapshot partial', async () => {
      const student = await seedStudent({ fee: null });
      const cashbox = await seedCashbox();
      const { payment } = await pay(student, cashbox, 250);
      expect(payment.status).toBe('partial');
      expect((await pay(student, cashbox, 999)).payment.status).toBe('partial');
    });

    it('I-3: non-subscription payments are recorded as paid and never count toward the subscription month', async () => {
      const student = await seedStudent({ fee: 500 });
      const cashbox = await seedCashbox();
      const extra = await pay(student, cashbox, 900, { payType: 'extra' });
      expect(extra.payment.status).toBe('paid');
      expect(await net(student)).toBe(0);

      const sub = await pay(student, cashbox, 500);
      expect(sub.payment.status).toBe('paid');
    });
  });

  describe('concurrency and idempotency', () => {
    it('12. two concurrent top-ups (fee 500, net 300, 200 + 200): exactly one succeeds, net never exceeds the fee', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      await pay(student, cashbox, 300);

      const results = await Promise.allSettled([pay(student, cashbox, 200), pay(student, cashbox, 200)]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason.status).toBe(409);
      expect(rejected[0].reason.remaining).toBe(0);

      expect(await net(student)).toBe(500);
      expect(await client.payments.count({ where: { student_id: student.id } })).toBe(2);
      expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(2);
    });

    it('two concurrent full payments for an unpaid month: exactly one is recorded', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      const results = await Promise.allSettled([pay(student, cashbox, 500), pay(student, cashbox, 500)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await net(student)).toBe(500);
      expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(1);
    });

    it('13. concurrent duplicate clientRequestId completing the month: one payment, the duplicate replays (never a 409 cap)', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      await pay(student, cashbox, 300);
      const clientRequestId = key();

      const results = await Promise.allSettled([
        pay(student, cashbox, 200, { clientRequestId }),
        pay(student, cashbox, 200, { clientRequestId }),
      ]);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      const values = results.map((r) => r.value);
      expect(values.filter((v) => v.replay === true)).toHaveLength(1);
      expect(values[0].payment.id).toBe(clientRequestId);
      expect(values[1].payment.id).toBe(clientRequestId);

      expect(await net(student)).toBe(500);
      expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(2);
    });

    it('a sequential retry of the completing payment replays (200) instead of being refused as an overpayment', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      const input = {
        studentId: student.id, month: 3, year: 2026, amount: 500, method: 'cash',
        payType: 'subscription', date: '2026-03-05', cashboxId: cashbox.id, clientRequestId: key(),
      };
      const first = await post('/api/payments', input);
      const retry = await post('/api/payments', input);
      expect(first.status).toBe(201);
      expect(retry.status).toBe(200);
      expect(retry.body.data.replay).toBe(true);
      expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(1);
    });
  });
});
