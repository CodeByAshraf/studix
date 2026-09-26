// backend/src/db/backup.test.js
// Backup Reliability Phase 1 — findPgDump() previously searched ONLY a standalone-installer
// path (C:\Program Files\PostgreSQL\<version>\bin) that does not exist on a real customer
// machine, which only ever has the bundled PostgreSQL copy Studix's own installer places
// under <install root>\pgsql\bin. These tests use REAL on-disk directories (fs.mkdtempSync),
// never a mocked filesystem, so a passing "found it" test genuinely proves the resolver can
// walk a real directory tree — not merely that a mock was told to say yes.
//
// Zero real PostgreSQL instance needed for this file (unit-level, path resolution only) —
// see backup.integration.test.js for the real pg_dump.exe execution proof.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { findPgDump, findPgRestore, createPreMigrationBackup } from './backup.js';

let tmpRoots = [];

function makeTmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function makeFile(filePath, content = 'fake pg_dump.exe for test purposes only') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

const ORIGINAL_PG_DUMP_PATH = process.env.PG_DUMP_PATH;
const ORIGINAL_PG_RESTORE_PATH = process.env.PG_RESTORE_PATH;

beforeEach(() => {
  delete process.env.PG_DUMP_PATH;
  delete process.env.PG_RESTORE_PATH;
  tmpRoots = [];
});

afterEach(() => {
  if (ORIGINAL_PG_DUMP_PATH === undefined) delete process.env.PG_DUMP_PATH;
  else process.env.PG_DUMP_PATH = ORIGINAL_PG_DUMP_PATH;
  if (ORIGINAL_PG_RESTORE_PATH === undefined) delete process.env.PG_RESTORE_PATH;
  else process.env.PG_RESTORE_PATH = ORIGINAL_PG_RESTORE_PATH;
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
});

describe('findPgDump — Test 1: resolution against a REAL bundled-layout directory tree', () => {
  it('finds pg_dump.exe under <pgHome>\\bin — the exact layout the real Studix installer produces (<install root>\\pgsql\\bin\\pg_dump.exe)', () => {
    const pgHome = makeTmpDir('studix-pghome-');
    const expected = path.join(pgHome, 'bin', 'pg_dump.exe');
    makeFile(expected);
    // legacyPgRoot pointed at a real-but-empty dir — proves the bundled path is found on its
    // own merit, not because the legacy fallback happened to also succeed.
    const emptyLegacyRoot = makeTmpDir('studix-no-legacy-');

    const found = findPgDump(pgHome, emptyLegacyRoot);

    expect(found).toBe(expected);
    expect(fs.existsSync(found)).toBe(true);
  });

  it('an explicit PG_DUMP_PATH override still wins over the bundled path — exact behavior preserved', () => {
    const pgHome = makeTmpDir('studix-pghome-');
    makeFile(path.join(pgHome, 'bin', 'pg_dump.exe'), 'bundled copy — should NOT be chosen');
    const overrideDir = makeTmpDir('studix-override-');
    const overridePath = path.join(overrideDir, 'my-pg_dump.exe');
    makeFile(overridePath, 'explicit override copy — SHOULD be chosen');
    process.env.PG_DUMP_PATH = overridePath;

    expect(findPgDump(pgHome)).toBe(overridePath);
  });

  it('an invalid/nonexistent PG_DUMP_PATH is silently ignored and falls through to the bundled path (unchanged legacy behavior)', () => {
    const pgHome = makeTmpDir('studix-pghome-');
    const expected = path.join(pgHome, 'bin', 'pg_dump.exe');
    makeFile(expected);
    process.env.PG_DUMP_PATH = 'C:\\this\\path\\does\\not\\exist\\pg_dump.exe';

    expect(findPgDump(pgHome, makeTmpDir('studix-no-legacy-'))).toBe(expected);
  });

  it('falls back to the legacy standalone-installer layout when the bundled path is absent — proves backward compatibility with dev machines is preserved, not removed', () => {
    const missingPgHome = makeTmpDir('studix-pghome-empty-'); // no bin/pg_dump.exe under here
    const legacyRoot = makeTmpDir('studix-legacy-root-');
    const legacyPath = path.join(legacyRoot, '18', 'bin', 'pg_dump.exe');
    makeFile(legacyPath);

    expect(findPgDump(missingPgHome, legacyRoot)).toBe(legacyPath);
  });

  it('prefers the bundled path over the legacy fallback when both exist — the actual bug fix: production correctness now takes priority', () => {
    const pgHome = makeTmpDir('studix-pghome-');
    const bundledPath = path.join(pgHome, 'bin', 'pg_dump.exe');
    makeFile(bundledPath, 'bundled — correct answer for a real customer install');
    const legacyRoot = makeTmpDir('studix-legacy-root-');
    makeFile(path.join(legacyRoot, '18', 'bin', 'pg_dump.exe'), 'legacy — must NOT win when bundled exists');

    expect(findPgDump(pgHome, legacyRoot)).toBe(bundledPath);
  });
});

