// backend/src/db/devResetCli.test.js
// Developer Data Reset — STEP 3 CLI (src/db/devResetCli.js). Unit tests, no database: the
// Prisma client, backup and reset are injected fakes (one test wires the REAL step-2
// orchestrator with real lock files in a temp folder). Every refusal is shown to stop before
// the reset orchestration, before any backup, and — where it applies — before connecting.
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runDevResetCli, EXIT, BROWSER_STATE_KEYS, redact } from './devResetCli.js';
import { runDevResetWithVerifiedBackup } from './devResetBackup.js';
import { RESET_CONFIRMATION_PHRASE } from './devReset.js';

const PASSWORD = 'S3cretPass!9';
const DB_URL = `postgresql://devuser:${encodeURIComponent(PASSWORD)}@127.0.0.1:5432/studix_dev`;

const tempDirs = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-devreset-cli-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => { while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true }); });

function baseEnv(overrides = {}) {
  const root = tempDir();
  return {
    DATABASE_URL: DB_URL,
    STUDIX_DEV_TOOLS: '1',
    STUDIX_DEV_RESET_DATABASE: 'studix_dev',
    STUDIX_BACKUP_DIR: path.join(root, 'backups'),
    STUDIX_RESTORE_LOCK_PATH: path.join(root, 'config', 'restore-state.lock'),
    STUDIX_DB_IDENTITY_PATH: path.join(root, 'config', 'db-identity.json'),
    ...overrides,
  };
}

function fakePrisma({ dbName = 'studix_dev', otherSessions = 0 } = {}) {
  return {
    $queryRawUnsafe: vi.fn(async (sql) => {
      if (sql.includes('current_database()') && !sql.includes('pg_stat_activity')) return [{ current_database: dbName }];
      if (sql.includes('pg_stat_activity')) return [{ n: otherSessions }];
      throw new Error(`unexpected query ${sql}`);
    }),
    $disconnect: vi.fn(async () => {}),
  };
}

const RESET_RESULT = {
  backup: { path: 'C:/x/dev-reset/pre-reset-2026-09-28T10-00-00-000Z.dump', verifiedAt: '2026-09-28T10:00:00.000Z' },
  reset: { databaseName: 'studix_dev', deletedCounts: { students: 3, payments: 2 }, usersInvalidated: 1, activityLogId: 'a1' },
  lockReleaseErrors: [],
};

function harness(opts = {}) {
  // 'answer' given explicitly as undefined must stay undefined (a missing answer), not default.
  const answer = Object.prototype.hasOwnProperty.call(opts, 'answer') ? opts.answer : RESET_CONFIRMATION_PHRASE;
  const { env = baseEnv(), configMode = 'development', prisma = fakePrisma(), deps = {} } = opts;
  const lines = [];
  const d = {
    createPrisma: vi.fn(async () => prisma),
    runResetFn: vi.fn(async (opts) => { opts.createBackupFn?.({}); return RESET_RESULT; }),
    createBackupFn: vi.fn(() => RESET_RESULT.backup),
    performResetFn: vi.fn(),
    readIdentityFn: vi.fn(() => ({ id: 'old-id', role: 'active', createdAt: '2026-01-01T00:00:00.000Z' })),
    generateIdentityFn: vi.fn(() => ({ id: 'new-id', role: 'active', createdAt: '2026-09-28T10:00:01.000Z' })),
    promoteIdentityFn: vi.fn(() => ({ identity: { id: 'new-id' } })),
    ...deps,
  };
  const run = () => runDevResetCli({ env, configMode, prompt: async () => answer, print: (l) => lines.push(l), deps: d });
  return { run, deps: d, lines, prisma, env };
}

function expectNothingHappened(h, { connected = false } = {}) {
  expect(h.deps.runResetFn).not.toHaveBeenCalled();
  expect(h.deps.createBackupFn).not.toHaveBeenCalled();
  expect(h.deps.performResetFn).not.toHaveBeenCalled();
  expect(h.deps.promoteIdentityFn).not.toHaveBeenCalled();
  if (!connected) expect(h.deps.createPrisma).not.toHaveBeenCalled();
}

describe('confirmation', () => {
  it('1. the exact phrase is accepted and the full flow runs', async () => {
    const h = harness();
    expect(await h.run()).toBe(EXIT.success);
    expect(h.deps.runResetFn).toHaveBeenCalledTimes(1);
    expect(h.deps.promoteIdentityFn).toHaveBeenCalledTimes(1);
    expect(h.lines.join('\n')).toMatch(/Developer reset completed successfully/);
  });

  it.each([
    ['lowercase', 'reset studix data'],
    ['trailing space', `${RESET_CONFIRMATION_PHRASE} `],
    ['leading space', ` ${RESET_CONFIRMATION_PHRASE}`],
    ['partial', 'RESET STUDIX'],
    ['yes', 'yes'],
  ])('2. a wrong phrase (%s) is refused before anything else', async (_l, answer) => {
    const h = harness({ answer });
    expect(await h.run()).toBe(EXIT.refused);
    expect(h.lines.join('\n')).toMatch(/Confirmation phrase did not match/);
    expectNothingHappened(h);
  });

  it.each([[''], [undefined], [null]])('3. a missing phrase (%s) is refused', async (answer) => {
    const h = harness({ answer });
    expect(await h.run()).toBe(EXIT.refused);
    expectNothingHappened(h);
  });

  it('shows what will be removed/preserved and the backup/undo terms BEFORE asking', async () => {
    const h = harness({ answer: 'no' });
    await h.run();
    const beforePrompt = h.lines.slice(0, h.lines.indexOf(RESET_CONFIRMATION_PHRASE) + 1).join('\n');
    expect(beforePrompt).toMatch(/remove ALL developer\/test data/);
    expect(beforePrompt).toMatch(/Preserved: .*license_config.*users/);
    expect(beforePrompt).toMatch(/verified pre-reset backup is created first/);
    expect(beforePrompt).toMatch(/cannot be undone directly/);
  });
});

