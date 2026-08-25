// backend/src/routes/dbConstraints.integration.test.js
// MEDIUM-B2 — يتحقّق من الطبقة الوحيدة التي لا يغطيها MEDIUM-B1: triggers/CHECK
// constraints الحقيقية (trg_no_delete_payments/treasury، trg_payment_needs_treasury،
// و9 CHECK constraints)، غير المُمثَّلة إطلاقاً في schema.prisma فلا يُنشئها `db push`.
// قاعدة scratch منفصلة عن ملفي MEDIUM-B1 (namespace مختلف)، بلا أي تعديل عليهما أو على
// scratchDb.js نفسها — الـ DDL يُطبَّق فوقها كخطوة إضافية عبر scratchDbConstraints.js.
//
// npm run test:integration فقط. لو PostgreSQL غير متاح، تُسجَّل حالة "SKIPPED" واحدة
// واضحة بدل فشل صامت أو تخطٍّ غير مُعلَن — نفس نمط ملفي MEDIUM-B1 بالضبط.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import {
  applyTriggersAndConstraints, readAppliedTriggersAndConstraints,
  EXPECTED_TRIGGER_NAMES, EXPECTED_CHECK_CONSTRAINT_NAMES,
} from '../test-helpers/scratchDbConstraints.js';

const dbCheck = await checkPostgresReachable();

