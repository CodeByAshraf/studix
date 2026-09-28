// backend/src/db/devResetBackup.js
// ─────────────────────────────────────────────────────────────
// Developer Data Reset — STEP 2: the verified pre-reset backup. Composes the existing backup
// infrastructure (db/backup.js: findPgDump, runPgDump, verifyBackupArchive, getBackupDir) and
// the existing process-level lock (db/restoreLock.js) with the step-1 core (db/devReset.js), so
// the destructive reset can never begin unless a fresh backup of the exact same database was
// written AND independently verified first. No CLI/HTTP/UI here (later steps).
//
// Order — every failure before step 5 means the reset is never invoked:
//   1. cheap refusals: exact confirmation phrase; DATABASE_URL must name the same database the
//      reset core is told to expect (the dump and the reset must be of the SAME database).
//   2. locks (all-or-nothing, fixed order, released in reverse in `finally`):
//        a. restore-state.lock  — the lock databaseSwitch.js holds while switching/rolling back
//        b. <backupDir>/.routine-backup.lock — the lock routineBackup.js holds while it runs
//      Both through the one existing primitive, acquireRestoreLock — no second lock system.
//      Holding both excludes a database switch/rollback and a routine backup for the whole
//      backup+reset window. The restore orchestrator (restoreDatabase.js) takes no lock of its
//      own: it only ever restores into a NEW candidate database (never the live one), and making
//      a candidate live is the switch step, which (a) excludes.
//   3. dump: pg_dump custom format into <backupDir>/dev-reset/pre-reset-<timestamp>.dump.partial
//   4. verify: verifyBackupArchive — PGDMP header + a full `pg_restore --list` of the archive,
//      requiring TABLE DATA for EVERY classified table (all 25 reset + 8 preserved), not just the
//      routine backup's default six. Only then is the file renamed to its final .dump name, so a
//      pre-reset-*.dump file always means "verified"; failures leave no final file behind.
//   5. reset: performDevReset(...) receives { path, verifiedAt } — the step-1 core still refuses
//      a missing/incomplete record on its own (unchanged).
//
// Location: pre-reset backups live in a dedicated dev-reset/ SUBDIRECTORY of the configured
// backup directory. Routine retention (routineBackup.js applyRetention) only ever considers
// direct children of the backup directory whose names match ROUTINE_BACKUP_FILENAME_RE
// (studix-backup-*.dump) plus its own stale studix-backup .partial files — a pre-reset backup is
// never listed, restored with --latest, or deleted by it.
//
// Recovery (existing tools only — no new restore logic):
//   1. node src/db/restoreDatabase.js --backup-path "<backupDir>\dev-reset\pre-reset-<ts>.dump"
//      restores the archive into a NEW, verified candidate database (reads admin.env for the
//      privileged connection; --latest would pick a ROUTINE backup, so always pass the path).
//   2. node src/db/databaseSwitch.js --action switch   promotes the verified candidate.
//   (For a developer database without admin.env, backup.js's restoreBackup(backupPath,
//   emptyTargetUrl) is the same underlying pg_restore step into an empty database.)
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import process from 'process';
import { URL } from 'url';
import { getBackupDir, findPgDump, findPgRestore, runPgDump, verifyBackupArchive } from './backup.js';
import { acquireRestoreLock, releaseRestoreLock, resolveRestoreLockPath } from './restoreLock.js';
import { resolveBackupLockPath } from './routineBackup.js';
import {
  performDevReset, RESET_TABLES, PRESERVE_TABLES, RESET_CONFIRMATION_PHRASE,
} from './devReset.js';

export const DEV_RESET_BACKUP_SUBDIR = 'dev-reset';
export const PRE_RESET_BACKUP_PREFIX = 'pre-reset-';
export const PRE_RESET_BACKUP_FILENAME_RE = /^pre-reset-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.dump$/;
// Every classified table must be present (with its TABLE DATA entry) in a pre-reset archive.
export const PRE_RESET_REQUIRED_TABLES = Object.freeze([...RESET_TABLES, ...PRESERVE_TABLES]);

export class DevResetBackupError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'DevResetBackupError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function resolveDevResetBackupDir(backupDir = getBackupDir()) {
  return path.join(backupDir, DEV_RESET_BACKUP_SUBDIR);
}

// UTC, same ISO-with-dashes style as routine/pre-migration backups, e.g.
// pre-reset-2026-09-28T10-15-30-123Z.dump
export function preResetBackupFileName(date) {
  return `${PRE_RESET_BACKUP_PREFIX}${date.toISOString().replace(/[:.]/g, '-')}.dump`;
}

function databaseNameOf(databaseUrl) {
  try {
    return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  } catch {
    return null;
  }
}

function removeQuietly(fsImpl, filePath) {
  try { fsImpl.unlinkSync(filePath); } catch { /* nothing to clean up, or already gone */ }
}

/**
 * Takes and verifies one pre-reset backup. Returns the verified-backup record the step-1 core
 * requires. Throws DevResetBackupError (backup_dir_unavailable | pg_dump_failed |
 * backup_verification_failed | backup_publish_failed) — never returns an unverified record.
 */
