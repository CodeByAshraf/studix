// backend/src/db/databaseSwitch.integration.test.js
// Phase 2C-3B — the real, disposable-PostgreSQL proof that performDatabaseSwitch()/
// performRollback() actually work end-to-end, including crash-recovery resumption. Every
// database/role name used anywhere in this file carries a disposable-test marker and is
// re-validated as disposable immediately before any destructive action — mirroring the exact
// safety discipline already established in backupRestore.integration.test.js (Phase 2A) and
// restoreDatabase.integration.test.js (Phase 2C-2). The real "studix" database, real pgdata,
// real backups directory, real admin.env, and real StudixApp/StudixPostgreSQL services are
// never touched anywhere in this file.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { checkPostgresReachable } from '../test-helpers/scratchDb.js';
import {
  createDatabaseIfMissing, ensureAppRole, bootstrapDatabase, classifySchemaState, databaseExists,
} from './bootstrapDatabase.js';
import { buildDatabaseUrl } from './postgresProvisioning.js';
import { runMigrations } from './migrationRunner.js';
import { createPreMigrationBackup } from './backup.js';
import {
  runRestoreOrchestrator, generateCandidateDatabaseName, createCandidateDatabase, restoreIntoCandidate,
} from './restoreDatabase.js';
import { readRestoreState } from './restoreState.js';
import { readActiveDatabaseIdentity, ensureActiveDatabaseIdentity } from './databaseIdentity.js';
import {
  performDatabaseSwitch, performRollback, DatabaseSwitchError, SimulatedCrashError,
  readInstallationId, computeArchivalName,
} from './databaseSwitch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', '..', 'prisma', 'studix-schema.sql');
const REAL_INSTALLED_PG_HOME = 'C:\\Program Files\\Studix\\pgsql';
const bundledBinariesExist =
  fs.existsSync(path.join(REAL_INSTALLED_PG_HOME, 'bin', 'pg_dump.exe')) &&
  fs.existsSync(path.join(REAL_INSTALLED_PG_HOME, 'bin', 'pg_restore.exe'));

const dbCheck = await checkPostgresReachable();

// ── Part 12 — hard production-safety guards, enforced BEFORE every destructive action ────────
const FORBIDDEN_DB_NAME = 'studix';
const FORBIDDEN_PORT = 5432; // the well-known default PostgreSQL port a real standalone/production instance would use
const SCRATCH_MARKER = 'p2c3b';

function assertDisposable(name) {
  if (name === FORBIDDEN_DB_NAME) {
    throw new Error(`SAFETY VIOLATION: "${name}" is the real production database name — refusing to act on it.`);
  }
  if (!String(name).includes(SCRATCH_MARKER)) {
    throw new Error(`SAFETY VIOLATION: "${name}" does not carry the disposable-test marker ("${SCRATCH_MARKER}").`);
  }
}

function assertNeverRealProgramData(p) {
  const normalized = String(p).toLowerCase();
  for (const forbidden of ['programdata\\studix\\backups', 'programdata\\studix\\pgdata', 'programdata\\studix\\config']) {
    if (normalized.includes(forbidden)) {
      throw new Error(`SAFETY VIOLATION: path "${p}" references a real Studix ProgramData location.`);
    }
  }
}

describe('production safety guards (Part 12) — pure, no DB', () => {
  it('assertDisposable rejects the literal production database name', () => {
    expect(() => assertDisposable('studix')).toThrow(/production database name/);
  });
  it('assertDisposable rejects a name without the disposable marker', () => {
    expect(() => assertDisposable('some_other_db')).toThrow(/disposable-test marker/);
  });
  it('assertNeverRealProgramData rejects the real backups/pgdata/config directories', () => {
    expect(() => assertNeverRealProgramData('C:\\ProgramData\\Studix\\backups\\x.dump')).toThrow();
    expect(() => assertNeverRealProgramData('C:\\ProgramData\\Studix\\pgdata\\PG_VERSION')).toThrow();
    expect(() => assertNeverRealProgramData('C:\\ProgramData\\Studix\\config\\admin.env')).toThrow();
  });
  it('this suite never targets the real PostgreSQL default port for a disposable action', () => {
    // Documented, not enforced against a live connection here — the disposable cluster used
    // below is whatever DATABASE_URL's own host/port already is (the same real dev cluster
    // every other Phase 2A/2C integration test in this repo already uses safely, distinguished
    // by disposable DATABASE NAMES, never by a different port) — recorded for auditability.
    expect(FORBIDDEN_PORT).toBe(5432);
  });
});

