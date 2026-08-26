// backend/src/db/bootstrapDatabase.js
// ─────────────────────────────────────────────────────────────
// Phase 6c — Database Bootstrap Automation. Turns the current manual first-install sequence
// (create the `studix` database, apply backend/prisma/studix-schema.sql by hand, then start
// the app) into a safe, reusable, idempotent capability a future installer can call.
//
// Scope is deliberately narrow: this module ONLY gets a database to the point where its base
// schema exists (fresh-install artifact applied, or already present). It never touches
// incremental migrations — that remains entirely migrationRunner.js's job, unmodified, called
// separately after this succeeds (see backend/scripts/bootstrapDatabase.js for the
// orchestration order). Nothing here duplicates migrationRunner.js's advisory-locking,
// checksum-tracking, or destructive-statement-protection logic — the one piece of parsing
// logic genuinely worth sharing (splitSqlStatements, for applying studix-schema.sql
// statement-by-statement) is imported from it directly rather than reimplemented.
//
// backend/prisma/studix-schema.sql is a real `pg_dump --schema-only --no-owner --no-privileges`
// output (see backend/scripts/generateSchemaArtifact.js) — plain `CREATE TABLE` with no
// `IF NOT EXISTS` anywhere, so it can only ever be safely applied to a genuinely EMPTY
// database. It is also wrapped in `\restrict`/`\unrestrict` lines — psql-only meta-commands
// (a newer pg_dump safety feature), not valid raw SQL for a driver — stripped here before
// execution, never edited on disk.
//
// State classification (independent of, but consistent with, migrationRunner.js's own model):
//   - zero tables in the public schema           -> "uninitialized"   -> safe to apply the schema artifact
//   - a `students` table exists                   -> "has_base_schema" -> hand off entirely to runMigrations()
//   - some tables exist, but no `students` table  -> "partial_schema"  -> FAIL CLOSED, never touched
// This mirrors migrationRunner.js's own `coreExists = tableExists('students')` check, computed
// independently here (not exported/imported) specifically so migrationRunner.js stays at zero
// diff for this phase.
//
// Administrative connection: derived from the configured DATABASE_URL by substituting its
// database name for `postgres` (PostgreSQL's always-present maintenance database) — the same
// technique already proven in test-helpers/scratchDb.js — so the SAME host/credentials are
// reused, never a different (and never a remote) server. STUDIX_DB_ADMIN_URL is an optional
// override for the rare case where the app's normal DATABASE_URL role lacks CREATEDB (e.g. a
// locked-down dedicated application role) — it is validated to point at the exact same host as
// DATABASE_URL; a mismatch is refused rather than silently used, so this can never become an
// accidental route to a different/remote database.
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { splitSqlStatements } from './migrationRunner.js';

// Distinct from migrationRunner.js's own ADVISORY_LOCK_KEY (7727727) — advisory locks are
// keyed per-cluster in PostgreSQL (not per-database), so a shared key would make an in-flight
// bootstrap and an in-flight incremental-migration run block/interfere with each other for no
// reason; they are separate operations with separate lifecycles.
const BOOTSTRAP_ADVISORY_LOCK_KEY = 7727728;

const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/;
const CORE_MARKER_TABLE = 'students';

export class BootstrapError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

function withConnectionLimit(databaseUrl, limit) {
  const u = new URL(databaseUrl);
  u.searchParams.set('connection_limit', String(limit));
  return u.toString();
}

// extractDatabaseName: the only thing ever read out of DATABASE_URL for use in a raw SQL
// identifier — validated against a strict allowlist first. Never accepts an arbitrary string
// from configuration into a `CREATE DATABASE "<name>"` statement without this check.
export function extractDatabaseName(databaseUrl) {
  const name = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new BootstrapError(
      'unsafe_database_name',
      'اسم قاعدة البيانات في DATABASE_URL يحتوي أحرفاً غير آمنة للاستخدام كمُعرِّف SQL مباشر — يُسمح فقط بأحرف/أرقام/underscore.'
    );
  }
  return name;
}

// resolveAdminDatabaseUrl: same host/credentials as DATABASE_URL, pointed at the `postgres`
// maintenance database — unless STUDIX_DB_ADMIN_URL is set, in which case it MUST target the
// same host as DATABASE_URL (never a silent route to a different/remote server).
export function resolveAdminDatabaseUrl(databaseUrl, adminUrlOverride = process.env.STUDIX_DB_ADMIN_URL) {
  const targetHost = new URL(databaseUrl).hostname;
  if (adminUrlOverride) {
    const overrideHost = new URL(adminUrlOverride).hostname;
    if (overrideHost !== targetHost) {
      throw new BootstrapError(
        'admin_url_host_mismatch',
        'STUDIX_DB_ADMIN_URL يشير إلى مضيف مختلف عن DATABASE_URL — مرفوض صراحةً لمنع أي اتصال ضمني بخادم بعيد أو غير متوقَّع.'
      );
    }
    return adminUrlOverride;
  }
  const u = new URL(databaseUrl);
  u.pathname = '/postgres';
  return u.toString();
}

