// backend/src/db/devReset.js
// ─────────────────────────────────────────────────────────────
// Developer Data Reset — STEP 1: the transactional core. Wipes development/test BUSINESS data
// and returns Studix to a clean starting state while preserving system identity, licensing,
// users/roles and configuration. Developer tooling only: there is no HTTP route and no UI for
// this (CLI-first, see the Developer Data Reset design); the CLI (a later step) is the only
// intended caller, after it has taken and verified a backup.
//
// Safety model (every rule below is fail-closed — any doubt aborts before or inside the one
// transaction, which then rolls back completely; PostgreSQL TRUNCATE is fully transactional):
//   - Two explicit, frozen classifications cover EVERY public table. A table in neither list
//     (e.g. added by a future migration) aborts the reset — a new table must be classified on
//     purpose, never wiped or kept by accident.
//   - ONE explicit statement: TRUNCATE TABLE <exactly the 25 reset tables> RESTART IDENTITY.
//     Never CASCADE (a new foreign key from a preserved table into a reset table must make the
//     TRUNCATE fail, not silently wipe preserved data), never DROP, never DISABLE TRIGGER.
//     RESTART IDENTITY restarts only the sequences OWNED by the truncated tables
//     (parents_id_seq, inv_materials_id_seq); the standalone seq_* sequences are untouched.
//   - Append-only triggers (prevent_delete on payments, treasury_txn, inventory_txn,
//     admission_payments, admission_system_log, communications, activity_logs) are row-level
//     BEFORE DELETE triggers, which TRUNCATE does not fire — they are neither disabled nor
//     modified, and remain in force for every normal DELETE afterwards. That is precisely why
//     this module must stay developer-only: TRUNCATE is the one path past them. (Production
//     also refuses it on its own: the studix_app role is granted SELECT/INSERT/UPDATE/DELETE
//     but not TRUNCATE — bootstrapDatabase.js.)
//   - Pre-flight, inside the same transaction: the connected database's name must equal the
//     caller's explicit expectation; every public table must be classified and every
//     classified table must exist; no foreign key may point from a non-reset table into a
//     reset table.
//   - A verified backup is a hard precondition — performDevReset refuses to run without the
//     record the backup step produces.
//   - Integrity: preserved tables are fingerprinted (row count + md5 of every row's content)
//     before and after; any difference aborts. The one intended change, users.auth_version,
//     is excluded from that fingerprint and verified separately as exactly +1 per user.
//     REPEATABLE READ isolation makes the before/after comparison see only this transaction's
//     own effects.
//   - Every reset table is verified empty after the TRUNCATE, then exactly one activity_logs
//     row records the reset — the surviving audit entry.
//
// auth_version (+1 for every preserved user) invalidates every existing session: signed
// session tokens snapshot it and requireRole/requirePermission reject a mismatch with 401.
// NOTE: those checks read lib/authCache.js, a per-process in-memory cache with no expiry — a
// running backend keeps its cached versions until it restarts. The CLI must therefore run with
// the backend stopped (or restart it afterwards); that belongs to the CLI step, not here.
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { Prisma } from '@prisma/client';

// Exactly the 25 business/test tables of the approved design.
export const RESET_TABLES = Object.freeze([
  'students', 'parents', 'groups', 'student_group_enrollments',
  'attendance', 'attendance_sessions', 'absence_followup', 'recitations',
  'exams', 'grades', 'homeworks', 'hw_submissions',
  'inv_materials', 'inventory_txn',
  'admissions', 'admission_followups', 'admission_system_log', 'admission_payments',
  'communications', 'comm_tasks', 'wa_report_log',
  'payments', 'treasury_txn', 'cashboxes',
  'activity_logs',
]);

// System identity, licensing, authentication and configuration — never touched, except the
// deliberate users.auth_version bump. teachers is preserved on purpose: users.teacher_id
// references it, so truncating it would require CASCADE into users.
export const PRESERVE_TABLES = Object.freeze([
  '_studix_migrations', 'license_config', 'support_access_config',
  'users', 'roles',
  'center_profile', 'inventory_settings',
  'teachers',
]);

export const RESET_CONFIRMATION_PHRASE = 'RESET STUDIX DATA';

// Columns deliberately allowed to change in a preserved table (excluded from its fingerprint
// and verified on their own instead).
const PRESERVED_MUTABLE_COLUMNS = Object.freeze({ users: ['auth_version'] });

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const DEFAULT_TRANSACTION_OPTIONS = Object.freeze({
  maxWait: 10_000,
  timeout: 120_000,
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
});

export class DevResetError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'DevResetError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function quoteIdentifier(name) {
  if (typeof name !== 'string' || !SAFE_IDENTIFIER.test(name)) {
    throw new DevResetError('unsafe_identifier', `اسم جدول غير آمن: "${name}".`);
  }
  return `"${name}"`;
}

