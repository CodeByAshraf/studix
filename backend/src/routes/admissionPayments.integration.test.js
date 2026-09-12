// backend/src/routes/admissionPayments.integration.test.js
// Production blocker fix pass — real PostgreSQL integration (scratch database only), same
// methodology as payments.integration.test.js/treasuryTxn.integration.test.js. Covers ONLY
// the date-validation fix added to createAdmissionPayment (backend/src/routes/
// admissionPayments.js): invalid date -> 400 (not a raw Prisma 500), and a valid date-only
// value preserving the exact calendar date on both admission_payments.date and the linked
// treasury_txn.date, with no timezone shift. No other admissionPayments.js behavior is
// covered here — this file did not exist before this fix.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('admissionPayments.js — real PostgreSQL integration (date validation)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let client;
  let createAdmissionPayment;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('admission_payments');
    client = scratch.client;
    ({ createAdmissionPayment } = await import('./admissionPayments.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

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

  it('B: rejects an invalid date with a 400-style error instead of a raw Prisma 500, zero residue', async () => {
    const admission = await seedAdmission();
    const cashbox = await seedCashbox();
    const before = await client.treasury_txn.count();

    await expect(createAdmissionPayment({
      admissionId: admission.id, type: 'deposit', amount: 200, date: 'not-a-date', cashboxId: cashbox.id,
    }, { userId: null })).rejects.toMatchObject({ status: 400 });

    expect(await client.admission_payments.count({ where: { admission_id: admission.id } })).toBe(0);
    expect(await client.treasury_txn.count()).toBe(before);
  });

  it('D: accepts a plain YYYY-MM-DD date, preserving the exact calendar date on both admission_payments.date and treasury_txn.date with no timezone shift', async () => {
    const admission = await seedAdmission();
    const cashbox = await seedCashbox();

    const { payment, treasuryTxn } = await createAdmissionPayment({
      admissionId: admission.id, type: 'deposit', amount: 200, date: '2026-05-20', cashboxId: cashbox.id,
    }, { userId: null });

    expect(new Date(payment.date).toISOString().slice(0, 10)).toBe('2026-05-20');
    expect(new Date(treasuryTxn.date).toISOString().slice(0, 10)).toBe('2026-05-20');

    const dbPayment = await client.admission_payments.findUnique({ where: { id: payment.id } });
    const dbTxn = await client.treasury_txn.findUnique({ where: { id: treasuryTxn.id } });
    expect(dbPayment.date.toISOString().slice(0, 10)).toBe('2026-05-20');
    expect(dbTxn.date.toISOString().slice(0, 10)).toBe('2026-05-20');
  });
});