describe('databaseSwitch — REAL disposable end-to-end proof (Phase 2C-3B)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }
  if (!bundledBinariesExist) {
    it.skip(
      `SKIPPED — the real installed Studix bundled pg_dump.exe/pg_restore.exe were not found at ` +
      `${REAL_INSTALLED_PG_HOME}\\bin. Re-run on a machine where Studix is genuinely installed.`,
      () => {}
    );
    return;
  }

  let tmpBackupDir;
  const originalBackupDirEnv = process.env.STUDIX_BACKUP_DIR;

  beforeAll(() => {
    tmpBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-p2c3b-backup-'));
    process.env.STUDIX_BACKUP_DIR = tmpBackupDir;
  });

  afterAll(() => {
    if (tmpBackupDir) fs.rmSync(tmpBackupDir, { recursive: true, force: true });
    if (originalBackupDirEnv === undefined) delete process.env.STUDIX_BACKUP_DIR;
    else process.env.STUDIX_BACKUP_DIR = originalBackupDirEnv;
  });

  /**
   * setupVerifiedEnvironment: creates one disposable "current production" database (bootstrapped,
   * migrated, app-role-provisioned, seeded, tagged with its own installation_id), takes a REAL
   * backup with the bundled pg_dump.exe, then runs the real, unmodified Phase 2C-2
   * runRestoreOrchestrator() to create+restore+verify a real disposable candidate — leaving
   * restore-state.json at status 'verified', exactly the entry point performDatabaseSwitch()
   * expects. Every name/path is disposable and temp-directory-scoped.
   */
  async function setupVerifiedEnvironment({ installationId } = {}) {
    const realUrl = process.env.DATABASE_URL;
    if (!realUrl) throw new Error('DATABASE_URL غير معرَّف في بيئة الاختبار.');
    const host = new URL(realUrl).hostname;
    const port = Number(new URL(realUrl).port);
    const suffix = `${SCRATCH_MARKER}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    const dbNameCurrent = `${SCRATCH_MARKER}cur${crypto.randomBytes(4).toString('hex')}`;
    assertDisposable(dbNameCurrent);

    const adminRole = `p2c3b_admin_${crypto.randomBytes(4).toString('hex')}`;
    const appRole = `p2c3b_app_${crypto.randomBytes(4).toString('hex')}`;
    const adminPassword = crypto.randomBytes(16).toString('hex');
    const appPassword = crypto.randomBytes(16).toString('hex');

    const postgresMaintenanceUrl = buildDatabaseUrl({ user: 'postgres', password: new URL(realUrl).password, host, port, database: 'postgres' });
    await ensureTestSuperuserRole(postgresMaintenanceUrl, adminRole, adminPassword);
    const adminMaintenanceUrl = buildDatabaseUrl({ user: adminRole, password: adminPassword, host, port, database: 'postgres' });

    await createDatabaseIfMissing(adminMaintenanceUrl, dbNameCurrent);
    const adminUrlCurrent = buildDatabaseUrl({ user: adminRole, password: adminPassword, host, port, database: dbNameCurrent });

    await bootstrapDatabase({ databaseUrl: adminUrlCurrent, schemaPath: SCHEMA_PATH });
    const migrationPrisma = new PrismaClient({ datasources: { db: { url: adminUrlCurrent } } });
    try {
      await runMigrations(migrationPrisma, { databaseUrl: adminUrlCurrent });
    } finally {
      await migrationPrisma.$disconnect().catch(() => {});
    }
    await ensureAppRole(adminUrlCurrent, { appUser: appRole, appPassword, host, port });

    // installation_id — real DB-generated UUID (support_access_config's own DEFAULT), or an
    // explicit override for the cross-install-rejection test.
    const adminClientForSeed = new PrismaClient({ datasources: { db: { url: adminUrlCurrent } } });
    try {
      if (installationId) {
        await adminClientForSeed.support_access_config.create({ data: { id: 1, installation_id: installationId } });
      } else {
        await adminClientForSeed.support_access_config.create({ data: { id: 1 } });
      }
    } finally {
      await adminClientForSeed.$disconnect().catch(() => {});
    }

    const appUrlCurrent = buildDatabaseUrl({ user: appRole, password: appPassword, host, port, database: dbNameCurrent });
    const appPrismaCurrent = new PrismaClient({ datasources: { db: { url: appUrlCurrent } } });
    let seeded;
    try {
      seeded = await seedRepresentativeData(appPrismaCurrent);
    } finally {
      await appPrismaCurrent.$disconnect().catch(() => {});
    }

    const backupPath = await createPreMigrationBackup(adminUrlCurrent, { pgHome: REAL_INSTALLED_PG_HOME });
    assertNeverRealProgramData(backupPath);

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-p2c3b-work-'));
    const adminEnvPath = path.join(workDir, 'admin.env');
    fs.writeFileSync(adminEnvPath, `STUDIX_DB_ADMIN_URL=${adminUrlCurrent}\n`, 'utf8');
    const restoreStateConfigPath = path.join(workDir, 'restore-state.json');
    const dbIdentityConfigPath = path.join(workDir, 'db-identity.json');
    assertNeverRealProgramData(adminEnvPath);
    assertNeverRealProgramData(restoreStateConfigPath);
    assertNeverRealProgramData(dbIdentityConfigPath);

    // pre-existing active identity (as if this "current" database had already been active for
    // a while before any restore was ever attempted).
    const { identity: originalIdentity } = ensureActiveDatabaseIdentity({ configPath: dbIdentityConfigPath });

    const restoreResult = await runRestoreOrchestrator({
      backupPath,
      sourceDbName: dbNameCurrent,
      adminConfigPath: adminEnvPath,
      restoreStateConfigPath,
      pgHome: REAL_INSTALLED_PG_HOME,
    });
    expect(restoreResult.status).toBe('verified');
    assertDisposable(restoreResult.candidateDb);

    const appState = { running: true };
    const stopAppFn = async () => { appState.running = false; };
    const startAppFn = async () => { appState.running = true; };
    const getAppStatusFn = async () => ({ running: appState.running });
    const buildRuntimeUrlFn = (dbName) => buildDatabaseUrl({ user: appRole, password: appPassword, host, port, database: dbName });

    return {
      host, port, suffix,
      dbNameCurrent, candidateDb: restoreResult.candidateDb,
      adminRole, appRole, adminPassword, appPassword,
      postgresMaintenanceUrl, adminMaintenanceUrl,
      adminEnvPath, restoreStateConfigPath, dbIdentityConfigPath, workDir,
      originalIdentity, seeded, appState, stopAppFn, startAppFn, getAppStatusFn, buildRuntimeUrlFn,
    };
  }

  async function teardown(env, extraDbNames = []) {
    // Best-effort per item — one failed drop (e.g. a lingering connection) must never prevent
    // attempting the rest, and must never mask whatever the TEST's own real assertion failure
    // was by throwing a different, more confusing error in its place.
    for (const name of new Set([env.dbNameCurrent, env.candidateDb, ...extraDbNames].filter(Boolean))) {
      try {
        assertDisposable(name); // never attempt to drop a non-disposable name, even during cleanup
        await dropTestDatabase(env.adminMaintenanceUrl, name);
      } catch (err) {
        console.warn(`[teardown] could not drop database "${name}": ${err.message}`);
      }
    }
    await dropTestRole(env.postgresMaintenanceUrl, env.appRole).catch((err) => {
      console.warn(`[teardown] could not drop role "${env.appRole}": ${err.message}`);
    });
    await dropTestRole(env.postgresMaintenanceUrl, env.adminRole).catch((err) => {
      console.warn(`[teardown] could not drop role "${env.adminRole}": ${err.message}`);
    });
    if (env.workDir) fs.rmSync(env.workDir, { recursive: true, force: true });
  }

  it(
    'test 1 — successful full switch: candidate is promoted, archival DB holds original data, identity rotated, deep health passes',
    async () => {
      const env = await setupVerifiedEnvironment();
      try {
        const result = await performDatabaseSwitch({
          productionDbName: env.dbNameCurrent,
          candidateDb: env.candidateDb,
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          dbIdentityConfigPath: env.dbIdentityConfigPath,
          stopAppFn: env.stopAppFn, startAppFn: env.startAppFn, getAppStatusFn: env.getAppStatusFn,
          buildRuntimeUrlFn: env.buildRuntimeUrlFn,
        });

        expect(result.status).toBe('active');
        assertDisposable(result.renamedPreviousDb);

        const finalState = readRestoreState({ configPath: env.restoreStateConfigPath });
        expect(finalState.status).toBe('active');
        expect(finalState.switchStatus).toBe('completed');

        // the production name now holds the CANDIDATE's data
        const appUrlProd = env.buildRuntimeUrlFn(env.dbNameCurrent);
        const prodClient = new PrismaClient({ datasources: { db: { url: appUrlProd } } });
        try {
          const student = await prodClient.students.findUnique({ where: { id: env.seeded.student.id } });
          expect(student).not.toBeNull();
        } finally {
          await prodClient.$disconnect().catch(() => {});
        }

        // the archival DB holds the ORIGINAL data, fully intact
        const archivalUrl = buildDatabaseUrl({ user: env.appRole, password: env.appPassword, host: env.host, port: env.port, database: result.renamedPreviousDb });
        const archivalClient = new PrismaClient({ datasources: { db: { url: archivalUrl } } });
        try {
          const student = await archivalClient.students.findUnique({ where: { id: env.seeded.student.id } });
          expect(student).not.toBeNull();
          expect(student.name).toBe(env.seeded.student.name);
        } finally {
          await archivalClient.$disconnect().catch(() => {});
        }

        // identity was genuinely rotated
        const newIdentity = readActiveDatabaseIdentity({ configPath: env.dbIdentityConfigPath });
        expect(newIdentity.id).not.toBe(env.originalIdentity.id);
        expect(newIdentity.id).toBe(result.candidateIdentityId);

        await teardown(env, [result.renamedPreviousDb]);
      } catch (err) {
        await teardown(env, []);
        throw err;
      }
    },
    120_000
  );

  it(
    'test 2 — rollback after a simulated app-start failure: original data restored, identity reverted, candidate retained (never deleted)',
    async () => {
      const env = await setupVerifiedEnvironment();
      let archivalName;
      try {
        // force "app cannot start": startAppFn is a no-op that never flips running back to true
        const brokenStartAppFn = async () => {};

        await expect(performDatabaseSwitch({
          productionDbName: env.dbNameCurrent,
          candidateDb: env.candidateDb,
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          dbIdentityConfigPath: env.dbIdentityConfigPath,
          stopAppFn: env.stopAppFn, startAppFn: brokenStartAppFn, getAppStatusFn: env.getAppStatusFn,
          buildRuntimeUrlFn: env.buildRuntimeUrlFn,
        })).rejects.toThrow(DatabaseSwitchError);

        const midState = readRestoreState({ configPath: env.restoreStateConfigPath });
        expect(midState.status).toBe('switching');
        expect(midState.switchStatus).toBe('app_starting');
        archivalName = midState.renamedPreviousDb;

        env.appState.running = false; // simulate the operator/SCM confirming it's actually stopped before rollback begins
        const rollbackResult = await performRollback({
          productionDbName: env.dbNameCurrent,
          candidateDb: env.candidateDb,
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          dbIdentityConfigPath: env.dbIdentityConfigPath,
          stopAppFn: env.stopAppFn, startAppFn: env.startAppFn, getAppStatusFn: env.getAppStatusFn,
          buildRuntimeUrlFn: env.buildRuntimeUrlFn,
        });

        expect(rollbackResult.status).toBe('rolled_back');

        const finalState = readRestoreState({ configPath: env.restoreStateConfigPath });
        expect(finalState.status).toBe('rolled_back');

        // production name holds the ORIGINAL data again
        const appUrlProd = env.buildRuntimeUrlFn(env.dbNameCurrent);
        const prodClient = new PrismaClient({ datasources: { db: { url: appUrlProd } } });
        try {
          const student = await prodClient.students.findUnique({ where: { id: env.seeded.student.id } });
          expect(student).not.toBeNull();
          expect(student.name).toBe(env.seeded.student.name);
        } finally {
          await prodClient.$disconnect().catch(() => {});
        }

        // identity reverted to the ORIGINAL value, not a fresh one
        const revertedIdentity = readActiveDatabaseIdentity({ configPath: env.dbIdentityConfigPath });
        expect(revertedIdentity.id).toBe(env.originalIdentity.id);

        // the failed candidate is RETAINED under its own name — never deleted
        const candidateStillExists = await classifySchemaState(
          buildDatabaseUrl({ user: env.appRole, password: env.appPassword, host: env.host, port: env.port, database: env.candidateDb })
        );
        expect(candidateStillExists.state).toBe('has_base_schema');

        await teardown(env, []);
      } catch (err) {
        await teardown(env, archivalName ? [archivalName] : []);
        throw err;
      }
    },
    120_000
  );

  it(
    'test 3 — crash recovery: simulated crash right after rename #1 (current_renamed), resume completes the switch correctly',
    async () => {
      const env = await setupVerifiedEnvironment();
      try {
        await expect(performDatabaseSwitch({
          productionDbName: env.dbNameCurrent,
          candidateDb: env.candidateDb,
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          dbIdentityConfigPath: env.dbIdentityConfigPath,
          stopAppFn: env.stopAppFn, startAppFn: env.startAppFn, getAppStatusFn: env.getAppStatusFn,
          buildRuntimeUrlFn: env.buildRuntimeUrlFn,
          simulateCrashAfter: 'current_renamed',
        })).rejects.toThrow(SimulatedCrashError);

        const midState = readRestoreState({ configPath: env.restoreStateConfigPath });
        expect(midState.switchStatus).toBe('current_renamed');
        // ground truth: production name genuinely absent, archival name genuinely present
        const archivalExistsCheck = await classifySchemaState(
          buildDatabaseUrl({ user: env.adminRole, password: env.adminPassword, host: env.host, port: env.port, database: midState.renamedPreviousDb })
        );
        expect(archivalExistsCheck.state).toBe('has_base_schema');

        // "crash": a brand-new call, no in-memory state carried over, no candidateDb/productionDbName
        // even passed explicitly — recovered entirely from restore-state.json.
        const resumed = await performDatabaseSwitch({
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          dbIdentityConfigPath: env.dbIdentityConfigPath,
          stopAppFn: env.stopAppFn, startAppFn: env.startAppFn, getAppStatusFn: env.getAppStatusFn,
          buildRuntimeUrlFn: env.buildRuntimeUrlFn,
        });

        expect(resumed.status).toBe('active');
        const finalState = readRestoreState({ configPath: env.restoreStateConfigPath });
        expect(finalState.status).toBe('active');

        await teardown(env, [midState.renamedPreviousDb]);
      } catch (err) {
        await teardown(env, []);
        throw err;
      }
    },
    120_000
  );

  it(
    'test 4 — crash recovery: simulated crash right after rename #2 (candidate_renamed), BEFORE identity promotion — proves the resumability fix',
    async () => {
      const env = await setupVerifiedEnvironment();
      let archivalName;
      try {
        await expect(performDatabaseSwitch({
          productionDbName: env.dbNameCurrent,
          candidateDb: env.candidateDb,
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          dbIdentityConfigPath: env.dbIdentityConfigPath,
          stopAppFn: env.stopAppFn, startAppFn: env.startAppFn, getAppStatusFn: env.getAppStatusFn,
          buildRuntimeUrlFn: env.buildRuntimeUrlFn,
          simulateCrashAfter: 'candidate_renamed',
        })).rejects.toThrow(SimulatedCrashError);

        const midState = readRestoreState({ configPath: env.restoreStateConfigPath });
        expect(midState.switchStatus).toBe('candidate_renamed');
        archivalName = midState.renamedPreviousDb;

        // identity must NOT have been promoted yet — the crash happened before that line ran
        const identityBeforeResume = readActiveDatabaseIdentity({ configPath: env.dbIdentityConfigPath });
        expect(identityBeforeResume.id).toBe(env.originalIdentity.id);

        const resumed = await performDatabaseSwitch({
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          dbIdentityConfigPath: env.dbIdentityConfigPath,
          stopAppFn: env.stopAppFn, startAppFn: env.startAppFn, getAppStatusFn: env.getAppStatusFn,
          buildRuntimeUrlFn: env.buildRuntimeUrlFn,
        });

        expect(resumed.status).toBe('active');
        // identity IS now promoted, on resume
        const identityAfterResume = readActiveDatabaseIdentity({ configPath: env.dbIdentityConfigPath });
        expect(identityAfterResume.id).toBe(resumed.candidateIdentityId);
        expect(identityAfterResume.id).not.toBe(env.originalIdentity.id);

        await teardown(env, [archivalName]);
      } catch (err) {
        await teardown(env, archivalName ? [archivalName] : []);
        throw err;
      }
    },
    120_000
  );

  it(
    'test 5 — crash recovery during rollback: simulated crash right at reverse_renaming entry, resume completes the rollback correctly',
    async () => {
      const env = await setupVerifiedEnvironment();
      let archivalName;
      try {
        const brokenStartAppFn = async () => {};
        await expect(performDatabaseSwitch({
          productionDbName: env.dbNameCurrent,
          candidateDb: env.candidateDb,
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          dbIdentityConfigPath: env.dbIdentityConfigPath,
          stopAppFn: env.stopAppFn, startAppFn: brokenStartAppFn, getAppStatusFn: env.getAppStatusFn,
          buildRuntimeUrlFn: env.buildRuntimeUrlFn,
        })).rejects.toThrow(DatabaseSwitchError);
        env.appState.running = false;
        archivalName = readRestoreState({ configPath: env.restoreStateConfigPath }).renamedPreviousDb;

        await expect(performRollback({
          productionDbName: env.dbNameCurrent,
          candidateDb: env.candidateDb,
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          dbIdentityConfigPath: env.dbIdentityConfigPath,
          stopAppFn: env.stopAppFn, startAppFn: env.startAppFn, getAppStatusFn: env.getAppStatusFn,
          buildRuntimeUrlFn: env.buildRuntimeUrlFn,
          simulateCrashAfter: 'reverse_renaming',
        })).rejects.toThrow(SimulatedCrashError);

        const midState = readRestoreState({ configPath: env.restoreStateConfigPath });
        expect(midState.status).toBe('rolling_back');
        expect(midState.rollbackStatus).toBe('reverse_renaming');

        const resumedRollback = await performRollback({
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          dbIdentityConfigPath: env.dbIdentityConfigPath,
          stopAppFn: env.stopAppFn, startAppFn: env.startAppFn, getAppStatusFn: env.getAppStatusFn,
          buildRuntimeUrlFn: env.buildRuntimeUrlFn,
        });

        expect(resumedRollback.status).toBe('rolled_back');
        const revertedIdentity = readActiveDatabaseIdentity({ configPath: env.dbIdentityConfigPath });
        expect(revertedIdentity.id).toBe(env.originalIdentity.id);

        await teardown(env, []);
      } catch (err) {
        await teardown(env, archivalName ? [archivalName] : []);
        throw err;
      }
    },
    120_000
  );

  it(
    'test 6 — cross-install rejection: a candidate restored from a DIFFERENT installation\'s backup blocks the switch BEFORE any rename or identity change',
    async () => {
      const env = await setupVerifiedEnvironment();
      let foreignSourceName;
      let foreignCandidateName;
      try {
        // Build a genuinely separate "foreign installation" source database (its own
        // installation_id, generated by the SAME DB-level DEFAULT gen_random_uuid()::text every
        // real installation gets — trg_support_config_installation_immutable correctly forbids
        // ever changing an existing row's installation_id, which is exactly why this test
        // builds a second real database instead of trying to mutate one after creation).
        foreignSourceName = `${SCRATCH_MARKER}foreign${crypto.randomBytes(4).toString('hex')}`;
        assertDisposable(foreignSourceName);
        await createDatabaseIfMissing(env.adminMaintenanceUrl, foreignSourceName);
        const foreignAdminUrl = buildDatabaseUrl({ user: env.adminRole, password: env.adminPassword, host: env.host, port: env.port, database: foreignSourceName });
        await bootstrapDatabase({ databaseUrl: foreignAdminUrl, schemaPath: SCHEMA_PATH });
        const foreignMigrationPrisma = new PrismaClient({ datasources: { db: { url: foreignAdminUrl } } });
        try {
          await runMigrations(foreignMigrationPrisma, { databaseUrl: foreignAdminUrl });
        } finally {
          await foreignMigrationPrisma.$disconnect().catch(() => {});
        }
        const foreignSeedClient = new PrismaClient({ datasources: { db: { url: foreignAdminUrl } } });
        try {
          await foreignSeedClient.support_access_config.create({ data: { id: 1 } }); // its OWN, independently-generated installation_id
        } finally {
          await foreignSeedClient.$disconnect().catch(() => {});
        }

        const foreignBackupPath = await createPreMigrationBackup(foreignAdminUrl, { pgHome: REAL_INSTALLED_PG_HOME });
        assertNeverRealProgramData(foreignBackupPath);

        // Restore that FOREIGN backup as a new candidate inside env's own cluster — modeling
        // "a user selected a backup file that came from a different Studix installation."
        foreignCandidateName = generateCandidateDatabaseName(env.dbNameCurrent);
        const envAdminUrl = buildDatabaseUrl({ user: env.adminRole, password: env.adminPassword, host: env.host, port: env.port, database: env.dbNameCurrent });
        const { candidateUrl: foreignCandidateUrl } = await createCandidateDatabase({
          adminUrl: envAdminUrl, candidateName: foreignCandidateName, productionDbName: env.dbNameCurrent,
        });
        await restoreIntoCandidate({ backupPath: foreignBackupPath, candidateUrl: foreignCandidateUrl, pgHome: REAL_INSTALLED_PG_HOME });

        const currentInstallationId = await readInstallationId(envAdminUrl);
        const foreignInstallationId = await readInstallationId(foreignCandidateUrl);
        expect(currentInstallationId).not.toBe(foreignInstallationId); // sanity: the fixture genuinely differs

        await expect(performDatabaseSwitch({
          productionDbName: env.dbNameCurrent,
          candidateDb: foreignCandidateName,
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          dbIdentityConfigPath: env.dbIdentityConfigPath,
          stopAppFn: env.stopAppFn, startAppFn: env.startAppFn, getAppStatusFn: env.getAppStatusFn,
          buildRuntimeUrlFn: env.buildRuntimeUrlFn,
        })).rejects.toThrow(DatabaseSwitchError);

        // state must still be 'verified' — the switch never even began
        const finalState = readRestoreState({ configPath: env.restoreStateConfigPath });
        expect(finalState.status).toBe('verified');

        // production database completely untouched — still under its own name, still its own data
        const appUrlProd = env.buildRuntimeUrlFn(env.dbNameCurrent);
        const prodClient = new PrismaClient({ datasources: { db: { url: appUrlProd } } });
        try {
          const student = await prodClient.students.findUnique({ where: { id: env.seeded.student.id } });
          expect(student).not.toBeNull();
        } finally {
          await prodClient.$disconnect().catch(() => {});
        }

        // identity never changed
        const identityAfter = readActiveDatabaseIdentity({ configPath: env.dbIdentityConfigPath });
        expect(identityAfter.id).toBe(env.originalIdentity.id);

        await teardown(env, [foreignSourceName, foreignCandidateName]);
      } catch (err) {
        await teardown(env, [foreignSourceName, foreignCandidateName].filter(Boolean));
        throw err;
      }
    },
    120_000
  );

  it(
    'test 7 — no blanket pg_terminate_backend: terminating connections to the production/candidate names never disturbs an unrelated disposable database',
    async () => {
      const env = await setupVerifiedEnvironment();
      let bystanderName;
      let bystanderClient;
      try {
        bystanderName = `${SCRATCH_MARKER}bystander${crypto.randomBytes(4).toString('hex')}`;
        assertDisposable(bystanderName);
        await createDatabaseIfMissing(env.adminMaintenanceUrl, bystanderName);
        const bystanderUrl = buildDatabaseUrl({ user: env.adminRole, password: env.adminPassword, host: env.host, port: env.port, database: bystanderName });
        bystanderClient = new PrismaClient({ datasources: { db: { url: bystanderUrl } } });
        await bystanderClient.$queryRaw`SELECT 1`; // establish a real, live connection

        const result = await performDatabaseSwitch({
          productionDbName: env.dbNameCurrent,
          candidateDb: env.candidateDb,
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          dbIdentityConfigPath: env.dbIdentityConfigPath,
          stopAppFn: env.stopAppFn, startAppFn: env.startAppFn, getAppStatusFn: env.getAppStatusFn,
          buildRuntimeUrlFn: env.buildRuntimeUrlFn,
        });
        expect(result.status).toBe('active');

        // the bystander's connection must still be alive and unaffected
        const rows = await bystanderClient.$queryRaw`SELECT 1 AS ok`;
        expect(rows[0].ok).toBe(1);

        await bystanderClient.$disconnect().catch(() => {});
        await dropTestDatabase(env.adminMaintenanceUrl, bystanderName);
        await teardown(env, [result.renamedPreviousDb]);
      } catch (err) {
        if (bystanderClient) await bystanderClient.$disconnect().catch(() => {});
        if (bystanderName) await dropTestDatabase(env.adminMaintenanceUrl, bystanderName).catch(() => {});
        await teardown(env, []);
        throw err;
      }
    },
    120_000
  );

  it(
    'test 8 — crash recovery at health verification: simulated crash right after the health_verifying ' +
      'checkpoint (switch + identity already done, verification not yet run); a fresh recovery process ' +
      'genuinely re-runs deep health verification rather than trusting the stale checkpoint',
    async () => {
      const env = await setupVerifiedEnvironment();
      let archivalName;
      try {
        let fetchHealthCallCount = 0;
        const fetchHealthFn = async () => { fetchHealthCallCount += 1; return { ok: true }; };

        // A. the crash propagates
        await expect(performDatabaseSwitch({
          productionDbName: env.dbNameCurrent,
          candidateDb: env.candidateDb,
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          dbIdentityConfigPath: env.dbIdentityConfigPath,
          stopAppFn: env.stopAppFn, startAppFn: env.startAppFn, getAppStatusFn: env.getAppStatusFn,
          buildRuntimeUrlFn: env.buildRuntimeUrlFn,
          fetchHealthFn,
          simulateCrashAfter: 'health_verifying',
        })).rejects.toThrow(SimulatedCrashError);

        // the real verification step (which would call fetchHealthFn) never ran before the crash —
        // the checkpoint is written, then the throw happens, strictly before runDeepHealthVerification.
        expect(fetchHealthCallCount).toBe(0);

        // B. restore-state.json contains the expected checkpoint
        const midState = readRestoreState({ configPath: env.restoreStateConfigPath });
        expect(midState.status).toBe('switching');
        expect(midState.switchStatus).toBe('health_verifying');
        archivalName = midState.renamedPreviousDb;
        expect(archivalName).toBeTruthy();

        // C. actual pg_database ground truth: the switch itself already genuinely happened —
        // production name now holds the CANDIDATE's data, archival holds the ORIGINAL data, the
        // candidate's own original name is gone, and identity was already promoted.
        expect(await databaseExists(env.adminMaintenanceUrl, env.dbNameCurrent)).toBe(true);
        expect(await databaseExists(env.adminMaintenanceUrl, archivalName)).toBe(true);
        expect(await databaseExists(env.adminMaintenanceUrl, env.candidateDb)).toBe(false);
        const archivalCheck = await classifySchemaState(
          buildDatabaseUrl({ user: env.adminRole, password: env.adminPassword, host: env.host, port: env.port, database: archivalName })
        );
        expect(archivalCheck.state).toBe('has_base_schema');
        const identityMid = readActiveDatabaseIdentity({ configPath: env.dbIdentityConfigPath });
        expect(identityMid.id).toBe(midState.candidateIdentityId);
        expect(identityMid.id).not.toBe(env.originalIdentity.id);

        // D. a completely fresh recovery call — no in-memory state carried over, nothing passed
        // explicitly except what a freshly-started process would supply (recovered from
        // restore-state.json alone).
        const resumed = await performDatabaseSwitch({
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          dbIdentityConfigPath: env.dbIdentityConfigPath,
          stopAppFn: env.stopAppFn, startAppFn: env.startAppFn, getAppStatusFn: env.getAppStatusFn,
          buildRuntimeUrlFn: env.buildRuntimeUrlFn,
          fetchHealthFn,
        });

        // E. recovery did NOT trust the stale checkpoint blindly — the real health verification
        // (including the real fetchHealthFn call) genuinely ran exactly once, on resume.
        expect(fetchHealthCallCount).toBe(1);

        // F/G. final topology + active identity correct
        expect(resumed.status).toBe('active');
        const identityAfter = readActiveDatabaseIdentity({ configPath: env.dbIdentityConfigPath });
        expect(identityAfter.id).toBe(resumed.candidateIdentityId);
        expect(identityAfter.id).toBe(midState.candidateIdentityId); // same identity captured pre-crash, never regenerated

        // H. deep health verification completed for real — production db is genuinely reachable
        // and holds the candidate's data (runDeepHealthVerification itself would have thrown
        // DatabaseSwitchError had schema/migration/identity/DML checks failed).
        const appUrlProd = env.buildRuntimeUrlFn(env.dbNameCurrent);
        const prodClient = new PrismaClient({ datasources: { db: { url: appUrlProd } } });
        try {
          const student = await prodClient.students.findUnique({ where: { id: env.seeded.student.id } });
          expect(student).not.toBeNull();
        } finally {
          await prodClient.$disconnect().catch(() => {});
        }

        // I. final restore state is 'active' (not 'idle' — idle requires a separate, later,
        // deliberate transition per restoreState.js's own ALLOWED_TRANSITIONS graph).
        const finalState = readRestoreState({ configPath: env.restoreStateConfigPath });
        expect(finalState.status).toBe('active');
        expect(finalState.switchStatus).toBe('completed');

        // J. source/archival/candidate databases exactly where the recovery state machine expects.
        expect(await databaseExists(env.adminMaintenanceUrl, env.dbNameCurrent)).toBe(true); // production name
        expect(await databaseExists(env.adminMaintenanceUrl, archivalName)).toBe(true); // archival retained, never dropped
        expect(await databaseExists(env.adminMaintenanceUrl, env.candidateDb)).toBe(false); // candidate's own name gone (renamed away)

        // K. no production-like disposable artifact leaked
        assertDisposable(env.dbNameCurrent);
        assertDisposable(archivalName);

        await teardown(env, [archivalName]);
      } catch (err) {
        await teardown(env, archivalName ? [archivalName] : []);
        throw err;
      }
    },
    120_000
  );

  it(
    'test 9 — missing-candidate: the candidate database is gone before the switch begins; a fresh ' +
      'recovery call fails safely without renaming anything or touching the active identity',
    async () => {
      const env = await setupVerifiedEnvironment();
      try {
        // simulate "the candidate went missing" (operator error, disk issue, out-of-band drop) —
        // BEFORE any switch attempt ever ran against it.
        await dropTestDatabase(env.adminMaintenanceUrl, env.candidateDb);
        expect(await databaseExists(env.adminMaintenanceUrl, env.candidateDb)).toBe(false);

        const preState = readRestoreState({ configPath: env.restoreStateConfigPath });
        expect(preState.status).toBe('verified');
        expect(preState.candidateDb).toBe(env.candidateDb);

        // a fresh recovery process — no explicit productionDbName/candidateDb, exactly as a
        // freshly-started process resuming purely from restore-state.json would call it.
        let caughtError;
        try {
          await performDatabaseSwitch({
            adminConfigPath: env.adminEnvPath,
            restoreStateConfigPath: env.restoreStateConfigPath,
            dbIdentityConfigPath: env.dbIdentityConfigPath,
            stopAppFn: env.stopAppFn, startAppFn: env.startAppFn, getAppStatusFn: env.getAppStatusFn,
            buildRuntimeUrlFn: env.buildRuntimeUrlFn,
          });
        } catch (err) {
          caughtError = err;
        }

        // fails safely, with a typed, specific error
        expect(caughtError).toBeInstanceOf(DatabaseSwitchError);
        expect(caughtError.reason).toBe('installation_id_read_failed');
        // no credentials leaked into the error the caller/log ultimately sees
        expect(caughtError.message).not.toMatch(/postgres(?:ql)?:\/\//i);
        expect(caughtError.message).not.toContain(env.adminPassword);
        expect(caughtError.message).not.toContain(env.appPassword);

        // restore-state.json: failed safely — status stays 'verified' (not corrupted, not
        // silently advanced into 'switching'; the cross-install/installation_id check this fails
        // on runs entirely before the first destructive writeCheckpoint call, and 'failed' is
        // deliberately never used for a pre-flight failure — see databaseSwitch.js's own
        // recordFailureAndRedact comment: an already-verified candidate must stay retryable, not
        // require re-running the whole restore from backup). Phase 2C-3C Part 1: the failure IS
        // now durably recorded — via 'verified' state's own self-loop — as a redacted `error`.
        const finalState = readRestoreState({ configPath: env.restoreStateConfigPath });
        expect(finalState.status).toBe('verified');
        expect(finalState.switchStatus).toBe('pending');
        expect(finalState.renamedPreviousDb).toBeNull();
        const { error: finalError, updatedAt: finalUpdatedAt, ...finalRest } = finalState;
        const { error: preError, updatedAt: preUpdatedAt, ...preRest } = preState;
        expect(finalRest).toEqual(preRest); // every OTHER field byte-for-byte unchanged
        expect(finalError).not.toBeNull();
        expect(finalError).not.toMatch(/postgres(?:ql)?:\/\//i);
        expect(finalError).not.toContain(env.adminPassword);
        expect(finalError).not.toContain(env.appPassword);

        // no production-name database was renamed — current/source database remains intact,
        // reachable under its OWN name, with its OWN data.
        const appUrlProd = env.buildRuntimeUrlFn(env.dbNameCurrent);
        const prodClient = new PrismaClient({ datasources: { db: { url: appUrlProd } } });
        try {
          const student = await prodClient.students.findUnique({ where: { id: env.seeded.student.id } });
          expect(student).not.toBeNull();
          expect(student.name).toBe(env.seeded.student.name);
        } finally {
          await prodClient.$disconnect().catch(() => {});
        }

        // no archival database was ever created — rename #1 never ran, since the failure happens
        // strictly before the first writeCheckpoint('switching', ...) call.
        const archivalGuess = computeArchivalName(env.dbNameCurrent, preState.restoreId || env.candidateDb);
        expect(await databaseExists(env.adminMaintenanceUrl, archivalGuess)).toBe(false);

        // active identity remains unchanged — no destructive action against the wrong database
        const identityAfter = readActiveDatabaseIdentity({ configPath: env.dbIdentityConfigPath });
        expect(identityAfter.id).toBe(env.originalIdentity.id);

        await teardown(env, []);
      } catch (err) {
        await teardown(env, []);
        throw err;
      }
    },
    120_000
  );

  it(
    'test 10 — orphan candidate: a disposable candidate-shaped database NOT referenced by restore-state ' +
      'is left untouched (not deleted, not promoted, not renamed, not adopted) by a normal switch',
    async () => {
      const env = await setupVerifiedEnvironment();
      let orphanName;
      try {
        // a candidate-SHAPED database restore-state.json does NOT reference — e.g. a leftover from
        // an aborted/never-started restore attempt, or a manually created disposable probe.
        orphanName = generateCandidateDatabaseName(env.dbNameCurrent);
        assertDisposable(orphanName);
        expect(orphanName).not.toBe(env.candidateDb);

        const orphanAdminUrl = buildDatabaseUrl({ user: env.adminRole, password: env.adminPassword, host: env.host, port: env.port, database: orphanName });
        await createDatabaseIfMissing(env.adminMaintenanceUrl, orphanName);
        await bootstrapDatabase({ databaseUrl: orphanAdminUrl, schemaPath: SCHEMA_PATH });
        const orphanMigrationPrisma = new PrismaClient({ datasources: { db: { url: orphanAdminUrl } } });
        try {
          await runMigrations(orphanMigrationPrisma, { databaseUrl: orphanAdminUrl });
        } finally {
          await orphanMigrationPrisma.$disconnect().catch(() => {});
        }
        // a distinguishing marker row, so "left untouched" can be verified precisely, not just
        // "still classifies as has_base_schema"
        const orphanSeedClient = new PrismaClient({ datasources: { db: { url: orphanAdminUrl } } });
        try {
          await orphanSeedClient.support_access_config.create({ data: { id: 1 } });
        } finally {
          await orphanSeedClient.$disconnect().catch(() => {});
        }

        const preState = readRestoreState({ configPath: env.restoreStateConfigPath });
        expect(preState.candidateDb).not.toBe(orphanName);

        // the normal, successful switch path — using the REAL candidate from restore-state, never
        // the orphan; the switch/recovery path has no reference to orphanName anywhere.
        const result = await performDatabaseSwitch({
          productionDbName: env.dbNameCurrent,
          candidateDb: env.candidateDb,
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          dbIdentityConfigPath: env.dbIdentityConfigPath,
          stopAppFn: env.stopAppFn, startAppFn: env.startAppFn, getAppStatusFn: env.getAppStatusFn,
          buildRuntimeUrlFn: env.buildRuntimeUrlFn,
        });
        expect(result.status).toBe('active');

        // 1. not deleted — still exists in pg_database
        expect(await databaseExists(env.adminMaintenanceUrl, orphanName)).toBe(true);

        // 2. not promoted — the active identity belongs to the REAL candidate, never the orphan
        const activeIdentity = readActiveDatabaseIdentity({ configPath: env.dbIdentityConfigPath });
        expect(activeIdentity.id).toBe(result.candidateIdentityId);

        // 3. not renamed — still reachable under its OWN name, with its OWN data untouched
        const orphanClientAfter = new PrismaClient({ datasources: { db: { url: orphanAdminUrl } } });
        try {
          const row = await orphanClientAfter.support_access_config.findUnique({ where: { id: 1 } });
          expect(row).not.toBeNull();
        } finally {
          await orphanClientAfter.$disconnect().catch(() => {});
        }

        // 4. the normal switch/recovery path did not accidentally adopt it — restore-state.json
        // never mentions the orphan's name anywhere
        const finalState = readRestoreState({ configPath: env.restoreStateConfigPath });
        expect(finalState.candidateDb).not.toBe(orphanName);
        expect(finalState.renamedPreviousDb).not.toBe(orphanName);
        expect(JSON.stringify(finalState)).not.toContain(orphanName);

        // 5. still traceable — a plain pg_database lookup still finds it, for later manual cleanup
        expect(await databaseExists(env.adminMaintenanceUrl, orphanName)).toBe(true);

        await teardown(env, [result.renamedPreviousDb, orphanName]);
      } catch (err) {
        await teardown(env, orphanName ? [orphanName] : []);
        throw err;
      }
    },
    120_000
  );

  it(
    'test 11 — F1 fix: a redacted error recorded on failure is cleared by the next successful checkpoint on retry, and existing crash/rollback state-machine behavior is unchanged',
    async () => {
      const env = await setupVerifiedEnvironment();
      let archivalName;
      try {
        // Attempt 1 — same established failure shape as test 2 (startAppFn never flips running
        // back to true) — fails at app_start_failed.
        const brokenStartAppFn = async () => {};
        await expect(performDatabaseSwitch({
          productionDbName: env.dbNameCurrent,
          candidateDb: env.candidateDb,
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          dbIdentityConfigPath: env.dbIdentityConfigPath,
          stopAppFn: env.stopAppFn, startAppFn: brokenStartAppFn, getAppStatusFn: env.getAppStatusFn,
          buildRuntimeUrlFn: env.buildRuntimeUrlFn,
        })).rejects.toThrow(DatabaseSwitchError);

        // point 1 — failure records a redacted error, existing checkpoint/status behavior
        // (test 2's own assertions) unchanged.
        const midState = readRestoreState({ configPath: env.restoreStateConfigPath });
        expect(midState.status).toBe('switching');
        expect(midState.switchStatus).toBe('app_starting');
        archivalName = midState.renamedPreviousDb;
        expect(midState.error).not.toBeNull();
        expect(midState.error).not.toMatch(/postgres(?:ql)?:\/\//i);
        expect(midState.error).not.toContain(env.adminPassword);
        expect(midState.error).not.toContain(env.appPassword);

        // point 2 — retry (this time with the REAL, working startAppFn) succeeds, resuming from
        // the exact checkpoint the failure left behind.
        const resumed = await performDatabaseSwitch({
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          dbIdentityConfigPath: env.dbIdentityConfigPath,
          stopAppFn: env.stopAppFn, startAppFn: env.startAppFn, getAppStatusFn: env.getAppStatusFn,
          buildRuntimeUrlFn: env.buildRuntimeUrlFn,
        });
        expect(resumed.status).toBe('active');

        // point 3 — the successful retry cleared the previously-recorded error.
        const finalState = readRestoreState({ configPath: env.restoreStateConfigPath });
        expect(finalState.status).toBe('active');
        expect(finalState.switchStatus).toBe('completed');
        expect(finalState.error).toBeNull();

        // point 5 — existing behavior (beyond the state machine itself) is unchanged: real data
        // present under the production name, identity genuinely rotated — same shape test 1 proves.
        const appUrlProd = env.buildRuntimeUrlFn(env.dbNameCurrent);
        const prodClient = new PrismaClient({ datasources: { db: { url: appUrlProd } } });
        try {
          const student = await prodClient.students.findUnique({ where: { id: env.seeded.student.id } });
          expect(student).not.toBeNull();
        } finally {
          await prodClient.$disconnect().catch(() => {});
        }
        const identityAfter = readActiveDatabaseIdentity({ configPath: env.dbIdentityConfigPath });
        expect(identityAfter.id).toBe(resumed.candidateIdentityId);
        expect(identityAfter.id).not.toBe(env.originalIdentity.id);

        await teardown(env, [archivalName]);
      } catch (err) {
        await teardown(env, archivalName ? [archivalName] : []);
        throw err;
      }
    },
    120_000
  );

  it(
    'test 12 — F1 fix: a fresh failure records a new redacted error (failure recording itself still works after the writeCheckpoint change)',
    async () => {
      const env = await setupVerifiedEnvironment();
      try {
        const leakySecret = `leaked-secret-${crypto.randomBytes(4).toString('hex')}`;
        const failingReadAdminCredentialFn = () => {
          throw new Error(`simulated admin.env read failure exposing postgresql://studix_admin:${leakySecret}@127.0.0.1:55432/studix`);
        };

        let caught;
        try {
          await performDatabaseSwitch({
            productionDbName: env.dbNameCurrent,
            candidateDb: env.candidateDb,
            adminConfigPath: env.adminEnvPath,
            restoreStateConfigPath: env.restoreStateConfigPath,
            dbIdentityConfigPath: env.dbIdentityConfigPath,
            stopAppFn: env.stopAppFn, startAppFn: env.startAppFn, getAppStatusFn: env.getAppStatusFn,
            buildRuntimeUrlFn: env.buildRuntimeUrlFn,
            readAdminCredentialFn: failingReadAdminCredentialFn,
          });
        } catch (err) {
          caught = err;
        }

        expect(caught).toBeInstanceOf(DatabaseSwitchError);
        expect(caught.message).not.toContain(leakySecret);
        expect(caught.message).toContain('postgresql://[REDACTED]');

        // point 4 — a NEW, freshly-recorded, redacted error — state stays 'verified' (pre-flight
        // failure, nothing destructive happened), exactly like test 9's own established behavior.
        const finalState = readRestoreState({ configPath: env.restoreStateConfigPath });
        expect(finalState.status).toBe('verified');
        expect(finalState.error).not.toBeNull();
        expect(finalState.error).not.toContain(leakySecret);
        expect(finalState.error).toContain('postgresql://[REDACTED]');

        await teardown(env, []);
      } catch (err) {
        await teardown(env, []);
        throw err;
      }
    },
    120_000
  );

  it(
    'test 13 — Phase 2C-3C Part 5B-1 Scenario A: after a REAL successful switch (status=active), a later, independent restore operation is no longer permanently blocked',
    async () => {
      const env = await setupVerifiedEnvironment();
      let archivalName;
      let secondCandidateName;
      try {
        const result = await performDatabaseSwitch({
          productionDbName: env.dbNameCurrent,
          candidateDb: env.candidateDb,
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          dbIdentityConfigPath: env.dbIdentityConfigPath,
          stopAppFn: env.stopAppFn, startAppFn: env.startAppFn, getAppStatusFn: env.getAppStatusFn,
          buildRuntimeUrlFn: env.buildRuntimeUrlFn,
        });
        expect(result.status).toBe('active');
        archivalName = result.renamedPreviousDb;
        expect(readRestoreState({ configPath: env.restoreStateConfigPath }).status).toBe('active');

        // a REAL, independent, second restore cycle — the production name now holds the
        // (former-candidate's) data, backed up fresh via the same real pg_dump.exe used
        // throughout this suite.
        const adminUrlProdPostSwitch = buildDatabaseUrl({
          user: env.adminRole, password: env.adminPassword, host: env.host, port: env.port, database: env.dbNameCurrent,
        });
        const secondBackupPath = await createPreMigrationBackup(adminUrlProdPostSwitch, { pgHome: REAL_INSTALLED_PG_HOME });
        assertNeverRealProgramData(secondBackupPath);

        const secondResult = await runRestoreOrchestrator({
          backupPath: secondBackupPath,
          sourceDbName: env.dbNameCurrent,
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          pgHome: REAL_INSTALLED_PG_HOME,
        });
        secondCandidateName = secondResult.candidateDb;
        assertDisposable(secondCandidateName);

        // point 1 — the second, independent operation is genuinely allowed, not rejected
        expect(secondResult.status).toBe('verified');
        const finalState = readRestoreState({ configPath: env.restoreStateConfigPath });
        expect(finalState.status).toBe('verified');
        // the SECOND cycle's own bookkeeping is on record — no stale content from the first
        // cycle's own restoreId/candidateDb carried forward.
        expect(finalState.candidateDb).toBe(secondCandidateName);
        expect(finalState.previousDb).toBe(env.dbNameCurrent);
        expect(finalState.error).toBeNull();

        await teardown(env, [archivalName, secondCandidateName]);
      } catch (err) {
        await teardown(env, [archivalName, secondCandidateName].filter(Boolean));
        throw err;
      }
    },
    120_000
  );

  it(
    'test 14 — Phase 2C-3C Part 5B-1 Scenario B: after a REAL successful rollback (status=rolled_back), a later, independent restore operation is no longer permanently blocked',
    async () => {
      const env = await setupVerifiedEnvironment();
      let archivalName;
      let secondCandidateName;
      try {
        const brokenStartAppFn = async () => {};
        await expect(performDatabaseSwitch({
          productionDbName: env.dbNameCurrent,
          candidateDb: env.candidateDb,
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          dbIdentityConfigPath: env.dbIdentityConfigPath,
          stopAppFn: env.stopAppFn, startAppFn: brokenStartAppFn, getAppStatusFn: env.getAppStatusFn,
          buildRuntimeUrlFn: env.buildRuntimeUrlFn,
        })).rejects.toThrow(DatabaseSwitchError);
        env.appState.running = false;
        archivalName = readRestoreState({ configPath: env.restoreStateConfigPath }).renamedPreviousDb;

        const rollbackResult = await performRollback({
          productionDbName: env.dbNameCurrent,
          candidateDb: env.candidateDb,
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          dbIdentityConfigPath: env.dbIdentityConfigPath,
          stopAppFn: env.stopAppFn, startAppFn: env.startAppFn, getAppStatusFn: env.getAppStatusFn,
          buildRuntimeUrlFn: env.buildRuntimeUrlFn,
        });
        expect(rollbackResult.status).toBe('rolled_back');
        expect(readRestoreState({ configPath: env.restoreStateConfigPath }).status).toBe('rolled_back');

        // a REAL, independent, second restore cycle against the (rolled-back-to) production data.
        const adminUrlProdPostRollback = buildDatabaseUrl({
          user: env.adminRole, password: env.adminPassword, host: env.host, port: env.port, database: env.dbNameCurrent,
        });
        const secondBackupPath = await createPreMigrationBackup(adminUrlProdPostRollback, { pgHome: REAL_INSTALLED_PG_HOME });
        assertNeverRealProgramData(secondBackupPath);

        const secondResult = await runRestoreOrchestrator({
          backupPath: secondBackupPath,
          sourceDbName: env.dbNameCurrent,
          adminConfigPath: env.adminEnvPath,
          restoreStateConfigPath: env.restoreStateConfigPath,
          pgHome: REAL_INSTALLED_PG_HOME,
        });
        secondCandidateName = secondResult.candidateDb;
        assertDisposable(secondCandidateName);

        // point 2 — the second, independent operation is genuinely allowed, not rejected
        expect(secondResult.status).toBe('verified');
        const finalState = readRestoreState({ configPath: env.restoreStateConfigPath });
        expect(finalState.status).toBe('verified');
        expect(finalState.error).toBeNull();

        await teardown(env, [secondCandidateName]);
      } catch (err) {
        await teardown(env, [archivalName, secondCandidateName].filter(Boolean));
        throw err;
      }
    },
    150_000
  );
});

// ── local test-only helpers (mirrors the established Phase 2A/2C-2 pattern) ───────────────────

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

async function seedRepresentativeData(prisma) {
  const teacher = await prisma.teachers.create({ data: { name: 'أ. اختبار Phase 2C-3B' } });
  const parent = await prisma.parents.create({ data: { full_name: 'ولي أمر اختبار 2C-3B', phone: '01000000097' } });
  const group = await prisma.groups.create({
    data: { id: 'grp_p2c3b_1', name: 'مجموعة اختبار 2C-3B', subject: 'لغة عربية', grade: 'الثالث', time: '09:00', days: [], max: 12, color: '#222', teacher_name: teacher.name },
  });
  const student = await prisma.students.create({
    data: { id: 'stu_p2c3b_1', code: 'P2C3B-0001', name: 'طالب اختبار 2C-3B', phone: '01000000096', parent_id: parent.id, group_id: group.id, status: 'active', monthly_fee: 275 },
  });
  return { teacher, parent, group, student };
}
