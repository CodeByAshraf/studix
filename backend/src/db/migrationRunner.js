// backend/src/db/migrationRunner.js
// ─────────────────────────────────────────────────────────────
// نظام ترحيل قاعدة بيانات خاص بـ Studix (Phase 1) — بديل صغير مُملوك بالكامل لـ Prisma
// Migrate (مرفوض عمداً — انظر تقرير "Database Update/Migration System investigation").
// لا اعتماد جديد (npm package) — يُعاد استخدام PrismaClient.$executeRawUnsafe/$transaction
// فقط، بنفس نمط setupScratchDb.js/scratchDbFullSchema.js المُثبَت فعلياً في هذا المشروع.
//
// آلية العمل (يُستدعى مرة واحدة عند إقلاع الخادم، قبل app.listen() مباشرة):
//   1. يضمن وجود جدول التتبّع _studix_migrations (CREATE TABLE IF NOT EXISTS، آمن التكرار).
//   2. يحاول الحصول على قفل استشاري (pg_try_advisory_lock) — لا يحظر إطلاقاً (fail-fast لا
//      انتظار أبدي) لو عملية ترحيل أخرى تعمل بالفعل (مثال: NSSM أعاد تشغيل الخدمة مرتين).
//   3. لو لا صفوف مُطبَّقة بعد (تثبيت جديد كلياً على مستوى جدول التتبّع):
//        - لو الـ DDL الأساسي (دالة prevent_delete) موجودة بالفعل → هذا تثبيت جديد
//          طبَّق المثبِّت عليه studix-schema.sql مباشرة (يتضمّن الـ DDL كاملاً) — تُسجَّل
//          كل ملفات الترحيل الحالية كمُطبَّقة (stamp) بلا تنفيذ SQL إطلاقاً (لأن تنفيذه
//          سيفشل: "already exists").
//        - وإلا لو الجداول الأساسية (students) موجودة لكن بلا الـ DDL الأساسي → تثبيت
//          سابق لنظام الترحيل هذا، يحتاج ترحيل 001 فعلياً → يكمل للمسار التزايدي أدناه.
//        - وإلا (لا جداول إطلاقاً) → قاعدة غير مُهيَّأة، يرفض المتابعة برسالة واضحة.
//   4. لو صفوف مُطبَّقة موجودة بالفعل → يتحقّق أولاً أن checksum كل ملف على القرص يطابق ما
//      سُجِّل وقت تطبيقه (يكتشف تعديل ملف ترحيل مُنشَر بالخطأ قبل أي شيء آخر).
//   5. المسار التزايدي: لو لا يوجد ملف مُعلَّق → يعود فوراً (بلا نسخة احتياطية). لو يوجد
//      ملف واحد أو أكثر → نسخة احتياطية واحدة للدفعة كاملة (backup.js، تفشل=توقّف كامل قبل
//      أي DDL) ثم تطبيق كل ملف مُعلَّق بترتيب تصاعدي، كل ملف داخل معاملة واحدة مستقلة (فشل
//      ملف واحد لا يُراجع الملفات السابقة الناجحة، ولا يُسجَّل صف تتبّع له إطلاقاً).
//   6. لا يُستدعى app.listen() أبداً لو رمى runMigrations استثناءً — على المستدعي (server.js)
//      اصطياد الاستثناء وإيقاف العملية.
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

// ثابت عشوائي فريد لهذا التطبيق فقط (لا معنى خاص له) — مفتاح pg_try_advisory_lock/
// pg_advisory_unlock. قاعدة محلية واحدة لكل معلّم، عملية Node واحدة فقط تلمسها عادة؛
// هذا القفل يحمي فقط من سيناريو نادر (إعادة تشغيل خدمة NSSM مرّتين متتاليتين بسرعة).
const ADVISORY_LOCK_KEY = 7727727;

const TRACKING_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS _studix_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  checksum   TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

