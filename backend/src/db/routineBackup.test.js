// backend/src/db/routineBackup.test.js
// P1-1 — unit tests for the routine backup run, its verification, retention, locking and the
// credential-safe pg_dump invocation. Real files in a throwaway temp directory (never
// %ProgramData%); pg_dump/pg_restore/PostgreSQL are injected fakes. The real end-to-end dump ->
// restore -> switch proof against a disposable PostgreSQL database lives in
// routineBackupRestore.integration.test.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  runRoutineBackup, planRetention, applyRetention, parseRoutineBackupArgs, resolveBackupLockPath,
  EXIT_CODES, DEFAULT_MIN_KEEP, DEFAULT_RETENTION_DAYS,
} from './routineBackup.js';
import {
  runPgDump, pgConnectionEnv, verifyBackupArchive, listRoutineBackups, routineBackupFileName,
  parseRoutineBackupFileName, readBackupStatus, resolveBackupStatusPath, BACKUP_REQUIRED_TABLES,
} from './backup.js';

const SECRET = 'S3cr3t-Adm1n-Pw';
const ADMIN_URL = `postgresql://studix_admin:${SECRET}@127.0.0.1:55432/studix`;
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-26T03:00:00.000Z');

let backupDir;

function assertTemp(p) {
  if (!p.startsWith(os.tmpdir()) || /ProgramData/i.test(p)) throw new Error(`refusing non-temp path ${p}`);
}

beforeEach(() => {
  backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-routine-backup-test-'));
  assertTemp(backupDir);
});

afterEach(() => {
  fs.rmSync(backupDir, { recursive: true, force: true });
});

function fullToc(tables = BACKUP_REQUIRED_TABLES) {
  const lines = [';', '; Archive created at 2026-09-26 03:00:00', ';', '200; 1259 16390 TABLE public students studix_admin'];
  tables.forEach((t, i) => lines.push(`${3000 + i}; 0 ${16390 + i} TABLE DATA public ${t} studix_admin`));
  return lines.join('\n');
}

function writeFakeArchive(p, body = 'PGDMP\u0001\u000e\u0000fake-archive-body') {
  fs.writeFileSync(p, body, 'latin1');
}

function makeLog() {
  const lines = [];
  const rec = (level) => (message, meta) => lines.push({ level, message, meta });
  return { lines, info: rec('info'), warn: rec('warn'), error: rec('error'), text: () => JSON.stringify(lines) };
}

// deps: a complete, healthy fake environment; every test overrides only what it is about.
function deps(overrides = {}) {
  const log = makeLog();
  const tocFn = vi.fn(() => fullToc());
  return {
    log,
    tocFn,
    opts: {
      backupDir,
      now: () => NOW,
      log,
      readAdminCredentialFn: vi.fn(() => ADMIN_URL),
      waitForPostgresReadyFn: vi.fn(async () => ({ ready: true, timedOut: false, error: null })),
      readRestoreStateFn: vi.fn(() => ({ status: 'idle' })),
      findPgDumpFn: vi.fn(() => 'C:\\fake\\pg_dump.exe'),
      findPgRestoreFn: vi.fn(() => 'C:\\fake\\pg_restore.exe'),
      runPgDumpFn: vi.fn(({ outPath }) => writeFakeArchive(outPath)),
      verifyBackupArchiveFn: (p, o) => verifyBackupArchive(p, { ...o, execFileSyncFn: tocFn }),
      ...overrides,
    },
  };
}

function seedBackup(date, { body } = {}) {
  const p = path.join(backupDir, routineBackupFileName(date));
  writeFakeArchive(p, body);
  return path.basename(p);
}

function filesInDir() {
  return fs.readdirSync(backupDir).sort();
}

