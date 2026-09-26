// backend/src/db/restoreDatabase.test.js
// Phase 2C-2 — unit tests for the elevated restore orchestrator. Every test uses a real temp
// directory and explicit configPath overrides — never the real
// C:\ProgramData\Studix\config\admin.env or restore-state.json. No real PostgreSQL connection
// is opened anywhere in this file (see restoreDatabase.integration.test.js for that).
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  assertValidBackupPath, generateCandidateDatabaseName, assertSafeCandidateDatabaseName,
  readAdminCredential, redactErrorMessage, runRestoreOrchestrator, parseCliArgs,
  RestoreOrchestratorError, PRODUCTION_DATABASE_NAME,
} from './restoreDatabase.js';
import { readRestoreState, RestoreStateError } from './restoreState.js';

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ── Production safety assertions (hard guards — fail the whole suite immediately if violated) ─
const FORBIDDEN_SUBSTRINGS = [
  'ProgramData\\Studix\\backups',
  'ProgramData\\Studix\\pgdata',
];
function assertNeverProduction(value) {
  const s = String(value);
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    if (s.includes(forbidden)) {
      throw new Error(`SAFETY VIOLATION in test fixture: a value referenced a real production path (${forbidden}): ${s}`);
    }
  }
}

describe('assertValidBackupPath — malformed invocation / missing / invalid backup path', () => {
  it('rejects a missing backupPath argument', () => {
    expect(() => assertValidBackupPath(undefined)).toThrow(RestoreOrchestratorError);
    try { assertValidBackupPath(undefined); } catch (err) { expect(err.reason).toBe('missing_backup_path'); }
  });

  it('rejects an empty string', () => {
    expect(() => assertValidBackupPath('   ')).toThrow(RestoreOrchestratorError);
  });

  it('rejects a path that does not exist on disk', () => {
    const tmpDir = mkTmpDir('studix-restoredb-test-');
    const missing = path.join(tmpDir, 'does-not-exist.dump');
    expect(() => assertValidBackupPath(missing)).toThrow(RestoreOrchestratorError);
    try { assertValidBackupPath(missing); } catch (err) { expect(err.reason).toBe('backup_path_not_found'); }
  });

  it('rejects a real but empty file', () => {
    const tmpDir = mkTmpDir('studix-restoredb-test-');
    const emptyFile = path.join(tmpDir, 'empty.dump');
    fs.writeFileSync(emptyFile, '');
    expect(() => assertValidBackupPath(emptyFile)).toThrow(RestoreOrchestratorError);
    try { assertValidBackupPath(emptyFile); } catch (err) { expect(err.reason).toBe('invalid_backup_path'); }
  });

  it('rejects a directory passed as if it were a file', () => {
    const tmpDir = mkTmpDir('studix-restoredb-test-');
    expect(() => assertValidBackupPath(tmpDir)).toThrow(RestoreOrchestratorError);
  });

  it('accepts a real, non-empty file', () => {
    const tmpDir = mkTmpDir('studix-restoredb-test-');
    const realFile = path.join(tmpDir, 'real.dump');
    fs.writeFileSync(realFile, 'PGDMP-fake-but-non-empty');
    expect(() => assertValidBackupPath(realFile)).not.toThrow();
  });
});

describe('generateCandidateDatabaseName — candidate name generation', () => {
  it('produces a name containing the source name and the candidate marker', () => {
    const name = generateCandidateDatabaseName('studix');
    expect(name.startsWith('studix_restore_candidate_')).toBe(true);
  });

  it('produces a unique name on every call', () => {
    const a = generateCandidateDatabaseName('studix');
    const b = generateCandidateDatabaseName('studix');
    expect(a).not.toBe(b);
  });

  it('produces only [A-Za-z0-9_] characters — never anything SQL-shaped', () => {
    const name = generateCandidateDatabaseName('studix');
    expect(name).toMatch(/^[A-Za-z0-9_]+$/);
  });

  it('rejects an unsafe source name rather than propagating it into the generated name', () => {
    expect(() => generateCandidateDatabaseName('studix"; DROP TABLE students; --')).toThrow(RestoreOrchestratorError);
  });
});

