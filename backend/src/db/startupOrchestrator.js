// backend/src/db/startupOrchestrator.js
// ─────────────────────────────────────────────────────────────
// Phase 2C-3C Part 5B-3 — WINDOWS STARTUP RECOVERY ORCHESTRATION (logic only; nothing here
// registers a real Windows Scheduled Task, changes a real service's start type, or is wired
// into the real installer — see this phase's own final report for what remains OUT of scope).
//
// This module is the future entry point a Windows Scheduled Task ("At startup", SYSTEM
// account — see the final report's §9 for the exact, NOT-YET-REGISTERED task design) would
// invoke. Its ONE job: enforce, by ordinary sequential await — not by any Windows service
// dependency/start-type mechanism — that:
//
//   1. PostgreSQL is GENUINELY ready to accept connections (not merely "sc query reports
//      RUNNING" — see waitForPostgresReady's own header for why that signal alone was
//      rejected as insufficient), before
//   2. any pending switch/rollback recovery (recoverRestoreState.js, Part 5B-2, reused here
//      completely UNMODIFIED — this file never duplicates its restore-status-to-action
//      mapping or spawns databaseSwitch.js itself) is attempted and completes, before
//   3. StudixApp is started at all.
//
// Because step 2 is `await`-ed before step 3 ever runs, and step 1 is `await`-ed before step 2
// ever runs, this ordering is guaranteed by plain synchronous-in-effect JavaScript control
// flow — it does NOT rely on Windows SCM's own `DependOnService` semantics (which only
// guarantee a dependency's *service process* reported RUNNING before SCM attempts to start the
// dependent, never that the dependency's own *work* is complete — the exact ambiguity this
// whole phase exists to close; see the final report's audit §2D for the reasoning that ruled
// out an NSSM-wrapped "recovery service" for this same reason) and does NOT rely on a fixed
// sleep/timeout as a correctness mechanism (see waitForPostgresReady: bounded polling with a
// real per-attempt connection probe, not a guessed delay).
// ─────────────────────────────────────────────────────────────
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawn } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { readAdminCredential, redactErrorMessage } from './restoreDatabase.js';
import { startService, STUDIX_APP_SERVICE_NAME, WindowsServiceError } from '../lib/windowsService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The known, fixed location of the existing recovery entry point (Part 5B-2) — never derived
// from any external input (persisted state, argv, environment).
const RECOVERY_SCRIPT_PATH = path.join(__dirname, 'recoverRestoreState.js');

// Postgres, after an unclean shutdown, may need real time for WAL replay before it accepts
// connections — 60s is a generous, but bounded, ceiling; a genuinely stuck instance must never
// hang this orchestrator (and therefore StudixApp's own startup) forever.
const DEFAULT_POSTGRES_READY_TIMEOUT_MS = 60_000;
const DEFAULT_POSTGRES_POLL_INTERVAL_MS = 1_000;

// Slightly above recoverRestoreState.js's own internal DEFAULT_TIMEOUT_MS (5 minutes, which is
// itself already above databaseSwitch.js's own internal step timeouts) — this outer ceiling
// exists purely as a last-resort safety net for a hung/never-exiting child process, mirroring
// the same "generous, non-normal-case ceiling" convention already used at every other layer of
// this call chain (switchAdapters.js, routes/dbSwitch.js, recoverRestoreState.js itself).
const DEFAULT_RECOVERY_TIMEOUT_MS = 5 * 60 * 1000 + 30_000;

export class StartupOrchestratorError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

// ── step 1: PostgreSQL readiness ─────────────────────────────────────────────────────────────
// Deliberately NOT trusting `sc query StudixPostgreSQL === RUNNING` as proof of readiness: this
// repository cannot verify from application code whether pg_ctl's own Windows-service
// integration (internal to the bundled PostgreSQL binary, not inspectable here) blocks
// SERVICE_RUNNING until the postmaster has finished crash recovery/WAL replay and is actually
// accepting connections, or merely until the postmaster process has launched. Rather than rely
// on an unverifiable assumption either way, this function uses the SAME unambiguous signal the
// rest of this codebase already trusts for exactly this question — a real, minimal,
// admin-credentialed connection attempt (readAdminCredential/PrismaClient, the identical
// mechanism restoreDatabase.js/databaseSwitch.js already use for their own pre-app-startup
// PostgreSQL access) — polled with a bounded timeout, never a fixed sleep.
export async function waitForPostgresReady({
  readAdminCredentialFn = readAdminCredential,
  adminConfigPath,
  connectFn = defaultConnectFn,
  timeoutMs = DEFAULT_POSTGRES_READY_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POSTGRES_POLL_INTERVAL_MS,
  sleepFn = defaultSleep,
  nowFn = Date.now,
} = {}) {
  const deadline = nowFn() + timeoutMs;
  let lastError = null;
  for (;;) {
    try {
      const adminUrl = readAdminCredentialFn({ configPath: adminConfigPath });
      await connectFn(adminUrl);
      return { ready: true, timedOut: false, error: null };
    } catch (err) {
      lastError = err;
    }
    if (nowFn() >= deadline) {
      return { ready: false, timedOut: true, error: lastError ? redactErrorMessage(lastError) : null };
    }
    await sleepFn(pollIntervalMs);
  }
}

