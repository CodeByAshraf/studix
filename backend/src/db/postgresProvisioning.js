// backend/src/db/postgresProvisioning.js
// ─────────────────────────────────────────────────────────────
// INSTALL-03 — Bundled PostgreSQL + Auto-Configuration.
//
// Provisions and manages the PostgreSQL SERVER a future installer bundles alongside Studix —
// NOT the studix database's own content/schema, which remains entirely db/bootstrapDatabase.js
// and db/migrationRunner.js's job, unmodified and un-duplicated (see this file's own comments
// at each step for exactly where the boundary is). This module's job ends the moment it can
// hand bootstrapDatabase.js a working DATABASE_URL: PostgreSQL server -> reachable, listening
// on loopback only, with a Studix-specific superuser role. Everything past that point (does
// `studix` exist as a database, does it have the base schema, are migrations applied) is
// already solved and stays solved elsewhere.
//
// See migration/reports/INSTALL-03_POSTGRES_PROVISIONING_DESIGN.md for the full design
// rationale (version pin, directory layout, port strategy, credential strategy, security
// boundaries, and the exact contract INSTALL-05/06 must fulfill to consume this layer).
//
// State model (filesystem-only, computed before touching any process):
//   - pgDataDir missing or empty           -> "uninitialized"  -> safe to initdb into
//   - pgDataDir non-empty but no PG_VERSION,
//     postgresql.conf, unparseable port,
//     no pg_hba.conf, or missing/empty
//     "base" directory                     -> "inconsistent"  -> FAIL CLOSED, never touched
//   - all of the above present             -> "initialized"    -> reuse as-is, never re-initdb
//
// The "initialized" reuse path additionally gets one process-level check before an actual start
// attempt: verifyEffectiveConfig() below asks the bundled postgres.exe itself (via its own
// read-only `-C` config-query mode) what port/listen_addresses it will actually resolve from
// this data directory, and refuses (PostgresProvisioningError('config_mismatch', ...)) rather
// than starting if that disagrees with what Studix expects — closing the class of bug where a
// JS regex believed a directive was active but PostgreSQL's own parser did not. This never
// reselects a port and never rewrites postgresql.conf; the persisted port stays authoritative.
//
// Every fs/process/network dependency is injectable (an `io` object merged over real defaults)
// so every code path above is unit-testable without a real PostgreSQL installation. See
// postgresProvisioning.test.js. postgresProvisioning.integration.test.js additionally proves
// the real initdb/pg_ctl/pg_isready path against a fully disposable, temp-directory instance
// when real PostgreSQL binaries are available on the machine running the tests (never touches
// the developer's own PostgreSQL install/data).
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path';
import crypto from 'crypto';
import { execFileSync, execFile } from 'child_process';
import { fileURLToPath } from 'url';

export class PostgresProvisioningError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

