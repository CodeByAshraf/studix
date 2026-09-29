// backend/src/middleware/permissions.js
// ─────────────────────────────────────────────────────────────
// requirePermission(pageId) — fail-closed server-side authorization.
//
// Resolution order (mirrors the frontend's canAccess(), but never falls back
// to "full access" on NULL — that fallback is explicitly rejected):
//   1. user.permissions is a non-null, non-empty array -> use it (per-user
//      override wins outright, even for admin).
//   2. else, if the role could not be resolved at all -> 403 (fail closed).
//   3. else, if role.permissions is a non-null, non-empty array -> use it.
//   4. else (role.permissions NULL or empty) -> effective permissions = []
//      -> every requirePermission(...) check fails with 403. NULL never means
//      "everyone/admin gets access" anywhere in this function.
//
// Session/version check: req.user carries {id, role, userAuthVersion,
// roleAuthVersion} from the signed session token (set at login). This
// middleware compares those embedded values against the CURRENT values held
// in the in-memory authCache (which mirrors Postgres). Any mismatch means the
// user's role/permissions/active state changed after this token was issued —
// fail closed, 401, force re-login. Postgres is consulted (via the cache,
// lazily) — never the token's own claims — for the actual permission values.
// ─────────────────────────────────────────────────────────────
import { getAuthState } from '../lib/authCache.js';
import { asyncHandler } from './errorHandler.js';

function resolveEffectivePermissions(state) {
  if (Array.isArray(state.userPermissions) && state.userPermissions.length > 0) {
    return state.userPermissions;
  }
  if (!state.roleFound) return null; // role unresolved -> caller must 403
  if (Array.isArray(state.rolePermissions) && state.rolePermissions.length > 0) {
    return state.rolePermissions;
  }
  return []; // NULL/empty role permissions -> fail closed, never "full access"
}

export function requirePermission(pageId) {
  // asyncHandler (نفس الغلاف المستخدَم بالفعل في كل route handler في هذا المشروع): خطأ
  // غير متوقَّع من getAuthState (مثلاً عطل عابر في Postgres أثناء قراءة authCache) يصل
  // هنا كاستثناء غير مُلتقَط — بلا هذا الغلاف كان سيتحوّل إلى unhandled promise rejection
  // (Express 4 لا يُمرِّر رفض async middleware للـ error handler تلقائياً)، فيُفعِّل
  // registerFatalErrorHandlers في server.js ويُوقِف الخادم بأكمله لخطأ عابر قابل للتعافي.
  // asyncHandler يُحوِّله بدلاً من ذلك إلى next(err) العادي → errorHandler.js المركزي (500
  // عام، بلا تسريب تفاصيل Prisma، مع نفس تسجيل logger.error الحالي) — لا يغيّر أي استجابة
  // 401/403 حالية (تلك عبارة عن return عادي هنا، لا استثناء، فلا تمرّ عبر catch أصلاً).
  return asyncHandler(async function permissionGuard(req, res, next) {
    const effective = await resolveSessionPermissions(req, res);
    if (!effective) return;
    if (!effective.includes(pageId)) {
      return res.status(403).json({ ok: false, error: 'لا تملك صلاحية الوصول لهذا الإجراء.' });
    }

    next();
  });
}

// requireActiveSession — every check requirePermission makes (logged in, still active,
// auth versions unchanged since login, role resolvable), minus the page check. For actions
// any logged-in user may take for themselves, e.g. writing their own audit entry (M2/F2).
export const requireActiveSession = asyncHandler(async function activeSessionGuard(req, res, next) {
  const effective = await resolveSessionPermissions(req, res);
  if (!effective) return;
  next();
});

// Shared by both guards above: returns the effective permission array, or sends the
// 401/403 response itself and returns null.
async function resolveSessionPermissions(req, res) {
  if (!req.user) {
    res.status(401).json({ ok: false, error: 'يجب تسجيل الدخول للوصول لهذا المسار.' });
    return null;
  }

  const state = await getAuthState(req.user.id);
  if (!state || !state.active) {
    res.status(401).json({ ok: false, error: 'الجلسة لم تعد صالحة. الرجاء تسجيل الدخول مجدداً.' });
    return null;
  }

  // مقارنة الإصدار: أي تغيير على الدور/الصلاحيات/الحالة منذ تسجيل الدخول يُبطل هذه الجلسة فوراً.
  if (
    state.userAuthVersion !== req.user.userAuthVersion ||
    state.roleAuthVersion !== req.user.roleAuthVersion
  ) {
    res.status(401).json({ ok: false, error: 'صلاحياتك تغيّرت. الرجاء تسجيل الدخول مجدداً.' });
    return null;
  }

  const effective = resolveEffectivePermissions(state);
  if (effective === null) {
    res.status(403).json({ ok: false, error: 'لا تملك صلاحية الوصول لهذا الإجراء.' });
    return null;
  }
  return effective;
}

// مُصدَّرة للاختبار المباشر بلا HTTP كامل.
export { resolveEffectivePermissions };
