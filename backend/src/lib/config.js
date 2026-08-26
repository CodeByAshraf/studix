// backend/src/lib/config.js
// ─────────────────────────────────────────────────────────────
// Phase 6b — Production Runtime Hardening: environment/config loading, with a clear,
// deterministic precedence between an installed/production config file and the existing
// developer .env file (Phase 6a §4/§12/§13 — backend/.env living inside the application
// folder is an upgrade risk; the intended production location is outside it entirely).
//
// MUST be the very first thing imported anywhere in server.js — see the comment at the top
// of server.js's import list for why. Short version: ES module imports evaluate a module's
// entire body before the importing module's own subsequent statements run. server.js used to
// call dotenv.config() AFTER importing middleware/auth.js (which transitively imports
// lib/session.js and lib/supportSession.js, both of which read `process.env.SESSION_SECRET`
// at their own top level) — so SESSION_SECRET was captured as undefined in both modules
// regardless of what backend/.env actually contained, every single time the app started from
// a plain `.env` file with no matching OS-level environment variable already set. Verified
// empirically before this fix (see the Phase 6b report) and never caught by the test suite
// because no test imports server.js itself — every test dynamically imports the module under
// test after setting process.env directly. Making this module's env-loading side effect run
// first, before any other import, fixes it for both session.js and supportSession.js at once,
// without changing anything about how either module signs/verifies a session.
//
// Precedence (first match wins — never both, never merged):
//   1. Production/installed config: STUDIX_CONFIG_PATH if set, else
//      %ProgramData%\Studix\config\.env — the intended location once an installer exists
//      (Phase 6e+), kept outside the application folder so an upgrade that replaces
//      application files never touches it. Not created by this module — an installer or an
//      operator creates it; this module only ever reads it if present.
//   2. Development fallback: bare dotenv.config() — loads backend/.env relative to the
//      current working directory, exactly as server.js did before this change. The existing
//      developer workflow (`cp .env.example .env`) keeps working with zero changes required.
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

export function resolveProductionConfigPath() {
  if (process.env.STUDIX_CONFIG_PATH) return process.env.STUDIX_CONFIG_PATH;
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  return path.join(programData, 'Studix', 'config', '.env');
}

// loadEnvConfig: injectable fs/dotenv purely so tests can point STUDIX_CONFIG_PATH/ProgramData
// at a temp file without ever touching the real C:\ProgramData or backend/.env. Never throws —
// a missing production file is the expected, common case (every developer machine, and every
// fresh install before Phase 6e's installer exists) and simply falls through to the
// development fallback. Returns which path was actually used, for startup logging only —
// never logs file contents.
export function loadEnvConfig({ existsSync = fs.existsSync, dotenvConfig = dotenv.config } = {}) {
  const productionPath = resolveProductionConfigPath();
  if (existsSync(productionPath)) {
    dotenvConfig({ path: productionPath });
    return { mode: 'production', path: productionPath };
  }
  dotenvConfig();
  return { mode: 'development', path: null };
}

// Side effect: runs the moment this module is first imported — see the file-level comment
// above for why import ORDER (this must be first in server.js) matters, not just that it
// eventually runs somewhere.
export const configSource = loadEnvConfig();