// ── real-world defaults for every injectable dependency ──────────────────────────────────
const REAL_IO = {
  existsSync: fs.existsSync,
  readdirSync: fs.readdirSync,
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  mkdtempSync: fs.mkdtempSync,
  rmSync: fs.rmSync,
  execFileSync,
  execFile,
  randomBytes: crypto.randomBytes,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // backend/src/db

// Default bundled-PostgreSQL location: a `pgsql/` directory sibling to `node/`/`backend/` in
// the assembled Windows runtime package (release/win-x64/studix/pgsql/bin/...) — the exact
// same __dirname-relative-sibling convention server.js already uses for DIST_DIR. INSTALL-03
// does not create or download this directory (that's INSTALL-06's job — see the design doc's
// "runtime contract" section); locatePgBinaries() below fails clearly, not silently, when it's
// absent, which is the correct and expected state until INSTALL-06 exists.
const DEFAULT_PG_HOME = path.join(__dirname, '..', '..', '..', 'pgsql');

const PG_USER = 'studix_admin';
const PG_PASSWORD_BYTES = 32; // 256 bits — same standard as lib/productionConfig.js's SESSION_SECRET
const DEFAULT_PORT = 55432; // deliberately NOT 5432 — see design doc §"Port strategy" for why
const PORT_SCAN_RANGE = 20;
const REQUIRED_BINARIES = ['postgres.exe', 'initdb.exe', 'pg_ctl.exe', 'pg_isready.exe'];

// ── path resolution — mirrors lib/config.js/lib/logger.js/db/backup.js's existing
// STUDIX_*_DIR-override-else-%ProgramData% precedent exactly, for consistency. ──────────────
export function resolvePgHome() {
  return process.env.STUDIX_PG_HOME || DEFAULT_PG_HOME;
}

export function resolvePgDataDir() {
  if (process.env.STUDIX_PGDATA_DIR) return process.env.STUDIX_PGDATA_DIR;
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  return path.join(programData, 'Studix', 'pgdata');
}

// ── binary location ────────────────────────────────────────────────────────────────────────
export function locatePgBinaries(pgHome = resolvePgHome(), io = {}) {
  const { existsSync } = { ...REAL_IO, ...io };
  const binDir = path.join(pgHome, 'bin');
  const missing = REQUIRED_BINARIES.filter((name) => !existsSync(path.join(binDir, name)));
  if (missing.length > 0) {
    throw new PostgresProvisioningError(
      'missing_binaries',
      `PostgreSQL binaries not found under ${binDir} (missing: ${missing.join(', ')}). The ` +
      'bundled PostgreSQL distribution has not been placed there yet — see ' +
      'migration/reports/INSTALL-03_POSTGRES_PROVISIONING_DESIGN.md for the expected layout.'
    );
  }
  return {
    postgres: path.join(binDir, 'postgres.exe'),
    initdb: path.join(binDir, 'initdb.exe'),
    pg_ctl: path.join(binDir, 'pg_ctl.exe'),
    pg_isready: path.join(binDir, 'pg_isready.exe'),
  };
}

// ── data-directory state classification ────────────────────────────────────────────────────
// [ \t]* (not \s*) closes the CRLF/comment-merge hazard upsertConfLine's own leading \s* had
// (see that function's comment for the full mechanism) — but forensic verification against a
// REAL corrupted production file (a bare, unpaired CR — 0x0D with no following 0x0A — directly
// preceding "port = 55432") found a second, distinct hazard [ \t]* alone does not close: JS
// regex's `m` flag makes `^` anchor after ANY line-terminator character (LF, CR, U+2028, U+2029)
// INDEPENDENTLY, per the ECMAScript spec — so `^` still anchors right after that bare CR even
// though nothing crossed a line boundary to get there, making "port = 55432" look like a
// perfectly ordinary line start to this regex. PostgreSQL's own conf parser recognizes no such
// boundary — a bare CR is not a line terminator it uses at all; only a genuine LF (bare, as on
// Unix, or as the second half of a Windows CRLF pair) starts a new line for it.
// (?:^|(?<=\n)) with NO /m flag fixes this precisely: `^` (unflagged) matches only true string
// start; (?<=\n) matches only immediately after a literal LF character, covering both LF-only
// and CRLF-terminated real line starts identically to before, while a position following a bare,
// unpaired CR satisfies neither branch and is correctly rejected.
function extractPort(confText) {
  const m = confText.match(/(?:^|(?<=\n))[ \t]*port\s*=\s*'?(\d+)'?/);
  return m ? Number(m[1]) : null;
}

export function classifyDataDir(pgDataDir = resolvePgDataDir(), io = {}) {
  const { existsSync, readdirSync, readFileSync } = { ...REAL_IO, ...io };

  if (!existsSync(pgDataDir)) return { state: 'uninitialized' };

  let entries;
  try {
    entries = readdirSync(pgDataDir);
  } catch (err) {
    throw new PostgresProvisioningError('data_dir_unreadable', `Cannot read ${pgDataDir}: ${err.message}`);
  }
  if (entries.length === 0) return { state: 'uninitialized' };

  const versionFile = path.join(pgDataDir, 'PG_VERSION');
  if (!existsSync(versionFile)) {
    return {
      state: 'inconsistent',
      reason: `${pgDataDir} exists and is not empty, but has no PG_VERSION marker — this is ` +
        'not a directory initdb produced. Refusing to initialize or start PostgreSQL against ' +
        'it automatically.',
    };
  }

  const confPath = path.join(pgDataDir, 'postgresql.conf');
  if (!existsSync(confPath)) {
    return {
      state: 'inconsistent',
      reason: `${pgDataDir} has PG_VERSION but no postgresql.conf — incomplete/corrupted ` +
        'initialization. Refusing to touch it automatically.',
    };
  }

  const port = extractPort(readFileSync(confPath, 'utf8'));
  if (!port) {
    return {
      state: 'inconsistent',
      reason: `postgresql.conf in ${pgDataDir} has no parseable "port" setting — refusing to ` +
        'guess. Refusing to touch it automatically.',
    };
  }

  // ── lightweight structural validation (Option C) — cheap existence checks only, never a deep
  // integrity/checksum scan (that's what waitForReady/verifyEffectiveConfig below already do
  // better, against the real running server). Catches an interrupted/truncated initdb that still
  // happens to have PG_VERSION + a parseable port but is missing the other files a genuine
  // initdb always produces — without this, such a directory would be trusted as "initialized"
  // and handed straight to pg_ctl start.
  const hbaPath = path.join(pgDataDir, 'pg_hba.conf');
  if (!existsSync(hbaPath)) {
    return {
      state: 'inconsistent',
      reason: `${pgDataDir} has PG_VERSION and a parseable postgresql.conf but no pg_hba.conf — ` +
        'incomplete initialization. Refusing to touch it automatically.',
    };
  }

  const baseDir = path.join(pgDataDir, 'base');
  let baseEntries;
  try {
    baseEntries = existsSync(baseDir) ? readdirSync(baseDir) : [];
  } catch (err) {
    throw new PostgresProvisioningError('data_dir_unreadable', `Cannot read ${baseDir}: ${err.message}`);
  }
  if (baseEntries.length === 0) {
    return {
      state: 'inconsistent',
      reason: `${pgDataDir} has PG_VERSION and postgresql.conf but the "base" data directory is ` +
        'missing or empty — incomplete/corrupted initialization. Refusing to touch it automatically.',
    };
  }

  return { state: 'initialized', port };
}

// ── effective-configuration validation (Option B) ──────────────────────────────────────────
// verifyEffectiveConfig: ground-truth check against PostgreSQL's OWN config parser, run ONLY on
// the "initialized"/reuse path and ONLY immediately before the one place this module would
// otherwise call startPostgres() against a not-currently-running existing instance — never on a
// fresh init (patchPostgresqlConf's own already-fixed writer is authoritative there) and never
// when the instance is already confirmed running (checkReady already proved the real bound port
// matches, a stronger signal than a static query).
//
// Uses `postgres -D <dataDir> -C <param>` — PostgreSQL's own documented, read-only, non-binding
// config-query mode: it parses postgresql.conf exactly as a real startup would and prints the
// resolved value, but never allocates shared memory, never attempts a socket bind, and never
// writes anything. This is what actually closes the bug class classifyDataDir's own filesystem
// checks (extractPort included) cannot fully close on their own: it asks the real parser, not a
// JS approximation of it, so it catches ANY mismatch — not just the one known corruption shape.
//
// Fail-closed, never repaired: a mismatch throws PostgresProvisioningError('config_mismatch').
// The persisted port is never reselected and postgresql.conf is never rewritten here — pure
// read, pure refusal. pg_isready/checkReady is not a substitute: it only answers "is something
// already listening," never "what would this data directory resolve to if started."
// queryEffectiveConfigValue: routes through pg_ctl's own `-o` passthrough + `-l` log-file
// redirection rather than invoking postgres.exe directly. postgres.exe itself refuses to run AT
// ALL — even in this harmless, read-only -C query mode — under a process token with the
// Administrators group enabled, which the real installer's [Setup] PrivilegesRequired=admin
// guarantees it always is ("Execution of PostgreSQL by a user with administrative permissions is
// not permitted", confirmed empirically both ways: fails elevated, succeeds identically
// non-elevated). pg_ctl, uniquely, already handles this — it creates a restricted, non-admin
// token internally before launching its child — exactly why every OTHER pg_ctl-mediated call in
// this file (start/stop/register) already works correctly under elevation. This reuses that same
// proven mechanism rather than reimplementing Windows restricted-token creation in JS.
//
// REQUIRES the target data directory to NOT currently be running (already true of this
// function's only caller, verifyEffectiveConfig, per its own comment above) — verified
// empirically that this is a hard requirement, not just a design preference: against an
// ALREADY-RUNNING data directory, `pg_ctl start -o "-C ..."` does not behave as a safe read-only
// query at all. It instead prints "another server might be running; trying to start server
// anyway", reports a false "server started" success, and — critically — never writes anything to
// the `-l` log file, so this function would silently return no value. Calling it while running is
// unsupported, not merely untested.
//
// `-o "-C <param>"` makes the launched postgres print the resolved value and exit immediately
// instead of becoming a running server, so pg_ctl's own `-w` wait-for-ready logic ALWAYS reports
// a nonzero exit / "could not start server" for this specific, deliberate use — expected, and
// deliberately not treated as fatal on its own. The actual value is read from the `-l` log file,
// which isolates postgres's own clean stdout from pg_ctl's own interleaved status/progress
// messages (verified empirically: without file redirection, the two can interleave on the same
// handle). Only the log file's content is trusted as the true failure/success signal.
function queryEffectiveConfigValue({ pgCtlPath, dataDir, param }, io = {}) {
  const {
    execFileSync: execFileSyncFn, mkdtempSync, readFileSync: readFileSyncFn, rmSync,
  } = { ...REAL_IO, ...io };
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'studix-pgconfquery-'));
  const tempLog = path.join(tempDir, 'value.log');
  let startErr = null;
  try {
    try {
      execFileSyncFn(pgCtlPath, ['start', '-D', dataDir, '-o', `-C ${param}`, '-l', tempLog, '-w', '-t', '5'], { stdio: 'ignore' });
    } catch (err) {
      // Expected in the common case (see comment above) — kept only so a genuinely empty
      // tempLog (bad pgCtlPath, real launch failure unrelated to -C's deliberate immediate
      // exit) can still surface a useful underlying message below, rather than a bare
      // "no output" with no clue why.
      startErr = err;
    }

    let raw = '';
    try {
      raw = readFileSyncFn(tempLog, 'utf8');
    } catch {
      // tempLog was never created at all — handled by the empty-lines check below.
    }

    // postgres -C's own output is a single value with no other content — take the last
    // non-blank line rather than assuming there is exactly one, so this never depends on there
    // being no incidental blank/leading lines in the log.
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      throw new PostgresProvisioningError(
        'config_query_failed',
        `تعذّر الاستعلام عن الإعداد الفعلي "${param}" الذي يقرؤه PostgreSQL من ${dataDir}` +
        (startErr ? `: ${startErr.message}` : ': لم يُكتَب أي ناتج إلى سجلّ الاستعلام المؤقّت.')
      );
    }
    return lines[lines.length - 1];
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
}

