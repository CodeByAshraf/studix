// backend/src/routes/materialDistribution.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 3B-12 — نقطة نهاية ذرّية لتسوية "توزيع مذكرة" كاملة (roster كامل) دفعة واحدة.
// MaterialDistribution.jsx يحفظ حالة توزيع مذكرة على مجموعة طلاب كاملة كعملية منطقية
// واحدة — الـ CRUD العام (makeCrudRouter) يتعامل مع سجل واحد فقط، فلا يناسب هذا الشكل،
// ونفس معمارية attendanceSessions.js/examGrades.js تماماً.
//
// الفرق الجوهري عن attendanceSessions/examGrades: inventory_txn سجل تراكمي (ledger) —
// "لا تُحذف الحركات أبداً" (inventory.slice.js) ولا يوجد قيد فريد طبيعي (student_id +
// material_id) يسمح بـ upsert مباشر. بدلاً من استبدال شامل، نُسوّي (reconcile) كل طالب
// على حدة مقابل آخر حركة حقيقية له لهذه المادة:
//   - لا حركة سابقة + الحالة الواردة هي الافتراضية غير المُلمَسة (received:false،
//     payStatus:'unpaid'، paidAmount:0) → لا شيء (لا نُنشئ حجزاً وهمياً لكل طالب).
//   - حركة جديدة واحدة فقط، quantity=1 دائماً، عند: استلام فعلي جديد (studentDelivery)،
//     إرجاع بعد استلام فعلي (return)، أول حجز حقيقي بلا استلام (reservation)، أو إلغاء
//     حجز قائم بالكامل (reservationRelease) — التفاصيل في resolveNewEventType.
//   - received كما هو لكنّ payStatus/paidAmount/receivedAt تغيّرت → تحديث legacy_metadata
//     لآخر حركة فقط في مكانها (الاستثناء الوحيد المتعمَّد لمبدأ "لا تُحذف/لا تُعدَّل" —
//     التعديل هنا لتعليق على الحركة، لا تغيير لهويتها: type/quantity/student_id/
//     material_id/created_at لا تُمَسّ أبداً).
//   - لا شيء تغيّر → صفر كتابة.
// إعادة نفس roster بالضبط يُنتج صفر حركات جديدة — هذا هو ضمان idempotency، بلا أي عمود
// جديد (انظر تقرير قرار Phase 3B-12).
//
// payment_id/admission_id يبقيان null دائماً — لا علاقة مالية حقيقية تُخترَع هنا.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import crypto from 'crypto';
import { runInTransaction } from '../lib/transaction.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const RELEVANT_TYPES = ['studentDelivery', 'reservation', 'reservationRelease', 'return']; // ⊂ chk_inv_type
const PAY_STATUSES = new Set(['paid', 'partial', 'unpaid']);
const NUMBER_RE = /^INV-(\d+)$/;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

// نفس منطق فحص P2002 المستخدَم في errorHandler.js (err.code فقط، بلا instanceof) —
// تجنّباً لاستيراد إضافي من @prisma/client هنا.
function isP2002OnNumber(err) {
  return err?.code === 'P2002'
    && Array.isArray(err.meta?.target)
    && err.meta.target.includes('number');
}

// حالة "افتراضية غير مُلمَسة" — نفس القيم التي يُهيّئ بها MaterialDistribution.jsx كل
// طالب مؤهَّل لم يُلمَس إطلاقاً (localDist الابتدائي). بدون هذا الفحص، كل حفظ كان
// سيُنشئ حجزاً (reservation) لكل طالب في الصف، حتى مَن لم يُفتَح سجله قط.
function isUntouchedDefault(rec) {
  return rec.received === false
    && (rec.payStatus === 'unpaid' || rec.payStatus == null)
    && (Number(rec.paidAmount) || 0) === 0
    && (rec.receivedAt === null || rec.receivedAt === undefined);
}

