// backend/src/db/restoreDatabase.js
// ─────────────────────────────────────────────────────────────
// Phase 2C-2 — the elevated restore orchestrator FOUNDATION (per the approved Phase 2B design
// and the Phase 2C-1 state/identity layer). This file performs ONLY the pre-flight part of a
// real restore: create a disposable candidate database, restore a supplied backup into it with
// the REAL, unmodified restoreBackup()/findPgRestore() (Phase 2A), and verify it. It never
// touches the production database, never switches DATABASE_URL, never stops/starts any Windows
// service, and never promotes a candidate — those are Phase 2C-3's job (the `switching`/
// `active`/`rolling_back`/`rolled_back` restore-state statuses are deliberately never reached
// from here; see restoreState.js's own transition graph).
//
// OD3 — this is the ONE place outside backend/src/installer/firstInstall.js that reads
// %ProgramData%\Studix\config\admin.env, and it does so by reusing
// lib/provisioningAdminConfig.js's readProvisioningAdminUrl()/resolveProvisioningAdminConfigPath()
// UNMODIFIED — no second admin-credential parser exists anywhere in this file. This module is
// meant to run as its own separate, short-lived Node process (mirroring firstInstall.js's own
// shape exactly — see the CLI entry point at the bottom), never imported by server.js/
// lib/config.js, and never wired into any Express route. The normal, always-running StudixApp
// process has no import path that reaches this file at all.
//
// Elevation itself (actually launching this process with an elevated Windows token) is
// DELIBERATELY NOT implemented here — per the approved Phase 2B design (§4/§5), that belongs to
// a later phase, reusing the exact same "elevated node.exe running a narrow orchestrator
// script" shape installer/studix.iss's own Exec() calls already use for firstInstall.js. This
// file only needs to be CALLABLE by that future layer; it does not invoke UAC itself.
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { PrismaClient } from '@prisma/client';
import {
  readProvisioningAdminUrl, resolveProvisioningAdminConfigPath,
} from '../lib/provisioningAdminConfig.js';
import { createDatabaseIfMissing, classifySchemaState } from './bootstrapDatabase.js';
import { restoreBackup } from './backup.js';
import { checkMigrationsUpToDate } from './migrationRunner.js';
import { transitionRestoreState, advanceToIdleIfTerminal, RestoreStateError } from './restoreState.js';

export class RestoreOrchestratorError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

// The one, fixed, codebase-wide production database name (postgresProvisioning.js's own
// buildDatabaseUrl()/provisionPostgres() default `database='studix'`, used identically
// throughout firstInstall.js) — never operator-configurable, so hardcoding it here is the
// correct, safe default rather than trusting an externally-supplied value for the single most
// important safety check in this file.
export const PRODUCTION_DATABASE_NAME = 'studix';

const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/; // same convention as bootstrapDatabase.js's own
const CANDIDATE_MARKER = '_restore_candidate_';
const MAX_IDENTIFIER_LENGTH = 63; // PostgreSQL's own identifier length limit

// Scrubs ANY postgres(ql):// connection string out of an error message before it is ever
// persisted to restore-state.json, thrown further, or printed — defense in depth against a
// lower-level driver error (Prisma/pg) that happens to embed a full connection string
// (including a password) in its own .message.
const CONNECTION_STRING_RE = /postgres(?:ql)?:\/\/[^\s"')]+/gi;
export function redactErrorMessage(err) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(CONNECTION_STRING_RE, 'postgresql://[REDACTED]');
}

