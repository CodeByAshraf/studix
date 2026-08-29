// backend/src/routes/setup.js
// ─────────────────────────────────────────────────────────────
// INSTALL-04 — First-Run Setup HTTP surface.
//
// GET  /api/setup/status — unauthenticated, public. Returns ONLY { open: boolean }. Reveals
//   nothing about any user/admin (no id, no count, no name) — deliberately not the security
//   boundary (see db/firstAdmin.js's isSetupOpen), just a cheap UI hint so the frontend knows
//   whether to render the wizard or redirect to /login before the operator does anything.
//
// POST /api/setup — unauthenticated only while no active admin exists. Independently
//   re-verifies the zero-admin invariant inside db/firstAdmin.js's own advisory-locked
//   transaction — NEVER trusts the GET above. Once an active admin exists, returns 404 (not a
//   soft "closed" response) so the endpoint doesn't advertise its own existence to a caller
//   who shouldn't be probing it anymore.
//
// Never logs/returns the password, the hash, or the session token. Auto-establishes the normal
// session via lib/session.js's existing signSession/cookie mechanism on success — no second
// auth system.
// ─────────────────────────────────────────────────────────────
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { ensureFirstAdmin, isSetupOpen, FirstAdminError } from '../db/firstAdmin.js';
import { signSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS, getSessionCookieOptions } from '../lib/session.js';
import { getAuthState } from '../lib/authCache.js';
import { resolveEffectivePermissions } from '../middleware/permissions.js';

const router = Router();

// setupLimiter: same shape/message as middleware/rateLimit.js's loginIpLimiter — defined here
// rather than added to that shared file, since INSTALL-04's approved scope lists
// middleware/rateLimit.js as NOT one of the files this phase may modify. Reuses the same
// express-rate-limit dependency already installed; no new package.
const GENERIC_RATE_LIMIT_MESSAGE = { ok: false, error: 'محاولات كثيرة جداً. الرجاء المحاولة لاحقاً.' };
const setupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10, // wider than login's account limiter (5) — this is IP-scoped, not account-scoped,
  // and setup is a one-shot operation that should succeed on the first honest attempt.
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json(GENERIC_RATE_LIMIT_MESSAGE),
});

// setupOriginGuard: narrow defense-in-depth for POST /api/setup only (per INSTALL-04 scope —
// "do not redesign global Host-header handling"). The server already binds 127.0.0.1 only
// (server.js, untouched here), which already rules out any LAN attacker entirely; this guards
// against a *local* malicious page attempting a credentialed cross-origin POST, and against
// DNS-rebinding-style Host header tricks. Origin, when a browser sends one, must match one of
// the app's own known origins (same-origin production topology — backend serves the built
// frontend itself — or the dev Vite-on-a-different-port topology via FRONTEND_ORIGIN); Origin
// is not required to be present at all (many legitimate non-browser/same-origin requests omit
// it), matching this codebase's existing CORS posture rather than inventing a stricter one.
function setupOriginGuard(req, res, next) {
  const port = process.env.PORT || 4000;
  const allowedOrigins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  ]);
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    return res.status(403).json({ ok: false, error: 'مصدر الطلب غير مسموح.' });
  }
  const host = (req.headers.host || '').toLowerCase();
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
    return res.status(403).json({ ok: false, error: 'مضيف الطلب غير مسموح.' });
  }
  next();
}

router.get('/status', asyncHandler(async (req, res) => {
  const open = await isSetupOpen(prisma);
  res.json({ ok: true, open });
}));

router.post('/', setupLimiter, setupOriginGuard, asyncHandler(async (req, res) => {
  const { name, id, password, confirmPassword } = req.body || {};
  const trimmedId = typeof id === 'string' ? id.trim() : '';
  const trimmedName = typeof name === 'string' ? name.trim() : '';

  if (!trimmedId || !trimmedName || !password) {
    return res.status(400).json({ ok: false, error: 'الاسم واسم المستخدم وكلمة المرور مطلوبة.' });
  }
  if (typeof confirmPassword === 'string' && password !== confirmPassword) {
    return res.status(400).json({ ok: false, error: 'كلمتا المرور غير متطابقتين.' });
  }

  let created;
  try {
    created = await ensureFirstAdmin({ id: trimmedId, name: trimmedName, password, prisma });
  } catch (err) {
    if (err instanceof FirstAdminError) {
      if (err.reason === 'already_initialized') {
        return res.status(404).json({ ok: false, error: 'الإعداد الأولي غير متاح.' });
      }
      if (err.reason === 'id_taken') {
        return res.status(409).json({ ok: false, error: err.message });
      }
      if (err.reason === 'setup_in_progress') {
        return res.status(409).json({ ok: false, error: err.message });
      }
      // missing_fields / weak_password / lock_failed
      return res.status(400).json({ ok: false, error: err.message });
    }
    throw err;
  }

  // Auto-login — same signSession/cookie mechanism POST /api/session already uses, not a new
  // mechanism. getAuthState warms the cache with this brand-new user's real row (permissions
  // array just written, role_id null) so the token/response reflect actual, live authority.
  const authState = await getAuthState(created.id);
  const token = signSession({
    id: created.id,
    role: 'admin',
    userAuthVersion: authState?.userAuthVersion ?? created.auth_version,
    roleAuthVersion: authState?.roleAuthVersion ?? null,
  });
  res.cookie(SESSION_COOKIE_NAME, token, { ...getSessionCookieOptions(), maxAge: SESSION_MAX_AGE_MS });

  const effectivePermissions = resolveEffectivePermissions(authState);
  res.status(201).json({
    ok: true,
    user: { id: created.id, name: created.name, role: 'admin', active: created.active, permissions: effectivePermissions },
  });
}));

export default router;
