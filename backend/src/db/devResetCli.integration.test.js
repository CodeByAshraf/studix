// backend/src/db/devResetCli.integration.test.js
// Developer Data Reset — STEP 3 CLI against REAL PostgreSQL: runs runDevResetCli with an
// EXPLICIT env object (never backend/.env) against a throwaway scratch database — real Prisma
// client, real pg_stat_activity backend check, real pg_dump/pg_restore backup, real locks and
// real database-identity rotation, all under a temp folder (never %ProgramData%).
//
// Runs ONLY against an explicitly isolated throwaway server:
//
//   DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/<name> STUDIX_TEST_DB_ISOLATED=1 \
//     npx vitest run --config vitest.integration.config.js src/db/devResetCli.integration.test.js
//
// ── Isolation guard (fail-closed, evaluated before ANY PostgreSQL contact) — same rules as the
// step-1/step-2 integration tests: nothing that can open a connection is imported statically;
// the scratch helper and every module importing Prisma load dynamically only after it passes.
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

describe('devResetCli.js — real PostgreSQL CLI integration', () => {
  if (!isolationGuard.ok) {
    it.skip(`SKIPPED — isolation guard: ${isolationGuard.reason} No PostgreSQL connection was made.`, () => {});
    return;
  }
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, cli, resetMod, identity, backupJs;
  let root, env;

  beforeAll(async () => {
    scratch = await scratchDbHelper.setupScratchDb('dev_reset_cli');
    client = scratch.client;
    const { applyFullSchemaDDL } = await import('../test-helpers/scratchDbFullSchema.js');
    await applyFullSchemaDDL(client);
    await client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS _studix_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    cli = await import('./devResetCli.js');
    resetMod = await import('./devReset.js');
    identity = await import('./databaseIdentity.js');
    backupJs = await import('./backup.js');
  }, 120_000);

  afterAll(async () => {
    if (scratch) await scratchDbHelper.teardownScratchDb(scratch);
  });

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-devreset-cli-it-'));
    env = {
      DATABASE_URL: scratch.scratchUrl,
      STUDIX_DEV_TOOLS: '1',
      STUDIX_DEV_RESET_DATABASE: scratch.scratchDbName,
      STUDIX_BACKUP_DIR: path.join(root, 'backups'),
      STUDIX_RESTORE_LOCK_PATH: path.join(root, 'config', 'restore-state.lock'),
      STUDIX_DB_IDENTITY_PATH: path.join(root, 'config', 'db-identity.json'),
    };
    identity.ensureActiveDatabaseIdentity({ configPath: env.STUDIX_DB_IDENTITY_PATH });

    await client.$executeRawUnsafe(`TRUNCATE TABLE ${resetMod.RESET_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY`);
    for (const t of ['_studix_migrations', 'license_config', 'support_access_config', 'users', 'roles', 'center_profile', 'inventory_settings', 'teachers']) {
      await client.$executeRawUnsafe(`DELETE FROM "${t}"`);
    }
    for (const s of [
      `INSERT INTO _studix_migrations (version, name, checksum) VALUES (1, '001_baseline.sql', 'abc')`,
      `INSERT INTO license_config (id) VALUES (1)`,
      `INSERT INTO support_access_config (id) VALUES (1)`,
      `INSERT INTO roles (id, label, permissions) VALUES ('admin', 'مدير', '["students"]'::jsonb)`,
      `INSERT INTO users (id, name, role_id, is_admin, auth_version) VALUES ('admin', 'Admin', 'admin', true, 5)`,
      `INSERT INTO center_profile (id, name) VALUES (1, 'مركز')`,
      `INSERT INTO inventory_settings (id) VALUES (1)`,
      `INSERT INTO teachers (name) VALUES ('مدرس')`,
      `INSERT INTO groups (id, name, price, days) VALUES ('g1', 'G1', 100, '["sat"]'::jsonb)`,
      `INSERT INTO students (id, code, name, group_id) VALUES ('s1', 'C1', 'Student 1', 'g1'), ('s2', 'C2', 'Student 2', 'g1')`,
      `INSERT INTO cashboxes (id, name, opening_balance, active) VALUES ('cb_main', 'Main', 0, true)`,
      `INSERT INTO treasury_txn (id, cashbox_id, date, type, category, amount, method, status) VALUES ('t1', 'cb_main', '2026-01-05', 'income', 'other', 100, 'cash', 'active')`,
      `INSERT INTO payments (id, student_id, group_id, month, year, amount, date, status, method, pay_type, treasury_txn_id) VALUES ('p1', 's1', 'g1', 1, 2026, 100, '2026-01-05', 'paid', 'cash', 'subscription', 't1')`,
    ]) await client.$executeRawUnsafe(s);
  });

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  const count = async (t) => (await client.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${t}"`))[0].n;
  const dumpsIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.dump')) : []);
  const runCli = async (answer) => {
    const lines = [];
    const code = await cli.runDevResetCli({ env, configMode: 'development', prompt: async () => answer, print: (l) => lines.push(l) });
    return { code, out: lines.join('\n') };
  };

  it('refuses without the exact confirmation — nothing created, nothing changed', async () => {
    const before = identity.readActiveDatabaseIdentity({ configPath: env.STUDIX_DB_IDENTITY_PATH });
    const { code, out } = await runCli('reset studix data');
    expect(code).toBe(cli.EXIT.refused);
    expect(out).toMatch(/Confirmation phrase did not match/);
    expect(fs.existsSync(env.STUDIX_BACKUP_DIR)).toBe(false);
    expect(await count('students')).toBe(2);
    expect(identity.readActiveDatabaseIdentity({ configPath: env.STUDIX_DB_IDENTITY_PATH })).toEqual(before);
  });

  it('refuses while another client (a running backend) is connected — no backup, no reset, identity unchanged', async () => {
    await client.$queryRawUnsafe('SELECT 1'); // the test's own open connection plays the running backend
    const before = identity.readActiveDatabaseIdentity({ configPath: env.STUDIX_DB_IDENTITY_PATH });
    const { code, out } = await runCli(resetMod.RESET_CONFIRMATION_PHRASE);
    expect(code).toBe(cli.EXIT.refused);
    expect(out).toMatch(/other client connection\(s\).*Stop the backend/);
    expect(dumpsIn(path.join(env.STUDIX_BACKUP_DIR, 'dev-reset'))).toEqual([]);
    expect(await count('students')).toBe(2);
    expect(await count('payments')).toBe(1);
    expect(identity.readActiveDatabaseIdentity({ configPath: env.STUDIX_DB_IDENTITY_PATH })).toEqual(before);
  });

  it('success: verified pre-reset backup, data reset, preserved data kept, auth_version +1, identity rotated, backup readable afterwards', async () => {
    const preservedBefore = await client.$queryRawUnsafe(
      `SELECT (SELECT installation_id FROM support_access_config) AS installation_id,
              (SELECT count(*)::int FROM _studix_migrations) AS migrations,
              (SELECT count(*)::int FROM teachers) AS teachers,
              (SELECT count(*)::int FROM roles) AS roles`);
    const identityBefore = identity.readActiveDatabaseIdentity({ configPath: env.STUDIX_DB_IDENTITY_PATH });
    await client.$disconnect(); // the "backend" is stopped: no other client on the database

    const { code, out } = await runCli(resetMod.RESET_CONFIRMATION_PHRASE);
    expect(code).toBe(cli.EXIT.success);
    expect(out).toMatch(/✓ Backend is stopped/);
    expect(out).toMatch(/✓ Backup created and verified/);
    expect(out).toMatch(/✓ Database reset completed/);
    expect(out).toMatch(/✓ Database identity rotated/);
    expect(out).toMatch(/Developer reset completed successfully/);
    expect(out).not.toContain(scratch.scratchUrl);

    // verified backup in dev-reset/, still present and readable with pg_restore --list
    const devResetDir = path.join(env.STUDIX_BACKUP_DIR, 'dev-reset');
    const dumps = dumpsIn(devResetDir);
    expect(dumps).toHaveLength(1);
    expect(dumps[0]).toMatch(/^pre-reset-.*\.dump$/);
    const toc = execFileSync(backupJs.findPgRestore(), ['--list', path.join(devResetDir, dumps[0])], { encoding: 'utf8', windowsHide: true });
    expect(toc).toMatch(/TABLE DATA \S+ students /);
    expect(toc).toMatch(/TABLE DATA \S+ payments /);

    // reset data removed, preserved data kept, sessions invalidated
    expect(await count('students')).toBe(0);
    expect(await count('payments')).toBe(0);
    expect(await count('cashboxes')).toBe(0);
    const [{ auth_version: authVersion }] = await client.$queryRawUnsafe(`SELECT auth_version FROM users WHERE id = 'admin'`);
    expect(authVersion).toBe(6);
    const preservedAfter = await client.$queryRawUnsafe(
      `SELECT (SELECT installation_id FROM support_access_config) AS installation_id,
              (SELECT count(*)::int FROM _studix_migrations) AS migrations,
              (SELECT count(*)::int FROM teachers) AS teachers,
              (SELECT count(*)::int FROM roles) AS roles`);
    expect(preservedAfter).toEqual(preservedBefore);
    const [log] = await client.$queryRawUnsafe('SELECT action FROM activity_logs');
    expect(log.action).toBe('dev_reset');

    // identity rotated (new id, valid active identity), locks released
    const identityAfter = identity.readActiveDatabaseIdentity({ configPath: env.STUDIX_DB_IDENTITY_PATH });
    expect(identityAfter.role).toBe('active');
    expect(identityAfter.id).not.toBe(identityBefore.id);
    expect(fs.existsSync(env.STUDIX_RESTORE_LOCK_PATH)).toBe(false);
    expect(fs.existsSync(path.join(env.STUDIX_BACKUP_DIR, '.routine-backup.lock'))).toBe(false);
  });
});
