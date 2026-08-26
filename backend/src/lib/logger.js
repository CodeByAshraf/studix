// backend/src/lib/logger.js
// ─────────────────────────────────────────────────────────────
// Phase 6b — minimal, dependency-free file logger. console.log/console.error alone are not a
// useful operational log once this runs unattended as a Windows Service (Phase 6a §9 —
// no visible console to read). Every existing console.log/console.error call this phase
// touches is preserved verbatim in wording; this only adds a persistent, timestamped copy
// alongside it (see server.js/errorHandler.js for the specific call sites converted).
//
// Default location mirrors db/backup.js's existing STUDIX_BACKUP_DIR/%ProgramData% pattern
// exactly, for consistency with an already-accepted convention in this codebase:
//   %ProgramData%\Studix\logs\   (override: STUDIX_LOG_DIR)
//
// Deliberately NOT a rotation/retention system: one file per calendar day bounds any single
// file's growth without adding rotation complexity this single-process desktop app doesn't
// need yet. Pruning old log files is NOT implemented here — recorded explicitly as a future
// installer/runtime task (Phase 6e+) rather than solved prematurely.
//
// Every write is best-effort: a failure to create the log directory or append a line is
// reported to console once (not on every subsequent call — avoids spamming the console if the
// disk/permissions issue is persistent) and never thrown — a broken log path must never crash
// the application it's trying to observe.
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';

// Defensive, shallow scrub of a metadata object before it's ever serialized to the log file
// or console — call sites should already never pass secrets in (DATABASE_URL, SESSION_SECRET,
// private keys, license artifacts, tokens/responses); this is defense-in-depth, not the
// primary control.
const SENSITIVE_KEYS = new Set([
  'password', 'databaseurl', 'database_url', 'sessionsecret', 'session_secret',
  'secret', 'privatekey', 'private_key', 'artifact', 'license_artifact', 'token', 'response',
  'signature', 'connectionstring', 'connection_string',
]);

function redact(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const out = {};
  for (const [key, value] of Object.entries(meta)) {
    out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : value;
  }
  return out;
}

export function resolveLogDir() {
  return process.env.STUDIX_LOG_DIR || path.join(process.env.ProgramData || 'C:\\ProgramData', 'Studix', 'logs');
}

function logFilePath(now = new Date()) {
  const day = now.toISOString().slice(0, 10); // YYYY-MM-DD — one file per day, no rotation logic needed
  return path.join(resolveLogDir(), `studix-${day}.log`);
}

let warnedOnce = false;

function writeLine(level, message, meta) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...(meta !== undefined ? { meta: redact(meta) } : {}),
  });
  try {
    fs.mkdirSync(resolveLogDir(), { recursive: true });
    fs.appendFileSync(logFilePath(), `${line}\n`, 'utf8');
  } catch (err) {
    if (!warnedOnce) {
      warnedOnce = true;
      // eslint-disable-next-line no-console
      console.error(`[logger] تعذّرت الكتابة إلى ملف السجلّ (${resolveLogDir()}) — سيستمر السجلّ في الطرفية (console) فقط لبقية هذه الجلسة. السبب: ${err.message}`);
    }
  }
}

export function info(message, meta) {
  // eslint-disable-next-line no-console
  console.log(`[INFO] ${message}`);
  writeLine('info', message, meta);
}

export function warn(message, meta) {
  // eslint-disable-next-line no-console
  console.warn(`[WARN] ${message}`);
  writeLine('warn', message, meta);
}

export function error(message, meta) {
  // eslint-disable-next-line no-console
  console.error(`[ERROR] ${message}`);
  writeLine('error', message, meta);
}

// __resetForTests: same pattern as supportAccessCache.js's clearAll() — test-only reset of
// the "already warned" latch so multiple tests can each observe a fresh write-failure warning.
export function __resetForTests() {
  warnedOnce = false;
}

export default { info, warn, error, resolveLogDir, __resetForTests };
