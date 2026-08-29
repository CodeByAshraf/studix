// backend/src/installer/firstInstall.test.js
// INSTALL-06 — pure, dependency-injected unit tests for the orchestrator's sequencing and
// branching logic. Every reused INSTALL-02/03/05 function is mocked at its own boundary (each
// already has its own full test coverage in its own module) — this file tests ONLY that
// runFirstInstall calls the right functions, in the right order, with the right arguments, and
// stops immediately on the first failure. Never touches a real PostgreSQL, a real Windows
// service, a real network request, or a real browser.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runFirstInstall, FirstInstallError } from './firstInstall.js';

let savedDatabaseUrl;
beforeEach(() => {
  savedDatabaseUrl = process.env.DATABASE_URL;
});
afterEach(() => {
  if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDatabaseUrl;
});

function baseDeps(overrides = {}) {
  const calls = [];
  const record = (name) => (...args) => { calls.push([name, ...args]); };

  const deps = {
    provisionPostgresFn: vi.fn(async (...args) => { record('provisionPostgres')(...args); return { status: 'initialized', databaseUrl: 'postgresql://studix_admin:secret@127.0.0.1:55432/studix' }; }),
    ensureProductionConfigFn: vi.fn((...args) => { record('ensureProductionConfig')(...args); return { created: true }; }),
    resolveProductionConfigPathFn: vi.fn(() => 'C:\\ProgramData\\Studix\\config\\.env'),
    loadEnvConfigFn: vi.fn((...args) => { record('loadEnvConfig')(...args); process.env.DATABASE_URL = 'postgresql://studix_admin:secret@127.0.0.1:55432/studix'; }),
    validateDatabaseUrlFn: vi.fn((...args) => { record('validateDatabaseUrl')(...args); }),
    bootstrapDatabaseFn: vi.fn(async (...args) => { record('bootstrapDatabase')(...args); return { action: 'schema_applied' }; }),
    stopPostgresFn: vi.fn((...args) => { record('stopPostgres')(...args); }),
    resolvePgHomeFn: vi.fn(() => 'C:\\Studix\\pgsql'),
    resolvePgDataDirFn: vi.fn(() => 'C:\\ProgramData\\Studix\\pgdata'),
    locatePgBinariesFn: vi.fn(() => ({ pg_ctl: 'C:\\Studix\\pgsql\\bin\\pg_ctl.exe' })),
    registerPostgresServiceFn: vi.fn((...args) => { record('registerPostgresService')(...args); return { status: 'registered' }; }),
    registerAppServiceFn: vi.fn((...args) => { record('registerAppService')(...args); return { status: 'registered' }; }),
    startServiceFn: vi.fn((...args) => { record('startService')(...args); return { status: 'started' }; }),
    resolveInstallRootFn: vi.fn(() => 'C:\\Studix'),
    waitForHealthFn: vi.fn(async (...args) => { record('waitForHealth')(...args); return true; }),
    openBrowserFn: vi.fn((...args) => { record('openBrowser')(...args); }),
    fetchImpl: vi.fn(),
    ...overrides,
  };
  return { deps, calls };
}

describe('runFirstInstall — input validation', () => {
  it('throws immediately when schemaPath is missing, without calling anything', async () => {
    const { deps, calls } = baseDeps();
    await expect(runFirstInstall({ deps })).rejects.toThrow(FirstInstallError);
    expect(calls).toHaveLength(0);
  });
});

