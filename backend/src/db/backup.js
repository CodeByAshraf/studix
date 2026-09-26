// backend/src/db/backup.js
// ─────────────────────────────────────────────────────────────
// نسخة احتياطية كاملة (schema + data) قبل أي دفعة ترحيل تحتوي ملفاً معلَّقاً واحداً على
// الأقل. تُستدعى من migrationRunner.js فقط عند وجود عمل فعلي — لا نسخة إطلاقاً عند
// إقلاع عادي بلا ترحيلات معلَّقة. فشل النسخة = توقّف كامل قبل أي DDL (migrationRunner.js
// يترك الاستثناء يصعد قبل تطبيق أي ملف).
//
// Backup Reliability Phase 1 fix — findPgDump() كانت تبحث حصراً في مسار تثبيت PostgreSQL
// المستقل التقليدي (C:\Program Files\PostgreSQL\<إصدار>\bin) — مسار لا وجود له إطلاقاً على
// جهاز عميل حقيقي، الذي لا يملك سوى نسخة PostgreSQL المُرفَقة (bundled) التي يُثبِّتها Studix
// نفسه تحت <جذر تثبيت Studix>\pgsql\bin. كان هذا يعمل فقط على أجهزة التطوير التي يصادف
// وجود تثبيت PostgreSQL مستقل منفصل عليها (كما هو الحال على جهاز التطوير هذا) — أي أن
// النسخة الاحتياطية التلقائية قبل الترحيل على أي تثبيت عميل حقيقي كانت شبه مضمونة الفشل
// (pg_dump.exe غير موجود إطلاقاً)، فتوقَّف كل ترحيل مستقبلي قبل أي DDL (سلوك fail-closed
// آمن، لكنه يمنع أي تحديث مستقبلي للتطبيق تماماً على أي جهاز عميل).
//
// الإصلاح: إعادة استخدام resolvePgHome() الحقيقية نفسها من postgresProvisioning.js (نفس
// الآلية المُثبَتة فعلياً التي يعتمد عليها تزويد PostgreSQL بالكامل) — لا خوارزمية مسار
// ثانية مستقلة. resolvePgHome() تُحلّ STUDIX_PG_HOME صراحةً، وإلا فمساراً نسبياً لـ
// __dirname يطابق تماماً <جذر تثبيت Studix>\pgsql عند التشغيل من التثبيت الفعلي (نفس مبدأ
// DIST_DIR في server.js) — يعمل بعد نقل مجلد التثبيت بالكامل، لأنه نسبي لموقع الكود نفسه
// دائماً، لا مساراً مطلقاً ثابتاً.
//
// ترتيب الفحص الجديد: (1) PG_DUMP_PATH صراحةً (سلوك محفوظ 100% كما كان) → (2) المسار
// المُرفَق الصحيح عبر resolvePgHome() (الإصلاح الفعلي — يعمل على أي تثبيت عميل حقيقي) →
// (3) احتياطي أخير فقط للتوافق مع بيئات تطوير قديمة تعتمد على تثبيت PostgreSQL مستقل (نفس
// السلوك القديم بالضبط، لكن بأولوية أدنى الآن، لا الأولوية الوحيدة) — لا إزالة لقدرة كانت
// موجودة فعلاً، فقط تصحيح أولويتها.
//
// صيغة الإخراج: custom format (-F c) — مضغوطة، تدعم pg_restore انتقائياً مستقبلاً (استعادة
// خارج نطاق Phase 1 عمداً). المسار الافتراضي %ProgramData%\Studix\backups\ (قابل للتجاوز
// عبر STUDIX_BACKUP_DIR — لاختبارات التطوير فقط، حتى لا تُترَك ملفات اختبار في المسار
// الحقيقي على جهاز المطوّر).
// ─────────────────────────────────────────────────────────────
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { resolvePgHome } from './postgresProvisioning.js';
import { classifySchemaState } from './bootstrapDatabase.js';

