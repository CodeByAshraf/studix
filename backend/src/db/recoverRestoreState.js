// backend/src/db/recoverRestoreState.js
// ─────────────────────────────────────────────────────────────
// Phase 2C-3C Part 5B-2 — the recovery ENTRY POINT ONLY. A future Windows-startup mechanism
// (a Scheduled Task — deliberately NOT implemented here; see Part 5A's own audit) will invoke
// this module. Its entire job: read the persisted restore state (readRestoreState() —
// restoreState.js, unmodified, reused exactly as every other caller already does) and, if (and
// ONLY if) it is genuinely 'switching' or 'rolling_back', spawn the EXISTING databaseSwitch.js
// CLI with the one corresponding, hard-coded action. Every other status — including a
// candidate-holding 'verified' state, which must NEVER be treated as "a switch waiting to
// happen" — returns a deterministic "no recovery required" result without ever spawning
// anything. This file never imports, calls, or duplicates performDatabaseSwitch()/
// performRollback() themselves; the CLI remains the single execution/locking authority, exactly
// as routes/dbSwitch.js (Part 2) already established for the HTTP trigger.
//
// Deliberately NOT importing routes/dbSwitch.js's own near-identical spawn helper (or anything
// else from it): that file transitively pulls in Express/Prisma/activity-log dependencies a
// standalone, system-startup-time script must never require just to spawn one child process.
// The spawn logic below is therefore a small, deliberate re-implementation of the same,
// already-proven argv-array/no-shell/process.execPath pattern — not a new design.
//
// No lock of its own: this module never imports acquireRestoreLock/releaseRestoreLock. The
// spawned CLI already atomically owns restoreLock.js's lock in its own process; a second
// acquisition attempt here would be redundant at best and a deadlock-equivalent failure at
// worst (see restoreLock.js's own header for why a non-reentrant lock must never be held by a
// parent while its child tries to acquire it too). If another restore process already holds the
// lock, the spawned CLI's own acquireRestoreLock() call fails with 'lock_held', and this module
// simply reports that failure — never bypasses, never retries silently, never duplicates it.
// ─────────────────────────────────────────────────────────────
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawn } from 'child_process';
import { readRestoreState, RestoreStateError } from './restoreState.js';
import { redactErrorMessage } from './restoreDatabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The known, fixed location of the existing CLI — same directory as this file, never derived
// from any external input (persisted state, argv, environment).
const CLI_SCRIPT_PATH = path.join(__dirname, 'databaseSwitch.js');

// Generous safety-net ceiling, matching switchAdapters.js's/routes/dbSwitch.js's own default —
// not a normal-case expectation, purely so a hung child can never leave this process (and
// whatever invoked it) blocked forever.
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export class RecoveryError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

// STATUS_TO_ACTION — the ONE hard-coded mapping this entire module is built around. Exactly the
// two entries the task requires, nothing else. Every other restore-state status — including
// 'verified' (a candidate existing is never, by itself, a reason to start a destructive switch
// automatically) — is absent from this table on purpose, which is what makes "no recovery
// required" the correct, automatic outcome for them (see recoverRestoreIfNeeded below).
const STATUS_TO_ACTION = Object.freeze({
  switching: 'switch',
  rolling_back: 'rollback',
});

/**
 * spawnDatabaseSwitchCli: spawns the EXISTING databaseSwitch.js CLI as a fully separate
 * process — argv-array spawn (never shell:true, never string concatenation), `nodeExecPath`
 * defaulting to `process.execPath` (this process's own running interpreter, never anything
 * derived from persisted state or external input), `scriptPath` to the fixed location above.
 * Resolves (never rejects) with a structured outcome, mirroring routes/dbSwitch.js's own
 * spawnDbSwitchCli exactly (see this file's own header for why that one isn't imported here).
 */
export function spawnDatabaseSwitchCli(action, {
  spawnFn = spawn,
  nodeExecPath = process.execPath,
  scriptPath = CLI_SCRIPT_PATH,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  return new Promise((resolve) => {
    const child = spawnFn(nodeExecPath, [scriptPath, '--action', action], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ ok: false, timedOut: true, code: null, stdout, stderr });
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, spawnError: err, code: null, stdout, stderr });
    });

    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

