// backend/src/db/migrationRunner.js
// ─────────────────────────────────────────────────────────────
// نظام ترحيل قاعدة بيانات خاص بـ Studix (Phase 1، مُصلَّب في Phase 3 — Migration
// Hardening) — بديل صغير مُملوك بالكامل لـ Prisma Migrate (مرفوض عمداً — انظر تقرير
// "Database Update/Migration System investigation"). لا اعتماد جديد (npm package) —
// يُعاد استخدام PrismaClient.$executeRawUnsafe/$transaction فقط، بنفس نمط
// setupScratchDb.js/scratchDbFullSchema.js المُثبَت فعلياً في هذا المشروع.
//
// آلية العمل (يُستدعى مرة واحدة عند إقلاع الخادم، قبل app.listen() مباشرة):
//   1. يحاول الحصول على قفل استشاري (pg_try_advisory_lock) — لا يحظر إطلاقاً (fail-fast لا
//      انتظار أبدي) لو عملية ترحيل أخرى تعمل بالفعل (مثال: NSSM أعاد تشغيل الخدمة مرتين، أو
//      تشغيل يدوي لـ npm run migrate أثناء عمل الخادم). Phase 3: يُطبَّق الآن عبر عميل
//      Prisma مخصَّص بـ connection_limit=1 (lockClient داخل runMigrations، انظر
//      withConnectionLimit أسفل) — يضمن أن الاتصال الذي يحصل على القفل هو نفسه الذي يحرِّره حرفياً، ويُغلَق هذا
//      الاتصال فور انتهاء runMigrations (نجاحاً أو فشلاً)، فلا يبقى القفل عالقاً داخل تجمّع
//      اتصالات الخادم الرئيسي طوال عمر العملية (كان هذا عيباً حقيقياً في Phase 1: تجمّع
//      اتصالات Prisma العادي لا يضمن إطلاقاً أن استدعاء الحصول على القفل والإفراج عنه يقعان
//      على نفس الاتصال الفعلي — لو وقعا على اتصالين مختلفين، pg_advisory_unlock يُعيد false
//      بصمت (لا يرمي استثناء) والقفل يبقى محجوزاً فعلياً حتى يُغلَق ذلك الاتصال الأول، أي
//      طوال عمر عملية الخادم كاملاً، مما يمنع أي تشغيل يدوي لاحق لـ npm run migrate خطأً).
//   2. بعد اكتساب القفل (لا قبله — Phase 3): يضمن وجود جدول التتبّع _studix_migrations
//      (CREATE TABLE IF NOT EXISTS). نُقِلت هذه الخطوة من قبل اكتساب القفل إلى بعده عمداً:
//      CREATE TABLE IF NOT EXISTS ليست آمنة بالكامل تحت تزامن حقيقي (سباق نادر لكن حقيقي
//      على فهرس pg_type الداخلي لو عمليتان نفَّذَتاها في نفس اللحظة تقريباً على قاعدة لم
//      يوجد فيها الجدول من قبل) — اكتُشف هذا فعلياً أثناء اختبار الحماية من التزامن.
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
//      ملف واحد أو أكثر:
//        a. Phase 3 — فحص هدّام: كل عبارة SQL في كل ملف مُعلَّق تُفحَص مقابل أنماط هدّامة
//           معروفة (DROP TABLE/DATABASE/SCHEMA، DROP COLUMN، TRUNCATE، أو DELETE/UPDATE
//           بلا WHERE — انظر findDestructiveStatements أسفل). أي تطابق بلا وجود سطر تأكيد
//           صريح (ALLOW_DESTRUCTIVE_MARKER) في نفس الملف → توقّف فوري قبل أي نسخة احتياطية
//           أو DDL، برسالة تُحدِّد الملف والعبارة بالضبط.
//        b. نسخة احتياطية واحدة للدفعة كاملة (backup.js، تفشل=توقّف كامل قبل أي DDL) ثم
//           تطبيق كل ملف مُعلَّق بترتيب تصاعدي، كل ملف داخل معاملة واحدة مستقلة (فشل ملف
//           واحد لا يُراجع الملفات السابقة الناجحة، ولا يُسجَّل صف تتبّع له إطلاقاً —
//           استئناف تلقائي من نفس الملف عند إعادة المحاولة).
//   6. لا يُستدعى app.listen() أبداً لو رمى runMigrations استثناءً — على المستدعي (server.js)
//      اصطياد الاستثناء وإيقاف العملية.
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

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

