// backend/src/routes/payments.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 3B-14C — مسارات payments المخصّصة، تُركَّب قبل الحلقة الديناميكية على نفس
// /api/payments التي تخدمها makeCrudRouter (crud.js) عموماً. payments تبقى ضمن
// READ_ONLY_COLLECTIONS (server.js) — الـ CRUD العام لا يكتب لها إطلاقاً، دفاعاً في
// العمق تحت هذا الملف، الذي يتولّى وحده كل كتابة حقيقية لهذه الـ collection:
//
//   1. POST /            — إنشاء دفعة (ذرّي): يُنشئ treasury_txn (دخل) أولاً، ثم payment
//                           تشير إليه (trg_payment_needs_treasury تفرض هذا الترتيب —
//                           treasury_txn_id NOT NULL عند الإدراج)، ثم يُحدَّث
//                           treasury_txn.payment_id ليشير للدفعة بعد إنشائها (القيدان
//                           المتعاكسان غير deferrable — تحقّق فعلي حيّ أثناء تفتيش هذه
//                           المرحلة — فلا يمكن لأي منهما الإشارة للآخر قبل وجوده).
//   2. POST /:id/refund   — استرداد (ذرّي): حركة treasury_txn جديدة فقط (مصروف)،
//                           مرتبطة بالدفعة — الدفعة نفسها لا تُعدَّل إطلاقاً (immutable).
//                           قفل تشاؤمي (SELECT ... FOR UPDATE) على صفّ الدفعة يمنع سباق
//                           استرداد مزدوج يتجاوز مبلغ الدفعة الأصلي (انظر التعليق داخل
//                           refundPayment أدناه للتفاصيل الكاملة).
//   3. PUT/PATCH/DELETE /:id — محظورة صراحةً (405). الدفعات سجلات مالية ثابتة
//                           (immutable) — لا تعديل حقول مباشر، ولا حذف حقيقي إطلاقاً
//                           (trg_no_delete_payments في القاعدة يمنعه أصلاً بلا استثناء،
//                           نفس نمط treasury_txn تماماً — انظر تقرير القرار للمرحلة).
//
// كل الكتابة هنا خادم-الحقيقة بالكامل: id يُولَّد دائماً هنا (UUID)، created_by يُقرَأ
// حصراً من req.user.id (لا عمود created_by على payments نفسها — الفائدة تنطبق فقط على
// حركة treasury_txn المرتبطة). لا اختيار خزنة ضمني إطلاقاً (قرار صريح): العميل يجب أن
// يرسل cashboxId دائماً؛ غيابها أو عدم نشاطها = فشل واضح، لا افتراض صامت.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import crypto from 'crypto';
import { runInTransaction } from '../lib/transaction.js';
import { lockCashboxForDebit, exceedsBalance } from '../lib/cashboxLedger.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { snakeToCamel } from '../lib/caseMapper.js';
import { parseTreasuryDate } from './treasuryTxn.js';
import { prisma } from '../prisma.js';
import { Prisma } from '@prisma/client';
import { deriveMonthState, resolveMonthlyFee, MONTH_STATE } from '../lib/subscriptionMonth.js';

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

// ── P2-2 — server-side idempotency for payment creation ────────────────────────────────────
// Contract: every payment-creating request carries a client-generated `clientRequestId` — one
// per logical operation (one "add payment" dialog submission), reused unchanged by any retry
// of that same operation. The key BECOMES payments.id, so the existing primary key enforces
// "one payment per key" at commit time, inside the same transaction as the linked treasury_txn
// (no new column, no migration, no in-memory state — safe across restarts):
//   * same key + same payload  -> the original payment/treasury_txn is returned (replay: true);
//                                  nothing new is written, so the financial effect happens once.
//   * same key + different payload -> 409, nothing written.
//   * concurrent requests with one key -> the loser's INSERT hits the primary key, its whole
//                                  transaction (including its treasury_txn) rolls back, and it
//                                  then answers with the winner's result (or 409 on mismatch).
//   * a failed transaction commits nothing, so the key stays free for a retry.
export const CLIENT_REQUEST_ID_RE = /^[A-Za-z0-9-]{16,64}$/;

export function normalizeClientRequestId(raw, { required = false } = {}) {
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw badRequest('clientRequestId مطلوب لإنشاء دفعة (مفتاح منع التكرار).');
    return null;
  }
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!CLIENT_REQUEST_ID_RE.test(key)) throw badRequest('clientRequestId غير صالح.');
  return key;
}

export function idempotencyConflict() {
  const err = new Error('مفتاح الطلب (clientRequestId) استُخدِم بالفعل لدفعة مختلفة البيانات — لم تُسجَّل أي دفعة جديدة. أعد تحميل الصفحة للتحقّق من الدفعة المسجَّلة.');
  err.status = 409;
  err.expose = true;
  return err;
}

function sameDecimal(a, b) {
  return Number(a) === Number(b);
}

