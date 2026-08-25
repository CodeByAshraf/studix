// backend/src/db/migrationRunner.integration.test.js
// Phase 3 (Migration Hardening) — يغطّي كل سيناريوهات النجاح/الفشل الحقيقية لـ
// runMigrations على قواعد scratch معزولة فقط (setupScratchDb/teardownScratchDb —
// scratchDb.js، غير مُعدَّلة هنا إطلاقاً)؛ studix الحقيقية لا تُلمَس بأي خطوة في هذا الملف.
// كل describe يستخدم قاعدة scratch مستقلة خاصة به (namespace مختلف) لأن اختبارات هذا
// الملف تُعدِّل حالة عامة (_studix_migrations) لا يصحّ مشاركتها بين سيناريوهات مختلفة —
// الـ it() داخل كل describe مُتسلسِلة عمداً (تبني على حالة بعضها)، بنفس نمط ملفات
// الاختبار الأخرى الحالية (payments/treasuryTxn.integration.test.js).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { applyFullSchemaDDL } from '../test-helpers/scratchDbFullSchema.js';
import { runMigrations, ALLOW_DESTRUCTIVE_MARKER } from './migrationRunner.js';

const dbCheck = await checkPostgresReachable();
const REAL_MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

function makeTempMigrationsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'studix-migrationrunner-test-'));
}

function writeFile(dir, filename, content) {
  fs.writeFileSync(path.join(dir, filename), content, 'utf8');
}

const okBackup = async () => 'C:\\fake\\pre-migration-test.dump';
const throwingBackup = async () => { throw new Error('فشل النسخة الاحتياطية (اختبار متعمَّد)'); };

async function trackedVersions(client) {
  const rows = await client.$queryRaw`SELECT version FROM _studix_migrations ORDER BY version`;
  return rows.map((r) => Number(r.version));
}

async function tableExistsRaw(client, tableName) {
  const rows = await client.$queryRaw`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ${tableName}`;
  return rows.length > 0;
}

