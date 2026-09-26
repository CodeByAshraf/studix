// backend/src/routes/materialDistributionPayment.integration.test.js
// Delivery-tracking → cashbox integration — real PostgreSQL integration (scratch database
// only), same methodology as payments.integration.test.js/materialDistribution.integration.
// test.js. Covers confirmMaterialPayment (materialDistribution.js): confirming "مدفوع"/
// "مدفوع جزئياً" from the "تتبّع التسليم" screen must create a real payments + treasury_txn
// row (reusing createPaymentInTx, the exact same atomic logic the "المدفوعات" screen uses)
// and reconcile the student's inventory_txn delivery record — atomically, with no double
// booking on retries. "غير مدفوع" is out of scope here (unchanged saveMaterialDistribution
// path, already covered by materialDistribution.integration.test.js).
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('materialDistribution.js — confirmMaterialPayment (real PostgreSQL integration)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let client;
  let confirmMaterialPayment;
  let saveMaterialDistribution;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('material_distribution_payment');
    client = scratch.client;
    ({ confirmMaterialPayment, saveMaterialDistribution } = await import('./materialDistribution.js'));
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
    return client.students.create({ data: { id, code: id, name: 'أشرف', status: 'active', ...overrides } });
  }

  async function seedMaterial(overrides = {}) {
    const code = nextId('MAT');
    return client.inv_materials.create({ data: { code, name: 'مذكرة الرياضيات', price: 200, ...overrides } });
  }

  async function seedCashbox(overrides = {}) {
    const id = nextId('cb');
    return client.cashboxes.create({ data: { id, name: 'خزنة اختبار', active: true, opening_balance: 0, ...overrides } });
  }

  it('CASE 1 — full payment: creates payment + treasury_txn for the full price, marks delivery received, remaining becomes 0', async () => {
    const student = await seedStudent();
    const material = await seedMaterial({ price: 200 });
    const cashbox = await seedCashbox();

    const { payment, treasuryTxn, inventoryTxn } = await confirmMaterialPayment({
      materialId: String(material.id), studentId: student.id, payStatus: 'paid', cashboxId: cashbox.id, date: '2026-01-05',
    }, { userId: null });

    expect(Number(payment.amount)).toBe(200);
    expect(payment.payType).toBe('material');
    expect(Number(treasuryTxn.amount)).toBe(200);
    expect(treasuryTxn.type).toBe('income');
    expect(treasuryTxn.paymentId).toBe(payment.id);
    expect(inventoryTxn.paymentId ?? inventoryTxn.payment_id).toBeTruthy();

    const dbInv = await client.inventory_txn.findFirst({ where: { student_id: student.id, material_id: material.id } });
    expect(dbInv.type).toBe('studentDelivery');
    expect(dbInv.legacy_metadata.payStatus).toBe('paid');
    expect(Number(dbInv.legacy_metadata.paidAmount)).toBe(200);
    expect(dbInv.payment_id).toBe(payment.id);

    const paymentRows = await client.payments.findMany({ where: { student_id: student.id } });
    const txnRows = await client.treasury_txn.findMany({ where: { cashbox_id: cashbox.id } });
    expect(paymentRows).toHaveLength(1);
    expect(txnRows).toHaveLength(1);
  });

  it('a client-supplied "amount" is ignored for payStatus "paid" — server always charges the real remaining, never the client value', async () => {
    const student = await seedStudent();
    const material = await seedMaterial({ price: 200 });
    const cashbox = await seedCashbox();

    // العميل يحاول إرسال مبلغ مزيّف (1 ج.م) مع payStatus: 'paid' — يجب ألا يُؤخَذ بالحسبان
    // إطلاقاً؛ الخادم يحسب المبلغ الكامل من سعر المذكرة الحقيقي ناقص المدفوع فعلياً فقط.
    const { payment, treasuryTxn } = await confirmMaterialPayment({
      materialId: String(material.id), studentId: student.id, payStatus: 'paid', amount: 1, cashboxId: cashbox.id, date: '2026-01-05',
    }, { userId: null });

    expect(Number(payment.amount)).toBe(200);
    expect(Number(treasuryTxn.amount)).toBe(200);

    const dbInv = await client.inventory_txn.findFirst({ where: { student_id: student.id, material_id: material.id } });
    expect(Number(dbInv.legacy_metadata.paidAmount)).toBe(200);
    expect(dbInv.legacy_metadata.payStatus).toBe('paid');
  });

  it('CASE 2 — partial payment: +100 of 200, remaining 100, payStatus partial', async () => {
    const student = await seedStudent();
    const material = await seedMaterial({ price: 200 });
    const cashbox = await seedCashbox();

    const { payment, treasuryTxn } = await confirmMaterialPayment({
      materialId: String(material.id), studentId: student.id, payStatus: 'partial', amount: 100, cashboxId: cashbox.id, date: '2026-01-05',
    }, { userId: null });

    expect(Number(payment.amount)).toBe(100);
    expect(Number(treasuryTxn.amount)).toBe(100);

    const dbInv = await client.inventory_txn.findFirst({ where: { student_id: student.id, material_id: material.id } });
    expect(dbInv.legacy_metadata.payStatus).toBe('partial');
    expect(Number(dbInv.legacy_metadata.paidAmount)).toBe(100);

    // بالضبط دفعة واحدة وحركة خزنة واحدة بقيمة 100 — لا شيء إضافي أُنشئ
    const paymentRows = await client.payments.findMany({ where: { student_id: student.id } });
    const txnRows = await client.treasury_txn.findMany({ where: { cashbox_id: cashbox.id } });
    expect(paymentRows).toHaveLength(1);
    expect(txnRows).toHaveLength(1);
    expect(Number(paymentRows[0].amount)).toBe(100);
    expect(Number(txnRows[0].amount)).toBe(100);
  });

  it('CASE 3 — second partial payment completes the booklet: cumulative paid 200, remaining 0, only the new 100 txn is created (not a duplicate of the first)', async () => {
    const student = await seedStudent();
    const material = await seedMaterial({ price: 200 });
    const cashbox = await seedCashbox();

    await confirmMaterialPayment({
      materialId: String(material.id), studentId: student.id, payStatus: 'partial', amount: 100, cashboxId: cashbox.id, date: '2026-01-05',
    }, { userId: null });

    const second = await confirmMaterialPayment({
      materialId: String(material.id), studentId: student.id, payStatus: 'partial', amount: 100, cashboxId: cashbox.id, date: '2026-01-10',
    }, { userId: null });

    expect(Number(second.payment.amount)).toBe(100);

    const dbInv = await client.inventory_txn.findFirst({ where: { student_id: student.id, material_id: material.id } });
    expect(dbInv.legacy_metadata.payStatus).toBe('paid');
    expect(Number(dbInv.legacy_metadata.paidAmount)).toBe(200);

    // لا حركة inventory_txn ثانية — نفس الصف يُحدَّث فقط (received يبقى صحيحاً منذ الدفعة الأولى)
    const invRows = await client.inventory_txn.findMany({ where: { student_id: student.id, material_id: material.id } });
    expect(invRows).toHaveLength(1);

    const paymentRows = await client.payments.findMany({ where: { student_id: student.id, material_id: material.id } });
    expect(paymentRows).toHaveLength(2);
    expect(paymentRows.reduce((s, p) => s + Number(p.amount), 0)).toBe(200);

    const txnRows = await client.treasury_txn.findMany({ where: { cashbox_id: cashbox.id } });
    expect(txnRows).toHaveLength(2);
  });

  it('rejects an amount of zero, a negative amount, an amount greater than remaining, and an amount greater than the booklet price — zero residue each time', async () => {
    const student = await seedStudent();
    const material = await seedMaterial({ price: 200 });
    const cashbox = await seedCashbox();

    for (const amount of [0, -50, 250]) {
      await expect(confirmMaterialPayment({
        materialId: String(material.id), studentId: student.id, payStatus: 'partial', amount, cashboxId: cashbox.id, date: '2026-01-05',
      }, { userId: null })).rejects.toThrow();
    }

    // دفعة جزئية صحيحة أولاً (100)، ثم محاولة دفع 150 أخرى (المتبقي فعلياً 100 فقط)
    await confirmMaterialPayment({
      materialId: String(material.id), studentId: student.id, payStatus: 'partial', amount: 100, cashboxId: cashbox.id, date: '2026-01-05',
    }, { userId: null });
    await expect(confirmMaterialPayment({
      materialId: String(material.id), studentId: student.id, payStatus: 'partial', amount: 150, cashboxId: cashbox.id, date: '2026-01-05',
    }, { userId: null })).rejects.toThrow(/المتبقي/);

    expect(await client.payments.count({ where: { student_id: student.id } })).toBe(1);
    expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(1);
  });

  it('rejects confirmation without a valid/active cashbox, with zero residue', async () => {
    const student = await seedStudent();
    const material = await seedMaterial({ price: 200 });
    const inactiveCashbox = await seedCashbox({ active: false });

    await expect(confirmMaterialPayment({
      materialId: String(material.id), studentId: student.id, payStatus: 'paid', cashboxId: inactiveCashbox.id, date: '2026-01-05',
    }, { userId: null })).rejects.toThrow('الخزنة المحدَّدة غير موجودة أو غير نشطة.');

    await expect(confirmMaterialPayment({
      materialId: String(material.id), studentId: student.id, payStatus: 'paid', cashboxId: 'nonexistent-cashbox', date: '2026-01-05',
    }, { userId: null })).rejects.toThrow('الخزنة المحدَّدة غير موجودة أو غير نشطة.');

    expect(await client.payments.count({ where: { student_id: student.id } })).toBe(0);
    expect(await client.inventory_txn.count({ where: { student_id: student.id } })).toBe(0);
  });

  it('duplicate confirmation (retry after a full payment already succeeded) is rejected — never a second +200 transaction', async () => {
    const student = await seedStudent();
    const material = await seedMaterial({ price: 200 });
    const cashbox = await seedCashbox();

    await confirmMaterialPayment({
      materialId: String(material.id), studentId: student.id, payStatus: 'paid', cashboxId: cashbox.id, date: '2026-01-05',
    }, { userId: null });

    await expect(confirmMaterialPayment({
      materialId: String(material.id), studentId: student.id, payStatus: 'paid', cashboxId: cashbox.id, date: '2026-01-05',
    }, { userId: null })).rejects.toThrow('مدفوعة بالكامل');

    expect(await client.payments.count({ where: { student_id: student.id } })).toBe(1);
    expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(1);
  });

  it('concurrent duplicate confirmations (double-click race) serialize via the advisory lock — only one payment/txn is created, the second sees remaining=0', async () => {
    const student = await seedStudent();
    const material = await seedMaterial({ price: 200 });
    const cashbox = await seedCashbox();

    const attempt = () => confirmMaterialPayment({
      materialId: String(material.id), studentId: student.id, payStatus: 'paid', cashboxId: cashbox.id, date: '2026-01-05',
    }, { userId: null });

    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    expect(await client.payments.count({ where: { student_id: student.id } })).toBe(1);
    expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(1);
  });

  it('transaction failure (bad cashbox, fails before any write) leaves inventory_txn AND treasury_txn untouched — never falsely marked paid', async () => {
    const student = await seedStudent();
    const material = await seedMaterial({ price: 200 });
    const txnCountBefore = await client.treasury_txn.count();

    await expect(confirmMaterialPayment({
      materialId: String(material.id), studentId: student.id, payStatus: 'paid', cashboxId: 'missing', date: '2026-01-05',
    }, { userId: null })).rejects.toThrow();

    expect(await client.inventory_txn.count({ where: { student_id: student.id, material_id: material.id } })).toBe(0);
    expect(await client.payments.count({ where: { student_id: student.id } })).toBe(0);
    expect(await client.treasury_txn.count()).toBe(txnCountBefore);
  });

  // Deep atomicity proof: forces the failure to happen AFTER payment+treasury_txn have
  // already been written inside the SAME outer transaction (the inventory_txn insert that
  // follows createPaymentInTx), using the same crypto.randomUUID() collision technique
  // payments.integration.test.js uses ("rolls back the already-written treasury_txn row...").
  // This proves confirmMaterialPayment's runInTransaction is genuinely one atomic unit
  // spanning payment+treasury+inventory reconciliation — not two separate transactions
  // where the first could commit before the second fails.
  it('a real DB failure at the inventory_txn step (AFTER payment+treasury_txn already succeeded in the same transaction) rolls back the payment and treasury_txn too', async () => {
    const student = await seedStudent();
    const material = await seedMaterial({ price: 200 });
    const cashbox = await seedCashbox();

    const collidingInvId = nextId('collide-inv');
    // صف موجود مسبقاً بنفس id — الإدراج الجديد سيتصادم عليه (P2002) بعد أن يكون الدفع
    // وحركة الخزنة قد كُتبا بنجاح فعلاً داخل نفس المعاملة.
    await client.inventory_txn.create({
      data: {
        id: collidingInvId, number: 'INV-999999', material_id: material.id, type: 'reservation',
        quantity: 1, student_id: null, status: 'active',
      },
    });

    const freshPaymentId = nextId('pay');
    const freshTreasuryTxnId = nextId('tx');
    // ترتيب استدعاءات crypto.randomUUID() داخل confirmMaterialPayment: paymentId (1) ثم
    // treasuryTxnId (2) داخل createPaymentInTx، ثم id سجل inventory_txn الجديد (3).
    const spy = vi.spyOn(crypto, 'randomUUID')
      .mockImplementationOnce(() => freshPaymentId)
      .mockImplementationOnce(() => freshTreasuryTxnId)
      .mockImplementationOnce(() => collidingInvId);

    try {
      await expect(confirmMaterialPayment({
        materialId: String(material.id), studentId: student.id, payStatus: 'paid', cashboxId: cashbox.id, date: '2026-01-05',
      }, { userId: null })).rejects.toThrow();
    } finally {
      spy.mockRestore();
    }

    // الدفعة وحركة الخزنة اللتان "نجحتا" فعلاً داخل المعاملة قبل التصادم يجب ألا تبقيا.
    expect(await client.payments.findUnique({ where: { id: freshPaymentId } })).toBeNull();
    expect(await client.treasury_txn.findUnique({ where: { id: freshTreasuryTxnId } })).toBeNull();
    expect(await client.payments.count({ where: { student_id: student.id } })).toBe(0);
    expect(await client.treasury_txn.count({ where: { cashbox_id: cashbox.id } })).toBe(0);
    // السجل المتصادم الأصلي (طالب آخر تماماً) يبقى وحيداً بلا مساس — لا "استلام" وهمي لطالبنا.
    expect(await client.inventory_txn.count({ where: { student_id: student.id, material_id: material.id } })).toBe(0);
    expect(await client.inventory_txn.findUnique({ where: { id: collidingInvId } })).toMatchObject({ type: 'reservation' });
  });

  it('rejects payStatus "unpaid" — this endpoint is only for paid/partial confirmations', async () => {
    const student = await seedStudent();
    const material = await seedMaterial({ price: 200 });
    const cashbox = await seedCashbox();

    await expect(confirmMaterialPayment({
      materialId: String(material.id), studentId: student.id, payStatus: 'unpaid', cashboxId: cashbox.id, date: '2026-01-05',
    }, { userId: null })).rejects.toThrow();

    expect(await client.payments.count({ where: { student_id: student.id } })).toBe(0);
  });

  // "غير مدفوع" الحقيقي في شاشة تتبّع التسليم لا يمرّ عبر confirmMaterialPayment إطلاقاً —
  // يبقى على مسار saveMaterialDistribution القديم بلا أي كتابة مالية. هذا الاختبار يُثبت
  // ذلك صراحةً (لا يكتفي بفحص الكود): تسجيل استلام+"غير مدفوع" لا يُنشئ أي دفعة أو حركة خزنة.
  it('the real "غير مدفوع" (unpaid) delivery-tracking path (saveMaterialDistribution) creates zero payments and zero treasury transactions', async () => {
    const student = await seedStudent();
    const material = await seedMaterial({ price: 200 });
    const txnCountBefore = await client.treasury_txn.count();
    const paymentCountBefore = await client.payments.count();

    const { records } = await saveMaterialDistribution({
      materialId: String(material.id),
      records: [{ studentId: student.id, received: true, payStatus: 'unpaid', paidAmount: 0, receivedAt: '2026-01-05' }],
    }, { createdBy: null });

    expect(records[0]).toMatchObject({ received: true, payStatus: 'unpaid', paidAmount: 0 });
    expect(await client.payments.count()).toBe(paymentCountBefore);
    expect(await client.treasury_txn.count()).toBe(txnCountBefore);

    const dbInv = await client.inventory_txn.findFirst({ where: { student_id: student.id, material_id: material.id } });
    expect(dbInv.type).toBe('studentDelivery');
    expect(dbInv.payment_id).toBeNull();
    expect(dbInv.legacy_metadata.payStatus).toBe('unpaid');
    expect(Number(dbInv.legacy_metadata.paidAmount)).toBe(0);
  });
});
