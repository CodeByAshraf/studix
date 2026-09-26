// backend/src/routes/dbSwitch.js
// ─────────────────────────────────────────────────────────────
// Phase 2C-3C Part 2 — the authenticated HTTP trigger for the already-proven Phase 2C-3B/
// 2C-3C-Part-1 database switch/rollback core. Mounted in server.js behind
// requireAuth + requireRole('admin') — same guard, same sensitivity class, as
// /api/license and /api/support-access (the two other capabilities with this exact contract).
//
// CRITICAL architectural boundary (per the Phase 2C-3C audit): this file NEVER imports
// databaseSwitch.js, performDatabaseSwitch, performRollback, PrismaClient, or any PostgreSQL
// connection logic. The existing databaseSwitch.js CLI entry point (Phase 2C-3C Part 1) is the
// ONLY execution authority — this route's entire job is to validate the request, spawn that CLI
// as a separate process with exactly one safe argument, wait for it, and translate its
// already-redacted stdout/stderr contract into an HTTP response. The mandatory architectural
// test in dbSwitch.test.js proves this boundary by static source inspection.
//
// Locking (Part 1's F5 finding): the CLI's own runSwitchCli() already acquires restoreLock.js's
// process-boundary lock, using ITS OWN pid — restoreLock.js is NOT reentrant, so this route
// must NEVER also call acquireRestoreLock()/releaseRestoreLock() itself (that would either
// deadlock-equivalent-fail every request, since the parent's own hold would make the child's
// own acquisition attempt always see EEXIST+alive-pid, or require handing the lock across a
// process boundary, which the existing primitive was never designed for). Instead: this route
// only ever PEEKS at whether the lock file currently exists (resolveRestoreLockPath(), already
// exported by restoreLock.js, reused unmodified) as a best-effort, NON-AUTHORITATIVE fast path
// that avoids spawning a child doomed to fail in the common case. The real, atomic, correctness
// guarantee remains entirely the CLI's own acquireRestoreLock() call, inside its own process —
// if the peek is stale (a race), the spawned child still correctly fails with `lock_held`, and
// this route reports that failure as 409 exactly the same way. CLI ownership of the lock is
// completely unchanged from Part 1.
// ─────────────────────────────────────────────────────────────
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { resolveActivityLogActor } from './activityLogs.js';
import { resolveRestoreLockPath } from '../db/restoreLock.js';
import { redactErrorMessage } from '../db/restoreDatabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The known, fixed runtime location of the CLI script — NEVER derived from the HTTP request.
// backend/src/routes/ -> backend/src/db/databaseSwitch.js, identical relative layout in both a
// dev checkout and the packaged release (backend/src/** is copied wholesale — verified against
// scripts/build-windows-runtime.ps1 during the Phase 2C-3C audit).
const CLI_SCRIPT_PATH = path.join(__dirname, '..', 'db', 'databaseSwitch.js');

const ALLOWED_ACTIONS = new Set(['switch', 'rollback']);
// Generous safety-net ceiling, not a normal-case expectation — a real switch/rollback (stop,
// rename(s), start, deep health verification) is expected to finish well under this. Exists
// purely so a genuinely hung child can never leave an HTTP request pending forever.
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

function conflict(message) {
  const err = new Error(message);
  err.status = 409;
  err.expose = true;
  return err;
}

function executionFailed(message, status = 500) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

// Every trigger/outcome is logged to the existing activity_logs table (append-only,
// trg_no_delete_activity) — module='db-switch' distinguishes it from every other module, same
// mechanism license.js/supportAccess.js already use via resolveActivityLogActor(userId).
async function logDbSwitchEvent({ userId, action, event, details = null }) {
  const actor = await resolveActivityLogActor(userId);
  await prisma.activity_logs.create({
    data: {
      id: crypto.randomUUID(),
      action: `db_${action}_${event}`,
      module: 'db-switch',
      user_id: actor.userId,
      user_name: actor.userName,
      entity_type: 'restore',
      entity_id: null,
      details,
    },
  });
}

// parseCliFailure: reads the CLI's own documented, already-redacted stderr contract
// (databaseSwitch.js's main(): `❌ [reason] message`) — never re-parses/duplicates the CLI's
// own logic, only reads its output shape. redactErrorMessage is applied again here anyway
// (idempotent, safe on already-safe text) as a defense-in-depth pass, matching the same
// philosophy already established throughout the database-switch code this route never imports.
export function parseCliFailure(stderr) {
  const match = String(stderr || '').match(/❌ \[([a-z0-9_]+)\] ([\s\S]*)/i);
  if (!match) {
    return { reason: 'unknown', message: 'فشلت عملية قاعدة البيانات لسبب غير معروف.' };
  }
  return { reason: match[1], message: redactErrorMessage(new Error(match[2].trim())) };
}