// withDatabaseName: swaps only the path segment of an existing connection URL — user/password/
// host/port are carried through untouched via the WHATWG URL parser's own fields, never
// decoded/re-encoded by hand.
export function withDatabaseName(rawUrl, dbName) {
  const u = new URL(rawUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

// ── input validation ──────────────────────────────────────────────────────────────────────

export function assertValidBackupPath(backupPath) {
  if (typeof backupPath !== 'string' || backupPath.trim().length === 0) {
    throw new RestoreOrchestratorError('missing_backup_path', 'مسار ملف النسخة الاحتياطية مفقود.');
  }
  let stat;
  try {
    stat = fs.statSync(backupPath);
  } catch {
    throw new RestoreOrchestratorError('backup_path_not_found', `ملف النسخة الاحتياطية غير موجود: ${backupPath}`);
  }
  if (!stat.isFile() || stat.size === 0) {
    throw new RestoreOrchestratorError('invalid_backup_path', `مسار النسخة الاحتياطية ليس ملفاً حقيقياً أو فارغ: ${backupPath}`);
  }
}

/**
 * generateCandidateDatabaseName: the ONLY place a candidate name is produced — always derived
 * from a known-safe source name plus an internally-generated (crypto.randomBytes) suffix, never
 * accepted verbatim from external input. Composed entirely of [A-Za-z0-9_], so it can never
 * carry arbitrary SQL into the `CREATE DATABASE "<name>"` statement createDatabaseIfMissing()
 * issues downstream.
 */
export function generateCandidateDatabaseName(sourceDbName = PRODUCTION_DATABASE_NAME, { randomBytes = crypto.randomBytes } = {}) {
  if (!SAFE_IDENTIFIER.test(sourceDbName)) {
    throw new RestoreOrchestratorError('unsafe_source_name', `اسم قاعدة المصدر "${sourceDbName}" غير آمن للاستخدام في تسمية مُشتقّة.`);
  }
  const suffix = `${Date.now()}_${randomBytes(4).toString('hex')}`;
  const name = `${sourceDbName}${CANDIDATE_MARKER}${suffix}`;
  assertSafeCandidateDatabaseName(name, sourceDbName === PRODUCTION_DATABASE_NAME ? PRODUCTION_DATABASE_NAME : undefined);
  return name;
}

/**
 * assertSafeDatabaseIdentifier: the shape/length-only gate — [A-Za-z0-9_] and PostgreSQL's own
 * 63-character identifier limit, nothing more. Deliberately does NOT reject the production
 * database name (Phase 2C-3B's switch/rename code must validate the CURRENT production name
 * too, since that is exactly the name being renamed away — assertSafeCandidateDatabaseName
 * below, which DOES reject it, would be the wrong check to reuse there). Every other name-safety
 * check in this module is built on top of this one, never a second, independent regex.
 */
export function assertSafeDatabaseIdentifier(name, { label = 'اسم قاعدة البيانات' } = {}) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new RestoreOrchestratorError('invalid_database_name', `${label} مفقود أو ليس نصاً.`);
  }
  if (name.length > MAX_IDENTIFIER_LENGTH) {
    throw new RestoreOrchestratorError(
      'database_name_too_long',
      `${label} أطول من حد PostgreSQL للمُعرِّفات (${MAX_IDENTIFIER_LENGTH} حرفاً): "${name}".`
    );
  }
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new RestoreOrchestratorError(
      'unsafe_database_name',
      `${label} "${name}" يحتوي أحرفاً غير آمنة للاستخدام كمُعرِّف SQL مباشر — يُسمح فقط بأحرف/أرقام/underscore.`
    );
  }
  return true;
}

/**
 * assertSafeCandidateDatabaseName: the one hard gate every candidate name passes through
 * before it is ever used in a CREATE DATABASE/connection-string context. Builds on
 * assertSafeDatabaseIdentifier (shape/length), then additionally rejects: the literal
 * production database name, and — defense in depth — any candidate name that doesn't even
 * carry the expected "this is a restore candidate" marker, so a caller can never accidentally
 * pass through some unrelated, non-disposable name.
 */
export function assertSafeCandidateDatabaseName(candidateName, productionDbName = PRODUCTION_DATABASE_NAME) {
  assertSafeDatabaseIdentifier(candidateName, { label: 'اسم القاعدة المُرشَّحة' });
  if (candidateName === productionDbName) {
    throw new RestoreOrchestratorError(
      'production_target_rejected',
      `رُفض: "${candidateName}" هي اسم قاعدة الإنتاج الحقيقية — ممنوع استهدافها كقاعدة مُرشَّحة تحت أي ظرف.`
    );
  }
  if (!candidateName.includes(CANDIDATE_MARKER)) {
    throw new RestoreOrchestratorError(
      'missing_candidate_marker',
      `اسم القاعدة المُرشَّحة "${candidateName}" لا يحمل العلامة المتوقَّعة ("${CANDIDATE_MARKER}") — تم الرفض احترازاً بدل افتراض أنه آمن.`
    );
  }
  return true;
}

// ── admin credential (the ONE reason this file exists as a separate process) ────────────────

/**
 * readAdminCredential: reuses lib/provisioningAdminConfig.js's own readProvisioningAdminUrl()/
 * resolveProvisioningAdminConfigPath() UNMODIFIED — no second parser. Throws a clear,
 * credential-free error (never the file's contents) if the file is missing, malformed, or
 * missing the STUDIX_DB_ADMIN_URL key.
 */
export function readAdminCredential({
  configPath = resolveProvisioningAdminConfigPath(),
  existsSync, readFileSync,
} = {}) {
  const adminUrl = readProvisioningAdminUrl({ configPath, existsSync, readFileSync });
  if (!adminUrl) {
    throw new RestoreOrchestratorError(
      'admin_credential_missing',
      `تعذّر العثور على بيانات اعتماد الإدارة (STUDIX_DB_ADMIN_URL) عند ${configPath} — لا يمكن المتابعة بلا اتصال إداري حقيقي.`
    );
  }
  return adminUrl;
}

