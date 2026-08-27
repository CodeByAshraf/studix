// backend/src/routes/admissionPayments.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 3B-14D — إنشاء دفعة قبول (ذرّي): treasury_txn أولاً (دخل)، ثم admission_payment
// تشير إليه — خطوتان فقط، لا ثلاث. القبول والمعاملة/treasury_txn بينهما اتجاه FK واحد
// فقط (admission_payments.treasury_txn_id → treasury_txn.id) — لا عمود عكسي على
// treasury_txn يشير لـ admission_payments (تحقّق فعلي حيّ أثناء تفتيش هذه المرحلة)، فلا
// حاجة لخطوة "تحديث الرابط المعاكس لاحقاً" التي احتاجتها payments.js في 3B-14C. الربط
// الدقيق (traceability) يتحقق عبر ref_type/ref_id العامّين (غير مقيَّدين بأي CHECK)، لا
// عمود جديد ولا FK جديد لهذا الغرض.
//
// PUT/PATCH/DELETE /:id محظورة صراحةً (405) — سجلات مالية ثابتة (immutable)، والحذف
// محظور مضاعفاً: trg_no_delete_admission_payments في القاعدة (بلا استثناء، نفس نمط
// treasury_txn/payments) + هذا الحارس عند حدود الـ API.
//
// عملية "إلغاء الحجز + الاسترداد" (كتابة مركّبة تمسّ admissions أيضاً) في ملف منفصل
// تماماً: backend/src/routes/admissionCancellation.js — قرار صريح لهذه المرحلة: لا
// تعديل على admissionActivation.js (كل ملف مسؤولية واحدة، بنفس نمط examDelete.js/
// examGrades.js الحالي في هذا الكود).
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

// مطابقة chk_adm_pay_type الحيّة تماماً — مُعاد التحقّق منها فعلياً هذه المرحلة، مطابقة
// بالفعل 4/4 لـ PaymentType الفرونت-إند (src/modules/admissions/constants.js)، لا
// تناقض مفردات هنا (بعكس payments.pay_type في 3B-14C) — لا حاجة لتوسيع أي CHECK.
const PAYMENT_TYPES = ['deposit', 'booklets', 'course', 'other'];
// لا اختيار طريقة دفع في واجهة القبول إطلاقاً اليوم (تحقّق فعلي حيّ) — 'cash' افتراضي
// دائماً، لكن القيمة تُرسَل أيضاً لِـ treasury_txn.method (مُقيَّد فعلياً بـ CHECK)، فيُتحقَّق
// منها دفاعاً في العمق ضد أي قيمة غير متوقَّعة مستقبلاً — نفس قائمة treasury_txn الحيّة.
const METHODS = ['cash', 'transfer', 'instapay', 'check', 'visa'];

const PAYMENT_TO_CASHBOX_CATEGORY = {
  deposit:  'revisions',
  booklets: 'materials',
  course:   'subscriptions',
  other:    'other',
};

// نفس تسميات ADMISSION_PAYMENT_TYPES في src/modules/admissions/mockData.js — منسوخة
// هنا فقط لبناء وصف افتراضي مقروء لحركة treasury_txn (عمود notes، يُعرَض كـ description
// في DetailsPanel المالي)، لا علاقة له بعمود notes الحرّ على admission_payments نفسها.
const PAYMENT_TYPE_LABELS = {
  deposit:  'دفعة حجز',
  booklets: 'مذكرات',
  course:   'رسوم الدروس',
  other:    'أخرى',
};

