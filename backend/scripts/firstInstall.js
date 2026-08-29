#!/usr/bin/env node
// backend/scripts/firstInstall.js
// ─────────────────────────────────────────────────────────────
// INSTALL-06 — thin CLI over src/installer/firstInstall.js's runFirstInstall(). All real
// sequencing/branching logic lives there; this file only resolves the schema path (same
// __dirname-relative pattern scripts/bootstrapDatabase.js already uses) and reports the result.
//
// This is the single command the Inno Setup installer's [Code] section invokes via one Exec()
// call — never a chain of separate CLI scripts from Pascal Script.
//
// Requires Administrator privileges (Windows service registration) and the bundled pgsql\ and
// tools\nssm.exe already in place alongside this runtime package (INSTALL-06's own build-time
// acquisition step — never downloaded by this script itself).
// ─────────────────────────────────────────────────────────────
import path from 'path';
import { fileURLToPath } from 'url';
import { runFirstInstall, FirstInstallError } from '../src/installer/firstInstall.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', 'prisma', 'studix-schema.sql');

async function main() {
  console.log('\n=== Studix — تثبيت/تحديث النظام (First Install Orchestration) ===\n');

  try {
    const result = await runFirstInstall({ schemaPath: SCHEMA_PATH });
    console.log('✅ اكتمل التثبيت — StudixPostgreSQL وStudixApp يعملان، والفحص الصحي (health) ناجح.');
    if (!result.browserOpened) {
      console.log('⚠️  تعذّر فتح المتصفح تلقائياً — افتح المتصفح يدوياً على العنوان أعلاه.');
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    if (err instanceof FirstInstallError) {
      console.error(`❌ [${err.step}] ${err.message}`);
    } else {
      console.error('❌ فشل غير متوقَّع:', err.message);
    }
    process.exitCode = 1;
  }
}

main();
