// backend/src/db/recoverRestoreState.test.js
// Phase 2C-3C Part 5B-2 — pure unit tests (no real PostgreSQL, no real Windows service, no
// real process spawn). Restore-state reading uses REAL restoreState.js functions against real
// temp directories (fast, no network) — only the child-process spawn is ever mocked, matching
// the task's own preference for "deterministic unit tests with injected child-process
// behavior."
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  recoverRestoreIfNeeded, spawnDatabaseSwitchCli,
} from './recoverRestoreState.js';
import { readRestoreState, transitionRestoreState } from './restoreState.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function mkConfigPath() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-recover-test-'));
  return path.join(tmpDir, 'restore-state.json');
}

function realStateFn(configPath) {
  return () => readRestoreState({ configPath });
}

// ── mandatory architectural checks ─────────────────────────────────────────────────────────────
function codeOnly(source) {
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

describe('architecture — the recovery entry point spawns the CLI, it never imports the database-switch implementation directly (points 21/22/23)', () => {
  const source = fs.readFileSync(path.join(__dirname, 'recoverRestoreState.js'), 'utf8');
  const code = codeOnly(source);

  it('never references performDatabaseSwitch or performRollback in actual code', () => {
    expect(code).not.toMatch(/performDatabaseSwitch/);
    expect(code).not.toMatch(/performRollback/);
  });

  it('never imports databaseSwitch.js', () => {
    expect(code).not.toMatch(/from\s+['"][^'"]*databaseSwitch\.js['"]/);
  });

  it('never imports PrismaClient / opens a PostgreSQL connection of its own', () => {
    expect(code).not.toMatch(/@prisma\/client/);
    expect(code).not.toMatch(/new\s+PrismaClient/);
  });

  it('never imports Express/HTTP routing', () => {
    expect(code).not.toMatch(/from\s+['"]express['"]/);
    expect(code).not.toMatch(/Router\(/);
  });

  it('never acquires/releases restoreLock.js\'s lock itself (point 23 — restoreLock remains solely authoritative)', () => {
    expect(code).not.toMatch(/acquireRestoreLock/);
    expect(code).not.toMatch(/releaseRestoreLock/);
    expect(code).not.toMatch(/restoreLock\.js/);
  });

  it('DOES spawn a child process — the actual, intended architecture', () => {
    expect(code).toMatch(/from\s+['"]child_process['"]/);
    expect(code).toMatch(/spawnFn\(/);
  });
});

// ── state -> action mapping (points 1-9) ─────────────────────────────────────────────────────
describe('recoverRestoreIfNeeded — state -> action mapping', () => {
  it.each(['idle'])('1. "%s" -> no recovery, no spawn', async (status) => {
    const configPath = mkConfigPath(); // missing file -> idle, the default
    const spawnDatabaseSwitchCliFn = vi.fn();
    const result = await recoverRestoreIfNeeded({ readRestoreStateFn: realStateFn(configPath), spawnDatabaseSwitchCliFn });
    expect(result).toEqual({ recovered: false, action: null, status: 'idle', reason: 'no_recovery_needed', ok: true });
    expect(spawnDatabaseSwitchCliFn).not.toHaveBeenCalled();
  });

  it('2. "active" -> no recovery, no spawn', async () => {
    const configPath = mkConfigPath();
    transitionRestoreState('preparing', { restoreId: 'r1', previousDb: 'studix', candidateDb: 'studix_restore_candidate_x' }, { configPath });
    transitionRestoreState('restoring', {}, { configPath });
    transitionRestoreState('verified', {}, { configPath });
    transitionRestoreState('switching', { switchStatus: 'pending' }, { configPath });
    transitionRestoreState('active', {}, { configPath });

    const spawnDatabaseSwitchCliFn = vi.fn();
    const result = await recoverRestoreIfNeeded({ readRestoreStateFn: realStateFn(configPath), spawnDatabaseSwitchCliFn });
    expect(result).toEqual({ recovered: false, action: null, status: 'active', reason: 'no_recovery_needed', ok: true });
    expect(spawnDatabaseSwitchCliFn).not.toHaveBeenCalled();
  });

  it('3. "rolled_back" -> no recovery, no spawn', async () => {
    const configPath = mkConfigPath();
    transitionRestoreState('preparing', { restoreId: 'r1', previousDb: 'studix', candidateDb: 'studix_restore_candidate_x' }, { configPath });
    transitionRestoreState('restoring', {}, { configPath });
    transitionRestoreState('verified', {}, { configPath });
    transitionRestoreState('switching', { switchStatus: 'pending' }, { configPath });
    transitionRestoreState('rolling_back', { rollbackStatus: 'pending' }, { configPath });
    transitionRestoreState('rolled_back', {}, { configPath });

    const spawnDatabaseSwitchCliFn = vi.fn();
    const result = await recoverRestoreIfNeeded({ readRestoreStateFn: realStateFn(configPath), spawnDatabaseSwitchCliFn });
    expect(result).toEqual({ recovered: false, action: null, status: 'rolled_back', reason: 'no_recovery_needed', ok: true });
    expect(spawnDatabaseSwitchCliFn).not.toHaveBeenCalled();
  });

  it('4. "failed" -> no recovery, no spawn', async () => {
    const configPath = mkConfigPath();
    transitionRestoreState('preparing', { restoreId: 'r1', previousDb: 'studix', candidateDb: 'studix_restore_candidate_x' }, { configPath });
    transitionRestoreState('failed', { error: 'رسالة مُنقَّحة.' }, { configPath });

    const spawnDatabaseSwitchCliFn = vi.fn();
    const result = await recoverRestoreIfNeeded({ readRestoreStateFn: realStateFn(configPath), spawnDatabaseSwitchCliFn });
    expect(result).toEqual({ recovered: false, action: null, status: 'failed', reason: 'no_recovery_needed', ok: true });
    expect(spawnDatabaseSwitchCliFn).not.toHaveBeenCalled();
  });

  it('5. "preparing" -> no recovery, no spawn', async () => {
    const configPath = mkConfigPath();
    transitionRestoreState('preparing', { restoreId: 'r1', previousDb: 'studix', candidateDb: 'studix_restore_candidate_x' }, { configPath });

    const spawnDatabaseSwitchCliFn = vi.fn();
    const result = await recoverRestoreIfNeeded({ readRestoreStateFn: realStateFn(configPath), spawnDatabaseSwitchCliFn });
    expect(result).toEqual({ recovered: false, action: null, status: 'preparing', reason: 'no_recovery_needed', ok: true });
    expect(spawnDatabaseSwitchCliFn).not.toHaveBeenCalled();
  });

  it('6. "restoring" -> no recovery, no spawn', async () => {
    const configPath = mkConfigPath();
    transitionRestoreState('preparing', { restoreId: 'r1', previousDb: 'studix', candidateDb: 'studix_restore_candidate_x' }, { configPath });
    transitionRestoreState('restoring', {}, { configPath });

    const spawnDatabaseSwitchCliFn = vi.fn();
    const result = await recoverRestoreIfNeeded({ readRestoreStateFn: realStateFn(configPath), spawnDatabaseSwitchCliFn });
    expect(result).toEqual({ recovered: false, action: null, status: 'restoring', reason: 'no_recovery_needed', ok: true });
    expect(spawnDatabaseSwitchCliFn).not.toHaveBeenCalled();
  });

  it('7. "verified" -> no recovery, no spawn — CRITICAL: a candidate existing is never, by itself, a reason to auto-trigger a switch', async () => {
    const configPath = mkConfigPath();
    transitionRestoreState('preparing', { restoreId: 'r1', previousDb: 'studix', candidateDb: 'studix_restore_candidate_x' }, { configPath });
    transitionRestoreState('restoring', {}, { configPath });
    transitionRestoreState('verified', {}, { configPath });

    const spawnDatabaseSwitchCliFn = vi.fn();
    const result = await recoverRestoreIfNeeded({ readRestoreStateFn: realStateFn(configPath), spawnDatabaseSwitchCliFn });
    expect(result).toEqual({ recovered: false, action: null, status: 'verified', reason: 'no_recovery_needed', ok: true });
    expect(spawnDatabaseSwitchCliFn).not.toHaveBeenCalled();
  });

  it('8. "switching" -> invokes the CLI with exactly --action switch', async () => {
    const configPath = mkConfigPath();
    transitionRestoreState('preparing', { restoreId: 'r1', previousDb: 'studix', candidateDb: 'studix_restore_candidate_x' }, { configPath });
    transitionRestoreState('restoring', {}, { configPath });
    transitionRestoreState('verified', {}, { configPath });
    transitionRestoreState('switching', { switchStatus: 'app_stopping' }, { configPath });

    const spawnDatabaseSwitchCliFn = vi.fn(async (action) => ({ ok: true, code: 0, stdout: JSON.stringify({ ok: true, action, status: 'active' }), stderr: '' }));
    const result = await recoverRestoreIfNeeded({ readRestoreStateFn: realStateFn(configPath), spawnDatabaseSwitchCliFn });

    expect(spawnDatabaseSwitchCliFn).toHaveBeenCalledWith('switch');
    expect(spawnDatabaseSwitchCliFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ recovered: true, action: 'switch', status: 'active', reason: 'completed', ok: true });
  });

  it('9. "rolling_back" -> invokes the CLI with exactly --action rollback', async () => {
    const configPath = mkConfigPath();
    transitionRestoreState('preparing', { restoreId: 'r1', previousDb: 'studix', candidateDb: 'studix_restore_candidate_x' }, { configPath });
    transitionRestoreState('restoring', {}, { configPath });
    transitionRestoreState('verified', {}, { configPath });
    transitionRestoreState('switching', { switchStatus: 'pending' }, { configPath });
    transitionRestoreState('rolling_back', { rollbackStatus: 'app_stopping' }, { configPath });

    const spawnDatabaseSwitchCliFn = vi.fn(async (action) => ({ ok: true, code: 0, stdout: JSON.stringify({ ok: true, action, status: 'rolled_back' }), stderr: '' }));
    const result = await recoverRestoreIfNeeded({ readRestoreStateFn: realStateFn(configPath), spawnDatabaseSwitchCliFn });

    expect(spawnDatabaseSwitchCliFn).toHaveBeenCalledWith('rollback');
    expect(spawnDatabaseSwitchCliFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ recovered: true, action: 'rollback', status: 'rolled_back', reason: 'completed', ok: true });
  });
});

// ── fail-closed states (points 10-12) ────────────────────────────────────────────────────────
describe('recoverRestoreIfNeeded — fail-closed on untrustworthy state', () => {
  it('10. an unknown status value (valid JSON, invalid status) fails closed, never guesses', async () => {
    const configPath = mkConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      status: 'totally-invented-status', restoreId: null, previousDb: null, candidateDb: null,
      startedAt: null, updatedAt: null, verificationStatus: 'pending', switchStatus: 'pending',
      rollbackStatus: 'pending', error: null, renamedPreviousDb: null, previousIdentityId: null, candidateIdentityId: null,
    }));

    const spawnDatabaseSwitchCliFn = vi.fn();
    const result = await recoverRestoreIfNeeded({ readRestoreStateFn: realStateFn(configPath), spawnDatabaseSwitchCliFn });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('corrupt_state');
    expect(spawnDatabaseSwitchCliFn).not.toHaveBeenCalled();
    // never "fixed" — the file is completely untouched
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).status).toBe('totally-invented-status');
  });

  it('11. a genuinely corrupt (unparseable) restore-state.json fails closed, never repaired/reset/deleted', async () => {
    const configPath = mkConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, 'not json at all {{{', 'utf8');

    const spawnDatabaseSwitchCliFn = vi.fn();
    const result = await recoverRestoreIfNeeded({ readRestoreStateFn: realStateFn(configPath), spawnDatabaseSwitchCliFn });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('corrupt_state');
    expect(spawnDatabaseSwitchCliFn).not.toHaveBeenCalled();
    expect(fs.readFileSync(configPath, 'utf8')).toBe('not json at all {{{'); // untouched
  });

  it('12. missing required state (switching, but no candidateDb/previousDb ever recorded) is delegated to — and safely rejected by — the CLI itself, never guessed by this module', async () => {
    const configPath = mkConfigPath();
    // a 'switching' state built WITHOUT ever going through 'preparing' (impossible via the real
    // transition graph — proves this module never reads/relies on previousDb/candidateDb
    // itself; only the spawned CLI would ever discover this is unusable, exactly as a real
    // corrupt-but-shape-valid file would surface).
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      status: 'switching', restoreId: null, previousDb: null, candidateDb: null,
      startedAt: null, updatedAt: null, verificationStatus: 'pending', switchStatus: 'pending',
      rollbackStatus: 'pending', error: null, renamedPreviousDb: null, previousIdentityId: null, candidateIdentityId: null,
    }));

    // simulates exactly what the REAL CLI would report if performDatabaseSwitch() received
    // null productionDbName/candidateDb — a safe, redacted failure, never a crash/guess.
    const spawnDatabaseSwitchCliFn = vi.fn(async () => ({
      ok: false, code: 1, stdout: '', stderr: '❌ [unsafe_database_name] اسم قاعدة البيانات مفقود أو ليس نصاً.',
    }));

    const result = await recoverRestoreIfNeeded({ readRestoreStateFn: realStateFn(configPath), spawnDatabaseSwitchCliFn });

    expect(spawnDatabaseSwitchCliFn).toHaveBeenCalledWith('switch'); // still delegates — never pre-emptively guesses
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unsafe_database_name');
    expect(result.recovered).toBe(false);
  });
});

