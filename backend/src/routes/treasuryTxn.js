// backend/src/routes/treasuryTxn.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 3B-14B — مسارات treasury_txn المخصّصة، تُركَّب قبل الحلقة الديناميكية على
// نفس /api/treasuryTxn التي تخدمها makeCrudRouter (crud.js) عموماً. هذا الملف
// يتولّى فقط ما لا يمكن للـ CRUD العام أن يخدمه بأمان أو بشكل صحيح:
//
//   1. POST /            — يمرّ فعلياً للـ CRUD العام (لا route هنا يطابقه)، لكن بعد
//                           أن يستبدل هذا middleware أي created_by يرسله العميل بـ
//                           req.user.id فقط — crud.js نفسه لا يملك أي آلية لحقن قيمة
//                           مُشتقّة من الجلسة، ولا يجوز تعديله (قرار Phase 3B-14B).
//   2. PUT  /:id/reverse  — عكس عملية (ذرّي): يُنشئ حركة معاكسة مرتبطة + يُحدّث حالة
//                           الأصل إلى 'cancelled' فقط، في معاملة واحدة لا تنقسم.
//   3. POST /transfer     — تحويل بين خزنتين (ذرّي): ينشئ زوج حركتين مرتبطتين معاً،
//                           كلتاهما أو لا شيء.
//   4. PUT/PATCH/DELETE /:id — محظورة صراحةً (405). لا مسار تعديل حقول مباشر حياً
//                           اليوم (updateTreasuryTxn المحلي غير مستخدَم إطلاقاً في أي
//                           واجهة)، والسماح به عبر الـ CRUD العام يفتح تعديلاً حراً
//                           لأي حقل في سجل دفتر يُفترَض أن يكون "append-only بالمعنى
//                           العملي" (لا يُعدَّل إلا عبر عكس صريح). الحذف محظور مضاعفاً:
//                           trg_no_delete_treasury (DB) يمنعه أصلاً بلا أي استثناء؛
//                           هذا الحارس يضيف رسالة 405 واضحة عند حدود الـ API بدل ترك
//                           الاستثناء الخام من القاعدة يصل كخطأ 500 غامض (قرار صريح).
//
// كل الكتابة هنا خادم-الحقيقة بالكامل: لا id يُرسَل من العميل يُعتمَد (UUID يُولَّد هنا
// دائماً)، لا created_by يُقرَأ من body إطلاقاً — فقط req.user.id. نفس بنية
// admissionActivation.js بالضبط: دالة مُصدَّرة قابلة للاختبار مباشرة + router رقيق.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { runInTransaction } from '../lib/transaction.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { snakeToCamel } from '../lib/caseMapper.js';

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

