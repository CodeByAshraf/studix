// backend/src/routes/cashboxConcurrency.integration.test.js
// P2-3 — real-PostgreSQL proof that cashbox balances stay consistent under concurrent financial
// operations. Invariant under test (lib/cashboxLedger.js): a balance-gated debit (payment refund,
// admission-cancellation refund, transfer out, manual expense) never commits when it would take
// its cashbox below zero — the cashbox row is locked and the balance recomputed inside the same
// transaction as the write, so concurrent debits are serialized per cashbox. Credits are never
// blocked by that lock and are never lost (the balance is always derived from committed rows).
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

describe('cashbox balance concurrency (P2-3, real PostgreSQL integration)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, server, port;
  let createPayment, refundPayment, createAdmissionPayment, cancelAdmissionWithRefund;
  let transferBetweenCashboxes, reverseTreasuryTxn, runInTransaction;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('cashbox_concurrency');
    client = scratch.client;
    await applyFullSchemaDDL(client);
    ({ createPayment, refundPayment } = await import('./payments.js'));
    ({ createAdmissionPayment } = await import('./admissionPayments.js'));
    ({ cancelAdmissionWithRefund } = await import('./admissionCancellation.js'));
    const treasuryModule = await import('./treasuryTxn.js');
    ({ transferBetweenCashboxes, reverseTreasuryTxn } = treasuryModule);
    ({ runInTransaction } = await import('../lib/transaction.js'));
    const { makeCrudRouter } = await import('./crud.js');
    const { CRUD_POLICIES } = await import('./crudPolicies.js');
    const { errorHandler } = await import('../middleware/errorHandler.js');

    // Same mounting order as server.js: the dedicated treasuryTxn router first, then the
    // generic CRUD router with its P2-1 policy (manual income/expense entry).
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: null }; next(); });
    app.use('/api/treasuryTxn', treasuryModule.default);
    app.use('/api/treasuryTxn', makeCrudRouter('treasury_txn', { writable: true, policy: CRUD_POLICIES.treasuryTxn }));
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

  async function seedCashbox(opening) {
    return client.cashboxes.create({ data: { id: nextId('cb'), name: 'خزنة', active: true, opening_balance: opening } });
  }
  async function seedStudent(monthlyFee = 100) {
    const id = nextId('s');
    return client.students.create({ data: { id, code: id, name: 'طالب', status: 'active', monthly_fee: monthlyFee } });
  }
  async function seedAdmission() {
    const id = nextId('adm');
    await client.admissions.create({
      data: { id, number: nextId('ADM'), name: 'متقدّم', stage: 'reserved', reservation_status: 'reserved' },
    });
    return id;
  }

  // Balance exactly as cashboxBalance.js / the client compute it, read from committed rows.
  async function balanceOf(cashboxId) {
    const cb = await client.cashboxes.findUnique({ where: { id: cashboxId } });
    const [inc, exp] = await Promise.all([
      client.treasury_txn.aggregate({ where: { cashbox_id: cashboxId, type: 'income', status: 'active' }, _sum: { amount: true } }),
      client.treasury_txn.aggregate({ where: { cashbox_id: cashboxId, type: 'expense', status: 'active' }, _sum: { amount: true } }),
    ]);
    return Number(cb.opening_balance) + Number(inc._sum.amount ?? 0) - Number(exp._sum.amount ?? 0);
  }

  async function payInto(cashbox, amount, extra = {}) {
    // M-01: a subscription payment may not exceed the month's fee, so each payer's fee covers it.
    const student = await seedStudent(amount);
    return createPayment({
      studentId: student.id, month: 4, year: 2026, amount, method: 'cash',
      payType: 'subscription', date: '2026-04-05', cashboxId: cashbox.id, ...extra,
    }, { userId: null });
  }

  function transfer(from, to, amount) {
    return transferBetweenCashboxes(
      { fromCashboxId: from.id, toCashboxId: to.id, amount, date: '2026-04-06', method: 'cash' },
      { userId: null },
    );
  }

  function postJson(path, body) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (res) => {
          let raw = '';
          res.on('data', (c) => { raw += c; });
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') }));
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  }

  function manualEntry(cashbox, type, amount) {
    return postJson('/api/treasuryTxn', {
      cashboxId: cashbox.id, date: '2026-04-07', type, category: 'other', amount, method: 'cash',
    });
  }

  const settle = (promises) => Promise.allSettled(promises);
  const fulfilled = (results) => results.filter((r) => r.status === 'fulfilled');
  const rejected = (results) => results.filter((r) => r.status === 'rejected');

  // Waits until some backend session is blocked on a lock (pg_stat_activity) — proves that a
  // request really is queued behind the cashbox lock rather than racing past it.
  async function waitForLockWaiter() {
    for (let i = 0; i < 100; i += 1) {
      const rows = await client.$queryRaw`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (rows[0].n > 0) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('no session ever waited on the cashbox lock');
  }

  // A test-controlled transaction that takes the same debit lock the application uses and holds
  // it until release() is called. `inside(tx)` runs after the lock is taken.
  async function holdCashboxLock(cashboxId, inside = async () => {}) {
    const { lockCashboxForDebit } = await import('../lib/cashboxLedger.js');
    let release;
    const released = new Promise((r) => { release = r; });
    let locked;
    const lockTaken = new Promise((r) => { locked = r; });
    const done = runInTransaction(async (tx) => {
      await lockCashboxForDebit(tx, cashboxId);
      await inside(tx);
      locked();
      await released;
    });
    await lockTaken;
    return { release, done };
  }

  // ── Concurrent withdrawals ─────────────────────────────────────────────────────────────────
  describe('concurrent debits with insufficient combined balance', () => {
    it('concurrent payment refunds: only as many as the balance covers commit, final balance is exactly zero', async () => {
      const cashbox = await seedCashbox(0);
      const sink = await seedCashbox(0);
      const payments = [];
      for (let i = 0; i < 8; i += 1) payments.push((await payInto(cashbox, 100)).payment);
      await transfer(cashbox, sink, 500); // balance 800 -> 300

      const results = await settle(payments.map((p) =>
        refundPayment({ id: p.id, amount: 100, reason: 'استرداد متزامن' }, { userId: null })));

      expect(fulfilled(results)).toHaveLength(3);
      expect(rejected(results)).toHaveLength(5);
      for (const r of rejected(results)) expect(r.reason.status).toBe(400);
      expect(await balanceOf(cashbox.id)).toBe(0);
      expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id, ref_type: 'refund' } })).toBe(3);
    });

    it('concurrent transfers out: only the covered ones commit, no half-transfer on either side', async () => {
      const from = await seedCashbox(300);
      const to = await seedCashbox(0);

      const results = await settle(Array.from({ length: 6 }, () => transfer(from, to, 100)));

      expect(fulfilled(results)).toHaveLength(3);
      expect(rejected(results)).toHaveLength(3);
      for (const r of rejected(results)) expect(r.reason.status).toBe(400);
      expect(await balanceOf(from.id)).toBe(0);
      expect(await balanceOf(to.id)).toBe(300);
    });

    it('concurrent manual expenses via POST /api/treasuryTxn: only the covered ones commit (400 for the rest)', async () => {
      const cashbox = await seedCashbox(250);

      const responses = await Promise.all(Array.from({ length: 5 }, () => manualEntry(cashbox, 'expense', 100)));

      expect(responses.filter((r) => r.status === 201)).toHaveLength(2);
      expect(responses.filter((r) => r.status === 400)).toHaveLength(3);
      expect(await balanceOf(cashbox.id)).toBe(50);
    });

    it('concurrent admission cancellations with refunds: one commits, the other rolls back entirely', async () => {
      const cashbox = await seedCashbox(0);
      const sink = await seedCashbox(0);
      const admissions = [await seedAdmission(), await seedAdmission()];
      for (const admissionId of admissions) {
        await createAdmissionPayment({
          admissionId, type: 'deposit', amount: 100, date: '2026-04-05', cashboxId: cashbox.id,
        }, { userId: null });
      }
      await transfer(cashbox, sink, 100); // balance 200 -> 100: covers exactly one refund

      const results = await settle(admissions.map((admissionId) =>
        cancelAdmissionWithRefund({ admissionId, reason: 'إلغاء متزامن' }, { userId: null })));

      expect(fulfilled(results)).toHaveLength(1);
      expect(rejected(results)).toHaveLength(1);
      expect(await balanceOf(cashbox.id)).toBe(0);
      const statuses = await client.admissions.findMany({ where: { id: { in: admissions } }, select: { reservation_status: true } });
      expect(statuses.map((s) => s.reservation_status).sort()).toEqual(['cancelled', 'reserved']);
    });

    it('mixed concurrent debit kinds (refund, transfer, manual expense) on one cashbox: exactly one commits', async () => {
      const cashbox = await seedCashbox(0);
      const sink = await seedCashbox(0);
      const { payment } = await payInto(cashbox, 100); // balance 100

      const [refund, xfer, manual] = await Promise.allSettled([
        refundPayment({ id: payment.id, amount: 100, reason: 'مختلط' }, { userId: null }),
        transfer(cashbox, sink, 100),
        manualEntry(cashbox, 'expense', 100),
      ]);
      const committed = [refund.status === 'fulfilled', xfer.status === 'fulfilled', manual.value?.status === 201];

      expect(committed.filter(Boolean)).toHaveLength(1);
      expect(await balanceOf(cashbox.id)).toBe(0);
    });

    it('a debit that arrives while another debit holds the cashbox lock waits, then sees the committed balance and is rejected', async () => {
      const cashbox = await seedCashbox(100);
      const sink = await seedCashbox(0);
      const holder = await holdCashboxLock(cashbox.id, (tx) => tx.treasury_txn.create({
        data: {
          id: crypto.randomUUID(), cashbox_id: cashbox.id, date: new Date(), type: 'expense',
          category: 'other', amount: 100, method: 'cash',
        },
      }));

      const waiting = transfer(cashbox, sink, 100);
      await waitForLockWaiter();
      holder.release();
      await holder.done;

      await expect(waiting).rejects.toMatchObject({ status: 400 });
      expect(await balanceOf(cashbox.id)).toBe(0);
      expect(await balanceOf(sink.id)).toBe(0);
    });
  });

  // ── Boundary ──────────────────────────────────────────────────────────────────────────────
  describe('boundary', () => {
    it('a debit exactly equal to the balance succeeds and leaves zero; one more cent is refused', async () => {
      const cashbox = await seedCashbox(100);
      const sink = await seedCashbox(0);

      await transfer(cashbox, sink, 100);
      expect(await balanceOf(cashbox.id)).toBe(0);

      const res = await manualEntry(cashbox, 'expense', 0.01);
      expect(res.status).toBe(400);
      expect(await balanceOf(cashbox.id)).toBe(0);
    });

    it('decimal amounts are compared exactly (0.1 + 0.2 then 0.3 out of 0.6)', async () => {
      const cashbox = await seedCashbox(0.6);
      expect((await manualEntry(cashbox, 'expense', 0.1)).status).toBe(201);
      expect((await manualEntry(cashbox, 'expense', 0.2)).status).toBe(201);
      expect((await manualEntry(cashbox, 'expense', 0.3)).status).toBe(201);
      expect(await balanceOf(cashbox.id)).toBeCloseTo(0, 10);
      expect((await manualEntry(cashbox, 'expense', 0.01)).status).toBe(400);
    });
  });

  // ── Concurrent valid operations ───────────────────────────────────────────────────────────
  describe('concurrent valid operations', () => {
    it('concurrent debits whose combined total is covered all commit; balance is mathematically exact', async () => {
      const cashbox = await seedCashbox(1000);
      const sink = await seedCashbox(0);

      const results = await settle([
        transfer(cashbox, sink, 150),
        transfer(cashbox, sink, 250),
        manualEntry(cashbox, 'expense', 100),
        manualEntry(cashbox, 'expense', 200),
      ]);

      expect(rejected(results)).toHaveLength(0);
      expect(results.slice(2).every((r) => r.value.status === 201)).toBe(true);
      expect(await balanceOf(cashbox.id)).toBe(300);
      expect(await balanceOf(sink.id)).toBe(400);
    });
  });

  // ── Credit + debit concurrency ────────────────────────────────────────────────────────────
  describe('credit + debit concurrency', () => {
    it('concurrent credits and debits: no lost update, final balance reflects every committed operation', async () => {
      const cashbox = await seedCashbox(100);
      const sink = await seedCashbox(0);

      const results = await settle([
        payInto(cashbox, 300),
        transfer(cashbox, sink, 100),
        manualEntry(cashbox, 'income', 50),
        payInto(cashbox, 200),
      ]);

      expect(rejected(results)).toHaveLength(0);
      expect(results[2].value.status).toBe(201);
      expect(await balanceOf(cashbox.id)).toBe(100 + 300 - 100 + 50 + 200);
    });

    it('a credit is never blocked by a debit holding the cashbox lock', async () => {
      const cashbox = await seedCashbox(0);
      const holder = await holdCashboxLock(cashbox.id);
      try {
        const res = await payInto(cashbox, 70); // would hang (and time out) if credits took the lock
        expect(Number(res.treasuryTxn.amount)).toBe(70);
      } finally {
        holder.release();
        await holder.done;
      }
      expect(await balanceOf(cashbox.id)).toBe(70);
    });

    it('an uncommitted credit is not spendable: the debit is judged on committed money only', async () => {
      const cashbox = await seedCashbox(0);
      const sink = await seedCashbox(0);
      let release;
      const released = new Promise((r) => { release = r; });
      let inserted;
      const creditInserted = new Promise((r) => { inserted = r; });
      const credit = runInTransaction(async (tx) => {
        await tx.treasury_txn.create({
          data: {
            id: crypto.randomUUID(), cashbox_id: cashbox.id, date: new Date(), type: 'income',
            category: 'other', amount: 100, method: 'cash',
          },
        });
        inserted();
        await released;
        throw new Error('credit rolled back');
      });
      await creditInserted;

      await expect(transfer(cashbox, sink, 100)).rejects.toMatchObject({ status: 400 });
      release();
      await expect(credit).rejects.toThrow('credit rolled back');
      expect(await balanceOf(cashbox.id)).toBe(0);
    });
  });

  // ── Rollback ──────────────────────────────────────────────────────────────────────────────
  describe('rollback after lock/check', () => {
    it('a transaction failing after the lock + check + write leaves no financial effect and releases the lock', async () => {
      const { lockCashboxForDebit } = await import('../lib/cashboxLedger.js');
      const cashbox = await seedCashbox(100);
      const sink = await seedCashbox(0);

      await expect(runInTransaction(async (tx) => {
        const { balance } = await lockCashboxForDebit(tx, cashbox.id);
        expect(Number(balance)).toBe(100);
        await tx.treasury_txn.create({
          data: {
            id: crypto.randomUUID(), cashbox_id: cashbox.id, date: new Date(), type: 'expense',
            category: 'other', amount: 100, method: 'cash',
          },
        });
        throw new Error('forced failure before commit');
      })).rejects.toThrow('forced failure before commit');

      expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(0);
      expect(await balanceOf(cashbox.id)).toBe(100);

      await transfer(cashbox, sink, 100);
      expect(await balanceOf(cashbox.id)).toBe(0);
    });

    it('a transfer rejected after the source lock (inactive destination) writes nothing and a later transfer still works', async () => {
      const from = await seedCashbox(100);
      const inactive = await client.cashboxes.create({ data: { id: nextId('cb'), name: 'مغلقة', active: false, opening_balance: 0 } });
      const to = await seedCashbox(0);

      await expect(transfer(from, inactive, 100)).rejects.toThrow('الخزنة الوجهة غير نشطة.');
      expect(await client.treasury_txn.count({ where: { cashbox_id: from.id } })).toBe(0);

      await transfer(from, to, 100);
      expect(await balanceOf(from.id)).toBe(0);
      expect(await balanceOf(to.id)).toBe(100);
    });
  });

  // ── Other financial paths still behave ────────────────────────────────────────────────────
  describe('other financial paths', () => {
    it('payment, partial refunds within balance, and the refund cap still work', async () => {
      const cashbox = await seedCashbox(0);
      const { payment } = await payInto(cashbox, 300);

      await refundPayment({ id: payment.id, amount: 100, reason: 'جزئي' }, { userId: null });
      await refundPayment({ id: payment.id, amount: 200, reason: 'الباقي' }, { userId: null });
      await expect(refundPayment({ id: payment.id, amount: 1, reason: 'زائد' }, { userId: null }))
        .rejects.toThrow('مبلغ الاسترداد أكبر من المتبقي');
      expect(await balanceOf(cashbox.id)).toBe(0);
    });

    it('a refund larger than the cashbox balance is still refused with the existing message', async () => {
      const cashbox = await seedCashbox(0);
      const sink = await seedCashbox(0);
      const { payment } = await payInto(cashbox, 300);
      await transfer(cashbox, sink, 250);

      await expect(refundPayment({ id: payment.id, amount: 100, reason: 'أكبر من الرصيد' }, { userId: null }))
        .rejects.toThrow('لا يكفي لاسترداد');
      expect(await balanceOf(cashbox.id)).toBe(50);
    });

    it('admission payment + cancel-with-refund still round-trips the cashbox', async () => {
      const cashbox = await seedCashbox(0);
      const admissionId = await seedAdmission();
      await createAdmissionPayment({ admissionId, type: 'deposit', amount: 150, date: '2026-04-05', cashboxId: cashbox.id }, { userId: null });
      expect(await balanceOf(cashbox.id)).toBe(150);

      const { refundTxns } = await cancelAdmissionWithRefund({ admissionId, reason: 'إلغاء' }, { userId: null });
      expect(refundTxns).toHaveLength(1);
      expect(await balanceOf(cashbox.id)).toBe(0);
    });

    it('manual income is accepted regardless of balance; a manual expense on an unknown cashbox is a 400', async () => {
      const cashbox = await seedCashbox(0);
      expect((await manualEntry(cashbox, 'income', 40)).status).toBe(201);
      expect(await balanceOf(cashbox.id)).toBe(40);

      const res = await manualEntry({ id: 'no_such_cashbox' }, 'expense', 10);
      expect(res.status).toBe(400);
    });

    it('reversals keep their existing rule (a correction entry, not balance-gated)', async () => {
      const cashbox = await seedCashbox(0);
      const sink = await seedCashbox(0);
      const income = await manualEntry(cashbox, 'income', 100);
      await transfer(cashbox, sink, 100);

      // Accepted even though it takes the balance below zero (the exact amount is the existing
      // reversal semantics, which P2-3 does not change).
      await reverseTreasuryTxn({ id: income.body.data.id, reason: 'إيراد مسجَّل بالخطأ' }, { userId: null });
      expect(await balanceOf(cashbox.id)).toBeLessThan(0);

      // …but a gated debit afterwards sees the corrected (negative) balance and is refused.
      expect((await manualEntry(cashbox, 'expense', 1)).status).toBe(400);
    });
  });

  // ── Idempotency interaction (P2-2) ────────────────────────────────────────────────────────
  describe('payment idempotency still holds', () => {
    it('a retried payment with the same clientRequestId has one financial effect', async () => {
      const cashbox = await seedCashbox(0);
      const student = await seedStudent(120);
      const input = {
        studentId: student.id, month: 5, year: 2026, amount: 120, method: 'cash',
        payType: 'subscription', date: '2026-05-01', cashboxId: cashbox.id, clientRequestId: crypto.randomUUID(),
      };

      const first = await createPayment(input, { userId: null });
      const second = await createPayment(input, { userId: null });

      expect(second.replay).toBe(true);
      expect(second.payment.id).toBe(first.payment.id);
      expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(1);
      expect(await balanceOf(cashbox.id)).toBe(120);
    });

    it('concurrent duplicate payments racing a concurrent debit: one payment effect, balance exact', async () => {
      const cashbox = await seedCashbox(100);
      const sink = await seedCashbox(0);
      const student = await seedStudent();
      const input = {
        studentId: student.id, month: 6, year: 2026, amount: 80, method: 'cash',
        payType: 'subscription', date: '2026-06-01', cashboxId: cashbox.id, clientRequestId: crypto.randomUUID(),
      };

      const results = await settle([
        createPayment(input, { userId: null }),
        createPayment(input, { userId: null }),
        createPayment(input, { userId: null }),
        transfer(cashbox, sink, 100),
      ]);

      expect(rejected(results)).toHaveLength(0);
      const ids = new Set(results.slice(0, 3).map((r) => r.value.payment.id));
      expect(ids.size).toBe(1);
      expect(await client.payments.count({ where: { student_id: student.id } })).toBe(1);
      expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id, ref_type: 'payment' } })).toBe(1);
      expect(await balanceOf(cashbox.id)).toBe(100 + 80 - 100);
    });
  });
});
