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
import { requirePermission } from '../middleware/permissions.js';
import {
  validatePaymentInput, createPaymentInTx, serializeBigInt,
  normalizeClientRequestId, findPaymentByClientRequestId, idempotencyConflict,
} from './payments.js';
import { prisma } from '../prisma.js';
import { snakeToCamel } from '../lib/caseMapper.js';

const RELEVANT_TYPES = ['studentDelivery', 'reservation', 'reservationRelease', 'return']; // ⊂ chk_inv_type
const PAY_STATUSES = new Set(['paid', 'partial', 'unpaid']);
const NUMBER_RE = /^INV-(\d+)$/;

// مفتاح قفل استشاري (pg_advisory_xact_lock) مخصّص لتخصيص inventory_txn.number — يتبع نفس
// تسلسل الثوابت العشوائية بلا معنى خاص المستخدَمة فعلاً في db/migrationRunner.js (7727727)/
// db/bootstrapDatabase.js (7727728)/db/firstAdmin.js (7727729)/studentCreate.js (7727730)،
// مفتاح مختلف هنا عمداً لتجنّب أي تصادم معها. نفس السبب بالضبط المُوثَّق في studentCreate.js:
// computeNextSeq تقرأ MAX(number) بلا أي قفل — طلبات متزامنة (حتى لمواد مختلفة، الترقيم
// عالمي) تقرأ نفس MAX قبل أن يُثبِّت أيٌّ منها شيئاً فتتصادم على UNIQUE، وإعادة المحاولة
// الواحدة أدناه (isP2002OnNumber) لا تكفي وحدها تحت تزامن حقيقي (أثبت هذا فعلياً اختبار
// تزامن studentCreate.js قبل إصلاحه، بمحاولات retry أكثر من هنا وبقيت غير كافية). نطاق-
// معاملة (xact) لا نطاق-جلسة: يُحرَّر تلقائياً عند commit/rollback، بلا إلغاء قفل يدوي.
// مُصدَّر (State Synchronization Audit fix) — نفس القفل بالضبط يُعاد استخدامه من
// backend/src/routes/inventoryTxn.js (حركات المخزون اليدوية/تسويات الجرد) لأن التسلسل
// عالمي عبر كل حركات inventory_txn، لا خاص بهذا الملف — نسخة ثانية من هذا الثابت كانت
// ستتصادم بصمت تحت تزامن حقيقي (قفلان مختلفان لا يتنافيان أبداً).
export const INVENTORY_NUMBER_ADVISORY_LOCK_KEY = 7727731;

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

// مُصدَّر (State Synchronization Audit fix) — أُعيد استخدامها حرفياً من
// backend/src/routes/inventoryTxn.js، لا نسخة ثانية من نفس المنطق.
export async function computeNextSeq(tx) {
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

    // يُسلسِل حساب nextSeq + إدراج كل حركات هذا الاستدعاء بالكامل ضد أي استدعاء آخر متزامن
    // (نفس مادة أو مادة مختلفة — الترقيم عالمي) — الحامل وحده يقرأ MAX ويكتب، والبقية
    // تُحجَب خلفه بدل أن تتسابق معه. انظر توضيح INVENTORY_NUMBER_ADVISORY_LOCK_KEY أعلاه.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${INVENTORY_NUMBER_ADVISORY_LOCK_KEY})`;
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

function todayIsoDate() {
  return new Date().toISOString().split('T')[0];
}

// يستخرج {year, month} من "YYYY-MM-DD" بلا أي تحويل عبر Date/منطقة زمنية — createPayment
// يتطلّب month/year كحقلين منفصلين (لأغراض الاشتراكات الشهرية أصلاً)؛ دفعة المذكرة هنا
// لا معنى شهري حقيقي لها، فنشتقّهما فقط من تاريخ الدفعة نفسه لملء الحقل المطلوب، بلا أي
// حساب توقيت قد ينزلق ليوم مجاور (نفس التحذير الموثَّق في parseTreasuryDate/treasuryTxn.js).
function monthYearFromIsoDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(isoDate);
  if (!m) return { year: NaN, month: NaN };
  return { year: Number(m[1]), month: Number(m[2]) };
}