// ── file contract ─────────────────────────────────────────────────────────────────────────
describe('routine backup file naming contract', () => {
  it('timestamped UTC name round-trips through the strict parser', () => {
    const name = routineBackupFileName(NOW);
    expect(name).toBe('studix-backup-2026-09-26T03-00-00-000Z.dump');
    expect(parseRoutineBackupFileName(name).toISOString()).toBe(NOW.toISOString());
  });

  it.each([
    'studix-backup-2026-13-01T00-00-00-000Z.dump', // impossible month
    'studix-backup-2026-02-30T00-00-00-000Z.dump', // impossible day
    'studix-backup-latest.dump',
    'studix-backup-2026-09-26T03-00-00-000Z.dump.partial',
    'studix-backup-2026-09-26T03-00-00-000Z.dump.bak',
    'x-studix-backup-2026-09-26T03-00-00-000Z.dump',
    'pre-migration-2026-09-26T03-00-00-000Z.dump',
    '..\\studix-backup-2026-09-26T03-00-00-000Z.dump',
    'notes.txt',
  ])('rejects %s', (name) => {
    expect(parseRoutineBackupFileName(name)).toBeNull();
  });

  it('listRoutineBackups: newest first, only regular files with a strictly valid name', () => {
    const newer = seedBackup(new Date(NOW.getTime() - DAY));
    const older = seedBackup(new Date(NOW.getTime() - 3 * DAY));
    fs.writeFileSync(path.join(backupDir, 'notes.txt'), 'x');
    fs.writeFileSync(path.join(backupDir, 'pre-migration-2026-01-01T00-00-00-000Z.dump'), 'x');
    fs.mkdirSync(path.join(backupDir, routineBackupFileName(new Date(NOW.getTime() - 2 * DAY)))); // a directory with a valid name
    expect(listRoutineBackups({ backupDir }).map((b) => b.fileName)).toEqual([newer, older]);
  });

  it('listRoutineBackups on a missing directory is an empty list, not an error', () => {
    expect(listRoutineBackups({ backupDir: path.join(backupDir, 'missing') })).toEqual([]);
  });
});

