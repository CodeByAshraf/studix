// backend/src/db/restoreDatabase.integration.test.js
// Phase 2C-2 — the real, disposable-PostgreSQL proof that the elevated restore orchestrator
// actually works end-to-end: a real disposable "source" database (standing in for what would
// be the real `studix` database in production — the literal name "studix" is never used
// anywhere in this file), a real pg_dump (bundled binary), the new runRestoreOrchestrator()
// creating a real disposable candidate database and restoring into it with the real bundled
// pg_restore, and independent verification that the candidate is correct, the source is
// untouched, and the two are genuinely distinct databases. No mocks/stubs anywhere in this
// file's actual DB/PostgreSQL-binary interactions — mirrors backupRestore.integration.test.js's
// own Phase 2A discipline exactly, applied to the new orchestrator instead of the raw
// restoreBackup() call.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { checkPostgresReachable } from '../test-helpers/scratchDb.js';
import {
  createDatabaseIfMissing, ensureAppRole, bootstrapDatabase, classifySchemaState, extractDatabaseName,
} from './bootstrapDatabase.js';
import { buildDatabaseUrl } from './postgresProvisioning.js';
import { runMigrations, checkMigrationsUpToDate } from './migrationRunner.js';
import { createPreMigrationBackup } from './backup.js';
import {
  runRestoreOrchestrator, assertSafeCandidateDatabaseName, PRODUCTION_DATABASE_NAME,
} from './restoreDatabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', '..', 'prisma', 'studix-schema.sql');
const REAL_INSTALLED_PG_HOME = 'C:\\Program Files\\Studix\\pgsql';
const bundledBinariesExist =
  fs.existsSync(path.join(REAL_INSTALLED_PG_HOME, 'bin', 'pg_dump.exe')) &&
  fs.existsSync(path.join(REAL_INSTALLED_PG_HOME, 'bin', 'pg_restore.exe'));

const dbCheck = await checkPostgresReachable();

// ── explicit safety assertions — enforced BEFORE every destructive action in this file ────────
// SCRATCH_MARKER is deliberately short: the orchestrator's own generateCandidateDatabaseName()
// appends a fixed ~40-char suffix ("_restore_candidate_<timestamp>_<hex>") to whatever source
// name is passed in, and PostgreSQL identifiers are capped at 63 characters — a long, heavily-
// prefixed disposable test name (as used elsewhere in this repo's own test suite) would overflow
// that limit once the candidate suffix is appended, which is exactly what a real production
// source name ("studix", 6 characters) never comes close to.
const FORBIDDEN_DB_NAME = 'studix';
const SCRATCH_MARKER = 'p2c2src';

function assertDisposableDbName(dbName) {
  if (dbName === FORBIDDEN_DB_NAME) {
    throw new Error(`رفض أمان: اسم قاعدة البيانات "${dbName}" هو قاعدة الإنتاج الحقيقية — ممنوع لمسها في هذا الاختبار.`);
  }
  if (!dbName.includes(SCRATCH_MARKER)) {
    throw new Error(`رفض أمان: اسم قاعدة البيانات "${dbName}" لا يحمل العلامة المتوقَّعة لقاعدة اختبار مؤقتة ("${SCRATCH_MARKER}") — تم الإيقاف احترازاً.`);
  }
}

function assertNotProductionPath(p) {
  const normalized = String(p).toLowerCase();
  if (normalized.includes('programdata\\studix\\backups') || normalized.includes('programdata\\studix\\pgdata')) {
    throw new Error(`رفض أمان: المسار "${p}" يشير إلى مجلد إنتاج حقيقي — ممنوع الكتابة فيه من هذا الاختبار.`);
  }
}

// ── Production safety assertions (task item 10) — hard guards, tested directly ────────────────
describe('production safety guards — hard failure if any real production target is ever used', () => {
  it('assertDisposableDbName rejects the literal production database name', () => {
    expect(() => assertDisposableDbName('studix')).toThrow(/قاعدة الإنتاج الحقيقية/);
  });

  it('assertDisposableDbName rejects a name without the disposable-test marker', () => {
    expect(() => assertDisposableDbName('some_unrelated_db')).toThrow(/علامة المتوقَّعة/);
  });

  it('assertNotProductionPath rejects the real production backups directory', () => {
    expect(() => assertNotProductionPath('C:\\ProgramData\\Studix\\backups\\pre-migration-x.dump'))
      .toThrow(/مجلد إنتاج حقيقي/);
  });

  it('assertNotProductionPath rejects the real production pgdata directory', () => {
    expect(() => assertNotProductionPath('C:\\ProgramData\\Studix\\pgdata\\PG_VERSION'))
      .toThrow(/مجلد إنتاج حقيقي/);
  });

  it('the orchestrator itself (assertSafeCandidateDatabaseName) rejects the real production database name', () => {
    expect(() => assertSafeCandidateDatabaseName(PRODUCTION_DATABASE_NAME)).toThrow();
  });
});

