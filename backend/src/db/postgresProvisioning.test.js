// backend/src/db/postgresProvisioning.test.js
// INSTALL-03 — unit tests for the PostgreSQL provisioning/management layer. Every test either
// uses a real temp directory (for genuine fs behavior — state classification, conf patching)
// or injects fake execFileSync/execFile/randomBytes/isPortFreeFn (for anything that would
// otherwise require a real PostgreSQL installation). No real `postgres.exe`/`initdb.exe` is
// ever invoked here — see postgresProvisioning.integration.test.js for real-binary
// verification. Never touches the real %ProgramData% or the developer's own PostgreSQL.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path';
import crypto from 'crypto';
import {
  resolvePgHome,
  resolvePgDataDir,
  locatePgBinaries,
  classifyDataDir,
  generatePostgresPassword,
  isPortFree,
  selectPort,
  patchPostgresqlConf,
  writeLoopbackPgHba,
  buildDatabaseUrl,
  waitForReady,
  startPostgres,
  stopPostgres,
  verifyEffectiveConfig,
  provisionPostgres,
  PostgresProvisioningError,
} from './postgresProvisioning.js';
import { ensureProductionConfig } from '../lib/productionConfig.js';

const ENV_KEYS = ['STUDIX_PG_HOME', 'STUDIX_PGDATA_DIR', 'ProgramData'];
let savedEnv;
let tmpDir;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-pgprov-test-'));
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Writes a fake-but-realistic PostgreSQL data directory (what real initdb would have produced)
// so tests can exercise "already initialized" paths without ever running initdb for real.
// includeHba/includeBase default to true (Option C's structural markers) so every EXISTING
// "-> initialized" test keeps passing unmodified; tests specifically covering Option C's new
// checks pass includeHba:false / includeBase:false to omit them deliberately.
function writeFakeInitializedDataDir(dataDir, {
  port = 55432, includeVersion = true, includeConf = true, confHasPort = true,
  includeHba = true, includeBase = true,
} = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  if (includeVersion) fs.writeFileSync(path.join(dataDir, 'PG_VERSION'), '17\n', 'utf8');
  if (includeConf) {
    const confLines = [
      "#listen_addresses = 'localhost'",
      confHasPort ? `port = ${port}` : '#port = 5432',
      '',
    ];
    fs.writeFileSync(path.join(dataDir, 'postgresql.conf'), confLines.join('\n'), 'utf8');
  }
  if (includeHba) fs.writeFileSync(path.join(dataDir, 'pg_hba.conf'), 'local all all scram-sha-256\n', 'utf8');
  // A real cluster's "base" directory always has at least the template1/template0 oid
  // subdirectories — a single non-empty subdirectory is enough to prove "not missing/empty".
  if (includeBase) fs.mkdirSync(path.join(dataDir, 'base', '1'), { recursive: true });
}

function writeFakeBinaries(pgHome) {
  const binDir = path.join(pgHome, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  for (const name of ['postgres.exe', 'initdb.exe', 'pg_ctl.exe', 'pg_isready.exe']) {
    fs.writeFileSync(path.join(binDir, name), '', 'utf8');
  }
}

// The EXACT byte shape production evidence showed on the real, already-corrupted
// C:\ProgramData\Studix\pgdata\postgresql.conf: both listen_addresses and port glued directly
// onto the end of a preceding "#"-comment line, with CRLF endings elsewhere, matching real
// initdb's own generated layout. Reused by both the classifyDataDir-level and the
// provisionPostgres-level regression tests below.
const HISTORICAL_CORRUPTED_CONF = [
  '#------------------------------------------------------------------------------',
  '# CONNECTIONS AND AUTHENTICATION',
  '#------------------------------------------------------------------------------',
  '',
  "# - Connection Settings -listen_addresses = '127.0.0.1'",
  '\t\t\t\t\t# comma-separated list of addresses;',
  "\t\t\t\t\t# defaults to 'localhost'; use '*' for all",
  '\t\t\t\t\t# (change requires restart)port = 55432',
  'max_connections = 100\t\t\t# (change requires restart)',
  '',
].join('\r\n');

describe('resolvePgHome / resolvePgDataDir — path resolution (Windows-path handling)', () => {
  it('resolvePgHome respects STUDIX_PG_HOME override', () => {
    process.env.STUDIX_PG_HOME = 'D:\\Custom\\pgsql';
    expect(resolvePgHome()).toBe('D:\\Custom\\pgsql');
  });

  it('resolvePgHome defaults to a pgsql/ sibling directory when unset', () => {
    delete process.env.STUDIX_PG_HOME;
    const resolved = resolvePgHome();
    expect(path.basename(resolved)).toBe('pgsql');
  });

  it('resolvePgDataDir respects STUDIX_PGDATA_DIR override', () => {
    process.env.STUDIX_PGDATA_DIR = 'D:\\Custom\\pgdata';
    expect(resolvePgDataDir()).toBe('D:\\Custom\\pgdata');
  });

  it('resolvePgDataDir defaults to %ProgramData%\\Studix\\pgdata (same root as config/log dirs)', () => {
    delete process.env.STUDIX_PGDATA_DIR;
    process.env.ProgramData = 'C:\\FakeProgramData';
    expect(resolvePgDataDir()).toBe(path.join('C:\\FakeProgramData', 'Studix', 'pgdata'));
  });
});

describe('locatePgBinaries — missing PostgreSQL binary detection', () => {
  it('throws PostgresProvisioningError when the bundled bin/ directory does not exist at all', () => {
    const missingHome = path.join(tmpDir, 'does-not-exist');
    expect(() => locatePgBinaries(missingHome)).toThrow(PostgresProvisioningError);
  });

  it('throws when some but not all required binaries are present, naming what is missing', () => {
    const pgHome = path.join(tmpDir, 'partial-pg');
    fs.mkdirSync(path.join(pgHome, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(pgHome, 'bin', 'postgres.exe'), '', 'utf8');

    try {
      locatePgBinaries(pgHome);
      expect.fail('expected locatePgBinaries to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PostgresProvisioningError);
      expect(err.message).toContain('initdb.exe');
      expect(err.message).toContain('pg_ctl.exe');
    }
  });

  it('returns full paths for all four binaries when present', () => {
    const pgHome = path.join(tmpDir, 'full-pg');
    writeFakeBinaries(pgHome);
    const binaries = locatePgBinaries(pgHome);
    expect(binaries.postgres).toBe(path.join(pgHome, 'bin', 'postgres.exe'));
    expect(binaries.initdb).toBe(path.join(pgHome, 'bin', 'initdb.exe'));
    expect(binaries.pg_ctl).toBe(path.join(pgHome, 'bin', 'pg_ctl.exe'));
    expect(binaries.pg_isready).toBe(path.join(pgHome, 'bin', 'pg_isready.exe'));
  });
});

describe('classifyDataDir — state detection', () => {
  it('missing data directory -> uninitialized', () => {
    const dataDir = path.join(tmpDir, 'missing');
    expect(classifyDataDir(dataDir)).toEqual({ state: 'uninitialized' });
  });

  it('empty (existing but no files) data directory -> uninitialized', () => {
    const dataDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(dataDir);
    expect(classifyDataDir(dataDir)).toEqual({ state: 'uninitialized' });
  });

  it('PG_VERSION + parseable port in postgresql.conf -> initialized, with the persisted port', () => {
    const dataDir = path.join(tmpDir, 'ready');
    writeFakeInitializedDataDir(dataDir, { port: 55440 });
    expect(classifyDataDir(dataDir)).toEqual({ state: 'initialized', port: 55440 });
  });

  it('non-empty directory with no PG_VERSION -> inconsistent (fails closed, never destructive)', () => {
    const dataDir = path.join(tmpDir, 'foreign');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(dataDir, 'something-else.txt'), 'not postgres', 'utf8');
    const result = classifyDataDir(dataDir);
    expect(result.state).toBe('inconsistent');
    expect(result.reason).toMatch(/PG_VERSION/);
  });

  it('PG_VERSION present but postgresql.conf missing -> inconsistent', () => {
    const dataDir = path.join(tmpDir, 'no-conf');
    writeFakeInitializedDataDir(dataDir, { includeConf: false });
    const result = classifyDataDir(dataDir);
    expect(result.state).toBe('inconsistent');
  });

  it('postgresql.conf present but port unparseable -> inconsistent', () => {
    const dataDir = path.join(tmpDir, 'no-port');
    writeFakeInitializedDataDir(dataDir, { confHasPort: false });
    const result = classifyDataDir(dataDir);
    expect(result.state).toBe('inconsistent');
  });
});

describe('classifyDataDir — structural validation (Option C)', () => {
  it('all markers present -> initialized (no regression from adding the new checks)', () => {
    const dataDir = path.join(tmpDir, 'fully-ready');
    writeFakeInitializedDataDir(dataDir, { port: 55555 });
    expect(classifyDataDir(dataDir)).toEqual({ state: 'initialized', port: 55555 });
  });

  it('PG_VERSION + parseable port but missing pg_hba.conf -> inconsistent', () => {
    const dataDir = path.join(tmpDir, 'no-hba');
    writeFakeInitializedDataDir(dataDir, { includeHba: false });
    const result = classifyDataDir(dataDir);
    expect(result.state).toBe('inconsistent');
    expect(result.reason).toMatch(/pg_hba\.conf/);
  });

  it('PG_VERSION + parseable port but missing "base" directory -> inconsistent', () => {
    const dataDir = path.join(tmpDir, 'no-base');
    writeFakeInitializedDataDir(dataDir, { includeBase: false });
    const result = classifyDataDir(dataDir);
    expect(result.state).toBe('inconsistent');
    expect(result.reason).toMatch(/base/);
  });

  it('"base" directory exists but is empty -> inconsistent, same as missing', () => {
    const dataDir = path.join(tmpDir, 'empty-base');
    writeFakeInitializedDataDir(dataDir, { includeBase: false });
    fs.mkdirSync(path.join(dataDir, 'base')); // exists, but genuinely empty
    const result = classifyDataDir(dataDir);
    expect(result.state).toBe('inconsistent');
    expect(result.reason).toMatch(/base/);
  });

  // Regression, item A/C: reproduces the exact historical corrupted configuration shape
  // (real production evidence) directly through classifyDataDir/extractPort. The actual
  // incident: extractPort's old `^\s*` pattern still "found" 55432 inside dead comment text (a
  // stray \r counts as a valid line-start anchor to JS regex, even though PostgreSQL's own
  // parser never sees an active directive there at all) — so classifyDataDir reported this
  // directory "initialized" when it was not safe to trust.
  it('exact historical CRLF-corrupted postgresql.conf -> inconsistent, never "initialized"', () => {
    const dataDir = path.join(tmpDir, 'crlf-corrupted');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'PG_VERSION'), '18\n', 'utf8');
    fs.writeFileSync(path.join(dataDir, 'pg_hba.conf'), 'local all all scram-sha-256\n', 'utf8');
    fs.mkdirSync(path.join(dataDir, 'base', '1'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'postgresql.conf'), HISTORICAL_CORRUPTED_CONF, 'utf8');

    const result = classifyDataDir(dataDir);
    expect(result.state).toBe('inconsistent');
  });
});

