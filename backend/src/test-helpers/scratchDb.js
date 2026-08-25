// backend/src/test-helpers/scratchDb.js
// ─────────────────────────────────────────────────────────────
// MEDIUM-B1 — بنية اختبار تكامل حقيقية على قاعدة بيانات مؤقتة منفصلة (scratch)، بنفس
// المنهجية التي أثبتت جدواها فعلاً أثناء إغلاق 3B-14B/3B-14C (انظر migration/reports/
// PHASE_3B-14B_TREASURY_TXN_AUDIT.md §17 وPHASE_3B-14C_PAYMENTS_TREASURY_AUDIT.md §22):
//   1. اشتقاق اسم قاعدة scratch من DATABASE_URL الحقيقي (لا تُلمَس studix إطلاقاً).
//   2. CREATE DATABASE عبر اتصال بقاعدة الصيانة `postgres` (لا يمكن إنشاء قاعدة وأنت
//      متصل بها نفسها).
//   3. `prisma db push` (سطر أوامر منفصل، DATABASE_URL يُمرَّر فقط لهذا الاستدعاء الفرعي
//      عبر env، لا يُعدَّل process.env الحالي للعملية إطلاقاً) — يُطابق الجداول/الأعمدة/
//      الـ FKs من schema.prisma. لا triggers ولا CHECK constraints (schema.prisma لا
//      يُمثّلها إطلاقاً — قيد معروف، مُوثَّق في تقرير MEDIUM-B1، مُتروك عمداً لـ MEDIUM-B2).
//   4. حقن PrismaClient الجديد عبر globalThis.prisma (نفس تقنية prisma.js's dev-singleton
//      المُستخدَمة بالفعل) — قبل أي import ديناميكي لملفات routes، فتلتقطه هي أيضاً بلا
//      أي تعديل على prisma.js نفسه.
//   5. DROP DATABASE بعد الاختبار — قاعدة studix الحقيقية لا تُلمَس بأي خطوة هنا إطلاقاً.
// ─────────────────────────────────────────────────────────────
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..', '..'); // backend/

// اسم قاعدة بيانات آمن للحقن في SQL خام (CREATE/DROP DATABASE لا يقبلان $1 placeholders
// في Postgres) — نتحقّق أنه أحرف/أرقام/underscore فقط قبل أي استخدام، احترازاً، رغم أننا
// نولّده نحن أنفسنا داخلياً ولا يصل أبداً من مدخل مستخدم.
const SAFE_DB_NAME = /^[a-zA-Z0-9_]+$/;

function assertSafeDbName(name) {
  if (!SAFE_DB_NAME.test(name)) {
    throw new Error(`اسم قاعدة scratch غير آمن للاستخدام في SQL خام: "${name}"`);
  }
}

function getRealDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL غير معرَّف — لا يمكن اشتقاق قاعدة scratch منه.');
  return url;
}