describe('assertSafeCandidateDatabaseName — production DB target rejection / unsafe name rejection', () => {
  it('rejects the literal production database name', () => {
    expect(() => assertSafeCandidateDatabaseName(PRODUCTION_DATABASE_NAME)).toThrow(RestoreOrchestratorError);
    try {
      assertSafeCandidateDatabaseName(PRODUCTION_DATABASE_NAME);
    } catch (err) {
      expect(err.reason).toBe('production_target_rejected');
    }
  });

  it('rejects a name containing SQL injection characters', () => {
    expect(() => assertSafeCandidateDatabaseName('studix_restore_candidate_1"; DROP DATABASE studix; --'))
      .toThrow(RestoreOrchestratorError);
  });

  it('rejects a name with a space, quote, semicolon, or backslash', () => {
    for (const bad of ['candidate name', 'candidate"name', "candidate'name", 'candidate;name', 'candidate\\name']) {
      expect(() => assertSafeCandidateDatabaseName(bad)).toThrow(RestoreOrchestratorError);
    }
  });

  it('rejects a name lacking the expected candidate marker even if otherwise a safe identifier', () => {
    expect(() => assertSafeCandidateDatabaseName('some_other_safe_name')).toThrow(RestoreOrchestratorError);
  });

  it('rejects a name longer than PostgreSQL identifier limits', () => {
    const tooLong = `studix_restore_candidate_${'a'.repeat(80)}`;
    expect(() => assertSafeCandidateDatabaseName(tooLong)).toThrow(RestoreOrchestratorError);
  });

  it('accepts a well-formed, internally-generated-shaped candidate name', () => {
    expect(() => assertSafeCandidateDatabaseName('studix_restore_candidate_1234567890_abcd1234')).not.toThrow();
  });
});

describe('readAdminCredential — missing / malformed admin.env / missing STUDIX_DB_ADMIN_URL', () => {
  it('throws admin_credential_missing when the file does not exist', () => {
    const tmpDir = mkTmpDir('studix-restoredb-admin-test-');
    const configPath = path.join(tmpDir, 'admin.env');
    assertNeverProduction(configPath);

    expect(() => readAdminCredential({ configPath })).toThrow(RestoreOrchestratorError);
    try { readAdminCredential({ configPath }); } catch (err) { expect(err.reason).toBe('admin_credential_missing'); }
  });

  it('throws admin_credential_missing for a malformed file with no recognizable key=value content', () => {
    const tmpDir = mkTmpDir('studix-restoredb-admin-test-');
    const configPath = path.join(tmpDir, 'admin.env');
    fs.writeFileSync(configPath, 'this is not a valid env file at all !!! ###', 'utf8');

    expect(() => readAdminCredential({ configPath })).toThrow(RestoreOrchestratorError);
  });

  it('throws admin_credential_missing when STUDIX_DB_ADMIN_URL is present but empty', () => {
    const tmpDir = mkTmpDir('studix-restoredb-admin-test-');
    const configPath = path.join(tmpDir, 'admin.env');
    fs.writeFileSync(configPath, 'STUDIX_DB_ADMIN_URL=\n', 'utf8');

    expect(() => readAdminCredential({ configPath })).toThrow(RestoreOrchestratorError);
  });

  it('throws admin_credential_missing when the file has unrelated keys only', () => {
    const tmpDir = mkTmpDir('studix-restoredb-admin-test-');
    const configPath = path.join(tmpDir, 'admin.env');
    fs.writeFileSync(configPath, 'SOME_OTHER_KEY=value\n', 'utf8');

    expect(() => readAdminCredential({ configPath })).toThrow(RestoreOrchestratorError);
  });

  it('returns the real value when the file is valid — never logs/throws it, just returns it to the caller', () => {
    const tmpDir = mkTmpDir('studix-restoredb-admin-test-');
    const configPath = path.join(tmpDir, 'admin.env');
    const url = 'postgresql://studix_admin:secretpw@127.0.0.1:55432/studix';
    fs.writeFileSync(configPath, `STUDIX_DB_ADMIN_URL=${url}\n`, 'utf8');

    expect(readAdminCredential({ configPath })).toBe(url);
  });
});

describe('redactErrorMessage — credential redaction', () => {
  it('strips a full postgres:// connection string, password included', () => {
    const err = new Error('Can\'t reach database server at postgresql://studix_admin:supersecret@127.0.0.1:55432/studix');
    const redacted = redactErrorMessage(err);

    expect(redacted).not.toContain('supersecret');
    expect(redacted).not.toContain('studix_admin:supersecret');
    expect(redacted).toContain('postgresql://[REDACTED]');
  });

  it('handles a message with no connection string at all (no-op)', () => {
    const err = new Error('a perfectly ordinary error with no secrets');
    expect(redactErrorMessage(err)).toBe('a perfectly ordinary error with no secrets');
  });

  it('redacts multiple connection strings in the same message', () => {
    const err = new Error('from postgresql://a:b@h:1/db to postgresql://c:d@h:2/db2');
    const redacted = redactErrorMessage(err);
    expect(redacted).not.toContain('a:b');
    expect(redacted).not.toContain('c:d');
  });
});

