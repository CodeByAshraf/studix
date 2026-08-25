// backend/src/routes/supportAccess.js
// ─────────────────────────────────────────────────────────────
// Phase 4b — Support Access backend core. مسار إداري بحت (مثل users.js/roles.js) — يُركَّب
// في server.js خلف requireAuth + requireRole('admin') حصراً (انظر server.js). لا فحص
// تفويض إضافي هنا داخل الدوال المُصدَّرة نفسها — نفس نمط activateAdmission في
// admissionActivation.js بالضبط: الحارس الوحيد هو الـ middleware المُركَّب في server.js،
// والدوال الجوهرية تثق بـ userId المُمرَّر لها من الـ route handler (المُشتقّ حصراً من
// req.user.id الموقّع، لا أي شيء آخر يُرسله العميل).
//
// كل دالة جوهرية هنا مُصدَّرة منفصلة عن الـ router لتكون قابلة للاختبار مباشرة بلا HTTP
// كامل — نفس مبدأ activateAdmission/resolveActivityLogActor تماماً.
// ─────────────────────────────────────────────────────────────
import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { resolveActivityLogActor } from './activityLogs.js';
import { CHALLENGE_TTL_MS, generateChallenge, verifySupportChallenge } from '../lib/supportAccess.js';
import {
  SUPPORT_SESSION_COOKIE_NAME, SUPPORT_SESSION_MAX_AGE_MS,
  getSupportSessionCookieOptions, signSupportSession,
} from '../lib/supportSession.js';
import {
  isNonceConsumed, markNonceConsumed, isNonceRevoked, revokeNonce,
  registerSupportSession, getActiveSupportSession, revokeActiveSupportSession,
} from '../lib/supportAccessCache.js';

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

// كل حدث دورة حياة دعم يُسجَّل في activity_logs الموجود فعلياً (append-only، trigger
// trg_no_delete_activity بلا استثناء) — module='support' يُميّزه عن كل الوحدات الأخرى.
// user_id/user_name يُشتقّان حصراً هنا عبر resolveActivityLogActor(userId) — نفس آلية
// activityLogs.js تماماً — لا اسم/معرّف يصل من أي مصدر آخر أبداً.
async function logSupportEvent({ userId, action, entityId = null, details = null }) {
  const actor = await resolveActivityLogActor(userId);
  await prisma.activity_logs.create({
    data: {
      id: crypto.randomUUID(),
      action,
      module: 'support',
      user_id: actor.userId,
      user_name: actor.userName,
      entity_type: 'support_session',
      entity_id: entityId,
      details,
    },
  });
}

// requestSupportChallenge: يُولّد شفرة تحدٍّ جديدة مرتبطة بهذا التثبيت + يُسجّل الحدث.
export async function requestSupportChallenge({ userId = null } = {}) {
  const result = await generateChallenge();
  await logSupportEvent({ userId, action: 'support_challenge_generated', entityId: result.nonce });
  return result;
}

// redeemSupportChallenge: يتحقق من {challenge, response}، يرفض (401) أي فشل (شكل/تثبيت/
// انتهاء/توقيع/استخدام سابق/إلغاء سابق — كلها تُسجَّل كـ support_verification_failed بلا
// كشف السبب الدقيق في رسالة HTTP نفسها، فقط في تفاصيل سجل النشاط). النجاح يُصدر جلسة دعم
// جديدة (سجل في الذاكرة + توكن موقّع)، ويستهلك الـ nonce فوراً بشكل متزامن (لا await بين
// فحص isNonceConsumed/isNonceRevoked وmarkNonceConsumed) — يمنع بنيوياً استخدام نفس الشفرة
// مرّتين ولو تزامن طلبا verify فعلياً (انظر اختبار السباق في supportAccess.integration.test.js).
export async function redeemSupportChallenge({ challenge, response }, { userId = null } = {}) {
  if (!challenge || !response) throw badRequest('الشفرة والرد مطلوبان.');

  const check = await verifySupportChallenge({ challenge, response });
  const alreadyUsed = check.ok && (isNonceConsumed(check.nonce) || isNonceRevoked(check.nonce));

  if (!check.ok || alreadyUsed) {
    const reason = alreadyUsed ? 'already_used' : check.reason;
    await logSupportEvent({
      userId, action: 'support_verification_failed', entityId: check.nonce ?? null, details: reason,
    });
    throw unauthorized('فشل التحقق من رمز الدعم.');
  }

  // متزامن بالكامل بلا أي await من هنا حتى نهاية استهلاك الـ nonce — انظر التعليق أعلاه.
  markNonceConsumed(check.nonce);
  const sessionId = crypto.randomUUID();
  const issuedAt = Date.now();
  const expiresAt = issuedAt + SUPPORT_SESSION_MAX_AGE_MS;
  registerSupportSession(sessionId, { installationId: check.installationId, issuedAt, expiresAt });
  const token = signSupportSession({ sessionId, installationId: check.installationId });

  await logSupportEvent({ userId, action: 'support_access_granted', entityId: sessionId });

  return { sessionId, issuedAt, expiresAt, token };
}

export function getSupportAccessStatus() {
  const active = getActiveSupportSession();
  return { active: !!active, session: active };
}

// revokeSupportAccess: بمعامل nonce → يُلغي شفرة معلَّقة لم تُستهلَك بعد (الإدارة تراجعت
// قبل أن يردّ المالك). بلا nonce → يُلغي الجلسة الفعّالة الحالية (لو وُجدت). كلا المسارين
// يُسجَّلان في activity_logs.
export async function revokeSupportAccess({ nonce } = {}, { userId = null } = {}) {
  if (nonce) {
    revokeNonce(nonce);
    await logSupportEvent({ userId, action: 'support_challenge_revoked', entityId: nonce });
    return { revokedChallenge: nonce, revokedSession: false };
  }
  const active = getActiveSupportSession();
  const revoked = revokeActiveSupportSession();
  if (revoked) {
    await logSupportEvent({ userId, action: 'support_access_revoked', entityId: active?.id ?? null });
  }
  return { revokedChallenge: null, revokedSession: revoked };
}

const router = Router();

router.post('/challenge', asyncHandler(async (req, res) => {
  const result = await requestSupportChallenge({ userId: req.user?.id ?? null });
  res.status(201).json({
    ok: true, challenge: result.challenge, installationId: result.installationId,
    expiresAt: result.exp, ttlMs: CHALLENGE_TTL_MS,
  });
}));

router.post('/verify', asyncHandler(async (req, res) => {
  const { challenge, response } = req.body || {};
  const result = await redeemSupportChallenge({ challenge, response }, { userId: req.user?.id ?? null });
  res.cookie(SUPPORT_SESSION_COOKIE_NAME, result.token, {
    ...getSupportSessionCookieOptions(),
    maxAge: SUPPORT_SESSION_MAX_AGE_MS,
  });
  res.json({ ok: true, sessionId: result.sessionId, issuedAt: result.issuedAt, expiresAt: result.expiresAt });
}));

router.get('/status', (req, res) => {
  res.json({ ok: true, ...getSupportAccessStatus() });
});

router.post('/revoke', asyncHandler(async (req, res) => {
  const { nonce } = req.body || {};
  const result = await revokeSupportAccess({ nonce }, { userId: req.user?.id ?? null });
  res.clearCookie(SUPPORT_SESSION_COOKIE_NAME, getSupportSessionCookieOptions());
  res.json({ ok: true, ...result });
}));

export default router;