// readPgVersionMajor: pure filesystem read of an EXISTING data directory's own PG_VERSION
// file content (classifyDataDir only checks the file's existence, never its content) — returns
// the parsed integer, or null if missing/unreadable/not a plain number. Never throws; the one
// caller (provisionPostgres's Case C branch) decides what an unreadable/null value means.
function readPgVersionMajor(pgDataDir, io = {}) {
  const { readFileSync: readFileSyncFn } = { ...REAL_IO, ...io };
  let raw;
  try {
    raw = readFileSyncFn(path.join(pgDataDir, 'PG_VERSION'), 'utf8');
  } catch {
    return null;
  }
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : null;
}

// getBundledPostgresMajorVersion: asks the BUNDLED postgres.exe itself what major version it
// is (`postgres --version` — e.g. "postgres (PostgreSQL) 18.6") — ground truth, never a
// hardcoded/duplicated constant that could silently drift from backend/scripts/
// windows-runtime-dependencies.json's actual pinned version. Same "ask the real binary,
// don't assume" convention verifyEffectiveConfig below already uses for port/listen_addresses.
function getBundledPostgresMajorVersion(postgresPath, io = {}) {
  const { execFileSync: execFileSyncFn } = { ...REAL_IO, ...io };
  let raw;
  try {
    raw = execFileSyncFn(postgresPath, ['--version'], { encoding: 'utf8' });
  } catch (err) {
    throw new PostgresProvisioningError(
      'unsupported_pgdata_version',
      `Could not determine the version of the bundled PostgreSQL (${postgresPath}): ${err.message}`
    );
  }
  const m = String(raw).match(/PostgreSQL\)?\s+(\d+)/);
  if (!m) {
    throw new PostgresProvisioningError(
      'unsupported_pgdata_version',
      `Could not parse "postgres --version" output from the bundled PostgreSQL: ${raw}`
    );
  }
  return Number(m[1]);
}

