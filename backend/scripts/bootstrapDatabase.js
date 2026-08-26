#!/usr/bin/env node
// backend/scripts/bootstrapDatabase.js
// ─────────────────────────────────────────────────────────────
// Phase 6c — manual/future-installer entry point. Ensures the configured database exists and
// has its base schema (backend/src/db/bootstrapDatabase.js), then hands off to the existing,
// unmodified migration runner (backend/src/db/migrationRunner.js) for incremental migrations —
// mirroring scripts/runMigrations.js's own invocation of it exactly, one step later in the
// lifecycle. Never run automatically by server.js; a deliberate, explicit step, same as
// runMigrations.js already is.
//
// Uses the Phase 6b config loader (lib/config.js) — not a bare dotenv.config() — so this
// script resolves the same production-config-path-vs-dev-.env precedence server.js does.
// ─────────────────────────────────────────────────────────────
import '../src/lib/config.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../src/prisma.js';
import { validateDatabaseUrl, describeStartupFailure } from '../src/lib/startupErrors.js';
import { bootstrapDatabase, BootstrapError } from '../src/db/bootstrapDatabase.js';
import { runMigrations } from '../src/db/migrationRunner.js';
import { createPreMigrationBackup } from '../src/db/backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', 'prisma', 'studix-schema.sql');

async function main() {
  console.log('\n=== Studix — تمهيد قاعدة البيانات (Database Bootstrap) ===\n');

  try {
    validateDatabaseUrl(process.env.DATABASE_URL);
  } catch (err) {
    console.error(describeStartupFailure(err));
    process.exitCode = 1;
    return;
  }

  try {
    const result = await bootstrapDatabase({ schemaPath: SCHEMA_PATH });
    if (result.action === 'schema_applied') {
      console.log(`✅ قاعدة جديدة${result.databaseCreated ? ' (تم إنشاؤها الآن)' : ''} — تم تطبيق studix-schema.sql (${result.tableCount} جدول).`);
    } else {
      console.log(`✅ القاعدة مُهيَّأة بالفعل (${result.tableCount} جدول) — لم يُطبَّق أي schema جديد.`);
    }
    if (result.connectionInfo) {
      console.log(`   host=${result.connectionInfo.host} port=${result.connectionInfo.port} database=${result.connectionInfo.database} user=${result.connectionInfo.user}`);
    }
  } catch (err) {
    console.error(err instanceof BootstrapError ? err.message : describeStartupFailure(err));
    console.error('تم إيقاف التمهيد — لم تُطبَّق أي ترحيلات.');
    process.exitCode = 1;
    return;
  }

  try {
    const migrationResult = await runMigrations(prisma, { backup: createPreMigrationBackup });
    if (migrationResult.action === 'up-to-date') console.log('\n✅ لا ترحيلات معلَّقة — القاعدة محدَّثة بالفعل.');
    if (migrationResult.action === 'stamped') console.log(`\n✅ سُجِّلت الإصدارات [${migrationResult.versions.join(', ')}] كمُطبَّقة (بلا تنفيذ SQL).`);
    if (migrationResult.action === 'migrated') console.log(`\n✅ تم تطبيق الإصدارات [${migrationResult.versions.join(', ')}]. النسخة الاحتياطية: ${migrationResult.backupPath}`);
  } catch (err) {
    console.error(`\n❌ فشل نظام الترحيل: ${describeStartupFailure(err)}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
