// backend/src/lib/licenseArtifactFormat.js
// ─────────────────────────────────────────────────────────────
// Phase 5b — Licensing core: signed license artifact format + Ed25519 verification. Same
// design pattern as supportChallengeFormat.js — a pure, dependency-free module (no prisma
// import) so a future owner-side license issuer tool (Phase 5d) can import the exact same
// wire-format/verification code with zero database coupling, exactly like
// tools/lib/challengeSigning.js already does for Support Access.
//
// Shape difference from Support Access's challenge/response, deliberately: Support Access
// has two parties exchanging two separate strings (a server-issued challenge, an
// owner-issued response) across one interactive redemption. Licensing has one party (the
// owner) producing one self-contained signed document that must be storable verbatim as a
// single value (license_config.license_artifact) and re-verifiable from scratch at any
// time, with no redemption/consumption step. So the artifact bundles payload + signature
// together, "<payloadB64>.<signatureB64>" — structurally closer to supportSession.js's
// token shape than to supportChallengeFormat.js's two-part exchange, just with Ed25519
// (asymmetric, owner-signed) in place of HMAC (symmetric, self-signed by the same server
// that verifies it) — because unlike a session token, a license artifact must be
// verifiable by a party (this application) that could never have produced it itself.
//
// crypto.sign/verify(null, data, key, signature) is Node's built-in calling convention for
// Ed25519 specifically (no separate digest algorithm) — no npm dependency needed, same as
// every other crypto primitive already in this project.
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';

// PRODUCT_ID: يُضمَّن في كل شهادة ترخيص ويُقارَن عند التحقق — يمنع بنيوياً إعادة استخدام
// ترخيص مُصدَر لمنتج آخر افتراضي مستقبلي بنفس زوج المفاتيح، حتى لو تشابه كل شيء آخر.
export const PRODUCT_ID = 'studix';

export function buildLicenseArtifactPayload({ licenseId, product, installationId, issuedAt, expiresAt = null, features = null }) {
  const payload = JSON.stringify({
    v: 1, licenseId, product, installationId, issuedAt,
    expiresAt: expiresAt ?? null, features: features ?? null,
  });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

// parseLicenseArtifact: يتحقق من الشكل الكامل بلا استثناء أبداً — أي انحراف (JSON تالف،
// base64url غير صالح، عدد أجزاء خاطئ، حقل ناقص/بنوع خاطئ، إصدار بروتوكول غير مدعوم) يُعيد
// null صراحةً. expiresAt/features يُقبَلان null صراحةً (ترخيص دائم / بلا ميزات محدَّدة) —
// أي قيمة أخرى غير الشكل المتوقَّع (رقم أو null / مصفوفة أو null على الترتيب) تُرفَض.
export function parseLicenseArtifact(artifact) {
  if (typeof artifact !== 'string' || !artifact) return null;
  const parts = artifact.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, signatureB64] = parts;
  if (!payloadB64 || !signatureB64) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (
    !payload || payload.v !== 1 ||
    typeof payload.licenseId !== 'string' || !payload.licenseId ||
    typeof payload.product !== 'string' || !payload.product ||
    typeof payload.installationId !== 'string' || !payload.installationId ||
    typeof payload.issuedAt !== 'number' ||
    !(payload.expiresAt === null || typeof payload.expiresAt === 'number') ||
    !(payload.features === null || Array.isArray(payload.features))
  ) {
    return null;
  }
  return { payload, payloadB64, signatureB64 };
}

// verifyLicenseArtifact: دالة نقية بالكامل (بلا I/O) — تستقبل installationId/product/
// publicKeyPem الفعليين (من القاعدة/الثوابت) بدل قراءتهما بنفسها، لتبقى قابلة للاختبار
// مباشرة بلا Prisma/DB إطلاقاً. كل سبب رفض واضح في reason — لا "نجاح جزئي" ولا افتراض
// أبداً: توقيع غير صالح، تثبيت خاطئ، منتج خاطئ، أو انتهاء الصلاحية كلها ترفض بوضوح متساوٍ.
export function verifyLicenseArtifact({ artifact, installationId, product, publicKeyPem, now = Date.now() }) {
  const parsed = parseLicenseArtifact(artifact);
  if (!parsed) return { ok: false, reason: 'malformed_artifact', payload: null };
  const { payload, payloadB64, signatureB64 } = parsed;

  if (payload.product !== product) return { ok: false, reason: 'wrong_product', payload };
  if (payload.installationId !== installationId) return { ok: false, reason: 'wrong_installation', payload };

  let publicKey;
  try {
    publicKey = crypto.createPublicKey(publicKeyPem);
  } catch {
    return { ok: false, reason: 'bad_public_key', payload };
  }

  let signatureBuf;
  try {
    signatureBuf = Buffer.from(signatureB64, 'base64url');
  } catch {
    return { ok: false, reason: 'malformed_artifact', payload };
  }

  let valid = false;
  try {
    // Ed25519: أول وسيط (algorithm) يجب أن يكون null دائماً — لا خوارزمية هضم منفصلة.
    valid = crypto.verify(null, Buffer.from(payloadB64, 'utf8'), publicKey, signatureBuf);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'invalid_signature', payload };

  // انتهاء الصلاحية يُفحَص بعد التوقيع عمداً — لا معنى للثقة بـ expiresAt من شهادة لم
  // يُتحقَّق من صحّتها بعد. expiresAt === null يعني ترخيصاً دائماً، يتخطّى هذا الفحص كلياً.
  if (payload.expiresAt !== null && payload.expiresAt < now) {
    return { ok: false, reason: 'expired', payload };
  }

  return { ok: true, reason: null, payload };
}

// buildActivationRequestCode/parseActivationRequestCode: رمز طلب التفعيل — معلوماتي بحت
// (يُبلِّغ المالك بـ installationId/product ليعرف لأيّ تثبيت يُصدِر الترخيص)، غير موقَّع
// (لا شيء يُثبِته بنفسه — ليس "تحدّياً" يُستهلَك كما في Support Access) وبلا انتهاء صلاحية
// (إصدار عدّة شهادات ترخيص لنفس التثبيت بمرور الوقت — تجديد، إعادة تفعيل — أمر طبيعي
// متوقَّع، لا إعادة استخدام يجب منعها).
export function buildActivationRequestCode({ installationId, product }) {
  const payload = JSON.stringify({ v: 1, installationId, product });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function parseActivationRequestCode(code) {
  if (typeof code !== 'string' || !code) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(code, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (
    !payload || payload.v !== 1 ||
    typeof payload.installationId !== 'string' || !payload.installationId ||
    typeof payload.product !== 'string' || !payload.product
  ) {
    return null;
  }
  return payload;
}
