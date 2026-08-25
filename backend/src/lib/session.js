// backend/src/lib/session.js
// ─────────────────────────────────────────────────────────────
// توقيع/تحقق جلسة موقّعة (HMAC-SHA256) — بدون أي مكتبة جديدة.
// السرّ يبقى فقط في backend/.env (SESSION_SECRET) — لا يصل أبداً للفرونت-إند.
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';

const SECRET = process.env.SESSION_SECRET;
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 ساعة

export const SESSION_COOKIE_NAME = 'studix_session';
export const SESSION_MAX_AGE_MS = MAX_AGE_MS;

// Production Readiness Fix — Finding 2: secure/sameSite كانا ثابتين (secure: false دائماً)
// بلا أي غطاء تهيئة. توبولوجي هذا التطبيق مؤكَّد من المستخدم (ليس افتراضاً): تطبيق
// سطح مكتب/محلي، نسخة مستقلة لكل معلّم على جهازه الخاص — الباك-إند وPostgreSQL
// والواجهة الأمامية كلها على نفس الجهاز دائماً (منفذان مختلفان فقط، مثال
// localhost:4000/localhost:5173)، بلا reverse proxy إطلاقاً، وعادة بلا HTTPS (اتصال
// loopback محلي بحت لا يغادر الجهاز أبداً). لهذا التوبولوجي تحديداً:
//   - secure=false صحيح فعلياً افتراضياً — لا يوجد HTTPS حقيقي هنا؛ secure=true بلا
//     HTTPS فعلي يجعل المتصفح يرفض إرسال الكوكي كلياً، فيكسر تسجيل الدخول تماماً.
//     يبقى قابلاً للتفعيل عبر COOKIE_SECURE=true لو شُغِّل خلف HTTPS حقيقي مستقبلاً.
//   - sameSite='lax' صحيح ويعمل هنا لأن localhost:4000/localhost:5173 يُعتبَران "نفس
//     الموقع" (same-site) من منظور خاصية SameSite (نفس المضيف "localhost"، منفذ
//     مختلف فقط) — لا حاجة لـ 'none' إطلاقاً؛ استخدامه بلا سبب حقيقي سيتطلّب
//     secure=true فيكسر HTTP المحلي أيضاً.
// كلا المتغيّرين اختياريان بالكامل — القيم الافتراضية صحيحة للتوبولوجي المعتمَد بلا
// أي إعداد بيئة إضافي. مُشترَكة بين set/clear (session.js) حتى لا تنحرف عن بعضها أبداً.
export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: process.env.COOKIE_SAME_SITE || 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
  };
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
}

// signSession: {id, role, userAuthVersion, roleAuthVersion} → توكن موقّع. لا يثق أي
// مسار لاحق بأي id/role/إصدار غير هذا التوكن. userAuthVersion/roleAuthVersion هما
// لقطة (snapshot) من auth_version وقت تسجيل الدخول — يُقارَنان لاحقاً بالقيمة الحالية
// في الكاش/Postgres (requirePermission) لإبطال الجلسة فوراً عند أي تغيير دور/صلاحيات.
export function signSession({ id, role, userAuthVersion, roleAuthVersion }) {
  if (!SECRET) throw new Error('SESSION_SECRET غير معرّف في backend/.env');
  const payload = JSON.stringify({
    id, role, userAuthVersion: userAuthVersion ?? null, roleAuthVersion: roleAuthVersion ?? null,
    exp: Date.now() + MAX_AGE_MS,
  });
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

// verifySession: يتحقق من التوقيع (constant-time) والانتهاء، يُعيد
// {id, role, userAuthVersion, roleAuthVersion} أو null.
export function verifySession(token) {
  if (!SECRET || !token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload.id || !payload.role) return null;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return {
      id: payload.id,
      role: payload.role,
      userAuthVersion: payload.userAuthVersion ?? null,
      roleAuthVersion: payload.roleAuthVersion ?? null,
    };
  } catch {
    return null;
  }
}
