// backend/src/db/devResetBackup.test.js
// Developer Data Reset — STEP 2 (verified pre-reset backup). Unit tests, no database: pg_dump,
// pg_restore and the locks are injected fakes; directory and retention behavior use real
// temporary folders. Proves the reset core is never invoked unless the backup was written AND
// verified under both existing locks, and that routine retention never targets pre-reset files.
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createVerifiedPreResetBackup, runDevResetWithVerifiedBackup, preResetBackupFileName,
  resolveDevResetBackupDir, DEV_RESET_BACKUP_SUBDIR, PRE_RESET_BACKUP_FILENAME_RE,
  PRE_RESET_REQUIRED_TABLES, DevResetBackupError,
} from './devResetBackup.js';
import { performDevReset, RESET_TABLES, PRESERVE_TABLES, RESET_CONFIRMATION_PHRASE } from './devReset.js';
import { ROUTINE_BACKUP_FILENAME_RE, listRoutineBackups } from './backup.js';
import { applyRetention } from './routineBackup.js';

const tempDirs = [];
function tempBackupDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-devreset-test-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

const FIXED_NOW = new Date('2026-09-28T10:15:30.123Z');
const DB_URL = 'postgresql://postgres@127.0.0.1:55499/studix_dev';

// Fakes that behave like the real tools: pg_dump writes a file, verification reads it.
function fakeTools({ dumpFails = false, verifyFails = false } = {}) {
  return {
    findPgDumpFn: vi.fn(() => 'pg_dump.exe'),
    findPgRestoreFn: vi.fn(() => 'pg_restore.exe'),
    runPgDumpFn: vi.fn(({ outPath }) => {
      if (dumpFails) {
        fs.writeFileSync(outPath, 'half-written');
        throw new Error('pg_dump فشل: connection refused');
      }
      fs.writeFileSync(outPath, 'PGDMP fake archive');
    }),
    verifyBackupArchiveFn: vi.fn(() => {
      if (verifyFails) throw new Error('الأرشيف لا يحتوي بيانات الجداول المتوقَّعة: payments');
      return { sizeBytes: 18, tableDataEntries: 33 };
    }),
  };
}

function fakeLocks({ failOn = null } = {}) {
  const held = new Set();
  const events = [];
  return {
    events,
    held,
    acquireLockFn: vi.fn(({ configPath }) => {
      if (failOn && configPath.endsWith(failOn)) {
        throw Object.assign(new Error('lock held by pid 999'), { reason: 'lock_held' });
      }
      held.add(configPath);
      events.push(`acquire:${path.basename(configPath)}`);
    }),
    releaseLockFn: vi.fn(({ configPath }) => {
      held.delete(configPath);
      events.push(`release:${path.basename(configPath)}`);
    }),
  };
}

function baseArgs(backupDir, overrides = {}) {
  return {
    prisma: {},
    databaseUrl: DB_URL,
    expectedDatabaseName: 'studix_dev',
    confirmation: RESET_CONFIRMATION_PHRASE,
    actor: { id: 'admin', name: 'Admin' },
    backupDir,
    restoreLockPath: path.join(backupDir, 'restore-state.lock'),
    backupLockPath: path.join(backupDir, '.routine-backup.lock'),
    ...overrides,
  };
}