async function defaultConnectFn(adminUrl) {
  const client = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    await client.$queryRaw`SELECT 1`;
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── step 2: recovery, delegated entirely to Part 5B-2 ───────────────────────────────────────
// Spawns the EXISTING recoverRestoreState.js as a fully separate process — argv-array spawn
// (never shell:true, never string concatenation), `nodeExecPath` defaulting to
// `process.execPath`, `scriptPath` fixed to the constant above. No CLI arguments are ever
// passed (recoverRestoreState.js reads restore-state.json itself and needs none) — there is
// therefore nothing here for persisted state, argv, or the environment to inject into a spawned
// command line. Deliberately re-implements (rather than imports) the same small
// spawn/timeout/resolve shape recoverRestoreState.js/routes/dbSwitch.js already use, for the
// identical dependency-isolation reason documented in recoverRestoreState.js's own header: a
// system-startup-time script must not transitively require anything beyond what this one step
// needs.
export function spawnRecoveryCheck({
  spawnFn = spawn,
  nodeExecPath = process.execPath,
  scriptPath = RECOVERY_SCRIPT_PATH,
  timeoutMs = DEFAULT_RECOVERY_TIMEOUT_MS,
} = {}) {
  return new Promise((resolve) => {
    const child = spawnFn(nodeExecPath, [scriptPath], {
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

function parseRecoveryOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

// ── step 3: start StudixApp, but only once steps 1-2 have already, genuinely, completed ────
// Reuses windowsService.js's existing startService()/STUDIX_APP_SERVICE_NAME UNMODIFIED —
// already idempotent (an already-RUNNING service is a safe no-op: 'already_running'), so a
// repeated orchestrateStartup() call (e.g. a retried/duplicated Scheduled Task run) never
// double-starts or errors on an already-started app.
function defaultStartApp() {
  return startService(STUDIX_APP_SERVICE_NAME);
}

/**
 * orchestrateStartup: the ONE entry point. Sequentially: wait for PostgreSQL readiness -> run
 * the existing recovery check -> start StudixApp only if both prior steps report success.
 * Fails closed at every step — any timeout, spawn failure, unparseable output, or a recovery
 * outcome that itself reports failure (`ok:false`, including a genuinely-attempted-but-failed
 * switch/rollback, a still-held lock, or corrupt restore-state) results in StudixApp NOT being
 * started, never a best-effort "start anyway".
 *
 * Never accepts a database URL, backup path, credential, executable path, or CLI argument from
 * any caller-supplied string — the only paths ever spawned are the two fixed constants above.
 */
export async function orchestrateStartup({
  waitForPostgresReadyFn = waitForPostgresReady,
  spawnRecoveryCheckFn = spawnRecoveryCheck,
  startAppFn = defaultStartApp,
} = {}) {
  const readiness = await waitForPostgresReadyFn();
  if (!readiness.ready) {
    return {
      shouldStartApp: false, appStarted: false, postgresReady: false, recovery: null,
      reason: 'postgres_not_ready', error: readiness.error,
    };
  }

  const spawnResult = await spawnRecoveryCheckFn();

  if (spawnResult.spawnError) {
    return {
      shouldStartApp: false, appStarted: false, postgresReady: true, recovery: null,
      reason: 'recovery_spawn_failed', error: 'تعذّر بدء عملية التحقّق من الاسترداد عند الإقلاع.',
    };
  }
  if (spawnResult.timedOut) {
    return {
      shouldStartApp: false, appStarted: false, postgresReady: true, recovery: null,
      reason: 'recovery_timeout', error: 'تجاوزت عملية التحقّق من الاسترداد المهلة المتاحة عند الإقلاع.',
    };
  }

  const recovery = parseRecoveryOutput(spawnResult.stdout);
  if (!recovery) {
    return {
      shouldStartApp: false, appStarted: false, postgresReady: true, recovery: null,
      reason: 'recovery_output_unparseable', error: 'اكتملت عملية التحقّق من الاسترداد لكن تعذّر تفسير نتيجتها.',
    };
  }

  // Never trust the child process's exit code alone — re-derive the decision from the
  // structured result it printed, exactly as recoverRestoreIfNeeded's own caller already does
  // in routes/dbSwitch.js's/recoverRestoreState.js's `main()` convention.
  if (recovery.ok !== true) {
    return {
      shouldStartApp: false, appStarted: false, postgresReady: true, recovery,
      reason: 'recovery_failed', error: recovery.error ?? 'فشلت عملية التحقّق من الاسترداد عند الإقلاع.',
    };
  }

  let appStarted = true;
  let startError = null;
  try {
    await startAppFn();
  } catch (err) {
    appStarted = false;
    startError = err instanceof WindowsServiceError ? redactErrorMessage(err) : redactErrorMessage(err);
  }

  return {
    shouldStartApp: true, appStarted, postgresReady: true, recovery,
    reason: appStarted ? 'started' : 'app_start_failed', error: startError,
  };
}

async function main() {
  try {
    const result = await orchestrateStartup();
    console.log(JSON.stringify(result, null, 2));
    if (!result.shouldStartApp || !result.appStarted) process.exitCode = 1;
  } catch (err) {
    console.error(`❌ [${err.reason || 'unknown'}] ${redactErrorMessage(err)}`);
    process.exitCode = 1;
  }
}

// Only auto-runs when executed directly (`node startupOrchestrator.js` — the future Scheduled
// Task's own action command), never when imported by a test file or any other module — same
// guard convention as databaseSwitch.js/restoreDatabase.js/recoverRestoreState.js.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
