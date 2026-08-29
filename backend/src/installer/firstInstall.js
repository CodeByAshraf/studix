// backend/src/installer/firstInstall.js
// ─────────────────────────────────────────────────────────────
// INSTALL-06 — the single testable first-install/upgrade orchestrator. This is glue code, not
// a reusable library primitive: it sequences already-committed, already-independently-tested
// functions from INSTALL-02/03/04/05 in the exact order specified by the approved INSTALL-06
// design (migration/reports/INSTALL-06_INSTALLER_DESIGN.md) — it never reimplements any of
// their logic.
//
//   provisionPostgres()
//   -> if newly initialized: ensureProductionConfig({ databaseUrl })
//   -> bootstrapDatabase()                         (schema + migrations, existing/unmodified)
//   -> stopPostgres()                              (hand off the ad-hoc instance)
//   -> register + start the PostgreSQL service
//   -> register + start the Studix application service
//   -> poll GET /health until 200
//   -> open the default browser
//
// Idempotent by construction, not by any new logic here: every step reused above is already
// individually idempotent/fail-closed (INSTALL-02's ensureProductionConfig never rewrites an
// existing SESSION_SECRET/DATABASE_URL; INSTALL-03's provisionPostgres never re-initdbs an
// initialized data directory; INSTALL-05's register*Service functions verify-before-trusting an
// already-registered service). Re-running this orchestrator on an existing installation is
// therefore always safe — see the design doc for the full trace. On any step's failure, this
// throws immediately with a machine-readable `.step` and stops — no custom rollback of already-
// completed steps is attempted (design doc's explicit "idempotency-first, not custom rollback"
// decision); a subsequent re-run safely resumes.
//
// Never creates or decides anything about the first admin — that remains entirely INSTALL-04's
// /setup flow's responsibility, exercised by the operator through the browser this orchestrator
// opens at the very end.
// ─────────────────────────────────────────────────────────────
import path from 'path';
import { execFileSync } from 'child_process';
import {
  provisionPostgres, stopPostgres, resolvePgHome, resolvePgDataDir, locatePgBinaries,
} from '../db/postgresProvisioning.js';
import { bootstrapDatabase } from '../db/bootstrapDatabase.js';
import { ensureProductionConfig } from '../lib/productionConfig.js';
import { resolveProductionConfigPath, loadEnvConfig } from '../lib/config.js';
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

// runFirstInstall: the single entry point. `deps` is a full dependency-injection surface —
// every external call this function makes (each reused INSTALL-02/03/05 function, the health
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
    ensureProductionConfigFn = ensureProductionConfig,
    resolveProductionConfigPathFn = resolveProductionConfigPath,
    loadEnvConfigFn = loadEnvConfig,
    validateDatabaseUrlFn = validateDatabaseUrl,
    bootstrapDatabaseFn = bootstrapDatabase,
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

  // 1. PostgreSQL provisioning — idempotent; guarantees PostgreSQL is running (ad-hoc-started,
  // or already running) by the time it returns successfully, on both fresh installs and re-runs.
  let pg;
  try {
    pg = await provisionPostgresFn();
  } catch (err) {
    throw new FirstInstallError('provision_postgres', err);
  }

  // 2. Production config — DATABASE_URL is only ever written at file-creation time
  // (ensureProductionConfig's own idempotency contract, untouched here). provisionPostgres only
  // returns a databaseUrl on a genuinely fresh init, so this is skipped entirely on every
  // subsequent run — an existing config's SESSION_SECRET/DATABASE_URL are never touched.
  if (pg.status === 'initialized') {
    try {
      ensureProductionConfigFn({ configPath: resolveProductionConfigPathFn(), databaseUrl: pg.databaseUrl });
    } catch (err) {
      throw new FirstInstallError('write_production_config', err);
    }
  }

  // Populate process.env.DATABASE_URL from the production config file — needed whether this run
  // just wrote it above, or it already existed from a prior run. Reuses lib/config.js's own
  // exported loadEnvConfig(), not a reimplementation of its precedence logic.
  try {
    loadEnvConfigFn();
    validateDatabaseUrlFn(process.env.DATABASE_URL);
  } catch (err) {
    throw new FirstInstallError('resolve_database_url', err);
  }

  // 3. Schema bootstrap + incremental migrations — reuses the existing, unmodified
  // db/bootstrapDatabase.js exactly as scripts/bootstrapDatabase.js already does.
  try {
    await bootstrapDatabaseFn({ schemaPath });
  } catch (err) {
    throw new FirstInstallError('bootstrap_database', err);
  }

  // 4. Stop the ad-hoc instance provisionPostgres() guarantees is running, before handing the
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

  // 5–6. PostgreSQL service — register/start are each independently idempotent.
  try {
    registerPostgresServiceFn();
    startServiceFn(STUDIX_POSTGRES_SERVICE_NAME);
  } catch (err) {
    throw new FirstInstallError('start_postgres_service', err);
  }

  // 7–8. Studix application service. nssmPath is pinned explicitly to the packaged
  // tools\nssm.exe under the install root — never a bare "nssm.exe" PATH lookup, so this never
  // depends on a globally installed NSSM (decision #3).
  try {
    const nssmPath = path.join(resolveInstallRootFn(), 'tools', 'nssm.exe');
    registerAppServiceFn({ nssmPath });
    startServiceFn(STUDIX_APP_SERVICE_NAME);
  } catch (err) {
    throw new FirstInstallError('start_app_service', err);
  }

  // 9. Wait for /health.
  const healthUrl = `http://127.0.0.1:${port}/health`;
  const healthy = await waitForHealthFn(healthUrl, { timeoutMs: healthTimeoutMs, intervalMs: healthIntervalMs, fetchImpl });
  if (!healthy) {
    throw new FirstInstallError('wait_for_health', new Error(`لم يستجب ${healthUrl} خلال ${healthTimeoutMs}ms.`));
  }

  // 10. Open the default browser — best-effort. The installation itself already succeeded
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