// ── credentials ───────────────────────────────────────────────────────────────────────────
describe('credential-safe pg_dump invocation', () => {
  it('never passes the connection string or password on the command line — only via libpq env vars', () => {
    const exec = vi.fn();
    runPgDump({ pgDumpPath: 'C:\\pg\\pg_dump.exe', databaseUrl: ADMIN_URL, outPath: 'C:\\out.dump', execFileSyncFn: exec });
    const [cmd, argv, options] = exec.mock.calls[0];
    expect(cmd).toBe('C:\\pg\\pg_dump.exe');
    expect(argv).toEqual(['--format=custom', '--no-password', '--file', 'C:\\out.dump']);
    expect(JSON.stringify(argv)).not.toContain(SECRET);
    expect(JSON.stringify(argv)).not.toMatch(/postgres(ql)?:\/\//);
    expect(options.env).toMatchObject({
      PGHOST: '127.0.0.1', PGPORT: '55432', PGUSER: 'studix_admin', PGPASSWORD: SECRET, PGDATABASE: 'studix',
    });
    expect(options.shell).toBeUndefined();
  });

  it('a pg_dump failure message is redacted — no connection string or password survives', () => {
    const exec = vi.fn(() => {
      const err = new Error(`Command failed: pg_dump ${ADMIN_URL}`);
      err.stderr = `pg_dump: error: connection to ${ADMIN_URL} failed`;
      throw err;
    });
    let message;
    try {
      runPgDump({ pgDumpPath: 'pg_dump', databaseUrl: ADMIN_URL, outPath: 'o', execFileSyncFn: exec });
    } catch (err) {
      message = err.message;
    }
    expect(message).toBeDefined();
    expect(message).not.toContain(SECRET);
    expect(message).toContain('postgresql://[REDACTED]');
  });

  it('pgConnectionEnv decodes percent-encoded credentials', () => {
    const env = pgConnectionEnv('postgresql://u%40x:p%23w@localhost:5432/db', {});
    expect(env).toEqual({ PGHOST: 'localhost', PGPORT: '5432', PGUSER: 'u@x', PGPASSWORD: 'p#w', PGDATABASE: 'db' });
  });
});

// ── verification ──────────────────────────────────────────────────────────────────────────
describe('verifyBackupArchive — more than "a file exists"', () => {
  const pgRestorePath = 'C:\\fake\\pg_restore.exe';

  it('accepts a PGDMP archive whose TOC has TABLE DATA for every core table', () => {
    const p = path.join(backupDir, 'a.dump');
    writeFakeArchive(p);
    const exec = vi.fn(() => fullToc());
    const result = verifyBackupArchive(p, { pgRestorePath, execFileSyncFn: exec });
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.tableDataEntries).toBe(BACKUP_REQUIRED_TABLES.length);
    expect(exec).toHaveBeenCalledWith(pgRestorePath, ['--list', p], expect.objectContaining({ encoding: 'utf8' }));
  });

  it('always hands pg_restore an absolute path — a file name starting with "-" is never parsed as an option', () => {
    const name = '--dbname=evil.dump';
    const p = path.join(backupDir, name);
    writeFakeArchive(p);
    const exec = vi.fn(() => fullToc());
    const cwd = process.cwd();
    try {
      process.chdir(backupDir);
      verifyBackupArchive(name, { pgRestorePath, execFileSyncFn: exec });
    } finally {
      process.chdir(cwd);
    }
    const [, argv] = exec.mock.calls[0];
    expect(argv[1]).toBe(path.resolve(backupDir, name));
    expect(argv[1].startsWith('-')).toBe(false);
  });

  it('rejects a missing file', () => {
    expect(() => verifyBackupArchive(path.join(backupDir, 'none.dump'), { pgRestorePath, execFileSyncFn: vi.fn() }))
      .toThrow(/غير موجود/);
  });

  it('rejects an empty file without even running pg_restore', () => {
    const p = path.join(backupDir, 'empty.dump');
    fs.writeFileSync(p, '');
    const exec = vi.fn();
    expect(() => verifyBackupArchive(p, { pgRestorePath, execFileSyncFn: exec })).toThrow(/فارغ/);
    expect(exec).not.toHaveBeenCalled();
  });

  it('rejects a file that is not a custom-format archive (no PGDMP header)', () => {
    const p = path.join(backupDir, 'plain.dump');
    fs.writeFileSync(p, '-- PostgreSQL database dump\nCREATE TABLE x();');
    expect(() => verifyBackupArchive(p, { pgRestorePath, execFileSyncFn: vi.fn(() => fullToc()) })).toThrow(/PGDMP/);
  });

  it('rejects an archive pg_restore --list cannot read (truncated/corrupt)', () => {
    const p = path.join(backupDir, 'corrupt.dump');
    writeFakeArchive(p);
    const exec = vi.fn(() => { const e = new Error('Command failed'); e.stderr = 'pg_restore: error: could not read input file: end of file'; throw e; });
    expect(() => verifyBackupArchive(p, { pgRestorePath, execFileSyncFn: exec })).toThrow(/end of file/);
  });

  it('rejects an archive whose TOC is missing a core table\'s data', () => {
    const p = path.join(backupDir, 'partial-toc.dump');
    writeFakeArchive(p);
    const exec = vi.fn(() => fullToc(BACKUP_REQUIRED_TABLES.filter((t) => t !== 'payments')));
    expect(() => verifyBackupArchive(p, { pgRestorePath, execFileSyncFn: exec })).toThrow(/payments/);
  });
});