export function verifyEffectiveConfig({ pgCtlPath, dataDir, expectedPort, expectedListenAddresses = '127.0.0.1' }, io = {}) {
  const effectivePortRaw = queryEffectiveConfigValue({ pgCtlPath, dataDir, param: 'port' }, io);
  const effectiveListenAddresses = queryEffectiveConfigValue({ pgCtlPath, dataDir, param: 'listen_addresses' }, io);
  const effectivePort = Number(effectivePortRaw);

  if (effectivePort !== expectedPort || effectiveListenAddresses !== expectedListenAddresses) {
    throw new PostgresProvisioningError(
      'config_mismatch',
      `الإعداد الفعلي الذي يقرؤه PostgreSQL فعلياً من ${dataDir} (port=${effectivePortRaw}, ` +
      `listen_addresses=${effectiveListenAddresses}) لا يطابق ما يتوقّعه Studix (port=${expectedPort}, ` +
      `listen_addresses=${expectedListenAddresses}) — ملف postgresql.conf قد يكون تالفاً أو عُدِّل ` +
      'يدوياً. تم الإيقاف بدل محاولة بدء الخدمة بإعداد غير متوقَّع؛ لن يُعاد اختيار منفذ جديد ولن يُعاد ' +
      'كتابة الملف تلقائياً.'
    );
  }
}