// يُصدَّر منفصلاً عن الـ router ليكون قابلاً للاختبار مباشرة بلا HTTP/auth، بنفس مبدأ
// activateAdmission في admissionActivation.js.
export async function reverseTreasuryTxn({ id, reason }, { userId = null } = {}) {
  if (typeof id !== 'string' || !id.trim()) throw badRequest('id مطلوب.');
  if (typeof reason !== 'string' || !reason.trim()) throw badRequest('سبب العكس مطلوب.');

  const result = await runInTransaction(async (tx) => {
    // القراءة الحاسمة داخل المعاملة (tx)، لا العميل الخام قبلها — نفس مبدأ
    // admissionActivation.js بالضبط: يمنع سباق عكس مزدوج لنفس العملية (طلبان متزامنان
    // يريان كلاهما status='active' لو قُرئا خارج المعاملة، فينشئان عكسين اثنين).
    const original = await tx.treasury_txn.findUnique({ where: { id } });
    if (!original) throw badRequest('العملية غير موجودة.');
    if (original.status !== 'active') {
      throw badRequest('العملية ليست نشطة — قد تكون مُعكوسة بالفعل.');
    }
    // نفس القيد المفروض بالفعل على زر العكس في LedgerTable.jsx الحقيقي
    // (tx.status==='active' && !tx.refType) — نفرضه هنا أيضاً عند حدود الـ API، لا في
    // الواجهة فقط: لا عكس مباشر لطرف تحويل (سيُضاف ref_type='payment' لاحقاً في
    // Phase 3B-14C، خارج نطاق هذه المرحلة تماماً — القيد هنا يحمي مسبقاً من إساءة
    // استخدام هذا المسار لعكس حركات مرتبطة قبل أن تُصمَّم تلك المرحلة أصلاً).
    if (original.ref_type) {
      throw badRequest('لا يمكن عكس حركة مرتبطة بمستند آخر مباشرةً.');
    }

    // حارس ذرّي ضد سباق عكس مزدوج: findUnique أعلاه وحدها غير كافية — قراءة عادية لا
    // تأخذ قفلاً، فطلبان متزامنان قد يريا كلاهما status='active' قبل أن يكتب أيّ منهما
    // شيئاً (اكتُشف هذا فعلياً عبر اختبار تزامن حتمي على قاعدة بيانات مؤقتة منفصلة أثناء
    // إغلاق 3B-14B — لم يكن افتراضاً نظرياً). الإصلاح: شرط status='active' يُنقَل إلى
    // الـ WHERE في UPDATE نفسه بدل أن يبقى فحصاً تطبيقياً منفصلاً عن الكتابة — Postgres
    // يُسرِّي (serializes) عبر قفل الصف الذي يفرضه UPDATE نفسه: الطلب الثاني يُحجَب خلف
    // معاملة الأول حتى تُثبَّت (commit)، ثم يُعاد تقييم WHERE مقابل الحالة المُثبَّتة
    // الفعلية — فيُطابِق صفراً من الصفوف إن كان الأصل قد أصبح 'cancelled' بالفعل، فيُرفَض
    // بدل أن يُكمِل إنشاء عكس مكرَّر. هذا الحارس هو مصدر الحقيقة الوحيد لسباق التزامن؛
    // الفحص أعلاه (`original.status !== 'active'`) يبقى فقط كرفض مبكر رخيص للحالة غير
    // المتزامنة الشائعة (نقر مزدوج تسلسلي، لا سباق حقيقي).
    const { count } = await tx.treasury_txn.updateMany({
      where: { id, status: 'active' },
      data:  { status: 'cancelled' },
    });
    if (count !== 1) {
      throw badRequest('العملية ليست نشطة — قد تكون مُعكوسة بالفعل.');
    }

    // لا عمود description/reversal_id/reversal_reason/updated_at على treasury_txn
    // إطلاقاً (تحقّق فعلي حيّ من المخطّط عبر سكريبت تحقّق مضمون التراجع — ليس افتراضاً؛
    // اكتُشف هذا أثناء تنفيذ 3B-14B نفسها). الحقول الوصفية الوحيدة المتاحة: category
    // (مفتاح ثابت)، party (الطرف المقابل)، notes (نص حرّ). السبب يُحفَظ في notes الحركة
    // المعاكسة — العمود الحرّ الوحيد المتاح — وهذا هو بالضبط ما يطلبه القرار المعتمَد
    // (تخزين السبب الفعلي، لا نص ثابت). الأصل لا يُعدَّل بشيء غير status — مبدأ
    // append-only: "عكس عملية = إنشاء عملية مقابلة؛ الأصل لا يُحذف ولا يُعدَّل ماله."
    // original (المُلتقَط قبل الحارس) يبقى مصدراً آمناً لبقية الحقول: cashbox_id/type/
    // amount/method/party لا تتغيّر أبداً بعد الإنشاء — الحارس أعلاه يحمي status فقط،
    // وهو العمود الوحيد المُتنازَع عليه فعلياً.
    const reversal = await tx.treasury_txn.create({
      data: {
        id: crypto.randomUUID(),
        cashbox_id:  original.cashbox_id,
        date:        new Date(),
        type:        original.type === 'income' ? 'expense' : 'income',
        category:    original.category,
        amount:      original.amount,
        method:      original.method,
        party:       original.party,
        notes:       reason.trim(),
        ref_type:    'reversal',
        ref_id:      original.id,
        created_by:  userId,
      },
    });

    return { original: { ...original, status: 'cancelled' }, reversal };
  });

  return {
    original: snakeToCamel(result.original),
    reversal: snakeToCamel(result.reversal),
  };
}

