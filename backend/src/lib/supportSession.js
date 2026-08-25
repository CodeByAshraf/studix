// backend/src/lib/supportSession.js
// ─────────────────────────────────────────────────────────────
// Phase 4b — جلسة دعم منفصلة تماماً عن جلسة تسجيل الدخول العادية (session.js). نفس آلية
// التوقيع (HMAC-SHA256، بدون أي مكتبة جديدة)، لكن بمفتاح توقيع مُشتقّ (derived) من
// SESSION_SECRET بمجال مختلف تماماً (HKDF-style domain separation عبر HMAC) — تسريب أحد
// المفتاحين لا يُتيح تزوير الآخر تلقائياً، رغم اعتماد كليهما على نفس السرّ الجذري الوحيد
// المتاح فعلياً في .env (لا حاجة لمتغيّر بيئة إضافي). زائداً: اسم كوكي مختلف تماماً
// (SUPPORT_SESSION_COOKIE_NAME)، وشكل payload مختلف بنيوياً (purpose/sessionId/
// installationId — لا id/role إطلاقاً) — يمنع أي تشابه بنيوي مع جلسة المستخدم العادية.
//
// TTL أقصر بكثير من الجلسة العادية (12 ساعة) عمداً — جلسة دعم يجب ألا تعيش طويلاً.
// لا صلة إطلاقاً بـ requireAuth/verifySession العاديين: هذا الملف لا يُستورَد من
// session.js ولا العكس، ولا يشتركان في أي حالة. auth.js يستورد كليهما بشكل منفصل تماماً.
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';

const SECRET = process.env.SESSION_SECRET;
const SUPPORT_SESSION_TTL_MS = 30 * 60 * 1000; // 30 دقيقة — أقصر بكثير من جلسة تسجيل الدخول
const DOMAIN_SEPARATION_LABEL = 'studix:support-session:v1';

export const SUPPORT_SESSION_COOKIE_NAME = 'studix_support_session';
export const SUPPORT_SESSION_MAX_AGE_MS = SUPPORT_SESSION_TTL_MS;

// نفس منطق getSessionCookieOptions في session.js بالضبط (secure/sameSite قابلان
// للتهيئة، توبولوجي محلي بحت) — مُكرَّر هنا عمداً بدل الاستيراد المشترك، حتى تبقى جلسة
// الدعم مستقلة بنيوياً بالكامل عن جلسة تسجيل الدخول (لا أي استيراد متبادَل بين الملفين).
export function getSupportSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: process.env.COOKIE_SAME_SITE || 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
  };
}

function deriveSupportSecret() {
  if (!SECRET) throw new Error('SESSION_SECRET غير معرّف في backend/.env');
  return crypto.createHmac('sha256', SECRET).update(DOMAIN_SEPARATION_LABEL).digest();
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', deriveSupportSecret()).update(payloadB64).digest('base64url');
}

// signSupportSession: {sessionId, installationId} → توكن موقّع بمفتاح مُشتقّ منفصل. لا
// id ولا role في الـ payload إطلاقاً — بنيوياً غير قابل للخلط مع توكن جلسة عادية حتى لو
// وُضِع خطأً في كوكي studix_session (verifySession العادية ترفضه: توقيعه لا يطابق توقيع
// SESSION_SECRET المباشر، وحتى لو تجاوز ذلك افتراضياً، payload.id/payload.role كلاهما
// غير موجودين فيرفضهما فحص الشكل هناك أيضاً).
export function signSupportSession({ sessionId, installationId }) {
  if (!sessionId || !installationId) {
    throw new Error('sessionId وinstallationId مطلوبان لتوقيع جلسة دعم.');
  }
  const payload = JSON.stringify({
    purpose: 'support',
    sessionId,
    installationId,
    exp: Date.now() + SUPPORT_SESSION_TTL_MS,
  });
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

// verifySupportSessionToken: يتحقق من التوقيع (constant-time) والشكل والانتهاء، يُعيد
// {purpose, sessionId, installationId, exp} أو null. لا يستشير السجل الحيّ في الذاكرة
// (supportAccessCache.js) — تلك مسؤولية requireSupportSession في middleware/auth.js،
// حتى تبقى هذه الدالة نقية (توقيع/شكل/انتهاء التوكن نفسه فقط) وقابلة للاختبار مباشرة.
export function verifySupportSessionToken(token) {
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
    if (payload.purpose !== 'support' || !payload.sessionId || !payload.installationId) return null;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