describe('extractPort / classifyDataDir — bare-CR line-boundary hardening', () => {
  // Forensic finding on the REAL production C:\ProgramData\Studix\pgdata\postgresql.conf: a
  // bare, unpaired CR (0x0D, with no following 0x0A) sits directly before "port = 55432". JS
  // regex's `m` flag makes `^` anchor after ANY line-terminator character (LF, CR, U+2028,
  // U+2029) INDEPENDENTLY — so even the already-hardened `[ \t]*` pattern still treated that
  // bare CR as a valid line start, letting extractPort "find" 55432 and classifyDataDir report
  // "initialized" for a file PostgreSQL's own parser resolves to its compiled-in defaults
  // (verifyEffectiveConfig confirmed this mismatch independently and correctly failed closed —
  // this describe block hardens detection at the classifyDataDir layer itself, one layer
  // earlier, so the same directory is never even reported "initialized" to begin with).
  function writeDirWithConf(dataDir, confText) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'PG_VERSION'), '18\n', 'utf8');
    fs.writeFileSync(path.join(dataDir, 'pg_hba.conf'), 'local all all scram-sha-256\n', 'utf8');
    fs.mkdirSync(path.join(dataDir, 'base', '1'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'postgresql.conf'), confText, 'utf8');
  }

  it('normal LF config -> initialized, port 55432', () => {
    const dataDir = path.join(tmpDir, 'bare-cr-lf');
    writeDirWithConf(dataDir, '# comment\nport = 55432\n');
    expect(classifyDataDir(dataDir)).toEqual({ state: 'initialized', port: 55432 });
  });

  it('normal CRLF config -> initialized, port 55432', () => {
    const dataDir = path.join(tmpDir, 'bare-cr-crlf');
    writeDirWithConf(dataDir, '# comment\r\nport = 55432\r\n');
    expect(classifyDataDir(dataDir)).toEqual({ state: 'initialized', port: 55432 });
  });

  it('malformed bare-CR config ("# comment\\rport = 55432\\r\\n") -> inconsistent, never "initialized"', () => {
    const dataDir = path.join(tmpDir, 'bare-cr-malformed');
    writeDirWithConf(dataDir, '# comment\rport = 55432\r\n');
    const result = classifyDataDir(dataDir);
    expect(result.state).toBe('inconsistent');
    expect(result.reason).toMatch(/port/);
  });

  // The exact real-world byte shape, forensically confirmed on the actual production data
  // directory (§ this task's own root-cause report): a bare CR directly precedes the port
  // directive, with no accompanying LF at that position.
  it('exact real-world pattern ("# (change requires restart)\\rport = 55432\\r\\n") -> inconsistent, never "initialized"', () => {
    const dataDir = path.join(tmpDir, 'bare-cr-real-world');
    writeDirWithConf(dataDir, '\t\t\t\t\t# (change requires restart)\rport = 55432\r\n');
    const result = classifyDataDir(dataDir);
    expect(result.state).toBe('inconsistent');
    expect(result.reason).toMatch(/port/);
  });
});