// ── a run ────────────────────────────────────────────────────────────────────────────────
describe('runRoutineBackup — success', () => {
  it('dumps to .partial, verifies, publishes under the timestamped name, records status, and logs no credentials', async () => {
    const { opts, log } = deps();
    const result = await runRoutineBackup(opts);

    expect(result.status).toBe('success');
    expect(result.backup).toEqual({ fileName: 'studix-backup-2026-09-26T03-00-00-000Z.dump', sizeBytes: expect.any(Number), verified: true });
    expect(filesInDir()).toEqual([
      'backup-status.json', 'studix-backup-2026-09-26T03-00-00-000Z.dump',
    ]);
    // the dump went to the .partial path first, against the production database name
    const dumpCall = opts.runPgDumpFn.mock.calls[0][0];
    expect(dumpCall.outPath).toBe(path.join(backupDir, 'studix-backup-2026-09-26T03-00-00-000Z.dump.partial'));
    expect(new URL(dumpCall.databaseUrl).pathname).toBe('/studix');

    const status = readBackupStatus({ backupDir });
    expect(status.lastRun.status).toBe('success');
    expect(status.lastSuccess.backup.fileName).toBe('studix-backup-2026-09-26T03-00-00-000Z.dump');
    expect(log.text()).not.toContain(SECRET);
    expect(JSON.stringify(status)).not.toContain(SECRET);
    expect(fs.existsSync(resolveBackupLockPath(backupDir))).toBe(false); // lock released
    expect(EXIT_CODES[result.status]).toBe(0);
  });

  it('repeated runs create separate timestamped backups and keep both', async () => {
    const first = deps({ now: () => NOW });
    await runRoutineBackup(first.opts);
    const second = deps({ now: () => new Date(NOW.getTime() + DAY) });
    const result = await runRoutineBackup(second.opts);
    expect(result.status).toBe('success');
    expect(listRoutineBackups({ backupDir }).map((b) => b.fileName)).toEqual([
      'studix-backup-2026-09-27T03-00-00-000Z.dump', 'studix-backup-2026-09-26T03-00-00-000Z.dump',
    ]);
  });

  it('never overwrites an existing backup with the same timestamp', async () => {
    const existing = seedBackup(NOW, { body: 'PGDMPoriginal' });
    const { opts } = deps();
    const result = await runRoutineBackup(opts);
    expect(result.status).toBe('failed');
    expect(fs.readFileSync(path.join(backupDir, existing), 'latin1')).toBe('PGDMPoriginal');
    expect(opts.runPgDumpFn).not.toHaveBeenCalled();
  });
});

