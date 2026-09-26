// backend/src/db/databaseSwitch.test.js
// Phase 2C-3B — pure unit tests for the switch module's name-safety and cross-install-check
// primitives. No real PostgreSQL connection anywhere in this file (see
// databaseSwitch.integration.test.js for the real disposable-cluster proof).
//
// Phase 2C-3C Part 1 adds a second describe block below (redaction + failure-recording) —
// still pure/no PostgreSQL: performDatabaseSwitch()/performRollback() fail before ever opening
// a real connection whenever readAdminCredentialFn itself throws, which is exactly the case
// these new tests exercise via dependency injection.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  computeArchivalName, assertSameInstallation, DatabaseSwitchError,
  performDatabaseSwitch, performRollback,
} from './databaseSwitch.js';
import { RestoreOrchestratorError } from './restoreDatabase.js';
import { transitionRestoreState, readRestoreState } from './restoreState.js';

describe('computeArchivalName — candidate name safety / no blanket unsafe names', () => {
  it('produces a name containing the production name and the archival marker', () => {
    const name = computeArchivalName('studix', 'abc123');
    expect(name).toBe('studix_previous_abc123');
  });

  it('sanitizes a UUID-shaped restoreId (hyphens are not a safe SQL identifier character)', () => {
    const name = computeArchivalName('studix', '1234abcd-5678-ef01-2345-6789abcdef01');
    expect(name).toMatch(/^studix_previous_[A-Za-z0-9_]+$/);
    expect(name).not.toContain('-');
  });

  it('falls back to a random suffix when restoreId sanitizes down to nothing', () => {
    const name = computeArchivalName('studix', '----');
    expect(name).toMatch(/^studix_previous_[A-Za-z0-9_]+$/);
    expect(name.length).toBeGreaterThan('studix_previous_'.length);
  });

  it('rejects an unsafe production database name (reuses restoreDatabase.js\'s own shape validator, not a second regex)', () => {
    expect(() => computeArchivalName('studix"; DROP TABLE students; --', 'x')).toThrow(RestoreOrchestratorError);
  });

  it('rejects a resulting name longer than the PostgreSQL identifier limit', () => {
    const longProdName = `p${'a'.repeat(60)}`; // 61 chars, well past what "_previous_<suffix>" can fit under
    expect(() => computeArchivalName(longProdName, 'restoreid123456789012345678901234567890')).toThrow(RestoreOrchestratorError);
  });

  it('the archival name never equals the production name itself', () => {
    const name = computeArchivalName('studix', 'x');
    expect(name).not.toBe('studix');
  });
});

describe('assertSameInstallation — cross-install protection (Phase 2C-3A §12 — blocked)', () => {
  it('passes when both installation ids match', () => {
    expect(() => assertSameInstallation('install-1', 'install-1')).not.toThrow();
  });

  it('rejects when the ids differ', () => {
    expect(() => assertSameInstallation('install-1', 'install-2')).toThrow(DatabaseSwitchError);
    try {
      assertSameInstallation('install-1', 'install-2');
    } catch (err) {
      expect(err.reason).toBe('cross_install_backup_rejected');
    }
  });

  it('rejects when either id is missing rather than assuming a match', () => {
    expect(() => assertSameInstallation(null, 'install-1')).toThrow(DatabaseSwitchError);
    expect(() => assertSameInstallation('install-1', null)).toThrow(DatabaseSwitchError);
    expect(() => assertSameInstallation(null, null)).toThrow(DatabaseSwitchError);
    try {
      assertSameInstallation(null, 'install-1');
    } catch (err) {
      expect(err.reason).toBe('installation_identity_unavailable');
    }
  });
});

