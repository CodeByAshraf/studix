// backend/src/routes/treasuryTxn.integration.test.js
// MEDIUM-B1 — اختبارات تكامل حقيقية على PostgreSQL فعلي (قاعدة scratch منفصلة، نفس
// المنهجية الموثَّقة في backend/src/test-helpers/scratchDb.js وpayments.integration.
// test.js). لا mocking لـ Prisma هنا إطلاقاً — reverseTreasuryTxn/transferBetweenCashboxes
// الحقيقيتان غير المعدَّلتان تُستدعيان مباشرة.
//
// npm run test:integration فقط. لو PostgreSQL غير متاح، تُسجَّل حالة "SKIPPED" واحدة
// واضحة بدل فشل صامت أو تخطٍّ غير مُعلَن.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('treasuryTxn.js — real PostgreSQL integration (MEDIUM-B1)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let client;
  let reverseTreasuryTxn;
  let transferBetweenCashboxes;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('treasury');
    client = scratch.client;
    ({ reverseTreasuryTxn, transferBetweenCashboxes } = await import('./treasuryTxn.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  async function seedCashbox(overrides = {}) {
    const id = nextId('cb');
    return client.cashboxes.create({
      data: { id, name: 'خزنة اختبار', active: true, opening_balance: 1000, ...overrides },
    });
  }

  async function seedActiveTxn(cashboxId, overrides = {}) {
    const id = nextId('tx');
    return client.treasury_txn.create({
      data: {
        id, cashbox_id: cashboxId, date: new Date('2026-01-05'), type: 'income',
        category: 'other', amount: 100, method: 'cash', status: 'active', ...overrides,
      },
    });
  }

  describe('reverseTreasuryTxn — inverse behavior, append-only guard, concurrency', () => {
    it('creates a correctly-typed reversal and flips the original to cancelled, leaving other fields untouched', async () => {
      const cashbox = await seedCashbox();
      const original = await seedActiveTxn(cashbox.id, { type: 'income', amount: 250, party: 'أحمد' });

      const { original: updatedOriginal, reversal } = await reverseTreasuryTxn({ id: original.id, reason: 'سبب اختبار' }, { userId: null });

      expect(updatedOriginal.status).toBe('cancelled');
      expect(reversal.type).toBe('expense'); // عكس income
      expect(Number(reversal.amount)).toBe(250);
      expect(reversal.cashboxId).toBe(cashbox.id);
      expect(reversal.refType).toBe('reversal');
      expect(reversal.refId).toBe(original.id);
      expect(reversal.notes).toBe('سبب اختبار');

      const dbOriginal = await client.treasury_txn.findUnique({ where: { id: original.id } });
      expect(dbOriginal.status).toBe('cancelled');
      expect(Number(dbOriginal.amount)).toBe(250); // الأصل لا يُعدَّل بغير status
      expect(dbOriginal.party).toBe('أحمد');
    });

    it('rejects reversing an already-cancelled transaction, creates no new row', async () => {
      const cashbox = await seedCashbox();
      const original = await seedActiveTxn(cashbox.id, { status: 'cancelled' });
      const before = await client.treasury_txn.count();

      await expect(reverseTreasuryTxn({ id: original.id, reason: 'محاولة عكس مكرَّر' }, { userId: null }))
        .rejects.toThrow(/ليست نشطة/);

      expect(await client.treasury_txn.count()).toBe(before);
    });

    it('rejects reversing a transaction linked to another document (ref_type set), creates no new row', async () => {
      const cashbox = await seedCashbox();
      const original = await seedActiveTxn(cashbox.id, { ref_type: 'payment', ref_id: 'p_fake' });
      const before = await client.treasury_txn.count();

      await expect(reverseTreasuryTxn({ id: original.id, reason: 'محاولة عكس حركة مرتبطة' }, { userId: null }))
        .rejects.toThrow(/مرتبطة بمستند آخر/);

      expect(await client.treasury_txn.count()).toBe(before);
    });

    // Deterministic proof, not statistical — this exact race was found to be a real bug
    // during 3B-14B's closure review (see migration/reports/PHASE_3B-14B_TREASURY_TXN_
    // AUDIT.md §17) and fixed via an atomic conditional UPDATE (WHERE status='active').
    // Reinstates that same proof against the current, still-fixed code.
    it('two genuinely concurrent reversal requests on the same transaction: exactly one succeeds, exactly one reversal row exists afterward', async () => {
      const cashbox = await seedCashbox();
      const original = await seedActiveTxn(cashbox.id, { amount: 500 });

      const results = await Promise.allSettled([
        reverseTreasuryTxn({ id: original.id, reason: 'عكس متزامن أ' }, { userId: null }),
        reverseTreasuryTxn({ id: original.id, reason: 'عكس متزامن ب' }, { userId: null }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected  = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const reversalCount = await client.treasury_txn.count({ where: { ref_type: 'reversal', ref_id: original.id } });
      expect(reversalCount).toBe(1);
    });
  });

  describe('transferBetweenCashboxes — atomic opposing pair', () => {
    it('creates two linked rows (expense on source, income on destination) with matching amounts and a shared ref_id', async () => {
      const fromCb = await seedCashbox({ opening_balance: 500 });
      const toCb = await seedCashbox({ opening_balance: 0 });

      const { outTxn, inTxn } = await transferBetweenCashboxes({
        fromCashboxId: fromCb.id, toCashboxId: toCb.id, amount: 200, date: '2026-01-10', method: 'cash',
      }, { userId: null });

      expect(outTxn.type).toBe('expense');
      expect(outTxn.cashboxId).toBe(fromCb.id);
      expect(inTxn.type).toBe('income');
      expect(inTxn.cashboxId).toBe(toCb.id);
      expect(outTxn.refId).toBe(inTxn.refId);
      expect(Number(outTxn.amount)).toBe(200);
      expect(Number(inTxn.amount)).toBe(200);

      const rows = await client.treasury_txn.findMany({ where: { ref_id: outTxn.refId } });
      expect(rows).toHaveLength(2);
    });

    it('rejects a transfer to a nonexistent destination cashbox, creates no rows at all', async () => {
      const fromCb = await seedCashbox({ opening_balance: 500 });
      const before = await client.treasury_txn.count();

      await expect(transferBetweenCashboxes({
        fromCashboxId: fromCb.id, toCashboxId: 'nonexistent_cb', amount: 100, date: '2026-01-10',
      }, { userId: null })).rejects.toThrow('الخزنة الوجهة غير موجودة.');

      expect(await client.treasury_txn.count()).toBe(before);
    });
  });
});