describe('payments/treasury_txn — real trigger/CHECK constraint enforcement (MEDIUM-B2)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let client;
  let createPayment;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('constraints');
    client = scratch.client;
    await applyTriggersAndConstraints(client);
    ({ createPayment } = await import('./payments.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  async function seedStudent() {
    const id = nextId('s');
    return client.students.create({ data: { id, code: id, name: 'طالب اختبار', status: 'active' } });
  }

  async function seedCashbox() {
    const id = nextId('cb');
    return client.cashboxes.create({ data: { id, name: 'خزنة اختبار', active: true, opening_balance: 1000 } });
  }

  // دفعة صحيحة كاملة عبر createPayment الحقيقية — تمنحنا treasury_txn_id صالحاً فعلياً
  // لاستخدامه في اختبارات CHECK على payments (يجب أن تتجاوز trigger الربط أولاً حتى
  // تصل لتقييم الـ CHECK المقصود اختباره تحديداً — انظر تقرير التفتيش).
  async function seedValidPaymentTreasuryTxnId() {
    const student = await seedStudent();
    const cashbox = await seedCashbox();
    const { payment } = await createPayment({
      studentId: student.id, month: 1, year: 2026, amount: 100,
      method: 'cash', payType: 'subscription', date: '2026-01-05', cashboxId: cashbox.id,
    }, { userId: null });
    return payment.treasuryTxnId;
  }

  async function insertRawPayment({ id, studentId, month = 1, year = 2026, amount = 100, method = 'cash', payType = 'subscription', date = new Date('2026-01-01'), status = 'paid', treasuryTxnId }) {
    return client.$executeRawUnsafe(
      `INSERT INTO payments (id, student_id, month, year, amount, method, pay_type, date, status, treasury_txn_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      id, studentId, month, year, amount, method, payType, date, status, treasuryTxnId ?? null
    );
  }

  async function insertRawTreasuryTxn({ id, cashboxId, date = new Date('2026-01-01'), type = 'income', category = 'other', amount = 100, method = 'cash', status = 'active' }) {
    return client.$executeRawUnsafe(
      `INSERT INTO treasury_txn (id, cashbox_id, date, type, category, amount, method, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      id, cashboxId, date, type, category, amount, method, status
    );
  }

  it('the scratch database actually has every expected trigger and CHECK constraint applied (not assumed)', async () => {
    const applied = await readAppliedTriggersAndConstraints(client);
    expect(applied.triggers.sort()).toEqual([...EXPECTED_TRIGGER_NAMES].sort());
    expect(applied.constraints.sort()).toEqual([...EXPECTED_CHECK_CONSTRAINT_NAMES].sort());
  });

  describe('trg_no_delete_payments / trg_no_delete_treasury — append-only enforcement', () => {
    it('a raw DELETE on payments is rejected by trg_no_delete_payments, row still exists afterward', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();
      const { payment } = await createPayment({
        studentId: student.id, month: 2, year: 2026, amount: 150,
        method: 'cash', payType: 'subscription', date: '2026-02-05', cashboxId: cashbox.id,
      }, { userId: null });

      await expect(client.$executeRawUnsafe(`DELETE FROM payments WHERE id = $1`, payment.id))
        .rejects.toThrow(/الحذف ممنوع على هذا الجدول/);

      const row = await client.payments.findUnique({ where: { id: payment.id } });
      expect(row).not.toBeNull();
    });

    it('a raw DELETE on treasury_txn is rejected by trg_no_delete_treasury, row still exists afterward', async () => {
      const cashbox = await seedCashbox();
      const txnId = nextId('tx');
      await insertRawTreasuryTxn({ id: txnId, cashboxId: cashbox.id });

      await expect(client.$executeRawUnsafe(`DELETE FROM treasury_txn WHERE id = $1`, txnId))
        .rejects.toThrow(/الحذف ممنوع على هذا الجدول/);

      const row = await client.treasury_txn.findUnique({ where: { id: txnId } });
      expect(row).not.toBeNull();
    });
  });

  describe('trg_payment_needs_treasury — every payment must reference a treasury_txn', () => {
    it('rejects a raw payment insert with treasury_txn_id = NULL, zero residue', async () => {
      const student = await seedStudent();
      const id = nextId('p');
      const before = await client.payments.count();

      await expect(insertRawPayment({ id, studentId: student.id, treasuryTxnId: null }))
        .rejects.toThrow(/كل دفعة جديدة يجب أن ترتبط بحركة خزنة/);

      expect(await client.payments.count()).toBe(before);
    });
  });

  describe('payments CHECK constraints — each isolated via a valid treasury_txn_id', () => {
    it('chk_payment_amount rejects a negative amount, zero residue', async () => {
      const student = await seedStudent();
      const treasuryTxnId = await seedValidPaymentTreasuryTxnId();
      const id = nextId('p');
      const before = await client.payments.count();

      await expect(insertRawPayment({ id, studentId: student.id, amount: -1, treasuryTxnId }))
        .rejects.toThrow(/chk_payment_amount/);

      expect(await client.payments.count()).toBe(before);
    });

    it('chk_payment_method rejects an out-of-vocabulary method, zero residue', async () => {
      const student = await seedStudent();
      const treasuryTxnId = await seedValidPaymentTreasuryTxnId();
      const id = nextId('p');
      const before = await client.payments.count();

      await expect(insertRawPayment({ id, studentId: student.id, method: 'bogus', treasuryTxnId }))
        .rejects.toThrow(/chk_payment_method/);

      expect(await client.payments.count()).toBe(before);
    });

    it('chk_payment_month rejects month = 13, zero residue', async () => {
      const student = await seedStudent();
      const treasuryTxnId = await seedValidPaymentTreasuryTxnId();
      const id = nextId('p');
      const before = await client.payments.count();

      await expect(insertRawPayment({ id, studentId: student.id, month: 13, treasuryTxnId }))
        .rejects.toThrow(/chk_payment_month/);

      expect(await client.payments.count()).toBe(before);
    });

    it('chk_payment_status rejects an out-of-vocabulary status, zero residue', async () => {
      const student = await seedStudent();
      const treasuryTxnId = await seedValidPaymentTreasuryTxnId();
      const id = nextId('p');
      const before = await client.payments.count();

      await expect(insertRawPayment({ id, studentId: student.id, status: 'bogus', treasuryTxnId }))
        .rejects.toThrow(/chk_payment_status/);

      expect(await client.payments.count()).toBe(before);
    });

    it('chk_payment_type rejects an out-of-vocabulary pay_type, zero residue', async () => {
      const student = await seedStudent();
      const treasuryTxnId = await seedValidPaymentTreasuryTxnId();
      const id = nextId('p');
      const before = await client.payments.count();

      await expect(insertRawPayment({ id, studentId: student.id, payType: 'bogus', treasuryTxnId }))
        .rejects.toThrow(/chk_payment_type/);

      expect(await client.payments.count()).toBe(before);
    });
  });

  describe('treasury_txn CHECK constraints', () => {
    // الحد الفعلي المُكتشَف أثناء التفتيش: amount > 0 (وليس >= 0 كما في payments) —
    // صفر بالضبط يُرفَض هنا، بعكس chk_payment_amount الذي يسمح بصفر.
    it('chk_treasury_amount rejects amount = 0 (the actual boundary, strictly greater-than-zero), zero residue', async () => {
      const cashbox = await seedCashbox();
      const id = nextId('tx');
      const before = await client.treasury_txn.count();

      await expect(insertRawTreasuryTxn({ id, cashboxId: cashbox.id, amount: 0 }))
        .rejects.toThrow(/chk_treasury_amount/);

      expect(await client.treasury_txn.count()).toBe(before);
    });

    it('chk_treasury_method rejects an out-of-vocabulary method, zero residue', async () => {
      const cashbox = await seedCashbox();
      const id = nextId('tx');
      const before = await client.treasury_txn.count();

      await expect(insertRawTreasuryTxn({ id, cashboxId: cashbox.id, method: 'bogus' }))
        .rejects.toThrow(/chk_treasury_method/);

      expect(await client.treasury_txn.count()).toBe(before);
    });

    it('chk_treasury_status rejects an out-of-vocabulary status, zero residue', async () => {
      const cashbox = await seedCashbox();
      const id = nextId('tx');
      const before = await client.treasury_txn.count();

      await expect(insertRawTreasuryTxn({ id, cashboxId: cashbox.id, status: 'bogus' }))
        .rejects.toThrow(/chk_treasury_status/);

      expect(await client.treasury_txn.count()).toBe(before);
    });

    it('chk_treasury_type rejects an out-of-vocabulary type, zero residue', async () => {
      const cashbox = await seedCashbox();
      const id = nextId('tx');
      const before = await client.treasury_txn.count();

      await expect(insertRawTreasuryTxn({ id, cashboxId: cashbox.id, type: 'bogus' }))
        .rejects.toThrow(/chk_treasury_type/);

      expect(await client.treasury_txn.count()).toBe(before);
    });
  });
});
