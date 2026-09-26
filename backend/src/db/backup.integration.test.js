// backend/src/db/backup.integration.test.js
// Backup Reliability Phase 1 — Test 3: real backup execution proof.
//
// This is the one test in this fix that matters most: it calls the REAL, unmodified
// createPreMigrationBackup() (no injected fake backup function, unlike migrationRunner.
// integration.test.js's stubs) against a real, disposable scratch PostgreSQL database
// (setupScratchDb/teardownScratchDb — the real studix database is never touched), using the
// pgHome override to point explicitly at the REAL bundled PostgreSQL copy this machine's
// actual installed Studix service uses (C:\Program Files\Studix\pgsql) — the exact binary a
// real customer's pre-migration backup would invoke, not a synthetic stand-in.
//
// Production safety, explicit: the pg_dump TARGET is the scratch database's own connection
// string (never the real studix database); the backup DESTINATION is a temp directory via
// STUDIX_BACKUP_DIR (never %ProgramData%\Studix\backups); nothing in
// C:\Program Files\Studix\pgsql is written to or modified — pg_dump.exe is invoked read-only
// against the scratch DB. No existing backup file is read, overwritten, or deleted.
//
// If the real installed bundled PostgreSQL copy is not present on the machine running this
// suite (e.g. a CI runner without Studix actually installed), this file skips itself with a
// clear reason — it does not fake the result.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const REAL_INSTALLED_PG_HOME = 'C:\\Program Files\\Studix\\pgsql';
const bundledPgDumpExists = fs.existsSync(path.join(REAL_INSTALLED_PG_HOME, 'bin', 'pg_dump.exe'));

const dbCheck = await checkPostgresReachable();

describe('createPreMigrationBackup — Test 3: REAL backup execution against a disposable scratch database', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }
  if (!bundledPgDumpExists) {
    it.skip(
      `SKIPPED — the real installed Studix bundled PostgreSQL was not found at ` +
      `${REAL_INSTALLED_PG_HOME}\\bin\\pg_dump.exe on this machine. This test deliberately ` +
      `proves the fix against the actual installed bundled binary rather than any stand-in; ` +
      `if Studix is genuinely not installed here, the safest honest alternative is the unit-` +
      `level proof in backup.test.js (real directory-tree resolution, no real pg_dump.exe ` +
      `execution) — this integration test should be re-run on a machine where Studix is ` +
      `actually installed to get the execution-level proof.`,
      () => {}
    );
    return;
  }

  let scratch;
  let tmpBackupDir;
  let createPreMigrationBackup;
  const originalBackupDirEnv = process.env.STUDIX_BACKUP_DIR;
  const originalPgDumpPathEnv = process.env.PG_DUMP_PATH;

  beforeAll(async () => {
    scratch = await setupScratchDb('backup');
    ({ createPreMigrationBackup } = await import('./backup.js'));
    tmpBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-backup-test-'));
    // اختباري بحت — لا يُلمَس %ProgramData%\Studix\backups إطلاقاً في هذا الملف.
    process.env.STUDIX_BACKUP_DIR = tmpBackupDir;
    // فحص PG_DUMP_PATH الحقيقي (لو مُصادفةً مضبوطاً في بيئة التشغيل) — نُزيله مؤقتاً هنا
    // تحديداً حتى يُثبِت هذا الاختبار مسار pgHome/resolvePgHome() نفسه، لا مجرّد التجاوز.
    delete process.env.PG_DUMP_PATH;
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
    if (tmpBackupDir) fs.rmSync(tmpBackupDir, { recursive: true, force: true });
    if (originalBackupDirEnv === undefined) delete process.env.STUDIX_BACKUP_DIR;
    else process.env.STUDIX_BACKUP_DIR = originalBackupDirEnv;
    if (originalPgDumpPathEnv === undefined) delete process.env.PG_DUMP_PATH;
    else process.env.PG_DUMP_PATH = originalPgDumpPathEnv;
  });

  it('invokes the REAL bundled pg_dump.exe against a real scratch database and produces a genuine, non-empty, valid custom-format dump file', async () => {
    const backupPath = await createPreMigrationBackup(scratch.scratchUrl, { pgHome: REAL_INSTALLED_PG_HOME });

    // 1. المسار المُعاد داخل مجلد النسخ الاختباري المؤقت، بالاسم المتوقَّع.
    expect(path.dirname(backupPath)).toBe(tmpBackupDir);
    expect(path.basename(backupPath)).toMatch(/^pre-migration-.*\.dump$/);

    // 2. الملف موجود فعلياً وحجمه أكبر من صفر (نفس تحقّق createPreMigrationBackup الداخلي،
    //    مُعاد التحقّق هنا مستقلاً من خارج الدالة).
    const stat = fs.statSync(backupPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);

    // 3. إثبات أن pg_dump.exe الحقيقي هو من أنتج هذا الملف فعلاً، لا ملفاً وهمياً: صيغة
    //    custom format (-F c) تبدأ دائماً بترويسة سحرية "PGDMP" — تحقّق حقيقي من محتوى
    //    الملف الثنائي، لا افتراض بناءً على الاسم/الحجم فقط.
    const header = Buffer.alloc(5);
    const fd = fs.openSync(backupPath, 'r');
    try { fs.readSync(fd, header, 0, 5, 0); } finally { fs.closeSync(fd); }
    expect(header.toString('ascii')).toBe('PGDMP');
  });
});
