// backend/src/db/restoreLock.test.js
// Phase 2C-3C Part 1 — unit tests for the file-based restore-operation lock. Every test uses a
// real temp directory (fs.mkdtempSync) and an explicit configPath — never the real
// C:\ProgramData\Studix\config\restore-state.lock. No real second OS process is ever spawned —
// "process-independent behavior" is proven by using a completely fresh require-free read of the
// same on-disk lock file (no module-level cache anywhere in restoreLock.js), and by injecting
// `isProcessAlive`/`pid` exactly like a second, unrelated process would present itself.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  acquireRestoreLock, releaseRestoreLock, resolveRestoreLockPath, RestoreLockError,
} from './restoreLock.js';
import { transitionRestoreState, readRestoreState } from './restoreState.js';

function mkPaths() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-restorelock-test-'));
  return {
    lockPath: path.join(tmpDir, 'config', 'restore-state.lock'),
    statePath: path.join(tmpDir, 'config', 'restore-state.json'),
  };
}

// expectReason: the Arabic error messages don't embed the machine-readable `.reason` code
// literally, so `.toThrow(/reason/)` can't match them — check `.reason` directly instead, same
// convention already used by databaseSwitch.test.js's own assertSameInstallation tests. Calls
// `fn` exactly ONCE (not twice, unlike a naive `.toThrow()` + separate try/catch) — some of this
// file's own fakes are deliberately stateful/order-dependent (simulating a real race), so a
// second, incidental invocation would observe a different, already-mutated world.
function expectReason(fn, reason) {
  let caught;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RestoreLockError);
  expect(caught.reason).toBe(reason);
}

describe('resolveRestoreLockPath', () => {
  it('respects STUDIX_RESTORE_LOCK_PATH override', () => {
    const original = process.env.STUDIX_RESTORE_LOCK_PATH;
    process.env.STUDIX_RESTORE_LOCK_PATH = 'D:\\Custom\\restore-state.lock';
    try {
      expect(resolveRestoreLockPath()).toBe('D:\\Custom\\restore-state.lock');
    } finally {
      if (original === undefined) delete process.env.STUDIX_RESTORE_LOCK_PATH;
      else process.env.STUDIX_RESTORE_LOCK_PATH = original;
    }
  });
});

describe('acquireRestoreLock — first acquisition', () => {
  it('succeeds and creates the lock file with the caller pid', () => {
    const { lockPath } = mkPaths();
    const result = acquireRestoreLock({ configPath: lockPath, pid: 111 });
    expect(result).toEqual({ acquired: true, stolenFromStalePid: null });
    expect(fs.existsSync(lockPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(written.pid).toBe(111);
    expect(typeof written.acquiredAt).toBe('string');
  });

  it('creates the parent config directory if missing', () => {
    const { lockPath } = mkPaths();
    expect(fs.existsSync(path.dirname(lockPath))).toBe(false);
    acquireRestoreLock({ configPath: lockPath, pid: 111 });
    expect(fs.existsSync(path.dirname(lockPath))).toBe(true);
  });
});

describe('acquireRestoreLock — second concurrent acquisition', () => {
  it('fails with lock_held when the recorded pid is reported alive — never silently overwrites it', () => {
    const { lockPath } = mkPaths();
    acquireRestoreLock({ configPath: lockPath, pid: 111 });

    expect(() => acquireRestoreLock({
      configPath: lockPath, pid: 222, isProcessAlive: () => true,
    })).toThrow(RestoreLockError);
    try {
      acquireRestoreLock({ configPath: lockPath, pid: 222, isProcessAlive: () => true });
    } catch (err) {
      expect(err.reason).toBe('lock_held');
      expect(err.message).toContain('111');
    }
    // the ORIGINAL lock (pid 111) is still exactly what is on disk — never overwritten
    const written = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(written.pid).toBe(111);
  });
});

describe('acquireRestoreLock — release allows a later acquisition', () => {
  it('a fresh acquisition succeeds after the holder releases', () => {
    const { lockPath } = mkPaths();
    acquireRestoreLock({ configPath: lockPath, pid: 111 });
    releaseRestoreLock({ configPath: lockPath, pid: 111 });
    expect(fs.existsSync(lockPath)).toBe(false);

    const result = acquireRestoreLock({ configPath: lockPath, pid: 222, isProcessAlive: () => true });
    expect(result.acquired).toBe(true);
    const written = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(written.pid).toBe(222);
  });
});

describe('acquireRestoreLock — stale lock handling (deterministic rule: is the recorded pid alive?)', () => {
  it('reclaims a lock whose recorded pid is reported dead, never treating it as unconditionally safe by any other rule', () => {
    const { lockPath } = mkPaths();
    acquireRestoreLock({ configPath: lockPath, pid: 999 }); // simulates a crashed prior process

    const result = acquireRestoreLock({ configPath: lockPath, pid: 222, isProcessAlive: () => false });
    expect(result).toEqual({ acquired: true, stolenFromStalePid: 999 });
    const written = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(written.pid).toBe(222);
  });

  it('the default isProcessAlive genuinely recognizes THIS running process (process.pid) as alive', () => {
    // Proves the real default rule (process.kill(pid, 0)) — not merely the injected fake used
    // by every other test in this file — actually works, using this very test process's own pid,
    // which is guaranteed alive for the duration of the test.
    const { lockPath } = mkPaths();
    acquireRestoreLock({ configPath: lockPath, pid: process.pid });
    expectReason(() => acquireRestoreLock({ configPath: lockPath, pid: process.pid + 1 }), 'lock_held');
  });
});

describe('acquireRestoreLock — corrupt lock handling (never silently treated as safe)', () => {
  it('rejects with corrupt_lock when the lock file exists but is not valid JSON', () => {
    const { lockPath } = mkPaths();
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, 'not json{{{', 'utf8');

    expect(() => acquireRestoreLock({ configPath: lockPath, pid: 222 })).toThrow(RestoreLockError);
    try {
      acquireRestoreLock({ configPath: lockPath, pid: 222 });
    } catch (err) {
      expect(err.reason).toBe('corrupt_lock');
    }
  });

  it('rejects with corrupt_lock when the lock file is valid JSON but the wrong shape (no pid)', () => {
    const { lockPath } = mkPaths();
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ notAPid: true }), 'utf8');

    expectReason(() => acquireRestoreLock({ configPath: lockPath, pid: 222 }), 'corrupt_lock');
  });

  it('never deletes or steals a corrupt lock automatically — it is still there after the rejection', () => {
    const { lockPath } = mkPaths();
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, 'not json{{{', 'utf8');

    expect(() => acquireRestoreLock({ configPath: lockPath, pid: 222 })).toThrow();
    expect(fs.existsSync(lockPath)).toBe(true);
    expect(fs.readFileSync(lockPath, 'utf8')).toBe('not json{{{');
  });
});

