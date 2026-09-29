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
//   lockDownDataRootAcl()                          (%ProgramData%\Studix -> Administrators + SYSTEM)
//   -> grantPgProvisioningAccess()                 (installing user: pgdata only, temporary)
//   -> provisionPostgres()
//   -> resolve/persist the studix_admin (provisioning) connection — separate admin-only file
//   -> bootstrapDatabase()                          (schema, existing/unmodified internals)
//   -> runMigrations()                              (moved here from server.js — INSTALL-10)
//   -> ensureAppRole()                               (creates/grants the restricted studix_app role)
//   -> ensureProductionConfig({ databaseUrl: <studix_app URL> })   (only on first role creation)
//   -> stopPostgres()                                (hand off the ad-hoc instance)
//   -> register + start the PostgreSQL service
//   -> restoreDataRootAcl()                          (temporary access removed; lockdown verified)
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
  generatePostgresPassword, isPortFree,
} from '../db/postgresProvisioning.js';
import { bootstrapDatabase, ensureAppRole } from '../db/bootstrapDatabase.js';
import { runMigrations } from '../db/migrationRunner.js';
import { createPreMigrationBackup } from '../db/backup.js';
import { ensureProductionConfig } from '../lib/productionConfig.js';
import { resolveProductionConfigPath } from '../lib/config.js';
import {
  ensureProvisioningAdminConfig, readProvisioningAdminUrl, resolveProvisioningAdminConfigPath,
} from '../lib/provisioningAdminConfig.js';
import { validateDatabaseUrl, describePortInUse } from '../lib/startupErrors.js';
import {
  registerPostgresService, registerAppService, startService, queryServiceState,
  resolveInstallRoot, isPostgresServiceRegisteredFor,
  STUDIX_POSTGRES_SERVICE_NAME, STUDIX_APP_SERVICE_NAME,
} from '../lib/windowsService.js';
import { ensureStartupTask, ensureBackupTask } from '../lib/scheduledTask.js';
import { readRestoreState, RestoreStateError } from '../db/restoreState.js';
import { provisionLicensingPublicKey } from '../lib/licensingTrustAnchor.js';
import { lockDownDataRootAcl, grantPgProvisioningAccess, restoreDataRootAcl } from './dataDirAcl.js';

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
//
// While the temporary pgdata provisioning access (step 0b) is in place, ANY failure first
// restores the final %ProgramData%\Studix ACL (lockdown + verification) before the error
// propagates. If that restore itself fails, the install fails with step 'restore_data_acl'
// (the original error is kept as .provisioningError) — never silently with a weaker ACL.
export async function runFirstInstall(options = {}) {
  const provisioningAccess = { active: false, restore: null };
  try {
    return await runFirstInstallSteps(options, provisioningAccess);
  } catch (err) {
    if (!provisioningAccess.active) throw err;
    provisioningAccess.active = false;
    try {
      provisioningAccess.restore();
    } catch (restoreErr) {
      const failure = new FirstInstallError('restore_data_acl', restoreErr);
      failure.provisioningError = err;
      throw failure;
    }
    throw err;
  }
}