// النوع الصحيح للحركة الجديدة المطلوبة لهذا الطالب، أو null لو لا حركة جديدة مطلوبة
// إطلاقاً (فقط تحديث legacy_metadata محتمل، أو لا شيء). انظر تقرير القرار (البند G):
//   - received يختلف فعلياً عن الحالة الحالية:
//     · false→true: studentDelivery (أول استلام، أو استلام بعد حجز/فكّ حجز/إرجاع).
//     · true→false: return (لا يحدث إلا إذا latest.type==='studentDelivery' فعلياً،
//       لأن currentReceived=true يعني هذا بالضبط).
//   - received يبقى false طوال الوقت:
//     · لا حركة سابقة إطلاقاً وليست الحالة الافتراضية (بيانات دفع حقيقية بلا استلام
//       فعلي) → reservation (أول لمسة حقيقية).
//     · كانت حركة سابقة من نوع reservation والحالة الواردة الآن هي الافتراضية بالكامل
//       (لا حجز حقيقي هي فيها إطلاقاً — isUntouchedDefault يمنع هذا) → reservationRelease
//       (إلغاء الحجز حدث حقيقي، لا مجرّد تعليق على السجل).
//     · غير ذلك (لا تغيير في النوع، فقط تعديل تعليق محتمل) → null، يُعالَج بفرع
//       metadataChanged أدناه.
//   - received يبقى true طوال الوقت → null دائماً (نفس المذكرة استُلمت بالفعل).
function resolveNewEventType(latest, rec, currentReceived) {
  if (rec.received !== currentReceived) {
    return rec.received ? 'studentDelivery' : 'return';
  }
  if (!rec.received) {
    if (!latest) return 'reservation';
    if (latest.type === 'reservation' && isUntouchedDefault(rec)) return 'reservationRelease';
  }
  return null;
}

function buildMetadata(rec) {
  return {
    receivedAt: rec.receivedAt ?? null,
    payStatus: rec.payStatus || 'unpaid',
    paidAmount: Number(rec.paidAmount) || 0,
  };
}

function metadataChanged(existingMeta, rec) {
  const meta = existingMeta || {};
  return (meta.receivedAt ?? null) !== (rec.receivedAt ?? null)
    || (meta.payStatus || 'unpaid') !== (rec.payStatus || 'unpaid')
    || (Number(meta.paidAmount) || 0) !== (Number(rec.paidAmount) || 0);
}

function validateRecords(records) {
  if (!Array.isArray(records)) throw badRequest('records يجب أن تكون مصفوفة.');
  const byStudent = new Map(); // dedupe: آخر سجل لكل studentId هو الفائز
  for (const r of records) {
    if (!r || typeof r.studentId !== 'string' || !r.studentId.trim()) {
      throw badRequest('كل سجل يجب أن يحتوي studentId نصياً صالحاً.');
    }
    if (typeof r.received !== 'boolean') {
      throw badRequest(`received يجب أن تكون true/false — الطالب ${r.studentId}.`);
    }
    if (r.payStatus !== undefined && r.payStatus !== null && !PAY_STATUSES.has(r.payStatus)) {
      throw badRequest(`payStatus غير صالح: "${r.payStatus}" — الطالب ${r.studentId}. القيم المسموحة: paid/partial/unpaid.`);
    }
    const paidAmount = r.paidAmount ?? 0;
    if (typeof paidAmount !== 'number' || !Number.isFinite(paidAmount) || paidAmount < 0) {
      throw badRequest(`paidAmount يجب أن يكون رقماً غير سالب — الطالب ${r.studentId}.`);
    }
    if (r.receivedAt !== null && r.receivedAt !== undefined && typeof r.receivedAt !== 'string') {
      throw badRequest(`receivedAt يجب أن يكون نصاً أو null — الطالب ${r.studentId}.`);
    }
    byStudent.set(r.studentId, {
      studentId: r.studentId,
      received: r.received,
      payStatus: r.payStatus || 'unpaid',
      paidAmount,
      receivedAt: r.receivedAt ?? null,
    });
  }
  return byStudent;
}

