// backend/src/routes/homeworkDelete.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 3B-6 — حذف واجب مع كل سجلات تسليمه بمعاملة ذرّية واحدة.
// الواجهة الحالية تَعِد المستخدم أن حذف الواجب يحذف كل سجلات التسليم المرتبطة —
// لكن hw_submissions.homework_id → homeworks.id هو NO ACTION، فحذف الواجب مباشرة
// (CRUD العام) سيُرفَض (P2003) لو كان له سجلات تسليم. هذا المسار يُنفّذ نفس السلوك
// الذي تعده الواجهة، لكن فعلياً وبمعاملة واحدة: إما الحذفان معاً ينجحان أو لا شيء يتغيّر.
//
// يُعترَض هنا فقط DELETE /:id — بقية الأفعال (GET/POST/PUT) على /api/homeworks تبقى
// كما هي عبر الـ CRUD العام (makeCrudRouter)، الذي يُركَّب لاحقاً في server.js.
// نفس تقنية backend/src/routes/examDelete.js تماماً.
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
export async function deleteHomeworkCascade(homeworkId) {
  if (typeof homeworkId !== 'string' || !homeworkId.trim()) throw notFound('الواجب غير موجود.');

  const hw = await prisma.homeworks.findUnique({ where: { id: homeworkId }, select: { id: true } });
  if (!hw) throw notFound('الواجب غير موجود.');

  return runInTransaction(async (tx) => {
    const { count } = await tx.hw_submissions.deleteMany({ where: { homework_id: homeworkId } });
    await tx.homeworks.delete({ where: { id: homeworkId } });
    return { deletedSubmissions: count };
  });
}

const router = Router();

// DELETE /api/homeworks/:id — يحذف الواجب وكل سجلات تسليمه معاً (أو لا شيء عند أي فشل)
router.delete('/:id', asyncHandler(async (req, res) => {
  const data = await deleteHomeworkCascade(req.params.id);
  res.json({ ok: true, data });
}));

export default router;