describe('runFirstInstall — fresh install (provisionPostgres returns "initialized")', () => {
  it('calls every step in the exact contracted order, with the expected arguments', async () => {
    const { deps, calls } = baseDeps();
    const result = await runFirstInstall({ schemaPath: 'C:\\Studix\\backend\\prisma\\studix-schema.sql', deps });

    expect(result).toEqual({ status: 'installed', browserOpened: true });

    const order = calls.map((c) => c[0]);
    expect(order).toEqual([
      'provisionPostgres', 'ensureProductionConfig', 'loadEnvConfig', 'validateDatabaseUrl',
      'bootstrapDatabase', 'stopPostgres', 'registerPostgresService', 'startService',
      'registerAppService', 'startService', 'waitForHealth', 'openBrowser',
    ]);
  });

  it('writes the production config with the databaseUrl provisionPostgres returned', async () => {
    const { deps } = baseDeps();
    await runFirstInstall({ schemaPath: 'schema.sql', deps });
    expect(deps.ensureProductionConfigFn).toHaveBeenCalledWith({
      configPath: 'C:\\ProgramData\\Studix\\config\\.env',
      databaseUrl: 'postgresql://studix_admin:secret@127.0.0.1:55432/studix',
    });
  });

  it('passes the resolved schemaPath through to bootstrapDatabase', async () => {
    const { deps } = baseDeps();
    await runFirstInstall({ schemaPath: 'C:\\Studix\\backend\\prisma\\studix-schema.sql', deps });
    expect(deps.bootstrapDatabaseFn).toHaveBeenCalledWith({ schemaPath: 'C:\\Studix\\backend\\prisma\\studix-schema.sql' });
  });

  it('stops the ad-hoc PostgreSQL instance using the resolved pg_ctl path and data directory', async () => {
    const { deps } = baseDeps();
    await runFirstInstall({ schemaPath: 'schema.sql', deps });
    expect(deps.stopPostgresFn).toHaveBeenCalledWith({
      pgCtlPath: 'C:\\Studix\\pgsql\\bin\\pg_ctl.exe', dataDir: 'C:\\ProgramData\\Studix\\pgdata',
    });
  });

  it('registers/starts both services by name, in Postgres-then-app order', async () => {
    const { deps } = baseDeps();
    await runFirstInstall({ schemaPath: 'schema.sql', deps });
    expect(deps.registerPostgresServiceFn).toHaveBeenCalled();
    expect(deps.registerAppServiceFn).toHaveBeenCalled();
    const startCalls = deps.startServiceFn.mock.calls.map((c) => c[0]);
    expect(startCalls).toEqual(['StudixPostgreSQL', 'StudixApp']);
  });

  it('pins the app service registration to the packaged tools\\nssm.exe under the install root — never a bare PATH lookup', async () => {
    const { deps } = baseDeps();
    await runFirstInstall({ schemaPath: 'schema.sql', deps });
    expect(deps.registerAppServiceFn).toHaveBeenCalledWith({ nssmPath: 'C:\\Studix\\tools\\nssm.exe' });
  });

  it('polls health at the correct URL for the resolved port', async () => {
    const { deps } = baseDeps();
    await runFirstInstall({ schemaPath: 'schema.sql', port: 4000, deps });
    expect(deps.waitForHealthFn).toHaveBeenCalledWith(
      'http://127.0.0.1:4000/health',
      expect.objectContaining({ timeoutMs: expect.any(Number), intervalMs: expect.any(Number) })
    );
  });

  it('opens the browser at the localhost URL for the resolved port after health succeeds', async () => {
    const { deps } = baseDeps();
    await runFirstInstall({ schemaPath: 'schema.sql', port: 4000, deps });
    expect(deps.openBrowserFn).toHaveBeenCalledWith('http://localhost:4000/');
  });
});

describe('runFirstInstall — existing installation (provisionPostgres returns "already_initialized")', () => {
  it('never calls ensureProductionConfig — an existing SESSION_SECRET/DATABASE_URL is never touched', async () => {
    const { deps, calls } = baseDeps({
      provisionPostgresFn: vi.fn(async () => ({ status: 'already_initialized' })),
    });
    const result = await runFirstInstall({ schemaPath: 'schema.sql', deps });

    expect(result).toEqual({ status: 'installed', browserOpened: true });
    expect(deps.ensureProductionConfigFn).not.toHaveBeenCalled();
    expect(calls.map((c) => c[0])).not.toContain('ensureProductionConfig');
  });

  it('still runs every other step (bootstrap/stop/register/start/health/browser) on a re-run', async () => {
    const { deps } = baseDeps({
      provisionPostgresFn: vi.fn(async () => ({ status: 'already_initialized' })),
    });
    await runFirstInstall({ schemaPath: 'schema.sql', deps });
    expect(deps.bootstrapDatabaseFn).toHaveBeenCalled();
    expect(deps.stopPostgresFn).toHaveBeenCalled();
    expect(deps.registerPostgresServiceFn).toHaveBeenCalled();
    expect(deps.registerAppServiceFn).toHaveBeenCalled();
    expect(deps.startServiceFn).toHaveBeenCalledTimes(2);
    expect(deps.waitForHealthFn).toHaveBeenCalled();
    expect(deps.openBrowserFn).toHaveBeenCalled();
  });

  it('idempotent repeated runs against an already-installed system both succeed identically', async () => {
    const { deps } = baseDeps({
      provisionPostgresFn: vi.fn(async () => ({ status: 'already_initialized' })),
    });
    const first = await runFirstInstall({ schemaPath: 'schema.sql', deps });
    const second = await runFirstInstall({ schemaPath: 'schema.sql', deps });
    expect(first).toEqual(second);
    expect(deps.ensureProductionConfigFn).not.toHaveBeenCalled();
  });
});

