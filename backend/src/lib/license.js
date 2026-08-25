// backend/src/lib/license.js
// ─────────────────────────────────────────────────────────────
// Phase 5b — Licensing core: reads/writes license_config, always re-verifying the stored
// signed artifact rather than trusting any cached column. installation_id is never
// duplicated — read directly from support_access_config via the existing, unmodified
// ensureInstallationConfig() (Phase 4a/4b), reused here exactly as-is, per the Phase 5
// investigation report's explicit design rule.
//
// This module never holds, stores, or transmits a licensing PRIVATE key. It only ever
// reads a PUBLIC key (license_config.licensing_public_key) — left NULL by Phase 5a until
// a real keypair exists (Phase 5d, not built yet). A NULL/missing key is treated as
// "not activated" (fail-closed), never as "skip verification."
// ─────────────────────────────────────────────────────────────
import { prisma } from '../prisma.js';
import { ensureInstallationConfig } from './supportAccess.js';
import { PRODUCT_ID, buildActivationRequestCode, verifyLicenseArtifact } from './licenseArtifactFormat.js';

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  err.expose = true;
  return err;
}

// ensureLicenseConfig: يقرأ صفّ license_config الوحيد (id=1)، أو يُنشئه لو غائباً (تثبيت
// جديد طُبِّق عليه studix-schema.sql — الجدول موجود لكن فارغ عمداً، انظر رأس
// backend/migrations/003_licensing.sql: "لا تزريع هنا... Phase 5b's future bootstrap
// function will lazily create it" — هذا بالضبط تنفيذ ذلك). كل الحقول تبقى NULL افتراضياً
// (لا installation_id هنا إطلاقاً — القاعدة الصريحة: لا تكرار له).
export async function ensureLicenseConfig() {
  const existing = await prisma.license_config.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  try {
    return await prisma.license_config.create({ data: { id: 1 } });
  } catch (err) {
    // سباق نادر: عمليتان متزامنتان حاولتا الإنشاء معاً — الثانية تصطدم بـ PK (P2002)،
    // تقرأ الصفّ الذي أنشأته الأولى بدل الفشل.
    if (err.code === 'P2002') return prisma.license_config.findUniqueOrThrow({ where: { id: 1 } });
    throw err;
  }
}

// getLicenseStatus: نقطة الحقيقة الوحيدة لحالة التفعيل — يُعيد تحقّقاً كاملاً من
// license_artifact المخزَّن فعلياً في كل استدعاء (يقرأ الصفّ من القاعدة ثم يُعيد التحقق من
// التوقيع/الارتباط/الانتهاء)، لا يثق أبداً بـ activated_at/expires_at/features المخزَّنة
// وحدها كسلطة. غياب المفتاح العام أو الـ artifact، أو فشل التحقق لأي سبب، كلها تُعامَل
// كـ "غير مُفعَّل" (فشل مغلَق) — لا حالة وسطى، لا "نجاح افتراضي".
export async function getLicenseStatus() {
  const config = await ensureLicenseConfig();

  if (!config.licensing_public_key) {
    return { activated: false, reason: 'not_configured', payload: null };
  }
  if (!config.license_artifact) {
    return { activated: false, reason: 'not_activated', payload: null };
  }

  const installation = await ensureInstallationConfig();
  const check = verifyLicenseArtifact({
    artifact: config.license_artifact,
    installationId: installation.installation_id,
    product: PRODUCT_ID,
    publicKeyPem: config.licensing_public_key,
  });

  if (!check.ok) {
    return { activated: false, reason: check.reason, payload: check.payload };
  }

  return {
    activated: true,
    reason: null,
    payload: check.payload,
    licenseId: check.payload.licenseId,
    product: check.payload.product,
    expiresAt: check.payload.expiresAt,
    features: check.payload.features,
  };
}

// requestActivationCode: يبني رمز طلب التفعيل المرتبط بهذا التثبيت تحديداً (لا يحتاج مفتاحاً
// عاماً مُهيَّأ — هذا الرمز لا يُتحقَّق منه محلياً إطلاقاً، فقط يُرسَل للمالك).
export async function requestActivationCode() {
  const installation = await ensureInstallationConfig();
  const code = buildActivationRequestCode({ installationId: installation.installation_id, product: PRODUCT_ID });
  return { code, installationId: installation.installation_id, product: PRODUCT_ID };
}

// verifyAndActivateLicense: يتحقق من {artifact}، يُعيد {ok:false, reason} دون أي كتابة لأي
// فشل (لا حالة جزئية أبداً — chk_license_activation_consistency يحمي من هذا أيضاً على
// مستوى القاعدة، لكن هذا يمنعه أصلاً قبل أي محاولة كتابة). النجاح يكتب license_artifact +
// الحقول المشتقّة معاً في معاملة واحدة ضمنية (تحديث صفّ واحد) — كل حقل مشتقّ يُقرأ حرفياً
// من check.payload المُتحقَّق منه فعلياً، لا مما أرسله العميل مباشرة.
export async function verifyAndActivateLicense({ artifact }) {
  const config = await ensureLicenseConfig();
  if (!config.licensing_public_key) {
    throw conflict('التفعيل غير مُهيَّأ على هذا التثبيت — لا يوجد مفتاح عام مسجَّل بعد.');
  }

  const installation = await ensureInstallationConfig();
  const check = verifyLicenseArtifact({
    artifact, installationId: installation.installation_id, product: PRODUCT_ID, publicKeyPem: config.licensing_public_key,
  });

  if (!check.ok) {
    return { ok: false, reason: check.reason };
  }

  await prisma.license_config.update({
    where: { id: 1 },
    data: {
      license_artifact: artifact,
      license_id: check.payload.licenseId,
      product: check.payload.product,
      expires_at: check.payload.expiresAt !== null ? new Date(check.payload.expiresAt) : null,
      features: check.payload.features,
      activated_at: new Date(),
    },
  });

  return { ok: true, reason: null, payload: check.payload };
}