describe('process-independent behavior', () => {
  it('a lock acquired with one pid is visible/enforced by a completely separate call with no shared in-memory state', () => {
    const { lockPath } = mkPaths();
    // acquire as if "process A" (pid 111)
    acquireRestoreLock({ configPath: lockPath, pid: 111 });
    // "process B" — a fresh call, no reference to the earlier acquireRestoreLock() call's return
    // value or any module-level state; the ONLY shared thing is the file on disk.
    expectReason(
      () => acquireRestoreLock({ configPath: lockPath, pid: 222, isProcessAlive: () => true }),
      'lock_held'
    );
  });

  it('release refuses to remove a lock this pid does not own — never overwrites another active restore', () => {
    const { lockPath } = mkPaths();
    acquireRestoreLock({ configPath: lockPath, pid: 111 });
    expect(() => releaseRestoreLock({ configPath: lockPath, pid: 222 })).toThrow(RestoreLockError);
    try {
      releaseRestoreLock({ configPath: lockPath, pid: 222 });
    } catch (err) {
      expect(err.reason).toBe('not_lock_owner');
    }
    expect(fs.existsSync(lockPath)).toBe(true); // untouched
  });

  it('releasing an already-released (or never-acquired) lock is a safe no-op, never an error', () => {
    const { lockPath } = mkPaths();
    const result = releaseRestoreLock({ configPath: lockPath, pid: 111 });
    expect(result).toEqual({ released: false, reason: 'not_locked' });
  });
});

describe('failure does not leave an unsafe active lock', () => {
  it('a failed acquisition (lock_held) never writes/mutates anything on disk', () => {
    const { lockPath } = mkPaths();
    acquireRestoreLock({ configPath: lockPath, pid: 111 });
    const before = fs.readFileSync(lockPath, 'utf8');

    expect(() => acquireRestoreLock({ configPath: lockPath, pid: 222, isProcessAlive: () => true })).toThrow();

    expect(fs.readFileSync(lockPath, 'utf8')).toBe(before); // byte-for-byte unchanged
  });

  it('a race where another process wins the stale-lock slot first surfaces as lock_held, not a corrupted/partial file', () => {
    const { lockPath } = mkPaths();
    acquireRestoreLock({ configPath: lockPath, pid: 999 }); // will be treated as stale

    let calls = 0;
    const writeFileSync = (filePath, data, options) => {
      calls += 1;
      // call 1: the initial attempt — must genuinely hit the real, already-there lock (pid 999),
      // so acquireRestoreLock correctly proceeds to the staleness check. call 2: the RECLAIM
      // attempt, after this process already unlinked the stale lock — simulate a second process
      // winning the race for that just-freed slot right before this one's own re-write.
      if (calls === 1) return fs.writeFileSync(filePath, data, options);
      const err = new Error('EEXIST: file already exists');
      err.code = 'EEXIST';
      throw err;
    };

    expectReason(
      () => acquireRestoreLock({ configPath: lockPath, pid: 222, isProcessAlive: () => false, writeFileSync }),
      'lock_held'
    );
  });
});

describe('restore state cannot be concurrently mutated — the practical guarantee this lock exists for', () => {
  it('a second acquisition attempt is rejected BEFORE it ever gets a chance to call transitionRestoreState, so the two never interleave', () => {
    const { lockPath, statePath } = mkPaths();

    // "process A" begins a restore operation and holds the lock for its duration.
    acquireRestoreLock({ configPath: lockPath, pid: 111 });
    transitionRestoreState('preparing', {
      restoreId: 'r1', previousDb: 'studix', candidateDb: 'cand1',
      startedAt: new Date().toISOString(), verificationStatus: 'pending', switchStatus: 'pending',
      rollbackStatus: 'pending', error: null,
    }, { configPath: statePath });

    // "process B" tries to start a SECOND, concurrent operation — the lock refuses it outright,
    // so it never reaches a transitionRestoreState() call that could otherwise race process A's.
    expectReason(
      () => acquireRestoreLock({ configPath: lockPath, pid: 222, isProcessAlive: () => true }),
      'lock_held'
    );

    // process A's own state transition is exactly as it left it — never interleaved/corrupted.
    const state = readRestoreState({ configPath: statePath });
    expect(state.status).toBe('preparing');
    expect(state.restoreId).toBe('r1');
  });
});
