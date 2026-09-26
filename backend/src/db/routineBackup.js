// backend/src/db/routineBackup.js
// ─────────────────────────────────────────────────────────────
// P1-1 — the routine, verified, full database backup. Run once a day by the StudixDailyBackup
// Scheduled Task (lib/scheduledTask.js's ensureBackupTask, registered by the installer), as
// SYSTEM, independent of StudixApp and of the UI. Can also be run manually by an administrator:
//
//   node backend\src\db\routineBackup.js                 take a backup now (same as the task)
//   node backend\src\db\routineBackup.js --list          list routine backups (newest first)
//   node backend\src\db\routineBackup.js --verify <file> structurally verify one archive
//
// Reuses — never duplicates — the existing backup/restore architecture:
//   * backup.js's findPgDump/findPgRestore (bundled PostgreSQL binaries), runPgDump (the same
//     pg_dump -F c invocation the pre-migration backup uses) and verifyBackupArchive;
//   * restoreDatabase.js's readAdminCredential (admin.env — OD3: read only by short-lived
//     elevated processes such as this one, never by StudixApp), redactErrorMessage,
//     withDatabaseName and PRODUCTION_DATABASE_NAME;
//   * startupOrchestrator.js's waitForPostgresReady (the same readiness signal as boot);
//   * restoreLock.js's atomic, stale-pid-aware lock — on its OWN lock file in the backups
//     directory, so a backup never contends with the restore/switch lock;
//   * restoreState.js — a backup is skipped (not failed) while a database switch or rollback is
//     renaming databases;
//   * atomicJsonFile.js for the status file the Settings page reads.
//
// One run: lock -> (switch in progress? skip) -> wait for PostgreSQL -> pg_dump to
// "<final name>.partial" -> verify the .partial (non-empty, PGDMP header, pg_restore --list,
// TABLE DATA for the core tables) -> atomic rename to the final name -> retention -> status.
// A file with the final name therefore only ever exists once it has been verified.
//
// Retention (applyRetention) runs ONLY after this run produced a verified backup — a failed run
// never deletes anything. It keeps every backup younger than retentionDays, and always the
// newest minKeep backups regardless of age (so the newest valid backup is never deleted, even on
// a machine that was off for weeks). It only ever deletes regular files whose names match
// ROUTINE_BACKUP_FILENAME_RE exactly (plus this module's own abandoned "*.dump.partial" files
// older than a day). A deletion failure makes the run a 'warning' (exit code 2), never a silent
// success.
//
// Credentials: the admin URL is handed to pg_dump through environment variables (backup.js's
// pgConnectionEnv), never argv; every error message is passed through redactErrorMessage before
// it is logged, printed, or written to the status file.
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import {
  findPgDump, findPgRestore, getBackupDir, runPgDump, verifyBackupArchive,
  listRoutineBackups, routineBackupFileName, ROUTINE_BACKUP_FILENAME_RE,
  resolveBackupStatusPath, readBackupStatus, DEFAULT_RETENTION_DAYS, DEFAULT_MIN_KEEP,
} from './backup.js';
import {
  readAdminCredential, redactErrorMessage, withDatabaseName, PRODUCTION_DATABASE_NAME,
} from './restoreDatabase.js';
import { waitForPostgresReady } from './startupOrchestrator.js';
import { acquireRestoreLock, releaseRestoreLock, RestoreLockError } from './restoreLock.js';
import { readRestoreState } from './restoreState.js';
import { writeJsonFileAtomic } from './atomicJsonFile.js';
import logger from '../lib/logger.js';

export { DEFAULT_RETENTION_DAYS, DEFAULT_MIN_KEEP };
export const STALE_PARTIAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Longer than boot's 60 s: after a missed schedule, Task Scheduler starts this right after boot.
export const POSTGRES_READY_TIMEOUT_MS = 5 * 60 * 1000;
export const LOCK_FILE_NAME = '.routine-backup.lock';

const PARTIAL_SUFFIX = '.partial';
const DAY_MS = 24 * 60 * 60 * 1000;
const SWITCHING_STATUSES = new Set(['switching', 'rolling_back']);

export const EXIT_CODES = Object.freeze({ success: 0, skipped: 0, failed: 1, warning: 2 });

export function resolveBackupLockPath(backupDir = getBackupDir()) {
  return path.join(backupDir, LOCK_FILE_NAME);
}