describe('generatePostgresPassword — credential generation', () => {
  it('produces 64 lowercase hex characters (32 bytes / 256 bits)', () => {
    expect(generatePostgresPassword()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is generated via a CSPRNG (crypto.randomBytes-shaped), not Math.random', () => {
    const spy = vi.fn((n) => crypto.randomBytes(n));
    generatePostgresPassword(spy);
    expect(spy).toHaveBeenCalledWith(32);
  });

  it('produces a different value on every call', () => {
    expect(generatePostgresPassword()).not.toBe(generatePostgresPassword());
  });
});

describe('port selection', () => {
  it('port available: picks the preferred port when free', async () => {
    const port = await selectPort({ preferredPort: 55499, isPortFreeFn: async () => true });
    expect(port).toBe(55499);
  });

  it('port occupied: skips to the next free candidate in range', async () => {
    const occupied = new Set([55500, 55501]);
    const isPortFreeFn = vi.fn(async (p) => !occupied.has(p));
    const port = await selectPort({ preferredPort: 55500, isPortFreeFn });
    expect(port).toBe(55502);
    expect(isPortFreeFn).toHaveBeenCalledWith(55500);
    expect(isPortFreeFn).toHaveBeenCalledWith(55501);
  });

  it('throws PostgresProvisioningError when every candidate in range is occupied', async () => {
    await expect(selectPort({ preferredPort: 1, range: 3, isPortFreeFn: async () => false }))
      .rejects.toThrow(PostgresProvisioningError);
  });

  it('real port-conflict detection: an actually-bound port is correctly reported as not free', async () => {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const boundPort = server.address().port;
    try {
      expect(await isPortFree(boundPort)).toBe(false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('real port-free detection: a genuinely unbound high port is reported as free', async () => {
    // Extremely unlikely to be occupied on a CI/dev box; if it ever is, this test's own
    // real-conflict test above already proves the negative path works.
    expect(await isPortFree(58631)).toBe(true);
  });
});

describe('port persistence', () => {
  it('an already-initialized data directory reuses its persisted port rather than re-selecting one', async () => {
    const pgHome = path.join(tmpDir, 'pg');
    writeFakeBinaries(pgHome);
    const pgDataDir = path.join(tmpDir, 'pgdata');
    writeFakeInitializedDataDir(pgDataDir, { port: 55477 });

    const execFile = (cmd, args, cb) => cb(null); // pg_isready always "ready" — no start needed
    const result = await provisionPostgres({ pgHome, pgDataDir, io: { execFile } });

    expect(result).toEqual({ status: 'already_initialized', port: 55477, pgDataDir, database: 'studix' });
  });
});

describe('loopback-only configuration', () => {
  it('patchPostgresqlConf sets listen_addresses to 127.0.0.1 and the given port', () => {
    const confPath = path.join(tmpDir, 'postgresql.conf');
    fs.writeFileSync(confPath, "#listen_addresses = 'localhost'\n#port = 5432\n", 'utf8');

    patchPostgresqlConf(confPath, { port: 55432 });

    const written = fs.readFileSync(confPath, 'utf8');
    expect(written).toMatch(/^listen_addresses = '127\.0\.0\.1'$/m);
    expect(written).toMatch(/^port = 55432$/m);
  });

  it('throws if postgresql.conf does not exist yet (never creates one from nothing)', () => {
    expect(() => patchPostgresqlConf(path.join(tmpDir, 'nope.conf'), { port: 1 }))
      .toThrow(PostgresProvisioningError);
  });

  // Regression for a real production incident: initdb's own generated postgresql.conf is
  // CRLF-terminated on Windows (verified against the real bundled initdb.exe), and JS regex's
  // ^/\s treat \r and \n as independent line terminators — a naive `\s*` right after `^` can
  // therefore anchor *inside* a CRLF pair and cross backward into the preceding line. This
  // fixture mirrors the real "# - Connection Settings -" / "#listen_addresses" / "#port" layout
  // initdb actually produces (blank line before listen_addresses, tab-continuation comment
  // immediately before port) with real \r\n endings, exactly as seen in the field.
  it('conf line patching does not merge a directive into a preceding CRLF comment line', () => {
    const confPath = path.join(tmpDir, 'postgresql.conf');
    const conf = [
      '#------------------------------------------------------------------------------',
      '# CONNECTIONS AND AUTHENTICATION',
      '#------------------------------------------------------------------------------',
      '',
      '# - Connection Settings -',
      '',
      "#listen_addresses = 'localhost'\t\t# what IP address(es) to listen on;",
      '\t\t\t\t\t# comma-separated list of addresses;',
      '\t\t\t\t\t# defaults to \'localhost\'; use \'*\' for all',
      '\t\t\t\t\t# (change requires restart)',
      '#port = 5432\t\t\t\t# (change requires restart)',
      'max_connections = 100\t\t\t# (change requires restart)',
      '',
    ].join('\r\n');
    fs.writeFileSync(confPath, conf, 'utf8');

    patchPostgresqlConf(confPath, { port: 55432 });
    const written = fs.readFileSync(confPath, 'utf8');

    // Byte-exact checks, not `^...$/m` — with CRLF text, JS regex's `^`/`$` treat a bare `\r`
    // (with no paired `\n`) as a valid line boundary too, which is exactly the corrupted shape
    // this bug produces ("Settings -\rlisten_addresses..."). A `^...$/m` assertion would pass
    // against BOTH the correct output and that corrupted one, so it can't be trusted to catch
    // this regression — only an exact-substring check on a real `\r\n` proves the directive
    // landed on its own genuinely CRLF-terminated line with the preceding comment intact.
    expect(written).toContain("# - Connection Settings -\r\n\r\nlisten_addresses = '127.0.0.1'\r\n");
    expect(written).toContain('# (change requires restart)\r\nport = 55432\r\n');
    // Explicitly rule out both corrupted shapes this bug actually produces: fully glued (no
    // separator at all) and merged-with-a-bare-CR (no paired \n) — either would silently turn
    // the directive into dead comment text that PostgreSQL's parser never sees, reverting to
    // its own compiled-in defaults (listen_addresses='localhost', port=5432).
    expect(written).not.toContain('Settings -listen_addresses');
    expect(written).not.toContain('Settings -\rlisten_addresses');
    expect(written).not.toContain('restart)port');
    expect(written).not.toContain('restart)\rport');
  });

  it('writeLoopbackPgHba writes only 127.0.0.1/32 and ::1/128 host entries, never a LAN/wildcard address', () => {
    const hbaPath = path.join(tmpDir, 'pg_hba.conf');
    writeLoopbackPgHba(hbaPath);
    const written = fs.readFileSync(hbaPath, 'utf8');
    expect(written).toContain('127.0.0.1/32');
    expect(written).toContain('::1/128');
    expect(written).not.toMatch(/0\.0\.0\.0\/0/);
    expect(written).not.toMatch(/\btrust\b/); // never passwordless auth
    expect(written).toMatch(/scram-sha-256/);
  });
});

describe('verifyEffectiveConfig — ground-truth PostgreSQL config validation (Option B)', () => {
  // Mirrors the real, elevation-safe implementation: queryEffectiveConfigValue routes through
  // `pg_ctl start -o "-C <param>" -l <tempLog>` (never postgres.exe directly — see the function's
  // own comment for why: postgres.exe unconditionally refuses to run at all under an
  // Administrator-enabled token, which the real installer's elevation guarantees, while pg_ctl's
  // own restricted-token handling does not have this problem). `-C` mode makes the launched
  // postgres exit immediately instead of becoming a running server, so pg_ctl's own `-w` wait
  // ALWAYS reports this as a failed start — execThrows defaults to true to mirror that real,
  // expected-nonzero-exit shape; the actual value is written into the fake tempLog exactly as
  // the real -l redirection would, and only that file's content is asserted on.
  function fakeCQuery(responses, { execThrows = true } = {}) {
    const written = {};
    const mkdtempSync = vi.fn(() => 'FAKE_TMP_DIR');
    const execFileSync = vi.fn((cmd, args) => {
      const oValue = args[args.indexOf('-o') + 1]; // "-C <param>"
      const param = oValue.replace(/^-C\s+/, '');
      const tempLog = args[args.indexOf('-l') + 1];
      if (!(param in responses)) throw new Error(`unexpected -C param: ${param}`);
      written[tempLog] = `${responses[param]}\n`;
      if (execThrows) throw new Error('pg_ctl: could not start server\nExamine the log output.');
      return '';
    });
    const readFileSync = vi.fn((p) => {
      if (!(p in written)) { const e = new Error(`ENOENT: ${p}`); throw e; }
      return written[p];
    });
    const rmSync = vi.fn();
    return { execFileSync, mkdtempSync, readFileSync, rmSync };
  }

  it('does not throw when the effective config matches what Studix expects', () => {
    const io = fakeCQuery({ port: '55432', listen_addresses: '127.0.0.1' });
    expect(() => verifyEffectiveConfig(
      { pgCtlPath: 'pg_ctl.exe', dataDir: 'D', expectedPort: 55432 },
      io
    )).not.toThrow();
    expect(io.execFileSync).toHaveBeenCalledWith(
      'pg_ctl.exe', ['start', '-D', 'D', '-o', '-C port', '-l', 'FAKE_TMP_DIR\\value.log', '-w', '-t', '5'],
      expect.objectContaining({ stdio: 'ignore' })
    );
    expect(io.execFileSync).toHaveBeenCalledWith(
      'pg_ctl.exe', ['start', '-D', 'D', '-o', '-C listen_addresses', '-l', 'FAKE_TMP_DIR\\value.log', '-w', '-t', '5'],
      expect.objectContaining({ stdio: 'ignore' })
    );
    expect(io.rmSync).toHaveBeenCalledTimes(2); // once per queryEffectiveConfigValue call, success path
  });

  it('accepts a non-default persisted port as long as the effective config genuinely matches it — persisted port stays authoritative, never reselected', () => {
    const io = fakeCQuery({ port: '55440', listen_addresses: '127.0.0.1' });
    expect(() => verifyEffectiveConfig(
      { pgCtlPath: 'pg_ctl.exe', dataDir: 'D', expectedPort: 55440 },
      io
    )).not.toThrow();
  });

  it('throws PostgresProvisioningError(config_mismatch) on a port mismatch — models the real incident: effective config silently fell back to the compiled-in default 5432 instead of the persisted 55432 (Studix never needs to know or care what else might be using 5432 — it only compares against its own expected value)', () => {
    const io = fakeCQuery({ port: '5432', listen_addresses: 'localhost' });
    try {
      verifyEffectiveConfig({ pgCtlPath: 'pg_ctl.exe', dataDir: 'D', expectedPort: 55432 }, io);
      expect.fail('expected verifyEffectiveConfig to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PostgresProvisioningError);
      expect(err.reason).toBe('config_mismatch');
    }
  });

  it('throws PostgresProvisioningError(config_mismatch) on a listen_addresses mismatch even when the port matches', () => {
    const io = fakeCQuery({ port: '55432', listen_addresses: 'localhost' });
    try {
      verifyEffectiveConfig({ pgCtlPath: 'pg_ctl.exe', dataDir: 'D', expectedPort: 55432 }, io);
      expect.fail('expected verifyEffectiveConfig to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PostgresProvisioningError);
      expect(err.reason).toBe('config_mismatch');
    }
  });

  it('never writes anything, regardless of outcome — pure read, pure refusal, no auto-repair', () => {
    const writeFileSync = vi.fn();
    const io = fakeCQuery({ port: '5432', listen_addresses: 'localhost' });
    expect(() => verifyEffectiveConfig(
      { pgCtlPath: 'pg_ctl.exe', dataDir: 'D', expectedPort: 55432 },
      { ...io, writeFileSync }
    )).toThrow(PostgresProvisioningError);
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('tolerates pg_ctl\'s own expected nonzero exit for -C mode — the log file content is the real signal, not the exec result', () => {
    // fakeCQuery's execFileSync always throws by default (execThrows: true), mirroring the real,
    // always-nonzero-for-`-C` pg_ctl behavior confirmed empirically — this test exists to make
    // that tolerance explicit and would fail loudly (via the mismatch below never being reached)
    // if a future change stopped catching that expected throw.
    const io = fakeCQuery({ port: '55432', listen_addresses: '127.0.0.1' }, { execThrows: true });
    expect(() => verifyEffectiveConfig({ pgCtlPath: 'pg_ctl.exe', dataDir: 'D', expectedPort: 55432 }, io)).not.toThrow();
  });

  it('always cleans up the temporary log directory, including on a config_mismatch failure path', () => {
    const io = fakeCQuery({ port: '5432', listen_addresses: 'localhost' });
    expect(() => verifyEffectiveConfig({ pgCtlPath: 'pg_ctl.exe', dataDir: 'D', expectedPort: 55432 }, io)).toThrow();
    expect(io.rmSync).toHaveBeenCalledWith('FAKE_TMP_DIR', expect.objectContaining({ recursive: true, force: true }));
  });

  it('throws PostgresProvisioningError(config_query_failed) when the temp log ends up with no usable output at all (genuine failure, not the expected -C exit)', () => {
    const mkdtempSync = vi.fn(() => 'FAKE_TMP_DIR');
    const execFileSync = vi.fn(() => { throw new Error('pg_ctl.exe: command not found'); });
    const readFileSync = vi.fn(() => { throw new Error('ENOENT'); }); // tempLog was never created
    const rmSync = vi.fn();
    try {
      verifyEffectiveConfig(
        { pgCtlPath: 'pg_ctl.exe', dataDir: 'D', expectedPort: 55432 },
        { execFileSync, mkdtempSync, readFileSync, rmSync }
      );
      expect.fail('expected verifyEffectiveConfig to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PostgresProvisioningError);
      expect(err.reason).toBe('config_query_failed');
      expect(err.message).toContain('pg_ctl.exe: command not found'); // underlying error surfaced, not swallowed
    }
    expect(rmSync).toHaveBeenCalled(); // cleanup still runs on this failure path too
  });
});

describe('buildDatabaseUrl — DATABASE_URL construction with the actual selected port', () => {
  it('embeds the given user/password/host/port/database', () => {
    const url = buildDatabaseUrl({ user: 'studix_admin', password: 'abc123', host: '127.0.0.1', port: 55432, database: 'studix' });
    expect(url).toBe('postgresql://studix_admin:abc123@127.0.0.1:55432/studix');
  });

  it('URL-encodes special characters in the password', () => {
    const url = buildDatabaseUrl({ password: 'p@ss/word?', port: 5432 });
    expect(() => new URL(url)).not.toThrow();
    expect(decodeURIComponent(new URL(url).password)).toBe('p@ss/word?');
  });
});

describe('startPostgres / stopPostgres — process invocation shape', () => {
  it('startPostgres invokes pg_ctl with start/-D/-w and throws PostgresProvisioningError on failure', () => {
    const execFileSync = vi.fn(() => { throw new Error('boom'); });
    expect(() => startPostgres({ pgCtlPath: 'pg_ctl.exe', dataDir: 'D', logFile: 'L' }, { execFileSync }))
      .toThrow(PostgresProvisioningError);
    expect(execFileSync.mock.calls[0][1]).toContain('start');
  });

  it('stopPostgres invokes pg_ctl with stop/-D and throws PostgresProvisioningError on failure', () => {
    const execFileSync = vi.fn(() => { throw new Error('boom'); });
    expect(() => stopPostgres({ pgCtlPath: 'pg_ctl.exe', dataDir: 'D' }, { execFileSync }))
      .toThrow(PostgresProvisioningError);
    expect(execFileSync.mock.calls[0][1]).toContain('stop');
  });
});

describe('waitForReady — failure/timeout behavior', () => {
  it('resolves as soon as checkReady succeeds', async () => {
    let calls = 0;
    const execFile = (cmd, args, cb) => { calls += 1; cb(calls >= 2 ? null : new Error('not ready')); };
    await expect(waitForReady({ pgIsReadyPath: 'x', port: 1, intervalMs: 1 }, { execFile })).resolves.toBe(true);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('throws PostgresProvisioningError after the timeout elapses without ever becoming ready', async () => {
    const execFile = (cmd, args, cb) => cb(new Error('never ready'));
    await expect(
      waitForReady({ pgIsReadyPath: 'x', port: 1, timeoutMs: 50, intervalMs: 10 }, { execFile })
    ).rejects.toThrow(PostgresProvisioningError);
  });
});

describe('provisionPostgres — fresh (uninitialized) provisioning', () => {
  function fakeIoForFreshInit(pgDataDir) {
    const execFileSync = vi.fn((cmd, args) => {
      if (cmd.includes('initdb')) {
        const dIndex = args.indexOf('-D');
        const dataDir = args[dIndex + 1];
        writeFakeInitializedDataDir(dataDir, { port: 5432 /* placeholder, patched below */ });
      }
      // pg_ctl start: no-op
      return '';
    });
    const execFile = (cmd, args, cb) => cb(null); // pg_isready always ready
    return { execFileSync, execFile };
  }

  it('initializes a fresh data directory end-to-end and returns a databaseUrl using the selected port', async () => {
    const pgHome = path.join(tmpDir, 'pg');
    writeFakeBinaries(pgHome);
    const pgDataDir = path.join(tmpDir, 'pgdata');
    const io = fakeIoForFreshInit(pgDataDir);

    const result = await provisionPostgres({
      pgHome,
      pgDataDir,
      preferredPort: 55600,
      io: { ...io, isPortFreeFn: async () => true },
    });

    expect(result.status).toBe('initialized');
    expect(result.port).toBe(55600);
    expect(result.databaseUrl).toContain(':55600/studix');
    expect(io.execFileSync).toHaveBeenCalled(); // initdb + pg_ctl were invoked
  });

  it('writes loopback-only postgresql.conf/pg_hba.conf as part of fresh initialization', async () => {
    const pgHome = path.join(tmpDir, 'pg');
    writeFakeBinaries(pgHome);
    const pgDataDir = path.join(tmpDir, 'pgdata');
    const io = fakeIoForFreshInit(pgDataDir);

    await provisionPostgres({ pgHome, pgDataDir, preferredPort: 55601, io: { ...io, isPortFreeFn: async () => true } });

    const conf = fs.readFileSync(path.join(pgDataDir, 'postgresql.conf'), 'utf8');
    expect(conf).toMatch(/listen_addresses = '127\.0\.0\.1'/);
    const hba = fs.readFileSync(path.join(pgDataDir, 'pg_hba.conf'), 'utf8');
    expect(hba).toContain('127.0.0.1/32');
  });
});

describe('provisionPostgres — inconsistent state fails closed, no destructive reinitialization', () => {
  it('refuses to touch an inconsistent data directory (never calls initdb)', async () => {
    const pgHome = path.join(tmpDir, 'pg');
    writeFakeBinaries(pgHome);
    const pgDataDir = path.join(tmpDir, 'pgdata');
    fs.mkdirSync(pgDataDir);
    fs.writeFileSync(path.join(pgDataDir, 'unexpected.txt'), 'not postgres', 'utf8');

    const execFileSync = vi.fn();
    await expect(provisionPostgres({ pgHome, pgDataDir, io: { execFileSync } }))
      .rejects.toThrow(PostgresProvisioningError);
    expect(execFileSync).not.toHaveBeenCalled();
  });
});

describe('provisionPostgres — no destructive reinitialization of an already-initialized directory', () => {
  it('never calls initdb when the data directory is already initialized', async () => {
    const pgHome = path.join(tmpDir, 'pg');
    writeFakeBinaries(pgHome);
    const pgDataDir = path.join(tmpDir, 'pgdata');
    writeFakeInitializedDataDir(pgDataDir, { port: 55650 });

    const execFileSync = vi.fn();
    const execFile = (cmd, args, cb) => cb(null);
    const result = await provisionPostgres({ pgHome, pgDataDir, io: { execFileSync, execFile } });

    expect(result.status).toBe('already_initialized');
    expect(execFileSync).not.toHaveBeenCalled(); // no pg_ctl start needed — checkReady already true, and initdb never runs either way
  });
});

describe('provisionPostgres — reuse path, not currently running: Option B gate before startPostgres()', () => {
  it('healthy directory: verifies effective config, then starts successfully (retry-after-crash / retry-after-interrupted-start)', async () => {
    const pgHome = path.join(tmpDir, 'pg');
    writeFakeBinaries(pgHome);
    const pgDataDir = path.join(tmpDir, 'pgdata');
    writeFakeInitializedDataDir(pgDataDir, { port: 55432 });

    let isRunning = false;
    // queryEffectiveConfigValue's real shape is `pg_ctl start -D <dir> -o "-C <param>" -l <tempLog>
    // -w -t 5` (never postgres.exe directly — see postgresProvisioning.js's own comment for why).
    // Distinguished from the REAL startPostgres() call (also args[0] === 'start') by the presence
    // of '-o', which only the config-query call ever includes. Writes the response value to the
    // real tempLog path via the real (unmocked) fs, exactly as real pg_ctl -l redirection would,
    // then throws — pg_ctl's own always-nonzero exit for `-C` mode, tolerated by
    // queryEffectiveConfigValue (only the log file's content is trusted).
    function respondToEffectiveConfigQuery(args, { port = '55432', listenAddresses = '127.0.0.1' } = {}) {
      const oValue = args[args.indexOf('-o') + 1];
      const param = oValue.replace(/^-C\s+/, '');
      const tempLog = args[args.indexOf('-l') + 1];
      fs.writeFileSync(tempLog, `${param === 'port' ? port : listenAddresses}\n`, 'utf8');
      throw new Error('pg_ctl: could not start server');
    }
    const execFile = (cmd, args, cb) => cb(isRunning ? null : new Error('not ready'));
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === 'start' && args.includes('-o')) return respondToEffectiveConfigQuery(args);
      if (args[0] === 'start') { isRunning = true; return ''; }
      throw new Error(`unexpected execFileSync call: ${JSON.stringify(args)}`);
    });

    const result = await provisionPostgres({ pgHome, pgDataDir, io: { execFile, execFileSync } });

    expect(result).toEqual({ status: 'already_initialized', port: 55432, pgDataDir, database: 'studix' });
    expect(execFileSync.mock.calls.some(([, args]) => args[0] === 'start' && !args.includes('-o'))).toBe(true);
  });

  it('syntactically clean but effective-config mismatch -> fails closed as config_mismatch, never calls pg_ctl start, never rewrites postgresql.conf', async () => {
    const pgHome = path.join(tmpDir, 'pg');
    writeFakeBinaries(pgHome);
    const pgDataDir = path.join(tmpDir, 'pgdata');
    writeFakeInitializedDataDir(pgDataDir, { port: 55432 });
    const confPath = path.join(pgDataDir, 'postgresql.conf');
    const confBefore = fs.readFileSync(confPath, 'utf8');

    const execFile = (cmd, args, cb) => cb(new Error('not ready'));
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === 'start' && args.includes('-o')) {
        const oValue = args[args.indexOf('-o') + 1];
        const param = oValue.replace(/^-C\s+/, '');
        const tempLog = args[args.indexOf('-l') + 1];
        // effective config silently reverted to defaults
        fs.writeFileSync(tempLog, `${param === 'port' ? '5432' : 'localhost'}\n`, 'utf8');
        throw new Error('pg_ctl: could not start server');
      }
      throw new Error('pg_ctl start (real server) should never be reached');
    });

    await expect(provisionPostgres({ pgHome, pgDataDir, io: { execFile, execFileSync } }))
      .rejects.toMatchObject({ reason: 'config_mismatch' });

    expect(execFileSync.mock.calls.every(([, args]) => args[0] === 'start' && args.includes('-o'))).toBe(true);
    expect(fs.readFileSync(confPath, 'utf8')).toBe(confBefore); // postgresql.conf untouched
  });

  it('missing pg_hba.conf -> refused by classifyDataDir before any child process is invoked', async () => {
    const pgHome = path.join(tmpDir, 'pg');
    writeFakeBinaries(pgHome);
    const pgDataDir = path.join(tmpDir, 'pgdata');
    writeFakeInitializedDataDir(pgDataDir, { includeHba: false });

    const execFileSync = vi.fn();
    await expect(provisionPostgres({ pgHome, pgDataDir, io: { execFileSync } }))
      .rejects.toMatchObject({ reason: 'inconsistent_data_dir' });
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('missing/empty "base" directory -> refused by classifyDataDir before any child process is invoked', async () => {
    const pgHome = path.join(tmpDir, 'pg');
    writeFakeBinaries(pgHome);
    const pgDataDir = path.join(tmpDir, 'pgdata');
    writeFakeInitializedDataDir(pgDataDir, { includeBase: false });

    const execFileSync = vi.fn();
    await expect(provisionPostgres({ pgHome, pgDataDir, io: { execFileSync } }))
      .rejects.toMatchObject({ reason: 'inconsistent_data_dir' });
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('exact historical CRLF-corrupted postgresql.conf -> refused before any child process is invoked (end-to-end closure of the original production incident)', async () => {
    const pgHome = path.join(tmpDir, 'pg');
    writeFakeBinaries(pgHome);
    const pgDataDir = path.join(tmpDir, 'pgdata');
    fs.mkdirSync(pgDataDir, { recursive: true });
    fs.writeFileSync(path.join(pgDataDir, 'PG_VERSION'), '18\n', 'utf8');
    fs.writeFileSync(path.join(pgDataDir, 'pg_hba.conf'), 'local all all scram-sha-256\n', 'utf8');
    fs.mkdirSync(path.join(pgDataDir, 'base', '1'), { recursive: true });
    fs.writeFileSync(path.join(pgDataDir, 'postgresql.conf'), HISTORICAL_CORRUPTED_CONF, 'utf8');

    const execFileSync = vi.fn();
    await expect(provisionPostgres({ pgHome, pgDataDir, io: { execFileSync } }))
      .rejects.toMatchObject({ reason: 'inconsistent_data_dir' });
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('existing instance on a non-default persisted port (55440): verified and started using that exact port, never DEFAULT_PORT (55432)', async () => {
    const pgHome = path.join(tmpDir, 'pg');
    writeFakeBinaries(pgHome);
    const pgDataDir = path.join(tmpDir, 'pgdata');
    writeFakeInitializedDataDir(pgDataDir, { port: 55440 });

    let isRunning = false;
    const execFile = (cmd, args, cb) => cb(isRunning ? null : new Error('not ready'));
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === 'start' && args.includes('-o')) {
        const oValue = args[args.indexOf('-o') + 1];
        const param = oValue.replace(/^-C\s+/, '');
        const tempLog = args[args.indexOf('-l') + 1];
        fs.writeFileSync(tempLog, `${param === 'port' ? '55440' : '127.0.0.1'}\n`, 'utf8');
        throw new Error('pg_ctl: could not start server');
      }
      if (args[0] === 'start') { isRunning = true; return ''; }
      throw new Error(`unexpected execFileSync call: ${JSON.stringify(args)}`);
    });

    const result = await provisionPostgres({
      pgHome, pgDataDir, preferredPort: 55432 /* module default — must be ignored on reuse */, io: { execFile, execFileSync },
    });

    expect(result).toEqual({ status: 'already_initialized', port: 55440, pgDataDir, database: 'studix' });
    expect(execFileSync.mock.calls.some(([, args]) => args.includes('55432'))).toBe(false);
  });
});

describe('provisionPostgres — service-owned reuse path (upgrade lifecycle fix: Option F using Option B)', () => {
  // These tests never call the real windowsService.js — provisionPostgres() must never import
  // it (would create a circular import, since windowsService.js already depends on
  // postgresProvisioning.js for resolvePgHome/resolvePgDataDir/locatePgBinaries). Instead the
  // caller (src/installer/firstInstall.js in production) injects two small callbacks via `io`:
  //   io.isPostgresServiceOwnedFn(pgDataDir) -> boolean — "does a registered StudixPostgreSQL
  //     service already own this exact data directory?"
  //   io.startPostgresServiceFn() -> starts that service via the SCM (sc.exe start), never pg_ctl
  // When neither is provided (the default), behavior is byte-for-byte the pre-existing ad-hoc
  // pg_ctl-start path — see the "no service" test below, which protects that fallback exactly.

  function fakePgHomeAndDataDir(prefix) {
    const pgHome = path.join(tmpDir, `${prefix}-pg`);
    writeFakeBinaries(pgHome);
    const pgDataDir = path.join(tmpDir, `${prefix}-pgdata`);
    writeFakeInitializedDataDir(pgDataDir, { port: 55432 });
    return { pgHome, pgDataDir };
  }

  // Test A — an existing StudixPostgreSQL service already owns this pgdata.
  it('Test A: when a registered service owns this data directory, starts it via the service dependency instead of pg_ctl, then confirms readiness', async () => {
    const { pgHome, pgDataDir } = fakePgHomeAndDataDir('svc-owns');

    let isRunning = false;
    const startPostgresServiceFn = vi.fn(() => { isRunning = true; });
    const isPostgresServiceOwnedFn = vi.fn(() => true);
    // pg_isready: not ready until the (fake) service-start flips isRunning.
    const execFile = (cmd, args, cb) => cb(isRunning ? null : new Error('not ready'));
    // Any execFileSync call at all here would mean startPostgres()/pg_ctl was invoked directly —
    // exactly what must never happen once a service owns the data directory.
    const execFileSync = vi.fn(() => { throw new Error('startPostgres()/pg_ctl must never be called when a service owns this pgdata'); });

    const result = await provisionPostgres({
      pgHome, pgDataDir, io: { execFile, execFileSync, isPostgresServiceOwnedFn, startPostgresServiceFn },
    });

    expect(isPostgresServiceOwnedFn).toHaveBeenCalledWith(pgDataDir);
    expect(startPostgresServiceFn).toHaveBeenCalledTimes(1);
    expect(execFileSync).not.toHaveBeenCalled(); // startPostgres()/pg_ctl never invoked
    expect(result).toEqual({ status: 'already_initialized', port: 55432, pgDataDir, database: 'studix' });
  });

  // Test B — initialized pgdata, but no service registered at all (pre-service-registration
  // bootstrap/retry path). The pre-existing direct pg_ctl behavior must be completely unchanged.
  it('Test B: when no service owns this data directory, falls back to the existing direct pg_ctl start (unchanged pre-service behavior)', async () => {
    const { pgHome, pgDataDir } = fakePgHomeAndDataDir('no-svc');

    let isRunning = false;
    const isPostgresServiceOwnedFn = vi.fn(() => false);
    const startPostgresServiceFn = vi.fn();
    const execFile = (cmd, args, cb) => cb(isRunning ? null : new Error('not ready'));
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === 'start' && args.includes('-o')) {
        const oValue = args[args.indexOf('-o') + 1];
        const param = oValue.replace(/^-C\s+/, '');
        const tempLog = args[args.indexOf('-l') + 1];
        fs.writeFileSync(tempLog, `${param === 'port' ? '55432' : '127.0.0.1'}\n`, 'utf8');
        throw new Error('pg_ctl: could not start server');
      }
      if (args[0] === 'start') { isRunning = true; return ''; }
      throw new Error(`unexpected execFileSync call: ${JSON.stringify(args)}`);
    });

    const result = await provisionPostgres({
      pgHome, pgDataDir, io: { execFile, execFileSync, isPostgresServiceOwnedFn, startPostgresServiceFn },
    });

    expect(startPostgresServiceFn).not.toHaveBeenCalled();
    expect(execFileSync.mock.calls.some(([, args]) => args[0] === 'start' && !args.includes('-o'))).toBe(true); // real pg_ctl start reached
    expect(result).toEqual({ status: 'already_initialized', port: 55432, pgDataDir, database: 'studix' });
  });

  // Also protects the DEFAULT (no io.isPostgresServiceOwnedFn/startPostgresServiceFn injected at
  // all) — must behave exactly like "no service", never throw, never silently no-op.
  it('Test B (default, nothing injected): behaves exactly like "no service" — direct pg_ctl start, unaffected by this change', async () => {
    const { pgHome, pgDataDir } = fakePgHomeAndDataDir('default-no-io');

    let isRunning = false;
    const execFile = (cmd, args, cb) => cb(isRunning ? null : new Error('not ready'));
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === 'start' && args.includes('-o')) {
        const oValue = args[args.indexOf('-o') + 1];
        const param = oValue.replace(/^-C\s+/, '');
        const tempLog = args[args.indexOf('-l') + 1];
        fs.writeFileSync(tempLog, `${param === 'port' ? '55432' : '127.0.0.1'}\n`, 'utf8');
        throw new Error('pg_ctl: could not start server');
      }
      if (args[0] === 'start') { isRunning = true; return ''; }
      throw new Error(`unexpected execFileSync call: ${JSON.stringify(args)}`);
    });

    const result = await provisionPostgres({ pgHome, pgDataDir, io: { execFile, execFileSync } });
    expect(result).toEqual({ status: 'already_initialized', port: 55432, pgDataDir, database: 'studix' });
  });

  // Test C — a same-named service exists but does not belong to this pgdata. The injected
  // predicate itself (isPostgresServiceRegisteredFor, tested separately in
  // windowsService.test.js) is responsible for returning false in this case; here we simply
  // prove provisionPostgres() honors a false result exactly like "no service" — never attempts
  // to start the unrelated service, never touches any other (e.g. external) PostgreSQL.
  it('Test C: a same-named-but-foreign service (predicate returns false) is treated as not-ours — no attempt to start it, safe ad-hoc behavior preserved', async () => {
    const { pgHome, pgDataDir } = fakePgHomeAndDataDir('foreign-svc');

    let isRunning = false;
    const isPostgresServiceOwnedFn = vi.fn(() => false); // "exists but not ours" already resolved to false by the real predicate
    const startPostgresServiceFn = vi.fn();
    const execFile = (cmd, args, cb) => cb(isRunning ? null : new Error('not ready'));
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === 'start' && args.includes('-o')) {
        const oValue = args[args.indexOf('-o') + 1];
        const param = oValue.replace(/^-C\s+/, '');
        const tempLog = args[args.indexOf('-l') + 1];
        fs.writeFileSync(tempLog, `${param === 'port' ? '55432' : '127.0.0.1'}\n`, 'utf8');
        throw new Error('pg_ctl: could not start server');
      }
      if (args[0] === 'start') { isRunning = true; return ''; }
      throw new Error(`unexpected execFileSync call: ${JSON.stringify(args)}`);
    });

    const result = await provisionPostgres({
      pgHome, pgDataDir, io: { execFile, execFileSync, isPostgresServiceOwnedFn, startPostgresServiceFn },
    });

    expect(startPostgresServiceFn).not.toHaveBeenCalled();
    expect(result.status).toBe('already_initialized');
  });

  // Test D — the service exists and owns this pgdata, but starting it fails. Must fail the whole
  // provisioning step clearly, and must NEVER fall back to a direct pg_ctl start — that fallback
  // would recreate the exact identity-mismatch bug this fix exists to close.
  it('Test D: service-start failure fails provisioning clearly, with no fallback to direct pg_ctl start', async () => {
    const { pgHome, pgDataDir } = fakePgHomeAndDataDir('svc-start-fails');

    const isPostgresServiceOwnedFn = vi.fn(() => true);
    const startPostgresServiceFn = vi.fn(() => {
      throw new Error('فشل بدء خدمة "StudixPostgreSQL": الوصول مرفوض');
    });
    const execFile = (cmd, args, cb) => cb(new Error('not ready'));
    const execFileSync = vi.fn(() => { throw new Error('startPostgres()/pg_ctl must never be called as a fallback'); });

    await expect(provisionPostgres({
      pgHome, pgDataDir, io: { execFile, execFileSync, isPostgresServiceOwnedFn, startPostgresServiceFn },
    })).rejects.toMatchObject({ reason: 'service_start_failed' });

    expect(execFileSync).not.toHaveBeenCalled(); // no fallback to pg_ctl
    // The underlying service-layer error (which already names the service) is preserved/surfaced.
    await expect(provisionPostgres({
      pgHome, pgDataDir, io: { execFile, execFileSync, isPostgresServiceOwnedFn, startPostgresServiceFn },
    })).rejects.toThrow(/StudixPostgreSQL/);
  });

  it('when the predicate reports "owned" but no startPostgresServiceFn was provided, fails clearly instead of silently falling back to pg_ctl', async () => {
    const { pgHome, pgDataDir } = fakePgHomeAndDataDir('svc-owned-not-configured');

    const isPostgresServiceOwnedFn = vi.fn(() => true);
    const execFile = (cmd, args, cb) => cb(new Error('not ready'));
    const execFileSync = vi.fn(() => { throw new Error('startPostgres()/pg_ctl must never be called here'); });

    await expect(provisionPostgres({
      pgHome, pgDataDir, io: { execFile, execFileSync, isPostgresServiceOwnedFn },
    })).rejects.toMatchObject({ reason: 'service_lifecycle_not_configured' });
    expect(execFileSync).not.toHaveBeenCalled();
  });
});

