// backend/src/installer/firstInstall.js
// ─────────────────────────────────────────────────────────────
// INSTALL-06 — the single testable first-install/upgrade orchestrator. This is glue code, not
// a reusable library primitive: it sequences already-committed, already-independently-tested
// functions from INSTALL-02/03/04/05 in the exact order specified by the approved INSTALL-06
// design (migration/reports/INSTALL-06_INSTALLER_DESIGN.md) — it never reimplements any of
// their logic.
//
// INSTALL-10 — least-privilege database roles (see
// migration/reports/INSTALL-10_LEAST_PRIVILEGE_APP_ROLE.md for the full design/decisions
// D1-OD3/R1). Migration EXECUTION moved here entirely — server.js no longer applies migrations
// itself, only verifies freshness read-only (db/migrationRunner.js's checkMigrationsUpToDate).
// Every DDL-capable step below (bootstrap, migrations, role/grant setup) now runs over the
// studix_admin (provisioning) connection, resolved via a SEPARATE, ACL-protected file
// (lib/provisioningAdminConfig.js) that server.js/the running application never reads. The
// runtime production config (lib/productionConfig.js, unchanged) now only ever receives the
// restricted studix_app connection string.
//
//   provisionPostgres()
//   -> resolve/persist the studix_admin (provisioning) connection — separate admin-only file
//   -> bootstrapDatabase()                          (schema, existing/unmodified internals)
//   -> runMigrations()                              (moved here from server.js — INSTALL-10)
//   -> ensureAppRole()                               (creates/grants the restricted studix_app role)
//   -> ensureProductionConfig({ databaseUrl: <studix_app URL> })   (only on first role creation)
//   -> stopPostgres()                                (hand off the ad-hoc instance)
//   -> register + start the PostgreSQL service
//   -> register + start the Studix application service
//   -> poll GET /health until 200
//   -> open the default browser
//
// Idempotent by construction, not by any new logic here: every step reused above is already
// individually idempotent/fail-closed (INSTALL-02's ensureProductionConfig never rewrites an
// existing SESSION_SECRET/DATABASE_URL; INSTALL-03's provisionPostgres never re-initdbs an
// initialized data directory; INSTALL-05's register*Service functions verify-before-trusting an
// already-registered service; INSTALL-10's ensureAppRole never rotates an existing role's
// password). Re-running this orchestrator on an existing installation is therefore always safe.
// On any step's failure, this throws immediately with a machine-readable `.step` and stops — no
// custom rollback of already-completed steps is attempted (design doc's explicit
// "idempotency-first, not custom rollback" decision); a subsequent re-run safely resumes.
//
// No backward-compatibility path exists for a cluster that was already initialized by a
// PRE-INSTALL-10 build (single studix_admin-only architecture, no separate admin file) — this
// installer has never shipped a real release yet (installer/studix.iss's AppId is still the
// literal placeholder GUID), so no real installation in that shape can exist. If the admin file
// is ever missing against an already-initialized cluster, this fails closed with a clear error
// rather than guessing which credential to use.
//
// Never creates or decides anything about the first admin — that remains entirely INSTALL-04's
// /setup flow's responsibility, exercised by the operator through the browser this orchestrator
// opens at the very end.
// ─────────────────────────────────────────────────────────────
import path from 'path';
import { execFileSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import {
  provisionPostgres, stopPostgres, resolvePgHome, resolvePgDataDir, locatePgBinaries,
  generatePostgresPassword,
} from '../db/postgresProvisioning.js';
import { bootstrapDatabase, ensureAppRole } from '../db/bootstrapDatabase.js';
import { runMigrations } from '../db/migrationRunner.js';
import { createPreMigrationBackup } from '../db/backup.js';
import { ensureProductionConfig } from '../lib/productionConfig.js';
import { resolveProductionConfigPath } from '../lib/config.js';
import {
  ensureProvisioningAdminConfig, readProvisioningAdminUrl, resolveProvisioningAdminConfigPath,
} from '../lib/provisioningAdminConfig.js';
import { validateDatabaseUrl } from '../lib/startupErrors.js';
import {
  registerPostgresService, registerAppService, startService,
  resolveInstallRoot, STUDIX_POSTGRES_SERVICE_NAME, STUDIX_APP_SERVICE_NAME,
} from '../lib/windowsService.js';

export class FirstInstallError extends Error {
  constructor(step, cause) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`فشلت خطوة التثبيت "${step}": ${causeMessage}`);
    this.step = step;
    this.cause = cause;
  }
}

const DEFAULT_HEALTH_TIMEOUT_MS = 60_000;
const DEFAULT_HEALTH_INTERVAL_MS = 1_000;