// ── candidate database lifecycle (pre-flight only — no promotion, no switch) ────────────────

/**
 * createCandidateDatabase: connects to the `postgres` maintenance database using the SAME
 * admin credentials (never a different host — see withDatabaseName above), creates the
 * candidate database if missing, then verifies it is genuinely empty before returning. Never
 * touches the production database — assertSafeCandidateDatabaseName is re-checked here too
 * (defense in depth, even though generateCandidateDatabaseName already checked it once).
 */
export async function createCandidateDatabase({ adminUrl, candidateName, productionDbName = PRODUCTION_DATABASE_NAME }) {
  assertSafeCandidateDatabaseName(candidateName, productionDbName);

  const maintenanceUrl = withDatabaseName(adminUrl, 'postgres');
  await createDatabaseIfMissing(maintenanceUrl, candidateName);

  const candidateUrl = withDatabaseName(adminUrl, candidateName);
  const state = await classifySchemaState(candidateUrl);
  if (state.state !== 'uninitialized') {
    throw new RestoreOrchestratorError(
      'candidate_not_empty',
      `القاعدة المُرشَّحة "${candidateName}" ليست فارغة (الحالة: ${state.state}، عدد الجداول: ${state.tableCount}) — تم الرفض بدل المتابعة فوق بيانات موجودة.`
    );
  }
  return { candidateName, candidateUrl };
}

/**
 * restoreIntoCandidate: the ONE call into Phase 2A's real, unmodified restoreBackup() — no
 * pg_restore logic is duplicated here. restoreBackup() itself already refuses a non-empty
 * target and already runs `pg_restore --list` (read-only) before anything destructive.
 */
export async function restoreIntoCandidate({ backupPath, candidateUrl, pgHome, legacyPgRoot }) {
  assertValidBackupPath(backupPath);
  return restoreBackup(backupPath, candidateUrl, { pgHome, legacyPgRoot });
}

/**
 * verifyCandidate: reuses classifySchemaState() (bootstrapDatabase.js) and
 * checkMigrationsUpToDate() (migrationRunner.js) UNMODIFIED — no duplicated schema/migration
 * logic. Opens exactly one short-lived PrismaClient, always disconnected before returning.
 */
export async function verifyCandidate({ candidateUrl }) {
  const state = await classifySchemaState(candidateUrl);
  if (state.state === 'uninitialized') {
    throw new RestoreOrchestratorError(
      'candidate_empty_after_restore',
      'انتهت عملية الاستعادة بلا خطأ ظاهر، لكن القاعدة المُرشَّحة ما زالت فارغة — فشل استعادة صامت.'
    );
  }

  const client = new PrismaClient({ datasources: { db: { url: candidateUrl } } });
  let migrationCheck;
  try {
    migrationCheck = await checkMigrationsUpToDate(client);
  } finally {
    await client.$disconnect().catch(() => {});
  }
  if (!migrationCheck.upToDate) {
    throw new RestoreOrchestratorError(
      'candidate_migrations_pending',
      `القاعدة المُرشَّحة تحتوي ترحيلات غير مُطبَّقة مقارنةً بالكود الحالي: ${migrationCheck.pendingVersions.join(', ')}.`
    );
  }
  return { tableCount: state.tableCount, migrationsUpToDate: true };
}

// ── the orchestrator entry point ─────────────────────────────────────────────────────────────

/**
 * runRestoreOrchestrator: preparing -> restoring -> verified, or preparing/restoring/verified ->
 * failed on any error. Never reaches switching/active/rolling_back/rolled_back (Phase 2C-3).
 *
 * Ordering, deliberately: (1) validate the backup path and generate the candidate name — pure,
 * no I/O beyond a stat() call, nothing privileged yet; (2) Phase 2C-3C Part 5B-1:
 * advanceToIdleIfTerminal() — if a PRIOR, completely finished restore cycle left the state at
 * 'active'/'rolled_back'/'failed' (its only, already-existing 'idle' edge in
 * ALLOWED_TRANSITIONS), walk it back to 'idle' first, so this new, independent restore is not
 * permanently blocked by that prior cycle's own terminal outcome — never touches a genuinely
 * in-flight state (preparing/restoring/verified/switching/rolling_back), which must keep
 * failing the very next line exactly as before; (3) the FIRST restore-state write
 * (idle -> preparing) happens OUTSIDE the try/catch below and is NOT itself turned into a
 * "failed" transition on error — if the state machine isn't actually idle (e.g. a previous
 * restore is still in flight, or the file is corrupt), this call throws and this invocation
 * never took ownership of that state, so it must not overwrite it; (4) every step after that
 * point is inside the try/catch, which always records a redacted, credential-free `failed`
 * transition before rethrowing.
 */