// يُصدَّر منفصلاً عن الـ router ليكون قابلاً للاختبار مباشرة بلا HTTP/auth.
export async function createAdmissionPayment(input, { userId = null } = {}) {
  const {
    admissionId, type, amount, date, method = 'cash', notes = null, materialId = null, cashboxId,
  } = input || {};

  if (typeof admissionId !== 'string' || !admissionId.trim()) throw badRequest('سجل القبول مطلوب.');
  if (typeof cashboxId !== 'string' || !cashboxId.trim()) throw badRequest('الخزنة مطلوبة.');
  if (!PAYMENT_TYPES.includes(type)) throw badRequest('نوع الدفعة غير صحيح.');
  const amt = Number(amount);
  if (!amt || amt <= 0) throw badRequest('المبلغ يجب أن يكون أكبر من صفر.');
  if (!METHODS.includes(method)) throw badRequest('طريقة الدفع غير صحيحة.');
  if (typeof date !== 'string' || !date.trim()) throw badRequest('التاريخ مطلوب.');

  let materialIdBig = null;
  if (materialId !== null && materialId !== undefined && materialId !== '') {
    try { materialIdBig = BigInt(materialId); }
    catch { throw badRequest('معرّف المذكرة غير صحيح.'); }
  }

  const result = await runInTransaction(async (tx) => {
    const admission = await tx.admissions.findUnique({ where: { id: admissionId } });
    if (!admission) throw badRequest('سجل القبول غير موجود.');

    // القراءة الحاسمة داخل المعاملة — لا تجاوز ضمنياً لغياب/تعطّل الخزنة (قرار صريح).
    const cashbox = await tx.cashboxes.findUnique({ where: { id: cashboxId } });
    if (!cashbox || !cashbox.active) {
      throw badRequest('الخزنة المحدَّدة غير موجودة أو غير نشطة.');
    }

    if (materialIdBig !== null) {
      const material = await tx.inv_materials.findUnique({ where: { id: materialIdBig } });
      if (!material) throw badRequest('المذكرة غير موجودة.');
    }

    const category = PAYMENT_TO_CASHBOX_CATEGORY[type] || 'other';
    const admissionPaymentId = crypto.randomUUID();
    const parsedDate = new Date(date);

    // ── الخطوة 1: treasury_txn أولاً (تحتاجها admission_payments لاحقاً — trigger) ──
    const treasuryTxn = await tx.treasury_txn.create({
      data: {
        id:          crypto.randomUUID(),
        cashbox_id:  cashboxId,
        date:        parsedDate,
        type:        'income',
        category,
        amount:      amt,
        method,
        party:       admission.name,
        notes:       `${PAYMENT_TYPE_LABELS[type] || 'دفعة'} — ${admission.name} (قبول)${notes ? ` — ${notes}` : ''}`,
        ref_type:    'admissionPayment',
        ref_id:      admissionPaymentId,
        admission_id: admissionId,
        created_by:  userId,
      },
    });

    // ── الخطوة 2 (الأخيرة): admission_payments، تشير لِـ treasury_txn أعلاه ──
    // لا خطوة ثالثة — لا عمود عكسي على treasury_txn يحتاج تحديثاً لاحقاً (بعكس 3B-14C).
    const payment = await tx.admission_payments.create({
      data: {
        id:              admissionPaymentId,
        admission_id:    admissionId,
        type,
        amount:          amt,
        date:            parsedDate,
        method,
        notes,
        material_id:     materialIdBig,
        treasury_txn_id: treasuryTxn.id,
      },
    });

    // سجل النشاط النظامي — نفس الأحداث التي كانت تُسجَّل محلياً سابقاً (best-effort، خارج
    // أي معاملة)، الآن جزء من نفس المعاملة الذرّية — تحسين مُكتشَف أثناء هذا التنفيذ، لا
    // قراراً مطلوباً صراحةً، لكنه يخدم نفس مبدأ "التتبّع الدقيق" المطلوب لهذه المرحلة.
    // تُعاد ضمن الاستجابة (logs) ليتبنّاها العميل فوراً في admissionSystemLog المحلي —
    // نفس السلوك الحالي (logEvent's setAdmissionSystemLog فور النجاح)، لا يتراجع.
    const logs = [];
    logs.push(await tx.admission_system_log.create({
      data: {
        id: crypto.randomUUID(), admission_id: admissionId, activity_type: 'paymentReceived',
        timestamp: new Date(), by_user: userId, details: `${type}: ${amt} ج.م`,
      },
    }));
    if (type === 'booklets') {
      logs.push(await tx.admission_system_log.create({
        data: {
          id: crypto.randomUUID(), admission_id: admissionId, activity_type: 'bookletsDelivered',
          timestamp: new Date(), by_user: userId, details: null,
        },
      }));
    }

    return { payment, treasuryTxn, logs };
  });

  return {
    payment:     snakeToCamel(serializeBigInt(result.payment)),
    treasuryTxn: snakeToCamel(result.treasuryTxn),
    logs:        result.logs.map(snakeToCamel),
  };
}

const router = Router();

router.post('/', asyncHandler(async (req, res) => {
  const data = await createAdmissionPayment(req.body, { userId: req.user?.id ?? null });
  res.status(201).json({ ok: true, data });
}));

function blocked(message) {
  return (req, res) => res.status(405).json({ ok: false, error: message });
}
router.put('/:id',   blocked('لا يمكن تعديل دفعة القبول مباشرةً — سجلات ثابتة. استخدم إلغاء الحجز مع الاسترداد بدلاً من ذلك.'));
router.patch('/:id', blocked('لا يمكن تعديل دفعة القبول مباشرةً — سجلات ثابتة. استخدم إلغاء الحجز مع الاسترداد بدلاً من ذلك.'));
router.delete('/:id', blocked('حذف دفعات القبول غير متاح — append-only. استخدم إلغاء الحجز مع الاسترداد بدلاً من ذلك.'));

export default router;
