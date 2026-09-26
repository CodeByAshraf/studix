// backend/src/db/restoreState.test.js
// Phase 2C-1 — unit tests for the crash-safe restore-state machine. Every test uses a real
// temp directory (fs.mkdtempSync) and an explicit configPath — never the real
// C:\ProgramData\Studix\config\restore-state.json.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  readRestoreState, transitionRestoreState, resetRestoreState, advanceToIdleIfTerminal,
  RestoreStateError, RESTORE_STATUSES,
} from './restoreState.js';

function mkConfigPath() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-restorestate-test-'));
  return path.join(tmpDir, 'config', 'restore-state.json');
}

describe('readRestoreState — initial/missing state', () => {
  it('returns a fresh idle state when the file does not exist yet', () => {
    const configPath = mkConfigPath();
    const state = readRestoreState({ configPath });

    expect(state).toEqual({
      status: 'idle',
      restoreId: null,
      previousDb: null,
      candidateDb: null,
      startedAt: null,
      updatedAt: null,
      verificationStatus: 'pending',
      switchStatus: 'pending',
      rollbackStatus: 'pending',
      error: null,
      renamedPreviousDb: null,
      previousIdentityId: null,
      candidateIdentityId: null,
    });
  });

  it('does not create the file just by reading it', () => {
    const configPath = mkConfigPath();
    readRestoreState({ configPath });
    expect(fs.existsSync(configPath)).toBe(false);
  });
});

describe('transitionRestoreState — valid transitions across the full lifecycle', () => {
  it('idle -> preparing -> restoring -> verified -> switching -> active -> idle', () => {
    const configPath = mkConfigPath();

    const s1 = transitionRestoreState('preparing', {
      restoreId: 'r1', previousDb: 'studix', candidateDb: 'studix_restore_candidate_r1', startedAt: '2026-01-01T00:00:00.000Z',
    }, { configPath });
    expect(s1.status).toBe('preparing');
    expect(s1.previousDb).toBe('studix');
    expect(s1.candidateDb).toBe('studix_restore_candidate_r1');

    const s2 = transitionRestoreState('restoring', {}, { configPath });
    expect(s2.status).toBe('restoring');
    // fields from the previous transition survive a later transition that doesn't touch them
    expect(s2.previousDb).toBe('studix');

    const s3 = transitionRestoreState('verified', { verificationStatus: 'completed' }, { configPath });
    expect(s3.status).toBe('verified');
    expect(s3.verificationStatus).toBe('completed');

    const s4 = transitionRestoreState('switching', { switchStatus: 'pending' }, { configPath });
    expect(s4.status).toBe('switching');

    const s5 = transitionRestoreState('active', { switchStatus: 'completed' }, { configPath });
    expect(s5.status).toBe('active');

    const s6 = transitionRestoreState('idle', {}, { configPath });
    expect(s6.status).toBe('idle');

    // persisted correctly at every step — re-reading from disk matches the last write
    expect(readRestoreState({ configPath })).toEqual(s6);
  });

  it('switching -> rolling_back -> rolled_back -> idle', () => {
    const configPath = mkConfigPath();
    transitionRestoreState('preparing', { restoreId: 'r2' }, { configPath });
    transitionRestoreState('restoring', {}, { configPath });
    transitionRestoreState('verified', {}, { configPath });
    transitionRestoreState('switching', {}, { configPath });

    const rolling = transitionRestoreState('rolling_back', { rollbackStatus: 'pending' }, { configPath });
    expect(rolling.status).toBe('rolling_back');

    const rolledBack = transitionRestoreState('rolled_back', { rollbackStatus: 'completed' }, { configPath });
    expect(rolledBack.status).toBe('rolled_back');

    const idle = transitionRestoreState('idle', {}, { configPath });
    expect(idle.status).toBe('idle');
  });

  it('failed is reachable from preparing/restoring/verified/switching/rolling_back, and idle is reachable from failed', () => {
    for (const from of ['preparing', 'restoring', 'verified', 'switching', 'rolling_back']) {
      const configPath = mkConfigPath();
      transitionRestoreState('preparing', { restoreId: `r-${from}` }, { configPath });
      if (from !== 'preparing') transitionRestoreState('restoring', {}, { configPath });
      if (from === 'verified' || from === 'switching' || from === 'rolling_back') transitionRestoreState('verified', {}, { configPath });
      if (from === 'switching' || from === 'rolling_back') transitionRestoreState('switching', {}, { configPath });
      if (from === 'rolling_back') transitionRestoreState('rolling_back', {}, { configPath });

      const failed = transitionRestoreState('failed', { error: `simulated failure at ${from}` }, { configPath });
      expect(failed.status).toBe('failed');
      expect(failed.error).toBe(`simulated failure at ${from}`);

      const idle = transitionRestoreState('idle', {}, { configPath });
      expect(idle.status).toBe('idle');
    }
  });
});

