// backend/src/routes/payments.integration.test.js
// MEDIUM-B1 — اختبارات تكامل حقيقية على PostgreSQL فعلي (قاعدة scratch منفصلة تماماً عن
// studix، أُنشئت ودُفع لها schema.prisma ثم حُذفت بعد الانتهاء — انظر
// backend/src/test-helpers/scratchDb.js للمنهجية الكاملة). لا mocking لـ Prisma هنا
// إطلاقاً — createPayment/refundPayment الحقيقيتان غير المعدَّلتين تُستدعيان مباشرة.
//
// npm run test:integration فقط (ليس npm run test — انظر vitest.integration.config.js).
// لو PostgreSQL غير متاح أو الصلاحية ناقصة، تُسجَّل حالة "SKIPPED" واحدة واضحة بدل فشل
// صامت أو تخطٍّ غير مُعلَن.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('payments.js — real PostgreSQL integration (MEDIUM-B1)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let client;
  let createPayment;
  let refundPayment;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('payments');
    client = scratch.client;
    // استيراد ديناميكي بعد حقن globalThis.prisma — نفس المنهجية المُثبَتة في تقارير
    // إغلاق 3B-14B/3B-14C. لا vi.mock هنا إطلاقاً — الوحدة الحقيقية prisma.js تُستورَد
    // وتلتقط عميل scratch من globalThis.prisma من تلقاء نفسها.
    ({ createPayment, refundPayment } = await import('./payments.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  async function seedStudent(overrides = {}) {
    const id = nextId('s');
    return client.students.create({
      data: { id, code: id, name: 'طالب اختبار', status: 'active', monthly_fee: 300, ...overrides },
    });
  }

  async function seedCashbox(overrides = {}) {
    const id = nextId('cb');
    return client.cashboxes.create({
      data: { id, name: 'خزنة اختبار', active: true, opening_balance: 0, ...overrides },
    });
  }

  describe('createPayment — atomicity and linkage', () => {
    it('creates a payment + treasury_txn together, correctly linked in both directions', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();

      const { payment, treasuryTxn } = await createPayment({
        studentId: student.id, month: 1, year: 2026, amount: 300,
        method: 'cash', payType: 'subscription', date: '2026-01-05', cashboxId: cashbox.id,
      }, { userId: null });

      expect(payment.treasuryTxnId).toBe(treasuryTxn.id);
      expect(treasuryTxn.refId).toBe(payment.id);
      expect(treasuryTxn.refType).toBe('payment');
      expect(treasuryTxn.paymentId).toBe(payment.id);
      expect(treasuryTxn.type).toBe('income');
      expect(Number(treasuryTxn.amount)).toBe(300);

      const paymentRows = await client.payments.findMany({ where: { student_id: student.id } });
      const txnRows = await client.treasury_txn.findMany({ where: { cashbox_id: cashbox.id } });
      expect(paymentRows).toHaveLength(1);
      expect(txnRows).toHaveLength(1);
    });

    it('rejects an inactive cashbox with zero residue in either table', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox({ active: false });

      await expect(createPayment({
        studentId: student.id, month: 1, year: 2026, amount: 300,
        method: 'cash', payType: 'subscription', date: '2026-01-05', cashboxId: cashbox.id,
      }, { userId: null })).rejects.toThrow('الخزنة المحدَّدة غير موجودة أو غير نشطة.');

      expect(await client.payments.count({ where: { student_id: student.id } })).toBe(0);
      expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(0);
    });

    it('rejects a nonexistent student with zero residue', async () => {
      const cashbox = await seedCashbox();
      const before = await client.treasury_txn.count();

      await expect(createPayment({
        studentId: 'nonexistent_student_id', month: 1, year: 2026, amount: 300,
        method: 'cash', payType: 'subscription', date: '2026-01-05', cashboxId: cashbox.id,
      }, { userId: null })).rejects.toThrow('الطالب غير موجود.');

      expect(await client.treasury_txn.count()).toBe(before);
    });

    // Real mid-transaction rollback: step 1 (treasury_txn) must actually commit-then-undo
    // when step 2 (payments) fails for a real DB reason (primary key collision) — not a
    // pre-check failure like the two tests above. crypto.randomUUID() is the only lever
    // createPayment exposes for this from outside (it is not itself modified/mocked).
    it('rolls back the already-written treasury_txn row when the payment insert fails for a real DB reason', async () => {
      const student = await seedStudent();
      const cashbox = await seedCashbox();

      const collidingPaymentId = nextId('collide');
      await client.payments.create({
        data: {
          id: collidingPaymentId, student_id: student.id, month: 1, year: 2026, amount: 1,
          method: 'cash', pay_type: 'subscription', date: new Date('2026-01-01'), status: 'paid',
        },
      });

      const freshTreasuryTxnId = nextId('tx');
      // createPayment يستدعي crypto.randomUUID() لِـ paymentId أولاً في كود المصدر، ثم
      // treasuryTxnId ثانياً (رغم أن treasury_txn هو الذي يُكتَب فعلياً أولاً في الخطوة 1) —
      // ترتيب الاستدعاءات هنا يجب أن يطابق ترتيب التعريف في payments.js، لا ترتيب الكتابة.
      // BUG-01 fix: payments.js now does `import crypto from 'crypto'` explicitly (previously
      // relied on globalThis.crypto — the exact gap that bug fixed) — this test's spy target
      // must be the same imported node:crypto module object, not globalThis.crypto, or it no
      // longer intercepts payments.js's calls at all (Node caches 'crypto' as a singleton, so
      // this import resolves to the identical object payments.js itself imports).
      const spy = vi.spyOn(crypto, 'randomUUID')
        .mockImplementationOnce(() => collidingPaymentId)   // 1st call: paymentId — يتصادم عند الكتابة في الخطوة 2
        .mockImplementationOnce(() => freshTreasuryTxnId);  // 2nd call: treasuryTxnId — يُكتَب بنجاح في الخطوة 1

      try {
        await expect(createPayment({
          studentId: student.id, month: 2, year: 2026, amount: 300,
          method: 'cash', payType: 'subscription', date: '2026-02-05', cashboxId: cashbox.id,
        }, { userId: null })).rejects.toThrow();
      } finally {
        spy.mockRestore();
      }

      // الحركة المالية من الخطوة 1 (نجحت فعلاً داخل المعاملة) يجب ألا تبقى بعد الفشل في
      // الخطوة 2 — هذا هو الإثبات الحقيقي للتراجع (rollback)، لا افتراضاً منطقياً.
      expect(await client.treasury_txn.findUnique({ where: { id: freshTreasuryTxnId } })).toBeNull();
      // السجل الأصلي المتصادم يبقى وحيداً — لا سجل دفعة ثانٍ زائف من المحاولة الفاشلة.
      expect(await client.payments.count({ where: { student_id: student.id } })).toBe(1);
    });
  });

  describe('refundPayment — immutability, balance protection, concurrency', () => {
    async function seedPaidPayment(amount = 300) {
      const student = await seedStudent();
      const cashbox = await seedCashbox({ opening_balance: 1000 });
      const { payment } = await createPayment({
        studentId: student.id, month: 3, year: 2026, amount,
        method: 'cash', payType: 'subscription', date: '2026-03-05', cashboxId: cashbox.id,
      }, { userId: null });
      return { student, cashbox, payment };
    }

    it('partial refund succeeds and leaves the original payment row byte-for-byte unchanged', async () => {
      const { payment } = await seedPaidPayment(300);
      const before = await client.payments.findUnique({ where: { id: payment.id } });

      const { refundTxn, totalRefunded } = await refundPayment({ id: payment.id, amount: 100, reason: 'اختبار استرداد جزئي' }, { userId: null });

      expect(totalRefunded).toBe(100);
      expect(refundTxn.type).toBe('expense');
      expect(refundTxn.refType).toBe('refund');
      expect(refundTxn.paymentId).toBe(payment.id);

      const after = await client.payments.findUnique({ where: { id: payment.id } });
      expect(after).toEqual(before);
    });

    it('rejects a refund exceeding the remaining refundable amount, zero new rows', async () => {
      const { payment } = await seedPaidPayment(300);
      const before = await client.treasury_txn.count();

      await expect(refundPayment({ id: payment.id, amount: 301, reason: 'محاولة استرداد زائد' }, { userId: null }))
        .rejects.toThrow(/أكبر من المتبقي القابل للاسترداد/);

      expect(await client.treasury_txn.count()).toBe(before);
    });

    it('rejects a refund exceeding the cashbox\'s actual live balance, zero new rows', async () => {
      const { cashbox, payment } = await seedPaidPayment(300);
      // نُفرِّغ الخزنة بمصروف حقيقي منفصل — الرصيد الحيّ يُعاد حسابه من الصفوف الفعلية،
      // لا من قيمة يرسلها العميل. الرصيد الحيّ = opening_balance(1000) + دخل الدفعة
      // نفسها(300) - هذا المصروف؛ يجب أن يقل الناتج عن مبلغ الاسترداد المطلوب (300) —
      // 1000+300-1050 = 250 < 300.
      await client.treasury_txn.create({
        data: {
          id: nextId('drain'), cashbox_id: cashbox.id, date: new Date('2026-03-06'),
          type: 'expense', category: 'other', amount: 1050, method: 'cash', status: 'active',
        },
      });
      const before = await client.treasury_txn.count();

      await expect(refundPayment({ id: payment.id, amount: 300, reason: 'رصيد غير كافٍ' }, { userId: null }))
        .rejects.toThrow(/رصيد الخزنة/);

      expect(await client.treasury_txn.count()).toBe(before);
    });

    // Deterministic proof, not a statistical likelihood — the guarantee comes from a real
    // Postgres row lock (SELECT ... FOR UPDATE inside refundPayment), which serializes the
    // two calls regardless of timing. Reinstates the exact proof described in
    // migration/reports/PHASE_3B-14C_PAYMENTS_TREASURY_AUDIT.md §22.5.
    it('two genuinely concurrent refund requests on the same payment: exactly one succeeds, active refunds never exceed the original amount', async () => {
      const { payment } = await seedPaidPayment(100);

      const results = await Promise.allSettled([
        refundPayment({ id: payment.id, amount: 70, reason: 'استرداد متزامن أ' }, { userId: null }),
        refundPayment({ id: payment.id, amount: 70, reason: 'استرداد متزامن ب' }, { userId: null }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected  = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const activeRefundsAgg = await client.treasury_txn.aggregate({
        where: { payment_id: payment.id, ref_type: 'refund', status: 'active' },
        _sum: { amount: true },
      });
      expect(Number(activeRefundsAgg._sum.amount)).toBeLessThanOrEqual(100);
      expect(Number(activeRefundsAgg._sum.amount)).toBe(70);
    });
  });
});
