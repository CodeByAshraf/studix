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
function writeFakeInitializedDataDir(dataDir, { port = 55432, includeVersion = true, includeConf = true, confHasPort = true } = {}) {
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
}

function writeFakeBinaries(pgHome) {
  const binDir = path.join(pgHome, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  for (const name of ['postgres.exe', 'initdb.exe', 'pg_ctl.exe', 'pg_isready.exe']) {
    fs.writeFileSync(path.join(binDir, name), '', 'utf8');
  }
}

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