describe('findPgDump / createPreMigrationBackup — Test 2: missing binary fails clearly and safely', () => {
  it('throws a clear error naming pg_dump.exe and every path checked when it exists nowhere', () => {
    const emptyPgHome = makeTmpDir('studix-pghome-empty-');
    const emptyLegacyRoot = makeTmpDir('studix-no-legacy-');

    expect(() => findPgDump(emptyPgHome, emptyLegacyRoot)).toThrow(/pg_dump\.exe/);
    try {
      findPgDump(emptyPgHome, emptyLegacyRoot);
    } catch (err) {
      expect(err.message).toContain(path.join(emptyPgHome, 'bin', 'pg_dump.exe'));
      expect(err.message).toContain(emptyLegacyRoot);
      expect(err.message).toContain('PG_DUMP_PATH');
    }
  });

  it('a nonexistent legacy root (not just an empty one) is handled the same way — no crash, same clear error', () => {
    const emptyPgHome = makeTmpDir('studix-pghome-empty-');
    const neverCreatedLegacyRoot = path.join(os.tmpdir(), `studix-legacy-never-created-${Date.now()}`);

    expect(() => findPgDump(emptyPgHome, neverCreatedLegacyRoot)).toThrow(/pg_dump\.exe/);
  });

  it('createPreMigrationBackup fails BEFORE creating the backup directory when pg_dump cannot be found — no half-done state left behind', async () => {
    const emptyPgHome = makeTmpDir('studix-pghome-empty-');
    const emptyLegacyRoot = makeTmpDir('studix-no-legacy-'); // forces "not found anywhere",
    // regardless of whatever this specific dev machine happens to have installed for real.
    const backupDir = path.join(makeTmpDir('studix-backupdir-parent-'), 'backups-not-yet-created');
    const originalBackupDirEnv = process.env.STUDIX_BACKUP_DIR;
    process.env.STUDIX_BACKUP_DIR = backupDir;

    try {
      await expect(
        createPreMigrationBackup('postgresql://irrelevant/irrelevant', { pgHome: emptyPgHome, legacyPgRoot: emptyLegacyRoot })
      ).rejects.toThrow(/pg_dump\.exe/);
      expect(fs.existsSync(backupDir)).toBe(false);
    } finally {
      if (originalBackupDirEnv === undefined) delete process.env.STUDIX_BACKUP_DIR;
      else process.env.STUDIX_BACKUP_DIR = originalBackupDirEnv;
    }
  });
});