// defaultOpenBrowser: `cmd /c start <url>` — the standard, documented way to open a URL in the
// user's default browser from a Windows console process. Passed as a plain execFileSync argv
// element (no shell string concatenation), so the well-known "start treats a quoted first arg
// as a window title" quirk does not apply here — nothing here is quoted.
function defaultOpenBrowser(url) {
  execFileSync('cmd.exe', ['/c', 'start', url], { stdio: 'ignore' });
}

async function defaultWaitForHealth(url, { timeoutMs, intervalMs, fetchImpl }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetchImpl(url);
      if (res.ok) return true;
    } catch {
      // Not up yet (connection refused, service still starting, ...) — keep polling.
    }
    if (Date.now() >= deadline) return false;
    // eslint-disable-next-line no-await-in-loop -- deliberate poll loop
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// defaultCreateMigrationPrismaClient: a dedicated, short-lived admin-rooted client used ONLY for
// the migration step below — never server.js's own runtime `prisma` singleton (which server.js
// no longer even imports migrationRunner's write path for — see server.js's own INSTALL-10
// comment). Disconnected immediately after runMigrations finishes, success or failure.
function defaultCreateMigrationPrismaClient(url) {
  return new PrismaClient({ datasources: { db: { url } } });
}

// runFirstInstall: the single entry point. `deps` is a full dependency-injection surface —
// every external call this function makes (each reused INSTALL-02/03/05/10 function, the health
// poll, opening the browser) is overridable, so the entire sequencing/branching contract above
// is unit-testable without a real PostgreSQL, real Windows services, or a real browser.
export async function runFirstInstall({
  schemaPath,
  port = process.env.PORT || 4000,
  healthTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
  healthIntervalMs = DEFAULT_HEALTH_INTERVAL_MS,
  deps = {},
} = {}) {
  const {
    provisionPostgresFn = provisionPostgres,
    generatePostgresPasswordFn = generatePostgresPassword,
    ensureProvisioningAdminConfigFn = ensureProvisioningAdminConfig,
    readProvisioningAdminUrlFn = readProvisioningAdminUrl,
    resolveProvisioningAdminConfigPathFn = resolveProvisioningAdminConfigPath,
    validateDatabaseUrlFn = validateDatabaseUrl,
    bootstrapDatabaseFn = bootstrapDatabase,
    createMigrationPrismaClientFn = defaultCreateMigrationPrismaClient,
    runMigrationsFn = runMigrations,
    backupFn = createPreMigrationBackup,
    ensureAppRoleFn = ensureAppRole,
    ensureProductionConfigFn = ensureProductionConfig,
    resolveProductionConfigPathFn = resolveProductionConfigPath,
    stopPostgresFn = stopPostgres,
    resolvePgHomeFn = resolvePgHome,
    resolvePgDataDirFn = resolvePgDataDir,
    locatePgBinariesFn = locatePgBinaries,
    registerPostgresServiceFn = registerPostgresService,
    registerAppServiceFn = registerAppService,
    startServiceFn = startService,
    resolveInstallRootFn = resolveInstallRoot,
    waitForHealthFn = defaultWaitForHealth,
    openBrowserFn = defaultOpenBrowser,
    fetchImpl = globalThis.fetch,
  } = deps;

  if (!schemaPath) {
    throw new FirstInstallError('validate_input', new Error('schemaPath مطلوب (مسار studix-schema.sql).'));
  }

  // 1. PostgreSQL cluster provisioning — idempotent; guarantees PostgreSQL is running (ad-hoc-
  // started, or already running) by the time it returns successfully, on both fresh installs
  // and re-runs. On a genuinely fresh init, pg.databaseUrl is the freshly-created studix_admin
  // (provisioning) connection — INSTALL-10: no longer the app's own runtime connection.
  let pg;
  try {
    pg = await provisionPostgresFn();
  } catch (err) {
    throw new FirstInstallError('provision_postgres', err);
  }

  // 2. Resolve the studix_admin (provisioning) connection for THIS run, persisted separately
  // from the app's own runtime config so the running application never reads it (OD3). On a
  // fresh init, persist the freshly-returned value; on a re-run, read it back — provisionPostgres
  // never returns a databaseUrl once already initialized (the password isn't recoverable from
  // pgdata). See this file's header comment for why no old-architecture fallback exists here.
  let adminUrl;
  try {
    if (pg.status === 'initialized') {
      ensureProvisioningAdminConfigFn({ configPath: resolveProvisioningAdminConfigPathFn(), databaseUrl: pg.databaseUrl });
      adminUrl = pg.databaseUrl;
    } else {
      adminUrl = readProvisioningAdminUrlFn({ configPath: resolveProvisioningAdminConfigPathFn() });
    }
    if (!adminUrl) {
      throw new Error(
        'تعذّر تحديد اتصال الإدارة/التزويد (studix_admin) — عنقود PostgreSQL موجود بالفعل لكن ملف ' +
        'بيانات الاعتماد الإداري غائب. لا يمكن المتابعة تلقائياً؛ راجع الحالة يدوياً.'
      );
    }
    validateDatabaseUrlFn(adminUrl);
  } catch (err) {
    throw new FirstInstallError('resolve_admin_connection', err);
  }

  // 3. Schema bootstrap — INSTALL-10: always over the admin connection now. Existing,
  // unmodified internal logic (db/bootstrapDatabase.js) — only what's passed as databaseUrl
  // changed from the app's own URL to the admin one.
  try {
    await bootstrapDatabaseFn({ databaseUrl: adminUrl, schemaPath });
  } catch (err) {
    throw new FirstInstallError('bootstrap_database', err);
  }

  // 4. Incremental migrations — INSTALL-10: moved here from server.js. Locking, checksum-
  // tracking, destructive-statement protection, and backup-before-migration behavior
  // (db/migrationRunner.js) are completely unchanged — only the caller and the connection it
  // supplies changed, from server.js's own long-lived runtime `prisma` singleton to a dedicated,
  // short-lived admin-rooted client created and disconnected entirely within this one step.
  const migrationClient = createMigrationPrismaClientFn(adminUrl);
  try {
    await runMigrationsFn(migrationClient, { databaseUrl: adminUrl, backup: backupFn });
  } catch (err) {
    throw new FirstInstallError('run_migrations', err);
  } finally {
    await migrationClient.$disconnect().catch(() => {});
  }

  // 5. Least-privilege runtime role (INSTALL-10) — idempotent; a fresh CSPRNG candidate password
  // is always generated but only ever actually used the one time the role doesn't exist yet
  // (ensureAppRole never rotates an existing role's password). Re-applies the GRANT set every
  // run regardless, so tables added by step 4's migrations are always covered.
  let appRole;
  try {
    appRole = await ensureAppRoleFn(adminUrl, { appPassword: generatePostgresPasswordFn(), port: pg.port });
  } catch (err) {
    throw new FirstInstallError('ensure_app_role', err);
  }

  // 6. Runtime production config — DATABASE_URL is only ever written at file-creation time
  // (ensureProductionConfig's own idempotency contract, untouched here) and now always holds
  // the RESTRICTED studix_app connection, never the admin one. Gated on ensureAppRole's own
  // result (not on pg.status) so a partial-failure recovery — cluster already existed, but the
  // app role didn't yet — still writes the config correctly on the run that finally creates it.
  if (appRole.status === 'created') {
    try {
      ensureProductionConfigFn({ configPath: resolveProductionConfigPathFn(), databaseUrl: appRole.databaseUrl });
    } catch (err) {
      throw new FirstInstallError('write_production_config', err);
    }
  }

  // 7. Stop the ad-hoc instance provisionPostgres() guarantees is running, before handing the
  // same data directory to the SCM-managed service registered next (INSTALL-03's documented
  // handoff requirement).
  try {
    const pgHome = resolvePgHomeFn();
    const pgDataDir = resolvePgDataDirFn();
    const binaries = locatePgBinariesFn(pgHome);
    stopPostgresFn({ pgCtlPath: binaries.pg_ctl, dataDir: pgDataDir });
  } catch (err) {
    throw new FirstInstallError('stop_adhoc_postgres', err);
  }

  // 8–9. PostgreSQL service — register/start are each independently idempotent.
  try {
    registerPostgresServiceFn();
    startServiceFn(STUDIX_POSTGRES_SERVICE_NAME);
  } catch (err) {
    throw new FirstInstallError('start_postgres_service', err);
  }

  // 10–11. Studix application service. nssmPath is pinned explicitly to the packaged
  // tools\nssm.exe under the install root — never a bare "nssm.exe" PATH lookup, so this never
  // depends on a globally installed NSSM (decision #3).
  try {
    const nssmPath = path.join(resolveInstallRootFn(), 'tools', 'nssm.exe');
    registerAppServiceFn({ nssmPath });
    startServiceFn(STUDIX_APP_SERVICE_NAME);
  } catch (err) {
    throw new FirstInstallError('start_app_service', err);
  }

  // 12. Wait for /health.
  const healthUrl = `http://127.0.0.1:${port}/health`;
  const healthy = await waitForHealthFn(healthUrl, { timeoutMs: healthTimeoutMs, intervalMs: healthIntervalMs, fetchImpl });
  if (!healthy) {
    throw new FirstInstallError('wait_for_health', new Error(`لم يستجب ${healthUrl} خلال ${healthTimeoutMs}ms.`));
  }

  // 13. Open the default browser — best-effort. The installation itself already succeeded
  // (services running, health confirmed) by this point; failing to auto-open a browser is a
  // cosmetic inconvenience the operator can work around manually, never a reason to report an
  // otherwise-successful installation as failed.
  try {
    openBrowserFn(`http://localhost:${port}/`);
  } catch (err) {
    return { status: 'installed', browserOpened: false, browserError: err.message };
  }

  return { status: 'installed', browserOpened: true };
}