describe('runRestoreOrchestrator — REAL end-to-end proof (Phase 2C-2, real disposable PostgreSQL)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }
  if (!bundledBinariesExist) {
    it.skip(
      `SKIPPED — the real installed Studix bundled pg_dump.exe/pg_restore.exe were not found ` +
      `at ${REAL_INSTALLED_PG_HOME}\\bin on this machine. Re-run on a machine where Studix is ` +
      `genuinely installed to get this execution-level proof.`,
      () => {}
    );
    return;
  }

  let tmpBackupDir;
  const originalBackupDirEnv = process.env.STUDIX_BACKUP_DIR;

  beforeAll(() => {
    tmpBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-restoredb-test-'));
    process.env.STUDIX_BACKUP_DIR = tmpBackupDir;
  });

  afterAll(() => {
    if (tmpBackupDir) fs.rmSync(tmpBackupDir, { recursive: true, force: true });
    if (originalBackupDirEnv === undefined) delete process.env.STUDIX_BACKUP_DIR;
    else process.env.STUDIX_BACKUP_DIR = originalBackupDirEnv;
  });

  it(
    'creates a disposable source DB, seeds it, backs it up with the REAL pg_dump.exe, runs the ' +
    'new orchestrator to create+restore a real disposable candidate with the REAL pg_restore.exe, ' +
    'and proves representative data + schema/migrations survive while the source stays untouched ' +
    'and the two databases remain genuinely distinct',
    async () => {
      const realUrl = process.env.DATABASE_URL;
      if (!realUrl) throw new Error('DATABASE_URL غير معرَّف في بيئة الاختبار.');
      const host = new URL(realUrl).hostname;
      const port = Number(new URL(realUrl).port);
      const suffix = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

      // Deliberately short (see SCRATCH_MARKER's own comment above) — leaves enough of
      // PostgreSQL's 63-character identifier budget for the orchestrator's own
      // "<sourceName>_restore_candidate_<timestamp>_<hex>" suffix.
      const dbNameSource = `${SCRATCH_MARKER}${crypto.randomBytes(4).toString('hex')}`;
      assertDisposableDbName(dbNameSource);

      // Test-scoped, uniquely-named roles — never the literal "studix_admin"/"studix_app" names
      // (Phase 2A discovered these can already exist on a shared dev cluster with an unknown
      // password from unrelated prior use; a uniquely-suffixed name avoids that collision
      // entirely instead of re-discovering the same failure here).
      const adminRole = `studix_admin_p2c2_${suffix}`;
      const appRole = `studix_app_p2c2_${suffix}`;
      const adminPassword = crypto.randomBytes(16).toString('hex');
      const appPassword = crypto.randomBytes(16).toString('hex');

      const postgresMaintenanceUrl = buildDatabaseUrl({ user: 'postgres', password: new URL(realUrl).password, host, port, database: 'postgres' });
      await ensureTestSuperuserRole(postgresMaintenanceUrl, adminRole, adminPassword);
      const adminMaintenanceUrl = buildDatabaseUrl({ user: adminRole, password: adminPassword, host, port, database: 'postgres' });

      let adminEnvDir;
      const candidateDbNames = [];

      try {
        // ── A. disposable source DB, bootstrapped + migrated + app-role-provisioned exactly
        // like the real firstInstall.js sequence ──────────────────────────────────────────
        await createDatabaseIfMissing(adminMaintenanceUrl, dbNameSource);
        const adminUrlSource = buildDatabaseUrl({ user: adminRole, password: adminPassword, host, port, database: dbNameSource });

        await bootstrapDatabase({ databaseUrl: adminUrlSource, schemaPath: SCHEMA_PATH });
        const migrationPrisma = new PrismaClient({ datasources: { db: { url: adminUrlSource } } });
        try {
          await runMigrations(migrationPrisma, { databaseUrl: adminUrlSource });
        } finally {
          await migrationPrisma.$disconnect().catch(() => {});
        }
        await ensureAppRole(adminUrlSource, { appUser: appRole, appPassword, host, port });

        // ── B. representative seed data (lean — this test proves the orchestrator's wiring,
        // not data/relationship integrity again, which Phase 2A's own test already proved in
        // depth) ────────────────────────────────────────────────────────────────────────────
        const appUrlSource = buildDatabaseUrl({ user: appRole, password: appPassword, host, port, database: dbNameSource });
        const appPrismaSource = new PrismaClient({ datasources: { db: { url: appUrlSource } } });
        let seeded;
        try {
          seeded = await seedRepresentativeData(appPrismaSource);
        } finally {
          await appPrismaSource.$disconnect().catch(() => {});
        }

        // ── C. real backup (real pg_dump.exe) ───────────────────────────────────────────────
        const backupPath = await createPreMigrationBackup(adminUrlSource, { pgHome: REAL_INSTALLED_PG_HOME });
        assertNotProductionPath(backupPath);
        expect(fs.statSync(backupPath).size).toBeGreaterThan(0);

        // ── D. a real admin.env-shaped temp file — the ONLY input the orchestrator reads its
        // admin credential from (readProvisioningAdminUrl(), unmodified) ───────────────────
        adminEnvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-restoredb-adminenv-'));
        const adminEnvPath = path.join(adminEnvDir, 'admin.env');
        fs.writeFileSync(adminEnvPath, `STUDIX_DB_ADMIN_URL=${adminUrlSource}\n`, 'utf8');
        const restoreStateConfigPath = path.join(adminEnvDir, 'restore-state.json');

        // ── E. the REAL orchestrator call — preparing -> restoring -> verified ──────────────
        const result = await runRestoreOrchestrator({
          backupPath,
          sourceDbName: dbNameSource,
          adminConfigPath: adminEnvPath,
          restoreStateConfigPath,
          pgHome: REAL_INSTALLED_PG_HOME,
        });

        expect(result.status).toBe('verified');
        expect(result.candidateDb).not.toBe(dbNameSource);
        assertDisposableDbName(result.candidateDb);
        candidateDbNames.push(result.candidateDb);

        // ── F. verify representative data exists in the candidate (independent re-check, same
        // technique Phase 2A's own test used — the restored dump's own embedded GRANTs already
        // re-establish appRole's access on the candidate automatically) ────────────────────────
        const appUrlCandidate = buildDatabaseUrl({ user: appRole, password: appPassword, host, port, database: result.candidateDb });
        const appPrismaCandidate = new PrismaClient({ datasources: { db: { url: appUrlCandidate } } });
        try {
          const student = await appPrismaCandidate.students.findUnique({ where: { id: seeded.student.id } });
          expect(student).not.toBeNull();
          expect(student.name).toBe(seeded.student.name);
          const group = await appPrismaCandidate.groups.findUnique({ where: { id: seeded.group.id } });
          expect(group).not.toBeNull();
        } finally {
          await appPrismaCandidate.$disconnect().catch(() => {});
        }

        // ── G. independently re-verify schema/migrations validity (not just trusting the
        // orchestrator's own internal check) ────────────────────────────────────────────────
        const adminUrlCandidate = buildDatabaseUrl({ user: adminRole, password: adminPassword, host, port, database: result.candidateDb });
        const candidateState = await classifySchemaState(adminUrlCandidate);
        expect(candidateState.state).toBe('has_base_schema');
        const migrationPrismaCandidate = new PrismaClient({ datasources: { db: { url: adminUrlCandidate } } });
        try {
          const upToDate = await checkMigrationsUpToDate(migrationPrismaCandidate);
          expect(upToDate.upToDate).toBe(true);
        } finally {
          await migrationPrismaCandidate.$disconnect().catch(() => {});
        }

        // ── H. verify the ORIGINAL source DB remains completely intact ──────────────────────
        const appPrismaSourceAfter = new PrismaClient({ datasources: { db: { url: appUrlSource } } });
        try {
          const studentAfter = await appPrismaSourceAfter.students.findUnique({ where: { id: seeded.student.id } });
          expect(studentAfter).not.toBeNull();
          expect(studentAfter.name).toBe(seeded.student.name);
        } finally {
          await appPrismaSourceAfter.$disconnect().catch(() => {});
        }

        // ── I. verify candidate and source are genuinely two distinct, simultaneously-existing
        // databases (not the same database renamed/aliased) ────────────────────────────────
        const adminMaintClient = new PrismaClient({ datasources: { db: { url: adminMaintenanceUrl } } });
        try {
          const rows = await adminMaintClient.$queryRaw`
            SELECT datname FROM pg_database WHERE datname IN (${dbNameSource}, ${result.candidateDb})
          `;
          expect(rows.map((r) => r.datname).sort()).toEqual([dbNameSource, result.candidateDb].sort());
        } finally {
          await adminMaintClient.$disconnect().catch(() => {});
        }
      } finally {
        // ── teardown — drop ONLY the disposable databases/roles this test created, each
        // re-asserted as disposable immediately before the destructive action ────────────────
        for (const name of [dbNameSource, ...candidateDbNames]) {
          assertDisposableDbName(name);
          await dropTestDatabase(adminMaintenanceUrl, name);
        }
        await dropTestRole(postgresMaintenanceUrl, appRole);
        await dropTestRole(postgresMaintenanceUrl, adminRole);
        if (adminEnvDir) fs.rmSync(adminEnvDir, { recursive: true, force: true });
      }
    },
    120_000
  );
});

// ── local test-only helpers (mirrors backupRestore.integration.test.js's own established
// pattern — kept local/self-contained rather than refactoring that already-verified file) ─────

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
  assertDisposableDbName(dbName);
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
  const teacher = await prisma.teachers.create({ data: { name: 'أ. اختبار Phase 2C-2' } });
  const parent = await prisma.parents.create({ data: { full_name: 'ولي أمر اختبار 2C-2', phone: '01000000099' } });
  const group = await prisma.groups.create({
    data: { id: 'grp_p2c2_1', name: 'مجموعة اختبار 2C-2', subject: 'علوم', grade: 'الثاني', time: '11:00', days: [], max: 15, color: '#111', teacher_name: teacher.name },
  });
  const student = await prisma.students.create({
    data: { id: 'stu_p2c2_1', code: 'P2C2-0001', name: 'طالب اختبار 2C-2', phone: '01000000098', parent_id: parent.id, group_id: group.id, status: 'active', monthly_fee: 250 },
  });
  return { teacher, parent, group, student };
}