describe('runRoutineBackup — failures are visible and never delete anything', () => {
  function seedOldBackups() {
    // 10 backups, 30..39 days old — retention WOULD delete 3 of them after a successful run.
    return Array.from({ length: 10 }, (_, i) => seedBackup(new Date(NOW.getTime() - (30 + i) * DAY)));
  }

  it('PostgreSQL unavailable -> failed(postgres_unavailable), no dump, old backups untouched, last success preserved', async () => {
    const good = deps({ now: () => new Date(NOW.getTime() - DAY) });
    await runRoutineBackup(good.opts);
    const before = filesInDir().filter((f) => f.endsWith('.dump'));
    const seeded = seedOldBackups();

    const { opts, log } = deps({
      waitForPostgresReadyFn: vi.fn(async () => ({ ready: false, timedOut: true, error: 'connect ECONNREFUSED 127.0.0.1:55432' })),
    });
    const result = await runRoutineBackup(opts);

    expect(result.status).toBe('failed');
    expect(result.reason).toBe('postgres_unavailable');
    expect(EXIT_CODES[result.status]).toBe(1);
    expect(opts.runPgDumpFn).not.toHaveBeenCalled();
    for (const f of [...before, ...seeded]) expect(fs.existsSync(path.join(backupDir, f))).toBe(true);
    const status = readBackupStatus({ backupDir });
    expect(status.lastRun.status).toBe('failed');
    expect(status.lastSuccess.backup.fileName).toBe(before[0]);
    expect(log.lines.some((l) => l.level === 'error' && /PostgreSQL/.test(l.message))).toBe(true);
  });

  it('pg_dump failure -> failed(dump_failed), partial removed, error redacted, old backups untouched', async () => {
    const seeded = seedOldBackups();
    const { opts, log } = deps({
      runPgDumpFn: vi.fn(({ outPath }) => {
        fs.writeFileSync(outPath, 'PGDMP-half-written');
        throw new Error(`pg_dump فشل: connection to ${ADMIN_URL} failed: FATAL: password authentication failed`);
      }),
    });
    const result = await runRoutineBackup(opts);
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('dump_failed');
    expect(result.error).not.toContain(SECRET);
    expect(log.text()).not.toContain(SECRET);
    expect(JSON.stringify(readBackupStatus({ backupDir }))).not.toContain(SECRET);
    expect(filesInDir().some((f) => f.endsWith('.partial'))).toBe(false);
    for (const f of seeded) expect(fs.existsSync(path.join(backupDir, f))).toBe(true);
  });

  it.each([
    ['an empty dump', ({ outPath }) => fs.writeFileSync(outPath, '')],
    ['a non-archive dump', ({ outPath }) => fs.writeFileSync(outPath, 'not an archive')],
  ])('%s -> failed(verification_failed), nothing published', async (_label, impl) => {
    const { opts } = deps({ runPgDumpFn: vi.fn(impl) });
    const result = await runRoutineBackup(opts);
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('verification_failed');
    expect(listRoutineBackups({ backupDir })).toEqual([]);
    expect(filesInDir()).toEqual(['backup-status.json']);
  });

  it('pg_restore --list rejects the archive -> failed(verification_failed), nothing published', async () => {
    const { opts, tocFn } = deps();
    tocFn.mockImplementation(() => { throw new Error('pg_restore: error: corrupt'); });
    const result = await runRoutineBackup(opts);
    expect(result.reason).toBe('verification_failed');
    expect(listRoutineBackups({ backupDir })).toEqual([]);
  });

  it('pg_dump binary missing -> failed, nothing published', async () => {
    const { opts } = deps({ findPgDumpFn: vi.fn(() => { throw new Error('تعذّر العثور على pg_dump.exe'); }) });
    const result = await runRoutineBackup(opts);
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/pg_dump\.exe/);
  });

  it('missing admin credential -> failed with a credential-free message', async () => {
    const { opts } = deps({ readAdminCredentialFn: vi.fn(() => { throw new Error('تعذّر العثور على بيانات اعتماد الإدارة'); }) });
    opts.waitForPostgresReadyFn = vi.fn(async () => ({ ready: true }));
    const result = await runRoutineBackup(opts);
    expect(result.status).toBe('failed');
  });

  it('a database switch/rollback in progress -> skipped (exit 0), no dump', async () => {
    for (const status of ['switching', 'rolling_back']) {
      const { opts } = deps({ readRestoreStateFn: vi.fn(() => ({ status })) });
      // eslint-disable-next-line no-await-in-loop
      const result = await runRoutineBackup(opts);
      expect(result.status).toBe('skipped');
      expect(result.reason).toBe('database_switch_in_progress');
      expect(opts.runPgDumpFn).not.toHaveBeenCalled();
      expect(EXIT_CODES[result.status]).toBe(0);
    }
  });

  it('a restore that is only preparing a candidate does not block the backup', async () => {
    const { opts } = deps({ readRestoreStateFn: vi.fn(() => ({ status: 'verified' })) });
    expect((await runRoutineBackup(opts)).status).toBe('success');
  });

  it('an unreadable restore-state file does not prevent the backup (logged)', async () => {
    const { opts, log } = deps({ readRestoreStateFn: vi.fn(() => { throw new Error('corrupt_state'); }) });
    expect((await runRoutineBackup(opts)).status).toBe('success');
    expect(log.lines.some((l) => l.level === 'warn' && /restore-state/.test(l.message))).toBe(true);
  });
});

describe('runRoutineBackup — concurrency', () => {
  it('a second run while one is in progress is skipped (already_running), never runs pg_dump twice', async () => {
    let releaseReady;
    const gate = new Promise((resolve) => { releaseReady = resolve; });
    const a = deps({ waitForPostgresReadyFn: vi.fn(async () => { await gate; return { ready: true }; }) });
    const b = deps();

    const runA = runRoutineBackup(a.opts);
    const resultB = await runRoutineBackup(b.opts);
    releaseReady();
    const resultA = await runA;

    expect(resultB).toEqual({ status: 'skipped', reason: 'already_running' });
    expect(b.opts.runPgDumpFn).not.toHaveBeenCalled();
    expect(resultA.status).toBe('success');
    expect(readBackupStatus({ backupDir }).lastRun.status).toBe('success'); // B never overwrote A's status
    expect(fs.existsSync(resolveBackupLockPath(backupDir))).toBe(false);
  });

  it('a stale lock left by a dead process is reclaimed', async () => {
    fs.writeFileSync(resolveBackupLockPath(backupDir), JSON.stringify({ pid: 999999, acquiredAt: '2026-01-01T00:00:00.000Z' }));
    const { opts } = deps();
    expect((await runRoutineBackup(opts)).status).toBe('success');
  });

  it('a corrupt lock file -> failed(lock_failed), visible, no dump', async () => {
    fs.writeFileSync(resolveBackupLockPath(backupDir), 'not json');
    const { opts } = deps();
    const result = await runRoutineBackup(opts);
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('lock_failed');
    expect(opts.runPgDumpFn).not.toHaveBeenCalled();
  });

  it('the lock is released even when the run fails', async () => {
    const { opts } = deps({ runPgDumpFn: vi.fn(() => { throw new Error('boom'); }) });
    await runRoutineBackup(opts);
    expect(fs.existsSync(resolveBackupLockPath(backupDir))).toBe(false);
  });
});