// parseCliFailure: reads the CLI's own documented, already-redacted stderr contract
// (databaseSwitch.js's main(): `❌ [reason] message`) — never re-parses/duplicates the CLI's
// own logic, only its output shape. redactErrorMessage is applied again anyway (idempotent,
// safe on already-safe text) as defense in depth, matching routes/dbSwitch.js's own identical
// choice for the identical reason.
function parseCliFailure(stderr) {
  const match = String(stderr || '').match(/❌ \[([a-z0-9_]+)\] ([\s\S]*)/i);
  if (!match) {
    return { reason: 'unknown', message: 'فشلت عملية الاسترداد لسبب غير معروف.' };
  }
  return { reason: match[1], message: redactErrorMessage(new Error(match[2].trim())) };
}

/**
 * recoverRestoreIfNeeded: the ONE entry point. Never accepts a database URL, backup path,
 * credential, executable path, or CLI argument from anywhere — the only two strings this
 * function can ever pass as `--action` are the two literal constants in STATUS_TO_ACTION above,
 * selected purely by the persisted state's own `status` field (never its `previousDb`/
 * `candidateDb`/etc. — those are recovered by the SPAWNED CLI itself, from the SAME file,
 * exactly like a manually-invoked "fresh recovery process" already does — see
 * databaseSwitch.js's own performDatabaseSwitch()/performRollback() header comments).
 *
 * Returns a plain, discriminated result object — never throws for an expected outcome (no
 * recovery needed, corrupt state, CLI failure, timeout, spawn error) — only a genuinely
 * unexpected error (not RestoreStateError) propagates as a real exception, exactly matching
 * readRestoreState()'s own "missing is safe, corrupt is a loud, typed error" contract.
 */
export async function recoverRestoreIfNeeded({
  readRestoreStateFn = readRestoreState,
  spawnDatabaseSwitchCliFn = spawnDatabaseSwitchCli,
} = {}) {
  let state;
  try {
    state = readRestoreStateFn();
  } catch (err) {
    if (err instanceof RestoreStateError) {
      // Corrupt/invalid-shape/unknown-status state — NEVER repaired, reset, or deleted here.
      // Fail closed: no recovery is ever attempted against state that cannot be trusted.
      return {
        recovered: false, action: null, status: null, reason: 'corrupt_state', ok: false,
        error: redactErrorMessage(err),
      };
    }
    throw err;
  }

  const action = STATUS_TO_ACTION[state.status];
  if (!action) {
    // Every other status — idle, preparing, restoring, verified, active, rolled_back, failed —
    // lands here. Deliberately uniform: none of them ever trigger a spawn.
    return { recovered: false, action: null, status: state.status, reason: 'no_recovery_needed', ok: true };
  }

  const result = await spawnDatabaseSwitchCliFn(action);

  if (result.spawnError) {
    return { recovered: false, action, status: state.status, reason: 'spawn_failed', ok: false, error: 'تعذّر بدء عملية الاسترداد.' };
  }
  if (result.timedOut) {
    return { recovered: false, action, status: state.status, reason: 'timeout', ok: false, error: 'تجاوزت عملية الاسترداد المهلة المتاحة.' };
  }
  if (!result.ok) {
    const { reason, message } = parseCliFailure(result.stderr);
    return { recovered: false, action, status: state.status, reason, ok: false, error: message };
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { recovered: false, action, status: state.status, reason: 'unparseable_result', ok: false, error: 'اكتمل الاسترداد لكن تعذّر تفسير نتيجته.' };
  }

  // Success means the existing CLI itself reported success (exit 0 AND a well-formed
  // {ok:true,...} result) — never merely "the child process started."
  return { recovered: true, action, status: parsed.status ?? null, reason: 'completed', ok: true };
}

async function main() {
  try {
    const result = await recoverRestoreIfNeeded();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (err) {
    console.error(`❌ [${err.reason || 'unknown'}] ${redactErrorMessage(err)}`);
    process.exitCode = 1;
  }
}

// Only auto-runs when executed directly (`node recoverRestoreState.js`), never when imported by
// a test file or any other module — same guard convention as databaseSwitch.js/
// restoreDatabase.js's own CLI entry points.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
