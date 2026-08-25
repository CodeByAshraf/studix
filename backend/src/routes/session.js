// backend/src/routes/session.js
// ─────────────────────────────────────────────────────────────
// POST /api/session   — تسجيل دخول: يتحقق من password_hash في PostgreSQL فقط.
// DELETE /api/session — تسجيل خروج: يمسح الكوكي.
// لا يُطبَع/يُسجَّل/يُعاد أبداً password أو password_hash في أي استجابة أو console.log.
// ─────────────────────────────────────────────────────────────
import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { verifyPbkdf2 } from '../lib/passwordVerify.js';
import { signSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS, getSessionCookieOptions } from '../lib/session.js';
import { getAuthState } from '../lib/authCache.js';
import { resolveEffectivePermissions } from '../middleware/permissions.js';
import { loginIpLimiter, loginAccountLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.post('/', loginIpLimiter, loginAccountLimiter, asyncHandler(async (req, res) => {
  const { id, password } = req.body || {};
  if (!id || !password) {
    return res.status(400).json({ ok: false, error: 'المعرّف وكلمة المرور مطلوبان.' });
  }

  const user = await prisma.users.findUnique({ where: { id } });
  const valid = !!user && user.active && !!user.password_hash && verifyPbkdf2(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ ok: false, error: 'بيانات الدخول غير صحيحة.' });
  }

  const role = user.is_admin ? 'admin' : (user.role_id || 'user');

  // يحمّل حالة التفويض الحالية (دور + صلاحيات + إصدارات) في الكاش مباشرة عند الدخول —
  // أول طلب لاحق يجد الكاش دافئاً بدل miss. القيم المضمَّنة في التوكن هي نفسها من
  // Postgres مباشرة (عبر الكاش)، لا من أي شيء يرسله العميل.
  const authState = await getAuthState(user.id);
  const token = signSession({
    id: user.id,
    role,
    userAuthVersion: authState?.userAuthVersion ?? user.auth_version,
    roleAuthVersion: authState?.roleAuthVersion ?? null,
  });

  res.cookie(SESSION_COOKIE_NAME, token, {
    ...getSessionCookieOptions(),
    maxAge: SESSION_MAX_AGE_MS,
  });

  await prisma.users.update({ where: { id: user.id }, data: { last_login: new Date() } });

  // permissions هنا للاسترشاد بالواجهة فقط (بناء القوائم/الإخفاء) — التفويض الفعلي
  // يُعاد فحصه بشكل مستقل ومُعتمَد على الخادم في كل طلب لاحق عبر requirePermission،
  // وليس عبر ما يُعاد هنا. "Backend authorization is authoritative."
  const effectivePermissions = resolveEffectivePermissions(authState);
  res.json({
    ok: true,
    user: { id: user.id, name: user.name, role, active: user.active, permissions: effectivePermissions },
  });
}));

router.delete('/', (req, res) => {
  // نفس خصائص res.cookie أعلاه بالضبط (sameSite/secure/path) — بعض المتصفحات لا تحذف
  // الكوكي بموثوقية لو اختلفت الخصائص عن وقت إنشائها (maxAge غير مطلوبة للحذف).
  res.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions());
  res.json({ ok: true });
});

export default router;