// ── credential generation — same CSPRNG discipline as lib/productionConfig.js's
// generateSessionSecret: crypto.randomBytes only, never Math.random. ────────────────────────
export function generatePostgresPassword(randomBytes = crypto.randomBytes) {
  return randomBytes(PG_PASSWORD_BYTES).toString('hex');
}

// ── port selection ──────────────────────────────────────────────────────────────────────────
// Real probe: bind a throwaway TCP server on the candidate port/loopback address. Succeeding
// (then immediately closing) proves the port was free at that instant; EADDRINUSE proves it
// wasn't. This never touches PostgreSQL itself — pure Node networking, real and unmocked even
// in the unit test suite (see postgresProvisioning.test.js's "real port conflict" test).
export function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

// selectPort: tries the documented default first, then a small deterministic range above it.
// Never kills/touches whatever else holds an occupied port. Callers on the "already
// initialized" path never call this — the persisted port from postgresql.conf is authoritative
// (see classifyDataDir) so restarts/upgrades never pick a different port for an existing
// instance.
export async function selectPort({ preferredPort = DEFAULT_PORT, range = PORT_SCAN_RANGE, isPortFreeFn = isPortFree } = {}) {
  for (let offset = 0; offset < range; offset++) {
    const candidate = preferredPort + offset;
    // eslint-disable-next-line no-await-in-loop -- deliberately sequential: stop at the first free port
    if (await isPortFreeFn(candidate)) return candidate;
  }
  throw new PostgresProvisioningError(
    'no_free_port',
    `No free port found in ${preferredPort}-${preferredPort + range - 1} — every candidate in ` +
    'the documented Studix PostgreSQL port range is already in use.'
  );
}

// ── postgresql.conf / pg_hba.conf — minimal, targeted line patching. initdb's generated
// postgresql.conf already ships with the security-correct defaults commented out (its built-in
// default IS listen_addresses='localhost'); this writes both settings explicitly and
// verifiably rather than relying on an implicit default, matching this codebase's existing
// "verify, don't assume" convention (INSTALL-01's engine-verification step is the same idea). ─
// [ \t]* (not \s*) around the optional "#" — \s also matches \n/\r, and since initdb's own
// generated postgresql.conf is CRLF-terminated on Windows, JS regex's ^/\s treat \r and \n as
// independent line terminators (a match can anchor *inside* a CRLF pair). A leading \s* here
// could therefore cross a line boundary backward and swallow a preceding blank/short line's own
// newline, merging this key's replacement text onto the end of that (still "#"-prefixed)
// preceding line — silently turning the intended directive into dead comment text that
// PostgreSQL's parser never sees. [ \t]* only ever matches intra-line whitespace, so this can
// never happen — verified against a real initdb-generated CRLF conf, see
// postgresProvisioning.test.js's "conf line patching does not merge across CRLF line boundaries"
// coverage.
function upsertConfLine(confText, key, value) {
  const re = new RegExp(`^[ \\t]*#?[ \\t]*${key}\\s*=.*$`, 'm');
  const line = `${key} = ${value}`;
  return re.test(confText) ? confText.replace(re, line) : `${confText.replace(/\n?$/, '\n')}${line}\n`;
}

export function patchPostgresqlConf(confPath, { port }, io = {}) {
  const { existsSync, readFileSync, writeFileSync } = { ...REAL_IO, ...io };
  if (!existsSync(confPath)) {
    throw new PostgresProvisioningError('conf_missing', `postgresql.conf not found at ${confPath}.`);
  }
  let text = readFileSync(confPath, 'utf8');
  text = upsertConfLine(text, 'listen_addresses', "'127.0.0.1'");
  text = upsertConfLine(text, 'port', String(port));
  writeFileSync(confPath, text, 'utf8');
}