describe('pre-reset backup location and name', () => {
  it('lives in <backupDir>/dev-reset/ as pre-reset-<UTC timestamp>.dump', () => {
    expect(DEV_RESET_BACKUP_SUBDIR).toBe('dev-reset');
    expect(resolveDevResetBackupDir('C:\\ProgramData\\Studix\\backups')).toBe(path.join('C:\\ProgramData\\Studix\\backups', 'dev-reset'));
    const name = preResetBackupFileName(FIXED_NOW);
    expect(name).toBe('pre-reset-2026-09-28T10-15-30-123Z.dump');
    expect(PRE_RESET_BACKUP_FILENAME_RE.test(name)).toBe(true);
  });

  it('is outside the routine studix-backup-* namespace', () => {
    expect(ROUTINE_BACKUP_FILENAME_RE.test(preResetBackupFileName(FIXED_NOW))).toBe(false);
  });

  it('routine retention never lists or deletes pre-reset backups (real folder, real applyRetention)', () => {
    const backupDir = tempBackupDir();
    const devResetDir = resolveDevResetBackupDir(backupDir);
    fs.mkdirSync(devResetDir);
    const old = new Date('2020-01-01T00:00:00.000Z');
    const routineNames = [
      'studix-backup-2020-01-01T00-00-00-000Z.dump',
      'studix-backup-2020-01-02T00-00-00-000Z.dump',
      'studix-backup-2020-01-03T00-00-00-000Z.dump',
    ];
    for (const n of routineNames) fs.writeFileSync(path.join(backupDir, n), 'x');
    const preResetInSubdir = path.join(devResetDir, preResetBackupFileName(old));
    const preResetTopLevel = path.join(backupDir, preResetBackupFileName(old)); // even a misplaced one
    fs.writeFileSync(preResetInSubdir, 'x');
    fs.writeFileSync(preResetTopLevel, 'x');

    expect(listRoutineBackups({ backupDir }).map((b) => b.fileName).sort()).toEqual(routineNames);
    const result = applyRetention({ backupDir, now: new Date('2026-09-28T00:00:00.000Z'), retentionDays: 1, minKeep: 1 });

    expect(result.deleted.length).toBe(2); // two oldest routine backups (minKeep 1)
    expect(result.deleted.every((n) => n.startsWith('studix-backup-'))).toBe(true);
    expect(fs.existsSync(preResetInSubdir)).toBe(true);
    expect(fs.existsSync(preResetTopLevel)).toBe(true);
  });
});

describe('createVerifiedPreResetBackup', () => {
  it('success: dumps, verifies against ALL 33 classified tables, publishes the final file, returns the record', () => {
    const backupDir = tempBackupDir();
    const tools = fakeTools();
    const record = createVerifiedPreResetBackup({ databaseUrl: DB_URL, backupDir, now: () => FIXED_NOW, ...tools });

    const expectedPath = path.join(backupDir, 'dev-reset', 'pre-reset-2026-09-28T10-15-30-123Z.dump');
    expect(record).toMatchObject({ path: expectedPath, fileName: 'pre-reset-2026-09-28T10-15-30-123Z.dump', verifiedAt: FIXED_NOW.toISOString() });
    expect(fs.existsSync(expectedPath)).toBe(true);
    expect(fs.existsSync(`${expectedPath}.partial`)).toBe(false);

    expect(tools.runPgDumpFn).toHaveBeenCalledWith({ pgDumpPath: 'pg_dump.exe', databaseUrl: DB_URL, outPath: `${expectedPath}.partial` });
    const [verifiedPath, verifyOpts] = tools.verifyBackupArchiveFn.mock.calls[0];
    expect(verifiedPath).toBe(`${expectedPath}.partial`);
    expect(verifyOpts.pgRestorePath).toBe('pg_restore.exe');
    expect([...verifyOpts.requiredTables].sort()).toEqual([...RESET_TABLES, ...PRESERVE_TABLES].sort());
    expect(PRE_RESET_REQUIRED_TABLES).toHaveLength(33);
  });

  it('pg_dump failure → pg_dump_failed, no final file and no partial left', () => {
    const backupDir = tempBackupDir();
    const tools = fakeTools({ dumpFails: true });
    expect(() => createVerifiedPreResetBackup({ databaseUrl: DB_URL, backupDir, now: () => FIXED_NOW, ...tools }))
      .toThrow(expect.objectContaining({ code: 'pg_dump_failed' }));
    expect(fs.readdirSync(resolveDevResetBackupDir(backupDir))).toEqual([]);
    expect(tools.verifyBackupArchiveFn).not.toHaveBeenCalled();
  });

  it('verification failure → backup_verification_failed, no final file and no partial left', () => {
    const backupDir = tempBackupDir();
    const tools = fakeTools({ verifyFails: true });
    expect(() => createVerifiedPreResetBackup({ databaseUrl: DB_URL, backupDir, now: () => FIXED_NOW, ...tools }))
      .toThrow(expect.objectContaining({ code: 'backup_verification_failed' }));
    expect(fs.readdirSync(resolveDevResetBackupDir(backupDir))).toEqual([]);
  });

  it('an unusable backup directory → backup_dir_unavailable, pg_dump never runs', () => {
    const backupDir = tempBackupDir();
    const blocker = path.join(backupDir, 'not-a-dir');
    fs.writeFileSync(blocker, 'x'); // a FILE where the backup directory should be
    const tools = fakeTools();
    expect(() => createVerifiedPreResetBackup({ databaseUrl: DB_URL, backupDir: blocker, ...tools }))
      .toThrow(expect.objectContaining({ code: 'backup_dir_unavailable' }));
    expect(tools.runPgDumpFn).not.toHaveBeenCalled();
  });
});

