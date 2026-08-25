// backend/src/lib/supportAccess.js
// ─────────────────────────────────────────────────────────────
// Phase 4b — Support Access core: challenge generation + Ed25519 signature verification.
// Asymmetric offline challenge-response (approved architecture report) — this application
// never holds, stores, or transmits a private key. It only ever reads a PUBLIC key
// (support_access_config.support_public_key, Phase 4a column, still empty until the
// owner-side signer tool — Phase 4d, not built yet — generates a real keypair). Verifying
// a signature with a public key can never leak or reconstruct the private key; that is
// the entire point of asymmetric crypto here.
//
// crypto.sign/verify(null, data, key, signature) is Node's built-in calling convention for
// Ed25519/Ed448 specifically (no separate digest algorithm — the curve has its own
// built-in hash) — no npm dependency needed, matching every other crypto primitive already
// in this project (session.js's HMAC, passwordVerify.js's PBKDF2).
//
// A challenge is fully self-describing (installationId + nonce + iat/exp, base64url-
// encoded JSON) — the server needs no memory of having issued it to verify a response
// later; the caller submits the original challenge string back alongside the response,
// and everything needed to check it (installation binding, expiry, signature) is
// re-derived from that string plus the current support_access_config row. The only
// state that genuinely must be remembered server-side is "has this nonce already been
// consumed/revoked" — that lives in supportAccessCache.js (in-memory, by design).
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { prisma } from '../prisma.js';

export const CHALLENGE_TTL_MS = 15 * 60 * 1000; // 15 دقيقة — قصير عمداً، يُقرأ/يُرسَل يدوياً بين الطرفين

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  err.expose = true;
  return err;
}

// ensureInstallationConfig: يقرأ صفّ support_access_config الوحيد (id=1)، أو يُنشئه لو
// غائباً (تثبيت جديد طُبِّق عليه studix-schema.sql بدون صفّ التزريع — انظر الفجوة
// الموثَّقة في رأس backend/migrations/002_support_access.sql: "Seeding the row for a
// fresh install is Phase 4b's responsibility" — هذا بالضبط تنفيذ تلك المسؤولية).
// installation_id يُولَّد مرّة واحدة فقط عبر DEFAULT gen_random_uuid()::text في القاعدة
// نفسها (لا حساب هنا) ويبقى ثابتاً بعدها بفضل trg_support_config_installation_immutable.
export async function ensureInstallationConfig() {
  const existing = await prisma.support_access_config.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  try {
    return await prisma.support_access_config.create({ data: { id: 1 } });
  } catch (err) {
    // سباق نادر: عمليتان متزامنتان حاولتا الإنشاء معاً — الثانية تصطدم بـ unique/PK
    // (P2002)، تقرأ الصفّ الذي أنشأته الأولى بدل الفشل.
    if (err.code === 'P2002') return prisma.support_access_config.findUniqueOrThrow({ where: { id: 1 } });
    throw err;
  }
}

export function buildChallengeString({ installationId, nonce, iat, exp }) {
  const payload = JSON.stringify({ v: 1, installationId, nonce, iat, exp });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

// parseChallengeString: يتحقق من الشكل الكامل (كل الحقول موجودة وبالنوع الصحيح) — أي
// انحراف (JSON تالف، base64url غير صالح، حقل ناقص/بنوع خاطئ) يُعيد null صراحةً، لا يرمي.
export function parseChallengeString(challenge) {
  if (typeof challenge !== 'string' || !challenge) return null;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(challenge, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (
    !parsed || parsed.v !== 1 ||
    typeof parsed.installationId !== 'string' || !parsed.installationId ||
    typeof parsed.nonce !== 'string' || !parsed.nonce ||
    typeof parsed.iat !== 'number' || typeof parsed.exp !== 'number'
  ) {
    return null;
  }
  return parsed;
}

// generateChallenge: يقرأ/يضمن صفّ التثبيت، يرفض (409) لو لا مفتاح عام مُهيَّأ بعد (فشل
// مغلَق — لا شفرة تُصدَر أبداً لا يمكن التحقق منها لاحقاً إطلاقاً)، وإلا يُنشئ nonce عشوائياً
// (crypto.randomBytes، لا Math.random إطلاقاً) ويبنيها شفرة مُرتبطة بهذا التثبيت تحديداً.
export async function generateChallenge() {
  const config = await ensureInstallationConfig();
  if (!config.support_public_key) {
    throw conflict('دعم الوصول غير مُهيَّأ على هذا التثبيت — لا يوجد مفتاح عام مسجَّل بعد.');
  }
  const nonce = crypto.randomBytes(18).toString('base64url');
  const iat = Date.now();
  const exp = iat + CHALLENGE_TTL_MS;
  const challenge = buildChallengeString({ installationId: config.installation_id, nonce, iat, exp });
  return { challenge, nonce, installationId: config.installation_id, iat, exp };
}

// verifyChallengeSignature: دالة نقية بالكامل (بلا I/O) — تستقبل installationId/
// publicKeyPem الفعليين (من القاعدة) بدل قراءتهما بنفسها، لتبقى قابلة للاختبار مباشرة
// بلا Prisma/DB إطلاقاً. أي سبب رفض يُعاد بوضوح في reason (لا استثناء لحالات الرفض
// المتوقَّعة — فقط لأخطاء غير متوقّعة حقاً).
export function verifyChallengeSignature({ challenge, response, installationId, publicKeyPem }) {
  const parsed = parseChallengeString(challenge);
  if (!parsed) return { ok: false, reason: 'malformed_challenge', nonce: null };
  if (parsed.installationId !== installationId) return { ok: false, reason: 'wrong_installation', nonce: parsed.nonce };
  if (parsed.exp < Date.now()) return { ok: false, reason: 'expired', nonce: parsed.nonce };

  if (typeof response !== 'string' || !response) {
    return { ok: false, reason: 'malformed_response', nonce: parsed.nonce };
  }

  let publicKey;
  try {
    publicKey = crypto.createPublicKey(publicKeyPem);
  } catch {
    return { ok: false, reason: 'bad_public_key', nonce: parsed.nonce };
  }

  let signatureBuf;
  try {
    signatureBuf = Buffer.from(response, 'base64url');
  } catch {
    return { ok: false, reason: 'malformed_response', nonce: parsed.nonce };
  }

  let valid = false;
  try {
    // Ed25519: أول وسيط (algorithm) يجب أن يكون null دائماً — لا خوارزمية هضم منفصلة.
    valid = crypto.verify(null, Buffer.from(challenge, 'utf8'), publicKey, signatureBuf);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'invalid_signature', nonce: parsed.nonce };

  return { ok: true, reason: null, nonce: parsed.nonce, installationId: parsed.installationId };
}

// verifySupportChallenge: الغلاف المتصل بقاعدة البيانات — يقرأ installation_id/المفتاح
// العام الحاليين فعلياً، ثم يُفوِّض للدالة النقية أعلاه. نفس فشل-مغلَق لو لا مفتاح مُهيَّأ.
export async function verifySupportChallenge({ challenge, response }) {
  const config = await ensureInstallationConfig();
  if (!config.support_public_key) {
    throw conflict('دعم الوصول غير مُهيَّأ على هذا التثبيت — لا يوجد مفتاح عام مسجَّل بعد.');
  }
  return verifyChallengeSignature({
    challenge, response, installationId: config.installation_id, publicKeyPem: config.support_public_key,
  });
}
