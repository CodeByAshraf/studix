// backend/src/db/migrationRunner.test.js
// Phase 3 (Migration Hardening) — اختبارات وحدة بحتة (بلا PostgreSQL): المنطق النصّي فقط
// (splitSqlStatements، discoverMigrationFiles، findDestructiveStatements). لا شيء هنا
// يتصل بأي قاعدة بيانات — الجزء المعتمد على PostgreSQL الحقيقي (runMigrations نفسها) في
// migrationRunner.integration.test.js المرافق (يعمل على قواعد scratch معزولة فقط).
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  splitSqlStatements,
  discoverMigrationFiles,
  findDestructiveStatements,
  checkMigrationsUpToDate,
  ALLOW_DESTRUCTIVE_MARKER,
} from './migrationRunner.js';

describe('splitSqlStatements', () => {
  it('splits simple statements on semicolons', () => {
    const out = splitSqlStatements('SELECT 1;\nSELECT 2;');
    expect(out).toEqual(['SELECT 1;', 'SELECT 2;']);
  });

  it('does not split on semicolons inside a dollar-quoted function body', () => {
    const sql = `CREATE FUNCTION f() RETURNS trigger AS $function$\nBEGIN\n  RAISE EXCEPTION 'x';\nEND;\n$function$ LANGUAGE plpgsql;`;
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('RAISE EXCEPTION');
  });

  it('does not split on semicolons inside single-quoted strings, including escaped quotes', () => {
    const out = splitSqlStatements(`INSERT INTO t (a) VALUES ('a;b''c;d');\nSELECT 1;`);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(`INSERT INTO t (a) VALUES ('a;b''c;d');`);
  });

  it('ignores semicolons inside -- line comments', () => {
    const out = splitSqlStatements('-- a comment; with a semicolon\nSELECT 1;');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('SELECT 1;');
  });
});

describe('discoverMigrationFiles', () => {
  let tmpDir;
  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('returns an empty array when the directory does not exist', () => {
    expect(discoverMigrationFiles(path.join(os.tmpdir(), 'studix-does-not-exist-xyz'))).toEqual([]);
  });

  it('discovers only NNN_name.sql files and sorts them ascending by version', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-migrations-'));
    fs.writeFileSync(path.join(tmpDir, '003_third.sql'), 'SELECT 3;');
    fs.writeFileSync(path.join(tmpDir, '001_first.sql'), 'SELECT 1;');
    fs.writeFileSync(path.join(tmpDir, '002_second.sql'), 'SELECT 2;');
    fs.writeFileSync(path.join(tmpDir, 'notes.md'), 'ignore me');
    fs.writeFileSync(path.join(tmpDir, 'x_bad.sql'), 'ignore me too — no numeric prefix');

    const files = discoverMigrationFiles(tmpDir);
    expect(files.map((f) => f.version)).toEqual([1, 2, 3]);
    expect(files.map((f) => f.name)).toEqual(['first', 'second', 'third']);
    expect(files[0].checksum).toHaveLength(64); // sha256 hex
  });
});

describe('findDestructiveStatements', () => {
  function findingsFor(sql) {
    return findDestructiveStatements([{ filename: 'x.sql', content: sql }]);
  }

  it('flags DROP TABLE / DROP DATABASE / DROP SCHEMA', () => {
    expect(findingsFor('DROP TABLE students;')).toHaveLength(1);
    expect(findingsFor('DROP DATABASE studix;')).toHaveLength(1);
    expect(findingsFor('DROP SCHEMA public;')).toHaveLength(1);
  });

  it('flags TRUNCATE', () => {
    expect(findingsFor('TRUNCATE payments;')).toHaveLength(1);
  });

  it('flags ALTER TABLE ... DROP COLUMN', () => {
    expect(findingsFor('ALTER TABLE students DROP COLUMN notes;')).toHaveLength(1);
  });

  it('flags DELETE FROM / UPDATE with no WHERE clause', () => {
    expect(findingsFor('DELETE FROM payments;')).toHaveLength(1);
    expect(findingsFor('UPDATE payments SET status = \'paid\';')).toHaveLength(1);
  });

  it('does NOT flag DELETE FROM / UPDATE that have a WHERE clause', () => {
    expect(findingsFor(`DELETE FROM payments WHERE id = 'x';`)).toHaveLength(0);
    expect(findingsFor(`UPDATE payments SET status = 'paid' WHERE id = 'x';`)).toHaveLength(0);
  });

  it('does NOT flag purely additive DDL (CREATE TABLE/TRIGGER/FUNCTION/INDEX, ALTER TABLE ADD CONSTRAINT)', () => {
    const sql = `
      CREATE TABLE foo (id int);
      CREATE OR REPLACE FUNCTION public.f() RETURNS trigger AS $f$ BEGIN RETURN NEW; END; $f$ LANGUAGE plpgsql;
      CREATE TRIGGER t BEFORE INSERT ON foo FOR EACH ROW EXECUTE FUNCTION f();
      ALTER TABLE foo ADD CONSTRAINT chk_x CHECK (id > 0);
      CREATE UNIQUE INDEX uq_foo ON foo (id) WHERE (id IS NOT NULL);
    `;
    expect(findingsFor(sql)).toHaveLength(0);
  });

  it('does NOT flag DROP TRIGGER/FUNCTION/CONSTRAINT/INDEX or RENAME (behavior loss, not data loss)', () => {
    expect(findingsFor('DROP TRIGGER t ON foo;')).toHaveLength(0);
    expect(findingsFor('DROP FUNCTION f();')).toHaveLength(0);
    expect(findingsFor('ALTER TABLE foo DROP CONSTRAINT chk_x;')).toHaveLength(0);
    expect(findingsFor('DROP INDEX uq_foo;')).toHaveLength(0);
    expect(findingsFor('ALTER TABLE foo RENAME TO bar;')).toHaveLength(0);
  });

  it('flags every destructive statement in a multi-statement file, one finding each', () => {
    const sql = `DROP TABLE a;\nTRUNCATE b;\nDELETE FROM c;`;
    const findings = findingsFor(sql);
    expect(findings).toHaveLength(3);
  });

  it('the real backend/migrations/001_baseline.sql is entirely non-destructive (regression check)', () => {
    const files = discoverMigrationFiles(path.join(process.cwd(), 'migrations'));
    expect(files.length).toBeGreaterThan(0);
    expect(findDestructiveStatements(files)).toEqual([]);
  });

  it('exports the exact marker text used to acknowledge a destructive migration', () => {
    expect(ALLOW_DESTRUCTIVE_MARKER).toBe('-- studix:allow-destructive');
  });
});