export function createVerifiedPreResetBackup({
  databaseUrl,
  backupDir = getBackupDir(),
  now = () => new Date(),
  fsImpl = fs,
  findPgDumpFn = findPgDump,
  findPgRestoreFn = findPgRestore,
  runPgDumpFn = runPgDump,
  verifyBackupArchiveFn = verifyBackupArchive,
} = {}) {
  const dir = resolveDevResetBackupDir(backupDir);
  const fileName = preResetBackupFileName(now());
  const finalPath = path.join(dir, fileName);
  const partialPath = `${finalPath}.partial`;

  try {
    fsImpl.mkdirSync(dir, { recursive: true });
    fsImpl.accessSync(dir, fs.constants.W_OK);
  } catch (err) {
    throw new DevResetBackupError('backup_dir_unavailable', `مجلد النسخة الاحتياطية قبل إعادة التعيين غير متاح للكتابة: ${dir} (${err.code || err.message})`);
  }

  try {
    runPgDumpFn({ pgDumpPath: findPgDumpFn(), databaseUrl, outPath: partialPath });
  } catch (err) {
    removeQuietly(fsImpl, partialPath);
    throw new DevResetBackupError('pg_dump_failed', `فشل أخذ النسخة الاحتياطية قبل إعادة التعيين — لم يُنفَّذ أي حذف: ${err.message}`);
  }

  let verification;
  try {
    verification = verifyBackupArchiveFn(partialPath, {
      pgRestorePath: findPgRestoreFn(),
      requiredTables: PRE_RESET_REQUIRED_TABLES,
      fsImpl,
    });
  } catch (err) {
    removeQuietly(fsImpl, partialPath);
    throw new DevResetBackupError('backup_verification_failed', `فشل التحقق من النسخة الاحتياطية قبل إعادة التعيين — لم يُنفَّذ أي حذف: ${err.message}`);
  }

  try {
    fsImpl.renameSync(partialPath, finalPath);
  } catch (err) {
    removeQuietly(fsImpl, partialPath);
    throw new DevResetBackupError('backup_publish_failed', `تعذّر نشر النسخة الاحتياطية المُتحقَّق منها: ${err.message}`);
  }

  return {
    path: finalPath,
    fileName,
    verifiedAt: now().toISOString(),
    sizeBytes: verification.sizeBytes,
    tableDataEntries: verification.tableDataEntries,
  };
}

function acquireLocks(locks, { pid, acquireLockFn, releaseLockFn }) {
  const held = [];
  try {
    for (const lock of locks) {
      acquireLockFn({ configPath: lock.path, pid });
      held.push(lock);
    }
  } catch (err) {
    releaseLocks(held, { pid, releaseLockFn });
    const lock = locks[held.length];
    throw new DevResetBackupError('lock_unavailable',
      `تعذّر الحصول على قفل ${lock.name} (${lock.path}) — عملية نسخ/استعادة/تبديل أخرى جارية أو القفل غير صالح؛ لم يُنفَّذ أي شيء: ${err.message}`,
      { lock: lock.name, reason: err.reason || err.code || null });
  }
  return held;
}

function releaseLocks(held, { pid, releaseLockFn }) {
  const errors = [];
  for (const lock of [...held].reverse()) {
    try { releaseLockFn({ configPath: lock.path, pid }); } catch (err) { errors.push({ lock: lock.name, error: err.message }); }
  }
  return errors;
}

/**
 * The full guarded sequence: refuse early → take both existing locks → verified backup →
 * step-1 reset. Returns { backup, reset, lockReleaseErrors }. On any failure before the reset,
 * performDevReset is never called and nothing in the database has changed.
 */
export async function runDevResetWithVerifiedBackup({
  prisma,
  databaseUrl,
  expectedDatabaseName,
  confirmation,
  actor = null,
  backupDir = getBackupDir(),
  restoreLockPath = resolveRestoreLockPath(),
  backupLockPath = resolveBackupLockPath(backupDir),
  pid = process.pid,
  acquireLockFn = acquireRestoreLock,
  releaseLockFn = releaseRestoreLock,
  createBackupFn = createVerifiedPreResetBackup,
  performResetFn = performDevReset,
  backupOptions = {},
} = {}) {
  if (confirmation !== RESET_CONFIRMATION_PHRASE) {
    throw new DevResetBackupError('confirmation_mismatch', `عبارة التأكيد يجب أن تكون حرفياً: ${RESET_CONFIRMATION_PHRASE}`);
  }
  if (typeof expectedDatabaseName !== 'string' || !expectedDatabaseName.trim()) {
    throw new DevResetBackupError('database_name_required', 'اسم قاعدة البيانات المتوقَّعة مطلوب صراحةً.');
  }
  const urlDatabaseName = databaseNameOf(databaseUrl);
  if (urlDatabaseName !== expectedDatabaseName) {
    throw new DevResetBackupError('database_url_mismatch',
      `DATABASE_URL يشير إلى "${urlDatabaseName}" لا إلى القاعدة المتوقَّعة "${expectedDatabaseName}" — يجب نسخ نفس القاعدة التي ستُعاد تهيئتها.`);
  }

  const held = acquireLocks([
    { name: 'restore-state.lock', path: restoreLockPath },
    { name: '.routine-backup.lock', path: backupLockPath },
  ], { pid, acquireLockFn, releaseLockFn });

  let backup;
  let reset;
  let lockReleaseErrors = [];
  try {
    backup = createBackupFn({ databaseUrl, backupDir, ...backupOptions });
    reset = await performResetFn(prisma, {
      expectedDatabaseName,
      confirmation,
      verifiedBackup: backup,
      actor,
    });
  } finally {
    // Released whether the backup or the reset failed; a verified backup file is never deleted.
    lockReleaseErrors = releaseLocks(held, { pid, releaseLockFn });
  }
  return { backup, reset, lockReleaseErrors };
}
