// backend/src/db/devResetBackup.integration.test.js
// Developer Data Reset — STEP 2 against REAL PostgreSQL tools: a real pg_dump into
// <temp backupDir>/dev-reset/, a real `pg_restore --list` verification, real lock files (in a
// temp folder — never %ProgramData%), then the step-1 reset using that verified record. Also
// proves the archive is genuinely recoverable with the EXISTING restore primitive
// (backup.js restoreBackup) into a fresh empty database on the same throwaway cluster.
//
// Runs ONLY against an explicitly isolated throwaway server:
//
//   DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/<name> STUDIX_TEST_DB_ISOLATED=1 \
//     npx vitest run --config vitest.integration.config.js src/db/devResetBackup.integration.test.js
//
// ── Isolation guard (fail-closed, evaluated before ANY PostgreSQL contact) — same rules as
// devReset.integration.test.js: nothing that can open a connection is imported statically
// (@prisma/client loads backend/.env into process.env when first imported); the scratch helper,
// Prisma and every module that imports Prisma are loaded dynamically only after the guard passes.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import process from 'process';
import { URL } from 'url';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const REAL_DATABASE_NAME = 'studix';

function evaluateIsolationGuard({ databaseUrl, isolatedFlag }) {
  if (typeof databaseUrl !== 'string' || !databaseUrl.trim()) {
    return { ok: false, reason: 'DATABASE_URL was not explicitly supplied — point it at a throwaway PostgreSQL cluster.' };
  }
  if (isolatedFlag !== '1') {
    return { ok: false, reason: 'STUDIX_TEST_DB_ISOLATED must be exactly "1" — set it only for a throwaway PostgreSQL cluster.' };
  }
  let databaseName;
  try {
    databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
  } catch {
    return { ok: false, reason: 'DATABASE_URL is not a valid URL.' };
  }
  if (!databaseName || databaseName === REAL_DATABASE_NAME) {
    return { ok: false, reason: `refusing to derive a scratch database from the real "${REAL_DATABASE_NAME}" database name.` };
  }
  return { ok: true, reason: null };
}

const isolationGuard = evaluateIsolationGuard({
  databaseUrl: process.env.DATABASE_URL,
  isolatedFlag: process.env.STUDIX_TEST_DB_ISOLATED,
});

let scratchDbHelper = null;
let dbCheck = { reachable: false, reason: null };
if (isolationGuard.ok) {
  scratchDbHelper = await import('../test-helpers/scratchDb.js');
  dbCheck = await scratchDbHelper.checkPostgresReachable();
}