// يُصدَّر منفصلاً عن الـ router ليكون قابلاً للاختبار مباشرة بلا HTTP/auth، بنفس مبدأ
// createPayment/saveMaterialDistribution. تأكيد دفعة "مذكرة" واحدة لطالب واحد من شاشة
// تتبّع التسليم (زر "مدفوع"/"مدفوع جزئياً") — يُنشئ دفعة+حركة خزنة حقيقيتين (نفس منطق
// createPayment بالضبط، عبر createPaymentInTx المُستورَدة) ويُحدِّث/يُنشئ سجل inventory_txn
// المقابل، كل ذلك في معاملة Prisma ذرّية واحدة: فشل أي خطوة يُلغي البقية بالكامل — لا مال
// محصَّل بلا سجل استلام، ولا سجل "مدفوع" بلا مال حقيقي في الخزنة.
//
// "غير مدفوع" لا يمرّ عبر هذه الدالة إطلاقاً — يبقى على مسار saveMaterialDistribution
// العادي بلا أي كتابة مالية، تماماً كسلوكه الحالي.
//
// P2-2 — clientRequestId: the same idempotency contract as POST /api/payments (payments.js).
// The key becomes payments.id; a retry of the same confirmation replays the original result,
// checked right after the per-(material, student) advisory lock so it is serialized with any
// concurrent attempt. A key reused for a different confirmation is rejected with 409.
export async function confirmMaterialPayment(
  { materialId, studentId, payStatus, amount, cashboxId, method = 'cash', date, notes = null, clientRequestId: rawKey },
  { userId = null, requireKey = false } = {}
) {
  const clientRequestId = normalizeClientRequestId(rawKey, { required: requireKey });
  if (typeof materialId !== 'string' || !/^\d+$/.test(materialId)) {
    throw badRequest('materialId يجب أن يكون رقماً صالحاً.');
  }
  if (typeof studentId !== 'string' || !studentId.trim()) {
    throw badRequest('studentId مطلوب.');
  }
  if (payStatus !== 'paid' && payStatus !== 'partial') {
    throw badRequest('payStatus يجب أن يكون paid أو partial لهذه العملية.');
  }

  const materialIdBigInt = BigInt(materialId);
  const paymentDate = date || todayIsoDate();
  const { year, month } = monthYearFromIsoDate(paymentDate);

  // The operation a clientRequestId identifies: this student, this material, this cashbox and
  // method, and — for a partial payment — this amount ('paid' amounts are server-computed from
  // the remaining balance, so they are not part of the request).
  const matchesThisConfirmation = (existing) => existing.student_id === studentId
    && existing.material_id === materialIdBigInt
    && existing.pay_type === 'material'
    && existing.method === method
    && existing.treasury_txn_payments_treasury_txn_idTotreasury_txn?.cashbox_id === cashboxId
    && (payStatus !== 'partial' || Number(existing.amount) === Number(amount));

  const replayWithin = async (tx, existing) => {
    if (!matchesThisConfirmation(existing)) throw idempotencyConflict();
    const { treasury_txn_payments_treasury_txn_idTotreasury_txn: treasuryTxn, ...payment } = existing;
    const [inventoryTxn] = await tx.inventory_txn.findMany({
      where: { material_id: materialIdBigInt, student_id: studentId, type: { in: RELEVANT_TYPES }, status: { not: 'cancelled' } },
      orderBy: { created_at: 'desc' },
      take: 1,
    });
    return { payment, treasuryTxn, inventoryTxn: inventoryTxn || null, replay: true };
  };

  let result;
  try {
    result = await runInTransaction(async (tx) => {
    // قفل استشاري خاص بزوج (مذكرة، طالب) — يُسلسِل محاولات تأكيد الدفع المتزامنة لنفس
    // الالتزام المالي (نفس الطالب+نفس المذكرة)، بحيث تُقرَأ "المتبقي" أدناه دائماً مقابل
    // بيانات مُثبَّتة فعلياً لا بيانات قديمة قد تتجاوزها معاملة أخرى للتو — نفس مبدأ
    // القفل التشاؤمي في refundPayment (payments.js)، لكن هنا المجموع موزَّع على عدة صفوف
    // payments بلا صفّ واحد يحمل القيد، فقفل استشاري (hashtext) هو المكافئ الصحيح. هذا
    // القفل هو أيضاً خط الدفاع الحقيقي ضد الإرسال المزدوج (نقرتان/إعادة محاولة شبكة):
    // الطلب الثاني يُحجَب حتى يُثبَّت الأول، ثم يرى remaining<=0 فيُرفَض بوضوح أدناه.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`matpay:${materialId}:${studentId}`}))`;

    // P2-2 — a retry of an already-committed confirmation (serialized by the lock above).
    if (clientRequestId) {
      const already = await findPaymentByClientRequestId(tx, clientRequestId);
      if (already) return replayWithin(tx, already);
    }

    const material = await tx.inv_materials.findUnique({ where: { id: materialIdBigInt } });
    if (!material) throw badRequest('المذكرة غير موجودة.');

    const student = await tx.students.findUnique({ where: { id: studentId } });
    if (!student) throw badRequest('الطالب غير موجود.');

    const price = Number(material.price) || 0;

    // المدفوع فعلاً حتى الآن لهذه المذكرة لهذا الطالب — يُحسَب دائماً من صفوف payments
    // الحقيقية (مصدر الحقيقة الوحيد)، لا من legacy_metadata ولا من أي قيمة يرسلها العميل.
    // هذا يضمن أن دفعة جزئية ثانية تُجمَع بشكل صحيح على الأولى، بلا أي مبلغ يُخترَع.
    const paidAgg = await tx.payments.aggregate({
      where: { student_id: studentId, material_id: materialIdBigInt, pay_type: 'material' },
      _sum: { amount: true },
    });
    const alreadyPaid = Number(paidAgg._sum.amount ?? 0);
    const remaining = Math.max(0, price - alreadyPaid);

    if (remaining <= 0) {
      throw badRequest('هذه المذكرة مدفوعة بالكامل بالفعل — لا يمكن تسجيل دفعة أخرى.');
    }

    let amt;
    if (payStatus === 'paid') {
      // المبلغ الكامل يُحسَب من جهة الخادم دائماً — لا يُقرَأ من العميل إطلاقاً (نفس مبدأ
      // status في createPaymentInTx: لا ثقة بأي حساب مالي قادم من الواجهة).
      amt = remaining;
    } else {
      amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw badRequest('المبلغ يجب أن يكون أكبر من صفر.');
      if (amt > remaining) throw badRequest(`المبلغ أكبر من المتبقي (${remaining} ج.م).`);
    }

    const normalized = validatePaymentInput({
      studentId,
      groupId: student.group_id,
      materialId,
      month,
      year,
      amount: amt,
      method,
      payType: 'material',
      date: paymentDate,
      notes,
      cashboxId,
    });
    const { payment, treasuryTxn } = await createPaymentInTx(tx, normalized, { userId, paymentId: clientRequestId });

    const newPaidTotal = alreadyPaid + amt;
    const newPayStatus = newPaidTotal >= price ? 'paid' : 'partial';

    const existing = await tx.inventory_txn.findMany({
      where: { material_id: materialIdBigInt, student_id: studentId, type: { in: RELEVANT_TYPES }, status: { not: 'cancelled' } },
      orderBy: { created_at: 'desc' },
    });
    const latest = existing[0] || null;

    let inventoryTxn;
    if (latest && latest.type === 'studentDelivery') {
      // مُستَلمة بالفعل (دفعة جزئية سابقة، أو استلام سُجِّل قبل هذه الدفعة) — تحديث تعليق
      // فقط، بنفس القيد الموثَّق أعلى الملف: type/quantity/student_id/material_id/
      // created_at لا تُمَسّ أبداً؛ receivedAt الأصلي يبقى كما هو إن وُجد.
      inventoryTxn = await tx.inventory_txn.update({
        where: { id: latest.id },
        data: {
          legacy_metadata: {
            receivedAt: latest.legacy_metadata?.receivedAt ?? todayIsoDate(),
            payStatus: newPayStatus,
            paidAmount: newPaidTotal,
          },
          payment_id: payment.id,
        },
      });
    } else {
      // أول تسجيل حقيقي لهذا الطالب لهذه المذكرة — استلام+دفع معاً دفعة واحدة، بنفس منطق
      // ترقيم INV-###### وقفل التسلسل المُستخدَم في attemptReconciliation أعلاه.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${INVENTORY_NUMBER_ADVISORY_LOCK_KEY})`;
      const nextSeq = await computeNextSeq(tx);
      const number = `INV-${String(nextSeq).padStart(6, '0')}`;
      inventoryTxn = await tx.inventory_txn.create({
        data: {
          id: crypto.randomUUID(),
          number,
          material_id: materialIdBigInt,
          type: 'studentDelivery',
          quantity: 1,
          student_id: studentId,
          status: 'active',
          legacy_metadata: { receivedAt: todayIsoDate(), payStatus: newPayStatus, paidAmount: newPaidTotal },
          payment_id: payment.id,
          created_by: userId,
        },
      });
    }

    return { payment, treasuryTxn, inventoryTxn };
    });
  } catch (err) {
    // The same key used concurrently for a DIFFERENT (material, student) pair is not serialized
    // by the advisory lock — the primary key catches it; this transaction rolled back entirely.
    if (clientRequestId && err.code === 'P2002') {
      const winner = await findPaymentByClientRequestId(prisma, clientRequestId);
      if (winner) result = await replayWithin(prisma, winner);
      else throw err;
    } else {
      throw err;
    }
  }

  return {
    payment: snakeToCamel(serializeBigInt(result.payment)),
    treasuryTxn: result.treasuryTxn ? snakeToCamel(result.treasuryTxn) : null,
    inventoryTxn: result.inventoryTxn ? snakeToCamel(serializeBigInt(result.inventoryTxn)) : null,
    ...(result.replay ? { replay: true } : {}),
  };
}

