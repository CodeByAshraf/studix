#!/usr/bin/env node
// backend/scripts/manageWindowsServices.js
// ─────────────────────────────────────────────────────────────
// INSTALL-05 — thin CLI over lib/windowsService.js's register/start/stop/status/unregister
// primitives, for BOTH the PostgreSQL service and the Studix application service. All real
// logic (idempotency, configuration verification, error classification, dependency/restart
// configuration) lives in windowsService.js — this file only parses argv, calls the matching
// function, and prints the result. Not a first-install orchestrator (INSTALL-06's job) — this
// never itself calls db/postgresProvisioning.js's provisionPostgres()/stopPostgres(); those
// remain separate, explicit steps a future installer sequences on its own before ever calling
// this script's "register"/"start" actions for the PostgreSQL service.
//
// Usage:
//   node scripts/manageWindowsServices.js postgres <register|start|stop|status|unregister>
//   node scripts/manageWindowsServices.js app      <register|start|stop|status|unregister>
//
// Requires Administrator privileges for register/start/stop/unregister (Windows Service
// Control Manager requirement, not something this script can work around) — "status" only
// queries and works unprivileged. nssm.exe itself is never downloaded/vendored by this script
// or this phase (INSTALL-06's job) — "app register"/"app start"/"app stop"/"app status" still
// resolve it via resolveNssmPath()'s own STUDIX_NSSM_PATH-override-or-bare-PATH default (manual/
// dev CLI convenience only — see that function's header); "app unregister" is the one exception,
// always using the pinned {app}\tools\nssm.exe location (resolvePinnedNssmPath) regardless of
// PATH/STUDIX_NSSM_PATH — see that action's own comment below for why.
// ─────────────────────────────────────────────────────────────
import { pathToFileURL } from 'url';
import {
  registerPostgresService, unregisterPostgresService,
  registerAppService, unregisterAppService,
  startService, stopService, serviceStatus,
  STUDIX_POSTGRES_SERVICE_NAME, STUDIX_APP_SERVICE_NAME,
  WindowsServiceError, resolvePinnedNssmPath,
} from '../src/lib/windowsService.js';
// PostgresProvisioningError: registerPostgresService reuses db/postgresProvisioning.js's
// locatePgBinaries() as-is (not duplicated) — a missing bundled-binaries error surfaces as this
// error class, not WindowsServiceError. Recognized here too so the CLI reports it with the same
// clear [reason] classification instead of falling through to a generic "unexpected failure".
import { PostgresProvisioningError } from '../src/db/postgresProvisioning.js';

const [, , target, action] = process.argv;

// app.unregister — the confirmed uninstall-time defect (Phase 3A E2E validation): this used to
// call unregisterAppService() with no nssmPath override, which defaults (resolveNssmPath's own
// default) to a bare "nssm.exe" PATH lookup. nssm.exe is NEVER on PATH — it only ever exists at
// {app}\tools\nssm.exe (INSTALL-06 deliberately never adds it to PATH) — so that lookup always
// failed, unregisterAppService threw before StudixApp was ever stopped, and — because StudixApp
// depends on StudixPostgreSQL — the SAME uninstall run's postgres.unregister then failed too
// (Windows SCM refuses to stop a service another still-running service depends on). Both
// services survived a "normal" uninstall, and the file-deletion pass that followed hit dozens of
// locked-file failures. resolvePinnedNssmPath() (installRoot\tools\nssm.exe — the exact
// convention firstInstall.js's own orchestrator already uses for this same call) closes this.
//
// Scope: ONLY app.unregister changed. app.register/postgres.register/postgres.unregister keep
// their pre-existing call shape — this installer never invokes app.register through this CLI at
// all (firstInstall.js's own orchestrator calls registerAppService directly, already pinning the
// path correctly), and postgres's functions never depended on nssm.exe in the first place.
const TARGETS = {
  postgres: {
    serviceName: STUDIX_POSTGRES_SERVICE_NAME,
    register: () => registerPostgresService(),
    unregister: () => unregisterPostgresService(),
  },
  app: {
    serviceName: STUDIX_APP_SERVICE_NAME,
    register: () => registerAppService(),
    unregister: () => unregisterAppService({ nssmPath: resolvePinnedNssmPath() }),
  },
};

export { TARGETS };

function usageAndExit() {
  console.error('الاستخدام: node scripts/manageWindowsServices.js <postgres|app> <register|start|stop|status|unregister>');
  process.exitCode = 1;
}

async function main() {
  const t = TARGETS[target];
  if (!t || !['register', 'start', 'stop', 'status', 'unregister'].includes(action)) {
    usageAndExit();
    return;
  }

  console.log(`\n=== Studix — إدارة خدمة Windows (${t.serviceName}) — ${action} ===\n`);

  try {
    let result;
    if (action === 'register') result = t.register();
    else if (action === 'unregister') result = t.unregister();
    else if (action === 'start') result = startService(t.serviceName);
    else if (action === 'stop') result = stopService(t.serviceName);
    else if (action === 'status') result = serviceStatus(t.serviceName);

    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    if (err instanceof WindowsServiceError || err instanceof PostgresProvisioningError) {
      console.error(`❌ [${err.reason}] ${err.message}`);
    } else {
      console.error('❌ فشل غير متوقَّع:', err.message);
    }
    process.exitCode = 1;
  }
}

// Only auto-run when executed directly (`node scripts/manageWindowsServices.js ...`), never
// when imported by a test file — same guard convention as tools/license-issuer.js.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
