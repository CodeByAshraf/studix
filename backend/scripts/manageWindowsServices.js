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
// queries and works unprivileged. Assumes nssm.exe is available (STUDIX_NSSM_PATH override, or
// on PATH) — never downloaded/vendored by this script or this phase (INSTALL-06's job).
// ─────────────────────────────────────────────────────────────
import {
  registerPostgresService, unregisterPostgresService,
  registerAppService, unregisterAppService,
  startService, stopService, serviceStatus,
  STUDIX_POSTGRES_SERVICE_NAME, STUDIX_APP_SERVICE_NAME,
  WindowsServiceError,
} from '../src/lib/windowsService.js';
// PostgresProvisioningError: registerPostgresService reuses db/postgresProvisioning.js's
// locatePgBinaries() as-is (not duplicated) — a missing bundled-binaries error surfaces as this
// error class, not WindowsServiceError. Recognized here too so the CLI reports it with the same
// clear [reason] classification instead of falling through to a generic "unexpected failure".
import { PostgresProvisioningError } from '../src/db/postgresProvisioning.js';

const [, , target, action] = process.argv;

const TARGETS = {
  postgres: {
    serviceName: STUDIX_POSTGRES_SERVICE_NAME,
    register: () => registerPostgresService(),
    unregister: () => unregisterPostgresService(),
  },
  app: {
    serviceName: STUDIX_APP_SERVICE_NAME,
    register: () => registerAppService(),
    unregister: () => unregisterAppService(),
  },
};

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

main();