const router = Router();

// PUT /api/material-distributions/:materialId — تسوية توزيع مذكرة كاملة (idempotent)
router.put('/:materialId', asyncHandler(async (req, res) => {
  const { materialId } = req.params;
  const { records } = req.body || {};
  const data = await saveMaterialDistribution({ materialId, records }, { createdBy: req.user?.id ?? null });
  res.json({ ok: true, data });
}));

// POST /api/material-distributions/:materialId/students/:studentId/payment — تأكيد دفعة
// مذكرة (كاملة/جزئية) لطالب واحد، ذرّي (دفعة+خزنة+استلام معاً). هذا المسار يُنشئ حركة
// خزنة حقيقية، فيتطلّب صراحةً صلاحية 'payments' أيضاً — بالإضافة إلى 'materials' المفروضة
// على كل الراوتر في server.js — حتى لا يستطيع مستخدم لديه صلاحية "المذكرات" فقط تجاوز
// بوابة الصلاحيات المالية القائمة (نفس مبدأ عدم إضعاف الضوابط المالية الحالية).
router.post('/:materialId/students/:studentId/payment', requirePermission('payments'), asyncHandler(async (req, res) => {
  const { materialId, studentId } = req.params;
  const { payStatus, amount, cashboxId, method, date, notes, clientRequestId } = req.body || {};
  const data = await confirmMaterialPayment(
    { materialId, studentId, payStatus, amount, cashboxId, method, date, notes, clientRequestId },
    { userId: req.user?.id ?? null, requireKey: true }
  );
  res.status(data.replay ? 200 : 201).json({ ok: true, data });
}));

export default router;
