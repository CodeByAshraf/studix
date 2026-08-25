// backend/src/lib/supportChallengeFormat.js
// ─────────────────────────────────────────────────────────────
// Phase 4d extraction (pure move, zero behavior change) — the wire-format and Ed25519
// verification logic used to live directly in supportAccess.js, which also imports
// prisma.js (instantiates a PrismaClient at module-load time, requiring a valid
// DATABASE_URL). That coupling is fine for the backend server itself, but the owner-side
// offline signer tool (tools/) must never touch a database or require DATABASE_URL — it
// runs on the owner's own machine, disconnected from any customer's Postgres. Splitting
// these three pure, I/O-free functions out into their own dependency-free module lets
// tools/lib/challengeSigning.js import the *exact* same parsing/verification code (not a
// re-implementation — zero drift risk) with zero database coupling.
//
// supportAccess.js re-exports all three from here unchanged, so every existing import of
// buildChallengeString/parseChallengeString/verifyChallengeSignature from
// '../lib/supportAccess.js' (routes, tests) keeps working exactly as before — this is a
// pure relocation, not a protocol change.
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';

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
