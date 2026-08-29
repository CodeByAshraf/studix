#!/usr/bin/env node
// backend/scripts/generateProductionConfig.js
// ─────────────────────────────────────────────────────────────
// INSTALL-02 — manual/future-installer entry point. Ensures the production config file
// (lib/config.js's resolveProductionConfigPath — STUDIX_CONFIG_PATH override, else
// %ProgramData%\Studix\config\.env) exists with a securely generated SESSION_SECRET, without
// requiring an operator to hand-edit .env or generate a secret themselves. Idempotent — a
// config file that already has a SESSION_SECRET is left completely untouched. Mirrors
// scripts/bootstrapDatabase.js/runMigrations.js's own "future-installer entry point" shape.
//
// DATABASE_URL is never invented here (INSTALL-03 owns PostgreSQL setup). It is read from
// STUDIX_INSTALL_DATABASE_URL — a distinct variable name, deliberately NOT plain DATABASE_URL.
// Importing lib/config.js below (for resolveProductionConfigPath) runs its loadEnvConfig()
// side effect, which — on a developer machine, when no production config exists yet — falls
// back to loading backend/.env and populates process.env.DATABASE_URL from it. Reading that
// ambient value here would silently write a developer's real local DB credentials into what's
// supposed to be an explicit, installer-supplied production value; STUDIX_INSTALL_DATABASE_URL
// can never collide with anything backend/.env or dotenv's fallback would set, so only a value
// the caller passed on purpose (future installer orchestration, or an operator's deliberate
// manual re-run) is ever written. If unset, the file is created with SESSION_SECRET only, and
// the existing fail-closed startup check surfaces the missing DATABASE_URL clearly the next
// time the server actually starts (lib/startupErrors.js) — unchanged.
//
// Never logs/prints the generated secret — only the config path and created/preserved status.
// ─────────────────────────────────────────────────────────────
import { resolveProductionConfigPath } from '../src/lib/config.js';
import { ensureProductionConfig, ProductionConfigError } from '../src/lib/productionConfig.js';

function main() {
  console.log('\n=== Studix — إعداد ملف الإنتاج (Production Config) ===\n');

  const configPath = resolveProductionConfigPath();
  console.log(`المسار: ${configPath}`);

  try {
    const result = ensureProductionConfig({ configPath, databaseUrl: process.env.STUDIX_INSTALL_DATABASE_URL });
    if (result.created) {
      console.log('✅ تم إنشاء ملف الإعداد وتوليد SESSION_SECRET جديد.');
    } else {
      console.log('✅ ملف الإعداد موجود بالفعل ويحتوي SESSION_SECRET صالحاً — لم يتغيّر شيء.');
    }
  } catch (err) {
    if (err instanceof ProductionConfigError) {
      console.error(`❌ ${err.message}`);
    } else {
      console.error('❌ فشل غير متوقَّع أثناء إعداد ملف الإنتاج:', err.message);
    }
    process.exitCode = 1;
  }
}

main();
