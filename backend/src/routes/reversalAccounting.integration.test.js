// backend/src/routes/reversalAccounting.integration.test.js
// Real-PostgreSQL regression tests for reversal accounting. reverseTreasuryTxn marks the original
// 'cancelled' (excluded by every balance/total consumer) and records the opposite-type reversal
// row as 'cancelled' too — an audit record of the pair. Before the fix the reversal row was
// 'active', so the original's effect was removed twice (a reversed +100 income moved the
// balance by -200). Migration 010 corrects reversal rows written before the fix.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED" test is
// recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { applyFullSchemaDDL } from '../test-helpers/scratchDbFullSchema.js';
import { splitSqlStatements } from '../db/migrationRunner.js';
// The client's own balance engine (pure functions, no imports) — proves server and UI agree.
import {
  getCashboxBalance, getRunningBalance, getSystemOverview, getCashboxStats,
} from '../../../src/services/cashboxService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_010 = path.join(__dirname, '..', '..', 'migrations', '010_reversal_rows_non_financial.sql');

const dbCheck = await checkPostgresReachable();

describe('reversal accounting (real PostgreSQL integration)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client;
  let reverseTreasuryTxn, transferBetweenCashboxes, getCashboxBalanceAsOf, lockCashboxForDebit, runInTransaction;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('reversal_accounting');
    client = scratch.client;
    await applyFullSchemaDDL(client);
    ({ reverseTreasuryTxn, transferBetweenCashboxes } = await import('./treasuryTxn.js'));
    ({ getCashboxBalanceAsOf } = await import('./cashboxBalance.js'));
    ({ lockCashboxForDebit } = await import('../lib/cashboxLedger.js'));
    ({ runInTransaction } = await import('../lib/transaction.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  async function seedCashbox(opening) {
    return client.cashboxes.create({ data: { id: nextId('cb'), name: 'خزنة', active: true, opening_balance: opening } });
  }
  async function seedTxn(cashboxId, overrides = {}) {
    return client.treasury_txn.create({
      data: {
        id: nextId('tx'), cashbox_id: cashboxId, date: new Date('2026-03-01'), type: 'income',
        category: 'other', amount: 100, method: 'cash', status: 'active', ...overrides,
      },
    });
  }
  const reverse = (id) => reverseTreasuryTxn({ id, reason: 'قيد بالخطأ' }, { userId: null });

  // Every balance consumer, server and client, for one cashbox.
  async function balances(cashbox) {
    const server = (await getCashboxBalanceAsOf(cashbox.id)).balance;
    const gate = await runInTransaction(async (tx) => Number((await lockCashboxForDebit(tx, cashbox.id)).balance));
    const rows = (await client.treasury_txn.findMany({ where: { cashbox_id: cashbox.id } })).map((r) => ({
      id: r.id, cashboxId: r.cashbox_id, type: r.type, status: r.status, amount: Number(r.amount),
      date: r.date.toISOString().slice(0, 10),
    }));
    const opening = Number(cashbox.opening_balance);
    const running = getRunningBalance(cashbox.id, rows, opening);
    const [overview] = getSystemOverview([{ ...cashbox, openingBalance: opening }], rows);
    return {
      server,
      gate,
      client: getCashboxBalance(cashbox.id, rows, opening),
      running: running.length ? running[running.length - 1].balance : opening,
      overview: overview.balance,
      overviewNet: overview.net,
      stats: getCashboxStats(cashbox.id, rows),
    };
  }

  function expectAllBalances(b, expected) {
    expect(b.server).toBe(expected);
    expect(b.gate).toBe(expected);
    expect(b.client).toBe(expected);
    expect(b.running).toBe(expected);
    expect(b.overview).toBe(expected);
  }

  describe('income reversal', () => {
    it('reversing a +100 income returns the balance to exactly where it was before the income', async () => {
      const cashbox = await seedCashbox(1000);
      const income = await seedTxn(cashbox.id, { type: 'income', amount: 100 });
      expectAllBalances(await balances(cashbox), 1100);

      const { original, reversal } = await reverse(income.id);

      expect(original.status).toBe('cancelled');
      expect(reversal).toMatchObject({
        type: 'expense', status: 'cancelled', refType: 'reversal', refId: income.id, cashboxId: cashbox.id,
      });
      expect(Number(reversal.amount)).toBe(100);
      const b = await balances(cashbox);
      expectAllBalances(b, 1000);
      // Income/expense totals: the reversed pair contributes nothing to either side.
      expect(b.stats).toMatchObject({ income: 0, expense: 0, net: 0 });
      expect(b.overviewNet).toBe(0);
    });
  });

  describe('expense reversal', () => {
    it('reversing a -100 expense returns the balance to exactly where it was before the expense', async () => {
      const cashbox = await seedCashbox(1000);
      const expense = await seedTxn(cashbox.id, { type: 'expense', amount: 100 });
      expectAllBalances(await balances(cashbox), 900);

      const { reversal } = await reverse(expense.id);

      expect(reversal).toMatchObject({ type: 'income', status: 'cancelled', refType: 'reversal', refId: expense.id });
      const b = await balances(cashbox);
      expectAllBalances(b, 1000);
      expect(b.stats).toMatchObject({ income: 0, expense: 0, net: 0 });
    });
  });

  describe('repeated reversal', () => {
    it('a second reversal of the same entry is rejected and changes nothing', async () => {
      const cashbox = await seedCashbox(500);
      const income = await seedTxn(cashbox.id, { amount: 100 });
      await reverse(income.id);

      await expect(reverse(income.id)).rejects.toMatchObject({ status: 400 });
      expect(await client.treasury_txn.count({ where: { ref_type: 'reversal', ref_id: income.id } })).toBe(1);
      expectAllBalances(await balances(cashbox), 500);
    });

    it('two concurrent reversals of the same entry: exactly one succeeds, balance restored once', async () => {
      const cashbox = await seedCashbox(500);
      const income = await seedTxn(cashbox.id, { amount: 100 });

      const results = await Promise.allSettled([reverse(income.id), reverse(income.id)]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await client.treasury_txn.count({ where: { ref_type: 'reversal', ref_id: income.id } })).toBe(1);
      expectAllBalances(await balances(cashbox), 500);
    });

    it('the reversal record itself cannot be reversed', async () => {
      const cashbox = await seedCashbox(500);
      const income = await seedTxn(cashbox.id, { amount: 100 });
      const { reversal } = await reverse(income.id);

      await expect(reverse(reversal.id)).rejects.toMatchObject({ status: 400 });
      expectAllBalances(await balances(cashbox), 500);
    });
  });

  describe('unrelated transactions', () => {
    it('other entries on the same cashbox and other cashboxes are unaffected', async () => {
      const cashbox = await seedCashbox(1000);
      const other = await seedCashbox(300);
      await seedTxn(cashbox.id, { type: 'income', amount: 400 });
      await seedTxn(cashbox.id, { type: 'expense', amount: 150 });
      const mistaken = await seedTxn(cashbox.id, { type: 'income', amount: 70 });
      await seedTxn(other.id, { type: 'expense', amount: 50 });
      await transferBetweenCashboxes(
        { fromCashboxId: cashbox.id, toCashboxId: other.id, amount: 200, date: '2026-03-02' }, { userId: null },
      );

      await reverse(mistaken.id);

      const b = await balances(cashbox);
      expectAllBalances(b, 1000 + 400 - 150 - 200);
      expect(b.stats).toMatchObject({ income: 400, expense: 350 });
      expectAllBalances(await balances(other), 300 - 50 + 200);
    });

    it('the P2-3 debit gate uses the corrected balance after a reversal', async () => {
      const cashbox = await seedCashbox(100);
      const sink = await seedCashbox(0);
      const expense = await seedTxn(cashbox.id, { type: 'expense', amount: 100 });
      await reverse(expense.id); // back to 100 — not 200 as before the fix

      await expect(transferBetweenCashboxes(
        { fromCashboxId: cashbox.id, toCashboxId: sink.id, amount: 101, date: '2026-03-02' }, { userId: null },
      )).rejects.toMatchObject({ status: 400 });
      await transferBetweenCashboxes(
        { fromCashboxId: cashbox.id, toCashboxId: sink.id, amount: 100, date: '2026-03-02' }, { userId: null },
      );
      expectAllBalances(await balances(cashbox), 0);
    });
  });

  describe('migration 010 — existing reversal pairs', () => {
    async function runMigration010() {
      for (const sql of splitSqlStatements(fs.readFileSync(MIGRATION_010, 'utf8'))) {
        await client.$executeRawUnsafe(sql);
      }
    }

    it('corrects a pre-fix pair (reversal row active) and is idempotent', async () => {
      const cashbox = await seedCashbox(1000);
      const original = await seedTxn(cashbox.id, { type: 'income', amount: 100, status: 'cancelled' });
      const legacyReversal = await seedTxn(cashbox.id, {
        type: 'expense', amount: 100, status: 'active', ref_type: 'reversal', ref_id: original.id,
      });
      expect((await balances(cashbox)).server).toBe(900); // the pre-fix double count

      await runMigration010();
      expectAllBalances(await balances(cashbox), 1000);
      expect((await client.treasury_txn.findUnique({ where: { id: legacyReversal.id } })).status).toBe('cancelled');

      await runMigration010();
      expectAllBalances(await balances(cashbox), 1000);
    });

    it('leaves an inconsistent pair (original still active) and every non-reversal row untouched', async () => {
      const cashbox = await seedCashbox(0);
      const stillActive = await seedTxn(cashbox.id, { type: 'income', amount: 100 });
      const orphanReversal = await seedTxn(cashbox.id, {
        type: 'expense', amount: 100, status: 'active', ref_type: 'reversal', ref_id: stillActive.id,
      });
      const plain = await seedTxn(cashbox.id, { type: 'income', amount: 30 });
      const refund = await seedTxn(cashbox.id, { type: 'expense', amount: 10, ref_type: 'refund', ref_id: crypto.randomUUID() });

      await runMigration010();

      for (const row of [stillActive, orphanReversal, plain, refund]) {
        expect((await client.treasury_txn.findUnique({ where: { id: row.id } })).status).toBe('active');
      }
    });
  });
});