describe('environment safety gates (all refuse before any backup or reset)', () => {
  it('4. production configuration is refused', async () => {
    const h = harness({ configMode: 'production' });
    expect(await h.run()).toBe(EXIT.refused);
    expect(h.lines.join('\n')).toMatch(/production installation/);
    expectNothingHappened(h);
  });

  it('4b. NODE_ENV=production is refused even in development config mode', async () => {
    const h = harness({ env: baseEnv({ NODE_ENV: 'production' }) });
    expect(await h.run()).toBe(EXIT.refused);
    expectNothingHappened(h);
  });

  it('4c. missing developer opt-in (STUDIX_DEV_TOOLS) is refused', async () => {
    for (const v of [undefined, '', '0', 'true', 'yes']) {
      const h = harness({ env: baseEnv({ STUDIX_DEV_TOOLS: v }) });
      expect(await h.run()).toBe(EXIT.refused);
      expectNothingHappened(h);
    }
  });

  it('5. the wrong database is refused: missing/mismatched STUDIX_DEV_RESET_DATABASE, or the connection lands elsewhere', async () => {
    for (const env of [
      baseEnv({ STUDIX_DEV_RESET_DATABASE: undefined }),
      baseEnv({ STUDIX_DEV_RESET_DATABASE: 'studix' }),
      baseEnv({ DATABASE_URL: undefined }),
      baseEnv({ DATABASE_URL: 'not a url' }),
    ]) {
      const h = harness({ env });
      expect(await h.run()).toBe(EXIT.refused);
      expectNothingHappened(h);
    }
    const connectedElsewhere = harness({ prisma: fakePrisma({ dbName: 'studix' }) });
    expect(await connectedElsewhere.run()).toBe(EXIT.refused);
    expect(connectedElsewhere.lines.join('\n')).toMatch(/Connected to database "studix"/);
    expectNothingHappened(connectedElsewhere, { connected: true });
    expect(connectedElsewhere.prisma.$disconnect).toHaveBeenCalled();
  });

  it('6. a running backend (another client connected) is refused — no backup, no reset', async () => {
    const h = harness({ prisma: fakePrisma({ otherSessions: 2 }) });
    expect(await h.run()).toBe(EXIT.refused);
    expect(h.lines.join('\n')).toMatch(/2 other client connection\(s\).*Stop the backend/);
    expectNothingHappened(h, { connected: true });
    expect(h.prisma.$disconnect).toHaveBeenCalled();
  });

  it('7. an unusable backup/lock/identity path is refused before connecting', async () => {
    const env = baseEnv();
    fs.mkdirSync(path.dirname(env.STUDIX_BACKUP_DIR), { recursive: true });
    fs.writeFileSync(env.STUDIX_BACKUP_DIR, 'a FILE where the backup folder should be');
    const h = harness({ env, deps: { readIdentityFn: vi.fn(() => null) } });
    expect(await h.run()).toBe(EXIT.refused);
    expect(h.lines.join('\n')).toMatch(/backup directory \(STUDIX_BACKUP_DIR\) is not writable/);
    expectNothingHappened(h);
  });

  it('7b. an invalid existing identity file is refused before connecting', async () => {
    const h = harness({ deps: { readIdentityFn: vi.fn(() => { throw new Error('corrupt_identity'); }) } });
    expect(await h.run()).toBe(EXIT.refused);
    expect(h.lines.join('\n')).toMatch(/identity file is unreadable or invalid/);
    expectNothingHappened(h);
  });
});

