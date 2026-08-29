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
//   - pgDataDir non-empty but no PG_VERSION
//     or postgresql.conf, or unparseable
//     port                                  -> "inconsistent"  -> FAIL CLOSED, never touched
//   - PG_VERSION + parseable port present  -> "initialized"    -> reuse as-is, never re-initdb
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
function extractPort(confText) {
  const m = confText.match(/^\s*port\s*=\s*'?(\d+)'?/m);
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

  return { state: 'initialized', port };
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
function upsertConfLine(confText, key, value) {
  const re = new RegExp(`^\\s*#?\\s*${key}\\s*=.*$`, 'm');
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
    execFileSyncFn(pgCtlPath, ['start', '-D', dataDir, '-l', logFile, '-w', '-t', '30'], { stdio: 'pipe' });
  } catch (err) {
    throw new PostgresProvisioningError('start_failed', `pg_ctl start failed: ${err.message}`);
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
      startPostgres({ pgCtlPath: binaries.pg_ctl, dataDir: pgDataDir, logFile }, io);
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
