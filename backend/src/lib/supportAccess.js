// backend/src/lib/supportAccess.js
// ─────────────────────────────────────────────────────────────
// Phase 4b — Support Access core: challenge generation + Ed25519 signature verification.
// Asymmetric offline challenge-response (approved architecture report) — this application
// never holds, stores, or transmits a private key. It only ever reads a PUBLIC key
// (support_access_config.support_public_key, Phase 4a column). Verifying a signature with
// a public key can never leak or reconstruct the private key; that is the entire point of
// asymmetric crypto here. The private key lives only on the owner's own machine — signed
// offline by tools/support-signer.js (Phase 4d), never inside this application.
//
// Phase 4d: buildChallengeString/parseChallengeString/verifyChallengeSignature moved to
// supportChallengeFormat.js (pure, no prisma import) so the offline owner-side signer tool
// can import the exact same wire-format/verification code with zero database coupling —
// re-exported here unchanged so every existing import site keeps working as before.
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
import { buildChallengeString, parseChallengeString, verifyChallengeSignature } from './supportChallengeFormat.js';

export { buildChallengeString, parseChallengeString, verifyChallengeSignature };

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