// ── retention ─────────────────────────────────────────────────────────────────────────────
/**
 * planRetention: pure. `backups` is listRoutineBackups()'s output (newest first). Returns which
 * to keep and which to delete. The newest `minKeep` (at least 1) are always kept; any other
 * backup is kept while younger than `retentionDays`.
 */
export function planRetention(backups, {
  now = new Date(), retentionDays = DEFAULT_RETENTION_DAYS, minKeep = DEFAULT_MIN_KEEP,
} = {}) {
  const keepCount = Math.max(1, minKeep);
  const cutoff = now.getTime() - retentionDays * DAY_MS;
  const sorted = [...backups].sort((a, b) => b.createdAt - a.createdAt);
  const keep = [];
  const remove = [];
  sorted.forEach((b, index) => {
    if (index < keepCount || b.createdAt.getTime() >= cutoff) keep.push(b);
    else remove.push(b);
  });
  return { keep, delete: remove };
}

/**
 * applyRetention: deletes what planRetention selects, plus this module's own abandoned
 * ".partial" files older than STALE_PARTIAL_MAX_AGE_MS. `protectFileName` (the backup this run
 * just verified) is never deleted, whatever the plan says. Every candidate is re-checked
 * immediately before deletion: exact name match, a direct child of backupDir, a regular file.
 * Never throws for a single file — failures are collected in `errors`.
 */
export function applyRetention({
  backupDir = getBackupDir(),
  now = new Date(),
  retentionDays = DEFAULT_RETENTION_DAYS,
  minKeep = DEFAULT_MIN_KEEP,
  protectFileName = null,
  fsImpl = fs,
} = {}) {
  const deleted = [];
  const errors = [];
  const backups = listRoutineBackups({ backupDir, fsImpl });
  const plan = planRetention(backups, { now, retentionDays, minKeep });

  const safeUnlink = (fileName, isAllowedName) => {
    if (!isAllowedName(fileName) || fileName === protectFileName || path.basename(fileName) !== fileName) return;
    const filePath = path.join(backupDir, fileName);
    try {
      const stat = fsImpl.lstatSync(filePath);
      if (!stat.isFile()) return;
      fsImpl.unlinkSync(filePath);
      deleted.push(fileName);
    } catch (err) {
      if (err.code === 'ENOENT') return;
      errors.push({ fileName, error: err.message });
    }
  };

  for (const b of plan.delete) {
    safeUnlink(b.fileName, (n) => ROUTINE_BACKUP_FILENAME_RE.test(n));
  }

  let names = [];
  try {
    names = fsImpl.readdirSync(backupDir);
  } catch (err) {
    errors.push({ fileName: null, error: err.message });
  }
  const isPartialName = (n) => n.endsWith(PARTIAL_SUFFIX)
    && ROUTINE_BACKUP_FILENAME_RE.test(n.slice(0, -PARTIAL_SUFFIX.length));
  for (const name of names) {
    if (!isPartialName(name)) continue;
    try {
      const stat = fsImpl.lstatSync(path.join(backupDir, name));
      if (!stat.isFile() || now.getTime() - stat.mtimeMs < STALE_PARTIAL_MAX_AGE_MS) continue;
    } catch {
      continue;
    }
    safeUnlink(name, isPartialName);
  }

  return {
    deleted,
    errors,
    kept: plan.keep.map((b) => b.fileName).filter((n) => !deleted.includes(n)),
  };
}

// ── one run ───────────────────────────────────────────────────────────────────────────────
function writeStatus(backupDir, lastRun, { fsImpl }) {
  let previous = null;
  try {
    previous = readBackupStatus({ backupDir, fsImpl });
  } catch {
    previous = null; // a corrupt status file is simply replaced — it only mirrors the log
  }
  const next = {
    lastRun,
    lastSuccess: (lastRun.status === 'success' || lastRun.status === 'warning')
      ? lastRun
      : (previous && previous.lastSuccess) || null,
  };
  writeJsonFileAtomic(resolveBackupStatusPath(backupDir), next);
}

/**
 * runRoutineBackup: one complete run. Never throws for an operational failure — always returns
 * { status: 'success' | 'warning' | 'failed' | 'skipped', reason, ... } and records it in the
 * status file and the log. Every dependency is injectable for tests.
 */