export async function runRestoreOrchestrator({
  backupPath,
  restoreId = crypto.randomUUID(),
  sourceDbName = PRODUCTION_DATABASE_NAME,
  adminConfigPath,
  restoreStateConfigPath,
  pgHome,
  legacyPgRoot,
  readAdminCredentialFn = readAdminCredential,
  generateCandidateDatabaseNameFn = generateCandidateDatabaseName,
  createCandidateDatabaseFn = createCandidateDatabase,
  restoreIntoCandidateFn = restoreIntoCandidate,
  verifyCandidateFn = verifyCandidate,
} = {}) {
  assertValidBackupPath(backupPath);
  const candidateName = generateCandidateDatabaseNameFn(sourceDbName);

  const stateOpts = { configPath: restoreStateConfigPath };

  // a prior, fully-finished restore cycle's own terminal outcome must not block this new,
  // independent one — see header comment. Deliberately still OUTSIDE the try/catch below,
  // same ownership rule as the idle->preparing transition right after it.
  advanceToIdleIfTerminal(stateOpts);

  // idle -> preparing. Deliberately NOT wrapped in the try/catch below — see header comment.
  transitionRestoreState('preparing', {
    restoreId,
    previousDb: sourceDbName,
    candidateDb: candidateName,
    startedAt: new Date().toISOString(),
    verificationStatus: 'pending',
    switchStatus: 'pending',
    rollbackStatus: 'pending',
    error: null,
  }, stateOpts);

  try {
    const adminUrl = readAdminCredentialFn({ configPath: adminConfigPath }); // the ONLY place this process reads it
    const { candidateUrl } = await createCandidateDatabaseFn({ adminUrl, candidateName, productionDbName: sourceDbName });

    transitionRestoreState('restoring', {}, stateOpts);
    await restoreIntoCandidateFn({ backupPath, candidateUrl, pgHome, legacyPgRoot });

    const verification = await verifyCandidateFn({ candidateUrl });
    transitionRestoreState('verified', { verificationStatus: 'completed' }, stateOpts);

    return {
      status: 'verified', restoreId, candidateDb: candidateName,
      tableCount: verification.tableCount,
    };
  } catch (err) {
    const message = redactErrorMessage(err);
    const safeErr = err instanceof RestoreOrchestratorError ? err
      : new RestoreOrchestratorError(err?.reason || 'restore_failed', message);

    try {
      transitionRestoreState('failed', { error: message }, stateOpts);
    } catch (stateErr) {
      throw new RestoreOrchestratorError(
        'restore_failed_and_state_update_failed',
        `${message} (كما فشل تسجيل حالة الفشل في restore-state.json: ${redactErrorMessage(stateErr)})`
      );
    }
    throw safeErr;
  }
}

// ── CLI entry point — mirrors backend/scripts/manageWindowsServices.js's own guard exactly ──
// Never accepts an admin connection string as an argument: any token shaped like a postgres(ql)
// :// URL is rejected outright before anything else is parsed. Only --backup-path and
// --restore-id are recognized.
export function parseCliArgs(argv) {
  // Every token — flag name AND value alike — is checked first, in one pass, before any flag
  // parsing happens. A connection-string-shaped VALUE (e.g. passed as `--backup-path`'s own
  // argument by mistake or by a malicious caller) must be rejected exactly like one passed as a
  // bare positional argument — checking only recognized flag names would miss that case.
  for (const token of argv) {
    if (/^postgres(?:ql)?:\/\//i.test(token)) {
      throw new RestoreOrchestratorError(
        'admin_url_in_cli_rejected',
        'رُفض: أحد معطيات سطر الأوامر يبدو كرابط اتصال PostgreSQL — هذه الأداة لا تقبل بيانات اعتماد إدارية عبر سطر الأوامر إطلاقاً؛ تُقرَأ حصراً من admin.env.'
      );
    }
  }

  const args = { backupPath: null, restoreId: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--backup-path') { args.backupPath = argv[i + 1]; i += 1; continue; }
    if (token === '--restore-id') { args.restoreId = argv[i + 1]; i += 1; }
  }
  return args;
}

async function main() {
  let args;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`❌ [${err.reason}] ${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (!args.backupPath) {
    console.error('الاستخدام: node restoreDatabase.js --backup-path <مسار ملف .dump> [--restore-id <معرّف>]');
    process.exitCode = 1;
    return;
  }

  try {
    const result = await runRestoreOrchestrator({
      backupPath: args.backupPath,
      ...(args.restoreId ? { restoreId: args.restoreId } : {}),
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } catch (err) {
    console.error(`❌ [${err.reason || 'unknown'}] ${err.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
