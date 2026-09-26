// backend/src/routes/admissionCancellation.integration.test.js
// Financial Integrity Audit follow-up (Issue 2) — cancelAdmissionWithRefund
// (backend/src/routes/admissionCancellation.js) had ZERO test coverage before this file:
// the code review found it correctly atomic/signed/balance-checked, but per the audit's own
// rule "code appears correct" is not "verified by test". Real PostgreSQL integration (scratch
// database only), same methodology as payments.integration.test.js/treasuryTxn.integration.
// test.js/admissionPayments.integration.test.js — no mocking of Prisma, the real unmodified
// cancelAdmissionWithRefund/createAdmissionPayment are called directly.
//
// No business logic was changed to make these tests pass — this file only adds proof for the
// existing behavior.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED" test
// is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('admissionCancellation.js — cancelAdmissionWithRefund real PostgreSQL integration', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let client;
  let createAdmissionPayment;
  let cancelAdmissionWithRefund;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('admission_cancellation');
    client = scratch.client;
    ({ createAdmissionPayment } = await import('./admissionPayments.js'));
    ({ cancelAdmissionWithRefund } = await import('./admissionCancellation.js'));
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
      data: { id, number: nextId('NUM'), name: 'قبول اختبار استرداد', stage: 'reserved', reservation_status: 'reserved', ...overrides },
    });
  }

  async function seedCashbox(overrides = {}) {
    const id = nextId('cb');
    return client.cashboxes.create({
      data: { id, name: 'خزنة اختبار استرداد', active: true, opening_balance: 0, ...overrides },
    });
  }

  async function liveBalance(cashboxId) {
    const cashbox = await client.cashboxes.findUnique({ where: { id: cashboxId } });
    const incomeAgg  = await client.treasury_txn.aggregate({ where: { cashbox_id: cashboxId, type: 'income',  status: 'active' }, _sum: { amount: true } });
    const expenseAgg = await client.treasury_txn.aggregate({ where: { cashbox_id: cashboxId, type: 'expense', status: 'active' }, _sum: { amount: true } });
    return Number(cashbox.opening_balance) + Number(incomeAgg._sum.amount ?? 0) - Number(expenseAgg._sum.amount ?? 0);
  }

  // A. النجاح الطبيعي ──────────────────────────────────────────────────────────
  describe('A. normal refund', () => {
    it('cancels the admission, creates a correctly-signed/linked refund treasury_txn on the same cashbox, leaves the original payment immutable, and moves the cashbox balance by exactly the refund amount', async () => {
      const admission = await seedAdmission();
      const cashbox = await seedCashbox({ opening_balance: 1000 });
      const { payment } = await createAdmissionPayment({
        admissionId: admission.id, type: 'deposit', amount: 300, date: '2026-06-01', cashboxId: cashbox.id,
      }, { userId: null });

      const balanceBefore = await liveBalance(cashbox.id);

      const { admission: cancelled, refundTxns } = await cancelAdmissionWithRefund(
        { admissionId: admission.id, reason: 'اختبار استرداد طبيعي' }, { userId: null },
      );

      expect(cancelled.reservationStatus).toBe('cancelled');
      expect(refundTxns).toHaveLength(1);
      const [refundTxn] = refundTxns;
      expect(refundTxn.type).toBe('expense');
      expect(refundTxn.category).toBe('refund');
      expect(refundTxn.refType).toBe('admissionRefund');
      expect(refundTxn.refId).toBe(payment.id);
      expect(refundTxn.cashboxId).toBe(cashbox.id); // نفس خزنة الدفعة الأصلية دائماً
      expect(Number(refundTxn.amount)).toBe(300);

      // الدفعة الأصلية سجل ثابت — لم تُعدَّل بأي شكل (لا عمود refunded عليها إطلاقاً).
      const paymentAfter = await client.admission_payments.findUnique({ where: { id: payment.id } });
      const paymentBefore = await client.admission_payments.findUnique({ where: { id: payment.id } });
      expect(paymentAfter).toEqual(paymentBefore);

      const balanceAfter = await liveBalance(cashbox.id);
      expect(balanceBefore - balanceAfter).toBe(300);
    });

    it('cancelling an admission with zero payments succeeds with an empty refund list — nothing to refund is not an error', async () => {
      const admission = await seedAdmission();

      const { admission: cancelled, refundTxns } = await cancelAdmissionWithRefund(
        { admissionId: admission.id, reason: 'إلغاء بلا دفعات' }, { userId: null },
      );

      expect(cancelled.reservationStatus).toBe('cancelled');
      expect(refundTxns).toHaveLength(0);
    });
  });

  // B. التراجع الذرّي (rollback حقيقي) ─────────────────────────────────────────
  describe('B. atomic rollback', () => {
    it('a real DB failure late in the transaction (admission_system_log PK collision, AFTER the refund treasury_txn already succeeded in the same transaction) rolls back the refund AND the admission cancellation', async () => {
      const admission = await seedAdmission();
      const cashbox = await seedCashbox({ opening_balance: 1000 });
      await createAdmissionPayment({
        admissionId: admission.id, type: 'deposit', amount: 250, date: '2026-06-02', cashboxId: cashbox.id,
      }, { userId: null });

      // صف مسبق في admission_system_log نصطدم به عمداً — نفس أسلوب الاصطدام على
      // payments.id في payments.integration.test.js، لكن هنا على الخطوة الثالثة
      // (سجل "cancelled")، بعد أن يكون refundTxn (الخطوة الثانية) قد نجح فعلاً.
      const collidingLogId = nextId('collide_log');
      await client.admission_system_log.create({
        data: { id: collidingLogId, admission_id: admission.id, activity_type: 'preexisting', timestamp: new Date(), by_user: null, details: null },
      });

      // cancelAdmissionWithRefund يستدعي crypto.randomUUID() بالترتيب: refundTxn.id (لكل
      // دفعة قابلة للاسترداد) أولاً، ثم سجل "cancelled" النشاطي ثانياً.
      const freshRefundTxnId = nextId('refund_tx');
      const spy = vi.spyOn(crypto, 'randomUUID')
        .mockImplementationOnce(() => freshRefundTxnId)  // 1st call: refundTxn.id — يُكتَب بنجاح
        .mockImplementationOnce(() => collidingLogId);   // 2nd call: سجل "cancelled" — يصطدم بالـ PK

      try {
        await expect(cancelAdmissionWithRefund(
          { admissionId: admission.id, reason: 'اختبار تراجع' }, { userId: null },
        )).rejects.toThrow();
      } finally {
        spy.mockRestore();
      }

      // كل شيء يجب أن يتراجع معاً: لا refundTxn متبقٍّ، ولا تغيير على حالة القبول.
      expect(await client.treasury_txn.findUnique({ where: { id: freshRefundTxnId } })).toBeNull();
      const admissionAfter = await client.admissions.findUnique({ where: { id: admission.id } });
      expect(admissionAfter.reservation_status).toBe('reserved');
      expect(await client.treasury_txn.count({ where: { admission_id: admission.id, ref_type: 'admissionRefund' } })).toBe(0);
    });
  });

  // C. الإلغاء/الاسترداد المزدوج ────────────────────────────────────────────────
  describe('C. double refund / double cancel', () => {
    it('a second sequential cancel-with-refund on an already-cancelled admission is safely rejected, no duplicate refund txn', async () => {
      const admission = await seedAdmission();
      const cashbox = await seedCashbox({ opening_balance: 1000 });
      await createAdmissionPayment({
        admissionId: admission.id, type: 'deposit', amount: 200, date: '2026-06-03', cashboxId: cashbox.id,
      }, { userId: null });

      await cancelAdmissionWithRefund({ admissionId: admission.id, reason: 'أول إلغاء' }, { userId: null });

      await expect(cancelAdmissionWithRefund({ admissionId: admission.id, reason: 'محاولة إلغاء ثانية' }, { userId: null }))
        .rejects.toThrow(/قد يكون ملغياً بالفعل/);

      expect(await client.treasury_txn.count({ where: { admission_id: admission.id, ref_type: 'admissionRefund' } })).toBe(1);
    });

    // إثبات حتمي، لا احتمالاً إحصائياً — الضمان يأتي من الحارس الذرّي (UPDATE مشروط على
    // admissions.reservation_status داخل نفس المعاملة)، الذي يُسلسِل الطلبين المتزامنين
    // فعلياً بغض النظر عن التوقيت. نفس منهجية اختبار الاسترداد المتزامن في
    // payments.integration.test.js/treasuryTxn.integration.test.js.
    it('two genuinely concurrent cancel-with-refund requests on the same admission: exactly one succeeds, exactly one refund txn exists afterward', async () => {
      const admission = await seedAdmission();
      const cashbox = await seedCashbox({ opening_balance: 1000 });
      await createAdmissionPayment({
        admissionId: admission.id, type: 'deposit', amount: 150, date: '2026-06-04', cashboxId: cashbox.id,
      }, { userId: null });

      const results = await Promise.allSettled([
        cancelAdmissionWithRefund({ admissionId: admission.id, reason: 'متزامن أ' }, { userId: null }),
        cancelAdmissionWithRefund({ admissionId: admission.id, reason: 'متزامن ب' }, { userId: null }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected  = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      expect(await client.treasury_txn.count({ where: { admission_id: admission.id, ref_type: 'admissionRefund', status: 'active' } })).toBe(1);
      const admissionAfter = await client.admissions.findUnique({ where: { id: admission.id } });
      expect(admissionAfter.reservation_status).toBe('cancelled');
    });
  });

  // D. حدّ الاسترداد ───────────────────────────────────────────────────────────
  describe('D. refund limit', () => {
    it('rejects the refund when the cashbox\'s actual live balance cannot cover it, zero new treasury_txn rows, admission state untouched (rolled back)', async () => {
      const admission = await seedAdmission();
      const cashbox = await seedCashbox({ opening_balance: 1000 });
      const { treasuryTxn: originalTxn } = await createAdmissionPayment({
        admissionId: admission.id, type: 'deposit', amount: 300, date: '2026-06-05', cashboxId: cashbox.id,
      }, { userId: null });

      // نُفرِّغ الخزنة بمصروف حقيقي منفصل — الرصيد الحيّ = 1000 + 300 - 1250 = 50 < 300،
      // فلا يكفي لاسترداد الدفعة الأصلية بالكامل. نفس أسلوب اختبار payments.integration.
      // test.js المكافئ (رصيد الخزنة الحيّ، لا قيمة يرسلها العميل).
      await client.treasury_txn.create({
        data: {
          id: nextId('drain'), cashbox_id: cashbox.id, date: new Date(), type: 'expense', category: 'other',
          amount: 1250, method: 'cash', party: null, notes: 'إفراغ الخزنة للاختبار', ref_type: null, ref_id: null,
        },
      });

      const before = await client.treasury_txn.count();

      await expect(cancelAdmissionWithRefund({ admissionId: admission.id, reason: 'محاولة استرداد يتجاوز الرصيد' }, { userId: null }))
        .rejects.toThrow(/رصيد الخزنة.*لا يكفي/);

      expect(await client.treasury_txn.count()).toBe(before); // لا صف جديد إطلاقاً
      const admissionAfter = await client.admissions.findUnique({ where: { id: admission.id } });
      expect(admissionAfter.reservation_status).toBe('reserved'); // الحارس الذرّي تراجع أيضاً — لا حالة "ملغى بلا استرداد"
      // الحركة الأصلية والمصروف المُستنزِف فقط — لا حركة استرداد زائفة.
      expect(await client.treasury_txn.findMany({ where: { cashbox_id: cashbox.id } })).toHaveLength(2);
      expect((await client.treasury_txn.findUnique({ where: { id: originalTxn.id } }))).not.toBeNull();
    });
  });
});
