// backend/src/test-helpers/scratchDbFullSchema.js
// ─────────────────────────────────────────────────────────────
// Phase 2 (Schema Artifact single-source-of-truth refactor) — هذا الملف لم يعد يحمل أي
// DDL مكتوب يدوياً. المصدر الوحيد للحقيقة لكل الـ triggers/functions/CHECK constraints/
// partial unique indexes هو backend/migrations/*.sql (المُطبَّقة فعلياً على studix
// الحقيقية عبر migrationRunner.js عند الإقلاع) — يُقرَأ ويُطبَّق هنا حرفياً بنفس آلية
// migrationRunner.js (discoverMigrationFiles + splitSqlStatements، غير مُعدَّلتين هنا
// إطلاقاً) على قاعدة scratch، بدل نسخ نفس الـ DDL يدوياً في مصفوفات JS منفصلة كما كان
// سابقاً — يُلغي احتمال أن ينحرف هذا الملف عن backend/migrations بمرور الوقت.
//
// يُستخدَم من backend/scripts/generateSchemaArtifact.js (توليد studix-schema.sql) ومن
// اختبارات تكامل تتحقّق من أن الـ DDL كامل فعلياً مُطبَّق على قاعدة scratch (لا افتراضاً).
//
// يُستثنى عمداً (قرار المستخدم الصريح): 6 views و5 sequences غير مُستخدَمة في أي كود تطبيق
// — لا تُدرَج في أي ملف ترحيل ولا في studix-schema.sql الناتج.
// ─────────────────────────────────────────────────────────────
import path from 'path';
import { fileURLToPath } from 'url';
import { discoverMigrationFiles, splitSqlStatements } from '../db/migrationRunner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

// يقرأ كل ملفات backend/migrations/*.sql بترتيب تصاعدي (نفس ترتيب migrationRunner.js
// الحقيقي وقت الإقلاع) ويُرجع كل عبارات SQL الفردية منها مُسطَّحة في مصفوفة واحدة.
function loadMigrationStatements() {
  const files = discoverMigrationFiles(MIGRATIONS_DIR);
  const statements = [];
  for (const file of files) {
    statements.push(...splitSqlStatements(file.content));
  }
  return statements;
}

// يُصنِّف كل عبارة SQL إلى واحدة من الأربع فئات المتوقَّعة عبر نفس الأنماط (regex) التي
// كانت تُستخدَم سابقاً لاستخراج الاسم من كل مصفوفة DDL مكتوبة يدوياً — الفرق الوحيد أن
// مصدر النص الآن ملفات القرص لا مصفوفات JS.
function classifyStatements(statements) {
  const triggers = [];
  const functions = [];
  const checkConstraints = [];
  const partialUniqueIndexes = [];
  for (const sql of statements) {
    let m;
    if ((m = sql.match(/CREATE TRIGGER (\S+)/))) {
      triggers.push(m[1]);
    } else if ((m = sql.match(/FUNCTION public\.(\w+)\(/))) {
      functions.push(m[1]);
    } else if ((m = sql.match(/ADD CONSTRAINT (\S+)/))) {
      checkConstraints.push(m[1]);
    } else if ((m = sql.match(/CREATE UNIQUE INDEX (\S+)/))) {
      partialUniqueIndexes.push(m[1]);
    }
  }
  return {
    triggers: triggers.sort(),
    functions: functions.sort(),
    checkConstraints: checkConstraints.sort(),
    partialUniqueIndexes: partialUniqueIndexes.sort(),
  };
}

const EXPECTED = classifyStatements(loadMigrationStatements());

export const EXPECTED_TRIGGER_NAMES = EXPECTED.triggers;
export const EXPECTED_FUNCTION_NAMES = EXPECTED.functions;
export const EXPECTED_CHECK_CONSTRAINT_NAMES = EXPECTED.checkConstraints;
export const EXPECTED_PARTIAL_UNIQUE_INDEX_NAMES = EXPECTED.partialUniqueIndexes;

/**
 * يطبّق كل عبارات backend/migrations/*.sql (بترتيب تصاعدي) على عميل scratch جاهز (من
 * setupScratchDb الموجودة في scratchDb.js، غير مُعدَّلة هنا إطلاقاً) — نفس الدوال +
 * الـ triggers + الـ CHECK constraints + الفهارس الفريدة الجزئية التي يُطبِّقها
 * migrationRunner.js فعلياً على studix الحقيقية، حرفياً من نفس الملفات على القرص.
 */
export async function applyFullSchemaDDL(client) {
  for (const sql of loadMigrationStatements()) {
    await client.$executeRawUnsafe(sql);
  }
}

/**
 * يتحقّق فعلياً (لا افتراضاً) أن كل trigger/function/CHECK constraint متوقَّع موجود
 * بالفعل على القاعدة المُمرَّرة (scratch أو المُعاد بناؤها من studix-schema.sql) — عبر
 * استعلامات pg_trigger/pg_proc/pg_constraint حقيقية، بلا فلترة على جدول معيّن.
 */
export async function readAppliedFullSchemaObjects(client) {
  const triggerRows = await client.$queryRaw`
    SELECT t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal
  `;
  const functionRows = await client.$queryRaw`
    SELECT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(${EXPECTED_FUNCTION_NAMES})
  `;
  const constraintRows = await client.$queryRaw`
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.contype = 'c'
  `;
  // partial unique indexes لا تظهر أبداً في pg_constraint (Postgres لا يُسجِّلها كـ
  // constraint إطلاقاً، فهرس فريد بعبارة WHERE فقط) — تُقرَأ من pg_index/pg_class مباشرة.
  const partialUniqueRows = await client.$queryRaw`
    SELECT c.relname AS idxname
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = ANY(${EXPECTED_PARTIAL_UNIQUE_INDEX_NAMES})
  `;
  return {
    triggers: triggerRows.map((r) => r.tgname).sort(),
    functions: functionRows.map((r) => r.proname).sort(),
    constraints: constraintRows.map((r) => r.conname).sort(),
    partialUniqueIndexes: partialUniqueRows.map((r) => r.idxname).sort(),
  };
}
