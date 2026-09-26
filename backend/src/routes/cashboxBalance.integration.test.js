// backend/src/routes/cashboxBalance.integration.test.js
// Scalability Architecture Phase 3 — Treasury Safety Gate. Real PostgreSQL integration
// (scratch database only). Proves getCashboxBalanceAsOf's SQL-aggregate formula matches
// the CURRENT reference implementation (src/services/cashboxService.js's getCashboxBalance:
// `openingBalance + Σincome(status!=cancelled) - Σexpense(status!=cancelled)`) across every
// financial scenario the frontend actually produces — income, expenses, refunds,
// reversals, transfers, opening balances, cancelled/void rows, cashbox isolation, asOf
// dates, date boundaries, empty history, and multiple cashboxes — plus invalid-input error
// behavior. This is the ONLY thing Phase 3's first step touches: TreasuryPage.jsx,
// treasury_txn's presence in PG_COLLECTIONS, and every existing financial write
// transaction are all untouched (confirmed by this file calling only the new read-only
// getCashboxBalanceAsOf, never any write route).
//
// Independent reference: rather than importing the frontend's getCashboxBalance (a
// cross-boundary ESM-extension issue — src/ uses Vite's extensionless imports, which plain
// Node/vitest here cannot resolve), each test computes the expected value by re-deriving it
// directly from the exact same rows this test itself seeded, using the identical predicate
// documented in cashboxBalance.js's own header (status != 'cancelled', summed by type) —
// an independent, hand-verified arithmetic check, not a call into the code under test.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('cashboxBalance.js — getCashboxBalanceAsOf (real PostgreSQL integration, Treasury Safety Gate)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, getCashboxBalanceAsOf;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('cashbox_balance');
    client = scratch.client;
    ({ getCashboxBalanceAsOf } = await import('./cashboxBalance.js'));
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
    return client.cashboxes.create({ data: { id, name: 'خزنة اختبار', active: true, opening_balance: 0, ...overrides } });
  }

  async function seedTxn(cashboxId, overrides = {}) {
    return client.treasury_txn.create({
      data: {
        id: nextId('tx'), cashbox_id: cashboxId, date: new Date('2026-01-05'),
        type: 'income', category: 'other', amount: 100, status: 'active', ...overrides,
      },
    });
  }

  it('A. income only: balance = opening_balance + income', async () => {
    const cashbox = await seedCashbox({ opening_balance: 500 });
    await seedTxn(cashbox.id, { type: 'income', amount: 300 });
    await seedTxn(cashbox.id, { type: 'income', amount: 200 });

    const { balance } = await getCashboxBalanceAsOf(cashbox.id);
    expect(balance).toBe(500 + 300 + 200);
  });

  it('B. expenses only: balance = opening_balance - expense', async () => {
    const cashbox = await seedCashbox({ opening_balance: 1000 });
    await seedTxn(cashbox.id, { type: 'expense', amount: 150, category: 'salaries' });

    const { balance } = await getCashboxBalanceAsOf(cashbox.id);
    expect(balance).toBe(1000 - 150);
  });

  it('C. mixed income and expenses net correctly', async () => {
    const cashbox = await seedCashbox({ opening_balance: 0 });
    await seedTxn(cashbox.id, { type: 'income', amount: 1000 });
    await seedTxn(cashbox.id, { type: 'expense', amount: 300 });
    await seedTxn(cashbox.id, { type: 'income', amount: 50 });

    const { balance } = await getCashboxBalanceAsOf(cashbox.id);
    expect(balance).toBe(1000 - 300 + 50);
  });

  it('D. refund: an income payment plus its expense refund nets down exactly, same as the client formula (which treats a refund as a plain expense row)', async () => {
    const cashbox = await seedCashbox({ opening_balance: 0 });
    const paymentTxn = await seedTxn(cashbox.id, { type: 'income', amount: 300, ref_type: 'payment' });
    const student = await client.students.create({ data: { id: nextId('s'), code: nextId('s'), name: 'طالب اختبار', status: 'active' } });
    const payment = await client.payments.create({
      data: {
        id: nextId('p'), student_id: student.id, month: 1, year: 2026, amount: 300,
        pay_type: 'subscription', date: new Date('2026-01-05'), status: 'paid', treasury_txn_id: paymentTxn.id,
      },
    });
    await seedTxn(cashbox.id, { type: 'expense', category: 'refund', amount: 100, ref_type: 'refund', ref_id: payment.id, payment_id: payment.id });

    const { balance } = await getCashboxBalanceAsOf(cashbox.id);
    expect(balance).toBe(300 - 100);
  });

  it('E. reversal: the original row becomes cancelled (excluded) and the opposite-type reversal row (active) is counted — matches the REAL reverseTreasuryTxn+getCashboxBalance behavior verified empirically (see the Phase 3 report: reversing a +500 income nets to -500, not back to 0)', async () => {
    const cashbox = await seedCashbox({ opening_balance: 0 });
    // يُطابِق تماماً ما ينتجه reverseTreasuryTxn الحقيقي (تحقّق تجريبي مباشر أُجري قبل
    // كتابة هذا الاختبار): الأصل income=500 → status='cancelled' (مستبعَد من المجموع)،
    // + حركة عكس جديدة expense=500 → status='active' (nref_type='reversal', تُحتسَب).
    const original = await seedTxn(cashbox.id, { type: 'income', amount: 500, status: 'cancelled' });
    await seedTxn(cashbox.id, { type: 'expense', amount: 500, ref_type: 'reversal', ref_id: original.id, status: 'active' });

    const { balance } = await getCashboxBalanceAsOf(cashbox.id);
    // النتيجة الفعلية الحقيقية (مؤكَّدة تجريبياً بتشغيل reverseTreasuryTxn الحقيقية على
    // قاعدة scratch): -500، لا صفر — الأصل الملغى يُستبعَد بالكامل (لا يُعوَّض بشيء)،
    // وحركة العكس النشطة (-500) هي المساهمة الوحيدة الفعلية في المجموع.
    expect(balance).toBe(-500);

    // إضافة حركة نشطة أخرى تُثبت أن الأصل الملغى فعلاً مستبعَد بلا أي مساهمة خفية.
    await seedTxn(cashbox.id, { type: 'income', amount: 200 });
    const { balance: balance2 } = await getCashboxBalanceAsOf(cashbox.id);
    expect(balance2).toBe(-500 + 200);
  });

  it('F. transfer: two legs on two different cashboxes each affect only their own cashbox', async () => {
    const cashboxA = await seedCashbox({ opening_balance: 1000 });
    const cashboxB = await seedCashbox({ opening_balance: 0 });
    const transferId = nextId('transfer');
    await seedTxn(cashboxA.id, { type: 'expense', category: 'transfer', amount: 400, ref_type: 'transfer', ref_id: transferId });
    await seedTxn(cashboxB.id, { type: 'income', category: 'transfer', amount: 400, ref_type: 'transfer', ref_id: transferId });

    const { balance: balanceA } = await getCashboxBalanceAsOf(cashboxA.id);
    const { balance: balanceB } = await getCashboxBalanceAsOf(cashboxB.id);
    expect(balanceA).toBe(1000 - 400);
    expect(balanceB).toBe(0 + 400);
  });

  it('G. opening balance alone (zero transactions) is returned exactly', async () => {
    const cashbox = await seedCashbox({ opening_balance: 750 });
    const { balance } = await getCashboxBalanceAsOf(cashbox.id);
    expect(balance).toBe(750);
  });

  it('H. inactive/void (cancelled) transactions are excluded regardless of how they became cancelled', async () => {
    const cashbox = await seedCashbox({ opening_balance: 0 });
    await seedTxn(cashbox.id, { type: 'income', amount: 900, status: 'cancelled' });
    await seedTxn(cashbox.id, { type: 'income', amount: 100, status: 'active' });

    const { balance } = await getCashboxBalanceAsOf(cashbox.id);
    expect(balance).toBe(100); // 900 cancelled row never counted
  });

  it('I. cashbox filtering: transactions on another cashbox never leak into this one\'s balance', async () => {
    const cashboxA = await seedCashbox({ opening_balance: 0 });
    const cashboxB = await seedCashbox({ opening_balance: 0 });
    await seedTxn(cashboxA.id, { type: 'income', amount: 500 });
    await seedTxn(cashboxB.id, { type: 'income', amount: 9999 });

    const { balance } = await getCashboxBalanceAsOf(cashboxA.id);
    expect(balance).toBe(500);
  });

  it('J/K. historical asOf date: excludes transactions after the given date (inclusive of that day), matching the exact day boundary', async () => {
    const cashbox = await seedCashbox({ opening_balance: 0 });
    await seedTxn(cashbox.id, { type: 'income', amount: 100, date: new Date('2026-01-05') });
    await seedTxn(cashbox.id, { type: 'income', amount: 200, date: new Date('2026-01-10') }); // exact boundary date
    await seedTxn(cashbox.id, { type: 'income', amount: 400, date: new Date('2026-01-15') }); // after boundary

    const asOfBoundary = await getCashboxBalanceAsOf(cashbox.id, { asOf: '2026-01-10' });
    expect(asOfBoundary.balance).toBe(100 + 200); // inclusive of the boundary date itself

    const asOfBefore = await getCashboxBalanceAsOf(cashbox.id, { asOf: '2026-01-09' });
    expect(asOfBefore.balance).toBe(100); // one day before the boundary excludes it

    const noAsOf = await getCashboxBalanceAsOf(cashbox.id);
    expect(noAsOf.balance).toBe(100 + 200 + 400); // omitted asOf = current full-history balance (today's exact behavior)
  });

  it('L. empty transaction history: balance is exactly the opening balance, zero rows', async () => {
    const cashbox = await seedCashbox({ opening_balance: 250 });
    const { balance } = await getCashboxBalanceAsOf(cashbox.id);
    expect(balance).toBe(250);
    expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(0);
  });

  it('M. multiple cashboxes computed independently and correctly in the same test run', async () => {
    const cbA = await seedCashbox({ opening_balance: 100 });
    const cbB = await seedCashbox({ opening_balance: 200 });
    const cbC = await seedCashbox({ opening_balance: 300 });
    await seedTxn(cbA.id, { type: 'income', amount: 10 });
    await seedTxn(cbB.id, { type: 'expense', amount: 20 });
    await seedTxn(cbC.id, { type: 'income', amount: 30 });
    await seedTxn(cbC.id, { type: 'expense', amount: 5 });

    expect((await getCashboxBalanceAsOf(cbA.id)).balance).toBe(110);
    expect((await getCashboxBalanceAsOf(cbB.id)).balance).toBe(180);
    expect((await getCashboxBalanceAsOf(cbC.id)).balance).toBe(325);
  });

  it('N. invalid/nonexistent cashbox is rejected with a clear error', async () => {
    await expect(getCashboxBalanceAsOf('nonexistent-cashbox')).rejects.toThrow('الخزنة غير موجودة.');
  });

  it('O. invalid asOf value is rejected with a clear error, not a raw Prisma exception', async () => {
    const cashbox = await seedCashbox();
    await expect(getCashboxBalanceAsOf(cashbox.id, { asOf: 'not-a-date' })).rejects.toThrow('asOf غير صالح.');
    await expect(getCashboxBalanceAsOf(cashbox.id, { asOf: 'not-a-date' })).rejects.toMatchObject({ status: 400 });
  });

  it('P. missing cashboxId is rejected', async () => {
    await expect(getCashboxBalanceAsOf('')).rejects.toThrow('cashboxId مطلوب.');
    await expect(getCashboxBalanceAsOf(undefined)).rejects.toThrow('cashboxId مطلوب.');
  });
});