// writeLoopbackPgHba: REPLACES pg_hba.conf wholesale with a minimal, fully-understood file —
// deliberately not a patch of initdb's generated one (which defaults to `trust`/`scram-sha-256`
// for local socket + 127.0.0.1/::1 already in recent versions, but patching a file we don't
// fully control the starting shape of is exactly the kind of implicit-trust this module avoids
// elsewhere). Every line here is loopback-only, password-authenticated — nothing in this file
// can ever accept a LAN connection.
export function writeLoopbackPgHba(hbaPath, io = {}) {
  const { writeFileSync } = { ...REAL_IO, ...io };
  const content = [
    '# Generated by Studix (INSTALL-03 PostgreSQL provisioning). Loopback-only, password-',
    '# authenticated access. Do not add a non-127.0.0.1/::1 host entry to this file — that',
    '# would expose this PostgreSQL instance beyond the local machine.',
    'local   all   all                   scram-sha-256',
    'host    all   all   127.0.0.1/32    scram-sha-256',
    'host    all   all   ::1/128         scram-sha-256',
    '',
  ].join('\n');
  writeFileSync(hbaPath, content, 'utf8');
}

// ── initdb ──────────────────────────────────────────────────────────────────────────────────
// Password is NEVER passed on the command line (would appear in Task Manager / any process-
// listing tool) — written to a throwaway temp file and handed to initdb via --pwfile, then the
// temp file is deleted in a finally block whether initdb succeeds or fails.
export function runInitdb({ initdbPath, dataDir, password, username = PG_USER }, io = {}) {
  const { mkdtempSync, writeFileSync, rmSync, execFileSync: execFileSyncFn } = { ...REAL_IO, ...io };
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'studix-pg-pwfile-'));
  const pwFile = path.join(tmpDir, 'pw');
  writeFileSync(pwFile, password, 'utf8');
  try {
    execFileSyncFn(initdbPath, [
      '-D', dataDir,
      '-U', username,
      '--auth=scram-sha-256',
      `--pwfile=${pwFile}`,
      '-E', 'UTF8',
    ], { stdio: 'pipe' });
  } catch (err) {
    throw new PostgresProvisioningError('initdb_failed', `initdb failed: ${err.message}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── start / readiness ──────────────────────────────────────────────────────────────────────
// pg_ctl start daemonizes postgres.exe on Windows and returns — the launched postgres process
// is NOT a child of this Node process (it survives this script/process exiting), matching the
// "separate Windows service/process, not a child of the Studix Node server" architecture the
// eventual Windows Service (INSTALL-05) will take over managing.
export function startPostgres({ pgCtlPath, dataDir, logFile }, io = {}) {
  const { execFileSync: execFileSyncFn } = { ...REAL_IO, ...io };
  try {
    // stdio: 'ignore', not 'pipe' — the daemonized postgres.exe (see comment above) inherits
    // pg_ctl's stdio handles by default on Windows, so a 'pipe' keeps that pipe's write end open
    // for as long as postgres.exe keeps running. execFileSync then blocks forever waiting for
    // EOF that never comes, even though pg_ctl itself already exited successfully. Real startup
    // output is unaffected — it already goes to `logFile` via -l, never through pg_ctl's own
    // stdio.
    execFileSyncFn(pgCtlPath, ['start', '-D', dataDir, '-l', logFile, '-w', '-t', '30'], { stdio: 'ignore' });
  } catch (err) {
    throw new PostgresProvisioningError(
      'start_failed',
      `pg_ctl start failed: ${err.message} (see ${logFile} for PostgreSQL's own startup output)`,
    );
  }
}

// stopPostgres: the counterpart to startPostgres — used by disposable/scratch verification
// (see postgresProvisioning.integration.test.js) and available to any future caller that needs
// a clean shutdown (e.g. before an uninstall). Not part of provisionPostgres()'s own flow —
// provisioning only ever starts PostgreSQL, matching the "separate long-lived service" model;
// stopping it is a distinct, deliberate operation for whoever owns that lifecycle.
export function stopPostgres({ pgCtlPath, dataDir }, io = {}) {
  const { execFileSync: execFileSyncFn } = { ...REAL_IO, ...io };
  try {
    execFileSyncFn(pgCtlPath, ['stop', '-D', dataDir, '-m', 'fast', '-w', '-t', '30'], { stdio: 'pipe' });
  } catch (err) {
    throw new PostgresProvisioningError('stop_failed', `pg_ctl stop failed: ${err.message}`);
  }
}

export function checkReady({ pgIsReadyPath, host = '127.0.0.1', port }, io = {}) {
  const { execFile: execFileFn } = { ...REAL_IO, ...io };
  return new Promise((resolve) => {
    execFileFn(pgIsReadyPath, ['-h', host, '-p', String(port)], (err) => resolve(!err));
  });
}

