// backend/src/routes/crud.js
// ─────────────────────────────────────────────────────────────
// Phase 2: يفعّل GET دائماً، ويفعّل POST/PUT/PATCH/DELETE فقط لو writable=true
// (يُحدَّد لكل collection في collections.js). غير الكتابة → تبقى 405 كما في Phase 1.
// يحوّل مخرجات قاعدة البيانات من snake_case إلى camelCase (خيار أ) وعكسها للكتابة.
// ─────────────────────────────────────────────────────────────
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { snakeToCamel, camelToSnake } from '../lib/caseMapper.js';

// حقول يديرها الخادم/القاعدة دائماً — تُتجاهَل أي قيمة يرسلها العميل لها
const SERVER_MANAGED_FIELDS = new Set(['id', 'created_at', 'updated_at']);

// JSON.stringify (المستخدَم داخلياً في res.json) لا يعرف تسلسل BigInt ويرمي استثناء —
// بعض الجداول (parents/teachers/inv_materials...) لها id من نوع BigInt. نحوّله لنص قبل الإرسال
// (نتجاهَل Decimal/Date عمداً — لها toJSON خاص بها في caseMapper ويجب ألا نفكّكها هنا).
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

function getModelFields(modelName) {
  return Prisma.dmmf.datamodel.models.find((m) => m.name === modelName)?.fields || [];
}

// بعض الـ models معرّف id فيها BigInt (parents/teachers/inv_materials) — الـ URL param
// دائماً نص، فيجب تحويله قبل استخدامه في where: {id}. غير الأرقام الصحيحة → 400 واضح
// بدل رمي استثناء Prisma غامض.
function parseIdParam(fields, rawId) {
  const idField = fields.find((f) => f.isId);
  if (idField?.type !== 'BigInt') return { id: rawId };
  if (!/^\d+$/.test(rawId)) {
    return { error: 'معرّف غير صالح (يجب أن يكون رقماً).' };
  }
  return { id: BigInt(rawId) };
}

// يجهّز جسم الطلب للكتابة: camelCase→snake_case، إسقاط الحقول المُدارة من الخادم،
// تحويل حقول BigInt (Prisma يرفض number/string خام لعمود BigInt).
function prepareWriteData(modelName, body) {
  const fields = getModelFields(modelName);
  const snake = camelToSnake(body || {});
  const data = {};
  for (const [key, value] of Object.entries(snake)) {
    if (SERVER_MANAGED_FIELDS.has(key)) continue; // لا يُسمح للعميل بالتحكّم بها
    const field = fields.find((f) => f.name === key);
    if (!field) continue; // عمود غير معروف في الـ model — يُتجاهَل بأمان
    data[key] = field.type === 'BigInt' && value !== null && value !== undefined
      ? BigInt(value)
      : value;
  }
  return { data, fields };
}

/**
 * ينشئ router لأي Prisma model. GET دائماً متاح.
 * الكتابة (POST/PUT/PATCH/DELETE) تُفعَّل فقط لو writable=true.
 * @param {string} modelName - اسم الـ model في prisma client (property فعلي، بعد db pull).
 * @param {{ writable?: boolean, preserveClientId?: boolean }} opts
 *   preserveClientId (Phase 3B-2A): يسمح بالاحتفاظ بـ id الذي يُرسله العميل عند الإنشاء
 *   بدل توليد UUID دائماً — مُفعَّل صراحةً فقط لِـ collections محدَّدة (انظر server.js).
 *   لا يُغيَّر السلوك الافتراضي لأي model آخر.
 */
export function makeCrudRouter(modelName, opts = {}) {
  const { writable = false, preserveClientId = false } = opts;
  const router = Router();
  const model = prisma[modelName];
  const modelFields = getModelFields(modelName);

  if (!model) {
    router.all('*', (req, res) =>
      res.status(500).json({ ok: false, error: `Model غير موجود في Prisma client: ${modelName}. شغّل prisma generate بعد db pull.` })
    );
    return router;
  }

  // GET / — قائمة كاملة (camelCase)
  router.get('/', asyncHandler(async (req, res) => {
    const take = req.query.limit ? Number(req.query.limit) : undefined;
    const skip = req.query.offset ? Number(req.query.offset) : undefined;
    const rows = await model.findMany({ take, skip });
    res.json({ ok: true, data: serializeBigInt(snakeToCamel(rows)), count: rows.length });
  }));

  // GET /:id
  router.get('/:id', asyncHandler(async (req, res) => {
    const parsed = parseIdParam(modelFields, req.params.id);
    if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });
    const row = await model.findUnique({ where: { id: parsed.id } });
    if (!row) return res.status(404).json({ ok: false, error: 'السجل غير موجود.' });
    res.json({ ok: true, data: serializeBigInt(snakeToCamel(row)) });
  }));

  if (!writable) {
    // أي محاولة كتابة → 405 صراحةً (نفس سلوك Phase 1 لهذه الـ collection)
    const writeBlocked = (req, res) =>
      res.status(405).json({ ok: false, error: 'القراءة فقط لهذه الـ collection حالياً. عمليات الكتابة غير متاحة.' });
    router.post('/', writeBlocked);
    router.put('/:id', writeBlocked);
    router.patch('/:id', writeBlocked);
    router.delete('/:id', writeBlocked);
    return router;
  }

  // POST / — إنشاء
  router.post('/', asyncHandler(async (req, res) => {
    const { data, fields } = prepareWriteData(modelName, req.body);
    const idField = fields.find((f) => f.isId);
    // نولّد id فقط لو العمود بلا default في القاعدة (لا identity/autoincrement)
    if (idField && !idField.hasDefaultValue) {
      // preserveClientId (Students فقط حالياً): احتفظ بـ id الذي أرسله العميل لو كان
      // نصاً غير فارغ — يمنع فقدان الربط مع سجلات محلية أخرى (attendance/payments/...)
      // ما زالت تشير لنفس الـ id القديم. أي id مكرّر يُرفَض عادياً عبر P2002 (409) — لا
      // معالجة خاصة إضافية. لو لم يُرسَل id صالح، يبقى السلوك القديم (UUID) كاحتياطي.
      const clientId = preserveClientId && idField.type !== 'BigInt' && typeof req.body?.id === 'string'
        ? req.body.id.trim()
        : '';
      data.id = clientId || (idField.type === 'BigInt' ? undefined : crypto.randomUUID());
    }
    const row = await model.create({ data });
    res.status(201).json({ ok: true, data: serializeBigInt(snakeToCamel(row)) });
  }));

  // تحديث مشترك لـ PUT/PATCH (Prisma .update() جزئي دائماً — لا فرق دلالي بينهما هنا)
  const updateHandler = asyncHandler(async (req, res) => {
    const parsed = parseIdParam(modelFields, req.params.id);
    if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });
    const { data, fields } = prepareWriteData(modelName, req.body);
    if (fields.some((f) => f.name === 'updated_at')) {
      data.updated_at = new Date();
    }
    const row = await model.update({ where: { id: parsed.id }, data });
    res.json({ ok: true, data: serializeBigInt(snakeToCamel(row)) });
  });
  router.put('/:id', updateHandler);
  router.patch('/:id', updateHandler);

  // DELETE /:id
  router.delete('/:id', asyncHandler(async (req, res) => {
    const parsed = parseIdParam(modelFields, req.params.id);
    if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });
    await model.delete({ where: { id: parsed.id } });
    res.json({ ok: true });
  }));

  return router;
}