describe('runFirstInstall — failure at each step stops immediately with a machine-readable .step', () => {
  it.each([
    ['provision_postgres', 'provisionPostgresFn', () => { throw new Error('pg down'); }],
    ['bootstrap_database', 'bootstrapDatabaseFn', () => { throw new Error('schema failed'); }],
    ['stop_adhoc_postgres', 'stopPostgresFn', () => { throw new Error('stop failed'); }],
    ['start_postgres_service', 'registerPostgresServiceFn', () => { throw new Error('register failed'); }],
    ['start_app_service', 'registerAppServiceFn', () => { throw new Error('nssm missing'); }],
  ])('%s', async (expectedStep, failingDep, impl) => {
    const { deps } = baseDeps({ [failingDep]: vi.fn(impl) });
    try {
      await runFirstInstall({ schemaPath: 'schema.sql', deps });
      expect.fail('expected runFirstInstall to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(FirstInstallError);
      expect(err.step).toBe(expectedStep);
    }
  });

  it('write_production_config failure stops before bootstrap ever runs', async () => {
    const { deps } = baseDeps({
      ensureProductionConfigFn: vi.fn(() => { throw new Error('disk full'); }),
    });
    await expect(runFirstInstall({ schemaPath: 'schema.sql', deps })).rejects.toMatchObject({ step: 'write_production_config' });
    expect(deps.bootstrapDatabaseFn).not.toHaveBeenCalled();
  });

  it('resolve_database_url failure (e.g. malformed DATABASE_URL) stops before bootstrap ever runs', async () => {
    const { deps } = baseDeps({
      validateDatabaseUrlFn: vi.fn(() => { throw new Error('malformed DATABASE_URL'); }),
    });
    await expect(runFirstInstall({ schemaPath: 'schema.sql', deps })).rejects.toMatchObject({ step: 'resolve_database_url' });
    expect(deps.bootstrapDatabaseFn).not.toHaveBeenCalled();
  });

  it('a failure partway through never reaches later steps (e.g. bootstrap failure never registers services)', async () => {
    const { deps } = baseDeps({
      bootstrapDatabaseFn: vi.fn(async () => { throw new Error('schema failed'); }),
    });
    await expect(runFirstInstall({ schemaPath: 'schema.sql', deps })).rejects.toThrow(FirstInstallError);
    expect(deps.stopPostgresFn).not.toHaveBeenCalled();
    expect(deps.registerPostgresServiceFn).not.toHaveBeenCalled();
    expect(deps.registerAppServiceFn).not.toHaveBeenCalled();
    expect(deps.waitForHealthFn).not.toHaveBeenCalled();
    expect(deps.openBrowserFn).not.toHaveBeenCalled();
  });

  it('wait_for_health timing out (waitForHealthFn resolves false) throws a clear, distinct error', async () => {
    const { deps } = baseDeps({
      waitForHealthFn: vi.fn(async () => false),
    });
    await expect(runFirstInstall({ schemaPath: 'schema.sql', deps })).rejects.toMatchObject({ step: 'wait_for_health' });
    expect(deps.openBrowserFn).not.toHaveBeenCalled();
  });
});

describe('runFirstInstall — browser-open failure is non-fatal (best-effort)', () => {
  it('a failed openBrowser call does not fail the overall installation, since health already succeeded', async () => {
    const { deps } = baseDeps({
      openBrowserFn: vi.fn(() => { throw new Error('no default browser configured'); }),
    });
    const result = await runFirstInstall({ schemaPath: 'schema.sql', deps });
    expect(result.status).toBe('installed');
    expect(result.browserOpened).toBe(false);
    expect(result.browserError).toContain('no default browser configured');
  });
});