describe('provisionPostgres — Case C: existing initialized pgdata, service missing (reinstall/recovery over preserved data)', () => {
  // Reproduces the Phase 3B production defect: a normal uninstall correctly removes the
  // StudixPostgreSQL service while intentionally preserving pgdata; a later reinstall must
  // NEVER start that preserved pgdata ad-hoc (wrong Windows identity — the exact "could not
  // open file pg_logical/replorigin_checkpoint: Permission denied" class of bug). The fix:
  // register the service FIRST (io.registerPostgresServiceFn — reuses windowsService.js's own
  // registerPostgresService(), never duplicated here), then start it via SCM — never pg_ctl.
  //
  // "postgres.exe --version" is asked directly (ground truth, matching verifyEffectiveConfig's
  // own "ask the real binary" philosophy elsewhere in this file) to confirm PG_VERSION's
  // content is plausibly compatible with the BUNDLED binaries before ever registering/starting
  // a service against it — writeFakeBinaries() only creates empty placeholder files, so every
  // test below must inject its own `postgres.exe --version`-shaped execFileSync response.
  function fakePgHomeAndDataDirWithVersion(prefix, { pgVersion = '18\n' } = {}) {
    const pgHome = path.join(tmpDir, `${prefix}-pg`);
    writeFakeBinaries(pgHome);
    const pgDataDir = path.join(tmpDir, `${prefix}-pgdata`);
    writeFakeInitializedDataDir(pgDataDir, { port: 55432 });
    fs.writeFileSync(path.join(pgDataDir, 'PG_VERSION'), pgVersion, 'utf8');
    return { pgHome, pgDataDir };
  }

  function execFileSyncWithVersion(bundledVersionOutput, extra) {
    return vi.fn((cmd, args, ...rest) => {
      if (args.length === 1 && args[0] === '--version') return bundledVersionOutput;
      return extra(cmd, args, ...rest);
    });
  }

  it('Case C happy path: no service owns this pgdata, but registerPostgresServiceFn IS provided — registers first, then starts via SCM, never via pg_ctl', async () => {
    const { pgHome, pgDataDir } = fakePgHomeAndDataDirWithVersion('case-c-happy');

    let isRunning = false;
    const isPostgresServiceOwnedFn = vi.fn(() => false);
    const registerPostgresServiceFn = vi.fn(() => { /* registers, does not start */ });
    const startPostgresServiceFn = vi.fn(() => { isRunning = true; });
    const execFile = (cmd, args, cb) => cb(isRunning ? null : new Error('not ready'));
    const execFileSync = execFileSyncWithVersion('postgres (PostgreSQL) 18.6\n', () => {
      throw new Error('startPostgres()/pg_ctl start must never be called in Case C');
    });

    const result = await provisionPostgres({
      pgHome, pgDataDir, io: {
        execFile, execFileSync, isPostgresServiceOwnedFn, registerPostgresServiceFn, startPostgresServiceFn,
      },
    });

    expect(registerPostgresServiceFn).toHaveBeenCalledTimes(1);
    // Registration must happen BEFORE the start — never the other way around.
    const registerOrder = registerPostgresServiceFn.mock.invocationCallOrder[0];
    const startOrder = startPostgresServiceFn.mock.invocationCallOrder[0];
    expect(registerOrder).toBeLessThan(startOrder);
    expect(startPostgresServiceFn).toHaveBeenCalledTimes(1);
    expect(execFileSync.mock.calls.some(([, args]) => args[0] === 'start')).toBe(false); // no ad-hoc pg_ctl start, ever
    expect(result).toEqual({ status: 'already_initialized', port: 55432, pgDataDir, database: 'studix' });
  });

  it('Case C never calls ad-hoc pg_ctl start under any circumstance — direct assertion against execFileSync\'s full call log', async () => {
    const { pgHome, pgDataDir } = fakePgHomeAndDataDirWithVersion('case-c-no-adhoc');

    let isRunning = false;
    const registerPostgresServiceFn = vi.fn(() => {});
    const startPostgresServiceFn = vi.fn(() => { isRunning = true; });
    const execFile = (cmd, args, cb) => cb(isRunning ? null : new Error('not ready'));
    const execFileSync = execFileSyncWithVersion('postgres (PostgreSQL) 18.6\n', () => '');

    await provisionPostgres({
      pgHome, pgDataDir, io: {
        execFile, execFileSync, isPostgresServiceOwnedFn: () => false, registerPostgresServiceFn, startPostgresServiceFn,
      },
    });

    // Every execFileSync call must be the version probe — never a pg_ctl "start" (ad-hoc) call,
    // never a "-C" verifyEffectiveConfig probe either (that probe only exists to sanity-check
    // the ad-hoc path, which Case C must never reach at all).
    for (const [, args] of execFileSync.mock.calls) {
      expect(args).not.toContain('start');
    }
  });

  it('Case C: exact registration arguments point at THIS existing pgdata (via the real registerPostgresService reused unmodified)', async () => {
    // Uses the REAL windowsService.js registerPostgresService() (not a bare mock) to prove
    // provisionPostgres's io wiring, once connected the way firstInstall.js connects it,
    // actually threads the correct pgDataDir through — not a hand-wavy "was called" check.
    const { registerPostgresService } = await import('../lib/windowsService.js');
    const { pgHome, pgDataDir } = fakePgHomeAndDataDirWithVersion('case-c-exact-args');

    let isRunning = false;
    const scCalls = [];
    const winIo = {
      execFileSync: vi.fn((cmd, args) => {
        scCalls.push([cmd, ...args]);
        if (cmd === 'sc.exe' && args[0] === 'qc') { const e = new Error('not found'); e.status = 1060; throw e; }
        if (cmd === 'sc.exe' && args[0] === 'failure') return '';
        if (String(cmd).includes('pg_ctl') && args[0] === 'register') return '';
        throw new Error(`unexpected windowsService call: ${JSON.stringify(args)}`);
      }),
    };
    const registerPostgresServiceFn = () => registerPostgresService({ pgHome, pgDataDir, serviceName: 'StudixPostgreSQL' }, winIo);
    const startPostgresServiceFn = vi.fn(() => { isRunning = true; });

    const execFile = (cmd, args, cb) => cb(isRunning ? null : new Error('not ready'));
    const execFileSync = execFileSyncWithVersion('postgres (PostgreSQL) 18.6\n', () => {
      throw new Error('startPostgres()/pg_ctl start must never be called in Case C');
    });

    await provisionPostgres({
      pgHome, pgDataDir, io: {
        execFile, execFileSync, isPostgresServiceOwnedFn: () => false, registerPostgresServiceFn, startPostgresServiceFn,
      },
    });

    const registerCall = scCalls.find((c) => c.includes('register'));
    expect(registerCall).toEqual([
      path.join(pgHome, 'bin', 'pg_ctl.exe'), 'register', '-N', 'StudixPostgreSQL', '-D', pgDataDir, '-S', 'auto', '-w',
    ]);
    // No SERVICE_START_NAME/account override anywhere in the call — LocalSystem stays the
    // Windows-assigned default, exactly as registerPostgresService already guarantees
    // unmodified (see windowsService.test.js's own coverage of this exact argv shape).
    expect(registerCall.join(' ')).not.toMatch(/-U |SERVICE_START_NAME/i);
  });

  it('Case C: wrong service ownership (service exists, points at a DIFFERENT pgdata) fails closed — never starts it, never modifies the unrelated service', async () => {
    const { registerPostgresService, WindowsServiceError } = await import('../lib/windowsService.js');
    const { pgHome, pgDataDir } = fakePgHomeAndDataDirWithVersion('case-c-wrong-owner');
    const foreignDataDir = path.join(tmpDir, 'some-other-apps-pgdata');

    const winIo = {
      execFileSync: vi.fn((cmd, args) => {
        if (cmd === 'sc.exe' && args[0] === 'qc') {
          return [
            '[SC] QueryServiceConfig SUCCESS',
            'SERVICE_NAME: StudixPostgreSQL',
            `        BINARY_PATH_NAME   : "${path.join(pgHome, 'bin', 'pg_ctl.exe')}" runservice -N "StudixPostgreSQL" -D "${foreignDataDir}" -w`,
          ].join('\n');
        }
        throw new Error(`unexpected windowsService call: ${JSON.stringify(args)}`);
      }),
    };
    const registerPostgresServiceFn = () => registerPostgresService({ pgHome, pgDataDir, serviceName: 'StudixPostgreSQL' }, winIo);
    const startPostgresServiceFn = vi.fn();
    const execFile = (cmd, args, cb) => cb(new Error('not ready'));
    const execFileSync = execFileSyncWithVersion('postgres (PostgreSQL) 18.6\n', () => {
      throw new Error('startPostgres()/pg_ctl start must never be called');
    });

    await expect(provisionPostgres({
      pgHome, pgDataDir, io: {
        execFile, execFileSync, isPostgresServiceOwnedFn: () => false, registerPostgresServiceFn, startPostgresServiceFn,
      },
    })).rejects.toMatchObject({ reason: 'service_registration_failed' });

    expect(startPostgresServiceFn).not.toHaveBeenCalled();
    // The real registerPostgresService's own fail-closed conflict check is what actually threw
    // (WindowsServiceError('service_name_conflict', ...)) — provisionPostgres wraps it, never
    // swallows or reinterprets it as success.
  });

  it('Case C: service registration failure fails closed, no fallback to ad-hoc pg_ctl start', async () => {
    const { pgHome, pgDataDir } = fakePgHomeAndDataDirWithVersion('case-c-register-fails');

    const registerPostgresServiceFn = vi.fn(() => { throw new Error('فشل تسجيل خدمة PostgreSQL: الوصول مرفوض'); });
    const startPostgresServiceFn = vi.fn();
    const execFile = (cmd, args, cb) => cb(new Error('not ready'));
    const execFileSync = execFileSyncWithVersion('postgres (PostgreSQL) 18.6\n', () => {
      throw new Error('startPostgres()/pg_ctl start must never be called as a fallback');
    });

    await expect(provisionPostgres({
      pgHome, pgDataDir, io: {
        execFile, execFileSync, isPostgresServiceOwnedFn: () => false, registerPostgresServiceFn, startPostgresServiceFn,
      },
    })).rejects.toMatchObject({ reason: 'service_registration_failed' });

    expect(startPostgresServiceFn).not.toHaveBeenCalled();
  });

  it('Case C: SCM start failure (after successful registration) fails closed, no fallback to ad-hoc pg_ctl start', async () => {
    const { pgHome, pgDataDir } = fakePgHomeAndDataDirWithVersion('case-c-start-fails');

    const registerPostgresServiceFn = vi.fn(() => {});
    const startPostgresServiceFn = vi.fn(() => { throw new Error('فشل بدء خدمة "StudixPostgreSQL": الوصول مرفوض'); });
    const execFile = (cmd, args, cb) => cb(new Error('not ready'));
    const execFileSync = execFileSyncWithVersion('postgres (PostgreSQL) 18.6\n', () => {
      throw new Error('startPostgres()/pg_ctl start must never be called as a fallback');
    });

    await expect(provisionPostgres({
      pgHome, pgDataDir, io: {
        execFile, execFileSync, isPostgresServiceOwnedFn: () => false, registerPostgresServiceFn, startPostgresServiceFn,
      },
    })).rejects.toMatchObject({ reason: 'service_start_failed' });

    expect(registerPostgresServiceFn).toHaveBeenCalledTimes(1); // registration DID succeed
    expect(execFileSync.mock.calls.some(([, args]) => args[0] === 'start')).toBe(false); // still no ad-hoc fallback
  });

  it('Case C: pgdata whose PG_VERSION does not match the bundled PostgreSQL major version fails closed before any registration attempt', async () => {
    const { pgHome, pgDataDir } = fakePgHomeAndDataDirWithVersion('case-c-wrong-pg-version', { pgVersion: '15\n' });

    const registerPostgresServiceFn = vi.fn(() => {});
    const startPostgresServiceFn = vi.fn();
    const execFile = (cmd, args, cb) => cb(new Error('not ready'));
    const execFileSync = execFileSyncWithVersion('postgres (PostgreSQL) 18.6\n', () => {
      throw new Error('startPostgres()/pg_ctl start must never be called');
    });

    await expect(provisionPostgres({
      pgHome, pgDataDir, io: {
        execFile, execFileSync, isPostgresServiceOwnedFn: () => false, registerPostgresServiceFn, startPostgresServiceFn,
      },
    })).rejects.toMatchObject({ reason: 'unsupported_pgdata_version' });

    expect(registerPostgresServiceFn).not.toHaveBeenCalled();
    expect(startPostgresServiceFn).not.toHaveBeenCalled();
  });

  it('when registerPostgresServiceFn is NOT provided at all, Case C is never entered — falls back to the pre-existing ad-hoc behavior unchanged (backward compatibility for callers that only wire isPostgresServiceOwnedFn/startPostgresServiceFn)', async () => {
    const { pgHome, pgDataDir } = fakePgHomeAndDataDirWithVersion('case-c-not-wired');

    let isRunning = false;
    const isPostgresServiceOwnedFn = vi.fn(() => false);
    const execFile = (cmd, args, cb) => cb(isRunning ? null : new Error('not ready'));
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === 'start' && args.includes('-o')) {
        const oValue = args[args.indexOf('-o') + 1];
        const param = oValue.replace(/^-C\s+/, '');
        const tempLog = args[args.indexOf('-l') + 1];
        fs.writeFileSync(tempLog, `${param === 'port' ? '55432' : '127.0.0.1'}\n`, 'utf8');
        throw new Error('pg_ctl: could not start server');
      }
      if (args[0] === 'start') { isRunning = true; return ''; }
      throw new Error(`unexpected execFileSync call: ${JSON.stringify(args)}`);
    });

    const result = await provisionPostgres({
      pgHome, pgDataDir, io: { execFile, execFileSync, isPostgresServiceOwnedFn },
    });

    expect(execFileSync.mock.calls.some(([, args]) => args[0] === 'start' && !args.includes('-o'))).toBe(true); // ad-hoc start reached, unchanged
    expect(result).toEqual({ status: 'already_initialized', port: 55432, pgDataDir, database: 'studix' });
  });
});