// ── retention ─────────────────────────────────────────────────────────────────────────────
describe('planRetention', () => {
  const mk = (daysOld) => ({ fileName: `b${daysOld}`, createdAt: new Date(NOW.getTime() - daysOld * DAY) });

  it('defaults: 14 days, and always at least the newest 7', () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(14);
    expect(DEFAULT_MIN_KEEP).toBe(7);
  });

  it('keeps everything younger than retentionDays, deletes older ones beyond the newest minKeep', () => {
    const backups = [0, 1, 2, 3, 20, 21, 22, 23, 24, 25].map(mk);
    const plan = planRetention(backups, { now: NOW, retentionDays: 14, minKeep: 7 });
    expect(plan.keep.map((b) => b.fileName)).toEqual(['b0', 'b1', 'b2', 'b3', 'b20', 'b21', 'b22']);
    expect(plan.delete.map((b) => b.fileName)).toEqual(['b23', 'b24', 'b25']);
  });

  it('never deletes the newest backup, even if every backup is ancient and minKeep is 0', () => {
    const plan = planRetention([mk(400), mk(300), mk(500)], { now: NOW, retentionDays: 14, minKeep: 0 });
    expect(plan.keep.map((b) => b.fileName)).toEqual(['b300']);
  });

  it('a machine that was off for weeks keeps its last minKeep backups', () => {
    const plan = planRetention([40, 41, 42, 43, 44, 45, 46, 47].map(mk), { now: NOW });
    expect(plan.keep).toHaveLength(7);
    expect(plan.delete.map((b) => b.fileName)).toEqual(['b47']);
  });
});

