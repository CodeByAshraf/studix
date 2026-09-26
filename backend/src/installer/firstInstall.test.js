// backend/src/installer/firstInstall.test.js
// INSTALL-06/INSTALL-10 — pure, dependency-injected unit tests for the orchestrator's sequencing
// and branching logic. Every reused INSTALL-02/03/05/10 function is mocked at its own boundary
// (each already has its own full test coverage in its own module) — this file tests ONLY that
// runFirstInstall calls the right functions, in the right order, with the right arguments, and
// stops immediately on the first failure. Never touches a real PostgreSQL, a real Windows
// service, a real network request, or a real browser.
import { describe, it, expect, vi } from 'vitest';
import { runFirstInstall, FirstInstallError } from './firstInstall.js';
import { RestoreStateError } from '../db/restoreState.js';

const ADMIN_URL = 'postgresql://studix_admin:adminsecret@127.0.0.1:55432/studix';
const APP_URL = 'postgresql://studix_app:appsecret@127.0.0.1:55432/studix';

function baseDeps(overrides = {}) {
  const calls = [];
  const record = (name) => (...args) => { calls.push([name, ...args]); };
  const migrationClient = { $disconnect: vi.fn(async () => {}) };

  const deps = {
    provisionPostgresFn: vi.fn(async (...args) => { record('provisionPostgres')(...args); return { status: 'initialized', databaseUrl: ADMIN_URL, port: 55432 }; }),
    generatePostgresPasswordFn: vi.fn(() => 'deadbeef00'),
    ensureProvisioningAdminConfigFn: vi.fn((...args) => { record('ensureProvisioningAdminConfig')(...args); return { created: true }; }),
    readProvisioningAdminUrlFn: vi.fn((...args) => { record('readProvisioningAdminUrl')(...args); return ADMIN_URL; }),
    resolveProvisioningAdminConfigPathFn: vi.fn(() => 'C:\\ProgramData\\Studix\\config\\admin.env'),
    validateDatabaseUrlFn: vi.fn((...args) => { record('validateDatabaseUrl')(...args); }),
    bootstrapDatabaseFn: vi.fn(async (...args) => { record('bootstrapDatabase')(...args); return { action: 'schema_applied' }; }),
    createMigrationPrismaClientFn: vi.fn((...args) => { record('createMigrationPrismaClient')(...args); return migrationClient; }),
    runMigrationsFn: vi.fn(async (...args) => { record('runMigrations')(...args); return { action: 'up-to-date' }; }),
    backupFn: vi.fn(),
    ensureAppRoleFn: vi.fn(async (...args) => { record('ensureAppRole')(...args); return { status: 'created', appUser: 'studix_app', databaseUrl: APP_URL }; }),
    ensureProductionConfigFn: vi.fn((...args) => { record('ensureProductionConfig')(...args); return { created: true }; }),
    resolveProductionConfigPathFn: vi.fn(() => 'C:\\ProgramData\\Studix\\config\\.env'),
    stopPostgresFn: vi.fn((...args) => { record('stopPostgres')(...args); }),
    resolvePgHomeFn: vi.fn(() => 'C:\\Studix\\pgsql'),
    resolvePgDataDirFn: vi.fn(() => 'C:\\ProgramData\\Studix\\pgdata'),
    locatePgBinariesFn: vi.fn(() => ({ pg_ctl: 'C:\\Studix\\pgsql\\bin\\pg_ctl.exe' })),
    registerPostgresServiceFn: vi.fn((...args) => { record('registerPostgresService')(...args); return { status: 'registered' }; }),
    registerAppServiceFn: vi.fn((...args) => { record('registerAppService')(...args); return { status: 'registered' }; }),
    startServiceFn: vi.fn((...args) => { record('startService')(...args); return { status: 'started' }; }),
    registerScheduledTaskFn: vi.fn((...args) => { record('registerScheduledTask')(...args); return { status: 'created' }; }),
    readRestoreStateFn: vi.fn((...args) => { record('readRestoreState')(...args); return { status: 'idle' }; }),
    resolveInstallRootFn: vi.fn(() => 'C:\\Studix'),
    waitForHealthFn: vi.fn(async (...args) => { record('waitForHealth')(...args); return true; }),
    openBrowserFn: vi.fn((...args) => { record('openBrowser')(...args); }),
    fetchImpl: vi.fn(),
    ...overrides,
  };
  return { deps, calls, migrationClient };
}