describe('orchestration and reporting', () => {
  it('8. success calls the step-2 flow with the explicit database, phrase and paths, then rotates the identity', async () => {
    const h = harness();
    expect(await h.run()).toBe(EXIT.success);
    const [opts] = h.deps.runResetFn.mock.calls[0];
    expect(opts).toMatchObject({
      prisma: h.prisma,
      databaseUrl: DB_URL,
      expectedDatabaseName: 'studix_dev',
      confirmation: RESET_CONFIRMATION_PHRASE,
      backupDir: h.env.STUDIX_BACKUP_DIR,
      restoreLockPath: h.env.STUDIX_RESTORE_LOCK_PATH,
      backupLockPath: path.join(h.env.STUDIX_BACKUP_DIR, '.routine-backup.lock'),
    });
    expect(h.deps.promoteIdentityFn).toHaveBeenCalledWith({
      configPath: h.env.STUDIX_DB_IDENTITY_PATH,
      identity: expect.objectContaining({ id: 'new-id', role: 'active' }),
    });
    // identity rotated only AFTER the reset returned
    expect(h.deps.runResetFn.mock.invocationCallOrder[0]).toBeLessThan(h.deps.promoteIdentityFn.mock.invocationCallOrder[0]);
    const out = h.lines.join('\n');
    for (const key of BROWSER_STATE_KEYS) expect(out).toContain(`- ${key}`);
    expect(out).toMatch(/Start the Studix backend[\s\S]*sign in again/);
  });

  it('8b. wired to the REAL step-2 orchestrator: backup before reset, reset receives the verified record, locks released', async () => {
    const env = baseEnv();
    const backupRecord = { path: path.join(env.STUDIX_BACKUP_DIR, 'dev-reset', 'pre-reset-x.dump'), verifiedAt: new Date().toISOString() };
    const createBackupFn = vi.fn(() => backupRecord);
    const performResetFn = vi.fn(async () => RESET_RESULT.reset);
    const h = harness({ env, deps: { runResetFn: runDevResetWithVerifiedBackup, createBackupFn, performResetFn } });
    expect(await h.run()).toBe(EXIT.success);
    expect(createBackupFn).toHaveBeenCalledTimes(1);
    expect(performResetFn).toHaveBeenCalledWith(h.prisma, expect.objectContaining({ verifiedBackup: backupRecord, expectedDatabaseName: 'studix_dev' }));
    expect(createBackupFn.mock.invocationCallOrder[0]).toBeLessThan(performResetFn.mock.invocationCallOrder[0]);
    expect(fs.existsSync(env.STUDIX_RESTORE_LOCK_PATH)).toBe(false);
    expect(fs.existsSync(path.join(env.STUDIX_BACKUP_DIR, '.routine-backup.lock'))).toBe(false);
  });

  it('9. a reset failure is reported (rolled back), exit 1, identity NOT rotated', async () => {
    const h = harness({ deps: { runResetFn: vi.fn(async () => { throw Object.assign(new Error('فشلت إعادة التعيين'), { code: 'reset_failed' }); }) } });
    expect(await h.run()).toBe(EXIT.resetFailed);
    const out = h.lines.join('\n');
    expect(out).toMatch(/✗ Developer reset failed/);
    expect(out).toMatch(/rolled back\. No data was changed/);
    expect(h.deps.promoteIdentityFn).not.toHaveBeenCalled();
  });

  it('9b. a backup failure is reported as "did not start"', async () => {
    const h = harness({ deps: { runResetFn: vi.fn(async () => { throw Object.assign(new Error('pg_dump فشل'), { code: 'pg_dump_failed' }); }) } });
    expect(await h.run()).toBe(EXIT.resetFailed);
    expect(h.lines.join('\n')).toMatch(/The reset did not start\. No data was changed/);
  });

  it('10. an identity-rotation failure is reported clearly: reset committed, exit 2, not "completed successfully"', async () => {
    const h = harness({ deps: { promoteIdentityFn: vi.fn(() => { throw new Error('EPERM: operation not permitted'); }) } });
    expect(await h.run()).toBe(EXIT.postResetFailed);
    const out = h.lines.join('\n');
    expect(out).toMatch(/Database identity rotation FAILED: EPERM/);
    expect(out).toMatch(/reset HAS been committed/);
    expect(out).not.toMatch(/Developer reset completed successfully/);
    for (const key of BROWSER_STATE_KEYS) expect(out).toContain(`- ${key}`);
  });

  it('11. secrets are never printed — not on success, refusal or failure, even when an error echoes the URL', async () => {
    const outputs = [];
    for (const deps of [
      {},
      { runResetFn: vi.fn(async () => { throw new Error(`connect failed: ${DB_URL}`); }) },
      { createPrisma: vi.fn(async () => { throw new Error(`cannot reach ${DB_URL} (password ${PASSWORD})`); }) },
    ]) {
      const h = harness({ deps });
      await h.run();
      outputs.push(h.lines.join('\n'));
    }
    const refused = harness({ prisma: fakePrisma({ otherSessions: 1 }) });
    await refused.run();
    outputs.push(refused.lines.join('\n'));
    for (const out of outputs) {
      expect(out).not.toContain(PASSWORD);
      expect(out).not.toContain(encodeURIComponent(PASSWORD));
      expect(out).not.toMatch(/postgres(ql)?:\/\/devuser/);
    }
    expect(outputs.join('\n')).toContain('[REDACTED]');
  });

  it('redact scrubs connection strings and explicit secrets', () => {
    expect(redact(`x ${DB_URL} y`)).toBe('x postgresql://[REDACTED] y');
    expect(redact('pw=hunter22', ['hunter22'])).toBe('pw=[REDACTED]');
  });
});