describe('provisionPostgres — retry after initdb succeeds but the first start attempt fails', () => {
  it('a fresh init whose startPostgres fails leaves a genuinely complete data directory (classified "initialized", not "inconsistent") that a retry can then start successfully', async () => {
    const pgHome = path.join(tmpDir, 'pg');
    writeFakeBinaries(pgHome);
    const pgDataDir = path.join(tmpDir, 'pgdata');

    let startAttempt = 0;
    let isRunning = false;
    const execFileSync = vi.fn((cmd, args) => {
      if (cmd.includes('initdb')) {
        const dIndex = args.indexOf('-D');
        writeFakeInitializedDataDir(args[dIndex + 1], { port: 5432 /* placeholder, patched below */ });
        return '';
      }
      if (args[0] === 'start' && args.includes('-o')) {
        const oValue = args[args.indexOf('-o') + 1];
        const param = oValue.replace(/^-C\s+/, '');
        const tempLog = args[args.indexOf('-l') + 1];
        fs.writeFileSync(tempLog, `${param === 'port' ? '55650' : '127.0.0.1'}\n`, 'utf8');
        throw new Error('pg_ctl: could not start server');
      }
      if (args[0] === 'start') {
        startAttempt += 1;
        if (startAttempt === 1) throw new Error('simulated: pg_ctl start failed the first time');
        isRunning = true;
        return '';
      }
      return '';
    });
    const execFile = (cmd, args, cb) => cb(isRunning ? null : new Error('not ready'));

    // First attempt: fresh init succeeds through patchPostgresqlConf/writeLoopbackPgHba, but
    // startPostgres fails — mirrors a real "interrupted between initdb succeeding and PostgreSQL
    // successfully starting" scenario (investigation 2, point 6).
    await expect(provisionPostgres({
      pgHome, pgDataDir, preferredPort: 55650, io: { execFileSync, execFile, isPortFreeFn: async () => true },
    })).rejects.toMatchObject({ reason: 'start_failed' });

    // The directory left behind is genuinely complete/valid — proves Option C's new structural
    // checks don't false-positive on this legitimate interrupted-before-start state.
    expect(classifyDataDir(pgDataDir)).toEqual({ state: 'initialized', port: 55650 });

    // Retry: same directory. verifyEffectiveConfig (Option B) also runs on this retry and
    // passes, proving it does not stand in the way of a legitimate recovery.
    const second = await provisionPostgres({
      pgHome, pgDataDir, preferredPort: 55650, io: { execFileSync, execFile, isPortFreeFn: async () => true },
    });
    expect(second.status).toBe('already_initialized');
    expect(second.port).toBe(55650);
  });
});

