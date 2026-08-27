// backend/src/lib/authCache.js
// ─────────────────────────────────────────────────────────────
// Stabilization phase — server-side authorization cache.
// PERFORMANCE LAYER ONLY. PostgreSQL (users/roles) remains the sole source of
// truth. This module never invents data: on a cache miss it always re-reads
// users+roles from Postgres; it is only ever a short-lived mirror of rows that
// were just read, keyed by user id, so a per-request permission check does not
// need its own database round trip.
//
// Invalidation contract (see IMPLEMENTATION_SEQUENCE / auth contract):
//   - invalidateUser(id)      — call after any write to that user's role_id,
//                                permissions, or active flag, in the same
//                                request that performed the write, after the
//                                database transaction committed successfully.
//   - invalidateRole(roleId)  — call after any write to a role's permissions
//                                (or label), evicting every currently-cached
//                                user with that role_id so they re-resolve
//                                fresh on next request.
//   - A direct SQL change made outside these application mutation paths is
//     explicitly outside this cache's invalidation guarantee (documented
//     limitation, not a bug) — see the accepted contract for this phase.
//
// Single-process only, by design (Decision 7/contract: no distributed cache
// infrastructure). The cache is a plain in-memory Map; a server restart empties
// it safely — the next request per user costs one Postgres read to repopulate.
// ─────────────────────────────────────────────────────────────
import { prisma } from '../prisma.js';

// userId -> { roleId, roleFound, userPermissions, rolePermissions, userAuthVersion, roleAuthVersion, active, isAdmin }
const cache = new Map();

async function loadFromDb(userId) {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: { id: true, role_id: true, permissions: true, auth_version: true, active: true, is_admin: true },
  });
  if (!user) return null;

  const role = user.role_id
    ? await prisma.roles.findUnique({
        where: { id: user.role_id },
        select: { id: true, permissions: true, auth_version: true },
      })
    : null;

  const entry = {
    roleId: user.role_id,
    roleFound: !!role,
    userPermissions: Array.isArray(user.permissions) ? user.permissions : null,
    rolePermissions: role && Array.isArray(role.permissions) ? role.permissions : null,
    userAuthVersion: user.auth_version,
    roleAuthVersion: role ? role.auth_version : null,
    active: user.active,
    // BUG-03 fix: requireRole (middleware/auth.js) needs the LIVE is_admin flag to
    // re-derive the current role string exactly as session.js's signSession does at login
    // (role = is_admin ? 'admin' : (role_id || 'user')) — without this, requireRole had no
    // way to detect a deactivated/demoted admin independent of requirePermission's own path.
    isAdmin: user.is_admin,
  };
  cache.set(userId, entry);
  return entry;
}

// getAuthState: يُعيد الحالة من الكاش (سريع) أو يُحمِّلها من Postgres عند miss.
// لا يُعيد أبداً بيانات مخترَعة — null صريح لو المستخدم غير موجود في Postgres.
export async function getAuthState(userId) {
  if (cache.has(userId)) return cache.get(userId);
  return loadFromDb(userId);
}

// invalidateUser: يُستدعى فور نجاح أي تعديل على role_id/permissions/active لمستخدم.
export function invalidateUser(userId) {
  cache.delete(userId);
}

// invalidateRole: يُستدعى فور نجاح أي تعديل على صلاحيات دور — يمسح فقط المستخدمين
// المخزَّنين حالياً في الكاش والمرتبطين بهذا الدور (لا حاجة لمسح الكاش كله).
export function invalidateRole(roleId) {
  for (const [userId, entry] of cache.entries()) {
    if (entry.roleId === roleId) cache.delete(userId);
  }
}

// clearAll: للاختبارات فقط — محاكاة إعادة تشغيل الخادم (كاش فارغ).
export function clearAll() {
  cache.clear();
}
