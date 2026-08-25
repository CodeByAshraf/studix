// backend/src/routes/license.js
// ─────────────────────────────────────────────────────────────
// Phase 5b — Licensing backend core. مسار إداري بحت (مثل users.js/roles.js/
// supportAccess.js) — يُركَّب في server.js خلف requireAuth + requireRole('admin') حصراً
// (نفس حارس Support Access بالضبط، أعمق من requirePermission العام — قدرة حسّاسة، غير
// قابلة للتفويض عبر شاشة الأدوار). لا فحص تفويض إضافي هنا داخل الدوال المُصدَّرة نفسها —
// نفس نمط activateAdmission/requestSupportChallenge بالضبط: الحارس الوحيد هو الـ
// middleware المُركَّب في server.js، والدوال الجوهرية تثق بـ userId المُمرَّر لها من الـ
// route handler (المُشتقّ حصراً من req.user.id الموقّع).
//
// كل دالة جوهرية هنا مُصدَّرة منفصلة عن الـ router لتكون قابلة للاختبار مباشرة بلا HTTP
// كامل — نفس مبدأ activateAdmission/requestSupportChallenge تماماً.
// ─────────────────────────────────────────────────────────────
import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { resolveActivityLogActor } from './activityLogs.js';
import { getLicenseStatus, requestActivationCode, verifyAndActivateLicense } from '../lib/license.js';

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

function unauthorized(message) {
  const err = new Error(message);
  err.status = 401;
  err.expose = true;
  return err;
}

// كل حدث دورة حياة ترخيص يُسجَّل في activity_logs الموجود فعلياً (append-only، trigger
// trg_no_delete_activity بلا استثناء) — module='license' يُميّزه عن كل الوحدات الأخرى
// (بما فيها module='support'). user_id/user_name يُشتقّان حصراً هنا عبر
// resolveActivityLogActor(userId) — نفس آلية supportAccess.js/activityLogs.js تماماً.
async function logLicenseEvent({ userId, action, entityId = null, details = null }) {
  const actor = await resolveActivityLogActor(userId);
  await prisma.activity_logs.create({
    data: {
      id: crypto.randomUUID(),
      action,
      module: 'license',
      user_id: actor.userId,
      user_name: actor.userName,
      entity_type: 'license',
      entity_id: entityId,
      details,
    },
  });
}

// getLicenseStatusForActor: يُغلِّف getLicenseStatus (نقية، بلا تسجيل) بتسجيل
// license_expiration_detected — مرّة واحدة فقط عند فحص صريح لحالة الترخيص (هذا المسار)،
// عمداً وليس من requireActivation (middleware/activation.js) التي قد تُستدعى مرّات
// كثيرة جداً لكل طلب محجوب؛ تسجيل هناك كان سيُغرق activity_logs بلا فائدة إضافية حقيقية.
export async function getLicenseStatusForActor({ userId = null } = {}) {
  const status = await getLicenseStatus();
  if (!status.activated && status.reason === 'expired') {
    await logLicenseEvent({ userId, action: 'license_expiration_detected', entityId: status.payload?.licenseId ?? null });
  }
  return status;
}

export async function requestLicenseActivationCode({ userId = null } = {}) {
  const result = await requestActivationCode();
  await logLicenseEvent({ userId, action: 'license_activation_requested', entityId: result.installationId });
  return result;
}

// activateLicense: يرفض (401) أي فشل تحقّق (شكل/تثبيت/منتج/توقيع/انتهاء) — كلها تُسجَّل
// كـ license_verification_failed بلا كشف السبب الدقيق في رسالة HTTP نفسها، فقط في تفاصيل
// سجل النشاط (نفس اتفاقية supportAccess.js's redeemSupportChallenge بالضبط). النجاح
// يستبدل أي شهادة سابقة بالكامل (إعادة تفعيل/تجديد طبيعيان — لا حالة خاصة).
export async function activateLicense({ artifact }, { userId = null } = {}) {
  if (!artifact) throw badRequest('شهادة الترخيص مطلوبة.');

  const result = await verifyAndActivateLicense({ artifact });
  if (!result.ok) {
    await logLicenseEvent({ userId, action: 'license_verification_failed', details: result.reason });
    throw unauthorized('فشل التحقق من الترخيص.');
  }

  await logLicenseEvent({ userId, action: 'license_activated', entityId: result.payload.licenseId });
  return result;
}

const router = Router();

router.get('/status', asyncHandler(async (req, res) => {
  const status = await getLicenseStatusForActor({ userId: req.user?.id ?? null });
  res.json({ ok: true, ...status });
}));

router.post('/request-code', asyncHandler(async (req, res) => {
  const result = await requestLicenseActivationCode({ userId: req.user?.id ?? null });
  res.status(201).json({ ok: true, ...result });
}));

router.post('/activate', asyncHandler(async (req, res) => {
  const { artifact } = req.body || {};
  const result = await activateLicense({ artifact }, { userId: req.user?.id ?? null });
  res.json({
    ok: true,
    licenseId: result.payload.licenseId,
    product: result.payload.product,
    expiresAt: result.payload.expiresAt,
    features: result.payload.features,
  });
}));

export default router;
