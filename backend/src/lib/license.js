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
// a real keypair exists (Phase 5d). A NULL/missing key is treated as "not activated"
// (fail-closed), never as "skip verification."
//
// Phase 5e — clock-rollback mitigation (checkClockAndUpdateHighWaterMark). This is a
// DETERRENT, not a cryptographic guarantee: a fully offline desktop app has no trusted
// external time source, so a sufficiently determined local attacker with full control of
// the machine can still defeat any purely local clock check. What this DOES catch: rolling
// the system clock backward to make an already-expired TERM license appear valid again on
// a SUBSEQUENT status check, without obtaining a genuine new artifact from the owner. It
// deliberately does NOT gate perpetual (expiresAt: null) licenses or the activation
// endpoint itself — see the function's own comment for the full reasoning on both points.
// ─────────────────────────────────────────────────────────────
import { prisma } from '../prisma.js';
import { ensureInstallationConfig } from './supportAccess.js';
import {
  PRODUCT_ID, buildActivationRequestCode, verifyLicenseArtifact, parseLicenseArtifact,
} from './licenseArtifactFormat.js';

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  err.expose = true;
  return err;
}

// CLOCK_ROLLBACK_TOLERANCE_MS: كم يُسمَح للساعة بالتراجع قبل اعتباره "تراجعاً" لا مجرّد
// تعديل شرعي — 6 ساعات تغطّي بسخاء أي انتقال DST حقيقي (ساعة واحدة كحدّ أقصى في كل
// المناطق الزمنية المعروفة)، وأي تصحيح NTP/يدوي بسيط، بينما تبقى صغيرة بما يكفي لرصد أي
// تراجع مقصود ذي معنى فعلي (تفعيل ترخيص منتهي عادة يحتاج تراجعاً بالأيام/الأسابيع/الأشهر،
// لا الساعات، ليكون مفيداً للمهاجم أصلاً).
export const CLOCK_ROLLBACK_TOLERANCE_MS = 6 * 60 * 60 * 1000;

// لا تكتب علامة الحدّ الأعلى لكل فحص (يُستدعى مع كل طلب محجوب عبر requireActivation) —
// فقط لو تقدَّم الوقت الحقيقي بما لا يقلّ عن دقيقة منذ آخر كتابة. لا يُضعِف الكشف عن
// التراجع إطلاقاً (يبقى فحصاً قراءةً فقط في كل مرّة) — فقط يقلّل الكتابة غير الضرورية.
const HIGH_WATER_MARK_WRITE_THROTTLE_MS = 60 * 1000;

// checkClockAndUpdateHighWaterMark: يقرأ/يُنشئ الحدّ الأعلى المخزَّن، يقارنه بالوقت
// الحالي. غياب حدّ سابق (NULL — تثبيت جديد، أو تثبيت قديم قبل هذا العمود) يُنشئ خط أساس
// فقط، لا يُعامَل كتراجع أبداً. لا يُخفَّض الحدّ الأعلى أبداً حتى لو اكتُشف تراجع (لا
// "مكافأة" لمحاولة التراجع بخفض خط الأساس المرجعي).
export async function checkClockAndUpdateHighWaterMark() {
  const config = await ensureLicenseConfig();
  const now = Date.now();
  const stored = config.clock_high_water_mark_at ? config.clock_high_water_mark_at.getTime() : null;

  if (stored === null) {
    await prisma.license_config.update({ where: { id: 1 }, data: { clock_high_water_mark_at: new Date(now) } });
    return { rollbackDetected: false, now };
  }

  if (now < stored - CLOCK_ROLLBACK_TOLERANCE_MS) {
    return { rollbackDetected: true, now };
  }

  if (now > stored + HIGH_WATER_MARK_WRITE_THROTTLE_MS) {
    await prisma.license_config.update({ where: { id: 1 }, data: { clock_high_water_mark_at: new Date(now) } });
  }

  return { rollbackDetected: false, now };
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

  // فحص التراجع يحدث قبل التحقّق الكامل من التوقيع عمداً — لكن قرار الحجب يُطبَّق فقط لو
  // كانت الشهادة المخزَّنة (لو أمكن تحليلها) ترخيصاً محدود المدّة فعلاً (expiresAt ليست
  // null). ترخيص دائم لا يوجد فيه شيء يُلتَف عليه بتراجع الساعة أصلاً، فلا داعي لحجبه.
  const parsedForClockCheck = parseLicenseArtifact(config.license_artifact);
  const clockCheck = await checkClockAndUpdateHighWaterMark();

  if (clockCheck.rollbackDetected && parsedForClockCheck && parsedForClockCheck.payload.expiresAt !== null) {
    return { activated: false, reason: 'clock_rollback_detected', payload: parsedForClockCheck.payload };
  }

  const check = verifyLicenseArtifact({
    artifact: config.license_artifact,
    installationId: installation.installation_id,
    product: PRODUCT_ID,
    publicKeyPem: config.licensing_public_key,
    now: clockCheck.now,
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