// mapCliFailureToHttp: lock_held is the one reason that means "another restore operation is
// already in progress" (Conflict). Every other reason is either a pre-flight validation problem
// this route's own validation should already prevent, or a genuine execution failure — neither
// is the caller's fault to retry immediately, so both surface as a server error.
function mapCliFailureToHttp(reason) {
  return reason === 'lock_held' ? 409 : 500;
}

/**
 * spawnDbSwitchCli: spawns the EXISTING databaseSwitch.js CLI as a fully separate process —
 * argv-array spawn (never shell:true, never string concatenation), so the two-token
 * `--action <value>` pair can never be reinterpreted by a shell even in principle. `nodeExecPath`
 * defaults to `process.execPath` — the interpreter already running THIS server process, never
 * anything derived from the HTTP request — and `scriptPath` to the fixed CLI location above.
 * Resolves (never rejects) with a structured outcome so the caller always has a single place to
 * branch on success/failure/timeout/spawn-error.
 */
export function spawnDbSwitchCli(action, {
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

/**
 * triggerDatabaseSwitch: the route's testable core (same convention as license.js's
 * activateLicense/requestLicenseActivationCode — exported separately from the router, no HTTP
 * needed to exercise it). The ONLY user-controlled input this function ever reads is `action`;
 * nothing else from the request body is read anywhere in this file, so no other field (a
 * DATABASE_URL, a backup path, extra CLI-shaped arguments) can ever reach the spawned process.
 */
export async function triggerDatabaseSwitch(action, {
  userId = null,
  spawnDbSwitchCliFn = spawnDbSwitchCli,
  existsSyncFn = fs.existsSync,
  // Injected so pure unit tests never touch the real `prisma` singleton/real DATABASE_URL —
  // same convention this repo already uses to keep prisma-free unit tests (e.g.
  // treasuryTxn.test.js) separate from scratch-DB integration tests (e.g.
  // license.integration.test.js). The router below never overrides this — real requests always
  // get the real logDbSwitchEvent.
  logEventFn = logDbSwitchEvent,
} = {}) {
  if (!ALLOWED_ACTIONS.has(action)) {
    throw badRequest(`إجراء غير مدعوم — المسموح فقط: ${[...ALLOWED_ACTIONS].join('، ')}.`);
  }

  // Best-effort, NON-authoritative fast path only — see this file's own header for why the
  // route never acquires restoreLock.js's lock itself.
  if (existsSyncFn(resolveRestoreLockPath())) {
    throw conflict('عملية استعادة/تبديل أخرى قيد التنفيذ بالفعل — يُرجى الانتظار حتى تنتهي.');
  }

  await logEventFn({ userId, action, event: 'triggered' });

  const result = await spawnDbSwitchCliFn(action);

  if (result.spawnError) {
    await logEventFn({ userId, action, event: 'failed', details: 'spawn_error' });
    throw executionFailed('تعذّر بدء عملية قاعدة البيانات.', 500);
  }
  if (result.timedOut) {
    await logEventFn({ userId, action, event: 'failed', details: 'timeout' });
    throw executionFailed('تجاوزت عملية قاعدة البيانات المهلة المتاحة.', 504);
  }
  if (!result.ok) {
    const { reason, message } = parseCliFailure(result.stderr);
    await logEventFn({ userId, action, event: 'failed', details: reason });
    throw executionFailed(message, mapCliFailureToHttp(reason));
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    await logEventFn({ userId, action, event: 'failed', details: 'unparseable_result' });
    throw executionFailed('اكتملت العملية لكن تعذّر تفسير نتيجتها.', 500);
  }

  await logEventFn({ userId, action, event: 'succeeded', details: String(parsed.status ?? '') });
  // Whitelisted, minimal response — never the raw stdout blob, never internal bookkeeping
  // (archival name / identity ids) the HTTP client has no legitimate need for.
  return { ok: true, action, status: parsed.status };
}

const router = Router();

router.post('/', asyncHandler(async (req, res) => {
  const { action } = req.body || {};
  const result = await triggerDatabaseSwitch(action, { userId: req.user?.id ?? null });
  res.json(result);
}));

export default router;