describe('transitionRestoreState — invalid transitions rejected', () => {
  it('rejects idle -> restoring (must go through preparing first)', () => {
    const configPath = mkConfigPath();
    expect(() => transitionRestoreState('restoring', {}, { configPath })).toThrow(RestoreStateError);
    try {
      transitionRestoreState('restoring', {}, { configPath });
    } catch (err) {
      expect(err.reason).toBe('invalid_transition');
    }
  });

  it('rejects active -> preparing (a terminal success state can only return to idle)', () => {
    const configPath = mkConfigPath();
    transitionRestoreState('preparing', {}, { configPath });
    transitionRestoreState('restoring', {}, { configPath });
    transitionRestoreState('verified', {}, { configPath });
    transitionRestoreState('switching', {}, { configPath });
    transitionRestoreState('active', {}, { configPath });

    expect(() => transitionRestoreState('preparing', {}, { configPath })).toThrow(RestoreStateError);
  });

  it('rejects failed -> restoring (failed can only return to idle)', () => {
    const configPath = mkConfigPath();
    transitionRestoreState('preparing', {}, { configPath });
    transitionRestoreState('failed', {}, { configPath });

    expect(() => transitionRestoreState('restoring', {}, { configPath })).toThrow(RestoreStateError);
  });

  it('rejects an unknown status name entirely', () => {
    const configPath = mkConfigPath();
    expect(() => transitionRestoreState('not_a_real_status', {}, { configPath })).toThrow(RestoreStateError);
    try {
      transitionRestoreState('not_a_real_status', {}, { configPath });
    } catch (err) {
      expect(err.reason).toBe('unknown_status');
    }
  });

  it('a rejected transition never writes anything to disk', () => {
    const configPath = mkConfigPath();
    expect(fs.existsSync(configPath)).toBe(false);
    expect(() => transitionRestoreState('restoring', {}, { configPath })).toThrow();
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('every declared status is exercised by exactly the transitions above (sanity on the fixture itself)', () => {
    expect(RESTORE_STATUSES).toContain('idle');
    expect(RESTORE_STATUSES).toContain('rolling_back');
    expect(RESTORE_STATUSES.length).toBe(9);
  });
});

describe('atomic persistence', () => {
  it('a successful transition leaves no leftover temp file next to the real state file', () => {
    const configPath = mkConfigPath();
    transitionRestoreState('preparing', {}, { configPath });

    const entries = fs.readdirSync(path.dirname(configPath));
    expect(entries).toEqual(['restore-state.json']);
  });

  it('a write failure mid-transition leaves the previous, valid state completely intact', () => {
    const configPath = mkConfigPath();
    transitionRestoreState('preparing', { restoreId: 'safe-one' }, { configPath });

    const failingWriteFileSync = () => { throw new Error('simulated disk full'); };
    expect(() => transitionRestoreState('restoring', {}, { configPath, writeFileSync: failingWriteFileSync }))
      .toThrow('simulated disk full');

    // still exactly the last successfully-written state — not corrupted, not partially written
    const recovered = readRestoreState({ configPath });
    expect(recovered.status).toBe('preparing');
    expect(recovered.restoreId).toBe('safe-one');
  });
});

describe('corrupted/missing state recovery', () => {
  it('missing file recovers safely as the initial idle state (already covered above, reasserted here for this section)', () => {
    const configPath = mkConfigPath();
    expect(readRestoreState({ configPath }).status).toBe('idle');
  });

  it('a file with unparseable JSON throws RestoreStateError("corrupt_state") — never silently treated as idle', () => {
    const configPath = mkConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{ this is not valid json', 'utf8');

    expect(() => readRestoreState({ configPath })).toThrow(RestoreStateError);
    try {
      readRestoreState({ configPath });
    } catch (err) {
      expect(err.reason).toBe('corrupt_state');
    }
  });

  it('a file with a valid-JSON but unknown status value throws RestoreStateError("corrupt_state")', () => {
    const configPath = mkConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      status: 'not_a_real_status', restoreId: null, previousDb: null, candidateDb: null,
      startedAt: null, updatedAt: null, verificationStatus: 'pending', switchStatus: 'pending',
      rollbackStatus: 'pending', error: null,
    }), 'utf8');

    expect(() => readRestoreState({ configPath })).toThrow(RestoreStateError);
  });

  it('a file missing required fields entirely throws RestoreStateError("corrupt_state")', () => {
    const configPath = mkConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ status: 'idle' }), 'utf8');

    expect(() => readRestoreState({ configPath })).toThrow(RestoreStateError);
  });

  it('transitionRestoreState also propagates a corrupt on-disk state instead of overwriting it', () => {
    const configPath = mkConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, 'garbage', 'utf8');

    expect(() => transitionRestoreState('preparing', {}, { configPath })).toThrow(RestoreStateError);
    // the garbage file is untouched — no silent "recovery" overwrite happened
    expect(fs.readFileSync(configPath, 'utf8')).toBe('garbage');
  });

  it('resetRestoreState is the one explicit, deliberate way to discard a stuck/corrupt state', () => {
    const configPath = mkConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, 'garbage', 'utf8');

    const fresh = resetRestoreState({ configPath });
    expect(fresh.status).toBe('idle');
    expect(readRestoreState({ configPath }).status).toBe('idle');
  });
});