export function computeChecksum(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

// مُقسِّم SQL يحترم النصوص بعلامات $tag$...$tag$ (أجسام الدوال plpgsql) والنصوص المقتبَسة
// بـ '...'/"..." (بما فيها الهروب المضاعف ''/"") — لا يُقسِّم أبداً عند فاصلة منقوطة داخل
// أيٍّ منها. ضروري لأن Prisma $executeRawUnsafe لا يقبل أوامر متعددة في استدعاء واحد
// (مُتحقَّق منه فعلياً: "cannot insert multiple commands into a prepared statement").
export function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? n : end + 1;
      current += sql.slice(i, stop); i = stop; continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      current += sql.slice(i, stop); i = stop; continue;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < n) { if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } j += 1; break; } j += 1; }
      current += sql.slice(i, j); i = j; continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < n) { if (sql[j] === '"') { if (sql[j + 1] === '"') { j += 2; continue; } j += 1; break; } j += 1; }
      current += sql.slice(i, j); i = j; continue;
    }
    if (ch === '$') {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const closeIdx = sql.indexOf(tag, i + tag.length);
        const end = closeIdx === -1 ? n : closeIdx + tag.length;
        current += sql.slice(i, end); i = end; continue;
      }
    }
    if (ch === ';') {
      current += ch;
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = ''; i += 1; continue;
    }
    current += ch; i += 1;
  }
  const tail = current.trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}

export function discoverMigrationFiles(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) return [];
  const filenames = fs.readdirSync(migrationsDir).filter((f) => /^\d{3,}_.+\.sql$/.test(f));
  const files = filenames.map((filename) => {
    const m = filename.match(/^(\d{3,})_(.+)\.sql$/);
    const version = parseInt(m[1], 10);
    const name = m[2];
    const filePath = path.join(migrationsDir, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    return { version, name, filename, filePath, content, checksum: computeChecksum(content) };
  });
  files.sort((a, b) => a.version - b.version);
  return files;
}

async function ensureTrackingTable(client) {
  await client.$executeRawUnsafe(TRACKING_TABLE_SQL);
}

async function getAppliedRows(client) {
  const rows = await client.$queryRaw`SELECT version, name, checksum FROM _studix_migrations ORDER BY version`;
  const map = new Map();
  for (const r of rows) map.set(Number(r.version), { name: r.name, checksum: r.checksum });
  return map;
}

async function tableExists(client, tableName) {
  const rows = await client.$queryRaw`
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ${tableName}
  `;
  return rows.length > 0;
}

async function functionExists(client, functionName) {
  const rows = await client.$queryRaw`
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ${functionName}
  `;
  return rows.length > 0;
}

async function stampAsApplied(client, files) {
  for (const f of files) {
    await client.$executeRaw`
      INSERT INTO _studix_migrations (version, name, checksum) VALUES (${f.version}, ${f.name}, ${f.checksum})
    `;
  }
}

// تطبيق ملف ترحيل واحد + تسجيل صف تتبّعه داخل معاملة واحدة — فشل أي جزء يُراجع كل شيء
// (Postgres DDL معاملاتي بالكامل)، فلا صف تتبّع يُسجَّل أبداً لملف لم يكتمل فعلياً.
async function applyMigrationFile(prisma, file) {
  const statements = splitSqlStatements(file.content);
  await prisma.$transaction(async (tx) => {
    for (const sql of statements) {
      await tx.$executeRawUnsafe(sql);
    }
    await tx.$executeRaw`
      INSERT INTO _studix_migrations (version, name, checksum) VALUES (${file.version}, ${file.name}, ${file.checksum})
    `;
  });
}

async function tryAcquireLock(client) {
  const rows = await client.$queryRaw`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS locked`;
  return rows[0].locked === true;
}

