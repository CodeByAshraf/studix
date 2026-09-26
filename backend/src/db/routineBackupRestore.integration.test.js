// backend/src/db/routineBackupRestore.integration.test.js
// P1-1 — the real, disposable-PostgreSQL proof of the complete operator cycle:
//
//   seed data -> ROUTINE backup (runRoutineBackup: real bundled pg_dump.exe + real pg_restore
//   --list verification) -> data damaged -> operator restore of the newest routine backup
//   (runRestoreOrchestrator -> 'verified' candidate) -> database switch (performDatabaseSwitch
//   -> 'active') -> original data is back in the production name, the damaged database is kept
//   as the archive -> the next routine backup succeeds against the restored database.
//
// Plus real failure cases: corrupt backup (verification and restore both refuse it, production
// untouched), pg_dump failure, PostgreSQL unavailable, and the real CLI's --list/--verify.
//
// Safety: every database/role name carries the disposable marker and is re-checked before any
// destructive action; the "production" database here is a disposable database, never the real
// "studix"; backups/logs/admin.env/restore-state live in throwaway temp directories, never
// %ProgramData%\Studix. Same discipline as databaseSwitch.integration.test.js.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { checkPostgresReachable } from '../test-helpers/scratchDb.js';
import { createDatabaseIfMissing, ensureAppRole, bootstrapDatabase } from './bootstrapDatabase.js';
import { buildDatabaseUrl } from './postgresProvisioning.js';
import { runMigrations } from './migrationRunner.js';
import { listRoutineBackups, verifyBackupArchive, readBackupStatus } from './backup.js';
import { runRoutineBackup } from './routineBackup.js';
import { runRestoreOrchestrator, resolveLatestRoutineBackupPath } from './restoreDatabase.js';
import { readRestoreState } from './restoreState.js';
import { ensureActiveDatabaseIdentity } from './databaseIdentity.js';
import { performDatabaseSwitch } from './databaseSwitch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', '..', 'prisma', 'studix-schema.sql');
const ROUTINE_BACKUP_CLI = path.join(__dirname, 'routineBackup.js');
const REAL_INSTALLED_PG_HOME = 'C:\\Program Files\\Studix\\pgsql';
const bundledBinariesExist =
  fs.existsSync(path.join(REAL_INSTALLED_PG_HOME, 'bin', 'pg_dump.exe')) &&
  fs.existsSync(path.join(REAL_INSTALLED_PG_HOME, 'bin', 'pg_restore.exe'));

const dbCheck = await checkPostgresReachable();

const FORBIDDEN_DB_NAME = 'studix';
const SCRATCH_MARKER = 'p11rb';

function assertDisposable(name) {
  if (name === FORBIDDEN_DB_NAME) throw new Error(`SAFETY VIOLATION: "${name}" is the production database name.`);
  if (!String(name).includes(SCRATCH_MARKER)) throw new Error(`SAFETY VIOLATION: "${name}" lacks the disposable marker "${SCRATCH_MARKER}".`);
}

function assertNeverRealProgramData(p) {
  const normalized = String(p).toLowerCase();
  if (normalized.includes('programdata\\studix')) {
    throw new Error(`SAFETY VIOLATION: path "${p}" references a real Studix ProgramData location.`);
  }
}

describe('production safety guards — pure, no DB', () => {
  it('rejects the production name, unmarked names, and real ProgramData paths', () => {
    expect(() => assertDisposable('studix')).toThrow(/production/);
    expect(() => assertDisposable('other')).toThrow(/marker/);
    expect(() => assertNeverRealProgramData('C:\\ProgramData\\Studix\\backups\\x.dump')).toThrow();
  });
});