describe('parseCliArgs — malformed invocation', () => {
  it('parses --backup-path and --restore-id', () => {
    const args = parseCliArgs(['--backup-path', 'C:\\x\\y.dump', '--restore-id', 'r1']);
    expect(args).toEqual({ backupPath: 'C:\\x\\y.dump', restoreId: 'r1' });
  });

  it('never accepts an admin connection string as a CLI argument', () => {
    expect(() => parseCliArgs(['postgresql://studix_admin:pw@127.0.0.1:55432/studix']))
      .toThrow(RestoreOrchestratorError);
    try {
      parseCliArgs(['postgresql://studix_admin:pw@127.0.0.1:55432/studix']);
    } catch (err) {
      expect(err.reason).toBe('admin_url_in_cli_rejected');
    }
  });

  it('rejects a connection string even when passed as the value of --backup-path (defense in depth)', () => {
    expect(() => parseCliArgs(['--backup-path', 'postgres://x:y@h/db'])).toThrow(RestoreOrchestratorError);
  });
});

describe('runRestoreOrchestrator — state transition correctness / failure state persistence (mocked DB layer only)', () => {
  function mkStatePath() {
    const tmpDir = mkTmpDir('studix-restoredb-state-test-');
    const p = path.join(tmpDir, 'restore-state.json');
    assertNeverProduction(p);
    return p;
  }

  function realBackupFile() {
    const tmpDir = mkTmpDir('studix-restoredb-backup-test-');
    const p = path.join(tmpDir, 'fake.dump');
    fs.writeFileSync(p, 'PGDMP-fake-non-empty-content');
    return p;
  }

  it('rejects an invalid backup path before writing ANY restore-state (idle stays idle)', async () => {
    const restoreStateConfigPath = mkStatePath();

    await expect(runRestoreOrchestrator({ backupPath: undefined, restoreStateConfigPath }))
      .rejects.toThrow(RestoreOrchestratorError);

    expect(fs.existsSync(restoreStateConfigPath)).toBe(false);
  });

  it('idle -> preparing -> failed when the admin credential cannot be read, with a redacted error persisted', async () => {
    const restoreStateConfigPath = mkStatePath();
    const backupPath = realBackupFile();
    const failingReadAdminCredentialFn = () => {
      throw new Error('simulated failure exposing postgresql://studix_admin:leaked@127.0.0.1:55432/studix');
    };

    await expect(runRestoreOrchestrator({
      backupPath, restoreStateConfigPath, restoreId: 'r-fail-1',
      readAdminCredentialFn: failingReadAdminCredentialFn,
    })).rejects.toThrow(RestoreOrchestratorError);

    const state = readRestoreState({ configPath: restoreStateConfigPath });
    expect(state.status).toBe('failed');
    expect(state.restoreId).toBe('r-fail-1');
    expect(state.candidateDb).toMatch(/^studix_restore_candidate_/);
    expect(state.previousDb).toBe('studix');
    expect(state.error).not.toContain('leaked');
    expect(state.error).toContain('postgresql://[REDACTED]');
  });

  // Phase 2C-3C Part 5B-1 — this used to assert a second attempt after 'failed' was REJECTED
  // ("must return to idle first"). That was the exact dead-end Part 5A's audit found
  // (resetRestoreState() had zero callers): a single failed restore permanently blocked any
  // later, independent attempt. runRestoreOrchestrator() now calls advanceToIdleIfTerminal()
  // first (restoreState.js), which walks a genuinely terminal 'failed' state back to 'idle' via
  // its own already-existing ALLOWED_TRANSITIONS edge — so a second attempt now SUCCEEDS past
  // the entry gate instead of being rejected. This is the intended, tested new behavior.
  it('a second restore attempt after a PRIOR one failed now succeeds — the failed state no longer permanently blocks a later, independent attempt', async () => {
    const restoreStateConfigPath = mkStatePath();
    const backupPath = realBackupFile();
    const failingReadAdminCredentialFn = () => { throw new Error('boom'); };

    await expect(runRestoreOrchestrator({
      backupPath, restoreStateConfigPath, readAdminCredentialFn: failingReadAdminCredentialFn,
    })).rejects.toThrow();
    expect(readRestoreState({ configPath: restoreStateConfigPath }).status).toBe('failed');

    // the second, independent attempt (real readAdminCredentialFn override omitted below — a
    // real admin.env is never read in this pure-unit file; the mocked candidate/restore/verify
    // layer from the "full happy path" test below is reused here too) reaches 'verified'.
    const createCandidateDatabaseFn = vi.fn(async ({ candidateName }) => ({
      candidateName, candidateUrl: `postgresql://studix_admin:pw@127.0.0.1:55432/${candidateName}`,
    }));
    const restoreIntoCandidateFn = vi.fn(async () => ({ durationMs: 5 }));
    const verifyCandidateFn = vi.fn(async () => ({ tableCount: 25, migrationsUpToDate: true }));
    const readAdminCredentialFn = vi.fn(() => 'postgresql://studix_admin:pw@127.0.0.1:55432/studix');

    const result = await runRestoreOrchestrator({
      backupPath, restoreStateConfigPath, restoreId: 'second-attempt',
      readAdminCredentialFn, createCandidateDatabaseFn, restoreIntoCandidateFn, verifyCandidateFn,
    });
    expect(result.status).toBe('verified');

    const state = readRestoreState({ configPath: restoreStateConfigPath });
    expect(state.status).toBe('verified');
    expect(state.restoreId).toBe('second-attempt'); // fresh, not the first attempt's own id
    expect(state.error).toBeNull(); // the prior failure's error was cleared, not carried forward
  });

  it('an attempt while a GENUINELY in-flight restore already exists is still rejected — Part 5B-1 never weakens this', async () => {
    const restoreStateConfigPath = mkStatePath();
    const backupPath = realBackupFile();

    // leaves state at 'restoring' — a real in-flight status, never idle-only-reachable, so
    // advanceToIdleIfTerminal() must never touch it.
    const hangingRestoreIntoCandidateFn = () => new Promise(() => {}); // never resolves within this test
    const firstAttempt = runRestoreOrchestrator({
      backupPath, restoreStateConfigPath,
      createCandidateDatabaseFn: vi.fn(async ({ candidateName }) => ({ candidateName, candidateUrl: 'postgresql://a:b@h/db' })),
      restoreIntoCandidateFn: hangingRestoreIntoCandidateFn,
      readAdminCredentialFn: () => 'postgresql://studix_admin:pw@127.0.0.1:55432/studix',
    });
    // give the first call's microtasks a chance to reach 'restoring' before the second call races it
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(readRestoreState({ configPath: restoreStateConfigPath }).status).toBe('restoring');

    await expect(runRestoreOrchestrator({ backupPath, restoreStateConfigPath }))
      .rejects.toThrow(RestoreStateError);

    // the genuinely in-flight state is completely untouched by the rejected second attempt
    expect(readRestoreState({ configPath: restoreStateConfigPath }).status).toBe('restoring');

    void firstAttempt.catch(() => {}); // never awaited to completion — deliberately left hanging, swallow any eventual rejection
  });

  it('full happy path (mocked candidate/restore/verify layer): preparing -> restoring -> verified', async () => {
    const restoreStateConfigPath = mkStatePath();
    const backupPath = realBackupFile();

    const createCandidateDatabaseFn = vi.fn(async ({ candidateName }) => ({
      candidateName, candidateUrl: `postgresql://studix_admin:pw@127.0.0.1:55432/${candidateName}`,
    }));
    const restoreIntoCandidateFn = vi.fn(async () => ({ durationMs: 5 }));
    const verifyCandidateFn = vi.fn(async () => ({ tableCount: 25, migrationsUpToDate: true }));
    const readAdminCredentialFn = vi.fn(() => 'postgresql://studix_admin:pw@127.0.0.1:55432/studix');

    const result = await runRestoreOrchestrator({
      backupPath, restoreStateConfigPath, restoreId: 'r-success-1',
      readAdminCredentialFn, createCandidateDatabaseFn, restoreIntoCandidateFn, verifyCandidateFn,
    });

    expect(result.status).toBe('verified');
    expect(result.candidateDb).toMatch(/^studix_restore_candidate_/);
    expect(createCandidateDatabaseFn).toHaveBeenCalledTimes(1);
    expect(restoreIntoCandidateFn).toHaveBeenCalledTimes(1);
    expect(verifyCandidateFn).toHaveBeenCalledTimes(1);

    const state = readRestoreState({ configPath: restoreStateConfigPath });
    expect(state.status).toBe('verified');
    expect(state.verificationStatus).toBe('completed');
    expect(state.error).toBeNull();
  });

  it('a failure during restoreIntoCandidate (after candidate creation) is recorded as failed with the candidate name preserved', async () => {
    const restoreStateConfigPath = mkStatePath();
    const backupPath = realBackupFile();

    const createCandidateDatabaseFn = vi.fn(async ({ candidateName }) => ({
      candidateName, candidateUrl: `postgresql://studix_admin:pw@127.0.0.1:55432/${candidateName}`,
    }));
    const restoreIntoCandidateFn = vi.fn(async () => { throw new Error('pg_restore failed (simulated)'); });
    const readAdminCredentialFn = vi.fn(() => 'postgresql://studix_admin:pw@127.0.0.1:55432/studix');

    await expect(runRestoreOrchestrator({
      backupPath, restoreStateConfigPath,
      readAdminCredentialFn, createCandidateDatabaseFn, restoreIntoCandidateFn,
    })).rejects.toThrow();

    const state = readRestoreState({ configPath: restoreStateConfigPath });
    expect(state.status).toBe('failed');
    expect(state.candidateDb).toMatch(/^studix_restore_candidate_/);
    expect(state.error).toContain('pg_restore failed');
  });
});
