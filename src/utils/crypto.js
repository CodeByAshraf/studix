// src/utils/crypto.js
// ─────────────────────────────────────────────────────────────────────────────
// Password Security Layer — Web Crypto API (مدمجة في كل المتصفحات الحديثة)
//
// المشكلة:
//   كلمات المرور محفوظة plaintext في initialData.js وفي الـ Zustand store
//   أي شخص يفتح Redux DevTools أو localStorage يرى كل الكلمات
//
// الحل:
//   PBKDF2 + SHA-256 + random salt لكل كلمة مرور
//   PBKDF2 = Password-Based Key Derivation Function 2
//   iterations = 100,000 → بطيء عمداً لمنع brute-force
//
// تنسيق الـ hash المُخزَّن:
//   "pbkdf2:100000:BASE64_SALT:BASE64_HASH"
//   يحتوي على كل المعلومات اللازمة للتحقق لاحقاً
//
// ملاحظة بنيوية:
//   هذا التطبيق offline-first بدون backend حقيقي.
//   في بيئة production مع backend: يجب أن يتم الـ hashing على الـ server
//   باستخدام bcrypt أو argon2, وليس على الـ client.
//   هذا الحل يحمي من casual inspection لكن ليس من هجمات server-side.
// ─────────────────────────────────────────────────────────────────────────────

const ITERATIONS  = 100_000;
const KEY_LENGTH  = 32;        // 256 bits
const HASH_PREFIX = 'pbkdf2';

// ── Internal helpers ──────────────────────────────────────────────────────────
function toBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function fromBase64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

async function deriveKey(password, salt) {
  const encoder   = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name:       'PBKDF2',
      salt:       salt,
      iterations: ITERATIONS,
      hash:       'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH * 8,
  );
  return bits;
}

// ── Public API ────────────────────────────────────────────────────────────────

// hashPassword: تأخذ plain password وتُعيد hash string آمن للتخزين
// async لأن Web Crypto API async
export async function hashPassword(password) {
  const salt    = crypto.getRandomValues(new Uint8Array(16));
  const hashBuf = await deriveKey(password, salt);
  return `${HASH_PREFIX}:${ITERATIONS}:${toBase64(salt)}:${toBase64(hashBuf)}`;
}

// verifyPassword: تقارن plain password بـ stored hash
// تُعيد true إذا تطابقا، false إذا لم يتطابقا
export async function verifyPassword(password, storedHash) {
  // لا fallback نصي (plaintext) بعد الآن — إزالة صريحة ضمن Decision 8/Decision 6
  // (Stabilization phase): أي هاش غير بصيغة pbkdf2 مرفوض، لا يُقارَن كنص خام أبداً.
  if (!storedHash || !storedHash.startsWith(HASH_PREFIX)) {
    return false;
  }

  const parts = storedHash.split(':');
  if (parts.length !== 4) return false;

  const [, iterStr, saltB64, hashB64] = parts;
  const iterations = parseInt(iterStr, 10);
  if (isNaN(iterations)) return false;

  const salt    = fromBase64(saltB64);
  const stored  = fromBase64(hashB64);

  // نُعيد حساب الـ hash بنفس الـ salt
  const encoder = new TextEncoder();
  const keyMat  = await crypto.subtle.importKey(
    'raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMat,
    KEY_LENGTH * 8,
  );

  // Constant-time comparison لمنع timing attacks
  const a = new Uint8Array(derived);
  const b = stored;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// isHashed: فحص سريع إذا كانت الكلمة مُشفَّرة أم لا
export function isHashed(storedHash) {
  return typeof storedHash === 'string' && storedHash.startsWith(HASH_PREFIX);
}

// maskPassword: يُخفي الكلمة في الـ logs والـ DevTools
// يُستخدم قبل تخزين user object في الـ state
export function maskPassword(userObj) {
  if (!userObj) return userObj;
  const { password: _, ...safeUser } = userObj; // eslint-disable-line no-unused-vars
  return safeUser;
}