function sameDay(a, b) {
  return a instanceof Date && b instanceof Date && a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

// The stored payment (with its treasury_txn) matches the normalized request field-for-field.
// status is server-derived and not part of the request, so it is not compared.
export function paymentMatchesRequest(existing, normalized) {
  const { studentId, groupId, materialIdBig, m, y, amt, method, payType, parsedDate, notes, cashboxId } = normalized;
  return existing.student_id === studentId
    && (existing.group_id ?? null) === (groupId ?? null)
    && (existing.material_id ?? null) === (materialIdBig ?? null)
    && existing.month === m
    && existing.year === y
    && sameDecimal(existing.amount, amt)
    && existing.method === method
    && existing.pay_type === payType
    && sameDay(existing.date, parsedDate)
    && (existing.notes ?? null) === (notes ?? null)
    && existing.treasury_txn_payments_treasury_txn_idTotreasury_txn?.cashbox_id === cashboxId;
}

const PAYMENT_WITH_TXN = { treasury_txn_payments_treasury_txn_idTotreasury_txn: true };

export function findPaymentByClientRequestId(db, clientRequestId) {
  return db.payments.findUnique({ where: { id: clientRequestId }, include: PAYMENT_WITH_TXN });
}

function toPaymentReplay(existing) {
  const { treasury_txn_payments_treasury_txn_idTotreasury_txn: treasuryTxn, ...payment } = existing;
  return {
    payment:     snakeToCamel(serializeBigInt(payment)),
    treasuryTxn: treasuryTxn ? snakeToCamel(treasuryTxn) : null,
    replay:      true,
  };
}

// نفس تسلسل BigInt→نص المستخدَم في crud.js (serializeBigInt) — منسوخ محلياً هنا بدل
// الاستيراد من crud.js (ممنوع تعديله/استيراد داخلياته صراحةً)؛ payments.material_id
// عمود BigInt حقيقي (FK→inv_materials.id)، وJSON.stringify يرمي استثناءً على BigInt خام.
export function serializeBigInt(input) {
  if (typeof input === 'bigint') return input.toString();
  if (Array.isArray(input)) return input.map(serializeBigInt);
  if (input !== null && typeof input === 'object' && typeof input.toJSON !== 'function') {
    const out = {};
    for (const [k, v] of Object.entries(input)) out[k] = serializeBigInt(v);
    return out;
  }
  return input;
}

// قرار Phase 3B-14C المعتمَد صراحةً: توسيع الفحوصات على مستوى القاعدة (widen) لتطابق
// خيارات الفرونت-إند الحقيقية القابلة للاستخدام فعلاً، بدل حذف وظائف مستخدَمة اليوم.
// هاتان القائمتان هما المصدر الوحيد للتحقّق من صحة القيم قبل أي كتابة (mirror لِـ
// chk_payment_type/chk_payment_method بعد التوسيع — انظر migration/reports للمرحلة).
const PAY_TYPES = ['subscription', 'material', 'exam', 'extra', 'other'];
const METHODS   = ['cash', 'transfer', 'instapay', 'check', 'visa'];

// نفس خريطة PAY_TYPE_TO_CATEGORY في src/services/cashboxService.js — منسوخة هنا عمداً
// (لا استيراد عبر حدود frontend/backend). فئة الحركة + وصفها المُشتقّان من نوع الدفع.
const PAY_TYPE_TO_CATEGORY = {
  subscription: { category: 'subscriptions', label: 'اشتراك' },
  material:     { category: 'materials',     label: 'مذكرة' },
  exam:         { category: 'exams',         label: 'رسوم امتحان' },
  extra:        { category: 'revisions',     label: 'مراجعة' },
  other:        { category: 'other',         label: 'دفعة' },
};

// يتحقّق من مدخلات إنشاء دفعة ويطبّعها، بلا أي وصول لقاعدة البيانات — قابلة للاستدعاء
// من أي مستهلك (createPayment هنا، أو نقطة نهاية أخرى تحتاج تركيب هذا الإنشاء داخل
// معاملة أكبر، مثل تأكيد دفعة مذكرة من تتبّع التسليم).
export function validatePaymentInput(input) {
  const {
    studentId, groupId = null, materialId = null, month, year, amount,
    method, payType, date, notes = null, cashboxId,
  } = input || {};

  if (typeof studentId !== 'string' || !studentId.trim()) throw badRequest('الطالب مطلوب.');
  // قرار صريح: لا اختيار ضمني للخزنة إطلاقاً — غياب cashboxId فشل واضح، لا افتراض.
  if (typeof cashboxId !== 'string' || !cashboxId.trim()) throw badRequest('الخزنة مطلوبة.');

  const m = Number(month);
  if (!Number.isInteger(m) || m < 1 || m > 12) throw badRequest('الشهر غير صحيح.');
  const y = Number(year);
  if (!Number.isInteger(y)) throw badRequest('السنة غير صحيحة.');
  const amt = Number(amount);
  if (!amt || amt <= 0) throw badRequest('المبلغ يجب أن يكون أكبر من صفر.');
  if (!METHODS.includes(method)) throw badRequest('طريقة الدفع غير صحيحة.');
  if (!PAY_TYPES.includes(payType)) throw badRequest('نوع الدفع غير صحيح.');
  if (typeof date !== 'string' || !date.trim()) throw badRequest('التاريخ مطلوب.');
  // نفس منطق parseTreasuryDate المستخدَم في treasuryTxn.js بالضبط — قيمة غير قابلة للتحليل
  // كانت ستصل خاماً لـ Prisma (عمودا payments.date وtreasury_txn.date كلاهما @db.Date)
  // فتُنتج PrismaClientValidationError خام (بلا code) يصل كـ 500 عام عبر errorHandler.js.
  const parsedDate = parseTreasuryDate(date);
  if (!parsedDate) throw badRequest('التاريخ غير صالح.');

  let materialIdBig = null;
  if (materialId !== null && materialId !== undefined && materialId !== '') {
    try { materialIdBig = BigInt(materialId); }
    catch { throw badRequest('معرّف المذكرة غير صحيح.'); }
  }

  return { studentId, groupId, materialIdBig, m, y, amt, method, payType, parsedDate, notes, cashboxId };
}

// ── M-01 — monthly subscription state ─────────────────────────────────────────────────────
// Net subscription amount of one student/month: subscription payments minus their ACTIVE
// refunds (the only refund representation — payment-linked treasury rows can never be
// reversed, see reverseTreasuryTxn). Never reads payments.status. `db` is the Prisma client or
// a transaction client.
export async function getSubscriptionMonthNet(db, { studentId, year, month }) {
  const [{ net }] = await db.$queryRaw`
    SELECT (
      COALESCE((SELECT SUM(p.amount) FROM public.payments p
                WHERE p.student_id = ${studentId} AND p.year = ${year} AND p.month = ${month}
                  AND p.pay_type = 'subscription'), 0)
      -
      COALESCE((SELECT SUM(t.amount) FROM public.treasury_txn t
                JOIN public.payments p ON p.id = t.payment_id
                WHERE p.student_id = ${studentId} AND p.year = ${year} AND p.month = ${month}
                  AND p.pay_type = 'subscription'
                  AND t.ref_type = 'refund' AND t.status = 'active'), 0)
    )::numeric AS net`;
  return Number(net);
}

export const SUBSCRIPTION_OVERPAYMENT = 'SUBSCRIPTION_OVERPAYMENT';

function subscriptionOverpayment(remaining) {
  const err = new Error(`المبلغ يتجاوز المتبقي من اشتراك هذا الشهر — المتبقي: ${remaining} ج.م. لم تُسجَّل أي دفعة.`);
  err.status = 409;
  err.expose = true;
  err.code = SUBSCRIPTION_OVERPAYMENT;
  err.remaining = remaining;
  return err;
}

// Thrown inside the transaction when the clientRequestId was committed by a concurrent request
// while this one waited for the month lock — createPayment answers it as a replay/conflict.
const DUPLICATE_CLIENT_REQUEST = 'DUPLICATE_CLIENT_REQUEST';

// جسم معاملة إنشاء الدفعة، مُستخرَج من createPayment ليقبل tx خارجياً — يسمح لمستهلك
// آخر (materialDistribution.js) بتركيبه داخل معاملة Prisma أكبر (دفعة + حركة خزنة +
// تسوية inventory_txn معاً، ذرّياً بالكامل)، بلا أي تغيير على سلوك createPayment نفسها.
// paymentId (P2-2): the caller's validated clientRequestId, used as payments.id so the primary
// key enforces idempotency; omitted -> a fresh UUID (unchanged behavior).
export async function createPaymentInTx(tx, normalized, { userId = null, paymentId: requestedPaymentId = null } = {}) {
  const { studentId, groupId, materialIdBig, m, y, amt, method, payType, parsedDate, notes, cashboxId } = normalized;
  const isSubscription = payType === 'subscription';

  // M-01: one subscription write per student/month at a time. The lock is taken first and held
  // until commit, so the net computed below cannot go stale before this payment is written —
  // two concurrent top-ups are serialized and the second one sees the first one's row.
  if (isSubscription) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`subpay:${studentId}:${y}:${m}`}))`;
    // Idempotency under the lock: a concurrent request with the same key may have committed
    // while this one waited — answer it as a replay, never as an overpayment.
    if (requestedPaymentId && await tx.payments.findUnique({ where: { id: requestedPaymentId }, select: { id: true } })) {
      const dup = new Error('clientRequestId already committed');
      dup.code = DUPLICATE_CLIENT_REQUEST;
      throw dup;
    }
  }

  const student = await tx.students.findUnique({ where: { id: studentId } });
  if (!student) throw badRequest('الطالب غير موجود.');

  // القراءة الحاسمة داخل المعاملة (tx) — لا تجاوز ضمنياً لغياب/تعطّل الخزنة.
  const cashbox = await tx.cashboxes.findUnique({ where: { id: cashboxId } });
  if (!cashbox || !cashbox.active) {
    throw badRequest('الخزنة المحدَّدة غير موجودة أو غير نشطة.');
  }

  let material = null;
  if (materialIdBig !== null) {
    material = await tx.inv_materials.findUnique({ where: { id: materialIdBig } });
    if (!material) throw badRequest('المذكرة غير موجودة.');
  }

  // M-01: payments.status is a record-level snapshot, always server-derived:
  //   * subscription — the month's state right after this payment (deriveMonthState over the
  //     month's net), with the payment refused when it would exceed the remaining amount;
  //   * any other pay type — 'paid': the record is never compared with the monthly fee.
  // Month-level consumers never read this column; they derive the state from the net.
  let status = MONTH_STATE.PAID;
  if (isSubscription) {
    // Fee from the student's own primary group, never from a client-sent groupId.
    const primaryGroup = student.group_id
      ? await tx.groups.findUnique({ where: { id: student.group_id }, select: { price: true } })
      : null;
    const fee = resolveMonthlyFee(student, primaryGroup);
    const netBefore = await getSubscriptionMonthNet(tx, { studentId, year: y, month: m });
    if (fee > 0) {
      const remaining = new Prisma.Decimal(fee).minus(new Prisma.Decimal(netBefore));
      if (new Prisma.Decimal(amt).greaterThan(remaining)) {
        throw subscriptionOverpayment(Math.max(0, remaining.toNumber()));
      }
    }
    status = deriveMonthState(fee, new Prisma.Decimal(netBefore).plus(new Prisma.Decimal(amt)).toNumber());
  }

  const meta = PAY_TYPE_TO_CATEGORY[payType] || PAY_TYPE_TO_CATEGORY.subscription;
  const paymentId      = requestedPaymentId || crypto.randomUUID();
  const treasuryTxnId  = crypto.randomUUID();
  const label = material ? `${meta.label} — ${material.name}` : meta.label;

  // ── الخطوة 1: treasury_txn أولاً، payment_id تبقى NULL مبدئياً ──
  // fk_treasury_payment وpayments_treasury_txn_id_fkey غير deferrable (تحقّق فعلي حيّ
  // أثناء تفتيش هذه المرحلة) — لا يمكن لأيّ صفّ أن يشير للآخر قبل أن يوجد فعلاً في
  // القاعدة. treasury_txn_id مطلوب على payments (trg_payment_needs_treasury) فيُنشأ
  // أولاً؛ payment_id على treasury_txn غير مطلوب بأي trigger فيبقى NULL حتى الخطوة 3.
  await tx.treasury_txn.create({
    data: {
      id:          treasuryTxnId,
      cashbox_id:  cashboxId,
      date:        parsedDate,
      type:        'income',
      category:    meta.category,
      amount:      amt,
      method,
      party:       student.name,
      notes:       notes ? `${label} ${student.name} — ${notes}` : `${label} ${student.name}`,
      ref_type:    'payment',
      ref_id:      paymentId,
      created_by:  userId,
    },
  });

  // ── الخطوة 2: payment، تشير إلى treasury_txn الذي أُنشئ للتو ──
  const payment = await tx.payments.create({
    data: {
      id:              paymentId,
      student_id:      studentId,
      group_id:        groupId,
      material_id:     materialIdBig,
      month:           m,
      year:            y,
      amount:          amt,
      method,
      pay_type:        payType,
      date:            parsedDate,
      status,
      notes,
      treasury_txn_id: treasuryTxnId,
    },
  });

  // ── الخطوة 3: استكمال الرابط المعاكس بعد أن أصبحت الدفعة موجودة فعلاً ──
  const treasuryTxn = await tx.treasury_txn.update({
    where: { id: treasuryTxnId },
    data:  { payment_id: paymentId },
  });

  return { payment, treasuryTxn };
}

// يُصدَّر منفصلاً عن الـ router ليكون قابلاً للاختبار مباشرة بلا HTTP/auth، بنفس مبدأ
// activateAdmission/reverseTreasuryTxn.
//
// P2-2 — clientRequestId (see the idempotency contract at the top of this file). `requireKey`
// is set by the HTTP route, which always demands a key; direct internal callers may omit it.
export async function createPayment(input, { userId = null, requireKey = false } = {}) {
  const clientRequestId = normalizeClientRequestId(input?.clientRequestId, { required: requireKey });
  const normalized = validatePaymentInput(input);

  const replayOrConflict = (existing) => {
    if (!paymentMatchesRequest(existing, normalized)) throw idempotencyConflict();
    return toPaymentReplay(existing);
  };

  if (clientRequestId) {
    const existing = await findPaymentByClientRequestId(prisma, clientRequestId);
    if (existing) return replayOrConflict(existing);
  }

  let result;
  try {
    result = await runInTransaction((tx) => createPaymentInTx(tx, normalized, { userId, paymentId: clientRequestId }));
  } catch (err) {
    // Concurrent request with the same key: this transaction lost the primary-key race (or, for
    // a subscription, found the key committed after waiting for the month lock) and was rolled
    // back entirely (its treasury_txn included) — answer with the committed winner.
    if (clientRequestId && (err.code === 'P2002' || err.code === DUPLICATE_CLIENT_REQUEST)) {
      const existing = await findPaymentByClientRequestId(prisma, clientRequestId);
      if (existing) return replayOrConflict(existing);
    }
    throw err;
  }

  return {
    payment:     snakeToCamel(serializeBigInt(result.payment)),
    treasuryTxn: snakeToCamel(result.treasuryTxn),
  };
}

// يُصدَّر منفصلاً لنفس السبب.
//
// سباق الاسترداد المزدوج (concurrency): القيد "مجموع كل الاستردادات النشطة لهذه الدفعة
// ≤ مبلغها الأصلي" هو قيد على مجموع صفوف أخرى (treasury_txn)، لا على حالة صفّ واحد —
// بخلاف سباق عكس treasury_txn (Phase 3B-14B) الذي أمكن حلّه بشرط داخل UPDATE واحد
// (updateMany where status='active'). هنا لا يوجد "صفّ يُكتَب" يحمل القيد نفسه، فلا
// يوجد شرط WHERE مكافئ يجعل الكتابة ذاتها ذرّية. الحل: قفل تشاؤمي (SELECT ... FOR
// UPDATE) على صفّ الدفعة نفسها لمدة المعاملة كاملة — ليس لأن الصفّ يُعدَّل (لا يُعدَّل
// إطلاقاً، الدفعة ثابتة)، بل كآلية تزامن (mutex) بحتة: طلب استرداد ثانٍ متزامن على نفس
// الدفعة يُحجَب عند محاولة القفل حتى تُثبَّت (commit) معاملة الأول، فيُعاد حساب المجموع
// وقتها مقابل بيانات مُثبَّتة فعلياً، لا بيانات قديمة قد تكون تجاوزتها معاملة أخرى للتو.
// هذا مُثبَت عبر اختبار تزامن حتمي على قاعدة بيانات مؤقتة منفصلة (انظر تقرير الإغلاق)،
// لا "تحقّقاً منطقياً" فقط.
export async function refundPayment({ id, amount, reason }, { userId = null } = {}) {
  if (typeof id !== 'string' || !id.trim()) throw badRequest('id مطلوب.');
  const amt = Number(amount);
  if (!amt || amt <= 0) throw badRequest('مبلغ الاسترداد يجب أن يكون أكبر من صفر.');
  if (typeof reason !== 'string' || !reason.trim()) throw badRequest('سبب الاسترداد مطلوب.');

  const result = await runInTransaction(async (tx) => {
    // القفل التشاؤمي أولاً — يُحجَب هنا حتى تُثبَّت أي معاملة استرداد أخرى متزامنة على
    // نفس الدفعة، قبل أن تُقرَأ أي بيانات أخرى معتمِدة عليها.
    const locked = await tx.$queryRaw`SELECT id FROM payments WHERE id = ${id} FOR UPDATE`;
    if (!Array.isArray(locked) || locked.length === 0) throw badRequest('الدفعة غير موجودة.');

    const payment = await tx.payments.findUnique({ where: { id } });
    if (!payment || !payment.treasury_txn_id) {
      throw badRequest('الدفعة غير مرتبطة بحركة خزنة صحيحة — يتطلّب مراجعة يدوية.');
    }

    // قرار صريح: الاسترداد يستخدم نفس خزنة الدفعة الأصلية دائماً — لا إعادة اختيار،
    // لا خزنة افتراضية بديلة. تُقرَأ من treasury_txn الأصلية (مصدر الحقيقة)، لا من
    // أي حقل قد يُرسله العميل (لا يُقرَأ cashboxId من body هنا إطلاقاً).
    const originalTxn = await tx.treasury_txn.findUnique({ where: { id: payment.treasury_txn_id } });
    if (!originalTxn) throw badRequest('حركة الخزنة الأصلية لهذه الدفعة غير موجودة — يتطلّب مراجعة يدوية.');

    const student = await tx.students.findUnique({ where: { id: payment.student_id } });

    // مجموع كل الاستردادات النشطة السابقة — بعد القفل مباشرة، فتعكس بيانات مُثبَّتة فعلاً.
    const refundedAgg = await tx.treasury_txn.aggregate({
      where:  { payment_id: id, ref_type: 'refund', status: 'active' },
      _sum:   { amount: true },
    });
    const alreadyRefunded = Number(refundedAgg._sum.amount ?? 0);
    const remaining = Number(payment.amount) - alreadyRefunded;
    if (amt > remaining) {
      throw badRequest(`مبلغ الاسترداد أكبر من المتبقي القابل للاسترداد (${remaining} ج.م).`);
    }

    // رصيد الخزنة الحيّ — مُعاد حسابه من صفوف treasury_txn الفعلية، لا من قيمة يرسلها
    // العميل (نفس المبدأ المُقرَّر مسبقاً في تقرير التفتيش الأصلي للنطاق المالي، البند 14).
    // P2-3: قفل صفّ الخزنة أولاً (lockCashboxForDebit) — قفل الدفعة أعلاه يحمي هذه الدفعة
    // وحدها، لا استردادات دفعات أخرى متزامنة على نفس الخزنة.
    const cashboxLock = await lockCashboxForDebit(tx, originalTxn.cashbox_id);
    if (!cashboxLock) throw badRequest('خزنة الدفعة الأصلية غير موجودة — يتطلّب مراجعة يدوية.');
    if (exceedsBalance(amt, cashboxLock.balance)) {
      throw badRequest(`رصيد الخزنة (${Number(cashboxLock.balance)} ج.م) لا يكفي لاسترداد ${amt} ج.م.`);
    }

    // حركة استرداد جديدة فقط — الدفعة نفسها لا تُعدَّل بأي حقل إطلاقاً (immutable).
    const refundTxn = await tx.treasury_txn.create({
      data: {
        id:          crypto.randomUUID(),
        cashbox_id:  originalTxn.cashbox_id,
        date:        new Date(),
        type:        'expense',
        category:    'refund',
        amount:      amt,
        method:      originalTxn.method,
        party:       student?.name || originalTxn.party,
        notes:       reason.trim(),
        ref_type:    'refund',
        ref_id:      id,
        payment_id:  id,
        created_by:  userId,
      },
    });

    return { refundTxn, payment, totalRefunded: alreadyRefunded + amt };
  });

  return {
    refundTxn:     snakeToCamel(result.refundTxn),
    payment:       snakeToCamel(serializeBigInt(result.payment)),
    totalRefunded: result.totalRefunded,
  };
}

const router = Router();

// GET / — Scalability Architecture Phase 4: نفس شكل استجابة GET العام تماماً
// ({ok, data, count}, snakeToCamel/serializeBigInt) — لا فرق ملاحَظ لأي مستهلك حالي.
// بلا أي فلتر في الاستعلام (كما تستدعيها loadFromPostgres/pgGetCollection عند الإقلاع
// اليوم بالضبط) يبقى السلوك مطابقاً 100% للمسار العام غير المُفلتَر (كل الصفوف) — الإضافة
// هنا هي دعم studentId/groupId/month/year اختيارية فقط، لمستهلكين جدد (مثل مانع الدفع
// المكرَّر في PaymentForm.jsx) بلا الحاجة لتحميل كل تاريخ المدفوعات في المتصفح لاحقاً.
// مركَّب قبل الحلقة الديناميكية (نفس مبدأ POST أعلاه) — يستبدل GET العام غير المُفلتَر
// لهذا المسار بالكامل، لا يُضاف بجانبه.
// date/limit/orderBy (Phase 4 continuation): date= يخدم FinancialAnalytics.jsx's todayRev
// (payments.filter(p=>p.date===todayStr) بالضبط — مطابقة تامة، لا نطاق). limit+orderBy
// يخدمان FinancialAnalytics.jsx's "recent" (أحدث 8 دفعات: [...payments].sort(date desc)
// .slice(0,8)) — بلا أي منهما (كالسابق) يبقى السلوك غير المُفلتَر/غير المُرتَّب كما هو.
router.get('/', asyncHandler(async (req, res) => {
  const { studentId, groupId, month, year, date, limit, orderBy } = req.query;
  const where = {};
  if (studentId) where.student_id = studentId;
  if (groupId) where.group_id = groupId;
  if (month !== undefined) where.month = Number(month);
  if (year !== undefined) where.year = Number(year);
  if (date) {
    const parsedDate = parseTreasuryDate(date);
    if (!parsedDate) throw badRequest('date غير صالح.');
    where.date = parsedDate;
  }

  const query = { where };
  if (orderBy === 'date_desc') query.orderBy = { date: 'desc' };
  if (limit !== undefined) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n <= 0) throw badRequest('limit غير صالح.');
    query.take = n;
  }

  const rows = await prisma.payments.findMany(query);
  res.json({ ok: true, data: serializeBigInt(snakeToCamel(rows)), count: rows.length });
}));

// ── GET /aggregate — Scalability Architecture Phase 4 (analytics/reports consumers) ──
// عوملة عامة واحدة لبنية "إيراد صافٍ/عدد مُجمَّع حسب بُعد واحد" المُكرَّرة اليوم بأشكال
// شبه متطابقة عبر عدّة ملفّات (getRevenueByGroup/getMonthlyBreakdown/FinancialAnalytics
// .jsx's byMethod/byStatus/StudentPerformance.jsx's per-student totalPaid) — لا قاعدة
// عمل جديدة، فقط نفس "SUM(amount) - SUM(استرداد فعّال)" الحالي بالضبط، مُبارَمَتراً حسب
// البُعد المطلوب بدل إعادة كتابته handcoded لكل شاشة. groupBy يحدّد عمود التجميع:
//   - method/status: عدّ فقط (نفس byMethod/byStatus الحاليين — لا طرح استرداد، لأنهما
//     عدّ سجلّات لا مجموع مبالغ في الكود الحالي).
//   - group/student/month/day: عدّ + إيراد صافٍ (نفس getRevenueByGroup/getMonthlyBreakdown
//     /StudentPerformance.jsx بالضبط).
//   - none: إجمالي واحد (نفس getNetRevenue(كل الدفعات المُفلترة) بالضبط).
// year/month/groupId/studentId فلاتر اختيارية تُطبَّق قبل التجميع — لا افتراض "الآن" من
// جهة الخادم إطلاقاً (نفس مبدأ كل نقاط النهاية الأخرى في هذا الملف): المستدعي يُرسل
// السنة/الشهر الفعليين الذين يريدهما صراحةً، تماماً كما يفعل العميل اليوم محلياً.
const AGGREGATE_COLUMNS = {
  method: 'method', status: 'status', group: 'group_id', student: 'student_id',
  month: 'month', day: 'date',
};
const COUNT_ONLY_DIMENSIONS = new Set(['method', 'status']); // لا طرح استرداد لهما اليوم

export async function getPaymentAggregates({ groupBy, year, month, groupId, studentId } = {}) {
  if (groupBy !== 'none' && !AGGREGATE_COLUMNS[groupBy]) {
    throw badRequest('groupBy يجب أن يكون أحد: method, status, group, student, month, day, none.');
  }

  const where = {};
  if (year !== undefined && year !== null && year !== '') where.year = Number(year);
  if (month !== undefined && month !== null && month !== '') where.month = Number(month);
  if (groupId) where.group_id = groupId;
  if (studentId) where.student_id = studentId;

  const column = groupBy === 'none' ? null : AGGREGATE_COLUMNS[groupBy];
  const selectFields = { id: true, amount: true };
  if (column) selectFields[column] = true;

  const rows = await prisma.payments.findMany({ where, select: selectFields });

  // نفس getRefundedAmount بالضبط: ref_type='refund' AND status='active' فقط، مُقيَّد
  // بمعرّفات هذه الدفعات تحديداً — استعلام واحد يجلب كل الاستردادات ذات الصلة معاً.
  const paymentIds = rows.map((r) => r.id);
  const refunds = paymentIds.length
    ? await prisma.treasury_txn.findMany({
        where: { payment_id: { in: paymentIds }, ref_type: 'refund', status: 'active' },
        select: { payment_id: true, amount: true },
      })
    : [];
  const refundByPaymentId = new Map();
  for (const r of refunds) {
    refundByPaymentId.set(r.payment_id, (refundByPaymentId.get(r.payment_id) ?? 0) + Number(r.amount));
  }

  if (groupBy === 'none') {
    const grossTotal = rows.reduce((s, p) => s + Number(p.amount), 0);
    const refundTotal = [...refundByPaymentId.values()].reduce((s, v) => s + v, 0);
    return [{ key: null, count: rows.length, revenue: grossTotal - refundTotal }];
  }

  const buckets = new Map(); // key -> { count, gross, refund }
  for (const r of rows) {
    const rawKey = r[column];
    const key = groupBy === 'day' ? (rawKey ? rawKey.toISOString().slice(0, 10) : null) : (rawKey ?? null);
    if (!buckets.has(key)) buckets.set(key, { count: 0, gross: 0, refund: 0 });
    const b = buckets.get(key);
    b.count += 1;
    b.gross += Number(r.amount);
    b.refund += refundByPaymentId.get(r.id) ?? 0;
  }

  return [...buckets.entries()]
    .map(([key, b]) => COUNT_ONLY_DIMENSIONS.has(groupBy)
      ? { key, count: b.count }
      : { key, count: b.count, revenue: b.gross - b.refund })
    .sort((a, b) => (a.key ?? '').toString().localeCompare((b.key ?? '').toString()));
}

router.get('/aggregate', asyncHandler(async (req, res) => {
  const { groupBy, year, month, groupId, studentId } = req.query;
  const data = await getPaymentAggregates({ groupBy, year, month, groupId, studentId });
  res.json({ ok: true, data });
}));

// ── GET /search — Scalability Architecture Phase 4 (PaymentHistory.jsx scoped
// search/pagination replacement) ─────────────────────────────────────────────
// نسخة خادم-الحقيقة بالضبط من التصفية/الفرز/التقسيم/الإجمالي الذي كانت PaymentHistory.jsx
// تحسبه محلياً فوق مصفوفة payments الكاملة (انظر تدقيق المرحلة 4 — لا قاعدة عمل جديدة):
//   - month/groupId/status: مساواة تامة، بنفس ترتيب/دلالة .filter() الحالي بالضبط
//     (لا فلتر سنة هنا عمداً — PaymentHistory.jsx لا تملك عنصر سنة إطلاقاً اليوم).
//   - search: مطابقة اسم الطالب (عبر JOIN حقيقي واحد على العلاقة payments.students، لا
//     تحميل كل الطلاب للواجهة) OR معرّف الدفعة الخام، كلاهما substring غير حسّاس لحالة
//     الأحرف (mode:'insensitive' ≈ ILIKE) — بلا trim، بنفس سلوك `search.toLowerCase()`
//     غير المُهذَّب في PaymentHistory.jsx بالضبط (سلسلة بحث كلها مسافات تُطابق أي اسم
//     يحوي مسافة — سلوك حالي غريب لكن يجب الحفاظ عليه حرفياً).
//   - الترتيب: date DESC ثم created_at DESC. الفرز الحالي في العميل (b.date.localeCompare
//     (a.date) فقط) لا يُحدّد كاسِر تعادل صريحاً لصفوف بنفس التاريخ — الترتيب الفعلي وقتها
//     غير مُعرَّف أصلاً (يعتمد على ترتيب وصول findMany() بلا orderBy عند الإقلاع). بما أن
//     الدفعات ثابتة/append-only فقط (لا UPDATE/DELETE إطلاقاً — انظر رأس الملف)، created_at
//     يقارب ترتيب الإدراج الفعلي بأمان ويحقق "ترتيب حتمي" المطلوب صراحة في هذه المرحلة، بلا
//     أي تغيير ملاحَظ على أي ترتيب حالي فعلي.
//   - التقسيم: صفحة تتجاوز آخر صفحة متاحة تُقرَّب لآخر صفحة (لا نتيجة فارغة) — بنفس
//     paginate() في src/utils/helpers.js بالضبط (totalPages = ceil(total/limit)||1،
//     safePage = max(1,min(page,totalPages))، حتى عند total=0 → صفحة 1 فارغة).
//   - total/totalAmount: على كامل المجموعة المُفلترة (لا الصفحة الحالية فقط)، totalAmount
//     إجمالي خام (لا طرح استرداد) — بنفس totalFiltered الحالي بالضبط (PaymentHistory.jsx لا
//     تطرح أي استرداد من هذا الإجمالي اليوم، بخلاف getPaymentAggregates/getNetRevenue).
// استعلامان فقط دائماً (aggregate واحد للعدّ+المجموع، ثم findMany واحد للصفحة — يُتخطَّى
// كلياً لو total=0) — بلا أي استعلام إضافي لكل صف (لا N+1 لبحث الاسم، JOIN واحد يكفي).
const PAYMENT_STATUSES = ['paid', 'partial', 'unpaid'];

function parsePaginationParam(value, { label, def, min, max }) {
  if (value === undefined || value === null || value === '') return def;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || (max !== undefined && n > max)) {
    throw badRequest(`${label} غير صالح.`);
  }
  return n;
}

export async function searchPayments({ month, groupId, status, search, page, limit } = {}) {
  const where = {};

  if (month !== undefined && month !== null && month !== '') {
    const m = Number(month);
    if (!Number.isInteger(m) || m < 1 || m > 12) throw badRequest('الشهر غير صحيح.');
    where.month = m;
  }
  if (groupId) where.group_id = groupId;
  if (status !== undefined && status !== null && status !== '') {
    if (!PAYMENT_STATUSES.includes(status)) throw badRequest('الحالة غير صحيحة.');
    where.status = status;
  }
  // لا trim — يطابق `search.toLowerCase()` غير المُهذَّب في PaymentHistory.jsx بالضبط.
  if (search) {
    where.OR = [
      { students: { name: { contains: search, mode: 'insensitive' } } },
      { id: { contains: search, mode: 'insensitive' } },
    ];
  }

  const limitN = parsePaginationParam(limit, { label: 'limit', def: 12, min: 1, max: 200 });
  const pageN = parsePaginationParam(page, { label: 'page', def: 1, min: 1 });

  const statsAgg = await prisma.payments.aggregate({ where, _count: { _all: true }, _sum: { amount: true } });
  const total = statsAgg._count._all;
  const totalAmount = Number(statsAgg._sum.amount ?? 0);
  const totalPages = Math.ceil(total / limitN) || 1;
  const effectivePage = Math.max(1, Math.min(pageN, totalPages));
  const skip = (effectivePage - 1) * limitN;

  const rows = total === 0 ? [] : await prisma.payments.findMany({
    where,
    orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
    skip,
    take: limitN,
  });

  return {
    items: serializeBigInt(snakeToCamel(rows)),
    page: effectivePage,
    totalPages,
    total,
    totalAmount,
    hasPrev: effectivePage > 1,
    hasNext: effectivePage < totalPages,
  };
}

router.get('/search', asyncHandler(async (req, res) => {
  const { month, groupId, status, search, page, limit } = req.query;
  const data = await searchPayments({ month, groupId, status, search, page, limit });
  res.json({ ok: true, data });
}));

router.post('/', asyncHandler(async (req, res) => {
  let data;
  try {
    data = await createPayment(req.body, { userId: req.user?.id ?? null, requireKey: true });
  } catch (err) {
    // M-01: the refused-overpayment answer carries the remaining amount for the client.
    if (err.code === SUBSCRIPTION_OVERPAYMENT) {
      return res.status(409).json({ ok: false, error: err.message, code: err.code, remaining: err.remaining });
    }
    throw err;
  }
  // A replay returns the original result (same body shape, `replay: true`), 200 instead of 201.
  res.status(data.replay ? 200 : 201).json({ ok: true, data });
}));

router.post('/:id/refund', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { amount, reason } = req.body || {};
  const data = await refundPayment({ id, amount, reason }, { userId: req.user?.id ?? null });
  res.json({ ok: true, data });
}));

// PUT/PATCH/DELETE /:id — محظورة صراحةً (انظر شرح الملف أعلاه).
function blocked(message) {
  return (req, res) => res.status(405).json({ ok: false, error: message });
}
router.put('/:id',   blocked('لا يمكن تعديل الدفعة مباشرةً — الدفعات سجلات ثابتة. استخدم الاسترداد بدلاً من ذلك.'));
router.patch('/:id', blocked('لا يمكن تعديل الدفعة مباشرةً — الدفعات سجلات ثابتة. استخدم الاسترداد بدلاً من ذلك.'));
router.delete('/:id', blocked('حذف الدفعات غير متاح — الدفعات append-only. استخدم الاسترداد الكامل بدلاً من ذلك.'));

export default router;