describe('P1-1 — routine backup -> operator restore -> switch, REAL disposable end-to-end', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }
  if (!bundledBinariesExist) {
    it.skip(`SKIPPED — bundled pg_dump.exe/pg_restore.exe not found at ${REAL_INSTALLED_PG_HOME}\\bin.`, () => {});
    return;
  }

  let workDir;
  let backupDir;
  let logDir;
  const savedEnv = {};
  const ENV_KEYS = ['STUDIX_BACKUP_DIR', 'STUDIX_LOG_DIR'];
  const env = {};

  beforeAll(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), `studix-${SCRATCH_MARKER}-work-`));
    backupDir = path.join(workDir, 'backups');
    logDir = path.join(workDir, 'logs');
    fs.mkdirSync(backupDir);
    assertNeverRealProgramData(backupDir);
    process.env.STUDIX_BACKUP_DIR = backupDir; // resolveLatestRoutineBackupPath/getBackupDir default
    process.env.STUDIX_LOG_DIR = logDir; // the real logger writes here, never %ProgramData%

    const realUrl = process.env.DATABASE_URL;
    if (!realUrl) throw new Error('DATABASE_URL غير معرَّف في بيئة الاختبار.');
    env.host = new URL(realUrl).hostname;
    env.port = Number(new URL(realUrl).port);
    env.dbName = `${SCRATCH_MARKER}prod${crypto.randomBytes(4).toString('hex')}`;
    assertDisposable(env.dbName);
    env.adminRole = `${SCRATCH_MARKER}_admin_${crypto.randomBytes(4).toString('hex')}`;
    env.appRole = `${SCRATCH_MARKER}_app_${crypto.randomBytes(4).toString('hex')}`;
    env.adminPassword = `Adm1n${crypto.randomBytes(12).toString('hex')}`;
    env.appPassword = crypto.randomBytes(16).toString('hex');

    env.postgresMaintenanceUrl = buildDatabaseUrl({ user: 'postgres', password: new URL(realUrl).password, host: env.host, port: env.port, database: 'postgres' });
    await ensureTestSuperuserRole(env.postgresMaintenanceUrl, env.adminRole, env.adminPassword);
    env.adminMaintenanceUrl = buildDatabaseUrl({ user: env.adminRole, password: env.adminPassword, host: env.host, port: env.port, database: 'postgres' });
    await createDatabaseIfMissing(env.adminMaintenanceUrl, env.dbName);
    env.adminUrl = buildDatabaseUrl({ user: env.adminRole, password: env.adminPassword, host: env.host, port: env.port, database: env.dbName });

    await bootstrapDatabase({ databaseUrl: env.adminUrl, schemaPath: SCHEMA_PATH });
    const migrationPrisma = new PrismaClient({ datasources: { db: { url: env.adminUrl } } });
    try {
      await runMigrations(migrationPrisma, { databaseUrl: env.adminUrl });
      await migrationPrisma.support_access_config.create({ data: { id: 1 } });
    } finally {
      await migrationPrisma.$disconnect().catch(() => {});
    }
    await ensureAppRole(env.adminUrl, { appUser: env.appRole, appPassword: env.appPassword, host: env.host, port: env.port });
    env.appUrl = (dbName) => buildDatabaseUrl({ user: env.appRole, password: env.appPassword, host: env.host, port: env.port, database: dbName });

    env.adminEnvPath = path.join(workDir, 'admin.env');
    fs.writeFileSync(env.adminEnvPath, `STUDIX_DB_ADMIN_URL=${env.adminUrl}\n`, 'utf8');
    env.restoreStatePath = path.join(workDir, 'restore-state.json');
    env.dbIdentityPath = path.join(workDir, 'db-identity.json');
    ensureActiveDatabaseIdentity({ configPath: env.dbIdentityPath });

    env.archiveNames = [];
    env.candidateNames = [];
  }, 120_000);

  afterAll(async () => {
    const names = new Set([env.dbName, ...(env.archiveNames || []), ...(env.candidateNames || [])].filter(Boolean));
    for (const name of names) {
      try {
        assertDisposable(name);
        // eslint-disable-next-line no-await-in-loop
        await dropTestDatabase(env.adminMaintenanceUrl, name);
      } catch (err) {
        console.warn(`[teardown] could not drop database "${name}": ${err.message}`);
      }
    }
    if (env.postgresMaintenanceUrl) {
      await dropTestRole(env.postgresMaintenanceUrl, env.appRole).catch(() => {});
      await dropTestRole(env.postgresMaintenanceUrl, env.adminRole).catch(() => {});
    }
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  }, 120_000);

  const backupOpts = (overrides = {}) => ({
    backupDir,
    adminConfigPath: env.adminEnvPath,
    restoreStateConfigPath: env.restoreStatePath,
    sourceDbName: env.dbName,
    pgHome: REAL_INSTALLED_PG_HOME,
    ...overrides,
  });

  function readAllLogs() {
    if (!fs.existsSync(logDir)) return '';
    return fs.readdirSync(logDir).map((f) => fs.readFileSync(path.join(logDir, f), 'utf8')).join('\n');
  }

  let seeded;
  let firstBackup;

  it('1. a routine backup of real seeded data succeeds and is genuinely verified (real pg_dump + pg_restore --list)', async () => {
    seeded = await withClient(env.appUrl(env.dbName), seedCoreData);

    const result = await runRoutineBackup(backupOpts());

    expect(result.status).toBe('success');
    expect(result.backup.verified).toBe(true);
    expect(result.retention.errors).toEqual([]);
    const backups = listRoutineBackups({ backupDir });
    expect(backups).toHaveLength(1);
    firstBackup = backups[0];
    assertNeverRealProgramData(firstBackup.path);
    expect(fs.readdirSync(backupDir).some((f) => f.endsWith('.partial'))).toBe(false);

    // independent re-verification with the real pg_restore.exe
    const v = verifyBackupArchive(firstBackup.path, { pgRestorePath: path.join(REAL_INSTALLED_PG_HOME, 'bin', 'pg_restore.exe') });
    expect(v.sizeBytes).toBeGreaterThan(0);

    const status = readBackupStatus({ backupDir });
    expect(status.lastSuccess.backup.fileName).toBe(firstBackup.fileName);

    // no credential anywhere in the log, the status file, or the result
    const logs = readAllLogs();
    expect(logs).toContain(firstBackup.fileName);
    for (const text of [logs, JSON.stringify(status), JSON.stringify(result)]) {
      expect(text).not.toContain(env.adminPassword);
      expect(text).not.toMatch(/postgres(ql)?:\/\/[^[\s]/);
    }
  }, 120_000);

  it('2. the real CLI: --list shows the backup, --verify accepts it and rejects a corrupt copy (exit code 1)', () => {
    const childEnv = { ...process.env, STUDIX_BACKUP_DIR: backupDir, STUDIX_LOG_DIR: logDir, STUDIX_PG_HOME: REAL_INSTALLED_PG_HOME };
    const listed = JSON.parse(execFileSync(process.execPath, [ROUTINE_BACKUP_CLI, '--list'], { env: childEnv, encoding: 'utf8' }));
    expect(listed.backups.map((b) => b.fileName)).toEqual([firstBackup.fileName]);

    const verified = JSON.parse(execFileSync(process.execPath, [ROUTINE_BACKUP_CLI, '--verify', firstBackup.path], { env: childEnv, encoding: 'utf8' }));
    expect(verified.ok).toBe(true);

    const corruptPath = path.join(workDir, 'corrupt-copy.dump');
    const bytes = fs.readFileSync(firstBackup.path);
    fs.writeFileSync(corruptPath, bytes.subarray(0, Math.floor(bytes.length / 3)));
    let exitCode = 0;
    try {
      execFileSync(process.execPath, [ROUTINE_BACKUP_CLI, '--verify', corruptPath], { env: childEnv, encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
      exitCode = err.status;
    }
    expect(exitCode).toBe(1);
  }, 60_000);

  it('3. a corrupt backup is refused by the restore orchestrator — production is never touched', async () => {
    const corruptPath = path.join(workDir, 'truncated.dump');
    const bytes = fs.readFileSync(firstBackup.path);
    fs.writeFileSync(corruptPath, bytes.subarray(0, 64));

    await expect(runRestoreOrchestrator({
      backupPath: corruptPath,
      sourceDbName: env.dbName,
      adminConfigPath: env.adminEnvPath,
      restoreStateConfigPath: env.restoreStatePath,
      pgHome: REAL_INSTALLED_PG_HOME,
    })).rejects.toThrow();

    const state = readRestoreState({ configPath: env.restoreStatePath });
    expect(state.status).toBe('failed');
    if (state.candidateDb) env.candidateNames.push(state.candidateDb);
    expect(state.error).not.toContain(env.adminPassword);

    // production still holds exactly the seeded data
    const student = await withClient(env.appUrl(env.dbName), (c) => c.students.findUnique({ where: { id: seeded.student.id } }));
    expect(student.name).toBe(seeded.student.name);
  }, 120_000);

  it('4. full operator cycle: damage data -> restore newest routine backup -> switch -> original data back, damaged DB archived, next backup succeeds', async () => {
    // "disaster": data is damaged after the backup was taken
    await withClient(env.appUrl(env.dbName), async (c) => {
      await c.students.update({ where: { id: seeded.student.id }, data: { name: 'DAMAGED' } });
      await c.attendance.delete({ where: { id: seeded.attendance.id } });
      await c.students.create({ data: { id: 'stu_p11rb_after', code: 'P11RB-9999', name: 'created after backup', phone: '01000000011', group_id: seeded.group.id, status: 'active', monthly_fee: 1 } });
    });

    // operator step 1: restore the newest routine backup into a verified candidate
    const latest = resolveLatestRoutineBackupPath();
    expect(latest).toBe(firstBackup.path);
    const restored = await runRestoreOrchestrator({
      backupPath: latest,
      sourceDbName: env.dbName,
      adminConfigPath: env.adminEnvPath,
      restoreStateConfigPath: env.restoreStatePath,
      pgHome: REAL_INSTALLED_PG_HOME,
    });
    expect(restored.status).toBe('verified');
    assertDisposable(restored.candidateDb);
    env.candidateNames.push(restored.candidateDb);

    // operator step 2: switch (the same core the Settings button / databaseSwitch.js CLI runs)
    const appState = { running: true };
    const switched = await performDatabaseSwitch({
      productionDbName: env.dbName,
      candidateDb: restored.candidateDb,
      adminConfigPath: env.adminEnvPath,
      restoreStateConfigPath: env.restoreStatePath,
      dbIdentityConfigPath: env.dbIdentityPath,
      stopAppFn: async () => { appState.running = false; },
      startAppFn: async () => { appState.running = true; },
      getAppStatusFn: async () => ({ running: appState.running }),
      buildRuntimeUrlFn: (dbName) => env.appUrl(dbName),
    });
    expect(switched.status).toBe('active');
    assertDisposable(switched.renamedPreviousDb);
    env.archiveNames.push(switched.renamedPreviousDb);
    expect(readRestoreState({ configPath: env.restoreStatePath }).status).toBe('active');

    // the production name now holds the ORIGINAL data — every core table
    await withClient(env.appUrl(env.dbName), async (c) => {
      expect((await c.students.findUnique({ where: { id: seeded.student.id } })).name).toBe(seeded.student.name);
      expect(await c.students.findUnique({ where: { id: 'stu_p11rb_after' } })).toBeNull();
      expect(await c.attendance.findUnique({ where: { id: seeded.attendance.id } })).not.toBeNull();
      expect(Number((await c.payments.findUnique({ where: { id: seeded.payment.id } })).amount)).toBe(300);
      expect(Number((await c.treasury_txn.findUnique({ where: { id: seeded.treasury.id } })).amount)).toBe(300);
      expect(await c.groups.findUnique({ where: { id: seeded.group.id } })).not.toBeNull();
    });

    // the damaged database is kept, not deleted
    await withClient(env.appUrl(switched.renamedPreviousDb), async (c) => {
      expect((await c.students.findUnique({ where: { id: seeded.student.id } })).name).toBe('DAMAGED');
    });

    // routine backups keep working against the restored database
    const next = await runRoutineBackup(backupOpts());
    expect(next.status).toBe('success');
    expect(listRoutineBackups({ backupDir })).toHaveLength(2);
  }, 240_000);

  it('5. pg_dump failure (database missing) -> failed(dump_failed), nothing published, no credential in the error', async () => {
    const before = listRoutineBackups({ backupDir }).map((b) => b.fileName);
    const result = await runRoutineBackup(backupOpts({ sourceDbName: `${SCRATCH_MARKER}missing${crypto.randomBytes(3).toString('hex')}` }));
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('dump_failed');
    expect(result.error).not.toContain(env.adminPassword);
    expect(listRoutineBackups({ backupDir }).map((b) => b.fileName)).toEqual(before);
    expect(fs.readdirSync(backupDir).some((f) => f.endsWith('.partial'))).toBe(false);
    expect(readBackupStatus({ backupDir }).lastRun.status).toBe('failed');
    expect(readAllLogs()).not.toContain(env.adminPassword);
  }, 60_000);

  it('6. PostgreSQL unavailable -> failed(postgres_unavailable) after the bounded wait, previous backups untouched', async () => {
    const before = listRoutineBackups({ backupDir }).map((b) => b.fileName);
    const deadEnvPath = path.join(workDir, 'admin-dead.env');
    const deadUrl = buildDatabaseUrl({ user: env.adminRole, password: env.adminPassword, host: '127.0.0.1', port: 1, database: env.dbName });
    fs.writeFileSync(deadEnvPath, `STUDIX_DB_ADMIN_URL=${deadUrl}\n`, 'utf8');

    const result = await runRoutineBackup(backupOpts({ adminConfigPath: deadEnvPath, postgresReadyTimeoutMs: 1500 }));

    expect(result.status).toBe('failed');
    expect(result.reason).toBe('postgres_unavailable');
    expect(result.error).not.toContain(env.adminPassword);
    expect(listRoutineBackups({ backupDir }).map((b) => b.fileName)).toEqual(before);
    expect(readBackupStatus({ backupDir }).lastSuccess.status).toBe('success');
  }, 60_000);
});

// ── local helpers (same pattern as databaseSwitch.integration.test.js) ──────────────────────

async function withClient(url, fn) {
  const client = new PrismaClient({ datasources: { db: { url } } });
  try {
    return await fn(client);
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

async function seedCoreData(prisma) {
  const teacher = await prisma.teachers.create({ data: { name: 'أ. اختبار P1-1' } });
  const parent = await prisma.parents.create({ data: { full_name: 'ولي أمر P1-1', phone: '01000000012' } });
  const group = await prisma.groups.create({
    data: { id: 'grp_p11rb_1', name: 'مجموعة P1-1', subject: 'رياضيات', grade: 'الثالث', time: '10:00', days: [], max: 10, color: '#333', teacher_name: teacher.name },
  });
  const student = await prisma.students.create({
    data: { id: 'stu_p11rb_1', code: 'P11RB-0001', name: 'طالب النسخ الاحتياطي', phone: '01000000013', parent_id: parent.id, group_id: group.id, status: 'active', monthly_fee: 300 },
  });
  const cashbox = await prisma.cashboxes.create({ data: { id: 'cb_p11rb_1', name: 'خزنة P1-1', is_default: true } });
  const treasury = await prisma.treasury_txn.create({
    data: { id: 'tx_p11rb_1', cashbox_id: cashbox.id, date: new Date('2026-09-01'), type: 'income', category: 'subscription', amount: 300 },
  });
  const payment = await prisma.payments.create({
    data: { id: 'pay_p11rb_1', student_id: student.id, group_id: group.id, month: 9, year: 2026, amount: 300, date: new Date('2026-09-01'), status: 'paid', treasury_txn_id: treasury.id },
  });
  const attendance = await prisma.attendance.create({
    data: { id: 'att_p11rb_1', student_id: student.id, group_id: group.id, date: new Date('2026-09-02'), status: 'present' },
  });
  return { teacher, parent, group, student, cashbox, treasury, payment, attendance };
}

async function ensureTestSuperuserRole(maintenanceUrl, roleName, password) {
  const client = new PrismaClient({ datasources: { db: { url: maintenanceUrl } } });
  try {
    const existing = await client.$queryRawUnsafe(`SELECT 1 FROM pg_roles WHERE rolname = '${roleName}'`);
    if (existing.length === 0) {
      await client.$executeRawUnsafe(`CREATE ROLE "${roleName}" LOGIN SUPERUSER CREATEDB PASSWORD '${password}'`);
    } else {
      await client.$executeRawUnsafe(`ALTER ROLE "${roleName}" PASSWORD '${password}'`);
    }
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

async function dropTestRole(maintenanceUrl, roleName) {
  const client = new PrismaClient({ datasources: { db: { url: maintenanceUrl } } });
  try {
    await client.$executeRawUnsafe(`DROP ROLE IF EXISTS "${roleName}"`);
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

async function dropTestDatabase(maintenanceUrl, dbName) {
  assertDisposable(dbName);
  const client = new PrismaClient({ datasources: { db: { url: maintenanceUrl } } });
  try {
    await client.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`
    );
    await client.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
  } finally {
    await client.$disconnect().catch(() => {});
  }
}