export async function waitForReady({ pgIsReadyPath, host = '127.0.0.1', port, timeoutMs = 30_000, intervalMs = 500 }, io = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- deliberate poll loop
    if (await checkReady({ pgIsReadyPath, host, port }, io)) return true;
    if (Date.now() >= deadline) {
      throw new PostgresProvisioningError(
        'readiness_timeout',
        `PostgreSQL did not become ready on ${host}:${port} within ${timeoutMs}ms.`
      );
    }
    // eslint-disable-next-line no-await-in-loop -- deliberate poll loop
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// ── DATABASE_URL construction ──────────────────────────────────────────────────────────────
// User/password are URL-encoded — a generated hex password never needs it, but the user name
// is fixed/known-safe too; this is defense-in-depth, not load-bearing.
export function buildDatabaseUrl({ user = PG_USER, password, host = '127.0.0.1', port, database = 'studix' }) {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

// ── orchestrator ────────────────────────────────────────────────────────────────────────────
// provisionPostgres: the single entry point. See the file header for the full state model.
// Never creates the `studix` database or any application schema — that remains entirely
// db/bootstrapDatabase.js's job, called separately by the caller after this succeeds (same
// two-step shape backend/scripts/bootstrapDatabase.js already uses for
// bootstrapDatabase()+runMigrations()).
//
// Returns:
//   { status: 'initialized', port, pgDataDir, database, databaseUrl }       — first-ever init
//   { status: 'already_initialized', port, pgDataDir, database }           — reused as-is,
//                                                                             no databaseUrl:
//     the password isn't recoverable from pgdata (only its SCRAM hash is) — the caller is
//     expected to already hold it from the production config written on first init (see the
//     design doc's "installer sequencing contract").
// Throws PostgresProvisioningError (with a machine-readable .reason) on any failure — never
// returns a partial/ambiguous success.
export async function provisionPostgres({
  pgHome = resolvePgHome(),
  pgDataDir = resolvePgDataDir(),
  preferredPort = DEFAULT_PORT,
  database = 'studix',
  io = {},
} = {}) {
  const binaries = locatePgBinaries(pgHome, io);
  const classification = classifyDataDir(pgDataDir, io);

  if (classification.state === 'inconsistent') {
    throw new PostgresProvisioningError('inconsistent_data_dir', classification.reason);
  }

  const logFile = path.join(path.dirname(pgDataDir), 'pg-startup.log');

  if (classification.state === 'initialized') {
    const { port } = classification;
    const alreadyReady = await checkReady({ pgIsReadyPath: binaries.pg_isready, port }, io);
    if (!alreadyReady) {
      // Upgrade-lifecycle fix (Option F using Option B — see
      // migration/reports/ for the full identity-mismatch investigation): a registered
      // StudixPostgreSQL service already owns this exact data directory (the common post-first-
      // install case — e.g. an upgrade's PrepareToInstall having just stopped it before the
      // [Files] copy). Starting PostgreSQL directly via pg_ctl here would run postgres.exe under
      // THIS process's own identity (the elevated interactive installer) instead of the
      // service's identity (LocalSystem, which owns/created the existing WAL segments) — the
      // exact Windows identity/ACL mismatch that produces "could not open file
      // pg_wal/...: Permission denied". Once a service owns the data directory, PostgreSQL
      // lifecycle must go through the SCM (io.startPostgresServiceFn), never pg_ctl directly.
      //
      // This module never imports lib/windowsService.js to make that check/start happen (that
      // module already depends on THIS one for resolvePgHome/resolvePgDataDir/locatePgBinaries —
      // importing it back here would create a circular import). Instead, the caller
      // (src/installer/firstInstall.js, which already imports both modules) injects three small
      // callbacks via `io`. None provided (the default) means "no known service" — byte-for-byte
      // the original ad-hoc pg_ctl-start behavior, unaffected for the genuine pre-service
      // first-install bootstrap path this branch was originally written for.
      //
      // Case C (Phase 3B fix) — existing initialized pgdata, but NO service currently owns it:
      // the reinstall/recovery-over-preserved-data state (a normal uninstall correctly removes
      // StudixPostgreSQL while intentionally preserving pgdata; a later reinstall must not treat
      // that preserved data as fresh/unowned). io.registerPostgresServiceFn — when the caller
      // provides it — registers the service (reusing windowsService.js's own
      // registerPostgresService() unmodified, never duplicated here) BEFORE any start is
      // attempted, closing the exact identity-mismatch gap Case B's fix left open. Callers that
      // only wire isPostgresServiceOwnedFn/startPostgresServiceFn (or wire nothing at all) never
      // enter this branch — serviceOwnsDataDir simply stays false and the pre-existing ad-hoc
      // path runs completely unchanged, so this is purely additive.
      const { isPostgresServiceOwnedFn, registerPostgresServiceFn, startPostgresServiceFn } = io;
      let serviceOwnsDataDir = typeof isPostgresServiceOwnedFn === 'function'
        ? await isPostgresServiceOwnedFn(pgDataDir)
        : false;

      if (!serviceOwnsDataDir && typeof registerPostgresServiceFn === 'function') {
        // Ground-truth version compatibility check BEFORE ever registering/starting a service
        // against this data — never blindly treat an arbitrary directory that merely happens to
        // have a PG_VERSION file as "our" preserved Studix database. Asks the BUNDLED postgres.exe
        // itself what version it is (same "ask the real binary" philosophy verifyEffectiveConfig
        // already uses below), never a hardcoded/duplicated version constant.
        const dataDirMajor = readPgVersionMajor(pgDataDir, io);
        const bundledMajor = getBundledPostgresMajorVersion(binaries.postgres, io);
        if (dataDirMajor === null || dataDirMajor !== bundledMajor) {
          throw new PostgresProvisioningError(
            'unsupported_pgdata_version',
            `${pgDataDir} PG_VERSION (${dataDirMajor ?? 'unreadable'}) does not match the PostgreSQL ` +
            `version bundled with Studix (${bundledMajor}) — refusing to register or start a Windows ` +
            'service against data that may not even be a compatible Studix database.'
          );
        }
        // Reuses registerPostgresService()'s OWN fail-closed conflict check (throws
        // WindowsServiceError('service_name_conflict', ...) if a same-named service already
        // exists but points at a different pgDataDir) — never duplicated or re-implemented here.
        try {
          await registerPostgresServiceFn();
        } catch (err) {
          throw new PostgresProvisioningError(
            'service_registration_failed',
            `Failed to register the Windows service for the existing PostgreSQL data at ${pgDataDir}: ${err.message}`
          );
        }
        serviceOwnsDataDir = true;
      }

      if (serviceOwnsDataDir) {
        if (typeof startPostgresServiceFn !== 'function') {
          throw new PostgresProvisioningError(
            'service_lifecycle_not_configured',
            `A registered PostgreSQL Windows service already owns ${pgDataDir}, but no ` +
            'service-start dependency was provided — refusing to start PostgreSQL directly via ' +
            'pg_ctl, which would run it under the wrong Windows identity.'
          );
        }
        // No fallback to startPostgres()/pg_ctl on failure here, ever — that fallback would
        // silently recreate the exact identity-mismatch bug this branch exists to close.
        try {
          await startPostgresServiceFn();
        } catch (err) {
          throw new PostgresProvisioningError(
            'service_start_failed',
            `Failed to start the existing PostgreSQL Windows service for ${pgDataDir}: ${err.message}`
          );
        }
      } else {
        // Option B — ground-truth check against PostgreSQL's own parser, immediately before the
        // only place this branch would otherwise call startPostgres(). Throws
        // PostgresProvisioningError('config_mismatch', ...) and never reaches startPostgres() if
        // PostgreSQL's own effective config disagrees with what classifyDataDir extracted —
        // never reselects a port, never rewrites postgresql.conf.
        verifyEffectiveConfig({ pgCtlPath: binaries.pg_ctl, dataDir: pgDataDir, expectedPort: port }, io);
        startPostgres({ pgCtlPath: binaries.pg_ctl, dataDir: pgDataDir, logFile }, io);
      }
      await waitForReady({ pgIsReadyPath: binaries.pg_isready, port }, io);
    }
    return { status: 'already_initialized', port, pgDataDir, database };
  }

  // state === 'uninitialized'
  const { randomBytes } = { ...REAL_IO, ...io };
  const port = await selectPort({ preferredPort, isPortFreeFn: io.isPortFreeFn });
  const password = generatePostgresPassword(randomBytes);

  runInitdb({ initdbPath: binaries.initdb, dataDir: pgDataDir, password }, io);
  patchPostgresqlConf(path.join(pgDataDir, 'postgresql.conf'), { port }, io);
  writeLoopbackPgHba(path.join(pgDataDir, 'pg_hba.conf'), io);
  startPostgres({ pgCtlPath: binaries.pg_ctl, dataDir: pgDataDir, logFile }, io);
  await waitForReady({ pgIsReadyPath: binaries.pg_isready, port }, io);

  const databaseUrl = buildDatabaseUrl({ password, port, database });
  return { status: 'initialized', port, pgDataDir, database, databaseUrl };
}
