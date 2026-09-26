// backend/src/db/switchAdapters.js
// ─────────────────────────────────────────────────────────────
// Phase 2C-3C Part 1 — the real Windows-service/health boundary performDatabaseSwitch()/
// performRollback() (databaseSwitch.js) have always accepted as injectable
// stopAppFn/startAppFn/getAppStatusFn/fetchHealthFn (Phase 2C-3B never wired them to anything
// real — every existing test supplies fakes). This file is that missing real wiring, and
// nothing else: it reuses lib/windowsService.js's own primitives unmodified (never
// reimplements service control, never touches PostgreSQL's own service), and never itself
// decides WHEN to call performDatabaseSwitch/performRollback (databaseSwitch.js's own new CLI
// entry point does that).
//
// Only StudixApp is touched here — StudixPostgreSQL's service is never started/stopped by
// anything in this file (performDatabaseSwitch's own terminateConnectionsTo/renameDatabase
// already operate at the PostgreSQL connection/DDL level, unchanged, unrelated to the Windows
// service that hosts the PostgreSQL SERVER process itself).
//
// startService() (windowsService.js) only ever REQUESTS a start (`sc start`, returns as soon as
// the request is accepted) — unlike stopService(), which already polls for the genuine STOPPED
// state before returning. createRealStartAppFn below closes that asymmetry using
// waitUntilServiceState() (windowsService.js), so a caller relying on this adapter's "after"
// state actually reflects RUNNING, not merely "the start request was accepted."
// ─────────────────────────────────────────────────────────────
import {
  startService, stopService, queryServiceState, waitUntilServiceState, STUDIX_APP_SERVICE_NAME,
} from '../lib/windowsService.js';

export class SwitchAdapterError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

const DEFAULT_START_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_HEALTH_PORT = 4000;

/**
 * createRealGetAppStatusFn: ground-truth via `sc query`, never a cached/assumed value — the
 * same discipline databaseSwitch.js's own comments already require of every check in this file.
 */
export function createRealGetAppStatusFn({ serviceName = STUDIX_APP_SERVICE_NAME, io = {} } = {}) {
  return async () => ({ running: queryServiceState(serviceName, io) === 'RUNNING' });
}

/**
 * createRealStopAppFn: stopService() already polls for the genuine STOPPED state internally and
 * throws WindowsServiceError('stop_timeout', ...) if it never gets there — nothing duplicated
 * here, this is a thin adapter only.
 */
export function createRealStopAppFn({ serviceName = STUDIX_APP_SERVICE_NAME, io = {} } = {}) {
  return async () => {
    stopService(serviceName, io);
  };
}

/**
 * createRealStartAppFn: issues the real `sc start`, then waits for genuine RUNNING — closing
 * the asymmetry described in this file's own header. Throws SwitchAdapterError('start_timeout',
 * ...) rather than silently returning if the service never actually reaches RUNNING.
 */
export function createRealStartAppFn({
  serviceName = STUDIX_APP_SERVICE_NAME, io = {}, timeoutMs = DEFAULT_START_WAIT_TIMEOUT_MS,
} = {}) {
  return async () => {
    startService(serviceName, io);
    const running = waitUntilServiceState(serviceName, 'RUNNING', { ...io, timeoutMs });
    if (!running) {
      throw new SwitchAdapterError(
        'start_timeout',
        `لم تصل خدمة "${serviceName}" إلى حالة التشغيل الفعلي (RUNNING) خلال المهلة المتاحة بعد إرسال أمر البدء.`
      );
    }
  };
}

/**
 * createRealFetchHealthFn: a real HTTP GET against this same install's own /health — mirrors
 * firstInstall.js's own defaultWaitForHealth exactly (network failure -> {ok:false}, never a
 * thrown exception; runDeepHealthVerification (databaseSwitch.js) already treats a falsy `.ok`
 * as a real health failure, so there is nothing for this adapter to throw on its own).
 */
export function createRealFetchHealthFn({
  port = process.env.PORT || DEFAULT_HEALTH_PORT,
  healthUrl = `http://127.0.0.1:${port}/health`,
  fetchImpl = globalThis.fetch,
} = {}) {
  return async () => {
    try {
      const res = await fetchImpl(healthUrl);
      let body = null;
      try {
        body = await res.json();
      } catch {
        // non-JSON/empty body — the HTTP status code alone is still a meaningful signal.
      }
      return { ok: res.ok, status: res.status, body };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };
}