describe('applyRetention / retention inside a run', () => {
  it('deletes only expired, strictly-named regular files; never malformed/unexpected names, directories, or pre-migration backups', async () => {
    const expired = Array.from({ length: 10 }, (_, i) => seedBackup(new Date(NOW.getTime() - (20 + i) * DAY)));
    const untouchable = [
      'studix-backup-2020-13-01T00-00-00-000Z.dump',
      'studix-backup-old.dump',
      'studix-backup-2020-01-01T00-00-00-000Z.dump.bak',
      'pre-migration-2020-01-01T00-00-00-000Z.dump',
      'operator-copy.dump',
      'notes.txt',
    ];
    for (const f of untouchable) fs.writeFileSync(path.join(backupDir, f), 'x');
    const dirWithValidName = routineBackupFileName(new Date('2020-01-01T00:00:00.000Z'));
    fs.mkdirSync(path.join(backupDir, dirWithValidName));

    const { opts } = deps();
    const result = await runRoutineBackup(opts);

    expect(result.status).toBe('success');
    // new + 6 newest expired kept (minKeep 7), the 4 oldest expired deleted
    expect(result.retention.deleted.sort()).toEqual(expired.slice(6).sort());
    for (const f of expired.slice(0, 6)) expect(fs.existsSync(path.join(backupDir, f))).toBe(true);
    for (const f of untouchable) expect(fs.existsSync(path.join(backupDir, f))).toBe(true);
    expect(fs.statSync(path.join(backupDir, dirWithValidName)).isDirectory()).toBe(true);
  });

  it('removes abandoned .partial files older than a day, keeps recent ones', () => {
    const old = `${routineBackupFileName(new Date(NOW.getTime() - 3 * DAY))}.partial`;
    const recent = `${routineBackupFileName(new Date(NOW.getTime() - 60 * 1000))}.partial`;
    const foreign = 'something-else.partial';
    for (const f of [old, recent, foreign]) fs.writeFileSync(path.join(backupDir, f), 'x');
    const oldTime = new Date(NOW.getTime() - 3 * DAY);
    fs.utimesSync(path.join(backupDir, old), oldTime, oldTime);
    const recentTime = new Date(NOW.getTime() - 60 * 1000);
    fs.utimesSync(path.join(backupDir, recent), recentTime, recentTime);
    fs.utimesSync(path.join(backupDir, foreign), oldTime, oldTime);

    const result = applyRetention({ backupDir, now: NOW });
    expect(result.deleted).toEqual([old]);
    expect(fs.existsSync(path.join(backupDir, recent))).toBe(true);
    expect(fs.existsSync(path.join(backupDir, foreign))).toBe(true);
  });

  it('protectFileName is never deleted, whatever the plan says', () => {
    const ancient = seedBackup(new Date('2020-01-01T00:00:00.000Z'));
    const newer = seedBackup(new Date('2021-01-01T00:00:00.000Z'));
    const result = applyRetention({ backupDir, now: NOW, minKeep: 1, protectFileName: ancient });
    expect(result.deleted).toEqual([]);
    expect(fs.existsSync(path.join(backupDir, ancient))).toBe(true);
    expect(fs.existsSync(path.join(backupDir, newer))).toBe(true);
  });

  it('a deletion failure makes the run a visible warning (exit code 2), not a success — and the new backup is kept', async () => {
    const expired = Array.from({ length: 9 }, (_, i) => seedBackup(new Date(NOW.getTime() - (20 + i) * DAY)));
    const failing = new Set([expired[8]]);
    const fsImpl = {
      ...fs,
      unlinkSync: (p) => {
        if (failing.has(path.basename(p))) { const e = new Error('EPERM: operation not permitted'); e.code = 'EPERM'; throw e; }
        return fs.unlinkSync(p);
      },
    };
    const { opts, log } = deps({ fsImpl });
    const result = await runRoutineBackup(opts);

    expect(result.status).toBe('warning');
    expect(result.reason).toBe('retention_failed');
    expect(EXIT_CODES[result.status]).toBe(2);
    expect(result.retention.errors).toEqual([{ fileName: expired[8], error: expect.stringContaining('EPERM') }]);
    expect(fs.existsSync(path.join(backupDir, result.backup.fileName))).toBe(true);
    expect(readBackupStatus({ backupDir }).lastRun.status).toBe('warning');
    expect(log.lines.some((l) => l.level === 'error' && /تنظيف/.test(l.message))).toBe(true);
  });

  it('a status-file write failure turns a success into a visible warning', async () => {
    const fsImpl = { ...fs };
    const { opts } = deps({ fsImpl });
    // make the status path a directory so the atomic rename onto it fails
    fs.mkdirSync(resolveBackupStatusPath(backupDir));
    const result = await runRoutineBackup(opts);
    expect(result.status).toBe('warning');
    expect(result.reason).toBe('status_write_failed');
  });
});

// ── CLI ───────────────────────────────────────────────────────────────────────────────────
describe('parseRoutineBackupArgs', () => {
  it('no args = run; --list; --verify <file>', () => {
    expect(parseRoutineBackupArgs([])).toEqual({ mode: 'run' });
    expect(parseRoutineBackupArgs(['--list'])).toEqual({ mode: 'list' });
    expect(parseRoutineBackupArgs(['--verify', 'C:\\b\\x.dump'])).toEqual({ mode: 'verify', file: 'C:\\b\\x.dump' });
  });

  it('rejects connection strings anywhere and unknown arguments', () => {
    expect(() => parseRoutineBackupArgs([ADMIN_URL])).toThrow(/PostgreSQL/);
    expect(() => parseRoutineBackupArgs(['--verify', ADMIN_URL])).toThrow(/PostgreSQL/);
    expect(() => parseRoutineBackupArgs(['--delete', 'x'])).toThrow(/الاستخدام/);
    expect(() => parseRoutineBackupArgs(['--verify'])).toThrow(/الاستخدام/);
  });
});