// ── process semantics (points 13-16) ─────────────────────────────────────────────────────────
describe('recoverRestoreIfNeeded — child-process outcome mapping', () => {
  function switchingStateFn() {
    const configPath = mkConfigPath();
    transitionRestoreState('preparing', { restoreId: 'r1', previousDb: 'studix', candidateDb: 'studix_restore_candidate_x' }, { configPath });
    transitionRestoreState('restoring', {}, { configPath });
    transitionRestoreState('verified', {}, { configPath });
    transitionRestoreState('switching', { switchStatus: 'pending' }, { configPath });
    return realStateFn(configPath);
  }

  it('13. child process exit 0 (well-formed success JSON) -> recovered:true', async () => {
    const spawnDatabaseSwitchCliFn = vi.fn(async () => ({ ok: true, code: 0, stdout: JSON.stringify({ ok: true, action: 'switch', status: 'active' }), stderr: '' }));
    const result = await recoverRestoreIfNeeded({ readRestoreStateFn: switchingStateFn(), spawnDatabaseSwitchCliFn });
    expect(result.recovered).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('14. child process non-zero exit -> recovered:false, safe redacted error', async () => {
    const spawnDatabaseSwitchCliFn = vi.fn(async () => ({ ok: false, code: 1, stdout: '', stderr: '❌ [app_start_failed] فشل بدء التطبيق.' }));
    const result = await recoverRestoreIfNeeded({ readRestoreStateFn: switchingStateFn(), spawnDatabaseSwitchCliFn });
    expect(result.recovered).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('app_start_failed');
  });

  it('15. spawn error -> recovered:false, never the raw spawn error text', async () => {
    const spawnDatabaseSwitchCliFn = vi.fn(async () => ({ ok: false, spawnError: new Error('ENOENT: node.exe not found at some/path') }));
    const result = await recoverRestoreIfNeeded({ readRestoreStateFn: switchingStateFn(), spawnDatabaseSwitchCliFn });
    expect(result.recovered).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain('ENOENT');
  });

  it('16. timeout -> recovered:false', async () => {
    const spawnDatabaseSwitchCliFn = vi.fn(async () => ({ ok: false, timedOut: true, stdout: '', stderr: '' }));
    const result = await recoverRestoreIfNeeded({ readRestoreStateFn: switchingStateFn(), spawnDatabaseSwitchCliFn });
    expect(result.recovered).toBe(false);
    expect(result.reason).toBe('timeout');
  });

  it('success is never claimed merely because the child started — exit 0 with malformed stdout is a failure', async () => {
    const spawnDatabaseSwitchCliFn = vi.fn(async () => ({ ok: true, code: 0, stdout: 'not json at all', stderr: '' }));
    const result = await recoverRestoreIfNeeded({ readRestoreStateFn: switchingStateFn(), spawnDatabaseSwitchCliFn });
    expect(result.recovered).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unparseable_result');
  });
});

// ── CLI invocation security (points 17-20) ───────────────────────────────────────────────────
function fakeChild({ code = 0, stdout = '', stderr = '' } = {}) {
  const listeners = {};
  const child = {
    stdout: { on: (evt, cb) => { if (evt === 'data' && stdout) cb(Buffer.from(stdout)); } },
    stderr: { on: (evt, cb) => { if (evt === 'data' && stderr) cb(Buffer.from(stderr)); } },
    on: (evt, cb) => { listeners[evt] = cb; },
    kill: vi.fn(),
  };
  queueMicrotask(() => listeners.exit?.(code));
  return child;
}

describe('spawnDatabaseSwitchCli — exact, safe invocation (points 17-20)', () => {
  it('17/18. passes only [scriptPath, "--action", action] — no shell, no extra arguments, injection is structurally impossible', async () => {
    const spawnFn = vi.fn(() => fakeChild({ code: 0, stdout: '{}' }));
    await spawnDatabaseSwitchCli('switch', { spawnFn, nodeExecPath: 'C:\\fake\\node.exe', scriptPath: 'C:\\fake\\databaseSwitch.js' });

    expect(spawnFn).toHaveBeenCalledTimes(1);
    const [exe, args, options] = spawnFn.mock.calls[0];
    expect(exe).toBe('C:\\fake\\node.exe');
    expect(args).toEqual(['C:\\fake\\databaseSwitch.js', '--action', 'switch']);
    expect(options.shell).toBeUndefined();
  });

  it('19. DATABASE_URL cannot come from persisted state — only "switch"/"rollback" are ever possible action strings, regardless of what a (hand-crafted) restore-state.json contains', async () => {
    const configPath = mkConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    // an attacker-shaped file that tries to smuggle a connection string via previousDb/
    // candidateDb — recoverRestoreIfNeeded never reads those fields at all.
    fs.writeFileSync(configPath, JSON.stringify({
      status: 'switching', restoreId: 'r1',
      previousDb: 'postgresql://evil:pw@host/db', candidateDb: 'postgresql://evil2:pw@host/db2',
      startedAt: null, updatedAt: null, verificationStatus: 'pending', switchStatus: 'pending',
      rollbackStatus: 'pending', error: null, renamedPreviousDb: null, previousIdentityId: null, candidateIdentityId: null,
    }));

    const spawnDatabaseSwitchCliFn = vi.fn(async () => ({ ok: true, code: 0, stdout: JSON.stringify({ ok: true, action: 'switch', status: 'active' }), stderr: '' }));
    await recoverRestoreIfNeeded({ readRestoreStateFn: realStateFn(configPath), spawnDatabaseSwitchCliFn });

    expect(spawnDatabaseSwitchCliFn).toHaveBeenCalledWith('switch'); // the ONLY argument ever passed — never the connection strings
    expect(spawnDatabaseSwitchCliFn.mock.calls[0]).toHaveLength(1);
  });

  it('20. a backup-path-shaped value in persisted state can never reach the spawned process either — same proof, different field content', async () => {
    const configPath = mkConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      status: 'rolling_back', restoreId: 'r1',
      previousDb: 'C:\\ProgramData\\Studix\\backups\\evil.dump', candidateDb: 'studix_restore_candidate_x',
      startedAt: null, updatedAt: null, verificationStatus: 'pending', switchStatus: 'pending',
      rollbackStatus: 'pending', error: null, renamedPreviousDb: 'studix_previous_x', previousIdentityId: 'id1', candidateIdentityId: 'id2',
    }));

    const spawnDatabaseSwitchCliFn = vi.fn(async () => ({ ok: true, code: 0, stdout: JSON.stringify({ ok: true, action: 'rollback', status: 'rolled_back' }), stderr: '' }));
    await recoverRestoreIfNeeded({ readRestoreStateFn: realStateFn(configPath), spawnDatabaseSwitchCliFn });

    expect(spawnDatabaseSwitchCliFn).toHaveBeenCalledWith('rollback');
    expect(spawnDatabaseSwitchCliFn.mock.calls[0]).toHaveLength(1);
  });
});

