// backend/src/routes/examGrades.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 3B-5 — نقطة نهاية ذرّية لحفظ درجات امتحان كامل دفعة واحدة.
// GradeEntry يحفظ درجات كل طلاب المجموعة (roster كامل) كعملية منطقية واحدة —
// الـ CRUD العام (makeCrudRouter) يتعامل مع سجل واحد فقط، فلا يناسب هذا الشكل.
// نفس معمارية backend/src/routes/attendanceSessions.js تماماً، بلا حاجة لتطبيع
// تاريخ (grades ليس لها عمود @db.Date).
//
// الدلالة: "استبدل درجات هذا الامتحان بالكامل بالسجلات المُرسَلة الآن":
//   - upsert لكل طالب في records (يعتمد على القيد الفريد exam_id+student_id،
//     فلا يتعارض أبداً مع إعادة حفظ roster موجود — P2002 غير ممكن هنا).
//   - حذف أي سجل قديم لطالب لم يعد ضمن records.
//   - كل ذلك داخل معاملة واحدة (runInTransaction).
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { runInTransaction } from '../lib/transaction.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { snakeToCamel } from '../lib/caseMapper.js';

// grades.score هو Prisma.Decimal — caseMapper.js يحفظه كما هو عمداً (له toJSON خاص
// يُخرجه كنص عبر JSON.stringify، مثل exam.total/pass عبر الـ CRUD العام). هذا يكسر
// أي حساب حسابي على النتيجة في الفرونت-إند (خصوصاً "+" التي تتحوّل لدمج نصوص لا جمع
// أرقام). نملك هذا الـ endpoint بالكامل، فنحوّله لرقم JS صريح قبل الإرسال — تماماً
// كما طبّعنا date في attendanceSessions.js.
function toNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

// يُصدَّر منفصلاً عن الـ router ليكون قابلاً للاختبار مباشرة بلا HTTP/auth.
export async function saveExamGrades({ examId, records }) {
  if (typeof examId !== 'string' || !examId.trim()) throw badRequest('examId مطلوب.');
  if (!Array.isArray(records)) throw badRequest('records يجب أن تكون مصفوفة.');

  const exam = await prisma.exams.findUnique({ where: { id: examId }, select: { id: true, total: true } });
  if (!exam) throw badRequest('الامتحان غير موجود.');
  const examTotal = Number(exam.total); // Decimal → number؛ يُستخدَم فقط للتحقّق هنا

  // dedupe: آخر سجل لكل studentId هو الفائز
  const byStudent = new Map();
  for (const r of records) {
    if (!r || typeof r.studentId !== 'string' || !r.studentId.trim()) {
      throw badRequest('كل سجل يجب أن يحتوي studentId نصياً صالحاً.');
    }
    const absent = !!r.absent;
    let score = r.score;
    if (score !== null && score !== undefined) {
      score = Number(score);
      if (!Number.isFinite(score)) throw badRequest(`score غير صالح للطالب ${r.studentId}.`);
      if (score < 0) throw badRequest(`score لا يمكن أن يكون سالباً (${r.studentId}).`);
      // لا نثق أبداً بـ total يُرسله العميل — نستخدم exam.total الفعلي من القاعدة فقط
      if (score > examTotal) throw badRequest(`score (${score}) أكبر من الدرجة الكلية للامتحان (${examTotal}) — الطالب ${r.studentId}.`);
    } else {
      score = null;
    }
    byStudent.set(r.studentId, { score, absent });
  }

  const result = await runInTransaction(async (tx) => {
    const existing = await tx.grades.findMany({
      where: { exam_id: examId },
      select: { id: true, student_id: true },
    });

    const toDeleteIds = existing
      .filter((row) => !byStudent.has(row.student_id))
      .map((row) => row.id);

    if (toDeleteIds.length) {
      await tx.grades.deleteMany({ where: { id: { in: toDeleteIds } } });
    }

    for (const [studentId, { score, absent }] of byStudent.entries()) {
      await tx.grades.upsert({
        where: {
          exam_id_student_id: { exam_id: examId, student_id: studentId },
        },
        create: {
          id: crypto.randomUUID(),
          exam_id: examId,
          student_id: studentId,
          score,
          absent,
        },
        update: {
          score,
          absent,
        },
      });
    }

    return tx.grades.findMany({
      where: { exam_id: examId },
      orderBy: { created_at: 'asc' },
    });
  });

  return {
    examId,
    records: snakeToCamel(result).map((r) => ({ ...r, score: toNumberOrNull(r.score) })),
  };
}

const router = Router();

// PUT /api/exam-grades/:examId — استبدال درجات الامتحان بالكامل (idempotent)
router.put('/:examId', asyncHandler(async (req, res) => {
  const { examId } = req.params;
  const { records } = req.body || {};
  const data = await saveExamGrades({ examId, records });
  res.json({ ok: true, data });
}));

export default router;
