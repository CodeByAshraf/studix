#!/usr/bin/env node
// backend/scripts/provisionPostgres.js
// ─────────────────────────────────────────────────────────────
// INSTALL-03 — manual/future-installer entry point. Ensures the bundled PostgreSQL server is
// initialized (first run) or already running (every subsequent run), loopback-only, and
// prints the resulting connection info WITHOUT ever printing the password — then, on first
// initialization only, writes the resulting DATABASE_URL through the already-approved
// INSTALL-02 mechanism (lib/productionConfig.js's ensureProductionConfig), same shape as
// scripts/bootstrapDatabase.js's own two-step orchestration.
//
// Sequencing contract (see migration/reports/INSTALL-03_POSTGRES_PROVISIONING_DESIGN.md):
// this script is meant to run BEFORE scripts/generateProductionConfig.js on a fresh install —
// PostgreSQL provisioning is what DECIDES the DATABASE_URL (host/port/credential), so it must
// exist before the production config file is created. On every later run (restart/upgrade),
// the data directory is already initialized, so this script never re-derives a DATABASE_URL —
// it only confirms PostgreSQL is running and leaves the existing production config exactly as
// it is.
//
// Does NOT create the `studix` database, apply the base schema, or run migrations — that
// remains entirely db/bootstrapDatabase.js's and db/migrationRunner.js's job, called
// separately after this script succeeds (see scripts/bootstrapDatabase.js).
// ─────────────────────────────────────────────────────────────
import { provisionPostgres, PostgresProvisioningError } from '../src/db/postgresProvisioning.js';
import { resolveProductionConfigPath } from '../src/lib/config.js';
import { ensureProductionConfig, ProductionConfigError } from '../src/lib/productionConfig.js';

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

  console.log('✅ تم تهيئة PostgreSQL لأول مرة وبدأ تشغيله.');

  const configPath = resolveProductionConfigPath();
  try {
    const configResult = ensureProductionConfig({ configPath, databaseUrl: result.databaseUrl });
    console.log(
      configResult.created
        ? `✅ تم إنشاء ملف الإعداد (${configPath}) مع DATABASE_URL الجديد.`
        : `✅ ملف الإعداد (${configPath}) موجود بالفعل — DATABASE_URL الجديد لم يُكتَب (راجع سياسة التسلسل في تقرير INSTALL-03).`
    );
  } catch (err) {
    if (err instanceof ProductionConfigError) {
      console.error(`❌ ${err.message}`);
    } else {
      console.error('❌ فشل غير متوقَّع أثناء كتابة ملف الإعداد:', err.message);
    }
    process.exitCode = 1;
  }
}

main();
