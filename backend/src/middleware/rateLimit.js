// backend/src/middleware/rateLimit.js
// ─────────────────────────────────────────────────────────────
// حماية تسجيل الدخول — طبقتان مستقلتان (Correction 4 من عقد التنفيذ المعتمَد):
//   1) loginIpLimiter      — حسب IP الطالب مباشرة (لا trust proxy مُفعَّل اليوم —
//      req.ip هو عنوان الاتصال الفعلي، تحقّقنا من ذلك قبل الكتابة).
//   2) loginAccountLimiter — حسب id الحساب المُرسَل في body، بصرف النظر عن وجوده
//      فعلياً في Postgres أم لا (نفس المفتاح لحساب حقيقي أو وهمي — لا يُفرَّق بينهما).
// كلا المحدِّدَين يُعيدان بالضبط نفس رسالة/رمز الحالة (429) بصرف النظر عن أيّهما
// أُطلِق ولماذا — لا تسريب لأي إشارة تكشف وجود/عدم وجود حساب عبر شكل الاستجابة.
// تخزين داخل الذاكرة فقط (بلا قاعدة بيانات) — يتّسق مع نشر أحادي العملية اليوم.
// ─────────────────────────────────────────────────────────────
import rateLimit from 'express-rate-limit';

const GENERIC_MESSAGE = { ok: false, error: 'محاولات كثيرة جداً. الرجاء المحاولة لاحقاً.' };

function genericHandler(req, res) {
  res.status(429).json(GENERIC_MESSAGE);
}

export const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20, // نافذة أوسع — يحمي من مصدر واحد يهاجم حسابات كثيرة
  standardHeaders: true,
  legacyHeaders: false,
  handler: genericHandler,
});

export const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5, // أضيق — يحمي حساباً واحداً من التخمين بصرف النظر عن مصدر الطلب
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const id = req.body?.id;
    return typeof id === 'string' && id.trim() ? id.trim().toLowerCase() : 'unknown-account';
  },
  handler: genericHandler,
});