describe('provisionPostgres — idempotent repeated provisioning calls', () => {
  it('calling provisionPostgres twice: first initializes, second reuses without re-initdb', async () => {
    const pgHome = path.join(tmpDir, 'pg');
    writeFakeBinaries(pgHome);
    const pgDataDir = path.join(tmpDir, 'pgdata');

    const initdbSpy = vi.fn();
    const execFileSync = (cmd, args) => {
      if (cmd.includes('initdb')) {
        initdbSpy();
        const dIndex = args.indexOf('-D');
        writeFakeInitializedDataDir(args[dIndex + 1], { port: 5432 });
      }
      return '';
    };
    const execFile = (cmd, args, cb) => cb(null);

    const first = await provisionPostgres({
      pgHome, pgDataDir, preferredPort: 55700, io: { execFileSync, execFile, isPortFreeFn: async () => true },
    });
    expect(first.status).toBe('initialized');
    expect(initdbSpy).toHaveBeenCalledTimes(1);

    const second = await provisionPostgres({
      pgHome, pgDataDir, preferredPort: 55700, io: { execFileSync, execFile, isPortFreeFn: async () => true },
    });
    expect(second.status).toBe('already_initialized');
    expect(second.port).toBe(first.port);
    expect(initdbSpy).toHaveBeenCalledTimes(1); // still 1 — not called again
  });
});

