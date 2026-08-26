// backend/src/middleware/errorHandler.js
// ─────────────────────────────────────────────────────────────
// معالجة الأخطاء المركزية — تحوّل أخطاء Prisma/عامة إلى استجابات JSON نظيفة.
// ─────────────────────────────────────────────────────────────
import logger from '../lib/logger.js';

// أخطاء Prisma الشائعة → رسائل مفهومة
function mapPrismaError(err) {
  switch (err.code) {
    case 'P2002': // unique constraint
      return { status: 409, message: 'قيمة مكرّرة تنتهك قيد التفرّد.', field: err.meta?.target };
    case 'P2003': // FK constraint
      return { status: 409, message: 'انتهاك مفتاح خارجي (سجل مرتبط غير موجود).', field: err.meta?.field_name };
    case 'P2025': // not found
      return { status: 404, message: 'السجل غير موجود.' };
    case 'P2000': // value too long
      return { status: 400, message: 'قيمة أطول من المسموح.' };
    case 'P2004': // DB constraint failed (بعض إصدارات محرّك الاستعلام تصنّف CHECK constraint هكذا)
      return { status: 400, message: 'القيمة تنتهك قيداً (CHECK constraint) في قاعدة البيانات.', field: err.meta?.constraint };
    default:
      return null;
  }
}

// انتهاك PostgreSQL CHECK constraint (SQLSTATE 23514) يصل عادة كـ PrismaClientUnknownRequestError
// بلا code/meta منظّمة — المحرّك يضمّن رسالة الخطأ الخام (بما فيها رمز الـ SQLSTATE) داخل err.message فقط.
function matchPgCheckViolation(err) {
  const msg = String(err?.message || '');
  if (!/code:\s*"23514"/.test(msg)) return null;
  // محرّك الاستعلام يُضمّن الرسالة كنص Rust Debug-escaped، فعلامات الاقتباس الداخلية
  // قد تُسبَق بـ backslash حرفي (\") وليس فقط " عادية
  const constraint = msg.match(/violates check constraint \\?"([^"\\]+)\\?"/)?.[1];
  return { constraint };
}

// 404 handler
export function notFound(req, res) {
  res.status(404).json({ ok: false, error: `المسار غير موجود: ${req.method} ${req.path}` });
}

// معالج الأخطاء العام (يجب أن يكون آخر middleware)
export function errorHandler(err, req, res, _next) {
  // خطأ Prisma معروف
  if (err.code && String(err.code).startsWith('P')) {
    const mapped = mapPrismaError(err);
    if (mapped) {
      return res.status(mapped.status).json({ ok: false, error: mapped.message, field: mapped.field });
    }
  }

  // انتهاك PostgreSQL CHECK constraint (23514) — واصل بلا P-code منظّم
  const checkViolation = matchPgCheckViolation(err);
  if (checkViolation) {
    return res.status(400).json({
      ok: false,
      error: 'القيمة تنتهك قيداً (CHECK constraint) في قاعدة البيانات.',
      field: checkViolation.constraint,
    });
  }

  // خطأ تحقّق مخصّص
  if (err.status && err.expose) {
    return res.status(err.status).json({ ok: false, error: err.message });
  }

  // خطأ غير متوقّع — لا نسرّب التفاصيل الحساسة في استجابة HTTP. Phase 6b: يُسجَّل أيضاً في
  // ملف السجلّ الدائم (logger.js) لتشخيص أعطال وقت التشغيل بعد إغلاق نافذة الطرفية — نفس
  // معلومات console.error السابقة بالضبط، بلا أي تغيير على الاستجابة المُعادة للعميل.
  logger.error(`خطأ غير متوقّع: ${err.message}`, { path: req.path, method: req.method, stack: err.stack });
  res.status(500).json({ ok: false, error: 'خطأ داخلي في الخادم.' });
}

// wrapper لالتقاط أخطاء async في الـ routes
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