// يُصدَّر منفصلاً لنفس السبب.
export async function transferBetweenCashboxes(
  { fromCashboxId, toCashboxId, amount, date, method, party, notes, description } = {},
  { userId = null } = {}
) {
  if (typeof fromCashboxId !== 'string' || !fromCashboxId.trim()) throw badRequest('الخزنة المصدر مطلوبة.');
  if (typeof toCashboxId !== 'string' || !toCashboxId.trim()) throw badRequest('الخزنة الوجهة مطلوبة.');
  if (fromCashboxId === toCashboxId) throw badRequest('لا يمكن التحويل لنفس الخزنة.');
  const amt = Number(amount);
  if (!amt || amt <= 0) throw badRequest('المبلغ يجب أن يكون أكبر من صفر.');
  if (!date) throw badRequest('التاريخ مطلوب.');

  const result = await runInTransaction(async (tx) => {
    // القراءة الحاسمة داخل المعاملة — نفس مبدأ reverseTreasuryTxn أعلاه.
    const fromCb = await tx.cashboxes.findUnique({ where: { id: fromCashboxId } });
    if (!fromCb) throw badRequest('الخزنة المصدر غير موجودة.');
    const toCb = await tx.cashboxes.findUnique({ where: { id: toCashboxId } });
    if (!toCb) throw badRequest('الخزنة الوجهة غير موجودة.');

    // transferId رابط منطقي فقط (ref_id مشترَك بين الحركتين) — ليس صفاً بحدّ ذاته.
    // لا عمود description (نفس الاكتشاف أعلاه في reverseTreasuryTxn) — الوصف/السبب
    // يُخزَّن في notes؛ party يحمل اسم الخزنة المقابلة بالفعل فلا داعٍ لتكراره في النص.
    const transferId = crypto.randomUUID();
    const desc = description || 'تحويل داخلي';

    const outTxn = await tx.treasury_txn.create({
      data: {
        id: crypto.randomUUID(),
        cashbox_id:  fromCashboxId,
        date:        new Date(date),
        type:        'expense',
        category:    'transfer',
        amount:      amt,
        method:      method || 'cash',
        party:       toCb.name,
        notes:       notes ? `${desc} — ${notes}` : desc,
        ref_type:    'transfer',
        ref_id:      transferId,
        created_by:  userId,
      },
    });

    const inTxn = await tx.treasury_txn.create({
      data: {
        id: crypto.randomUUID(),
        cashbox_id:  toCashboxId,
        date:        new Date(date),
        type:        'income',
        category:    'transfer',
        amount:      amt,
        method:      method || 'cash',
        party:       fromCb.name,
        notes:       notes ? `${desc} — ${notes}` : desc,
        ref_type:    'transfer',
        ref_id:      transferId,
        created_by:  userId,
      },
    });

    return { outTxn, inTxn };
  });

  return {
    outTxn: snakeToCamel(result.outTxn),
    inTxn:  snakeToCamel(result.inTxn),
  };
}

const router = Router();

// POST / — يُمرَّر فعلياً للـ CRUD العام (لا route هنا يطابق '/' لأي method)، لكن
// نستبدل created_by بـ req.user.id أولاً — الوسيلة الوحيدة المتاحة لحقن قيمة من
// الجلسة في كتابة تمرّ عبر crud.js لاحقاً، بلا تعديل crud.js نفسه إطلاقاً.
router.post('/', (req, res, next) => {
  req.body = { ...req.body, createdBy: req.user?.id ?? null };
  next();
});

// PUT /:id/reverse — عكس عملية (idempotent-safe عبر رفض صريح، لا نجاح صامت مكرَّر).
router.put('/:id/reverse', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body || {};
  const data = await reverseTreasuryTxn({ id, reason }, { userId: req.user?.id ?? null });
  res.json({ ok: true, data });
}));

// POST /transfer — تحويل ذرّي بين خزنتين.
router.post('/transfer', asyncHandler(async (req, res) => {
  const data = await transferBetweenCashboxes(req.body, { userId: req.user?.id ?? null });
  res.json({ ok: true, data });
}));

// PUT/PATCH/DELETE /:id — محظورة صراحةً (انظر شرح الملف أعلاه).
function blocked(message) {
  return (req, res) => res.status(405).json({ ok: false, error: message });
}
router.put('/:id', blocked('لا يمكن تعديل حركة خزنة مباشرةً — استخدم عكس العملية بدلاً من ذلك.'));
router.patch('/:id', blocked('لا يمكن تعديل حركة خزنة مباشرةً — استخدم عكس العملية بدلاً من ذلك.'));
router.delete('/:id', blocked('حذف حركات الخزنة غير متاح — الدفتر append-only.'));

export default router;