async function runFirstInstallSteps({
  schemaPath,
  port = process.env.PORT || 4000,
  healthTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
  healthIntervalMs = DEFAULT_HEALTH_INTERVAL_MS,
  deps = {},
} = {}, provisioningAccess) {
  const {
    lockDownDataRootAclFn = lockDownDataRootAcl,
    grantPgProvisioningAccessFn = grantPgProvisioningAccess,
    restoreDataRootAclFn = restoreDataRootAcl,
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
    provisionLicensingPublicKeyFn = provisionLicensingPublicKey,
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
    queryServiceStateFn = queryServiceState,
    isPortFreeFn = isPortFree,
    registerScheduledTaskFn = ensureStartupTask,
    registerBackupTaskFn = ensureBackupTask,
    readRestoreStateFn = readRestoreState,
    isPostgresServiceOwnedFn = (pgDataDir) => isPostgresServiceRegisteredFor(pgDataDir),
    resolveInstallRootFn = resolveInstallRoot,
    waitForHealthFn = defaultWaitForHealth,
    openBrowserFn = defaultOpenBrowser,
    fetchImpl = globalThis.fetch,
  } = deps;

  if (!schemaPath) {
    throw new FirstInstallError('validate_input', new Error('schemaPath مطلوب (مسار studix-schema.sql).'));
  }

  // 0. Lock %ProgramData%\Studix down to Administrators + SYSTEM (installer/dataDirAcl.js) —
  // first, before initdb or any config/secret file is written on a fresh install, and on every
  // upgrade/re-run so an existing installation's inherited BUILTIN\Users access is removed.
  try {
    lockDownDataRootAclFn();
  } catch (err) {
    throw new FirstInstallError('lock_down_data_acl', err);
  }

  // 0b. Temporary PostgreSQL provisioning access (installer/dataDirAcl.js): initdb and the
  // ad-hoc pg_ctl start run with a restricted token WITHOUT the Administrators group, so under
  // the lockdown they could not touch pgdata at all. The installing user's SID gets full control
  // of pgdata ONLY (never config\, backups\, logs\ or the root) until step 9b removes it. Marked
  // active before the grant runs, so even a partially applied grant is cleaned up on failure.
  provisioningAccess.restore = () => restoreDataRootAclFn();
  provisioningAccess.active = true;
  try {
    grantPgProvisioningAccessFn({ pgDataDir: resolvePgDataDirFn() });
  } catch (err) {
    throw new FirstInstallError('grant_provisioning_access', err);
  }

  // 1. PostgreSQL cluster provisioning — idempotent; guarantees PostgreSQL is running (ad-hoc-
  // started, or already running) by the time it returns successfully, on both fresh installs
  // and re-runs. On a genuinely fresh init, pg.databaseUrl is the freshly-created studix_admin
  // (provisioning) connection — INSTALL-10: no longer the app's own runtime connection.
  let pg;
  try {
    // Upgrade-lifecycle fix (Option F using Option B): if a registered StudixPostgreSQL service
    // already owns this data directory (the common post-first-install state — e.g. an upgrade's
    // PrepareToInstall having just stopped it), provisionPostgres() must start PostgreSQL through
    // that service (SCM-owned, LocalSystem identity) rather than directly via elevated pg_ctl —
    // see postgresProvisioning.js's own comment on the Windows identity/ACL mismatch this closes.
    // startPostgresServiceFn reuses startServiceFn (the same injectable step 8-9 already use)
    // rather than calling windowsService.js's startService directly, so a test overriding
    // startServiceFn also controls this path.
    //
    // Phase 3B fix: registerPostgresServiceFn is the SAME function already injected/used at
    // step 8 below (registerPostgresServiceFn = registerPostgresService, called with no
    // arguments there too) — reused here unmodified, never a second registration mechanism.
    // Wiring it into provisionPostgres's io lets its own Case C branch register the service
    // BEFORE any start is attempted whenever existing, initialized pgdata has no service
    // currently owning it (a normal uninstall correctly removes StudixPostgreSQL while
    // intentionally preserving pgdata — reinstalling over that preserved data is exactly this
    // state). Step 8's own registerPostgresServiceFn() call further down remains a harmless,
    // already-idempotent no-op in that case (registerPostgresService() already recognizes an
    // already-correctly-registered service and returns 'already_registered').
    pg = await provisionPostgresFn({
      io: {
        isPostgresServiceOwnedFn,
        registerPostgresServiceFn: () => registerPostgresServiceFn(),
        startPostgresServiceFn: () => startServiceFn(STUDIX_POSTGRES_SERVICE_NAME),
      },
    });
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
    try {
      await runMigrationsFn(migrationClient, { databaseUrl: adminUrl, backup: backupFn });
    } catch (err) {
      throw new FirstInstallError('run_migrations', err);
    }

    // 4b. P1-3 — licensing trust anchor: write the release's licensing PUBLIC key
    // (lib/licensingTrustAnchor.js) into license_config over the same short-lived admin
    // client, replacing the former manual psql step. Idempotent on every install/upgrade:
    // touches only licensing_public_key, never license/activation state; a divergent key is
    // restored to the anchor and reported here.
    try {
      const provisioned = await provisionLicensingPublicKeyFn(migrationClient);
      if (provisioned?.action === 'corrected') {
        console.warn(
          `[firstInstall] licensing_public_key did not match this release's trust anchor ` +
          `(was ${provisioned.previousFingerprint ?? 'unparseable'}); restored to ${provisioned.fingerprint}.`
        );
      }
    } catch (err) {
      throw new FirstInstallError('provision_licensing_key', err);
    }
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

  // 9b. PostgreSQL now runs as the LocalSystem service and the ad-hoc instance is stopped —
  // remove the temporary pgdata access: full lockdown again, then verify by SID that the whole
  // tree is Administrators + SYSTEM only (inheritance removed, no explicit ACE below the root).
  // Fails closed: a failure here stops the install instead of continuing with a weaker ACL.
  provisioningAccess.active = false;
  try {
    restoreDataRootAclFn();
  } catch (err) {
    throw new FirstInstallError('restore_data_acl', err);
  }

  // 10–11. Studix application service. nssmPath is pinned explicitly to the packaged
  // tools\nssm.exe under the install root — never a bare "nssm.exe" PATH lookup, so this never
  // depends on a globally installed NSSM (decision #3).
  try {
    const nssmPath = path.join(resolveInstallRootFn(), 'tools', 'nssm.exe');
    registerAppServiceFn({ nssmPath });
  } catch (err) {
    throw new FirstInstallError('start_app_service', err);
  }

  // 11b. Audit fix (final pre-build audit, Issue B) — never start StudixApp directly while a
  // database switch/rollback is genuinely in flight. restore-state.json's "switching"/
  // "rolling_back" statuses mean the production database may currently be mid-rename (or
  // already renamed back into place but not yet deep-health-verified/identity-promoted — see
  // databaseSwitch.js's own checkpoint comments) — starting the app against that is exactly the
  // gap this fix closes. Every OTHER known status (idle/preparing/restoring/verified/active/
  // rolled_back/failed) never touches the production database's identity the way switching/
  // rolling_back do, so this is deliberately a DENYLIST of those two in-flight statuses, not an
  // allowlist — reusing readRestoreState()'s own existing status vocabulary/validation
  // completely unmodified (never a second restore-state format/semantics).
  //
  // Reuses the SAME readRestoreState() every other caller (databaseSwitch.js,
  // recoverRestoreState.js) already reads from — never a new file, path, or format. A corrupt/
  // invalid-shape restore-state.json throws RestoreStateError('corrupt_state', ...) from
  // readRestoreState() itself (unmodified); that failure is never silently treated as "safe to
  // start" here — fails this step closed, exactly like every other unexpected error in this
  // orchestrator.
  //
  // When skipped, StudixApp is deliberately left un-started for THIS run — the boot-time
  // Scheduled Task's startupOrchestrator.js (PostgreSQL readiness -> this exact same
  // recoverRestoreState.js/databaseSwitch.js recovery, reused completely unmodified here — this
  // guard never invokes either itself) remains the one path that decides when it is safe to
  // start the app again. This is intentionally NOT reported as a FirstInstallError — an in-flight
  // restore is an expected, recoverable condition, never an installer failure by itself.
  let restoreState;
  try {
    restoreState = readRestoreStateFn();
  } catch (err) {
    if (err instanceof RestoreStateError) {
      throw new FirstInstallError('check_restore_state_before_app_start', err);
    }
    throw err;
  }

  const restoreInFlight = restoreState.status === 'switching' || restoreState.status === 'rolling_back';
  if (restoreInFlight) {
    console.warn(
      `⚠️  تم تخطّي بدء تشغيل StudixApp عمداً — حالة الاستعادة الحالية في restore-state.json هي ` +
      `"${restoreState.status}" (عملية تبديل/تراجع قاعدة بيانات جارية بالفعل). لن يُشغَّل StudixApp ` +
      `ضمن هذه العملية؛ مهمة الإقلاع المجدولة (StudixStartupOrchestrator) هي المسؤولة عن انتظار ` +
      `جاهزية PostgreSQL الفعلية، إكمال عملية الاسترداد هذه، ثم بدء StudixApp فقط بعد اكتمالها بأمان.`
    );
  } else {
    // 11c. M3 — fail fast when the fixed app port is held by another program. Without this,
    // StudixApp would only crash-loop on EADDRINUSE and the install would surface as an opaque
    // wait_for_health timeout (or, worse, pass it if the other program happens to answer
    // /health). Skipped when StudixApp itself is already RUNNING — then the port holder is our
    // own service (a safe re-run, or an upgrade whose best-effort pre-copy stop didn't take),
    // and startServiceFn below is a no-op for it anyway. Placed immediately before the start
    // to keep the check-to-bind window as short as possible.
    let appPortFree = true;
    try {
      if (queryServiceStateFn(STUDIX_APP_SERVICE_NAME) !== 'RUNNING') {
        appPortFree = await isPortFreeFn(Number(port));
      }
    } catch (err) {
      throw new FirstInstallError('start_app_service', err);
    }
    if (!appPortFree) {
      throw new FirstInstallError('app_port_in_use', new Error(describePortInUse(port)));
    }

    try {
      startServiceFn(STUDIX_APP_SERVICE_NAME);
    } catch (err) {
      throw new FirstInstallError('start_app_service', err);
    }
  }

  // 12. Register/correct the boot-time Scheduled Task (Phase 3) — idempotently ensures
  // StudixStartupOrchestrator exists and matches the desired configuration, so a future reboot
  // runs startupOrchestrator.js (PostgreSQL readiness -> restore-state recovery -> start
  // StudixApp) via SYSTEM at boot, never via the SCM's own DependOnService ordering. This step
  // only maintains the task DEFINITION — it never runs the orchestrator itself and never starts
  // the task, so it has no effect on THIS run's already-started StudixApp/StudixPostgreSQL.
  try {
    registerScheduledTaskFn();
  } catch (err) {
    throw new FirstInstallError('register_scheduled_task', err);
  }

  // 12b. P1-1 — register/correct the routine daily database backup task (StudixDailyBackup):
  // the same verify-then-correct mechanism as step 12, running backend/src/db/routineBackup.js as
  // SYSTEM once a day (and at the next boot if the PC was off at the scheduled time). Only the
  // task DEFINITION is maintained here — no backup is taken by this step. Fail-closed like step
  // 12: an installation without its routine backup schedule is not a complete installation.
  try {
    registerBackupTaskFn();
  } catch (err) {
    throw new FirstInstallError('register_backup_task', err);
  }

  // 13. Wait for /health.
  const healthUrl = `http://127.0.0.1:${port}/health`;
  const healthy = await waitForHealthFn(healthUrl, { timeoutMs: healthTimeoutMs, intervalMs: healthIntervalMs, fetchImpl });
  if (!healthy) {
    throw new FirstInstallError('wait_for_health', new Error(`لم يستجب ${healthUrl} خلال ${healthTimeoutMs}ms.`));
  }

  // 14. Open the default browser — best-effort. The installation itself already succeeded
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