// ── Phase 3 — حماية العبارات الهدّامة (destructive-statement protection) ──
// أي عبارة SQL في ملف ترحيل معلَّق تُطابق أحد الأنماط التالية تُعتبَر قادرة على فقدان
// بيانات عميل حقيقية بلا رجعة، وتُوقِف بدء التشغيل تماماً ما لم يحتوِ نفس الملف على سطر
// تأكيد صريح (ALLOW_DESTRUCTIVE_MARKER) — لأن هذا النظام يُشغَّل تلقائياً وبلا مراجعة
// بشرية عند كل إقلاع خادم على جهاز كل عميل. النطاق مقصور على فقدان البيانات فعلياً (حذف
// جدول/عمود/قاعدة/كل الصفوف) — لا يشمل DROP TRIGGER/FUNCTION/CONSTRAINT/INDEX (تفقد سلوكاً
// لا بيانات) ولا RENAME (لا فقدان بيانات). DELETE/UPDATE بلا WHERE فقط هما الهدّامان من
// نوعهما — بوجود WHERE (أي نطاق محدود) تُعتبَران عمليتين طبيعيتين آمنتين.
export const ALLOW_DESTRUCTIVE_MARKER = '-- studix:allow-destructive';

const DESTRUCTIVE_STATEMENT_PATTERNS = [
  { pattern: /^\s*DROP\s+DATABASE\b/i, reason: 'DROP DATABASE — يحذف قاعدة بيانات كاملة' },
  { pattern: /^\s*DROP\s+SCHEMA\b/i, reason: 'DROP SCHEMA — يحذف كل الجداول داخل schema' },
  { pattern: /^\s*DROP\s+TABLE\b/i, reason: 'DROP TABLE — يحذف جدولاً وكل بياناته نهائياً' },
  { pattern: /^\s*TRUNCATE\b/i, reason: 'TRUNCATE — يحذف كل صفوف الجدول فوراً وبلا تراجع' },
  { pattern: /ALTER\s+TABLE\s+\S+\s+DROP\s+COLUMN\b/i, reason: 'ALTER TABLE ... DROP COLUMN — يحذف عموداً وكل بياناته نهائياً' },
  { pattern: /^\s*DELETE\s+FROM\b/i, reason: 'DELETE FROM بلا WHERE — يحذف كل صفوف الجدول', requiresNoWhere: true },
  { pattern: /^\s*UPDATE\b/i, reason: 'UPDATE بلا WHERE — يُعدِّل كل صفوف الجدول دفعة واحدة', requiresNoWhere: true },
];

/**
 * يفحص عبارات كل ملف من الملفات المُمرَّرة مقابل الأنماط الهدّامة أعلاه — لا يستدعي أي
 * قاعدة بيانات، فحص نصّي بحت على نفس العبارات التي يُنتجها splitSqlStatements فعلياً
 * (نفس التقسيم المُستخدَم لاحقاً وقت التنفيذ الحقيقي، لا تكرار منطق منفصل).
 * @returns {{ filename: string, reason: string, statement: string }[]}
 */
export function findDestructiveStatements(files) {
  const findings = [];
  for (const file of files) {
    for (const sql of splitSqlStatements(file.content)) {
      for (const { pattern, reason, requiresNoWhere } of DESTRUCTIVE_STATEMENT_PATTERNS) {
        if (pattern.test(sql) && (!requiresNoWhere || !/\bWHERE\b/i.test(sql))) {
          findings.push({ filename: file.filename, reason, statement: sql.trim().slice(0, 200) });
          break; // عبارة واحدة تُصنَّف بأول نمط مطابق فقط — لا تكرار لنفس العبارة
        }
      }
    }
  }
  return findings;
}

function fileAllowsDestructive(file) {
  return file.content.split('\n').some((line) => line.trim() === ALLOW_DESTRUCTIVE_MARKER);
}

/**
 * يرمي استثناءً واضحاً (يُحدِّد الملف والعبارة بالضبط) لو أي ملف من الملفات المُعلَّقة
 * المُمرَّرة يحتوي عبارة هدّامة بلا سطر تأكيد صريح في نفس الملف. لا تأثير على الملفات التي
 * تحتوي السطر — تُطبَّق عبارتها الهدّامة كالمعتاد (القرار مسؤولية مؤلف الملف بعد المراجعة).
 */
function assertNoUnacknowledgedDestructiveStatements(pendingFiles) {
  const offending = pendingFiles.filter((f) => !fileAllowsDestructive(f));
  const findings = findDestructiveStatements(offending);
  if (findings.length === 0) return;
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.filename)) byFile.set(f.filename, []);
    byFile.get(f.filename).push(f);
  }
  const details = [...byFile.entries()]
    .map(([filename, items]) => `  ${filename}:\n` + items.map((it) => `    - ${it.reason}\n      ${it.statement}`).join('\n'))
    .join('\n');
  throw new Error(
    `تم إيقاف بدء التشغيل — ملف(ات) ترحيل تحتوي عبارات SQL هدّامة (تُفقِد بيانات عميل حقيقية) بلا تأكيد صريح:\n${details}\n\n` +
    `لو هذا مقصود فعلاً وتمّت مراجعته يدوياً (ونُسخة احتياطية منفصلة أُخذت قبل النشر لهذا العميل)، أضف السطر التالي في أي مكان بملف الترحيل ثم أعد المحاولة:\n` +
    `  ${ALLOW_DESTRUCTIVE_MARKER}`
  );
}

