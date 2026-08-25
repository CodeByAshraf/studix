// backend/src/middleware/auth.js
// ─────────────────────────────────────────────────────────────
// requireAuth: يتحقق من كوكي الجلسة الموقّعة (HttpOnly). لا يثق بأي
// id/role يُرسله العميل في body/headers — المصدر الوحيد للهوية هو
// توقيع الجلسة الذي يصدره الخادم في POST /api/session.
// ─────────────────────────────────────────────────────────────
import { verifySession, SESSION_COOKIE_NAME } from '../lib/session.js';

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