/**
 * The one reset statement. Only ever called with RESET_TABLES by this module; exported for
 * tests. Every name is validated and quoted; the statement never contains CASCADE.
 */
export function buildTruncateSql(tables = RESET_TABLES) {
  if (!Array.isArray(tables) || tables.length === 0) {
    throw new DevResetError('invalid_table_list', 'قائمة جداول إعادة التعيين فارغة.');
  }
  if (new Set(tables).size !== tables.length) {
    throw new DevResetError('invalid_table_list', 'قائمة جداول إعادة التعيين تحتوي تكراراً.');
  }
  return `TRUNCATE TABLE ${tables.map(quoteIdentifier).join(', ')} RESTART IDENTITY`;
}

/**
 * Fail-closed checks against the live schema, run inside the reset transaction.
 * @param db a Prisma client or transaction client
 * @param {{ expectedDatabaseName: string }} opts
 */
export async function runPreflightChecks(db, { expectedDatabaseName } = {}) {
  if (typeof expectedDatabaseName !== 'string' || !expectedDatabaseName.trim()) {
    throw new DevResetError('database_name_required', 'اسم قاعدة البيانات المتوقَّعة مطلوب صراحةً.');
  }

  const [{ current_database: actualDatabaseName }] = await db.$queryRawUnsafe('SELECT current_database()');
  if (actualDatabaseName !== expectedDatabaseName) {
    throw new DevResetError('database_name_mismatch',
      `قاعدة البيانات المتصلة "${actualDatabaseName}" ليست القاعدة المتوقَّعة "${expectedDatabaseName}".`);
  }

  const tableRows = await db.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
  const liveTables = new Set(tableRows.map((r) => r.table_name));
  const classified = new Set([...RESET_TABLES, ...PRESERVE_TABLES]);

  const unclassified = [...liveTables].filter((t) => !classified.has(t)).sort();
  if (unclassified.length) {
    throw new DevResetError('unclassified_tables',
      `جداول غير مصنَّفة (لا إعادة تعيين ولا حفظ): ${unclassified.join('، ')} — صنِّفها صراحةً أولاً.`,
      { unclassified });
  }
  const missing = [...classified].filter((t) => !liveTables.has(t)).sort();
  if (missing.length) {
    throw new DevResetError('missing_tables', `جداول مصنَّفة غير موجودة: ${missing.join('، ')}.`, { missing });
  }

  const fkRows = await db.$queryRawUnsafe(
    `SELECT c.conname AS name, cl.relname AS child, pl.relname AS parent
       FROM pg_constraint c
       JOIN pg_class cl ON cl.oid = c.conrelid
       JOIN pg_class pl ON pl.oid = c.confrelid
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`);
  const resetSet = new Set(RESET_TABLES);
  const crossing = fkRows.filter((fk) => resetSet.has(fk.parent) && !resetSet.has(fk.child));
  if (crossing.length) {
    throw new DevResetError('preserved_references_reset',
      `مفاتيح خارجية من جداول محفوظة إلى جداول إعادة التعيين: ${crossing.map((fk) => `${fk.child} → ${fk.parent}`).join('، ')}.`,
      { foreignKeys: crossing });
  }

  return { databaseName: actualDatabaseName, tableCount: liveTables.size, foreignKeyCount: fkRows.length };
}

async function fingerprintTable(db, table) {
  const excluded = PRESERVED_MUTABLE_COLUMNS[table] || [];
  const excludedSql = `ARRAY[${excluded.map((c) => `'${c}'`).join(', ')}]::text[]`;
  const [row] = await db.$queryRawUnsafe(
    `SELECT count(*)::int AS n,
            md5(coalesce(string_agg(r, E'\\n' ORDER BY r), '')) AS h
       FROM (SELECT (to_jsonb(t) - ${excludedSql})::text AS r FROM ${quoteIdentifier(table)} t) s`);
  return { rows: row.n, hash: row.h };
}

async function snapshotPreserved(db) {
  const snapshot = {};
  for (const table of PRESERVE_TABLES) snapshot[table] = await fingerprintTable(db, table);
  return snapshot;
}

async function readUserAuthVersions(db) {
  const rows = await db.$queryRawUnsafe('SELECT id, auth_version FROM "users"');
  return new Map(rows.map((r) => [r.id, Number(r.auth_version)]));
}