// ── restoreLock remains solely authoritative (point 23) ──────────────────────────────────────
describe('recoverRestoreIfNeeded — restoreLock.js remains solely authoritative, never bypassed', () => {
  it('a lock_held failure from the CLI is reported as a safe failure — no retry, no second lock attempt, no bypass', async () => {
    const configPath = mkConfigPath();
    transitionRestoreState('preparing', { restoreId: 'r1', previousDb: 'studix', candidateDb: 'studix_restore_candidate_x' }, { configPath });
    transitionRestoreState('restoring', {}, { configPath });
    transitionRestoreState('verified', {}, { configPath });
    transitionRestoreState('switching', { switchStatus: 'pending' }, { configPath });

    const spawnDatabaseSwitchCliFn = vi.fn(async () => ({
      ok: false, code: 1, stdout: '', stderr: '❌ [lock_held] عملية استعادة أخرى تملك القفل بالفعل.',
    }));

    const result = await recoverRestoreIfNeeded({ readRestoreStateFn: realStateFn(configPath), spawnDatabaseSwitchCliFn });

    expect(spawnDatabaseSwitchCliFn).toHaveBeenCalledTimes(1); // exactly once — no retry loop
    expect(result.recovered).toBe(false);
    expect(result.reason).toBe('lock_held');
  });
});

// ── redaction ─────────────────────────────────────────────────────────────────────────────────
describe('recoverRestoreIfNeeded — redaction (never exposes credentials)', () => {
  it('a CLI failure containing a connection string is fully redacted before it reaches the result object', async () => {
    const configPath = mkConfigPath();
    transitionRestoreState('preparing', { restoreId: 'r1', previousDb: 'studix', candidateDb: 'studix_restore_candidate_x' }, { configPath });
    transitionRestoreState('restoring', {}, { configPath });
    transitionRestoreState('verified', {}, { configPath });
    transitionRestoreState('switching', { switchStatus: 'pending' }, { configPath });

    const spawnDatabaseSwitchCliFn = vi.fn(async () => ({
      ok: false, code: 1, stdout: '',
      stderr: '❌ [installation_id_read_failed] تعذّرت قراءة هوية التثبيت: postgresql://studix_admin:supersecret@127.0.0.1:55432/studix',
    }));

    const result = await recoverRestoreIfNeeded({ readRestoreStateFn: realStateFn(configPath), spawnDatabaseSwitchCliFn });

    expect(result.error).not.toContain('supersecret');
    expect(result.error).toContain('postgresql://[REDACTED]');
  });
});
