// backend/src/db/firstAdmin.js
// ─────────────────────────────────────────────────────────────
// INSTALL-04 — First-Run Setup: atomic, race-safe first-admin creation.
//
// Replaces scripts/adminCreate.js's terminal-only flow with a mechanism a packaged desktop
// app's web UI can call. Setup "openness" is derived live from the same invariant already
// enforced elsewhere in this codebase (routes/users.js's PUT/DELETE guards: "never leave the
// system with zero active admins") — its mirror image here is "never let a SECOND caller
// create the first one." No new table, column, migration, or config flag: `users` itself is
// the sole source of truth (audit §5, Option A) — SELECT COUNT(*) WHERE is_admin AND active.
//
// Permissions (audit §1 finding, approved decision): the first admin gets an explicit,
// non-null `permissions` array (every page in ALL_PERMISSION_PAGES below) instead of
// `role_id: 'admin'`. On a genuinely fresh database (INSTALL-03-provisioned, zero seed rows
// anywhere — verified: `roles` has no seed data, no migration inserts one), `role_id: 'admin'`
// with no matching `roles` row leaves middleware/permissions.js's resolveEffectivePermissions
// unable to resolve the role (`roleFound: false`) — every requirePermission(pageId) check then
// 403s, even though login itself succeeds. An explicit `permissions` array is
// resolveEffectivePermissions' FIRST rule (wins outright, before any role lookup happens at
// all), so `role_id` stays null here and the role-table dependency never exists in the first
// place. requireRole('admin') (license/support-access) is unaffected either way — it already
// reads the live `is_admin` boolean directly, never role_id.
//
// Race safety: a dedicated PostgreSQL advisory lock (own key, distinct from
// migrationRunner.js's 7727727 and bootstrapDatabase.js's 7727728), acquired on a
// connection_limit=1 client for the exact same connection-affinity reason both of those
// modules already document (pg_advisory_lock/unlock are session-scoped, not client-pool-scoped
// — reusing their proven pattern verbatim, not reinventing it). The lock is what actually
// prevents the check-then-insert race (two concurrent transactions can both legitimately see
// "zero admins" under READ COMMITTED without it); the transaction wrapping the recheck+insert
// is defense-in-depth ensuring nothing partial ever commits, not the primary guarantee.
// ─────────────────────────────────────────────────────────────
import { PrismaClient } from '@prisma/client';
import { hashPbkdf2 } from '../lib/passwordVerify.js';

export class FirstAdminError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

// Distinct from migrationRunner.js's ADVISORY_LOCK_KEY (7727727) and bootstrapDatabase.js's
// BOOTSTRAP_ADVISORY_LOCK_KEY (7727728) — a concurrent migration/bootstrap run and a concurrent
// first-admin-setup attempt are unrelated operations with unrelated lifecycles; sharing a key
// would make them block each other for no reason.
const FIRST_ADMIN_ADVISORY_LOCK_KEY = 7727729;

const MIN_PASSWORD_LENGTH = 8; // matches scripts/adminCreate.js's own minimum, the tool this replaces

// Canonical permission page IDs — mirrors src/services/usersService.js's SYSTEM_PAGES `id`
// values exactly (the frontend's own source of truth for the permission matrix, used to build
// the Roles editor's checkbox list). Duplicated here deliberately: backend and frontend are
// separate packages with no shared module anywhere else in this codebase either (see
// db/backup.js's own pg_dump-path duplication comment for the same reasoning). Keep in sync
// with SYSTEM_PAGES if a page is ever added/removed there.
export const ALL_PERMISSION_PAGES = [
  'dashboard', 'admissions', 'students', 'groups', 'attendance', 'payments', 'treasury',
  'exams', 'homework', 'materials', 'notifications', 'reports', 'id-cards', 'activity-log',
  'settings', 'users',
];

function withConnectionLimit(databaseUrl, limit) {
  const u = new URL(databaseUrl);
  u.searchParams.set('connection_limit', String(limit));
  return u.toString();
}

// isSetupOpen: the single source of truth for whether first-run setup is still available.
// Deliberately the exact same query the protected creation flow re-checks inside its own
// transaction below — callers needing a cheap, non-authoritative status check (GET
// /api/setup/status) may call this directly; POST /api/setup must NEVER trust it and always
// re-verifies independently under the lock (see ensureFirstAdmin).
export async function isSetupOpen(prisma) {
  const count = await prisma.users.count({ where: { is_admin: true, active: true } });
  return count === 0;
}

async function createFirstAdminLocked(prisma, { id, name, password }) {
  return prisma.$transaction(async (tx) => {
    const existingActiveAdmins = await tx.users.count({ where: { is_admin: true, active: true } });
    if (existingActiveAdmins > 0) {
      throw new FirstAdminError('already_initialized', 'يوجد مدير نشط بالفعل — الإعداد الأولي مغلق.');
    }

    const existingWithId = await tx.users.findUnique({ where: { id } });
    if (existingWithId) {
      throw new FirstAdminError('id_taken', 'اسم المستخدم مستخدَم بالفعل.');
    }

    return tx.users.create({
      data: {
        id,
        name,
        role_id: null, // deliberately null — see file header. is_admin + permissions carry authority.
        is_admin: true,
        active: true,
        password_hash: hashPbkdf2(password),
        permissions: ALL_PERMISSION_PAGES,
      },
      select: { id: true, name: true, is_admin: true, active: true, auth_version: true },
    });
  });
}

// ensureFirstAdmin: the single entry point. See file header for the full safety contract.
// `prisma` is the caller's normal pooled client (used for the actual recheck+insert
// transaction); a separate connection_limit=1 client is constructed internally here purely to
// hold the advisory lock for the duration of the call, exactly mirroring
// migrationRunner.js/bootstrapDatabase.js's own lock-client pattern.
export async function ensureFirstAdmin({
  id,
  name,
  password,
  prisma,
  databaseUrl = process.env.DATABASE_URL,
} = {}) {
  if (!id || !name) {
    throw new FirstAdminError('missing_fields', 'الاسم واسم المستخدم مطلوبان.');
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new FirstAdminError('weak_password', `كلمة المرور ${MIN_PASSWORD_LENGTH} أحرف على الأقل.`);
  }

  const lockClient = new PrismaClient({ datasources: { db: { url: withConnectionLimit(databaseUrl, 1) } } });
  try {
    let locked;
    try {
      const rows = await lockClient.$queryRaw`SELECT pg_try_advisory_lock(${FIRST_ADMIN_ADVISORY_LOCK_KEY}) AS locked`;
      locked = rows[0].locked === true;
    } catch (err) {
      throw new FirstAdminError('lock_failed', `تعذّر الحصول على قفل الإعداد: ${err.message}`);
    }
    if (!locked) {
      throw new FirstAdminError(
        'setup_in_progress',
        'عملية إعداد أخرى تعمل بالفعل على نفس القاعدة. تم الإيقاف بدل انتظار أبدي أو تنفيذ متزامن غير آمن.'
      );
    }

    try {
      return await createFirstAdminLocked(prisma, { id, name, password });
    } finally {
      try {
        await lockClient.$queryRaw`SELECT pg_advisory_unlock(${FIRST_ADMIN_ADVISORY_LOCK_KEY})`;
      } catch {
        // best-effort — the real work already succeeded/failed before this point; the lock is
        // released automatically when lockClient disconnects below regardless.
      }
    }
  } finally {
    await lockClient.$disconnect().catch(() => {});
  }
}