async function countRows(db, tables) {
  const counts = {};
  for (const table of tables) {
    const [row] = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ${quoteIdentifier(table)}`);
    counts[table] = row.n;
  }
  return counts;
}

function assertVerifiedBackup(verifiedBackup) {
  if (!verifiedBackup || typeof verifiedBackup.path !== 'string' || !verifiedBackup.path.trim()
      || !verifiedBackup.verifiedAt) {
    throw new DevResetError('backup_required',
      'لا يمكن إعادة التعيين بلا نسخة احتياطية مُتحقَّق منها (path + verifiedAt).');
  }
}

/**
 * Performs the reset in one transaction. Throws DevResetError; on any failure the transaction
 * has rolled back and the database is exactly as it was.
 *
 * @param prisma a PrismaClient
 * @param {{
 *   expectedDatabaseName: string,               // mandatory database-name guard
 *   confirmation: string,                       // must equal RESET_CONFIRMATION_PHRASE
 *   verifiedBackup: { path: string, verifiedAt: string },  // produced by the backup step
 *   actor?: { id?: string|null, name?: string|null },      // recorded in the audit entry
 *   transactionOptions?: object,
 * }} opts
 * @returns {Promise<{ databaseName, deletedCounts, usersInvalidated, activityLogId, backupPath }>}
 */
export async function performDevReset(prisma, {
  expectedDatabaseName,
  confirmation,
  verifiedBackup,
  actor = null,
  transactionOptions = {},
} = {}) {
  if (confirmation !== RESET_CONFIRMATION_PHRASE) {
    throw new DevResetError('confirmation_mismatch', `عبارة التأكيد يجب أن تكون حرفياً: ${RESET_CONFIRMATION_PHRASE}`);
  }
  assertVerifiedBackup(verifiedBackup);

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
      const { databaseName } = await runPreflightChecks(tx, { expectedDatabaseName });

      const preservedBefore = await snapshotPreserved(tx);
      const versionsBefore = await readUserAuthVersions(tx);
      const deletedCounts = await countRows(tx, RESET_TABLES);

      await tx.$executeRawUnsafe(buildTruncateSql(RESET_TABLES));

      const remaining = await countRows(tx, RESET_TABLES);
      const notEmpty = Object.entries(remaining).filter(([, n]) => n !== 0).map(([t]) => t);
      if (notEmpty.length) {
        throw new DevResetError('reset_incomplete', `جداول لم تُفرَّغ: ${notEmpty.join('، ')}.`, { notEmpty });
      }

      const usersInvalidated = await tx.$executeRawUnsafe('UPDATE "users" SET auth_version = auth_version + 1');
      const versionsAfter = await readUserAuthVersions(tx);
      const badVersions = [...versionsBefore].filter(([id, v]) => versionsAfter.get(id) !== v + 1).map(([id]) => id);
      if (badVersions.length || versionsAfter.size !== versionsBefore.size) {
        throw new DevResetError('auth_version_mismatch', 'فشل التحقق من زيادة auth_version لكل مستخدم.', { users: badVersions });
      }

      const preservedAfter = await snapshotPreserved(tx);
      const changed = PRESERVE_TABLES.filter((t) =>
        preservedBefore[t].rows !== preservedAfter[t].rows || preservedBefore[t].hash !== preservedAfter[t].hash);
      if (changed.length) {
        throw new DevResetError('preserved_data_changed', `تغيّرت بيانات جداول محفوظة: ${changed.join('، ')}.`, { changed });
      }

      const activityLogId = crypto.randomUUID();
      await tx.activity_logs.create({
        data: {
          id: activityLogId,
          action: 'dev_reset',
          module: 'developer',
          user_id: actor?.id ?? null,
          user_name: actor?.name ?? 'Developer Data Reset',
          entity_type: 'database',
          entity_id: databaseName,
          details: JSON.stringify({ backupPath: verifiedBackup.path, deletedCounts, usersInvalidated }),
        },
      });
      const [{ n: logRows }] = await tx.$queryRawUnsafe('SELECT count(*)::int AS n FROM "activity_logs"');
      if (logRows !== 1) {
        throw new DevResetError('audit_entry_invalid', `سجل النشاط بعد إعادة التعيين يجب أن يحتوي صفاً واحداً فقط (وُجد ${logRows}).`);
      }

      return { databaseName, deletedCounts, usersInvalidated, activityLogId, backupPath: verifiedBackup.path };
    }, { ...DEFAULT_TRANSACTION_OPTIONS, ...transactionOptions });
  } catch (err) {
    if (err instanceof DevResetError) throw err;
    // Any other failure (lock timeout, permission denied, FK violation from a TRUNCATE) — the
    // transaction rolled back. Surface a stable code; keep the database's own message only as
    // detail, never a connection string (Prisma errors do not include one).
    throw new DevResetError('reset_failed', 'فشلت إعادة التعيين وتم التراجع عن المعاملة بالكامل — لم يتغيّر شيء.', {
      cause: err?.code || err?.name || 'unknown',
      message: String(err?.message || '').split('\n').filter(Boolean).slice(-1)[0] || '',
    });
  }
}
