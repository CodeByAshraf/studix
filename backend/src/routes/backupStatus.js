// backend/src/routes/backupStatus.js
// ─────────────────────────────────────────────────────────────
// P1-1 — read-only, admin-only view of the routine database backup (db/routineBackup.js, run by
// the StudixDailyBackup Scheduled Task). Mounted in server.js behind requireAuth +
// requireRole('admin'), same guard as /api/db-switch and /api/db-identity.
//
// This route never takes a backup, never deletes anything, never opens a PostgreSQL connection
// and never reads admin.env: it only reads the status file routineBackup.js writes, lists the
// routine backup files (backup.js's strict-name listing), and asks Task Scheduler whether the
// schedule is registered. It reads nothing from the request — the client cannot point it at
// another directory or file.
// ─────────────────────────────────────────────────────────────
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  getBackupDir, listRoutineBackups, readBackupStatus, DEFAULT_RETENTION_DAYS, DEFAULT_MIN_KEEP,
} from '../db/backup.js';
import {
  queryStartupTaskXml, STUDIX_BACKUP_TASK_NAME, STUDIX_BACKUP_TASK_TIME,
} from '../lib/scheduledTask.js';

const RUN_FIELDS = ['status', 'reason', 'startedAt', 'finishedAt', 'error'];

function pickRun(run) {
  if (!run || typeof run !== 'object') return null;
  const out = {};
  for (const key of RUN_FIELDS) out[key] = typeof run[key] === 'string' ? run[key] : null;
  out.backup = run.backup && typeof run.backup.fileName === 'string'
    ? { fileName: run.backup.fileName, sizeBytes: Number(run.backup.sizeBytes) || 0, verified: run.backup.verified === true }
    : null;
  out.retentionErrors = Array.isArray(run.retention?.errors) ? run.retention.errors.length : 0;
  out.retentionDeleted = Array.isArray(run.retention?.deleted) ? run.retention.deleted.length : 0;
  return out;
}

/**
 * getBackupStatusSafe: the route's testable core. Never throws for an unreadable status file or
 * backups directory — those are reported in the response (`statusReadable`, `listError`), so the
 * Settings page can show "backup status unknown" instead of a generic failure.
 */
export function getBackupStatusSafe({
  backupDir = getBackupDir(),
  readBackupStatusFn = readBackupStatus,
  listRoutineBackupsFn = listRoutineBackups,
  isScheduleRegisteredFn = () => queryStartupTaskXml(STUDIX_BACKUP_TASK_NAME) !== null,
} = {}) {
  let status = null;
  let statusReadable = true;
  try {
    status = readBackupStatusFn({ backupDir });
  } catch {
    statusReadable = false;
  }

  let backups = [];
  let listError = null;
  try {
    backups = listRoutineBackupsFn({ backupDir });
  } catch {
    listError = 'تعذّر قراءة مجلد النسخ الاحتياطية.';
  }

  let scheduleRegistered = null;
  try {
    scheduleRegistered = !!isScheduleRegisteredFn();
  } catch {
    scheduleRegistered = null;
  }

  return {
    backupDir,
    schedule: { taskName: STUDIX_BACKUP_TASK_NAME, dailyAt: STUDIX_BACKUP_TASK_TIME.slice(0, 5), registered: scheduleRegistered },
    retention: { days: DEFAULT_RETENTION_DAYS, minKeep: DEFAULT_MIN_KEEP },
    statusReadable,
    lastRun: pickRun(status?.lastRun),
    lastSuccess: pickRun(status?.lastSuccess),
    listError,
    count: backups.length,
    totalSizeBytes: backups.reduce((sum, b) => sum + b.sizeBytes, 0),
    backups: backups.slice(0, 50).map((b) => ({
      fileName: b.fileName, createdAt: b.createdAt.toISOString(), sizeBytes: b.sizeBytes,
    })),
  };
}

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  res.json({ ok: true, ...getBackupStatusSafe() });
}));

export default router;
