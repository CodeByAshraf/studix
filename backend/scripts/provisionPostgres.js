#!/usr/bin/env node
// backend/scripts/provisionPostgres.js
// ─────────────────────────────────────────────────────────────
// INSTALL-03 — narrow manual status/provisioning tool. Ensures the bundled PostgreSQL server is
// initialized (first run) or already running (every subsequent run), loopback-only, and prints
// the resulting connection info WITHOUT ever printing the password or the connection string
// itself (host/port/database only — see below).
//
// INSTALL-11 — deliberately does NOT write any DATABASE_URL/config file anymore (fixed a real
// regression: the databaseUrl provisionPostgres() returns on first init is the studix_admin
// (superuser, provisioning-only) connection — INSTALL-10's whole point was that this must never
// become the running application's DATABASE_URL. This script previously wrote exactly that via
// ensureProductionConfig, silently reintroducing the single-superuser-role architecture INSTALL-10
// closed, if ever run manually against a fresh cluster — see
// migration/reports/INSTALL-11_CLI_SCRIPT_RECONCILIATION.md for the full trace). The ONLY correct
// place DATABASE_URL is ever written now is backend/src/installer/firstInstall.js's own
// ensureAppRole()-gated call to ensureProductionConfig, after the restricted studix_app role has
// actually been created and granted — never here, never from a bare cluster-provisioning step
// that hasn't even created the `studix` database or schema yet (that remains entirely
// db/bootstrapDatabase.js's job).
//
// This script is now purely diagnostic/status: "is the bundled cluster initialized and running?"
// — nothing it does has any effect on which role the application ends up using.
// ─────────────────────────────────────────────────────────────
import { provisionPostgres, PostgresProvisioningError } from '../src/db/postgresProvisioning.js';

async function main() {
  console.log('\n=== Studix — تهيئة PostgreSQL المُجمَّعة (Bundled PostgreSQL Provisioning) ===\n');

  let result;
  try {
    result = await provisionPostgres();
  } catch (err) {
    if (err instanceof PostgresProvisioningError) {
      console.error(`❌ [${err.reason}] ${err.message}`);
    } else {
      console.error('❌ فشل غير متوقَّع أثناء تهيئة PostgreSQL:', err.message);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`المنفذ: ${result.port}`);
  console.log(`مجلد البيانات: ${result.pgDataDir}`);
  console.log(`قاعدة البيانات: ${result.database}`);

  if (result.status === 'already_initialized') {
    console.log('✅ PostgreSQL مُهيَّأ بالفعل ويعمل — لم يتغيّر شيء.');
    return;
  }

  console.log(
    '✅ تم تهيئة PostgreSQL لأول مرة وبدأ تشغيله.\n' +
    'ℹ️  هذا السكربت لا يكتب أي ملف إعداد أو DATABASE_URL — إعداد قاعدة البيانات، الترحيلات، ' +
    'ودور التطبيق المحدود (studix_app) تتم جميعها عبر backend/src/installer/firstInstall.js ' +
    '(المسار الذي يستدعيه المثبِّت فعلياً)، وليس عبر هذا السكربت.'
  );
}

main();