export async function runRoutineBackup({
  backupDir = getBackupDir(),
  adminConfigPath,
  restoreStateConfigPath,
  sourceDbName = PRODUCTION_DATABASE_NAME,
  retentionDays = DEFAULT_RETENTION_DAYS,
  minKeep = DEFAULT_MIN_KEEP,
  pgHome,
  legacyPgRoot,
  postgresReadyTimeoutMs = POSTGRES_READY_TIMEOUT_MS,
  now = () => new Date(),
  pid = process.pid,
  fsImpl = fs,
  log = logger,
  readAdminCredentialFn = readAdminCredential,
  waitForPostgresReadyFn = waitForPostgresReady,
  readRestoreStateFn = readRestoreState,
  findPgDumpFn = findPgDump,
  findPgRestoreFn = findPgRestore,
  runPgDumpFn = runPgDump,
  verifyBackupArchiveFn = verifyBackupArchive,
  applyRetentionFn = applyRetention,
  acquireLockFn = acquireRestoreLock,
  releaseLockFn = releaseRestoreLock,
} = {}) {
  const startedAt = now();
  fsImpl.mkdirSync(backupDir, { recursive: true });
  const lockPath = resolveBackupLockPath(backupDir);

  try {
    acquireLockFn({ configPath: lockPath, pid });
  } catch (err) {
    if (err instanceof RestoreLockError && err.reason === 'lock_held') {
      // Another run is in progress and will record its own result — do not touch the status file.
      log.warn('النسخ الاحتياطي الدوري: تم التخطّي — عملية نسخ أخرى جارية بالفعل.', { reason: 'already_running' });
      return { status: 'skipped', reason: 'already_running' };
    }
    const message = redactErrorMessage(err);
    log.error(`النسخ الاحتياطي الدوري: فشل — تعذّر الحصول على قفل النسخ (${lockPath}): ${message}`);
    const lastRun = { status: 'failed', reason: 'lock_failed', startedAt: startedAt.toISOString(), finishedAt: now().toISOString(), error: message };
    try { writeStatus(backupDir, lastRun, { fsImpl }); } catch { /* reported via the log/exit code already */ }
    return lastRun;
  }

  let result;
  try {
    result = await runLocked();
  } finally {
    try {
      releaseLockFn({ configPath: lockPath, pid });
    } catch (err) {
      log.warn(`النسخ الاحتياطي الدوري: تعذّر تحرير القفل ${lockPath}: ${redactErrorMessage(err)}`);
    }
  }
  return result;

  async function runLocked() {
    const base = { startedAt: startedAt.toISOString() };
    const finish = (lastRun) => {
      const record = { ...base, ...lastRun, finishedAt: now().toISOString() };
      try {
        writeStatus(backupDir, record, { fsImpl });
      } catch (err) {
        const message = redactErrorMessage(err);
        log.error(`النسخ الاحتياطي الدوري: تعذّرت كتابة ملف الحالة: ${message}`);
        if (record.status === 'success') {
          return { ...record, status: 'warning', reason: 'status_write_failed', statusError: message };
        }
      }
      return record;
    };

    // 1. never race a database switch/rollback (it renames the production database).
    try {
      const state = readRestoreStateFn({ configPath: restoreStateConfigPath });
      if (SWITCHING_STATUSES.has(state.status)) {
        log.warn(`النسخ الاحتياطي الدوري: تم التخطّي — تبديل قاعدة البيانات جارٍ (restore-state: ${state.status}).`);
        return finish({ status: 'skipped', reason: 'database_switch_in_progress' });
      }
    } catch (err) {
      // An unreadable restore state does not make a backup unsafe — back up anyway, but say so.
      log.warn(`النسخ الاحتياطي الدوري: تعذّرت قراءة restore-state.json (${redactErrorMessage(err)}) — المتابعة بالنسخ.`);
    }

    // 2. PostgreSQL must be accepting connections.
    const ready = await waitForPostgresReadyFn({
      readAdminCredentialFn, adminConfigPath, timeoutMs: postgresReadyTimeoutMs,
    });
    if (!ready.ready) {
      const message = `PostgreSQL غير متاح (${ready.error || 'انتهت مهلة الانتظار'}).`;
      log.error(`النسخ الاحتياطي الدوري: فشل — ${message}`);
      return finish({ status: 'failed', reason: 'postgres_unavailable', error: message });
    }

    // 3. dump to a .partial file, verify it, then publish it under its final name.
    const fileName = routineBackupFileName(startedAt);
    const finalPath = path.join(backupDir, fileName);
    const partialPath = `${finalPath}${PARTIAL_SUFFIX}`;
    let verification;
    try {
      if (fsImpl.existsSync(finalPath) || fsImpl.existsSync(partialPath)) {
        throw new Error(`يوجد ملف بالاسم نفسه بالفعل (${fileName}) — رُفض الكتابة فوقه.`);
      }
      const adminUrl = readAdminCredentialFn({ configPath: adminConfigPath });
      const databaseUrl = withDatabaseName(adminUrl, sourceDbName);
      const pgDumpPath = findPgDumpFn(pgHome, legacyPgRoot);
      const pgRestorePath = findPgRestoreFn(pgHome, legacyPgRoot);

      try {
        runPgDumpFn({ pgDumpPath, databaseUrl, outPath: partialPath });
      } catch (err) {
        err.backupStage = 'dump_failed';
        throw err;
      }
      try {
        verification = verifyBackupArchiveFn(partialPath, { pgRestorePath });
      } catch (err) {
        err.backupStage = 'verification_failed';
        throw err;
      }
      fsImpl.renameSync(partialPath, finalPath);
    } catch (err) {
      try { fsImpl.unlinkSync(partialPath); } catch { /* absent, or cleaned up by a later run */ }
      const message = redactErrorMessage(err);
      const reason = err.backupStage || 'backup_failed';
      log.error(`النسخ الاحتياطي الدوري: فشل (${reason}) — ${message}`);
      return finish({ status: 'failed', reason, error: message });
    }
    log.info(`النسخ الاحتياطي الدوري: تم إنشاء نسخة والتحقّق منها: ${fileName}`, {
      fileName, sizeBytes: verification.sizeBytes, tableDataEntries: verification.tableDataEntries,
    });

    // 4. retention — only now that a new verified backup exists.
    let retention;
    try {
      retention = applyRetentionFn({
        backupDir, now: now(), retentionDays, minKeep, protectFileName: fileName, fsImpl,
      });
    } catch (err) {
      retention = { deleted: [], kept: [], errors: [{ fileName: null, error: err.message }] };
    }
    const retentionErrors = retention.errors.map((e) => ({ fileName: e.fileName, error: redactErrorMessage(e.error) }));
    if (retention.deleted.length) {
      log.info(`النسخ الاحتياطي الدوري: حُذفت نسخ منتهية الصلاحية: ${retention.deleted.join(', ')}`);
    }

    const backup = { fileName, sizeBytes: verification.sizeBytes, verified: true };
    const retentionSummary = { deleted: retention.deleted, keptCount: retention.kept.length, errors: retentionErrors };
    if (retentionErrors.length) {
      log.error(`النسخ الاحتياطي الدوري: النسخة نجحت لكن تنظيف النسخ القديمة فشل جزئياً: ${JSON.stringify(retentionErrors)}`);
      return finish({ status: 'warning', reason: 'retention_failed', backup, retention: retentionSummary });
    }
    return finish({ status: 'success', reason: null, backup, retention: retentionSummary });
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────
export function parseRoutineBackupArgs(argv) {
  for (const token of argv) {
    if (/^postgres(?:ql)?:\/\//i.test(token)) {
      throw new Error('رُفض: هذه الأداة لا تقبل روابط اتصال PostgreSQL عبر سطر الأوامر — بيانات الاعتماد تُقرَأ حصراً من admin.env.');
    }
  }
  if (argv.length === 0) return { mode: 'run' };
  if (argv.length === 1 && argv[0] === '--list') return { mode: 'list' };
  if (argv.length === 2 && argv[0] === '--verify' && argv[1]) return { mode: 'verify', file: argv[1] };
  throw new Error('الاستخدام: node routineBackup.js [--list | --verify <ملف .dump>]');
}

async function main() {
  let args;
  try {
    args = parseRoutineBackupArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (args.mode === 'list') {
    const backups = listRoutineBackups().map((b) => ({ ...b, createdAt: b.createdAt.toISOString() }));
    console.log(JSON.stringify({ backupDir: getBackupDir(), backups }, null, 2));
    return;
  }

  if (args.mode === 'verify') {
    try {
      const result = verifyBackupArchive(path.resolve(args.file), { pgRestorePath: findPgRestore() });
      console.log(JSON.stringify({ ok: true, file: path.resolve(args.file), ...result }, null, 2));
    } catch (err) {
      console.error(`❌ ${redactErrorMessage(err)}`);
      process.exitCode = 1;
    }
    return;
  }

  const result = await runRoutineBackup();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = EXIT_CODES[result.status] ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`❌ ${redactErrorMessage(err)}`);
    process.exitCode = 1;
  });
}