async function computeNextSeq(tx) {
  const rows = await tx.inventory_txn.findMany({
    where: { number: { startsWith: 'INV-' } },
    select: { number: true },
  });
  let max = 0;
  for (const { number } of rows) {
    const m = NUMBER_RE.exec(number);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

async function attemptReconciliation({ materialIdBigInt, materialIdStr, byStudent, createdBy }) {
  return runInTransaction(async (tx) => {
    const material = await tx.inv_materials.findUnique({ where: { id: materialIdBigInt }, select: { id: true } });
    if (!material) throw badRequest('المادة غير موجودة.');

    // Phase 3B-12 (إغلاق، Finding #1): حركة ملغاة (status='cancelled') لا يجب أبداً أن
    // تُعتبَر "آخر حالة حقيقية" لطالب — كانت تدخل latestByStudent بنفس وزن الحركة النشطة،
    // فتُنتج قرار تسوية خاطئاً (مثال حي: مادة id=6 لها 4 حركات ملغاة من التحقّق اليدوي
    // السابق — دون هذا الفلتر، أي تسوية جديدة لنفس الطلاب كانت ستُبنى على تاريخ ملغى).
    // لا تغيير على أي منطق آخر (النوع/الكمية/idempotency/توليد الرقم/المعاملة الذرّية).
    const existing = await tx.inventory_txn.findMany({
      where: { material_id: materialIdBigInt, type: { in: RELEVANT_TYPES }, status: { not: 'cancelled' } },
      orderBy: { created_at: 'desc' },
    });
    const latestByStudent = new Map();
    for (const row of existing) {
      if (!latestByStudent.has(row.student_id)) latestByStudent.set(row.student_id, row);
    }

    let nextSeq = await computeNextSeq(tx);
    const results = [];

    for (const rec of byStudent.values()) {
      const latest = latestByStudent.get(rec.studentId) || null;
      const currentReceived = latest ? latest.type === 'studentDelivery' : false;

      if (!latest && isUntouchedDefault(rec)) {
        results.push({
          id: `${materialIdStr}:${rec.studentId}`, matId: materialIdStr, studentId: rec.studentId,
          received: false, receivedAt: null, payStatus: 'unpaid', paidAmount: 0,
        });
        continue;
      }

      const newType = resolveNewEventType(latest, rec, currentReceived);
      if (newType) {
        const number = `INV-${String(nextSeq).padStart(6, '0')}`;
        nextSeq += 1;
        const created = await tx.inventory_txn.create({
          data: {
            id: crypto.randomUUID(),
            number,
            material_id: materialIdBigInt,
            type: newType,
            quantity: 1,
            student_id: rec.studentId,
            status: 'active',
            legacy_metadata: buildMetadata(rec),
            created_by: createdBy,
          },
        });
        latestByStudent.set(rec.studentId, created);
        results.push({
          id: created.id, matId: materialIdStr, studentId: rec.studentId,
          received: rec.received, receivedAt: rec.receivedAt, payStatus: rec.payStatus, paidAmount: rec.paidAmount,
        });
        continue;
      }

      if (latest && metadataChanged(latest.legacy_metadata, rec)) {
        const updated = await tx.inventory_txn.update({
          where: { id: latest.id },
          data: { legacy_metadata: buildMetadata(rec) },
        });
        latestByStudent.set(rec.studentId, updated);
        results.push({
          id: updated.id, matId: materialIdStr, studentId: rec.studentId,
          received: rec.received, receivedAt: rec.receivedAt, payStatus: rec.payStatus, paidAmount: rec.paidAmount,
        });
        continue;
      }

      // لا تغيير إطلاقاً — صفر كتابة لهذا الطالب
      const meta = latest?.legacy_metadata || {};
      results.push({
        id: latest ? latest.id : `${materialIdStr}:${rec.studentId}`, matId: materialIdStr, studentId: rec.studentId,
        received: currentReceived, receivedAt: meta.receivedAt ?? null,
        payStatus: meta.payStatus || 'unpaid', paidAmount: Number(meta.paidAmount) || 0,
      });
    }

    return results;
  });
}

// يُصدَّر منفصلاً عن الـ router ليكون قابلاً للاختبار مباشرة بلا HTTP/auth.
export async function saveMaterialDistribution({ materialId, records }, { createdBy = null } = {}) {
  if (typeof materialId !== 'string' || !/^\d+$/.test(materialId)) {
    throw badRequest('materialId يجب أن يكون رقماً صالحاً.');
  }
  const byStudent = validateRecords(records);
  const materialIdBigInt = BigInt(materialId);

  try {
    const results = await attemptReconciliation({ materialIdBigInt, materialIdStr: materialId, byStudent, createdBy });
    return { materialId, records: results };
  } catch (err) {
    if (isP2002OnNumber(err)) {
      // تعارض رقم نادر (سباق بين طلبين متزامنين) — إعادة محاولة واحدة فقط، من جهة
      // الخادم بالكامل. العميل لا يعرف عن هذا إطلاقاً ولا يتدخّل فيه.
      const results = await attemptReconciliation({ materialIdBigInt, materialIdStr: materialId, byStudent, createdBy });
      return { materialId, records: results };
    }
    throw err;
  }
}

const router = Router();

// PUT /api/material-distributions/:materialId — تسوية توزيع مذكرة كاملة (idempotent)
router.put('/:materialId', asyncHandler(async (req, res) => {
  const { materialId } = req.params;
  const { records } = req.body || {};
  const data = await saveMaterialDistribution({ materialId, records }, { createdBy: req.user?.id ?? null });
  res.json({ ok: true, data });
}));

export default router;
