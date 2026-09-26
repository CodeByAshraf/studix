// src/modules/settings/backupStatusWarnings.js
// P1-1 — the problems an administrator must act on, derived from GET /api/backup-status.
// Shown by DatabaseBackupSection as a red banner — never hidden.

// A daily backup older than this means at least one scheduled run was missed or failed.
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

export function backupWarnings(status, now = Date.now()) {
  const warnings = [];
  if (status.schedule?.registered === false) {
    warnings.push('مهمة النسخ الاحتياطي اليومية غير مسجَّلة في Windows — أعد تشغيل مُثبِّت Studix لتسجيلها.');
  }
  if (!status.lastSuccess) {
    warnings.push('لا توجد أي نسخة احتياطية ناجحة لقاعدة البيانات بعد.');
  } else if (now - new Date(status.lastSuccess.finishedAt).getTime() > STALE_AFTER_MS) {
    warnings.push('آخر نسخة احتياطية ناجحة أقدم من يومين — تحقّق من تشغيل الجهاز ومن سجلّ Studix.');
  }
  if (status.lastRun?.status === 'failed') {
    warnings.push(`فشلت آخر محاولة نسخ احتياطي: ${status.lastRun.error || status.lastRun.reason || 'سبب غير معروف'}`);
  }
  if (status.lastRun?.status === 'warning') {
    warnings.push('آخر نسخة احتياطية نجحت، لكن حذف النسخ القديمة منتهية الصلاحية فشل جزئياً — راجع سجلّ Studix.');
  }
  if (!status.statusReadable) warnings.push('ملف حالة النسخ الاحتياطي تالف أو غير مقروء.');
  if (status.listError) warnings.push(status.listError);
  return warnings;
}
