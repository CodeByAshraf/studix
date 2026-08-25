// backend/src/lib/passwordVerify.js
// ─────────────────────────────────────────────────────────────
// يتحقق من هاش PBKDF2 بنفس تنسيق src/utils/crypto.js (الفرونت-إند)
// "pbkdf2:iterations:base64_salt:base64_hash" — بدون تغيير أي هاش مخزَّن.
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';

const HASH_PREFIX = 'pbkdf2';
const KEY_LENGTH = 32; // 256 bits — يطابق KEY_LENGTH في crypto.js بالفرونت
const ITERATIONS = 100_000; // يطابق ITERATIONS في crypto.js بالفرونت

// hashPbkdf2: توليد هاش جديد على الخادم (لا نثق أبداً بهاش يُرسله العميل جاهزاً —
// إنشاء/تعديل حساب مستخدم يُجزّئ كلمة المرور هنا، وليس في المتصفح). نفس التنسيق
// تماماً الذي يتحقق منه verifyPbkdf2 أعلاه، ونفس الذي يتحقق منه crypto.js بالفرونت.
export function hashPbkdf2(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');
  return `${HASH_PREFIX}:${ITERATIONS}:${salt.toString('base64')}:${derived.toString('base64')}`;
}

export function isPbkdf2Format(hash) {
  if (typeof hash !== 'string') return false;
  const parts = hash.split(':');
  return parts.length === 4 && parts[0] === HASH_PREFIX && /^\d+$/.test(parts[1]);
}

export function verifyPbkdf2(password, storedHash) {
  if (!isPbkdf2Format(storedHash)) return false;
  const [, iterStr, saltB64, hashB64] = storedHash.split(':');
  const iterations = parseInt(iterStr, 10);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  let salt, stored;
  try {
    salt = Buffer.from(saltB64, 'base64');
    stored = Buffer.from(hashB64, 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || stored.length === 0) return false;

  const derived = crypto.pbkdf2Sync(password, salt, iterations, KEY_LENGTH, 'sha256');
  if (derived.length !== stored.length) return false;
  return crypto.timingSafeEqual(derived, stored);
}
