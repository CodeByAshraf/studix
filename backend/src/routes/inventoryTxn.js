// backend/src/routes/inventoryTxn.js
// ─────────────────────────────────────────────────────────────────────────────
// State Synchronization Audit fix — المعاملة اليدوية للمخزون (InventoryPage.jsx:
// handleSaveTxn/handleSaveCount) لم تكن تصل للخادم إطلاقاً من قبل: كانت تُدرِج صفاً
// محلياً فقط في Zustand بمعرّف يولّده العميل، بلا أي نداء شبكة — فتُفقَد صامتاً عند
// إعادة التحميل ولا تظهر لأي جهاز/جلسة أخرى.
//
// لماذا مسار مخصّص لا الـ CRUD العام (makeCrudRouter('inventory_txn'))؟ الأخير موجود
// بالفعل (POST /api/inventoryTxn عبر الحلقة الديناميكية في server.js) لكنه غير كافٍ
// هنا تحديداً: عمود inventory_txn.number فريد (UNIQUE) وبلا default في القاعدة، ويتطلّب
// تسلسلاً عالمياً (INV-######) يُحسَب بقفل استشاري (نفس computeNextSeq/
// INVENTORY_NUMBER_ADVISORY_LOCK_KEY المُصدَّرين من materialDistribution.js، مُعاد
// استخدامهما هنا حرفياً — لا نسخة ثانية من نفس المنطق) — الـ CRUD العام لا يملك أي منطق
// كهذا، فسيرفض أي POST بلا number صالح، أو يخاطر بتصادم تحت تزامن حقيقي لو تُرك للعميل.
// كل الحقول الأخرى (type/quantity/materialId/...) الـ CRUD العام يقبلها فعلاً بلا مشكلة
// (نفس أعمدة الجدول الحقيقية) — هذا المسار يُضيف فقط توليد number الناقص، لا يُعيد بناء
// أي شيء آخر موجود بالفعل.
//
// chk_inv_type (backend/migrations/001_baseline.sql) يسمح بالفعل بكل الـ 12 قيمة التي
// تستخدمها src/modules/inventory/constants.js's TxnType — تحقّق فعلي حيّ أثناء هذا
// الإصلاح، تطابق حرفي كامل. لا حاجة لأي تعديل CHECK/schema/migration.
//
// حقول محلية بلا عمود حقيقي مطابق (employee/reason/countedQty/systemQty/printVendor/
// refModule/refId/invoiceId/date) — نفس مبدأ legacy_metadata المُستخدَم فعلاً في
// materialDistribution.js لضبط تعليق على حركة تسليم الطالب، مُطبَّق هنا بنفس الروح لضبط
// كل الحقول الوصفية الإضافية لحركة يدوية/تسوية جرد. لا تغيير في منطق الأعمال (حساب
// الرصيد الحالي/التسوية) — هذا الملف مسؤول عن الحفظ فقط.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import crypto from 'crypto';
import { runInTransaction } from '../lib/transaction.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { snakeToCamel } from '../lib/caseMapper.js';
import { computeNextSeq, INVENTORY_NUMBER_ADVISORY_LOCK_KEY } from './materialDistribution.js';

// مطابقة chk_inv_type الحيّة حرفياً (backend/migrations/001_baseline.sql) — نفس ترتيب/
// تسمية TxnType (src/modules/inventory/constants.js) بالضبط.
const VALID_TYPES = [
  'initialStock', 'printing', 'purchase', 'sale', 'freeDistribution',
  'reservation', 'reservationRelease', 'studentDelivery', 'return',
  'damaged', 'lost', 'adjustment',
];

// حقول اختيارية بلا عمود حقيقي مطابق — تُحفَظ داخل legacy_metadata معاً (JSON)، وتُعاد
// مُسطَّحة على مستوى الاستجابة العلوي (نفس شكل src/modules/inventory/inventoryService.js's
// buildInventoryTxn المحلي بالضبط)، ليتبنّاها العميل مباشرة بلا أي تحويل إضافي.
// batchNo/unitCost/recipient لهم أعمدة حقيقية بالفعل (batch_no/unit_cost/recipient) —
// لا تُكرَّر هنا.
const METADATA_FIELDS = [
  'date', 'employee', 'reason', 'notes', 'printVendor',
  'countedQty', 'systemQty', 'refModule', 'refId', 'invoiceId',
];

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

function buildMetadata(input) {
  const meta = {};
  for (const key of METADATA_FIELDS) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== '') meta[key] = input[key];
  }
  return Object.keys(meta).length > 0 ? meta : null;
}

// يُصدَّر منفصلاً عن الـ router ليكون قابلاً للاختبار مباشرة بلا HTTP/auth — نفس نمط كل
// دوال الكتابة الأخرى في هذا الكود (createAdmissionPayment/createPaymentInTx/...).
export async function createManualInventoryTxn(input, { userId = null } = {}) {
  const { materialId, type, quantity, studentId = null } = input || {};

  if (materialId === undefined || materialId === null || materialId === '') throw badRequest('المذكرة مطلوبة.');
  let materialIdBig;
  try { materialIdBig = BigInt(materialId); }
  catch { throw badRequest('معرّف المذكرة غير صحيح.'); }

  if (!VALID_TYPES.includes(type)) throw badRequest('نوع حركة المخزون غير صحيح.');
  const qty = Number(quantity);
  if (!Number.isFinite(qty)) throw badRequest('الكمية يجب أن تكون رقماً صحيحاً.');

  const result = await runInTransaction(async (tx) => {
    const material = await tx.inv_materials.findUnique({ where: { id: materialIdBig } });
    if (!material) throw badRequest('المذكرة غير موجودة.');

    // نفس قفل/تسلسل ترقيم INV-###### المُستخدَم في materialDistribution.js حرفياً — عالمي
    // عبر كل حركات inventory_txn بغضّ النظر عن المسار الذي أنشأها.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${INVENTORY_NUMBER_ADVISORY_LOCK_KEY})`;
    const nextSeq = await computeNextSeq(tx);
    const number = `INV-${String(nextSeq).padStart(6, '0')}`;

    const row = await tx.inventory_txn.create({
      data: {
        id: crypto.randomUUID(),
        number,
        material_id: materialIdBig,
        type,
        quantity: qty,
        batch_no: input.batchNo?.trim() || null,
        unit_cost: input.unitCost != null ? Number(input.unitCost) : null,
        recipient: input.recipient?.trim() || null,
        student_id: studentId || null,
        status: 'active',
        legacy_metadata: buildMetadata(input),
        created_by: userId,
      },
    });
    return row;
  });

  const { legacy_metadata, ...rest } = result;
  return { ...snakeToCamel(rest), ...(legacy_metadata || {}), materialId: String(result.material_id) };
}

const router = Router();

router.post('/', asyncHandler(async (req, res) => {
  const data = await createManualInventoryTxn(req.body, { userId: req.user?.id ?? null });
  res.status(201).json({ ok: true, data });
}));

export default router;