describe('migrationRunner — Phase 3 hardening (real scratch databases)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  describe('fresh install (studix-schema.sql already applied) — stamps without executing SQL', () => {
    let scratch;
    beforeAll(async () => {
      scratch = await setupScratchDb('migrunner_fresh');
      await applyFullSchemaDDL(scratch.client); // simulates the installer having applied studix-schema.sql
    }, 60_000);
    afterAll(async () => { if (scratch) await teardownScratchDb(scratch); });

    it('stamps every migration file as applied, with zero SQL executed', async () => {
      const result = await runMigrations(scratch.client, {
        migrationsDir: REAL_MIGRATIONS_DIR, databaseUrl: scratch.scratchUrl, backup: okBackup,
      });
      expect(result.action).toBe('stamped');
      expect(result.versions).toContain(1);
      expect(result.backupPath).toBeNull(); // stamping never takes a backup — no DDL ran
    });

    it('a second run is a pure no-op (up-to-date)', async () => {
      const result = await runMigrations(scratch.client, {
        migrationsDir: REAL_MIGRATIONS_DIR, databaseUrl: scratch.scratchUrl, backup: okBackup,
      });
      expect(result).toEqual({ action: 'up-to-date', versions: [], backupPath: null });
    });
  });

  describe('pre-migration-system install (tables exist, no baseline DDL) — applies real migrations', () => {
    let scratch;
    beforeAll(async () => { scratch = await setupScratchDb('migrunner_incremental'); }, 60_000);
    afterAll(async () => { if (scratch) await teardownScratchDb(scratch); });

    it('applies all real pending migration files (001_baseline.sql onward) and tracks them', async () => {
      const result = await runMigrations(scratch.client, {
        migrationsDir: REAL_MIGRATIONS_DIR, databaseUrl: scratch.scratchUrl, backup: okBackup,
      });
      expect(result.action).toBe('migrated');
      expect(result.versions).toContain(1);
      expect(result.backupPath).toBe('C:\\fake\\pre-migration-test.dump');

      const fnRows = await scratch.client.$queryRaw`
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'prevent_delete'`;
      expect(fnRows.length).toBe(1);
      const trgRows = await scratch.client.$queryRaw`
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_no_delete_payments'`;
      expect(trgRows.length).toBe(1);
    });

    it('a second run is up-to-date (idempotent)', async () => {
      const result = await runMigrations(scratch.client, {
        migrationsDir: REAL_MIGRATIONS_DIR, databaseUrl: scratch.scratchUrl, backup: okBackup,
      });
      expect(result).toEqual({ action: 'up-to-date', versions: [], backupPath: null });
    });
  });

  describe('uninitialized database (no tables at all) — refuses to proceed', () => {
    const REAL_URL = process.env.DATABASE_URL;
    const REAL_DB = new URL(REAL_URL).pathname.replace(/^\//, '');
    const SCRATCH_DB = `${REAL_DB}_test_scratch_migrunner_empty`;
    const MAINT_URL = (() => { const u = new URL(REAL_URL); u.pathname = '/postgres'; return u.toString(); })();
    const SCRATCH_URL = (() => { const u = new URL(REAL_URL); u.pathname = `/${SCRATCH_DB}`; return u.toString(); })();
    let client;

    beforeAll(async () => {
      const maint = new PrismaClient({ datasources: { db: { url: MAINT_URL } } });
      await maint.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
      await maint.$executeRawUnsafe(`CREATE DATABASE "${SCRATCH_DB}"`);
      await maint.$disconnect();
      client = new PrismaClient({ datasources: { db: { url: SCRATCH_URL } } });
    }, 30_000);
    afterAll(async () => {
      if (client) await client.$disconnect().catch(() => {});
      const maint = new PrismaClient({ datasources: { db: { url: MAINT_URL } } });
      await maint.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`);
      await maint.$disconnect();
    });

    it('throws a clear error instead of guessing', async () => {
      await expect(runMigrations(client, {
        migrationsDir: REAL_MIGRATIONS_DIR, databaseUrl: SCRATCH_URL, backup: okBackup,
      })).rejects.toThrow(/غير مهيَّأة/);
    });
  });

  describe('checksum drift detection — a published migration file must never be edited', () => {
    let scratch;
    let tmpDir;
    beforeAll(async () => {
      scratch = await setupScratchDb('migrunner_checksum');
      tmpDir = makeTempMigrationsDir();
      writeFile(tmpDir, '001_test.sql', `CREATE TABLE checksum_test_tbl (id int);`);
    }, 60_000);
    afterAll(async () => {
      if (scratch) await teardownScratchDb(scratch);
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('applies the original file successfully', async () => {
      const result = await runMigrations(scratch.client, { migrationsDir: tmpDir, databaseUrl: scratch.scratchUrl, backup: okBackup });
      expect(result.action).toBe('migrated');
      expect(await tableExistsRaw(scratch.client, 'checksum_test_tbl')).toBe(true);
    });

    it('rejects startup if the applied file is edited afterward on disk', async () => {
      writeFile(tmpDir, '001_test.sql', `CREATE TABLE checksum_test_tbl (id int, extra_col int);`);
      await expect(runMigrations(scratch.client, { migrationsDir: tmpDir, databaseUrl: scratch.scratchUrl, backup: okBackup }))
        .rejects.toThrow(/تعارض checksum/);
    });
  });

  describe('missing migration file on disk — a tracked version must still exist as a file', () => {
    let scratch;
    let tmpDir;
    beforeAll(async () => {
      scratch = await setupScratchDb('migrunner_missing');
      tmpDir = makeTempMigrationsDir();
      writeFile(tmpDir, '001_a.sql', `CREATE TABLE missing_test_a (id int);`);
      writeFile(tmpDir, '002_b.sql', `CREATE TABLE missing_test_b (id int);`);
      const result = await runMigrations(scratch.client, { migrationsDir: tmpDir, databaseUrl: scratch.scratchUrl, backup: okBackup });
      expect(result.versions).toEqual([1, 2]);
    }, 60_000);
    afterAll(async () => {
      if (scratch) await teardownScratchDb(scratch);
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('rejects startup if a previously-applied file was deleted from disk', async () => {
      fs.unlinkSync(path.join(tmpDir, '002_b.sql'));
      await expect(runMigrations(scratch.client, { migrationsDir: tmpDir, databaseUrl: scratch.scratchUrl, backup: okBackup }))
        .rejects.toThrow(/غير موجود على القرص/);
    });
  });

  describe('backup failure aborts before any DDL runs', () => {
    let scratch;
    let tmpDir;
    beforeAll(async () => {
      scratch = await setupScratchDb('migrunner_backupfail');
      tmpDir = makeTempMigrationsDir();
      writeFile(tmpDir, '001_a.sql', `CREATE TABLE backupfail_test_tbl (id int);`);
    }, 60_000);
    afterAll(async () => {
      if (scratch) await teardownScratchDb(scratch);
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('throws, applies zero rows, and never creates the table', async () => {
      await expect(runMigrations(scratch.client, { migrationsDir: tmpDir, databaseUrl: scratch.scratchUrl, backup: throwingBackup }))
        .rejects.toThrow(/فشل النسخة الاحتياطية/);
      expect(await trackedVersions(scratch.client)).toEqual([]);
      expect(await tableExistsRaw(scratch.client, 'backupfail_test_tbl')).toBe(false);
    });
  });

  describe('partial-batch failure — earlier files stay committed, the failing file is retried on next run', () => {
    let scratch;
    let tmpDir;
    beforeAll(async () => {
      scratch = await setupScratchDb('migrunner_partial');
      tmpDir = makeTempMigrationsDir();
      writeFile(tmpDir, '001_ok.sql', `CREATE TABLE partial_test_ok (id int);`);
      writeFile(tmpDir, '002_broken.sql', `THIS IS NOT VALID SQL;`);
    }, 60_000);
    afterAll(async () => {
      if (scratch) await teardownScratchDb(scratch);
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('file 1 commits and is tracked; file 2 fails, rolls back, and is not tracked', async () => {
      await expect(runMigrations(scratch.client, { migrationsDir: tmpDir, databaseUrl: scratch.scratchUrl, backup: okBackup }))
        .rejects.toThrow();
      expect(await tableExistsRaw(scratch.client, 'partial_test_ok')).toBe(true);
      expect(await trackedVersions(scratch.client)).toEqual([1]);
    });

    it('fixing the broken file lets the next run resume from exactly where it failed', async () => {
      writeFile(tmpDir, '002_broken.sql', `CREATE TABLE partial_test_fixed (id int);`);
      const result = await runMigrations(scratch.client, { migrationsDir: tmpDir, databaseUrl: scratch.scratchUrl, backup: okBackup });
      expect(result.action).toBe('migrated');
      expect(result.versions).toEqual([2]); // only the previously-failing file, not re-running file 1
      expect(await tableExistsRaw(scratch.client, 'partial_test_fixed')).toBe(true);
    });
  });

  describe('destructive-statement protection', () => {
    let scratch;
    let tmpDir;
    beforeAll(async () => {
      scratch = await setupScratchDb('migrunner_destructive');
      tmpDir = makeTempMigrationsDir();
    }, 60_000);
    afterAll(async () => {
      if (scratch) await teardownScratchDb(scratch);
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('blocks a migration containing an unconditional DELETE, before any backup or DDL', async () => {
      let backupCalled = false;
      const spyBackup = async (url) => { backupCalled = true; return okBackup(url); };
      writeFile(tmpDir, '001_destructive.sql', `CREATE TABLE destructive_test_tbl (id int);\nDELETE FROM destructive_test_tbl;`);

      await expect(runMigrations(scratch.client, { migrationsDir: tmpDir, databaseUrl: scratch.scratchUrl, backup: spyBackup }))
        .rejects.toThrow(/عبارات SQL هدّامة/);
      expect(backupCalled).toBe(false);
      expect(await trackedVersions(scratch.client)).toEqual([]);
      expect(await tableExistsRaw(scratch.client, 'destructive_test_tbl')).toBe(false);
    });

    it('proceeds once the file carries the explicit acknowledgment marker', async () => {
      writeFile(
        tmpDir, '001_destructive.sql',
        `${ALLOW_DESTRUCTIVE_MARKER}\nCREATE TABLE destructive_test_tbl (id int);\nDELETE FROM destructive_test_tbl;`
      );
      const result = await runMigrations(scratch.client, { migrationsDir: tmpDir, databaseUrl: scratch.scratchUrl, backup: okBackup });
      expect(result.action).toBe('migrated');
      expect(await tableExistsRaw(scratch.client, 'destructive_test_tbl')).toBe(true);
    });
  });

  describe('advisory-lock concurrency protection', () => {
    let scratch;
    let tmpDir;
    let clientA;
    let clientB;
    beforeAll(async () => {
      scratch = await setupScratchDb('migrunner_lock');
      tmpDir = makeTempMigrationsDir();
      writeFile(tmpDir, '001_slow.sql', `SELECT pg_sleep(1);\nCREATE TABLE lock_test_tbl (id int);`);
      clientA = new PrismaClient({ datasources: { db: { url: scratch.scratchUrl } } });
      clientB = new PrismaClient({ datasources: { db: { url: scratch.scratchUrl } } });
    }, 60_000);
    afterAll(async () => {
      if (clientA) await clientA.$disconnect().catch(() => {});
      if (clientB) await clientB.$disconnect().catch(() => {});
      if (scratch) await teardownScratchDb(scratch);
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('two concurrent runs on the same database: exactly one proceeds, the other fails fast — no double-application', async () => {
      const [a, b] = await Promise.allSettled([
        runMigrations(clientA, { migrationsDir: tmpDir, databaseUrl: scratch.scratchUrl, backup: okBackup }),
        runMigrations(clientB, { migrationsDir: tmpDir, databaseUrl: scratch.scratchUrl, backup: okBackup }),
      ]);

      const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
      const rejected = [a, b].filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(fulfilled[0].value.action).toBe('migrated');
      expect(rejected[0].reason.message).toMatch(/تعذّر الحصول على قفل الترحيل/);
      expect(await trackedVersions(scratch.client)).toEqual([1]); // no double-application
    });

    it('the lock was fully released after the run — a later run is not blocked by a stale lock', async () => {
      const result = await runMigrations(scratch.client, { migrationsDir: tmpDir, databaseUrl: scratch.scratchUrl, backup: okBackup });
      expect(result).toEqual({ action: 'up-to-date', versions: [], backupPath: null });
    });
  });
});