// إطلاق أفضل-جهد (best-effort): pg_advisory_lock/unlock مرتبطان بجلسة الاتصال الفعلية، لا
// بـ PrismaClient ككل (الذي قد يوزّع الاستعلامات على اتصالات مختلفة من مجمّع الاتصالات
// نظرياً) — في هذا التطبيق (عملية خادم محلية واحدة، لا حركة مرور متزامنة أخرى وقت الإقلاع)
// هذا غير عملي الحدوث فعلياً، لكن لو فشل الإطلاق على نفس الاتصال، القفل يُحرَّر تلقائياً
// عند إغلاق ذلك الاتصال لاحقاً من مجمّع Prisma — ليس خطأ بيانات، فقط قفل مُتبقٍّ مؤقتاً.
async function releaseLock(client) {
  try {
    await client.$queryRaw`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`;
  } catch {
    // best-effort فقط — لا نرمي هنا، العمل الفعلي اكتمل/فشل بالفعل قبل هذه النقطة.
  }
}

/**
 * نقطة الدخول الوحيدة. يُستدعى من server.js قبل app.listen() مباشرة.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ migrationsDir?: string, backup?: (databaseUrl: string) => Promise<string>, databaseUrl?: string }} [options]
 * @returns {Promise<{ action: 'up-to-date'|'stamped'|'migrated', versions: number[], backupPath: string|null }>}
 */
export async function runMigrations(prisma, options = {}) {
  const migrationsDir = options.migrationsDir || DEFAULT_MIGRATIONS_DIR;
  const backupFn = options.backup || null;
  const databaseUrl = options.databaseUrl || process.env.DATABASE_URL;

  await ensureTrackingTable(prisma);

  const locked = await tryAcquireLock(prisma);
  if (!locked) {
    throw new Error(
      'تعذّر الحصول على قفل الترحيل (pg_try_advisory_lock) — عملية ترحيل أخرى تعمل بالفعل على ' +
      'نفس القاعدة. تم إيقاف بدء التشغيل بدل انتظار أبدي.'
    );
  }

  try {
    const files = discoverMigrationFiles(migrationsDir);
    const applied = await getAppliedRows(prisma);

    if (applied.size === 0) {
      const baselineAlready = await functionExists(prisma, 'prevent_delete');
      if (baselineAlready) {
        await stampAsApplied(prisma, files);
        return { action: 'stamped', versions: files.map((f) => f.version), backupPath: null };
      }
      const coreExists = await tableExists(prisma, 'students');
      if (!coreExists) {
        throw new Error(
          'قاعدة البيانات غير مهيَّأة إطلاقاً — يجب تطبيق backend/prisma/studix-schema.sql ' +
          'أولاً (خطوة المثبِّت) قبل تشغيل التطبيق.'
        );
      }
      // لا baseline بعد لكن الجداول موجودة: تثبيت سابق لنظام الترحيل — يكمل تزايدياً أدناه
      // (applied فارغ، فكل الملفات ستكون "معلَّقة" وتُنفَّذ فعلياً).
    } else {
      for (const [version, info] of applied) {
        const file = files.find((f) => f.version === version);
        if (!file) {
          throw new Error(
            `ملف الترحيل رقم ${version} ("${info.name}") مسجَّل كمُطبَّق في _studix_migrations ` +
            `لكنه غير موجود على القرص حالياً — لا يمكن المتابعة بأمان.`
          );
        }
        if (file.checksum !== info.checksum) {
          throw new Error(
            `تعارض checksum لملف الترحيل ${file.filename}: محتواه على القرص يختلف عمّا طُبِّق ` +
            `فعلياً سابقاً. ملفات الترحيل المُنشَرة يجب ألا تُعدَّل أبداً بعد إصدارها. تم إيقاف بدء التشغيل.`
          );
        }
      }
    }

    const pending = files.filter((f) => !applied.has(f.version));
    if (pending.length === 0) {
      return { action: 'up-to-date', versions: [], backupPath: null };
    }

    let backupPath = null;
    if (backupFn) {
      backupPath = await backupFn(databaseUrl); // يرمي استثناءً لو فشلت النسخة — نتوقّف قبل أي DDL
    }

    for (const file of pending) {
      await applyMigrationFile(prisma, file);
    }

    return { action: 'migrated', versions: pending.map((f) => f.version), backupPath };
  } finally {
    await releaseLock(prisma);
  }
}