describe('crash/restart simulation', () => {
  it('state written before a simulated crash is read back identically with no in-memory cache involved', () => {
    const configPath = mkConfigPath();
    transitionRestoreState('preparing', { restoreId: 'crash-test', previousDb: 'studix', candidateDb: 'studix_restore_candidate_x' }, { configPath });
    transitionRestoreState('restoring', {}, { configPath });

    // "restart": every exported function here re-reads from disk on every call — there is no
    // module-level state to reset, which IS the crash-safety property being proven.
    const afterRestart = readRestoreState({ configPath });
    expect(afterRestart.status).toBe('restoring');
    expect(afterRestart.restoreId).toBe('crash-test');
    expect(afterRestart.previousDb).toBe('studix');
    expect(afterRestart.candidateDb).toBe('studix_restore_candidate_x');

    // and the state machine still enforces valid transitions correctly after "restart"
    expect(() => transitionRestoreState('active', {}, { configPath })).toThrow(RestoreStateError);
    const verified = transitionRestoreState('verified', {}, { configPath });
    expect(verified.status).toBe('verified');
  });
});

// Phase 2C-3C Part 5B-1 — closes the dead-end Part 5A's audit found: resetRestoreState() had
// zero production callers, so 'active'/'rolled_back'/'failed' permanently blocked any later,
// independent restore attempt. advanceToIdleIfTerminal() is the one guarded, deliberate caller.
describe('advanceToIdleIfTerminal — the guarded resetRestoreState() caller', () => {
  it.each(['active', 'rolled_back', 'failed'])('resets a genuinely terminal "%s" state back to idle', (terminalStatus) => {
    const configPath = mkConfigPath();
    // build up to the terminal status via real, valid transitions — never hand-construct an
    // impossible state.
    transitionRestoreState('preparing', { restoreId: 'r1', previousDb: 'studix', candidateDb: 'studix_restore_candidate_x' }, { configPath });
    transitionRestoreState('restoring', {}, { configPath });
    transitionRestoreState('verified', {}, { configPath });
    if (terminalStatus === 'failed') {
      transitionRestoreState('failed', { error: 'رسالة خطأ مُنقَّحة — لا بيانات حسّاسة.' }, { configPath });
    } else {
      transitionRestoreState('switching', { switchStatus: 'pending' }, { configPath });
      if (terminalStatus === 'rolled_back') {
        transitionRestoreState('rolling_back', { rollbackStatus: 'pending' }, { configPath });
        transitionRestoreState('rolled_back', {}, { configPath });
      } else {
        transitionRestoreState('active', {}, { configPath });
      }
    }
    expect(readRestoreState({ configPath }).status).toBe(terminalStatus);

    const result = advanceToIdleIfTerminal({ configPath });

    expect(result.status).toBe('idle');
    expect(readRestoreState({ configPath }).status).toBe('idle');
    // point 8 — deterministic: calling it again on the now-idle state is a safe no-op, not an error
    const second = advanceToIdleIfTerminal({ configPath });
    expect(second.status).toBe('idle');
  });

  it('point 8 — an OLD, pre-existing persisted "active" state (simulating a file left over from before this fix) resets deterministically, identically to a freshly-produced one', () => {
    const configPath = mkConfigPath();
    // hand-written, exactly matching createInitialState()'s own shape but with status:'active'
    // directly — simulates a real file that predates advanceToIdleIfTerminal() ever existing,
    // never produced via transitionRestoreState() here on purpose (proving this function works
    // from raw on-disk content, not merely from states it happened to help create itself).
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      status: 'active', restoreId: 'old-r1', previousDb: 'studix', candidateDb: 'studix_restore_candidate_old',
      startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:05:00.000Z',
      verificationStatus: 'completed', switchStatus: 'completed', rollbackStatus: 'pending', error: null,
      renamedPreviousDb: 'studix_previous_old', previousIdentityId: 'id-old-1', candidateIdentityId: 'id-old-2',
    }));

    const result = advanceToIdleIfTerminal({ configPath });
    expect(result.status).toBe('idle');
    expect(readRestoreState({ configPath })).toEqual({
      status: 'idle', restoreId: null, previousDb: null, candidateDb: null, startedAt: null, updatedAt: result.updatedAt,
      verificationStatus: 'pending', switchStatus: 'pending', rollbackStatus: 'pending', error: null,
      renamedPreviousDb: null, previousIdentityId: null, candidateIdentityId: null,
    });
  });

  it.each(['preparing', 'restoring', 'verified', 'switching', 'rolling_back'])('point 4 — NEVER resets a genuinely in-flight "%s" state — returns it completely untouched', (inFlightStatus) => {
    const configPath = mkConfigPath();
    transitionRestoreState('preparing', { restoreId: 'r1', previousDb: 'studix', candidateDb: 'studix_restore_candidate_x' }, { configPath });
    if (['restoring', 'verified', 'switching', 'rolling_back'].includes(inFlightStatus)) transitionRestoreState('restoring', {}, { configPath });
    if (['verified', 'switching', 'rolling_back'].includes(inFlightStatus)) transitionRestoreState('verified', {}, { configPath });
    if (['switching', 'rolling_back'].includes(inFlightStatus)) transitionRestoreState('switching', { switchStatus: 'app_stopping' }, { configPath });
    if (inFlightStatus === 'rolling_back') transitionRestoreState('rolling_back', { rollbackStatus: 'pending' }, { configPath });

    const before = readRestoreState({ configPath });
    expect(before.status).toBe(inFlightStatus);

    const result = advanceToIdleIfTerminal({ configPath });

    expect(result).toEqual(before); // byte-for-byte unchanged — no write happened at all
    expect(readRestoreState({ configPath })).toEqual(before);
  });

  it('point 3/7 — a corrupt file is never silently "fixed" — fails closed exactly like readRestoreState() itself', () => {
    const configPath = mkConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, 'not json {{{', 'utf8');

    expect(() => advanceToIdleIfTerminal({ configPath })).toThrow(RestoreStateError);
    // the corrupt content is completely untouched — never overwritten to "fix" it
    expect(fs.readFileSync(configPath, 'utf8')).toBe('not json {{{');
  });

  it('a missing file (never-ever-run install) is treated as idle — a safe no-op, not an error', () => {
    const configPath = mkConfigPath();
    const result = advanceToIdleIfTerminal({ configPath });
    expect(result.status).toBe('idle');
    expect(fs.existsSync(configPath)).toBe(false); // never creates a file just by checking
  });
});
