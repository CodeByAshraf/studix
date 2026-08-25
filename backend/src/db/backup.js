// backend/src/db/backup.js
// ─────────────────────────────────────────────────────────────
// نسخة احتياطية كاملة (schema + data) قبل أي دفعة ترحيل تحتوي ملفاً معلَّقاً واحداً على
// الأقل. تُستدعى من migrationRunner.js فقط عند وجود عمل فعلي — لا نسخة إطلاقاً عند
// إقلاع عادي بلا ترحيلات معلَّقة. فشل النسخة = توقّف كامل قبل أي DDL (migrationRunner.js
// يترك الاستثناء يصعد قبل تطبيق أي ملف).
//
// نفس منطق اكتشاف pg_dump.exe الموجود بالفعل في backend/scripts/generateSchemaArtifact.js
// (بحث في C:\Program Files\PostgreSQL\<إصدار>\bin، أو PG_DUMP_PATH صراحةً) — مُكرَّر هنا
// عمداً (سكربتان مستقلّان صغيران، لا تجريد سابق لأوانه).
//
// صيغة الإخراج: custom format (-F c) — مضغوطة، تدعم pg_restore انتقائياً مستقبلاً (استعادة
// خارج نطاق Phase 1 عمداً). المسار الافتراضي %ProgramData%\Studix\backups\ (قابل للتجاوز
// عبر STUDIX_BACKUP_DIR — لاختبارات التطوير فقط، حتى لا تُترَك ملفات اختبار في المسار
// الحقيقي على جهاز المطوّر).
// ─────────────────────────────────────────────────────────────
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function findPgDump() {
  if (process.env.PG_DUMP_PATH && fs.existsSync(process.env.PG_DUMP_PATH)) {
    return process.env.PG_DUMP_PATH;
  }
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
 * @returns {Promise<string>} المسار الكامل لملف النسخة الاحتياطية الناتج
 */
export async function createPreMigrationBackup(databaseUrl) {
  const pgDumpPath = findPgDump();
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