// INSTALL-10 — checkMigrationsUpToDate: server.js's read-only boot-time replacement for calling
// runMigrations() directly (migration execution is now exclusively an installer/upgrade-time
// responsibility, see backend/src/installer/firstInstall.js). A hand-rolled fake `prisma`-shaped
// object is used throughout instead of a real PostgreSQL connection — this function's own
// contract is "call $queryRaw exactly, nothing else", which a fake object can verify precisely
// and unconditionally (no real-database gating needed, unlike migrationRunner.integration.test.js).
describe('checkMigrationsUpToDate', () => {
  let tmpDir;
  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  function makeMigrationsDir(versions) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-freshness-'));
    for (const v of versions) {
      fs.writeFileSync(path.join(tmpDir, `${String(v).padStart(3, '0')}_m.sql`), 'SELECT 1;');
    }
    return tmpDir;
  }

  // "must never write/DDL" guard — $executeRaw/$executeRawUnsafe throw if invoked at all, so any
  // accidental write call fails the test immediately rather than silently succeeding.
  function readOnlyPrismaStub(appliedVersions) {
    return {
      $queryRaw: async () => appliedVersions.map((version) => ({ version })),
      $executeRaw: () => { throw new Error('checkMigrationsUpToDate must never call $executeRaw'); },
      $executeRawUnsafe: () => { throw new Error('checkMigrationsUpToDate must never call $executeRawUnsafe'); },
    };
  }

  it('no on-disk migration files at all -> up to date trivially, without ever querying', async () => {
    const dir = makeMigrationsDir([]);
    let queried = false;
    const prisma = { $queryRaw: async () => { queried = true; return []; } };
    const result = await checkMigrationsUpToDate(prisma, { migrationsDir: dir });
    expect(result).toEqual({ upToDate: true, pendingVersions: [] });
    expect(queried).toBe(false);
  });

  it('every on-disk version already recorded as applied -> up to date, no pending versions', async () => {
    const dir = makeMigrationsDir([1, 2, 3]);
    const prisma = readOnlyPrismaStub([1, 2, 3]);
    const result = await checkMigrationsUpToDate(prisma, { migrationsDir: dir });
    expect(result).toEqual({ upToDate: true, pendingVersions: [] });
  });

  it('an on-disk version missing from _studix_migrations -> fails closed, reports it as pending', async () => {
    const dir = makeMigrationsDir([1, 2, 3]);
    const prisma = readOnlyPrismaStub([1, 2]); // version 3 never applied
    const result = await checkMigrationsUpToDate(prisma, { migrationsDir: dir });
    expect(result.upToDate).toBe(false);
    expect(result.pendingVersions).toEqual([3]);
  });

  it('a completely empty _studix_migrations table (nothing ever applied) -> every on-disk version is pending', async () => {
    const dir = makeMigrationsDir([1, 2]);
    const prisma = readOnlyPrismaStub([]);
    const result = await checkMigrationsUpToDate(prisma, { migrationsDir: dir });
    expect(result).toEqual({ upToDate: false, pendingVersions: [1, 2] });
  });

  it('a missing _studix_migrations table (undefined_table, 42P01) is treated identically to "pending" — bootstrap never ran', async () => {
    const dir = makeMigrationsDir([1]);
    const prisma = {
      $queryRaw: async () => { const err = new Error('relation "_studix_migrations" does not exist'); err.code = '42P01'; throw err; },
    };
    const result = await checkMigrationsUpToDate(prisma, { migrationsDir: dir });
    expect(result).toEqual({ upToDate: false, pendingVersions: [1] });
  });

  it('a genuine connectivity/auth failure (any other error code) propagates — never silently reported as "pending"', async () => {
    const dir = makeMigrationsDir([1]);
    const prisma = {
      $queryRaw: async () => { const err = new Error('password authentication failed'); err.code = '28P01'; throw err; },
    };
    await expect(checkMigrationsUpToDate(prisma, { migrationsDir: dir })).rejects.toThrow('password authentication failed');
  });

  it('never calls $executeRaw/$executeRawUnsafe — read-only, whether up to date or not', async () => {
    const dirUpToDate = makeMigrationsDir([1]);
    await expect(checkMigrationsUpToDate(readOnlyPrismaStub([1]), { migrationsDir: dirUpToDate })).resolves.toEqual({ upToDate: true, pendingVersions: [] });

    const dirPending = makeMigrationsDir([1, 2]);
    await expect(checkMigrationsUpToDate(readOnlyPrismaStub([1]), { migrationsDir: dirPending })).resolves.toEqual({ upToDate: false, pendingVersions: [2] });
    // Both calls above would have thrown from the stub's $executeRaw/$executeRawUnsafe had
    // checkMigrationsUpToDate ever invoked either — reaching here proves it never did.
  });
});
