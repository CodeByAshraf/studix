// backend/src/db/startupOrchestrator.test.js
// Phase 2C-3C Part 5B-3 — pure, mocked unit tests. No real PostgreSQL, no real child process,
// no real Windows service command ever runs in this file (see startupOrchestrator.integration
// .test.js for the one real-PostgreSQL proof of waitForPostgresReady). Every Windows command
// and every child-process outcome is injected via the same dependency-injection convention
// already used throughout this codebase (recoverRestoreState.test.js, dbSwitch.test.js,
// windowsService's own `io` parameter).
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  waitForPostgresReady, spawnRecoveryCheck, orchestrateStartup, StartupOrchestratorError,
} from './startupOrchestrator.js';
import { WindowsServiceError } from '../lib/windowsService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function codeOnly(source) {
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

// ── architecture — never duplicates restore logic, never re-implements the CLI's own state→
// action mapping, never imports the layers this task explicitly forbids modifying ───────────
describe('architecture — the startup orchestrator delegates recovery to recoverRestoreState.js and never duplicates restore logic', () => {
  const source = fs.readFileSync(path.join(__dirname, 'startupOrchestrator.js'), 'utf8');
  const code = codeOnly(source);

  it('never imports databaseSwitch.js', () => {
    expect(code).not.toMatch(/from\s+['"][^'"]*databaseSwitch\.js['"]/);
  });
  it('never imports restoreState.js (no direct restore-state lifecycle access)', () => {
    expect(code).not.toMatch(/from\s+['"][^'"]*restoreState\.js['"]/);
  });
  it('never imports restoreLock.js / acquireRestoreLock (never a second lock owner)', () => {
    expect(code).not.toMatch(/from\s+['"][^'"]*restoreLock\.js['"]/);
    expect(code).not.toMatch(/acquireRestoreLock/);
  });
  it('never imports switchAdapters.js', () => {
    expect(code).not.toMatch(/from\s+['"][^'"]*switchAdapters\.js['"]/);
  });
  it('never imports express or routes/dbSwitch.js', () => {
    expect(code).not.toMatch(/from\s+['"]express['"]/);
    expect(code).not.toMatch(/from\s+['"][^'"]*routes\/dbSwitch\.js['"]/);
  });
  it('never references performDatabaseSwitch or performRollback', () => {
    expect(code).not.toMatch(/performDatabaseSwitch/);
    expect(code).not.toMatch(/performRollback/);
  });
  it('never re-implements the switching/rolling_back status→action mapping', () => {
    expect(code).not.toMatch(/rolling_back['"]\s*:\s*['"]rollback/);
  });
  it('imports recoverRestoreState.js only as a spawn target path, not as an in-process function call', () => {
    expect(code).not.toMatch(/from\s+['"][^'"]*recoverRestoreState\.js['"]/);
    expect(code).toMatch(/recoverRestoreState\.js/); // referenced as a path constant, which IS expected
  });
});

// ── spawnRecoveryCheck — invocation shape (points 17-20: no CLI-argument/executable injection) ─
describe('spawnRecoveryCheck — invokes recoverRestoreState.js as a fixed, argument-free child process', () => {
  it('spawns node.exe (process.execPath) against the fixed recoverRestoreState.js path, no shell, no extra args', async () => {
    const spawnFn = vi.fn(() => fakeChild({ exitCode: 0, stdout: '{"ok":true}' }));
    await spawnRecoveryCheck({ spawnFn });
    expect(spawnFn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawnFn.mock.calls[0];
    expect(cmd).toBe(process.execPath);
    expect(args).toEqual([expect.stringMatching(/recoverRestoreState\.js$/)]);
    expect(opts.shell).not.toBe(true);
  });

  it('resolves ok:true with parsed stdout available on exit code 0', async () => {
    const spawnFn = vi.fn(() => fakeChild({ exitCode: 0, stdout: '{"ok":true,"recovered":false}' }));
    const result = await spawnRecoveryCheck({ spawnFn });
    expect(result).toMatchObject({ ok: true, code: 0, stdout: '{"ok":true,"recovered":false}' });
  });

  it('resolves ok:false on a non-zero exit code', async () => {
    const spawnFn = vi.fn(() => fakeChild({ exitCode: 1, stderr: '❌ [lock_held] locked' }));
    const result = await spawnRecoveryCheck({ spawnFn });
    expect(result).toMatchObject({ ok: false, code: 1 });
  });

  it('resolves spawnError (never throws) when the child process fails to launch', async () => {
    const spawnFn = vi.fn(() => fakeChild({ errorEvent: new Error('ENOENT') }));
    const result = await spawnRecoveryCheck({ spawnFn });
    expect(result.ok).toBe(false);
    expect(result.spawnError).toBeInstanceOf(Error);
  });

  it('resolves timedOut and kills the child when the timeout elapses before exit', async () => {
    const kill = vi.fn();
    const spawnFn = vi.fn(() => fakeChild({ neverExit: true, kill }));
    const result = await spawnRecoveryCheck({ spawnFn, timeoutMs: 5 });
    expect(result.timedOut).toBe(true);
    expect(kill).toHaveBeenCalledTimes(1);
  });
});

// ── waitForPostgresReady — real-readiness signal, bounded polling, never a fixed sleep as the
// correctness mechanism (points 1, 13) ───────────────────────────────────────────────────────
describe('waitForPostgresReady — polls a real connection attempt, never trusts a bare timer alone', () => {
  it('reports ready:true immediately when the first connection attempt succeeds', async () => {
    const connectFn = vi.fn().mockResolvedValue(undefined);
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const result = await waitForPostgresReady({
      readAdminCredentialFn: () => 'postgresql://admin:secret@localhost:5432/postgres',
      connectFn, sleepFn,
    });
    expect(result).toEqual({ ready: true, timedOut: false, error: null });
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('polls (sleeping between attempts) and eventually reports ready once the connection starts succeeding', async () => {
    let attempts = 0;
    const connectFn = vi.fn().mockImplementation(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('connection refused');
    });
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const result = await waitForPostgresReady({
      readAdminCredentialFn: () => 'postgresql://admin:secret@localhost:5432/postgres',
      connectFn, sleepFn, pollIntervalMs: 250,
    });
    expect(result.ready).toBe(true);
    expect(connectFn).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledWith(250);
  });

  it('reports ready:false, timedOut:true once the deadline is reached, without ever succeeding', async () => {
    const connectFn = vi.fn().mockRejectedValue(new Error('connection refused'));
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    let now = 0;
    const nowFn = () => now;
    const result = await waitForPostgresReady({
      readAdminCredentialFn: () => 'postgresql://admin:secret@localhost:5432/postgres',
      connectFn,
      sleepFn: async () => { now += 1000; },
      nowFn,
      timeoutMs: 3000,
      pollIntervalMs: 1000,
    });
    expect(result.ready).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it('redacts a connection-string-bearing error before returning it', async () => {
    const connectFn = vi.fn().mockRejectedValue(
      new Error('could not connect to postgresql://admin:S3cret@localhost:5432/postgres')
    );
    const result = await waitForPostgresReady({
      readAdminCredentialFn: () => 'postgresql://admin:S3cret@localhost:5432/postgres',
      sleepFn: vi.fn().mockResolvedValue(undefined),
      connectFn,
      timeoutMs: 0,
      nowFn: () => 0,
    });
    expect(result.ready).toBe(false);
    expect(result.error).not.toMatch(/S3cret/);
    expect(result.error).toMatch(/\[REDACTED\]/);
  });
});

// ── orchestrateStartup — the full sequence, and the "no race" proof itself ──────────────────
describe('orchestrateStartup — PostgreSQL readiness -> recovery -> StudixApp start, strictly in that order', () => {
  it('does not start StudixApp, and never attempts recovery, when PostgreSQL never becomes ready (point 13)', async () => {
    const waitForPostgresReadyFn = vi.fn().mockResolvedValue({ ready: false, timedOut: true, error: 'timed out' });
    const spawnRecoveryCheckFn = vi.fn();
    const startAppFn = vi.fn();
    const result = await orchestrateStartup({ waitForPostgresReadyFn, spawnRecoveryCheckFn, startAppFn });
    expect(result).toMatchObject({ shouldStartApp: false, appStarted: false, reason: 'postgres_not_ready' });
    expect(spawnRecoveryCheckFn).not.toHaveBeenCalled();
    expect(startAppFn).not.toHaveBeenCalled();
  });

  it('starts StudixApp when PostgreSQL is ready and no recovery is needed (idle) (point 2)', async () => {
    const waitForPostgresReadyFn = vi.fn().mockResolvedValue({ ready: true, timedOut: false, error: null });
    const spawnRecoveryCheckFn = vi.fn().mockResolvedValue({
      ok: true, code: 0, stdout: JSON.stringify({ ok: true, recovered: false, status: 'idle', reason: 'no_recovery_needed' }),
    });
    const startAppFn = vi.fn().mockResolvedValue(undefined);
    const result = await orchestrateStartup({ waitForPostgresReadyFn, spawnRecoveryCheckFn, startAppFn });
    expect(result).toMatchObject({ shouldStartApp: true, appStarted: true, reason: 'started' });
    expect(startAppFn).toHaveBeenCalledTimes(1);
  });

  it('starts StudixApp when PostgreSQL is ready and a pending switch is successfully recovered (point 6)', async () => {
    const waitForPostgresReadyFn = vi.fn().mockResolvedValue({ ready: true, timedOut: false, error: null });
    const spawnRecoveryCheckFn = vi.fn().mockResolvedValue({
      ok: true, code: 0, stdout: JSON.stringify({ ok: true, recovered: true, status: 'active', reason: 'completed' }),
    });
    const startAppFn = vi.fn().mockResolvedValue(undefined);
    const result = await orchestrateStartup({ waitForPostgresReadyFn, spawnRecoveryCheckFn, startAppFn });
    expect(result.shouldStartApp).toBe(true);
    expect(result.recovery.status).toBe('active');
  });

  it('starts StudixApp when PostgreSQL is ready and a pending rollback is successfully recovered (point 7)', async () => {
    const waitForPostgresReadyFn = vi.fn().mockResolvedValue({ ready: true, timedOut: false, error: null });
    const spawnRecoveryCheckFn = vi.fn().mockResolvedValue({
      ok: true, code: 0, stdout: JSON.stringify({ ok: true, recovered: true, status: 'rolled_back', reason: 'completed' }),
    });
    const startAppFn = vi.fn().mockResolvedValue(undefined);
    const result = await orchestrateStartup({ waitForPostgresReadyFn, spawnRecoveryCheckFn, startAppFn });
    expect(result.shouldStartApp).toBe(true);
  });

  it('does not start StudixApp when the recovery child process fails to spawn (point 14)', async () => {
    const waitForPostgresReadyFn = vi.fn().mockResolvedValue({ ready: true, timedOut: false, error: null });
    const spawnRecoveryCheckFn = vi.fn().mockResolvedValue({ ok: false, spawnError: new Error('ENOENT'), stdout: '', stderr: '' });
    const startAppFn = vi.fn();
    const result = await orchestrateStartup({ waitForPostgresReadyFn, spawnRecoveryCheckFn, startAppFn });
    expect(result).toMatchObject({ shouldStartApp: false, reason: 'recovery_spawn_failed' });
    expect(startAppFn).not.toHaveBeenCalled();
  });

  it('does not start StudixApp when the recovery child process times out (point 12)', async () => {
    const waitForPostgresReadyFn = vi.fn().mockResolvedValue({ ready: true, timedOut: false, error: null });
    const spawnRecoveryCheckFn = vi.fn().mockResolvedValue({ ok: false, timedOut: true, stdout: '', stderr: '' });
    const startAppFn = vi.fn();
    const result = await orchestrateStartup({ waitForPostgresReadyFn, spawnRecoveryCheckFn, startAppFn });
    expect(result).toMatchObject({ shouldStartApp: false, reason: 'recovery_timeout' });
    expect(startAppFn).not.toHaveBeenCalled();
  });

  it('does not start StudixApp when the recovery process exits 0 but prints unparseable stdout', async () => {
    const waitForPostgresReadyFn = vi.fn().mockResolvedValue({ ready: true, timedOut: false, error: null });
    const spawnRecoveryCheckFn = vi.fn().mockResolvedValue({ ok: true, code: 0, stdout: 'not json', stderr: '' });
    const startAppFn = vi.fn();
    const result = await orchestrateStartup({ waitForPostgresReadyFn, spawnRecoveryCheckFn, startAppFn });
    expect(result).toMatchObject({ shouldStartApp: false, reason: 'recovery_output_unparseable' });
    expect(startAppFn).not.toHaveBeenCalled();
  });

  it('does not start StudixApp when the recovery process itself reports a genuine failure (e.g. lock_held) (point 11)', async () => {
    // recoverRestoreState.js's own main() always prints its structured JSON result to stdout
    // even when it sets a non-zero exitCode (ok:false) — this mirrors that exact contract,
    // not an empty-stdout failure (that case is covered separately as "unparseable").
    const waitForPostgresReadyFn = vi.fn().mockResolvedValue({ ready: true, timedOut: false, error: null });
    const spawnRecoveryCheckFn = vi.fn().mockResolvedValue({
      ok: false, code: 1, stdout: JSON.stringify({ ok: false, recovered: false, reason: 'lock_held', error: 'قفل محتجز' }), stderr: '',
    });
    const startAppFn = vi.fn();
    const result = await orchestrateStartup({ waitForPostgresReadyFn, spawnRecoveryCheckFn, startAppFn });
    expect(result).toMatchObject({ shouldStartApp: false, reason: 'recovery_failed' });
    expect(startAppFn).not.toHaveBeenCalled();
  });

  it('does not start StudixApp when the recovery process exits 0 but its own structured result says ok:false', async () => {
    const waitForPostgresReadyFn = vi.fn().mockResolvedValue({ ready: true, timedOut: false, error: null });
    const spawnRecoveryCheckFn = vi.fn().mockResolvedValue({
      ok: true, code: 0, stdout: JSON.stringify({ ok: false, reason: 'corrupt_state' }), stderr: '',
    });
    const startAppFn = vi.fn();
    const result = await orchestrateStartup({ waitForPostgresReadyFn, spawnRecoveryCheckFn, startAppFn });
    expect(result).toMatchObject({ shouldStartApp: false, reason: 'recovery_failed' });
    expect(startAppFn).not.toHaveBeenCalled();
  });

  it('reports app_start_failed (never throws) when startAppFn itself fails, e.g. StudixApp not registered', async () => {
    const waitForPostgresReadyFn = vi.fn().mockResolvedValue({ ready: true, timedOut: false, error: null });
    const spawnRecoveryCheckFn = vi.fn().mockResolvedValue({
      ok: true, code: 0, stdout: JSON.stringify({ ok: true, recovered: false, status: 'idle' }),
    });
    const startAppFn = vi.fn().mockRejectedValue(new WindowsServiceError('not_registered', 'الخدمة غير مسجَّلة'));
    const result = await orchestrateStartup({ waitForPostgresReadyFn, spawnRecoveryCheckFn, startAppFn });
    expect(result).toMatchObject({ shouldStartApp: true, appStarted: false, reason: 'app_start_failed' });
    expect(result.error).toMatch(/غير مسجَّلة/);
  });

  it('proves ordering by construction: recovery is only invoked after PostgreSQL readiness has resolved', async () => {
    const order = [];
    const waitForPostgresReadyFn = vi.fn().mockImplementation(async () => {
      order.push('postgres_ready_checked');
      return { ready: true, timedOut: false, error: null };
    });
    const spawnRecoveryCheckFn = vi.fn().mockImplementation(async () => {
      order.push('recovery_checked');
      return { ok: true, code: 0, stdout: JSON.stringify({ ok: true, recovered: false, status: 'idle' }) };
    });
    const startAppFn = vi.fn().mockImplementation(async () => { order.push('app_started'); });
    await orchestrateStartup({ waitForPostgresReadyFn, spawnRecoveryCheckFn, startAppFn });
    expect(order).toEqual(['postgres_ready_checked', 'recovery_checked', 'app_started']);
  });

  it('spawns recovery exactly once per orchestrateStartup() invocation — no duplicate recovery process (point 16)', async () => {
    const waitForPostgresReadyFn = vi.fn().mockResolvedValue({ ready: true, timedOut: false, error: null });
    const spawnRecoveryCheckFn = vi.fn().mockResolvedValue({
      ok: true, code: 0, stdout: JSON.stringify({ ok: true, recovered: false, status: 'idle' }),
    });
    const startAppFn = vi.fn().mockResolvedValue(undefined);
    await orchestrateStartup({ waitForPostgresReadyFn, spawnRecoveryCheckFn, startAppFn });
    expect(spawnRecoveryCheckFn).toHaveBeenCalledTimes(1);
  });

  it('is safe to invoke repeatedly (e.g. a retried boot task) — each call independently re-evaluates readiness and recovery (point 15)', async () => {
    const waitForPostgresReadyFn = vi.fn().mockResolvedValue({ ready: true, timedOut: false, error: null });
    const spawnRecoveryCheckFn = vi.fn().mockResolvedValue({
      ok: true, code: 0, stdout: JSON.stringify({ ok: true, recovered: false, status: 'active' }),
    });
    const startAppFn = vi.fn().mockResolvedValue(undefined);
    const first = await orchestrateStartup({ waitForPostgresReadyFn, spawnRecoveryCheckFn, startAppFn });
    const second = await orchestrateStartup({ waitForPostgresReadyFn, spawnRecoveryCheckFn, startAppFn });
    expect(first.shouldStartApp).toBe(true);
    expect(second.shouldStartApp).toBe(true);
    expect(startAppFn).toHaveBeenCalledTimes(2); // startService() itself is the idempotent layer (already_running)
  });

  it('never derives the app-start decision from the child exit code alone — recovery.ok:false with exit code 0 still blocks startup', async () => {
    const waitForPostgresReadyFn = vi.fn().mockResolvedValue({ ready: true, timedOut: false, error: null });
    const spawnRecoveryCheckFn = vi.fn().mockResolvedValue({
      ok: true, code: 0, stdout: JSON.stringify({ ok: false, reason: 'unparseable_result' }),
    });
    const startAppFn = vi.fn();
    const result = await orchestrateStartup({ waitForPostgresReadyFn, spawnRecoveryCheckFn, startAppFn });
    expect(result.shouldStartApp).toBe(false);
    expect(startAppFn).not.toHaveBeenCalled();
  });

});

// ── security — no argument/credential injection anywhere in this module (points 17-20) ──────
describe('security — StartupOrchestratorError and fixed-path invocation', () => {
  it('StartupOrchestratorError carries a reason and message, matching the rest of this codebase\'s error convention', () => {
    const err = new StartupOrchestratorError('example_reason', 'example message');
    expect(err.reason).toBe('example_reason');
    expect(err.message).toBe('example message');
    expect(err).toBeInstanceOf(Error);
  });

  it('spawnRecoveryCheck never passes a state-derived, credential-shaped, or path-shaped value as an argument', async () => {
    const spawnFn = vi.fn(() => fakeChild({ exitCode: 0, stdout: '{"ok":true}' }));
    await spawnRecoveryCheck({ spawnFn });
    const [, args] = spawnFn.mock.calls[0];
    for (const arg of args) {
      expect(arg).not.toMatch(/postgres(ql)?:\/\//i);
      expect(arg).not.toMatch(/--action/);
    }
  });
});

// ── helper: a minimal fake ChildProcess-like EventEmitter for spawnFn injection ─────────────
function fakeChild({ exitCode, stdout = '', stderr = '', errorEvent, neverExit = false, kill = () => {} } = {}) {
  const listeners = { data_stdout: [], data_stderr: [], error: [], exit: [] };
  const child = {
    stdout: { on: (evt, cb) => { if (evt === 'data' && stdout) listeners.data_stdout.push(cb); } },
    stderr: { on: (evt, cb) => { if (evt === 'data' && stderr) listeners.data_stderr.push(cb); } },
    on: (evt, cb) => { listeners[evt]?.push(cb); },
    kill,
  };
  queueMicrotask(() => {
    listeners.data_stdout.forEach((cb) => cb(Buffer.from(stdout)));
    listeners.data_stderr.forEach((cb) => cb(Buffer.from(stderr)));
    if (errorEvent) {
      listeners.error.forEach((cb) => cb(errorEvent));
    } else if (!neverExit) {
      listeners.exit.forEach((cb) => cb(exitCode));
    }
  });
  return child;
}
