// backend/src/routes/backupStatus.test.js
// P1-1 — the admin-only, read-only routine backup status endpoint. Pure unit tests over the
// route's testable core plus static checks of its boundary (no DB connection, no admin.env, no
// request-controlled paths, admin-only mount).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { getBackupStatusSafe } from './backupStatus.js';
import { routineBackupFileName, resolveBackupStatusPath } from '../db/backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function codeOnly(source) {
  return source.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
}

describe('architecture', () => {
  const code = codeOnly(fs.readFileSync(path.join(__dirname, 'backupStatus.js'), 'utf8'));

  it('never opens a PostgreSQL connection, never reads admin.env, never runs a backup or deletes files', () => {
    expect(code).not.toMatch(/@prisma\/client|PrismaClient/);
    expect(code).not.toMatch(/readAdminCredential|admin\.env|provisioningAdminConfig/);
    expect(code).not.toMatch(/routineBackup\.js|runRoutineBackup|applyRetention|unlink/);
  });

  it('never reads anything from the request', () => {
    expect(code).not.toMatch(/req\.(query|body|params)/);
  });

  it('server.js mounts it behind requireAuth + requireRole(\'admin\')', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    expect(serverSource).toMatch(/app\.use\(['"]\/api\/backup-status['"],\s*requireAuth,\s*requireRole\('admin'\),\s*backupStatusRouter\)/);
  });
});

describe('getBackupStatusSafe', () => {
  let backupDir;
  beforeEach(() => {
    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-backup-status-test-'));
  });
  afterEach(() => {
    fs.rmSync(backupDir, { recursive: true, force: true });
  });

  it('reports schedule, retention, last run/success, and the verified backups (newest first)', () => {
    const older = routineBackupFileName(new Date('2026-09-24T03:00:00.000Z'));
    const newer = routineBackupFileName(new Date('2026-09-25T03:00:00.000Z'));
    fs.writeFileSync(path.join(backupDir, older), 'PGDMP1');
    fs.writeFileSync(path.join(backupDir, newer), 'PGDMP12');
    fs.writeFileSync(path.join(backupDir, 'notes.txt'), 'ignored');
    const run = {
      status: 'success', reason: null, startedAt: 'a', finishedAt: 'b', error: null,
      backup: { fileName: newer, sizeBytes: 7, verified: true },
      retention: { deleted: ['x'], keptCount: 2, errors: [] },
      unexpectedField: 'never surfaced',
    };
    fs.writeFileSync(resolveBackupStatusPath(backupDir), JSON.stringify({ lastRun: run, lastSuccess: run }));

    const status = getBackupStatusSafe({ backupDir, isScheduleRegisteredFn: () => true });

    expect(status.schedule).toEqual({ taskName: 'StudixDailyBackup', dailyAt: '03:00', registered: true });
    expect(status.retention).toEqual({ days: 14, minKeep: 7 });
    expect(status.statusReadable).toBe(true);
    expect(status.lastRun).toEqual({
      status: 'success', reason: null, startedAt: 'a', finishedAt: 'b', error: null,
      backup: { fileName: newer, sizeBytes: 7, verified: true }, retentionErrors: 0, retentionDeleted: 1,
    });
    expect(status.count).toBe(2);
    expect(status.totalSizeBytes).toBe(13);
    expect(status.backups.map((b) => b.fileName)).toEqual([newer, older]);
  });

  it('no backup has ever run -> nulls, not an error', () => {
    const status = getBackupStatusSafe({ backupDir, isScheduleRegisteredFn: () => false });
    expect(status.lastRun).toBeNull();
    expect(status.lastSuccess).toBeNull();
    expect(status.count).toBe(0);
    expect(status.schedule.registered).toBe(false);
  });

  it('a corrupt status file, an unreadable directory, or a failing schedule query are reported, never thrown', () => {
    const status = getBackupStatusSafe({
      backupDir,
      readBackupStatusFn: () => { throw new SyntaxError('bad json'); },
      listRoutineBackupsFn: () => { throw new Error('EACCES'); },
      isScheduleRegisteredFn: vi.fn(() => { throw new Error('schtasks missing'); }),
    });
    expect(status.statusReadable).toBe(false);
    expect(status.listError).toBeTruthy();
    expect(status.schedule.registered).toBeNull();
  });
});