describe('performDatabaseSwitch / performRollback — redaction + failure-recording (Phase 2C-3C Part 1, pure, no real PostgreSQL)', () => {
  function mkStatePath() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-dbswitch-redact-test-'));
    return path.join(tmpDir, 'restore-state.json');
  }

  // Builds a real 'verified' state on disk via the exact same transition sequence
  // runRestoreOrchestrator would, without needing a real backup/candidate/PostgreSQL at all —
  // this file only cares about restoreState.js's own transitions being followed correctly.
  function buildVerifiedState(configPath, { candidateDb = 'studix_restore_candidate_x' } = {}) {
    const stateOpts = { configPath };
    transitionRestoreState('preparing', {
      restoreId: 'r1', previousDb: 'studix', candidateDb,
      startedAt: new Date().toISOString(), verificationStatus: 'pending',
      switchStatus: 'pending', rollbackStatus: 'pending', error: null,
    }, stateOpts);
    transitionRestoreState('restoring', {}, stateOpts);
    transitionRestoreState('verified', { verificationStatus: 'completed' }, stateOpts);
  }

  const LEAKY_MESSAGE = 'simulated admin.env read failure exposing postgresql://studix_admin:leaked-secret@127.0.0.1:55432/studix';

  it('performDatabaseSwitch: a credential-leaking readAdminCredentialFn failure is fully redacted in the thrown error AND in restore-state.json', async () => {
    const restoreStateConfigPath = mkStatePath();
    buildVerifiedState(restoreStateConfigPath);

    const failingReadAdminCredentialFn = () => { throw new Error(LEAKY_MESSAGE); };

    let caught;
    try {
      await performDatabaseSwitch({
        restoreStateConfigPath, readAdminCredentialFn: failingReadAdminCredentialFn,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DatabaseSwitchError);
    expect(caught.message).not.toContain('leaked-secret');
    expect(caught.message).toContain('postgresql://[REDACTED]');

    // recorded, redacted, onto the SAME 'verified' status (self-loop — never advanced to
    // 'failed', so this still-good candidate remains retryable).
    const state = readRestoreState({ configPath: restoreStateConfigPath });
    expect(state.status).toBe('verified');
    expect(state.error).not.toContain('leaked-secret');
    expect(state.error).toContain('postgresql://[REDACTED]');
  });

  it('performRollback: a credential-leaking readAdminCredentialFn failure is fully redacted in the thrown error AND in restore-state.json, status stays rolling_back-eligible', async () => {
    const restoreStateConfigPath = mkStatePath();
    const stateOpts = { configPath: restoreStateConfigPath };
    buildVerifiedState(restoreStateConfigPath);
    // move to 'switching' — the state performRollback() expects to find on its first call.
    transitionRestoreState('switching', {
      switchStatus: 'app_starting', renamedPreviousDb: 'studix_previous_r1',
      previousIdentityId: 'id-prev', candidateIdentityId: 'id-cand',
    }, stateOpts);

    const failingReadAdminCredentialFn = () => { throw new Error(LEAKY_MESSAGE); };

    let caught;
    try {
      await performRollback({ restoreStateConfigPath, readAdminCredentialFn: failingReadAdminCredentialFn });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(DatabaseSwitchError);
    expect(caught.message).not.toContain('leaked-secret');
    expect(caught.message).toContain('postgresql://[REDACTED]');

    const state = readRestoreState({ configPath: restoreStateConfigPath });
    // readAdminCredentialFn is called BEFORE performRollback's own first writeCheckpoint
    // ('rolling_back'/'pending') — so status is still 'switching' at the moment of this
    // failure, and is recorded there via switching's own self-loop, never advanced to 'failed'.
    expect(state.status).toBe('switching');
    expect(state.error).not.toContain('leaked-secret');
    expect(state.error).toContain('postgresql://[REDACTED]');
  });

  it('performDatabaseSwitch: not_in_switching_state (misuse — no verified/switching state to act on) still redacts and never crashes uglily, even when no failure self-loop applies to record it', async () => {
    const restoreStateConfigPath = mkStatePath();
    // state is left at the default 'idle' — neither 'verified' nor 'switching', and 'idle' has
    // no self-loop in ALLOWED_TRANSITIONS (by design — idle only ever goes to 'preparing').
    let caught;
    try {
      await performDatabaseSwitch({
        restoreStateConfigPath, readAdminCredentialFn: () => 'postgresql://admin:pw@127.0.0.1:5432/postgres',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DatabaseSwitchError);
    expect(caught.reason).toBe('not_in_switching_state');
    // the secondary "couldn't record it either" detail is appended, redacted, never masking the
    // original reason/message.
    expect(caught.message).toContain('verified');
    expect(caught.message).not.toContain('pw@127.0.0.1');
    // 'idle' really was never touched — no state file was ever created for this run.
    expect(fs.existsSync(restoreStateConfigPath)).toBe(false);
  });

  it('preserves the original reason code through redaction — never replaced with an empty/generic message', async () => {
    const restoreStateConfigPath = mkStatePath();
    buildVerifiedState(restoreStateConfigPath);
    const failingReadAdminCredentialFn = () => { throw new Error('a perfectly ordinary failure with no secrets in it'); };

    let caught;
    try {
      await performDatabaseSwitch({ restoreStateConfigPath, readAdminCredentialFn: failingReadAdminCredentialFn });
    } catch (err) {
      caught = err;
    }
    // no connection string to redact here — the ORIGINAL useful message text survives untouched.
    expect(caught.message).toBe('a perfectly ordinary failure with no secrets in it');
  });
});
