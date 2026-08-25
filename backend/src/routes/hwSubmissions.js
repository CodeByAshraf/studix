// backend/src/routes/hwSubmissions.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 3B-6 — نقطة نهاية ذرّية لحفظ حالات تسليم واجب كامل دفعة واحدة.
// HomeworkTracking يحفظ حالة كل طلاب المجموعة (roster كامل) كعملية منطقية واحدة —
// الـ CRUD العام (makeCrudRouter) يتعامل مع سجل واحد فقط، فلا يناسب هذا الشكل.
// نفس معمارية backend/src/routes/examGrades.js تماماً، بإضافتين خاصتين بهذا الجدول:
//   - submitted_at: عمود @db.Timestamptz لكنه يُعامَل كحقل تاريخ فقط (بلا وقت) من
//     جهة العمل — يُطبَّع لصيغة كاملة عند الإرسال لـ Prisma، ولصيغة YYYY-MM-DD عند
//     القراءة، دون أي دلالة وقت إضافية.
//   - score ليس له CHECK constraint في القاعدة إطلاقاً (بعكس grades.score) — هذه
//     النقطة هي المرجع الوحيد للتحقّق من صحة الدرجة.
//
// الدلالة: "استبدل حالات تسليم هذا الواجب بالكامل بالسجلات المُرسَلة الآن":
//   - upsert لكل طالب في records (يعتمد على القيد الفريد homework_id+student_id،
//     فلا يتعارض أبداً مع إعادة حفظ roster موجود — P2002 غير ممكن هنا).
//   - حذف أي سجل قديم لطالب لم يعد ضمن records.
//   - كل ذلك داخل معاملة واحدة (runInTransaction).
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { runInTransaction } from '../lib/transaction.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { snakeToCamel } from '../lib/caseMapper.js';

const VALID_STATUSES = new Set(['submitted', 'late', 'missing']); // يطابق chk_hwsub_status بالقاعدة
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

// submittedAt يُعامَل كحقل "تاريخ فقط" من جهة العمل رغم أن العمود Timestamptz —
// لا واجهة وقت، لا دلالة وقت إضافية. null يبقى null دائماً.
function toRequestTimestampOrNull(dateOnly) {
  if (dateOnly === null || dateOnly === undefined || dateOnly === '') return null;
  if (typeof dateOnly !== 'string' || !DATE_RE.test(dateOnly)) {
    throw badRequest(`submittedAt يجب أن يكون بصيغة YYYY-MM-DD أو null (وصل: "${dateOnly}").`);
  }
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

function toResponseDateOnlyOrNull(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// يُصدَّر منفصلاً عن الـ router ليكون قابلاً للاختبار مباشرة بلا HTTP/auth.
export async function saveHwSubmissions({ homeworkId, records }) {
  if (typeof homeworkId !== 'string' || !homeworkId.trim()) throw badRequest('homeworkId مطلوب.');
  if (!Array.isArray(records)) throw badRequest('records يجب أن تكون مصفوفة.');

  const hw = await prisma.homeworks.findUnique({ where: { id: homeworkId }, select: { id: true, total_score: true } });
  if (!hw) throw badRequest('الواجب غير موجود.');
  const totalScore = Number(hw.total_score); // Decimal → number، للتحقّق هنا فقط

  // dedupe: آخر سجل لكل studentId هو الفائز
  const byStudent = new Map();
  for (const r of records) {
    if (!r || typeof r.studentId !== 'string' || !r.studentId.trim()) {
      throw badRequest('كل سجل يجب أن يحتوي studentId نصياً صالحاً.');
    }
    if (!VALID_STATUSES.has(r.status)) {
      throw badRequest(`status غير صالح: "${r.status}". القيم المسموحة: submitted/late/missing.`);
    }
    let score = r.score;
    if (score !== null && score !== undefined) {
      score = Number(score);
      if (!Number.isFinite(score)) throw badRequest(`score غير صالح للطالب ${r.studentId}.`);
      if (score < 0) throw badRequest(`score لا يمكن أن يكون سالباً (${r.studentId}).`);
      // لا نثق أبداً بـ total_score يُرسله العميل — نستخدم hw.total_score الفعلي من القاعدة فقط
      if (score > totalScore) throw badRequest(`score (${score}) أكبر من الدرجة الكلية للواجب (${totalScore}) — الطالب ${r.studentId}.`);
    } else {
      score = null;
    }
    const submittedAt = toRequestTimestampOrNull(r.submittedAt);
    byStudent.set(r.studentId, { status: r.status, score, submittedAt, notes: r.notes || null });
  }

  const result = await runInTransaction(async (tx) => {
    const existing = await tx.hw_submissions.findMany({
      where: { homework_id: homeworkId },
      select: { id: true, student_id: true },
    });

    const toDeleteIds = existing
      .filter((row) => !byStudent.has(row.student_id))
      .map((row) => row.id);

    if (toDeleteIds.length) {
      await tx.hw_submissions.deleteMany({ where: { id: { in: toDeleteIds } } });
    }

    for (const [studentId, { status, score, submittedAt, notes }] of byStudent.entries()) {
      await tx.hw_submissions.upsert({
        where: {
          homework_id_student_id: { homework_id: homeworkId, student_id: studentId },
        },
        create: {
          id: crypto.randomUUID(),
          homework_id: homeworkId,
          student_id: studentId,
          status,
          score,
          submitted_at: submittedAt,
          notes,
        },
        update: {
          status,
          score,
          submitted_at: submittedAt,
          notes,
        },
      });
    }

    return tx.hw_submissions.findMany({
      where: { homework_id: homeworkId },
    });
  });

  return {
    homeworkId,
    records: snakeToCamel(result).map((r) => ({
      ...r,
      score: toNumberOrNull(r.score),
      submittedAt: toResponseDateOnlyOrNull(r.submittedAt),
    })),
  };
}

const router = Router();

// PUT /api/hw-submissions/:homeworkId — استبدال حالات تسليم الواجب بالكامل (idempotent)
router.put('/:homeworkId', asyncHandler(async (req, res) => {
  const { homeworkId } = req.params;
  const { records } = req.body || {};
  const data = await saveHwSubmissions({ homeworkId, records });
  res.json({ ok: true, data });
}));

export default router;