describe('devResetBackup.js — real pg_dump / pg_restore / locks integration', () => {
  if (!isolationGuard.ok) {
    it.skip(`SKIPPED — isolation guard: ${isolationGuard.reason} No PostgreSQL connection was made.`, () => {});
    return;
  }
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, backupMod, resetMod, backupJs, restoreLock;
  let backupDir, restoreLockPath, backupLockPath;
  const RESTORE_PROOF_DB = 'devreset_restore_proof';

  beforeAll(async () => {
    scratch = await scratchDbHelper.setupScratchDb('dev_reset_backup');
    client = scratch.client;
    const { applyFullSchemaDDL } = await import('../test-helpers/scratchDbFullSchema.js');
    await applyFullSchemaDDL(client);
    await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS _studix_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    backupMod = await import('./devResetBackup.js');
    resetMod = await import('./devReset.js');
    backupJs = await import('./backup.js');
    restoreLock = await import('./restoreLock.js');
  }, 120_000);

  afterAll(async () => {
    if (!scratch) return;
    const { PrismaClient } = await import('@prisma/client');
    const maint = new PrismaClient({ datasources: { db: { url: scratch.maintenanceUrl } } });
    try {
      await maint.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${RESTORE_PROOF_DB}"`);
    } finally {
      await maint.$disconnect();
    }
    await scratchDbHelper.teardownScratchDb(scratch);
  });

  beforeEach(async () => {
    // A fresh temp backup folder per test — never the real %ProgramData%\Studix\backups.
    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-devreset-it-'));
    restoreLockPath = path.join(backupDir, 'config', 'restore-state.lock');
    backupLockPath = path.join(backupDir, '.routine-backup.lock');

    await client.$executeRawUnsafe(`TRUNCATE TABLE ${resetMod.RESET_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY`);
    for (const t of ['_studix_migrations', 'license_config', 'support_access_config', 'users', 'roles', 'center_profile', 'inventory_settings', 'teachers']) {
      await client.$executeRawUnsafe(`DELETE FROM "${t}"`);
    }
    for (const s of [
      `INSERT INTO _studix_migrations (version, name, checksum) VALUES (1, '001_baseline.sql', 'abc')`,
      `INSERT INTO license_config (id) VALUES (1)`,
      `INSERT INTO support_access_config (id) VALUES (1)`,
      `INSERT INTO roles (id, label, permissions) VALUES ('admin', 'مدير', '["students"]'::jsonb)`,
      `INSERT INTO users (id, name, role_id, is_admin, auth_version) VALUES ('admin', 'Admin', 'admin', true, 1)`,
      `INSERT INTO center_profile (id, name) VALUES (1, 'مركز')`,
      `INSERT INTO inventory_settings (id) VALUES (1)`,
      `INSERT INTO groups (id, name, price, days) VALUES ('g1', 'G1', 100, '["sat"]'::jsonb)`,
      `INSERT INTO parents (full_name, phone) VALUES ('ولي', '01000000001')`,
      `INSERT INTO students (id, code, name, group_id, parent_id) VALUES ('s1', 'C1', 'Student 1', 'g1', 1), ('s2', 'C2', 'Student 2', 'g1', 1)`,
      `INSERT INTO cashboxes (id, name, opening_balance, active) VALUES ('cb_main', 'Main', 0, true)`,
      `INSERT INTO treasury_txn (id, cashbox_id, date, type, category, amount, method, status) VALUES ('t1', 'cb_main', '2026-01-05', 'income', 'other', 100, 'cash', 'active')`,
      `INSERT INTO payments (id, student_id, group_id, month, year, amount, date, status, method, pay_type, treasury_txn_id) VALUES ('p1', 's1', 'g1', 1, 2026, 100, '2026-01-05', 'paid', 'cash', 'subscription', 't1')`,
      `INSERT INTO activity_logs (id, action, module, user_id) VALUES ('log-old-1', 'create', 'students', 'admin')`,
    ]) await client.$executeRawUnsafe(s);
  });

  afterEach(() => {
    if (backupDir) fs.rmSync(backupDir, { recursive: true, force: true });
  });

  const count = async (t) => (await client.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${t}"`))[0].n;
  const orchestratorArgs = () => ({
    prisma: client,
    databaseUrl: scratch.scratchUrl,
    expectedDatabaseName: scratch.scratchDbName,
    confirmation: resetMod.RESET_CONFIRMATION_PHRASE,
    actor: { id: 'admin', name: 'Admin' },
    backupDir, restoreLockPath, backupLockPath,
  });

  it('backup → verify → reset: the verified pre-reset archive exists before and after, and pg_restore --list reads it', async () => {
    const result = await backupMod.runDevResetWithVerifiedBackup(orchestratorArgs());

    // backup: dedicated dev-reset/ folder, pre-reset-*.dump name, final file only (no .partial)
    const devResetDir = path.join(backupDir, 'dev-reset');
    expect(path.dirname(result.backup.path)).toBe(devResetDir);
    expect(backupMod.PRE_RESET_BACKUP_FILENAME_RE.test(path.basename(result.backup.path))).toBe(true);
    expect(fs.readdirSync(devResetDir)).toEqual([path.basename(result.backup.path)]);
    expect(result.backup.tableDataEntries).toBeGreaterThanOrEqual(33);

    // reset ran with that record
    expect(result.reset.backupPath).toBe(result.backup.path);
    expect(await count('students')).toBe(0);
    expect(await count('payments')).toBe(0);
    const [log] = await client.$queryRawUnsafe('SELECT action, details FROM activity_logs');
    expect(log.action).toBe('dev_reset');
    expect(JSON.parse(log.details).backupPath).toBe(result.backup.path);

    // backup remains available and is independently readable afterwards
    expect(fs.statSync(result.backup.path).size).toBeGreaterThan(0);
    const toc = execFileSync(backupJs.findPgRestore(), ['--list', result.backup.path], { encoding: 'utf8', windowsHide: true });
    for (const t of [...resetMod.RESET_TABLES, ...resetMod.PRESERVE_TABLES]) {
      expect(toc).toMatch(new RegExp(`TABLE DATA \\S+ ${t} `));
    }

    // both locks released (their files are gone)
    expect(fs.existsSync(restoreLockPath)).toBe(false);
    expect(fs.existsSync(backupLockPath)).toBe(false);
  });

  it('the pre-reset archive restores the original data (existing restoreBackup, into a fresh empty database)', async () => {
    const result = await backupMod.runDevResetWithVerifiedBackup(orchestratorArgs());
    const { PrismaClient } = await import('@prisma/client');
    const maint = new PrismaClient({ datasources: { db: { url: scratch.maintenanceUrl } } });
    const proofUrl = (() => { const u = new URL(scratch.scratchUrl); u.pathname = `/${RESTORE_PROOF_DB}`; return u.toString(); })();
    try {
      await maint.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${RESTORE_PROOF_DB}"`);
      await maint.$executeRawUnsafe(`CREATE DATABASE "${RESTORE_PROOF_DB}"`);
    } finally {
      await maint.$disconnect();
    }
    await backupJs.restoreBackup(result.backup.path, proofUrl);
    const restored = new PrismaClient({ datasources: { db: { url: proofUrl } } });
    try {
      const [{ n: students }] = await restored.$queryRawUnsafe('SELECT count(*)::int AS n FROM students');
      const [{ n: payments }] = await restored.$queryRawUnsafe('SELECT count(*)::int AS n FROM payments');
      const [{ n: logs }] = await restored.$queryRawUnsafe(`SELECT count(*)::int AS n FROM activity_logs WHERE id = 'log-old-1'`);
      expect({ students, payments, logs }).toEqual({ students: 2, payments: 1, logs: 1 });
    } finally {
      await restored.$disconnect();
    }
  });

  it('a lock held by a live process → no backup file, no reset, data unchanged', async () => {
    // Held under THIS process's own (alive) pid; the orchestrator runs as a different pid.
    restoreLock.acquireRestoreLock({ configPath: backupLockPath, pid: process.pid });
    try {
      await expect(backupMod.runDevResetWithVerifiedBackup({ ...orchestratorArgs(), pid: process.pid + 100000 }))
        .rejects.toMatchObject({ code: 'lock_unavailable', details: { lock: '.routine-backup.lock', reason: 'lock_held' } });
    } finally {
      restoreLock.releaseRestoreLock({ configPath: backupLockPath, pid: process.pid });
    }
    expect(fs.existsSync(path.join(backupDir, 'dev-reset'))).toBe(false);
    expect(fs.existsSync(restoreLockPath)).toBe(false); // the first lock was released again
    expect(await count('students')).toBe(2);
    expect(await count('payments')).toBe(1);
  });

  it('a pg_dump that cannot reach the database → no reset, data unchanged, locks released', async () => {
    const unreachable = (() => { const u = new URL(scratch.scratchUrl); u.port = '1'; return u.toString(); })();
    await expect(backupMod.runDevResetWithVerifiedBackup({ ...orchestratorArgs(), databaseUrl: unreachable }))
      .rejects.toMatchObject({ code: 'pg_dump_failed' });
    expect(fs.readdirSync(path.join(backupDir, 'dev-reset'))).toEqual([]);
    expect(await count('students')).toBe(2);
    expect(fs.existsSync(restoreLockPath)).toBe(false);
    expect(fs.existsSync(backupLockPath)).toBe(false);
  });
});