// legacy احتياطي أخير فقط (انظر التعليق أعلاه) — نفس المسار المستقل الذي كان الفحص
// الوحيد سابقاً، مُبقى عليه لتوافق أجهزة تطوير قديمة، لا للاعتماد عليه في الإنتاج.
// legacyPgRoot قابل للتجاوز (اختبارات فقط — Test 2 يحتاج التحكّم في كلا المسارين معاً
// لإثبات "غير موجود في أي مكان" بلا الاعتماد على/التأثّر بتثبيت PostgreSQL مستقل حقيقي
// قد يصادف وجوده فعلاً على جهاز التطوير الحالي).
// اسم الملف عام (binaryName) — نفس الدالة تخدم pg_dump.exe/pg_restore.exe معاً (Phase 2A)،
// بلا نسخ الخوارزمية.
function findLegacyStandaloneBinary(binaryName, legacyPgRoot = 'C:\\Program Files\\PostgreSQL') {
  if (!fs.existsSync(legacyPgRoot)) return null;
  const versions = fs.readdirSync(legacyPgRoot).sort().reverse(); // أحدث إصدار أولاً
  for (const v of versions) {
    const candidate = path.join(legacyPgRoot, v, 'bin', binaryName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// resolveBundledBinary: المنطق المُشترَك بين findPgDump/findPgRestore بالضبط — ترتيب فحص
// واحد لكلا الثنائيين (Phase 2A: "لا خوارزمية مسار ثانية مستقلة" يشمل pg_restore أيضاً،
// لا pg_dump وحده). envOverride/envOverrideName منفصلان لكل ثنائي (PG_DUMP_PATH مقابل
// PG_RESTORE_PATH) — نفس فلسفة التجاوز الصريح بالضبط، لا آلية جديدة مختلفة.
function resolveBundledBinary(binaryName, { envOverrideName, pgHome, legacyPgRoot }) {
  const envOverride = process.env[envOverrideName];
  if (envOverride && fs.existsSync(envOverride)) return envOverride;

  const bundledCandidate = path.join(pgHome, 'bin', binaryName);
  if (fs.existsSync(bundledCandidate)) return bundledCandidate;

  const legacyCandidate = findLegacyStandaloneBinary(binaryName, legacyPgRoot);
  if (legacyCandidate) return legacyCandidate;

  throw new Error(
    `تعذّر العثور على ${binaryName}. توقّفت العملية عمداً — لا متابعة آمنة بلا الثنائي الحقيقي. ` +
    'المسارات التي فُحصت:\n' +
    `  - ${envOverrideName} (متغيّر بيئة صريح): ${envOverride || '(غير محدَّد)'}\n` +
    `  - ${bundledCandidate} (نسخة PostgreSQL المُرفَقة مع تثبيت Studix، عبر resolvePgHome())\n` +
    `  - ${legacyPgRoot}\\<إصدار>\\bin\\${binaryName} (تثبيت مستقل، احتياطي أخير لأجهزة التطوير)\n` +
    `حدِّد المسار الصحيح صراحةً عبر متغيّر البيئة ${envOverrideName} لو كان تخطيط القرص مختلفاً.`
  );
}

/**
 * يُصدَّر ليكون قابلاً للاختبار مباشرة (Test 1/2) بلا حاجة لتقليد fs بالكامل — يقبل pgHome
 * صريحاً (تجاوز اختياري لـ resolvePgHome() الحقيقية) ليتحقّق اختبار حقيقي من تخطيط قرص
 * فعلي (مجلد pgHome حقيقي يحتوي bin\pg_dump.exe حقيقياً) لا مجرّد قيمة مُقلَّدة.
 * @param {string} [pgHome] - افتراضياً resolvePgHome() الحقيقية (نفس آلية تزويد PostgreSQL).
 * @param {string} [legacyPgRoot] - افتراضياً المسار المستقل الحقيقي (اختبارات فقط للتجاوز).
 * @returns {string} المسار الكامل إلى pg_dump.exe المُكتشَف.
 */
export function findPgDump(pgHome = resolvePgHome(), legacyPgRoot = 'C:\\Program Files\\PostgreSQL') {
  return resolveBundledBinary('pg_dump.exe', { envOverrideName: 'PG_DUMP_PATH', pgHome, legacyPgRoot });
}

/**
 * Phase 2A — نفس آلية findPgDump() بالضبط، لثنائي pg_restore.exe، بنفس فلسفة التجاوز
 * (PG_RESTORE_PATH بدل PG_DUMP_PATH) — لا آلية بيئة جديدة غير مرتبطة.
 * @param {string} [pgHome]
 * @param {string} [legacyPgRoot]
 * @returns {string} المسار الكامل إلى pg_restore.exe المُكتشَف.
 */
export function findPgRestore(pgHome = resolvePgHome(), legacyPgRoot = 'C:\\Program Files\\PostgreSQL') {
  return resolveBundledBinary('pg_restore.exe', { envOverrideName: 'PG_RESTORE_PATH', pgHome, legacyPgRoot });
}

function getBackupDir() {
  if (process.env.STUDIX_BACKUP_DIR) return process.env.STUDIX_BACKUP_DIR;
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  return path.join(programData, 'Studix', 'backups');
}

/**
 * يأخذ نسخة احتياطية كاملة (custom format) من قاعدة البيانات المُمرَّرة، يكتبها إلى مجلد
 * النسخ الاحتياطية، ويتحقّق فعلياً من وجودها/حجمها قبل الإعادة. يرمي استثناءً واضحاً عند
 * أي فشل (pg_dump غير موجود، فشل الأمر نفسه، أو ملف ناتج فارغ/غير موجود).
 * @param {string} databaseUrl
 * @param {{ pgHome?: string, legacyPgRoot?: string }} [opts] - تجاوزان اختياريان (اختبارات
 *   فقط) — افتراضياً resolvePgHome() الحقيقية والمسار المستقل الحقيقي على الترتيب.
 * @returns {Promise<string>} المسار الكامل لملف النسخة الاحتياطية الناتج
 */
export async function createPreMigrationBackup(databaseUrl, opts = {}) {
  const pgDumpPath = findPgDump(opts.pgHome, opts.legacyPgRoot);
  const backupDir = getBackupDir();
  fs.mkdirSync(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `pre-migration-${timestamp}.dump`);

  try {
    execFileSync(pgDumpPath, [databaseUrl, '-F', 'c', '-f', backupPath], { encoding: 'utf8' });
  } catch (err) {
    throw new Error(`فشل أخذ نسخة احتياطية قبل الترحيل: ${err.message}`);
  }

  let stat;
  try {
    stat = fs.statSync(backupPath);
  } catch {
    throw new Error(`فشل التحقق من النسخة الاحتياطية — الملف غير موجود بعد pg_dump: ${backupPath}`);
  }
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`فشل التحقق من النسخة الاحتياطية — الملف فارغ: ${backupPath}`);
  }

  return backupPath;
}

/**
 * Phase 2A — restoreBackup: منخفض المستوى، نطاق ضيق عمداً. يستعيد dump (custom format) إلى
 * قاعدة بيانات هدف يجب أن تكون فارغة تماماً بالفعل (لا جداول إطلاقاً) — الدالة لا تُنشئ
 * القاعدة الهدف ولا تحذف/تُنظِّف أي شيء موجود فيها؛ ترفض بوضوح لو لم تكن فارغة، بدل --clean
 * أو أي حذف ضمني. هذا هو العقد المُختار عمداً (الأبسط والأكثر أماناً): المُستدعي يُنشئ قاعدة
 * فارغة جديدة أولاً (بأي آلية توفير موجودة)، ثم يُمرِّرها هنا.
 *
 * OD3 — هذه الدالة لا تقرأ STUDIX_DB_ADMIN_URL ولا أي ملف إعداد تشغيل حقيقي إطلاقاً، ولا
 * تُستورَد في server.js/lib/config.js. targetDatabaseUrl يصل صراحةً من المُستدعي فقط — لا
 * إضعاف لحدود الصلاحيات الحالية.
 *
 * الخطوات: (1) تحقّق من وجود/حجم ملف النسخة، (2) اكتشاف pg_restore.exe (نفس آلية
 * findPgDump تماماً)، (3) تحقّق قراءة-فقط من صحة الأرشيف عبر pg_restore --list قبل أي عملية
 * هدّامة، (4) تحقّق أن الهدف فارغ فعلاً (classifySchemaState المُستخدَمة فعلياً في
 * bootstrapDatabase.js — لا منطق تصنيف مكرَّر)، (5) استعادة حقيقية بلا --clean (الهدف فارغ
 * بالفعل، فلا حاجة له) وبلا --no-owner/--no-privileges (الهدف من الاستعادة هو عكس نفس
 * ownership/GRANTs الحقيقية — studix_admin/studix_app — التي كانت موجودة وقت أخذ النسخة).
 *
 * @param {string} backupPath - مسار ملف .dump حقيقي (custom format، من pg_dump -F c).
 * @param {string} targetDatabaseUrl - رابط اتصال بقاعدة هدف موجودة بالفعل وفارغة تماماً.
 * @param {{ pgHome?: string, legacyPgRoot?: string }} [opts] - نفس تجاوزات findPgDump (اختبارات فقط).
 * @returns {Promise<{ targetDatabaseUrl: string, backupPath: string, durationMs: number }>}
 */
export async function restoreBackup(backupPath, targetDatabaseUrl, opts = {}) {
  let backupStat;
  try {
    backupStat = fs.statSync(backupPath);
  } catch {
    throw new Error(`ملف النسخة الاحتياطية غير موجود: ${backupPath}`);
  }
  if (!backupStat.isFile() || backupStat.size === 0) {
    throw new Error(`ملف النسخة الاحتياطية فارغ أو ليس ملفاً حقيقياً: ${backupPath}`);
  }

  const pgRestorePath = findPgRestore(opts.pgHome, opts.legacyPgRoot);

  // تحقّق قراءة فقط من صحة الملف قبل أي عملية هدّامة — pg_restore --list لا يتصل بأي قاعدة
  // بيانات إطلاقاً، لا يكتب شيئاً، فقط يقرأ ترويسة/فهرس الأرشيف نفسه.
  try {
    execFileSync(pgRestorePath, ['--list', backupPath], { encoding: 'utf8' });
  } catch (err) {
    throw new Error(`ملف النسخة الاحتياطية تالف أو غير صالح — فشل التحقّق منه (pg_restore --list): ${err.message}`);
  }

  // الهدف يجب أن يكون فارغاً تماماً — نرفض بوضوح بدل أي حذف/--clean ضمني لو لم يكن كذلك.
  const targetState = await classifySchemaState(targetDatabaseUrl);
  if (targetState.state !== 'uninitialized') {
    throw new Error(
      `قاعدة البيانات الهدف ليست فارغة (الحالة: ${targetState.state}، عدد الجداول: ${targetState.tableCount}) — ` +
      'تم الرفض بدل حذف/استبدال أي بيانات موجودة. استعد إلى قاعدة جديدة فارغة تماماً بدلاً من ذلك.'
    );
  }

  const start = Date.now();
  try {
    execFileSync(pgRestorePath, ['--dbname', targetDatabaseUrl, backupPath], { encoding: 'utf8' });
  } catch (err) {
    throw new Error(`فشلت عملية الاستعادة (pg_restore): ${err.message}`);
  }
  const durationMs = Date.now() - start;

  // تحقّق ما بعد الاستعادة — فشل صامت (pg_restore بلا استثناء ظاهر لكن الهدف بقي فارغاً)
  // مرفوض صراحة، لا يُعامَل كنجاح.
  const afterState = await classifySchemaState(targetDatabaseUrl);
  if (afterState.state === 'uninitialized') {
    throw new Error('انتهت عملية pg_restore بلا خطأ ظاهر، لكن قاعدة البيانات الهدف ما زالت فارغة — فشل استعادة صامت.');
  }

  return { targetDatabaseUrl, backupPath, durationMs };
}