// ── Phase 3 — تصليب القفل الاستشاري (advisory-lock connection affinity) ──
// pg_advisory_lock/unlock مرتبطان بجلسة/اتصال Postgres الفعلي، لا بعميل Prisma ككل —
// تجمّع اتصالات Prisma العادي (المُستخدَم لكل شيء آخر هنا) لا يضمن إطلاقاً أن استدعاءين
// منفصلين ($queryRaw) يقعان على نفس الاتصال الفعلي. connection_limit=1 يجبر Prisma على
// استخدام اتصال واحد فقط طوال عمر هذا العميل المخصَّص، فيضمن حرفياً أن الحصول على القفل
// والإفراج عنه يقعان على نفس الجلسة — بلا أي اعتماد جديد (معامل استعلام قياسي في Postgres).
function withConnectionLimit(databaseUrl, limit) {
  const u = new URL(databaseUrl);
  u.searchParams.set('connection_limit', String(limit));
  return u.toString();
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

// إطلاق أفضل-جهد (best-effort): يُستدعى دائماً من الـ finally في runMigrations على نفس
// عميل القفل المخصَّص (connection_limit=1) — لو فشل الاستدعاء نفسه (مثال: القاعدة انقطع
// اتصالها) لا نرمي هنا، العمل الفعلي اكتمل/فشل بالفعل قبل هذه النقطة، والقفل سيُحرَّر تلقائياً
// عند إغلاق ذلك الاتصال الوحيد (lockClient.$disconnect() في finally الخارجي بعده مباشرة).
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

  // Phase 3: عميل مخصَّص بـ connection_limit=1 — اتصال فعلي واحد فقط طوال عمره، يُستخدَم
  // حصراً لاستدعاءي القفل (الحصول عليه ثم الإفراج عنه) فيضمن وقوعهما على نفس الجلسة
  // حرفياً. يُفصَل دائماً في الـ finally الخارجي، بلا أي أثر على تجمّع اتصالات `prisma`
  // المُمرَّر (المُستخدَم لكل شيء آخر هنا — قراءة/تطبيق الترحيلات كالمعتاد).
  const lockClient = new PrismaClient({ datasources: { db: { url: withConnectionLimit(databaseUrl, 1) } } });
  try {
    const locked = await tryAcquireLock(lockClient);
    if (!locked) {
      throw new Error(
        'تعذّر الحصول على قفل الترحيل (pg_try_advisory_lock) — عملية ترحيل أخرى تعمل بالفعل على ' +
        'نفس القاعدة. تم إيقاف بدء التشغيل بدل انتظار أبدي.'
      );
    }

    try {
      return await runMigrationsLocked(prisma, { migrationsDir, backupFn, databaseUrl });
    } finally {
      await releaseLock(lockClient);
    }
  } finally {
    await lockClient.$disconnect().catch(() => {});
  }
}

// الجسم الفعلي لمنطق الترحيل — يعمل دائماً تحت حماية القفل الاستشاري المُحصَّل عليه في
// runMigrations أعلاه. مفصول في دالة مستقلة فقط لإبقاء منطق اكتساب/تحرير القفل (Phase 3)
// واضحاً ومعزولاً عن منطق الترحيل نفسه (Phase 1، غير مُعدَّل هنا في جوهره).
async function runMigrationsLocked(prisma, { migrationsDir, backupFn, databaseUrl }) {
  // Phase 3: يُستدعى هنا (بعد اكتساب القفل)، لا قبله — CREATE TABLE IF NOT EXISTS ليست
  // آمنة بالكامل تحت تزامن حقيقي (سباق نادر لكن حقيقي على فهرس pg_type الداخلي لو
  // عمليتان نفَّذَتاها في نفس اللحظة تقريباً على قاعدة لم يوجد فيها الجدول من قبل) —
  // اكتُشف هذا فعلياً أثناء اختبار الحماية من التزامن (migrationRunner.integration.test.js).
  // بعد اكتساب القفل، لا عملية أخرى موازية تصل هذه النقطة إطلاقاً، فالسباق يستحيل بنيوياً.
  await ensureTrackingTable(prisma);

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

  // Phase 3: يتوقّف هنا فوراً (قبل أي نسخة احتياطية أو DDL) لو أي ملف معلَّق يحتوي عبارة
  // هدّامة بلا تأكيد صريح — انظر assertNoUnacknowledgedDestructiveStatements أعلاه.
  assertNoUnacknowledgedDestructiveStatements(pending);

  let backupPath = null;
  if (backupFn) {
    backupPath = await backupFn(databaseUrl); // يرمي استثناءً لو فشلت النسخة — نتوقّف قبل أي DDL
  }

  for (const file of pending) {
    await applyMigrationFile(prisma, file);
  }

  return { action: 'migrated', versions: pending.map((f) => f.version), backupPath };
}
