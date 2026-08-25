#!/usr/bin/env node
// backend/scripts/generateSchemaArtifact.js
// ─────────────────────────────────────────────────────────────
// أداة مطوّر تُشغَّل يدوياً (node scripts/generateSchemaArtifact.js) لإنتاج
// backend/prisma/studix-schema.sql — ملف SQL واحد حتمي (deterministic) يُنشئ قاعدة Studix
// فارغة كاملة (27 جدولاً + كل الـ FKs/الفهارس/unique constraints من schema.prisma، زائد
// 13 trigger و4 functions و45 CHECK constraint التي لا يُمثّلها schema.prisma/db push
// إطلاقاً) — بلا أي حاجة لـ Prisma CLI أو npm أو اتصال إنترنت على جهاز العميل وقت
// التثبيت.
//
// المنهجية (نفس منهجية scratchDb.js المُثبَتة فعلياً في MEDIUM-B1/B2، بلا أي تعديل
// عليها):
//   1. setupScratchDb('schema-artifact') — قاعدة scratch جديدة معزولة تماماً، db push.
//   2. applyFullSchemaDDL(client) من scratchDbFullSchema.js (الملف الجديد المرافق) —
//      يضيف الـ triggers/functions/CHECK constraints الـ45 كاملة.
//   3. pg_dump --schema-only --no-owner --no-privileges على قاعدة scratch (وليس على
//      studix الحقيقية إطلاقاً) → studix-schema.sql.
//   4. teardownScratchDb — حذف قاعدة scratch فوراً (نظيفة، لا تُترَك أبداً).
//
// تُستثنى عمداً من هذا الملف (قرار صريح): 6 views و5 sequences غير مُستخدَمة في أي كود
// تطبيق — لا تُنشَأ إطلاقاً على قاعدة scratch (لا db push ولا applyFullSchemaDDL يُنشئانها)
// فتغيب تلقائياً من ناتج pg_dump بلا أي فلترة يدوية بعدية.
//
// --no-owner --no-privileges: يجعل الملف الناتج مستقلاً عن اسم أي دور/مستخدم — يُطبَّق
// بنجاح تحت أي دور يُنشئه مثبِّت العميل مستقبلاً، بلا افتراض أن الدور اسمه "postgres".
//
// لا يلمس قاعدة studix الحقيقية بأي خطوة إطلاقاً — كل الكتابة تقع فقط على قاعدة scratch
// معزولة تُحذَف في النهاية (حتى لو فشلت أي خطوة، عبر finally).
// ─────────────────────────────────────────────────────────────
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../src/test-helpers/scratchDb.js';
import { applyFullSchemaDDL } from '../src/test-helpers/scratchDbFullSchema.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(BACKEND_ROOT, 'prisma', 'studix-schema.sql');

function findPgDump() {
  if (process.env.PG_DUMP_PATH && fs.existsSync(process.env.PG_DUMP_PATH)) {
    return process.env.PG_DUMP_PATH;
  }
  // البحث في تثبيتات PostgreSQL الرسمية المعتادة على Windows (C:\Program Files\PostgreSQL\<version>\bin)
  const pgRoot = 'C:\\Program Files\\PostgreSQL';
  if (fs.existsSync(pgRoot)) {
    const versions = fs.readdirSync(pgRoot).sort().reverse(); // أحدث إصدار أولاً
    for (const v of versions) {
      const candidate = path.join(pgRoot, v, 'bin', 'pg_dump.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error(
    'تعذّر العثور على pg_dump.exe تلقائياً. حدِّد المسار صراحةً عبر متغيّر البيئة PG_DUMP_PATH.'
  );
}

async function main() {
  console.log('\n=== Studix — توليد studix-schema.sql (قاعدة scratch معزولة، لا تلمس studix) ===\n');

  const check = await checkPostgresReachable();
  if (!check.reachable) {
    console.error(`تعذّر المتابعة: ${check.reason}`);
    process.exit(1);
  }

  const pgDumpPath = findPgDump();
  console.log(`pg_dump: ${pgDumpPath}`);

  let scratch;
  try {
    console.log('1) إنشاء قاعدة scratch ودفع schema.prisma إليها...');
    scratch = await setupScratchDb('schemaartifact');
    console.log(`   قاعدة scratch: ${scratch.scratchDbName}`);

    console.log('2) تطبيق الـ triggers/functions/CHECK constraints/partial unique indexes الكاملة (13/4/45/2)...');
    await applyFullSchemaDDL(scratch.client);

    console.log('3) تشغيل pg_dump --schema-only --no-owner --no-privileges...');
    const dumpArgs = [
      scratch.scratchUrl,
      '--schema-only',
      '--no-owner',
      '--no-privileges',
      '--no-comments',
    ];
    const dumpOutput = execFileSync(pgDumpPath, dumpArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

    const header =
      `-- studix-schema.sql\n` +
      `-- تم توليده تلقائياً بواسطة backend/scripts/generateSchemaArtifact.js — لا تُعدِّله يدوياً.\n` +
      `-- لإعادة التوليد بعد أي تغيير حقيقي في schema.prisma أو الـ triggers/constraints:\n` +
      `--   node backend/scripts/generateSchemaArtifact.js\n` +
      `-- تاريخ التوليد: ${new Date().toISOString()}\n` +
      `-- المصدر: قاعدة scratch معزولة (db push + DDL كامل)، وليس أي قاعدة تطوير حقيقية — لا بيانات إطلاقاً.\n\n`;

    fs.writeFileSync(OUTPUT_PATH, header + dumpOutput, 'utf8');
    console.log(`   كُتب: ${OUTPUT_PATH} (${(dumpOutput.length / 1024).toFixed(1)} KB)`);
  } finally {
    if (scratch) {
      console.log('4) حذف قاعدة scratch...');
      await teardownScratchDb(scratch);
    }
  }

  console.log('\nتم التوليد بنجاح. studix الحقيقية لم تُلمَس بأي خطوة.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nخطأ:', err.message);
  if (err.stderr) console.error(err.stderr.toString());
  process.exit(1);
});