describe('runFirstInstall — wires the service-owned reuse dependency into provisionPostgres (upgrade lifecycle fix)', () => {
  it('passes io.isPostgresServiceOwnedFn and io.startPostgresServiceFn through to provisionPostgresFn, and startPostgresServiceFn delegates to startServiceFn(StudixPostgreSQL)', async () => {
    let capturedOpts;
    const { deps } = baseDeps({
      provisionPostgresFn: vi.fn(async (opts) => {
        capturedOpts = opts;
        return { status: 'initialized', databaseUrl: ADMIN_URL, port: 55432 };
      }),
    });

    await runFirstInstall({ schemaPath: 'schema.sql', deps });

    expect(typeof capturedOpts.io.isPostgresServiceOwnedFn).toBe('function');
    expect(typeof capturedOpts.io.startPostgresServiceFn).toBe('function');

    deps.startServiceFn.mockClear();
    capturedOpts.io.startPostgresServiceFn();
    expect(deps.startServiceFn).toHaveBeenCalledWith('StudixPostgreSQL');
  });

  // Phase 3B fix — Case C (reinstall/recovery over preserved pgdata with no registered
  // service): provisionPostgres's own registration-before-start logic needs a
  // registerPostgresServiceFn in its io, reusing the SAME dependency (deps.registerPostgresServiceFn)
  // step 8 already calls later — never a second, separate registration mechanism.
  it('passes io.registerPostgresServiceFn through to provisionPostgresFn, delegating to the same registerPostgresServiceFn used at step 8 (no duplicated registration mechanism)', async () => {
    let capturedOpts;
    const { deps } = baseDeps({
      provisionPostgresFn: vi.fn(async (opts) => {
        capturedOpts = opts;
        return { status: 'initialized', databaseUrl: ADMIN_URL, port: 55432 };
      }),
    });

    await runFirstInstall({ schemaPath: 'schema.sql', deps });

    expect(typeof capturedOpts.io.registerPostgresServiceFn).toBe('function');

    deps.registerPostgresServiceFn.mockClear();
    capturedOpts.io.registerPostgresServiceFn();
    expect(deps.registerPostgresServiceFn).toHaveBeenCalledTimes(1);
  });

  // Code-review finding (Category B): step 7 below (`stopPostgresFn`) was written before the
  // service-owned reuse branch existed and still describes itself purely in terms of "the
  // ad-hoc instance" — it was never revisited to ask whether stopping still makes sense once
  // PostgreSQL might have just been started THROUGH the Windows service instead. This documents
  // the current, ACTUAL behavior precisely rather than leaving it merely assumed.
  //
  // provisionPostgres()'s return shape is IDENTICAL for its ad-hoc-start (Case B) and
  // service-owned-start (Case C) reuse branches — both return plain
  // { status: 'already_initialized', port, pgDataDir, database }. runFirstInstall has NO
  // signal at this call site telling it which path was taken, and — as asserted below — makes
  // none: step 7 issues a direct `pg_ctl stop` unconditionally, identically, either way.
  //
  // What this proves (a real, load-bearing fact about the current code, not an artifact of
  // mocking): step 7 always runs, immediately after provisionPostgres, with the exact same
  // resolved pgCtlPath/dataDir, whether or not the just-completed reuse was service-owned.
  // What this CANNOT prove, and no mock-based unit test can: whether a real `pg_ctl stop`,
  // run under the installer's own identity, actually succeeds against a postgres.exe a Windows
  // service started as LocalSystem — that is a genuine OS/process-identity question. The only
  // evidence for that today is empirical (a real Phase 3B E2E reinstall exercised exactly this
  // sequence — StudixPostgreSQL already registered and running pre-upgrade — and completed
  // successfully end to end). Closing that gap for real would need a real, elevated integration
  // test (e.g. extending postgresProvisioning.integration.test.js's own "upgrade lifecycle
  // proof" describe block to call stopPostgresFn/pg_ctl stop after its real service-owned start
  // and assert it succeeds) — deliberately out of scope here.
  describe('step 7 (stopPostgresFn) after a service-owned reuse — documents current behavior, does not prove OS-level safety', () => {
    it('still calls stopPostgresFn with the resolved pg_ctl path/data dir, immediately after provisionPostgres, with no special-casing for a service-owned reuse', async () => {
      const { deps, calls } = baseDeps({
        // Deliberately the same return shape provisionPostgres() actually produces for BOTH
        // its ad-hoc and service-owned reuse branches (see comment above) — from
        // runFirstInstall's own point of view, this IS what a service-owned reuse looks like.
        provisionPostgresFn: vi.fn(async () => ({ status: 'already_initialized', port: 55432 })),
      });

      await runFirstInstall({ schemaPath: 'schema.sql', deps });

      expect(deps.stopPostgresFn).toHaveBeenCalledWith({
        pgCtlPath: 'C:\\Studix\\pgsql\\bin\\pg_ctl.exe', dataDir: 'C:\\ProgramData\\Studix\\pgdata',
      });
      const order = calls.map((c) => c[0]);
      expect(order.indexOf('provisionPostgres')).toBeLessThan(order.indexOf('stopPostgres'));
    });
  });
});

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
      'provisionPostgres', 'ensureProvisioningAdminConfig', 'validateDatabaseUrl',
      'bootstrapDatabase', 'createMigrationPrismaClient', 'runMigrations', 'ensureAppRole',
      'ensureProductionConfig', 'stopPostgres', 'registerPostgresService', 'startService',
      'registerAppService', 'readRestoreState', 'startService', 'registerScheduledTask', 'waitForHealth', 'openBrowser',
    ]);
  });

  it('persists the admin connection using the databaseUrl provisionPostgres returned, never reading it back on a fresh init', async () => {
    const { deps } = baseDeps();
    await runFirstInstall({ schemaPath: 'schema.sql', deps });
    expect(deps.ensureProvisioningAdminConfigFn).toHaveBeenCalledWith({
      configPath: 'C:\\ProgramData\\Studix\\config\\admin.env', databaseUrl: ADMIN_URL,
    });
    expect(deps.readProvisioningAdminUrlFn).not.toHaveBeenCalled();
    expect(deps.validateDatabaseUrlFn).toHaveBeenCalledWith(ADMIN_URL);
  });

  it('passes the resolved schemaPath and admin databaseUrl through to bootstrapDatabase — never the app URL', async () => {
    const { deps } = baseDeps();
    await runFirstInstall({ schemaPath: 'C:\\Studix\\backend\\prisma\\studix-schema.sql', deps });
    expect(deps.bootstrapDatabaseFn).toHaveBeenCalledWith({
      databaseUrl: ADMIN_URL, schemaPath: 'C:\\Studix\\backend\\prisma\\studix-schema.sql',
    });
  });

  it('runs migrations over a dedicated admin-rooted client, then disconnects it', async () => {
    const { deps, migrationClient } = baseDeps();
    await runFirstInstall({ schemaPath: 'schema.sql', deps });
    expect(deps.createMigrationPrismaClientFn).toHaveBeenCalledWith(ADMIN_URL);
    expect(deps.runMigrationsFn).toHaveBeenCalledWith(migrationClient, { databaseUrl: ADMIN_URL, backup: deps.backupFn });
    expect(migrationClient.$disconnect).toHaveBeenCalled();
  });

  it('generates a fresh candidate password and calls ensureAppRole with it and the resolved port, over the admin connection', async () => {
    const { deps } = baseDeps();
    await runFirstInstall({ schemaPath: 'schema.sql', deps });
    expect(deps.generatePostgresPasswordFn).toHaveBeenCalled();
    expect(deps.ensureAppRoleFn).toHaveBeenCalledWith(ADMIN_URL, { appPassword: 'deadbeef00', port: 55432 });
  });

  it('writes the production config with the RESTRICTED app databaseUrl ensureAppRole returned, never the admin one', async () => {
    const { deps } = baseDeps();
    await runFirstInstall({ schemaPath: 'schema.sql', deps });
    expect(deps.ensureProductionConfigFn).toHaveBeenCalledWith({
      configPath: 'C:\\ProgramData\\Studix\\config\\.env', databaseUrl: APP_URL,
    });
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

  it('checks restore-state.json after registering the app service, before deciding whether to start it', async () => {
    const { deps, calls } = baseDeps();
    await runFirstInstall({ schemaPath: 'schema.sql', deps });
    const order = calls.map((c) => c[0]);
    expect(order.indexOf('registerAppService')).toBeLessThan(order.indexOf('readRestoreState'));
    expect(order.indexOf('readRestoreState')).toBeLessThan(order.lastIndexOf('startService'));
  });

  it('registers/corrects the boot-time Scheduled Task after both services are registered/started, and before the health check', async () => {
    const { deps, calls } = baseDeps();
    await runFirstInstall({ schemaPath: 'schema.sql', deps });
    expect(deps.registerScheduledTaskFn).toHaveBeenCalledWith();
    const order = calls.map((c) => c[0]);
    expect(order.indexOf('registerAppService')).toBeLessThan(order.indexOf('registerScheduledTask'));
    expect(order.indexOf('registerScheduledTask')).toBeLessThan(order.indexOf('waitForHealth'));
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
  it('reads the admin connection back from the separate admin config instead of persisting a new one', async () => {
    const { deps, calls } = baseDeps({
      provisionPostgresFn: vi.fn(async () => ({ status: 'already_initialized', port: 55432 })),
    });
    const result = await runFirstInstall({ schemaPath: 'schema.sql', deps });

    expect(result).toEqual({ status: 'installed', browserOpened: true });
    expect(deps.readProvisioningAdminUrlFn).toHaveBeenCalledWith({ configPath: 'C:\\ProgramData\\Studix\\config\\admin.env' });
    expect(deps.ensureProvisioningAdminConfigFn).not.toHaveBeenCalled();
    expect(calls.map((c) => c[0])).not.toContain('ensureProvisioningAdminConfig');
  });

  it('never calls ensureProductionConfig when ensureAppRole reports the role already existed — an existing SESSION_SECRET/DATABASE_URL is never touched', async () => {
    const { deps } = baseDeps({
      provisionPostgresFn: vi.fn(async () => ({ status: 'already_initialized', port: 55432 })),
      ensureAppRoleFn: vi.fn(async () => ({ status: 'already_exists', appUser: 'studix_app' })),
    });
    await runFirstInstall({ schemaPath: 'schema.sql', deps });
    expect(deps.ensureProductionConfigFn).not.toHaveBeenCalled();
  });

  it('still runs every other step (bootstrap/migrate/role/stop/register/start/health/browser) on a re-run', async () => {
    const { deps } = baseDeps({
      provisionPostgresFn: vi.fn(async () => ({ status: 'already_initialized', port: 55432 })),
      ensureAppRoleFn: vi.fn(async () => ({ status: 'already_exists', appUser: 'studix_app' })),
    });
    await runFirstInstall({ schemaPath: 'schema.sql', deps });
    expect(deps.bootstrapDatabaseFn).toHaveBeenCalled();
    expect(deps.runMigrationsFn).toHaveBeenCalled();
    expect(deps.ensureAppRoleFn).toHaveBeenCalled();
    expect(deps.stopPostgresFn).toHaveBeenCalled();
    expect(deps.registerPostgresServiceFn).toHaveBeenCalled();
    expect(deps.registerAppServiceFn).toHaveBeenCalled();
    expect(deps.startServiceFn).toHaveBeenCalledTimes(2);
    expect(deps.registerScheduledTaskFn).toHaveBeenCalled();
    expect(deps.waitForHealthFn).toHaveBeenCalled();
    expect(deps.openBrowserFn).toHaveBeenCalled();
  });

  it('a partial-failure recovery (cluster already existed, app role did not yet) still writes the production config on the run that finally creates the role', async () => {
    const { deps } = baseDeps({
      provisionPostgresFn: vi.fn(async () => ({ status: 'already_initialized', port: 55432 })),
      ensureAppRoleFn: vi.fn(async () => ({ status: 'created', appUser: 'studix_app', databaseUrl: APP_URL })),
    });
    await runFirstInstall({ schemaPath: 'schema.sql', deps });
    expect(deps.ensureProductionConfigFn).toHaveBeenCalledWith(
      expect.objectContaining({ databaseUrl: APP_URL })
    );
  });

  it('idempotent repeated runs against an already-installed system both succeed identically', async () => {
    const { deps } = baseDeps({
      provisionPostgresFn: vi.fn(async () => ({ status: 'already_initialized', port: 55432 })),
      ensureAppRoleFn: vi.fn(async () => ({ status: 'already_exists', appUser: 'studix_app' })),
    });
    const first = await runFirstInstall({ schemaPath: 'schema.sql', deps });
    const second = await runFirstInstall({ schemaPath: 'schema.sql', deps });
    expect(first).toEqual(second);
    expect(deps.ensureProductionConfigFn).not.toHaveBeenCalled();
  });
});

describe('runFirstInstall — resolving the admin connection fails closed, never guesses', () => {
  it('a missing admin file against an already-initialized cluster throws resolve_admin_connection before bootstrap ever runs', async () => {
    const { deps } = baseDeps({
      provisionPostgresFn: vi.fn(async () => ({ status: 'already_initialized', port: 55432 })),
      readProvisioningAdminUrlFn: vi.fn(() => null),
    });
    await expect(runFirstInstall({ schemaPath: 'schema.sql', deps })).rejects.toMatchObject({ step: 'resolve_admin_connection' });
    expect(deps.bootstrapDatabaseFn).not.toHaveBeenCalled();
  });

  it('a malformed admin URL (validateDatabaseUrl throws) stops before bootstrap ever runs', async () => {
    const { deps } = baseDeps({
      validateDatabaseUrlFn: vi.fn(() => { throw new Error('malformed admin URL'); }),
    });
    await expect(runFirstInstall({ schemaPath: 'schema.sql', deps })).rejects.toMatchObject({ step: 'resolve_admin_connection' });
    expect(deps.bootstrapDatabaseFn).not.toHaveBeenCalled();
  });
});

describe('runFirstInstall — failure at each step stops immediately with a machine-readable .step', () => {
  it.each([
    ['provision_postgres', 'provisionPostgresFn', () => { throw new Error('pg down'); }],
    ['bootstrap_database', 'bootstrapDatabaseFn', () => { throw new Error('schema failed'); }],
    ['ensure_app_role', 'ensureAppRoleFn', () => { throw new Error('grant failed'); }],
    ['stop_adhoc_postgres', 'stopPostgresFn', () => { throw new Error('stop failed'); }],
    ['start_postgres_service', 'registerPostgresServiceFn', () => { throw new Error('register failed'); }],
    ['start_app_service', 'registerAppServiceFn', () => { throw new Error('nssm missing'); }],
    ['register_scheduled_task', 'registerScheduledTaskFn', () => { throw new Error('schtasks access denied'); }],
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

  it('run_migrations failure stops with step "run_migrations" but still disconnects the migration client', async () => {
    const { deps, migrationClient } = baseDeps({
      runMigrationsFn: vi.fn(async () => { throw new Error('migration failed'); }),
    });
    await expect(runFirstInstall({ schemaPath: 'schema.sql', deps })).rejects.toMatchObject({ step: 'run_migrations' });
    expect(migrationClient.$disconnect).toHaveBeenCalled();
    expect(deps.ensureAppRoleFn).not.toHaveBeenCalled();
  });

  it('write_production_config failure stops before the ad-hoc instance is stopped', async () => {
    const { deps } = baseDeps({
      ensureProductionConfigFn: vi.fn(() => { throw new Error('disk full'); }),
    });
    await expect(runFirstInstall({ schemaPath: 'schema.sql', deps })).rejects.toMatchObject({ step: 'write_production_config' });
    expect(deps.stopPostgresFn).not.toHaveBeenCalled();
  });

  it('a failure partway through never reaches later steps (e.g. bootstrap failure never runs migrations or registers services)', async () => {
    const { deps } = baseDeps({
      bootstrapDatabaseFn: vi.fn(async () => { throw new Error('schema failed'); }),
    });
    await expect(runFirstInstall({ schemaPath: 'schema.sql', deps })).rejects.toThrow(FirstInstallError);
    expect(deps.runMigrationsFn).not.toHaveBeenCalled();
    expect(deps.ensureAppRoleFn).not.toHaveBeenCalled();
    expect(deps.stopPostgresFn).not.toHaveBeenCalled();
    expect(deps.registerPostgresServiceFn).not.toHaveBeenCalled();
    expect(deps.registerAppServiceFn).not.toHaveBeenCalled();
    expect(deps.registerScheduledTaskFn).not.toHaveBeenCalled();
    expect(deps.waitForHealthFn).not.toHaveBeenCalled();
    expect(deps.openBrowserFn).not.toHaveBeenCalled();
  });

  it('a registration failure in the Scheduled Task step stops before the health check ever runs', async () => {
    const { deps } = baseDeps({
      registerScheduledTaskFn: vi.fn(() => { throw new Error('schtasks access denied'); }),
    });
    await expect(runFirstInstall({ schemaPath: 'schema.sql', deps })).rejects.toMatchObject({ step: 'register_scheduled_task' });
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

// Final pre-build audit — Issue B fix: never start StudixApp directly while restore-state.json
// reports an in-flight database switch/rollback. Reuses readRestoreState() (db/restoreState.js)
// completely unmodified — this describe block never touches the state machine itself, only
// proves runFirstInstall's own new branch on top of it.
describe('runFirstInstall — restore-state guard before starting StudixApp (audit Issue B)', () => {
  it.each([
    ['idle'],
    ['active'],
    ['rolled_back'],
    ['failed'],
    // Not explicitly required by the audit's list, but included to lock in the deliberate
    // denylist design (only switching/rolling_back block a start) rather than an allowlist —
    // these three never touch the production database's identity, so they must stay safe too.
    ['preparing'],
    ['restoring'],
    ['verified'],
  ])('status "%s" -> StudixApp starts normally', async (status) => {
    const { deps } = baseDeps({
      readRestoreStateFn: vi.fn(() => ({ status })),
    });
    const result = await runFirstInstall({ schemaPath: 'schema.sql', deps });
    expect(deps.startServiceFn).toHaveBeenCalledWith('StudixApp');
    expect(result).toEqual({ status: 'installed', browserOpened: true });
  });

  it.each([
    ['switching'],
    ['rolling_back'],
  ])('status "%s" -> StudixApp does NOT start, and this is not reported as a FirstInstallError', async (status) => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { deps } = baseDeps({
      readRestoreStateFn: vi.fn(() => ({ status })),
      // The health poll would otherwise time out for real (the app genuinely never started) —
      // stubbed here purely so this test isolates the guard's own behavior, not the unrelated
      // health-timeout path (covered separately elsewhere in this file).
      waitForHealthFn: vi.fn(async () => true),
    });
    const result = await runFirstInstall({ schemaPath: 'schema.sql', deps });
    expect(deps.startServiceFn).not.toHaveBeenCalledWith('StudixApp');
    expect(deps.startServiceFn).toHaveBeenCalledWith('StudixPostgreSQL'); // Postgres start is unaffected
    expect(result.status).toBe('installed');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(status));
    warnSpy.mockRestore();
  });

  it('a corrupt/invalid restore-state.json (RestoreStateError) fails closed with a distinct, clear step — never silently starts the app', async () => {
    const { deps } = baseDeps({
      readRestoreStateFn: vi.fn(() => { throw new RestoreStateError('corrupt_state', 'ملف حالة الاستعادة تالف.'); }),
    });
    await expect(runFirstInstall({ schemaPath: 'schema.sql', deps })).rejects.toMatchObject({
      step: 'check_restore_state_before_app_start',
    });
    expect(deps.startServiceFn).not.toHaveBeenCalledWith('StudixApp');
  });

  it('an unexpected (non-RestoreStateError) error from readRestoreStateFn propagates unwrapped, never masked as a normal step failure', async () => {
    const { deps } = baseDeps({
      readRestoreStateFn: vi.fn(() => { throw new Error('unexpected disk failure'); }),
    });
    await expect(runFirstInstall({ schemaPath: 'schema.sql', deps })).rejects.toThrow('unexpected disk failure');
    await expect(runFirstInstall({ schemaPath: 'schema.sql', deps })).rejects.not.toBeInstanceOf(FirstInstallError);
  });

  it('the guard runs after registerAppService and before the app startService call, without disturbing any other step order', async () => {
    const { deps, calls } = baseDeps();
    await runFirstInstall({ schemaPath: 'schema.sql', deps });
    const order = calls.map((c) => c[0]);
    expect(order).toEqual([
      'provisionPostgres', 'ensureProvisioningAdminConfig', 'validateDatabaseUrl',
      'bootstrapDatabase', 'createMigrationPrismaClient', 'runMigrations', 'ensureAppRole',
      'ensureProductionConfig', 'stopPostgres', 'registerPostgresService', 'startService',
      'registerAppService', 'readRestoreState', 'startService', 'registerScheduledTask',
      'waitForHealth', 'openBrowser',
    ]);
  });

  it('the pre-existing upgrade-lifecycle fix (provisionPostgres io wiring for service-owned reuse) remains intact alongside this guard', async () => {
    let capturedOpts;
    const { deps } = baseDeps({
      provisionPostgresFn: vi.fn(async (opts) => {
        capturedOpts = opts;
        return { status: 'initialized', databaseUrl: ADMIN_URL, port: 55432 };
      }),
    });
    await runFirstInstall({ schemaPath: 'schema.sql', deps });
    expect(typeof capturedOpts.io.isPostgresServiceOwnedFn).toBe('function');
    expect(typeof capturedOpts.io.registerPostgresServiceFn).toBe('function');
    expect(typeof capturedOpts.io.startPostgresServiceFn).toBe('function');
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