// Phase 2A — findPgRestore() shares resolveBundledBinary() with findPgDump() internally
// (same algorithm, same priority order, only the binary name and env-var-override name
// differ: PG_RESTORE_PATH instead of PG_DUMP_PATH) — these tests mirror findPgDump's exactly
// to prove the shared logic behaves identically for the second binary, using real on-disk
// directories throughout, never a mocked filesystem.
describe('findPgRestore — Test 1: resolution against a REAL bundled-layout directory tree', () => {
  it('finds pg_restore.exe under <pgHome>\\bin — the exact layout the real Studix installer produces', () => {
    const pgHome = makeTmpDir('studix-pghome-');
    const expected = path.join(pgHome, 'bin', 'pg_restore.exe');
    makeFile(expected);
    const emptyLegacyRoot = makeTmpDir('studix-no-legacy-');

    expect(findPgRestore(pgHome, emptyLegacyRoot)).toBe(expected);
  });

  it('prefers the bundled path over the legacy fallback when both exist', () => {
    const pgHome = makeTmpDir('studix-pghome-');
    const bundledPath = path.join(pgHome, 'bin', 'pg_restore.exe');
    makeFile(bundledPath, 'bundled — correct answer');
    const legacyRoot = makeTmpDir('studix-legacy-root-');
    makeFile(path.join(legacyRoot, '18', 'bin', 'pg_restore.exe'), 'legacy — must NOT win when bundled exists');

    expect(findPgRestore(pgHome, legacyRoot)).toBe(bundledPath);
  });

  it('falls back to the legacy standalone-installer layout when the bundled path is absent', () => {
    const missingPgHome = makeTmpDir('studix-pghome-empty-');
    const legacyRoot = makeTmpDir('studix-legacy-root-');
    const legacyPath = path.join(legacyRoot, '18', 'bin', 'pg_restore.exe');
    makeFile(legacyPath);

    expect(findPgRestore(missingPgHome, legacyRoot)).toBe(legacyPath);
  });

  it('an explicit PG_RESTORE_PATH override wins over the bundled path — same override philosophy as PG_DUMP_PATH, its own distinct variable', () => {
    const pgHome = makeTmpDir('studix-pghome-');
    makeFile(path.join(pgHome, 'bin', 'pg_restore.exe'), 'bundled copy — should NOT be chosen');
    const overrideDir = makeTmpDir('studix-override-');
    const overridePath = path.join(overrideDir, 'my-pg_restore.exe');
    makeFile(overridePath, 'explicit override copy — SHOULD be chosen');
    process.env.PG_RESTORE_PATH = overridePath;

    expect(findPgRestore(pgHome)).toBe(overridePath);
  });

  it('PG_DUMP_PATH and PG_RESTORE_PATH are independent — setting one never affects the other\'s resolution', () => {
    const pgHome = makeTmpDir('studix-pghome-');
    const dumpExpected = path.join(pgHome, 'bin', 'pg_dump.exe');
    const restoreExpected = path.join(pgHome, 'bin', 'pg_restore.exe');
    makeFile(dumpExpected);
    makeFile(restoreExpected);
    process.env.PG_DUMP_PATH = 'C:\\some\\unrelated\\pg_dump.exe'; // deliberately nonexistent — must be ignored, not cross-applied to restore

    expect(findPgRestore(pgHome, makeTmpDir('studix-no-legacy-'))).toBe(restoreExpected);
  });
});

describe('findPgRestore — Test 2: missing binary fails clearly and safely', () => {
  it('throws a clear error naming pg_restore.exe and every path checked when it exists nowhere', () => {
    const emptyPgHome = makeTmpDir('studix-pghome-empty-');
    const emptyLegacyRoot = makeTmpDir('studix-no-legacy-');

    expect(() => findPgRestore(emptyPgHome, emptyLegacyRoot)).toThrow(/pg_restore\.exe/);
    try {
      findPgRestore(emptyPgHome, emptyLegacyRoot);
    } catch (err) {
      expect(err.message).toContain(path.join(emptyPgHome, 'bin', 'pg_restore.exe'));
      expect(err.message).toContain(emptyLegacyRoot);
      expect(err.message).toContain('PG_RESTORE_PATH');
    }
  });

  it('a nonexistent legacy root does not crash unexpectedly — same clear error, not an unhandled exception', () => {
    const emptyPgHome = makeTmpDir('studix-pghome-empty-');
    const neverCreatedLegacyRoot = path.join(os.tmpdir(), `studix-legacy-never-created-${Date.now()}`);

    expect(() => findPgRestore(emptyPgHome, neverCreatedLegacyRoot)).toThrow(/pg_restore\.exe/);
  });
});