describe('runDevResetWithVerifiedBackup — the reset never runs unless a verified backup exists', () => {
  function withTools(backupDir, tools) {
    return (opts) => createVerifiedPreResetBackup({ ...opts, now: () => FIXED_NOW, ...tools });
  }

  it('success: both locks → verified backup → reset receives the verified record → locks released in reverse', async () => {
    const backupDir = tempBackupDir();
    const locks = fakeLocks();
    const performResetFn = vi.fn(async () => ({ databaseName: 'studix_dev', usersInvalidated: 1 }));

    const result = await runDevResetWithVerifiedBackup({
      ...baseArgs(backupDir), ...locks, createBackupFn: withTools(backupDir, fakeTools()), performResetFn,
    });

    expect(performResetFn).toHaveBeenCalledTimes(1);
    const [prismaArg, resetOpts] = performResetFn.mock.calls[0];
    expect(prismaArg).toEqual({});
    expect(resetOpts).toMatchObject({ expectedDatabaseName: 'studix_dev', confirmation: RESET_CONFIRMATION_PHRASE, actor: { id: 'admin', name: 'Admin' } });
    expect(resetOpts.verifiedBackup).toBe(result.backup);
    expect(fs.existsSync(result.backup.path)).toBe(true);
    expect(locks.events).toEqual([
      'acquire:restore-state.lock', 'acquire:.routine-backup.lock',
      'release:.routine-backup.lock', 'release:restore-state.lock',
    ]);
    expect(locks.held.size).toBe(0);
  });

  it.each([
    ['pg_dump failure', { dumpFails: true }, 'pg_dump_failed'],
    ['archive verification failure', { verifyFails: true }, 'backup_verification_failed'],
  ])('%s → reset never invoked, locks released', async (_label, toolOpts, code) => {
    const backupDir = tempBackupDir();
    const locks = fakeLocks();
    const performResetFn = vi.fn();
    await expect(runDevResetWithVerifiedBackup({
      ...baseArgs(backupDir), ...locks, createBackupFn: withTools(backupDir, fakeTools(toolOpts)), performResetFn,
    })).rejects.toMatchObject({ code });
    expect(performResetFn).not.toHaveBeenCalled();
    expect(locks.held.size).toBe(0);
  });

  it('backup directory failure → reset never invoked', async () => {
    const backupDir = tempBackupDir();
    const blocker = path.join(backupDir, 'not-a-dir');
    fs.writeFileSync(blocker, 'x');
    const locks = fakeLocks();
    const performResetFn = vi.fn();
    await expect(runDevResetWithVerifiedBackup({
      ...baseArgs(backupDir), ...locks, backupDir: blocker, createBackupFn: withTools(blocker, fakeTools()), performResetFn,
    })).rejects.toMatchObject({ code: 'backup_dir_unavailable' });
    expect(performResetFn).not.toHaveBeenCalled();
    expect(locks.held.size).toBe(0);
  });

  it.each([
    ['restore-state lock held (switch/restore in progress)', 'restore-state.lock', 'restore-state.lock'],
    ['routine-backup lock held (routine backup running)', '.routine-backup.lock', '.routine-backup.lock'],
  ])('%s → no backup, no reset, nothing left held', async (_label, failOn, lockName) => {
    const backupDir = tempBackupDir();
    const locks = fakeLocks({ failOn });
    const createBackupFn = vi.fn();
    const performResetFn = vi.fn();
    await expect(runDevResetWithVerifiedBackup({ ...baseArgs(backupDir), ...locks, createBackupFn, performResetFn }))
      .rejects.toMatchObject({ code: 'lock_unavailable', details: { lock: lockName, reason: 'lock_held' } });
    expect(createBackupFn).not.toHaveBeenCalled();
    expect(performResetFn).not.toHaveBeenCalled();
    expect(locks.held.size).toBe(0);
  });

  it('wrong confirmation or DATABASE_URL for a different database → refused before any lock or backup', async () => {
    const backupDir = tempBackupDir();
    for (const overrides of [
      { confirmation: 'reset studix data' },
      { databaseUrl: 'postgresql://postgres@127.0.0.1:55499/studix' },
      { expectedDatabaseName: '' },
    ]) {
      const locks = fakeLocks();
      const createBackupFn = vi.fn();
      const performResetFn = vi.fn();
      await expect(runDevResetWithVerifiedBackup({ ...baseArgs(backupDir, overrides), ...locks, createBackupFn, performResetFn }))
        .rejects.toBeInstanceOf(DevResetBackupError);
      expect(locks.acquireLockFn).not.toHaveBeenCalled();
      expect(createBackupFn).not.toHaveBeenCalled();
      expect(performResetFn).not.toHaveBeenCalled();
    }
  });

  it('a reset failure still releases both locks and keeps the verified backup', async () => {
    const backupDir = tempBackupDir();
    const locks = fakeLocks();
    let backupPath;
    const createBackupFn = (opts) => {
      const r = createVerifiedPreResetBackup({ ...opts, now: () => FIXED_NOW, ...fakeTools() });
      backupPath = r.path;
      return r;
    };
    const performResetFn = vi.fn(async () => { throw Object.assign(new Error('rolled back'), { code: 'reset_failed' }); });
    await expect(runDevResetWithVerifiedBackup({ ...baseArgs(backupDir), ...locks, createBackupFn, performResetFn }))
      .rejects.toMatchObject({ code: 'reset_failed' });
    expect(locks.held.size).toBe(0);
    expect(fs.existsSync(backupPath)).toBe(true);
  });
});

describe('integration with the step-1 core (real performDevReset)', () => {
  function recordingPrisma() {
    return { $transaction: vi.fn(async () => ({ databaseName: 'studix_dev', usersInvalidated: 0 })) };
  }

  it('a verified record produced by the backup step is accepted — the core proceeds to its transaction', async () => {
    const backupDir = tempBackupDir();
    const prisma = recordingPrisma();
    const record = createVerifiedPreResetBackup({ databaseUrl: DB_URL, backupDir, now: () => FIXED_NOW, ...fakeTools() });
    await performDevReset(prisma, { expectedDatabaseName: 'studix_dev', confirmation: RESET_CONFIRMATION_PHRASE, verifiedBackup: record });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('a missing or unverified record is still rejected by the core — even through the orchestrator', async () => {
    const backupDir = tempBackupDir();
    for (const bad of [undefined, null, {}, { path: 'x.dump' }, { verifiedAt: 'now' }]) {
      const prisma = recordingPrisma();
      await expect(runDevResetWithVerifiedBackup({
        ...baseArgs(backupDir), ...fakeLocks(), prisma, createBackupFn: () => bad,
      })).rejects.toMatchObject({ code: 'backup_required' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  });
});
