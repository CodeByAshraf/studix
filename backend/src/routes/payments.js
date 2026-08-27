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
import { asyncHandler } from '../middleware/errorHandler.js';
import { snakeToCamel } from '../lib/caseMapper.js';

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

// نفس تسلسل BigInt→نص المستخدَم في crud.js (serializeBigInt) — منسوخ محلياً هنا بدل
// الاستيراد من crud.js (ممنوع تعديله/استيراد داخلياته صراحةً)؛ payments.material_id
// عمود BigInt حقيقي (FK→inv_materials.id)، وJSON.stringify يرمي استثناءً على BigInt خام.
function serializeBigInt(input) {
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

// يُصدَّر منفصلاً عن الـ router ليكون قابلاً للاختبار مباشرة بلا HTTP/auth، بنفس مبدأ
// activateAdmission/reverseTreasuryTxn.
export async function createPayment(input, { userId = null } = {}) {
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

  let materialIdBig = null;
  if (materialId !== null && materialId !== undefined && materialId !== '') {
    try { materialIdBig = BigInt(materialId); }
    catch { throw badRequest('معرّف المذكرة غير صحيح.'); }
  }

  const result = await runInTransaction(async (tx) => {
    const student = await tx.students.findUnique({ where: { id: studentId } });
    if (!student) throw badRequest('الطالب غير موجود.');

    const group = groupId ? await tx.groups.findUnique({ where: { id: groupId } }) : null;

    // القراءة الحاسمة داخل المعاملة (tx) — لا تجاوز ضمنياً لغياب/تعطّل الخزنة.
    const cashbox = await tx.cashboxes.findUnique({ where: { id: cashboxId } });
    if (!cashbox || !cashbox.active) {
      throw badRequest('الخزنة المحدَّدة غير موجودة أو غير نشطة.');
    }

    if (materialIdBig !== null) {
      const material = await tx.inv_materials.findUnique({ where: { id: materialIdBig } });
      if (!material) throw badRequest('المذكرة غير موجودة.');
    }

    // status مُحتسَبة من جهة الخادم دائماً من بيانات رسوم حقيقية (monthly_fee/price) —
    // لا تُقرَأ أبداً من العميل، بنفس مبدأ computeNextStudentCode في admissionActivation.js.
    const fee = Number(student.monthly_fee) || Number(group?.price) || 0;
    const status = fee === 0 ? 'paid' : amt >= fee ? 'paid' : 'partial';

    const meta = PAY_TYPE_TO_CATEGORY[payType] || PAY_TYPE_TO_CATEGORY.subscription;
    const paymentId      = crypto.randomUUID();
    const treasuryTxnId  = crypto.randomUUID();
    const parsedDate     = new Date(date);

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
        notes:       notes ? `${meta.label} ${student.name} — ${notes}` : `${meta.label} ${student.name}`,
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
  });

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
    const cashbox = await tx.cashboxes.findUnique({ where: { id: originalTxn.cashbox_id } });
    const incomeAgg  = await tx.treasury_txn.aggregate({
      where: { cashbox_id: originalTxn.cashbox_id, type: 'income',  status: 'active' }, _sum: { amount: true },
    });
    const expenseAgg = await tx.treasury_txn.aggregate({
      where: { cashbox_id: originalTxn.cashbox_id, type: 'expense', status: 'active' }, _sum: { amount: true },
    });
    const balance = Number(cashbox?.opening_balance ?? 0)
      + Number(incomeAgg._sum.amount ?? 0)
      - Number(expenseAgg._sum.amount ?? 0);
    if (amt > balance) {
      throw badRequest(`رصيد الخزنة (${balance} ج.م) لا يكفي لاسترداد ${amt} ج.م.`);
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

router.post('/', asyncHandler(async (req, res) => {
  const data = await createPayment(req.body, { userId: req.user?.id ?? null });
  res.status(201).json({ ok: true, data });
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