// sanitizeUrlForLog: host/port/database/user only — reused across every message this module
// can log — never a password, never the raw connection string.
function sanitizeUrlForLog(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return { host: u.hostname || null, port: u.port || null, database: u.pathname.replace(/^\//, '') || null, user: u.username || null };
  } catch {
    return null;
  }
}

function classifyPgErrorCode(err) {
  return err?.meta?.code || err?.code || null;
}

function describeConnectionFailure(err, context) {
  const message = String(err?.message || '');
  const pgCode = classifyPgErrorCode(err);
  if (pgCode === '28P01' || /password authentication failed/i.test(message)) {
    return new BootstrapError('auth_failed', `فشل التحقّق من هوية الدخول إلى PostgreSQL (${context}) — تأكد من صحة اسم المستخدم/كلمة المرور في الإعداد.`);
  }
  if (pgCode === '3D000' || /database .* does not exist/i.test(message)) {
    return new BootstrapError('database_missing', `قاعدة البيانات غير موجودة (${context}).`);
  }
  if (/Can't reach database server/i.test(message) || err?.errorCode === 'P1001') {
    return new BootstrapError('postgres_unreachable', `تعذّر الوصول إلى خادم PostgreSQL (${context}) — تأكد أن الخدمة تعمل وأن المضيف/المنفذ صحيحان.`);
  }
  return new BootstrapError('connection_failed', `فشل الاتصال بـ PostgreSQL (${context}): ${err?.constructor?.name || 'خطأ غير معروف'}.`);
}

// acquireAdminLock/releaseAdminLock: same connection-affinity technique migrationRunner.js
// already established (connection_limit=1 so the acquire/release calls provably share one
// physical session) — a distinct client, never the caller's shared prisma instance.
async function withAdvisoryLock(adminUrl, fn) {
  const lockClient = new PrismaClient({ datasources: { db: { url: withConnectionLimit(adminUrl, 1) } } });
  try {
    let locked;
    try {
      const rows = await lockClient.$queryRaw`SELECT pg_try_advisory_lock(${BOOTSTRAP_ADVISORY_LOCK_KEY}) AS locked`;
      locked = rows[0].locked === true;
    } catch (err) {
      throw describeConnectionFailure(err, 'قفل التمهيد الاستشاري');
    }
    if (!locked) {
      throw new BootstrapError(
        'bootstrap_in_progress',
        'عملية تمهيد قاعدة بيانات أخرى تعمل بالفعل على نفس خادم PostgreSQL — تم الإيقاف بدل انتظار أبدي أو تنفيذ متزامن غير آمن.'
      );
    }
    try {
      return await fn();
    } finally {
      try { await lockClient.$queryRaw`SELECT pg_advisory_unlock(${BOOTSTRAP_ADVISORY_LOCK_KEY})`; } catch { /* best-effort */ }
    }
  } finally {
    await lockClient.$disconnect().catch(() => {});
  }
}

// databaseExists: queried over the admin (maintenance-database) connection — the target
// database itself may not exist yet, so it can never be the connection used for this check.
export async function databaseExists(adminUrl, dbName) {
  const client = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    const rows = await client.$queryRaw`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    return rows.length > 0;
  } catch (err) {
    throw describeConnectionFailure(err, 'فحص وجود قاعدة البيانات');
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

// createDatabaseIfMissing: idempotent — a concurrent CREATE DATABASE from another process
// racing this one surfaces as PostgreSQL's own duplicate_database (42P04), treated as a
// benign "someone else already created it" outcome, not a failure (the advisory lock in
// bootstrapDatabase() already prevents this in the normal case; this is defense in depth for
// any external process creating the database outside this module entirely).
export async function createDatabaseIfMissing(adminUrl, dbName) {
  if (await databaseExists(adminUrl, dbName)) {
    return { created: false };
  }
  const client = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    await client.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    return { created: true };
  } catch (err) {
    const pgCode = classifyPgErrorCode(err);
    if (pgCode === '42P04') return { created: false }; // duplicate_database — already exists, fine
    if (pgCode === '42501' || /permission denied/i.test(String(err?.message))) {
      throw new BootstrapError(
        'insufficient_privilege',
        `صلاحية غير كافية لإنشاء قاعدة بيانات جديدة — امنح دور DATABASE_URL صلاحية CREATEDB، أو أنشئ قاعدة "${dbName}" يدوياً مسبقاً، أو حدِّد STUDIX_DB_ADMIN_URL بدور يملك هذه الصلاحية.`
      );
    }
    throw describeConnectionFailure(err, 'إنشاء قاعدة البيانات');
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

// classifySchemaState: the target database MUST already exist by the time this is called.
export async function classifySchemaState(databaseUrl) {
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const countRows = await client.$queryRaw`
      SELECT COUNT(*)::int AS count FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    const tableCount = countRows[0]?.count ?? 0;
    if (tableCount === 0) return { state: 'uninitialized', tableCount };

    const coreRows = await client.$queryRaw`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${CORE_MARKER_TABLE}
    `;
    if (coreRows.length > 0) return { state: 'has_base_schema', tableCount };

    return { state: 'partial_schema', tableCount };
  } catch (err) {
    throw describeConnectionFailure(err, 'فحص حالة الـ schema');
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

// prepareSchemaStatements: pure, DB-free — strips the psql-only \restrict/\unrestrict lines
// (a newer pg_dump safety feature; not valid raw SQL for a driver) and splits the remainder
// into individually executable statements via migrationRunner.js's own proven splitter. Never
// modifies the schema file on disk; this only ever operates on a string already read into
// memory by the caller.
export function prepareSchemaStatements(rawSql) {
  const withoutPsqlMetaCommands = rawSql
    .split('\n')
    .filter((line) => !line.startsWith('\\restrict') && !line.startsWith('\\unrestrict'))
    .join('\n');
  return splitSqlStatements(withoutPsqlMetaCommands);
}

// applyBaseSchema: reads backend/prisma/studix-schema.sql (never modified on disk, never
// duplicated in JS — read verbatim) and executes every prepared statement inside ONE
// transaction — a mid-application conflict (e.g. a concurrent process winning a race despite
// the advisory lock having been released between calls) rolls back entirely, leaving no
// half-applied schema behind.
export async function applyBaseSchema(databaseUrl, schemaPath) {
  const raw = fs.readFileSync(schemaPath, 'utf8');
  const statements = prepareSchemaStatements(raw);

  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await client.$transaction(async (tx) => {
      for (const sql of statements) {
        await tx.$executeRawUnsafe(sql);
      }
    }, { timeout: 60_000 });
  } catch (err) {
    throw new BootstrapError(
      'schema_apply_failed',
      `فشل تطبيق studix-schema.sql: ${err?.constructor?.name || 'خطأ غير معروف'} — تم التراجع بالكامل (معاملة واحدة)، لم يُترَك أي schema جزئي.`
    );
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

// bootstrapDatabase: the single orchestration entry point.
//   1. Validate DATABASE_URL shape (delegated to the caller — see
//      backend/scripts/bootstrapDatabase.js, which reuses lib/startupErrors.js's
//      validateDatabaseUrl exactly as server.js already does).
//   2. Acquire the bootstrap advisory lock (fail-fast, never blocks).
//   3. Ensure the target database exists (create if missing).
//   4. Classify and, only if genuinely empty, apply the base schema.
//   5. Return a result describing what happened — never invokes runMigrations() itself (see
//      this file's header comment and backend/scripts/bootstrapDatabase.js for why).
export async function bootstrapDatabase({ databaseUrl = process.env.DATABASE_URL, schemaPath, adminUrlOverride } = {}) {
  if (!schemaPath) {
    throw new BootstrapError('missing_schema_path', 'مسار ملف studix-schema.sql مطلوب ولم يُمرَّر.');
  }
  const dbName = extractDatabaseName(databaseUrl);
  const adminUrl = resolveAdminDatabaseUrl(databaseUrl, adminUrlOverride);
  const connectionInfo = sanitizeUrlForLog(databaseUrl);

  return withAdvisoryLock(adminUrl, async () => {
    const { created } = await createDatabaseIfMissing(adminUrl, dbName);

    const initial = await classifySchemaState(databaseUrl);
    if (initial.state === 'has_base_schema') {
      return { action: 'already_initialized', databaseCreated: created, tableCount: initial.tableCount, connectionInfo };
    }
    if (initial.state === 'partial_schema') {
      throw new BootstrapError(
        'partial_schema',
        `قاعدة البيانات "${dbName}" تحتوي على ${initial.tableCount} جدول(جداول) لكن بدون الجدول الأساسي المتوقَّع ("${CORE_MARKER_TABLE}") — حالة غير متّسقة. تم الإيقاف بلا أي تعديل بدل محاولة إصلاح مدمِّر. راجع القاعدة يدوياً.`
      );
    }

    // state === 'uninitialized'
    await applyBaseSchema(databaseUrl, schemaPath);
    const after = await classifySchemaState(databaseUrl);
    if (after.state !== 'has_base_schema') {
      throw new BootstrapError(
        'schema_apply_incomplete',
        'تم تطبيق studix-schema.sql بلا استثناء لكن الجدول الأساسي المتوقَّع لا يزال غائباً بعد التطبيق — حالة غير متوقَّعة تحتاج مراجعة يدوية.'
      );
    }
    return { action: 'schema_applied', databaseCreated: created, tableCount: after.tableCount, connectionInfo };
  });
}