function withDatabaseName(databaseUrl, dbName) {
  const u = new URL(databaseUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

function getDbNameFromUrl(databaseUrl) {
  return new URL(databaseUrl).pathname.replace(/^\//, '');
}

/**
 * فحص وصول أولي (غير هدّام تماماً — SELECT 1 فقط) قبل أي محاولة إنشاء scratch —
 * يسمح لملفات الاختبار بتخطّي الاختبارات بوضوح (لا فشل صامت، لا "نجاح" مزيَّف) لو
 * تعذّر الوصول لـ Postgres أو لو الصلاحيات ناقصة.
 */
export async function checkPostgresReachable() {
  const realUrl = process.env.DATABASE_URL;
  if (!realUrl) {
    return { reachable: false, reason: 'DATABASE_URL غير معرَّف في بيئة الاختبار.' };
  }
  const maintenanceUrl = withDatabaseName(realUrl, 'postgres');
  const client = new PrismaClient({ datasources: { db: { url: maintenanceUrl } } });
  try {
    await client.$queryRaw`SELECT 1`;
    // فحص صلاحية CREATEDB فعلياً (لا افتراض) — pg_roles.rolcreatedb للمستخدم الحالي.
    const rows = await client.$queryRaw`SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user`;
    const canCreateDb = Array.isArray(rows) && rows[0]?.rolcreatedb === true;
    if (!canCreateDb) {
      return { reachable: false, reason: 'المستخدم الحالي في DATABASE_URL بلا صلاحية CREATEDB.' };
    }
    return { reachable: true, reason: null };
  } catch (err) {
    return { reachable: false, reason: `تعذّر الاتصال بخادم PostgreSQL: ${err.message}` };
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

/**
 * ينشئ قاعدة scratch فريدة لهذا الملف (namespace)، يدفع schema.prisma إليها، ويحقن
 * PrismaClient جديداً متصلاً بها عبر globalThis.prisma.
 * @param {string} namespace - مُعرِّف قصير فريد لكل ملف اختبار (مثال: 'payments')
 * @returns {{ scratchDbName: string, scratchUrl: string, client: PrismaClient }}
 */
export async function setupScratchDb(namespace) {
  const realUrl = getRealDatabaseUrl();
  const realDbName = getDbNameFromUrl(realUrl);
  const scratchDbName = `${realDbName}_test_scratch_${namespace}`;
  assertSafeDbName(scratchDbName);

  const maintenanceUrl = withDatabaseName(realUrl, 'postgres');
  const scratchUrl = withDatabaseName(realUrl, scratchDbName);

  // فحص أمان صريح: قاعدة scratch يجب ألا تكون أبداً نفس قاعدة التطوير الحقيقية —
  // لو تطابقتا (خطأ في اشتقاق الاسم مثلاً)، نتوقّف فوراً بدل المخاطرة بأي أمر لاحق.
  if (scratchDbName === realDbName || scratchUrl === realUrl) {
    throw new Error(
      `فحص الأمان فشل: اسم/رابط قاعدة scratch المُشتقّ يطابق قاعدة التطوير الحقيقية ` +
      `("${realDbName}"). تم الإيقاف قبل أي CREATE/DROP DATABASE أو db push.`
    );
  }

  // ── 1) إنشاء قاعدة scratch (اتصال بقاعدة الصيانة postgres، لا studix) ──
  const maintClient = new PrismaClient({ datasources: { db: { url: maintenanceUrl } } });
  try {
    // DROP IF EXISTS احترازي أولاً — لو بقيت قاعدة scratch من تشغيلة سابقة انهارت قبل
    // التنظيف، نبدأ من صفر نظيف بدل فشل CREATE DATABASE بخطأ "already exists".
    await dropDatabaseByName(maintClient, scratchDbName);
    await maintClient.$executeRawUnsafe(`CREATE DATABASE "${scratchDbName}"`);
  } finally {
    await maintClient.$disconnect().catch(() => {});
  }

  // ── 2) دفع schema.prisma (بدون migrations — نفس قيد المشروع القائم) ──
  // ملاحظة موثَّقة صراحة في تقرير MEDIUM-B1: هذا لا يُنشئ triggers/CHECK constraints
  // (schema.prisma لا يُمثّلها) — قيد معروف ومقبول لهذه المرحلة (MEDIUM-B1)، مُؤجَّل
  // عمداً لـ MEDIUM-B2. DATABASE_URL يُمرَّر فقط لهذه العملية الفرعية — process.env
  // الحالي للعملية الأم لا يُعدَّل إطلاقاً.
  try {
    execSync('npx prisma db push --skip-generate --accept-data-loss', {
      cwd: BACKEND_ROOT,
      env: { ...process.env, DATABASE_URL: scratchUrl },
      stdio: 'pipe',
    });
  } catch (err) {
    // تنظيف القاعدة الناقصة قبل رمي الخطأ — لا نترك قاعدة scratch نصف-مُهيَّأة معلَّقة.
    await dropScratchDbByUrl(maintenanceUrl, scratchDbName).catch(() => {});
    const output = err.stdout?.toString() || err.stderr?.toString() || err.message;
    throw new Error(`فشل "prisma db push" على قاعدة scratch: ${output}`);
  }

  // ── 3) حقن عميل Prisma جديد متصل بـ scratch عبر globalThis (نفس نمط prisma.js) ──
  const client = new PrismaClient({ datasources: { db: { url: scratchUrl } } });
  globalThis.prisma = client;

  return { scratchDbName, scratchUrl, maintenanceUrl, client };
}

async function dropDatabaseByName(maintClient, dbName) {
  // إنهاء أي اتصالات نشطة أولاً — Postgres يرفض DROP DATABASE على قاعدة بها اتصالات حيّة.
  await maintClient.$executeRawUnsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    dbName
  );
  await maintClient.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
}

async function dropScratchDbByUrl(maintenanceUrl, scratchDbName) {
  const maintClient = new PrismaClient({ datasources: { db: { url: maintenanceUrl } } });
  try {
    await dropDatabaseByName(maintClient, scratchDbName);
  } finally {
    await maintClient.$disconnect().catch(() => {});
  }
}

/**
 * يفصل عميل scratch، يمسح globalThis.prisma (حتى لا يُوَرَّث خطأً لملف اختبار لاحق في
 * نفس الـ worker)، ثم يحذف قاعدة scratch نفسها. studix الحقيقية لا تُلمَس بأي خطوة هنا.
 */
export async function teardownScratchDb({ scratchDbName, maintenanceUrl, client }) {
  await client.$disconnect().catch(() => {});
  if (globalThis.prisma === client) {
    delete globalThis.prisma;
  }
  await dropScratchDbByUrl(maintenanceUrl, scratchDbName);
}
