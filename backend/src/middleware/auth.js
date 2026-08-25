// backend/src/middleware/auth.js
// ─────────────────────────────────────────────────────────────
// requireAuth: يتحقق من كوكي الجلسة الموقّعة (HttpOnly). لا يثق بأي
// id/role يُرسله العميل في body/headers — المصدر الوحيد للهوية هو
// توقيع الجلسة الذي يصدره الخادم في POST /api/session.
//
// requireSupportSession (Phase 4b): نفس المبدأ لكن لكوكي جلسة دعم منفصلة تماماً
// (supportSession.js) — مفتاح توقيع مُشتقّ مختلف، اسم كوكي مختلف، شكل payload مختلف
// بنيوياً (لا id/role إطلاقاً). لا يوجد أي مسار محمي بها بعد في هذه المرحلة (Phase 4b
// backend-only — لا موارد دعم محمية بعد)؛ مُصدَّرة الآن جاهزة لمراحل لاحقة، ومُختبَرة
// مباشرة هنا. يفحص أيضاً السجل الحيّ في الذاكرة (supportAccessCache.js) — توكن موقّع
// بشكل صحيح لكن مُلغى/منتهي في السجل يُرفَض رغم ذلك (فشل مغلَق مزدوج: توقيع + حالة حيّة).
// ─────────────────────────────────────────────────────────────
import { verifySession, SESSION_COOKIE_NAME } from '../lib/session.js';
import { verifySupportSessionToken, SUPPORT_SESSION_COOKIE_NAME } from '../lib/supportSession.js';
import { isSupportSessionActive } from '../lib/supportAccessCache.js';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

export function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySession(cookies[SESSION_COOKIE_NAME]);
  if (!session) {
    return res.status(401).json({ ok: false, error: 'يجب تسجيل الدخول للوصول لهذا المسار.' });
  }
  req.user = session; // { id, role } — من التوقيع المتحقَّق منه فقط
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: 'لا تملك صلاحية الوصول لهذا الإجراء.' });
    }
    next();
  };
}

export function requireSupportSession(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const supportSession = verifySupportSessionToken(cookies[SUPPORT_SESSION_COOKIE_NAME]);
  if (!supportSession || !isSupportSessionActive(supportSession.sessionId)) {
    return res.status(401).json({ ok: false, error: 'جلسة الدعم غير صالحة أو منتهية أو مُلغاة.' });
  }
  req.supportSession = supportSession; // { purpose:'support', sessionId, installationId, exp }
  next();
}
