// backend/src/routes/examDelete.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 3B-5 — حذف امتحان مع كل درجاته بمعاملة ذرّية واحدة.
// الواجهة الحالية تَعِد المستخدم أن حذف الامتحان يحذف كل الدرجات المرتبطة —
// لكن grades.exam_id → exams.id هو NO ACTION، فحذف الامتحان مباشرة (CRUD العام)
// سيُرفَض (P2003) لو كان له درجات. هذا المسار يُنفّذ نفس السلوك الذي تعده الواجهة،
// لكن فعلياً وبمعاملة واحدة: naitherالحذفان معاً ينجحان أو لا شيء يتغيّر.
//
// يُعترَض هنا فقط DELETE /:id — بقية الأفعال (GET/POST/PUT) على /api/exams تبقى
// كما هي عبر الـ CRUD العام (makeCrudRouter)، الذي يُركَّب لاحقاً في server.js.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { runInTransaction } from '../lib/transaction.js';
import { asyncHandler } from '../middleware/errorHandler.js';

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  err.expose = true;
  return err;
}

// يُصدَّر منفصلاً عن الـ router ليكون قابلاً للاختبار مباشرة بلا HTTP/auth.
export async function deleteExamCascade(examId) {
  if (typeof examId !== 'string' || !examId.trim()) throw notFound('الامتحان غير موجود.');

  const exam = await prisma.exams.findUnique({ where: { id: examId }, select: { id: true } });
  if (!exam) throw notFound('الامتحان غير موجود.');

  return runInTransaction(async (tx) => {
    const { count } = await tx.grades.deleteMany({ where: { exam_id: examId } });
    await tx.exams.delete({ where: { id: examId } });
    return { deletedGrades: count };
  });
}

const router = Router();

// DELETE /api/exams/:id — يحذف الامتحان وكل درجاته معاً (أو لا شيء عند أي فشل)
router.delete('/:id', asyncHandler(async (req, res) => {
  const data = await deleteExamCascade(req.params.id);
  res.json({ ok: true, data });
}));

export default router;
