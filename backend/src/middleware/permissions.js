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
  return async function permissionGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: 'يجب تسجيل الدخول للوصول لهذا المسار.' });
    }

    const state = await getAuthState(req.user.id);
    if (!state || !state.active) {
      return res.status(401).json({ ok: false, error: 'الجلسة لم تعد صالحة. الرجاء تسجيل الدخول مجدداً.' });
    }

    // مقارنة الإصدار: أي تغيير على الدور/الصلاحيات/الحالة منذ تسجيل الدخول يُبطل هذه الجلسة فوراً.
    if (
      state.userAuthVersion !== req.user.userAuthVersion ||
      state.roleAuthVersion !== req.user.roleAuthVersion
    ) {
      return res.status(401).json({ ok: false, error: 'صلاحياتك تغيّرت. الرجاء تسجيل الدخول مجدداً.' });
    }

    const effective = resolveEffectivePermissions(state);
    if (effective === null) {
      return res.status(403).json({ ok: false, error: 'لا تملك صلاحية الوصول لهذا الإجراء.' });
    }
    if (!effective.includes(pageId)) {
      return res.status(403).json({ ok: false, error: 'لا تملك صلاحية الوصول لهذا الإجراء.' });
    }

    next();
  };
}

// مُصدَّرة للاختبار المباشر بلا HTTP كامل.
export { resolveEffectivePermissions };