describe('credential never appears in returned/logged status objects', () => {
  it('the already_initialized result carries no password/databaseUrl field at all', async () => {
    const pgHome = path.join(tmpDir, 'pg');
    writeFakeBinaries(pgHome);
    const pgDataDir = path.join(tmpDir, 'pgdata');
    writeFakeInitializedDataDir(pgDataDir, { port: 55710 });
    const execFile = (cmd, args, cb) => cb(null);

    const result = await provisionPostgres({ pgHome, pgDataDir, io: { execFile } });

    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('databaseUrl');
    expect(Object.keys(result).sort()).toEqual(['database', 'pgDataDir', 'port', 'status']);
  });

  it('no field of a fresh-init result other than databaseUrl itself contains the password', async () => {
    const pgHome = path.join(tmpDir, 'pg');
    writeFakeBinaries(pgHome);
    const pgDataDir = path.join(tmpDir, 'pgdata');
    const execFileSync = (cmd, args) => {
      if (cmd.includes('initdb')) {
        const dIndex = args.indexOf('-D');
        writeFakeInitializedDataDir(args[dIndex + 1], { port: 5432 });
      }
      return '';
    };
    const execFile = (cmd, args, cb) => cb(null);

    const result = await provisionPostgres({
      pgHome, pgDataDir, preferredPort: 55720, io: { execFileSync, execFile, isPortFreeFn: async () => true },
    });
    const password = new URL(result.databaseUrl).password;

    for (const [key, value] of Object.entries(result)) {
      if (key === 'databaseUrl') continue;
      expect(String(value)).not.toContain(password);
    }
  });

  it('never writes to console.log/console.error during provisioning', async () => {
    const pgHome = path.join(tmpDir, 'pg');
    writeFakeBinaries(pgHome);
    const pgDataDir = path.join(tmpDir, 'pgdata');
    const execFileSync = (cmd, args) => {
      if (cmd.includes('initdb')) {
        const dIndex = args.indexOf('-D');
        writeFakeInitializedDataDir(args[dIndex + 1], { port: 5432 });
      }
      return '';
    };
    const execFile = (cmd, args, cb) => cb(null);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await provisionPostgres({ pgHome, pgDataDir, preferredPort: 55730, io: { execFileSync, execFile, isPortFreeFn: async () => true } });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('environment/config integration with INSTALL-02', () => {
  it('the databaseUrl produced by provisionPostgres is accepted verbatim by ensureProductionConfig', async () => {
    const pgHome = path.join(tmpDir, 'pg');
    writeFakeBinaries(pgHome);
    const pgDataDir = path.join(tmpDir, 'pgdata');
    const execFileSync = (cmd, args) => {
      if (cmd.includes('initdb')) {
        const dIndex = args.indexOf('-D');
        writeFakeInitializedDataDir(args[dIndex + 1], { port: 5432 });
      }
      return '';
    };
    const execFile = (cmd, args, cb) => cb(null);

    const provisionResult = await provisionPostgres({
      pgHome, pgDataDir, preferredPort: 55740, io: { execFileSync, execFile, isPortFreeFn: async () => true },
    });

    const configPath = path.join(tmpDir, 'config', '.env');
    const configResult = ensureProductionConfig({ configPath, databaseUrl: provisionResult.databaseUrl });

    expect(configResult.created).toBe(true);
    const written = fs.readFileSync(configPath, 'utf8');
    expect(written).toContain(`DATABASE_URL=${provisionResult.databaseUrl}`);
    expect(written).toMatch(/SESSION_SECRET=[0-9a-f]{64}/);
  });
});
