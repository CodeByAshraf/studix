// backend/src/routes/dbSwitch.test.js
// Phase 2C-3C Part 2 — pure unit tests (no real PostgreSQL, no real Windows service, no real
// process spawn). `logEventFn` is always injected as a no-op fake here — the real
// logDbSwitchEvent (which writes to `prisma.activity_logs`) is exercised only in
// dbSwitch.integration.test.js's real scratch-database suite, same separation this repo already
// uses (see treasuryTxn.test.js's own header, and license.js's own integration-only coverage).
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  parseCliFailure, spawnDbSwitchCli, triggerDatabaseSwitch,
} from './dbSwitch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const noopLog = async () => {};

// ── mandatory architectural test (Phase 2C-3C audit requirement) ──────────────────────────────
// Comment/prose lines (this file's own header explains the boundary in words, which legitimately
// NAMES performDatabaseSwitch/acquireRestoreLock while explaining why they're NOT used) are
// stripped first — the check that matters is over actual CODE, not documentation prose.
function codeOnly(source) {
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

describe('architecture — the route spawns the CLI, it never imports the database-switch implementation directly', () => {
  const source = fs.readFileSync(path.join(__dirname, 'dbSwitch.js'), 'utf8');
  const code = codeOnly(source);

  it('never imports databaseSwitch.js', () => {
    expect(code).not.toMatch(/from\s+['"][^'"]*databaseSwitch\.js['"]/);
  });

  it('never references performDatabaseSwitch or performRollback in actual code (the orchestration functions themselves)', () => {
    expect(code).not.toMatch(/performDatabaseSwitch/);
    expect(code).not.toMatch(/performRollback/);
  });

  it('never imports PrismaClient / opens a PostgreSQL connection of its own', () => {
    expect(code).not.toMatch(/@prisma\/client/);
    expect(code).not.toMatch(/new\s+PrismaClient/);
  });

  it('never acquires/releases restoreLock.js\'s lock itself in actual code (only reads resolveRestoreLockPath for a peek)', () => {
    expect(code).not.toMatch(/acquireRestoreLock/);
    expect(code).not.toMatch(/releaseRestoreLock/);
    expect(code).toMatch(/resolveRestoreLockPath/); // it DOES reuse the peek-only helper
  });

  it('the restoreLock.js import statement itself pulls in ONLY resolveRestoreLockPath', () => {
    const importLine = code.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/db\/restoreLock\.js['"]/);
    expect(importLine).not.toBeNull();
    const importedNames = importLine[1].split(',').map((s) => s.trim()).filter(Boolean);
    expect(importedNames).toEqual(['resolveRestoreLockPath']);
  });

  it('DOES spawn a child process (child_process) — the actual, intended architecture', () => {
    expect(code).toMatch(/from\s+['"]child_process['"]/);
    expect(code).toMatch(/spawnFn\(/);
  });

  it('server.js mounts the route behind requireAuth + requireRole(\'admin\'), same as /api/license and /api/support-access', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    expect(serverSource).toMatch(/app\.use\(['"]\/api\/db-switch['"],\s*requireAuth,\s*requireRole\('admin'\),\s*dbSwitchRouter\)/);
  });
});

// ── validation ──────────────────────────────────────────────────────────────────────────────
describe('triggerDatabaseSwitch — validation', () => {
  it('missing action is rejected (400)', async () => {
    let caught;
    try {
      await triggerDatabaseSwitch(undefined, { logEventFn: noopLog });
    } catch (err) {
      caught = err;
    }
    expect(caught?.status).toBe(400);
    expect(caught?.expose).toBe(true);
  });

  it('unsupported action is rejected (400)', async () => {
    let caught;
    try {
      await triggerDatabaseSwitch('drop-everything', { logEventFn: noopLog });
    } catch (err) {
      caught = err;
    }
    expect(caught?.status).toBe(400);
  });

  it('a spawnDbSwitchCliFn is never invoked when validation fails', async () => {
    const spawnDbSwitchCliFn = vi.fn();
    await expect(triggerDatabaseSwitch('nonsense', { logEventFn: noopLog, spawnDbSwitchCliFn })).rejects.toThrow();
    expect(spawnDbSwitchCliFn).not.toHaveBeenCalled();
  });
});

// ── extra/dangerous input cannot be forwarded ──────────────────────────────────────────────────
describe('triggerDatabaseSwitch — only `action` is ever read; nothing else reaches the spawned process', () => {
  it('a valid action is forwarded to the CLI with EXACTLY [--action, <value>] — no other argv element, regardless of what else the caller supplies', async () => {
    const spawnDbSwitchCliFn = vi.fn(async () => ({ ok: true, code: 0, stdout: JSON.stringify({ ok: true, action: 'switch', status: 'active' }), stderr: '' }));
    const existsSyncFn = () => false;

    // Simulates a caller that ALSO tried to smuggle extra fields through some other channel —
    // triggerDatabaseSwitch's own signature only ever accepts `action` as user input; there is
    // no code path anywhere in this file that reads a databaseUrl/backupPath/extra-args value.
    await triggerDatabaseSwitch('switch', { logEventFn: noopLog, spawnDbSwitchCliFn, existsSyncFn });

    expect(spawnDbSwitchCliFn).toHaveBeenCalledTimes(1);
    expect(spawnDbSwitchCliFn).toHaveBeenCalledWith('switch');
  });

  it('spawnDbSwitchCli itself passes only [scriptPath, "--action", action] to the underlying spawn call — a DATABASE_URL/backup-path value could never appear even if triggerDatabaseSwitch were bypassed', async () => {
    const spawnFn = vi.fn(() => fakeChild({ code: 0, stdout: '{}' }));
    await spawnDbSwitchCli('rollback', { spawnFn, nodeExecPath: 'C:\\fake\\node.exe', scriptPath: 'C:\\fake\\databaseSwitch.js' });

    expect(spawnFn).toHaveBeenCalledTimes(1);
    const [exe, args, options] = spawnFn.mock.calls[0];
    expect(exe).toBe('C:\\fake\\node.exe');
    expect(args).toEqual(['C:\\fake\\databaseSwitch.js', '--action', 'rollback']);
    // no shell:true anywhere — an array-argv spawn without a shell can never reinterpret its
    // own arguments, so shell injection is structurally impossible regardless of their content.
    expect(options.shell).toBeUndefined();
  });

  it('DATABASE_URL/adminUrl-shaped values passed as `action` are rejected as an unsupported action, never forwarded', async () => {
    const spawnDbSwitchCliFn = vi.fn();
    let caught;
    try {
      await triggerDatabaseSwitch('postgresql://user:pw@host/db', { logEventFn: noopLog, spawnDbSwitchCliFn });
    } catch (err) {
      caught = err;
    }
    expect(caught?.status).toBe(400);
    expect(spawnDbSwitchCliFn).not.toHaveBeenCalled();
  });

  it('a backup-path-shaped value passed as `action` is rejected the same way, never forwarded', async () => {
    const spawnDbSwitchCliFn = vi.fn();
    let caught;
    try {
      await triggerDatabaseSwitch('C:\\ProgramData\\Studix\\backups\\evil.dump', { logEventFn: noopLog, spawnDbSwitchCliFn });
    } catch (err) {
      caught = err;
    }
    expect(caught?.status).toBe(400);
    expect(spawnDbSwitchCliFn).not.toHaveBeenCalled();
  });
});

// ── CLI spawning: exact invocation shape ───────────────────────────────────────────────────────
function fakeChild({ code = 0, stdout = '', stderr = '', errorEvent = null } = {}) {
  const listeners = {};
  const child = {
    stdout: { on: (evt, cb) => { if (evt === 'data' && stdout) cb(Buffer.from(stdout)); } },
    stderr: { on: (evt, cb) => { if (evt === 'data' && stderr) cb(Buffer.from(stderr)); } },
    on: (evt, cb) => { listeners[evt] = cb; },
    kill: vi.fn(),
  };
  // Fire the terminal event asynchronously (matches real child_process timing — listeners are
  // attached before any event fires).
  queueMicrotask(() => {
    if (errorEvent) listeners.error?.(errorEvent);
    else listeners.exit?.(code);
  });
  return child;
}

describe('spawnDbSwitchCli — exact CLI invocation', () => {
  it('"switch" produces exactly the expected CLI invocation', async () => {
    const spawnFn = vi.fn(() => fakeChild({ code: 0, stdout: '{"ok":true}' }));
    await spawnDbSwitchCli('switch', { spawnFn, nodeExecPath: 'node.exe', scriptPath: 'databaseSwitch.js' });
    expect(spawnFn).toHaveBeenCalledWith('node.exe', ['databaseSwitch.js', '--action', 'switch'], expect.any(Object));
  });

  it('"rollback" produces exactly the expected CLI invocation', async () => {
    const spawnFn = vi.fn(() => fakeChild({ code: 0, stdout: '{"ok":true}' }));
    await spawnDbSwitchCli('rollback', { spawnFn, nodeExecPath: 'node.exe', scriptPath: 'databaseSwitch.js' });
    expect(spawnFn).toHaveBeenCalledWith('node.exe', ['databaseSwitch.js', '--action', 'rollback'], expect.any(Object));
  });

  it('does not invoke through a shell', async () => {
    const spawnFn = vi.fn(() => fakeChild({ code: 0, stdout: '{}' }));
    await spawnDbSwitchCli('switch', { spawnFn, nodeExecPath: 'node.exe', scriptPath: 'databaseSwitch.js' });
    const options = spawnFn.mock.calls[0][2];
    expect(options.shell).not.toBe(true);
  });
});

// ── execution results ──────────────────────────────────────────────────────────────────────────
describe('triggerDatabaseSwitch — execution results', () => {
  it('successful CLI execution (exit 0, valid JSON stdout) produces the expected response', async () => {
    const spawnDbSwitchCliFn = async () => ({
      ok: true, code: 0, stdout: JSON.stringify({ ok: true, action: 'switch', status: 'active' }), stderr: '',
    });
    const result = await triggerDatabaseSwitch('switch', { logEventFn: noopLog, spawnDbSwitchCliFn, existsSyncFn: () => false });
    expect(result).toEqual({ ok: true, action: 'switch', status: 'active' });
  });

  it('non-zero CLI exit produces a safe failure response (500 by default reason)', async () => {
    const spawnDbSwitchCliFn = async () => ({
      ok: false, code: 1, stdout: '', stderr: '❌ [app_start_failed] فشل بدء التطبيق بعد التبديل.',
    });
    let caught;
    try {
      await triggerDatabaseSwitch('switch', { logEventFn: noopLog, spawnDbSwitchCliFn, existsSyncFn: () => false });
    } catch (err) {
      caught = err;
    }
    expect(caught.status).toBe(500);
    expect(caught.expose).toBe(true);
    expect(caught.message).toContain('فشل بدء التطبيق');
  });

  it('a lock_held CLI failure maps to 409, not a generic 500', async () => {
    const spawnDbSwitchCliFn = async () => ({
      ok: false, code: 1, stdout: '', stderr: '❌ [lock_held] عملية استعادة أخرى تملك القفل بالفعل.',
    });
    let caught;
    try {
      await triggerDatabaseSwitch('rollback', { logEventFn: noopLog, spawnDbSwitchCliFn, existsSyncFn: () => false });
    } catch (err) {
      caught = err;
    }
    expect(caught.status).toBe(409);
  });

  it('spawn failure produces a safe failure response, never the raw spawn error object', async () => {
    const spawnDbSwitchCliFn = async () => ({ ok: false, spawnError: new Error('ENOENT: node.exe not found') });
    let caught;
    try {
      await triggerDatabaseSwitch('switch', { logEventFn: noopLog, spawnDbSwitchCliFn, existsSyncFn: () => false });
    } catch (err) {
      caught = err;
    }
    expect(caught.status).toBe(500);
    expect(caught.message).not.toContain('ENOENT');
  });

  it('a timeout produces a safe 504 failure response', async () => {
    const spawnDbSwitchCliFn = async () => ({ ok: false, timedOut: true, stdout: '', stderr: '' });
    let caught;
    try {
      await triggerDatabaseSwitch('switch', { logEventFn: noopLog, spawnDbSwitchCliFn, existsSyncFn: () => false });
    } catch (err) {
      caught = err;
    }
    expect(caught.status).toBe(504);
  });

  it('malformed/unexpected stdout on exit 0 is treated as a failure, not a false success', async () => {
    const spawnDbSwitchCliFn = async () => ({ ok: true, code: 0, stdout: 'not json at all', stderr: '' });
    let caught;
    try {
      await triggerDatabaseSwitch('switch', { logEventFn: noopLog, spawnDbSwitchCliFn, existsSyncFn: () => false });
    } catch (err) {
      caught = err;
    }
    expect(caught.status).toBe(500);
  });

  it('sensitive connection-string-like content in CLI stderr is redacted before it ever reaches the HTTP error message', async () => {
    const spawnDbSwitchCliFn = async () => ({
      ok: false, code: 1, stdout: '',
      stderr: '❌ [installation_id_read_failed] تعذّرت قراءة هوية التثبيت: postgresql://studix_admin:supersecret@127.0.0.1:55432/studix',
    });
    let caught;
    try {
      await triggerDatabaseSwitch('switch', { logEventFn: noopLog, spawnDbSwitchCliFn, existsSyncFn: () => false });
    } catch (err) {
      caught = err;
    }
    expect(caught.message).not.toContain('supersecret');
    expect(caught.message).toContain('postgresql://[REDACTED]');
  });
});

// ── concurrency (fast-path pre-check) ────────────────────────────────────────────────────────
describe('triggerDatabaseSwitch — concurrency pre-check', () => {
  it('a second trigger is rejected with 409 while the lock file exists, WITHOUT spawning a child', async () => {
    const spawnDbSwitchCliFn = vi.fn();
    let caught;
    try {
      await triggerDatabaseSwitch('switch', { logEventFn: noopLog, spawnDbSwitchCliFn, existsSyncFn: () => true });
    } catch (err) {
      caught = err;
    }
    expect(caught.status).toBe(409);
    expect(spawnDbSwitchCliFn).not.toHaveBeenCalled();
  });

  it('no double-lock: the route never calls acquireRestoreLock/releaseRestoreLock — only the spawned CLI (a separate process) owns the actual lock', () => {
    // Structural proof, not behavioral — see the architecture describe block above for the
    // authoritative static-source check (comment-stripped). This test documents the invariant
    // this suite relies on.
    const source = fs.readFileSync(path.join(__dirname, 'dbSwitch.js'), 'utf8');
    const code = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).toContain('resolveRestoreLockPath');
    expect(code).not.toContain('acquireRestoreLock(');
  });

  it('when the pre-check misses a race (lock file absent, but the CLI itself then reports lock_held), the route still correctly reports 409 — the pre-check is never trusted as authoritative', async () => {
    const spawnDbSwitchCliFn = async () => ({
      ok: false, code: 1, stdout: '', stderr: '❌ [lock_held] عملية أخرى فازت بالسباق.',
    });
    let caught;
    try {
      await triggerDatabaseSwitch('switch', { logEventFn: noopLog, spawnDbSwitchCliFn, existsSyncFn: () => false });
    } catch (err) {
      caught = err;
    }
    expect(caught.status).toBe(409);
  });
});

// ── parseCliFailure ───────────────────────────────────────────────────────────────────────────
describe('parseCliFailure', () => {
  it('extracts reason and a redacted message from the CLI\'s documented stderr shape', () => {
    const parsed = parseCliFailure('❌ [not_in_switching_state] لا يمكن متابعة التبديل — الحالة الحالية "idle".');
    expect(parsed.reason).toBe('not_in_switching_state');
    expect(parsed.message).toContain('idle');
  });

  it('falls back to a safe unknown reason for unrecognized stderr shapes', () => {
    const parsed = parseCliFailure('some totally different crash output, no [] tag at all');
    expect(parsed.reason).toBe('unknown');
  });

  it('handles empty/missing stderr safely', () => {
    expect(parseCliFailure('').reason).toBe('unknown');
    expect(parseCliFailure(undefined).reason).toBe('unknown');
  });
});
