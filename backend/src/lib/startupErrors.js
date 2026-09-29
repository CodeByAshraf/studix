// backend/src/lib/startupErrors.js
// ─────────────────────────────────────────────────────────────
// Phase 6b — turns a handful of common, expected startup failures (Phase 6a §3/§9/§16) into
// a single clear operator-facing line instead of a raw Node/Prisma stack trace as the primary
// message. Deliberately narrow: only classifies the specific failure modes named in the
// Phase 6a investigation (missing/malformed DATABASE_URL, unreachable PostgreSQL, port
// already in use) — anything else falls back to the underlying error's own message,
// unmodified. The full original error (message + stack) is still handed to the logger
// separately by the caller for the log file's complete diagnostic detail; this module only
// produces the short human summary.
//
// Never includes the actual DATABASE_URL value (which may contain a password) anywhere in a
// thrown message or a returned string — every message below is a fixed template, never string
// interpolation of the raw connection string.
// ─────────────────────────────────────────────────────────────
export class ConfigError extends Error {}

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

// validateDatabaseUrl: throws ConfigError with a friendly, secret-free message. Called once,
// before runMigrations, so a missing/malformed DATABASE_URL fails with a clear explanation
// instead of migrationRunner.js's internal `new URL(undefined)` TypeError.
export function validateDatabaseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new ConfigError(
      'DATABASE_URL غير معرَّف. أضِف رابط اتصال PostgreSQL صالحاً في ملف الإعداد ' +
      '(.env في وضع التطوير، أو ملف الإعداد المُثبَّت في الإنتاج) — الشكل المتوقَّع: ' +
      'postgresql://USER:PASSWORD@HOST:PORT/DATABASE. لا يمكن بدء تشغيل الخادم بدونه.'
    );
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ConfigError(
      'DATABASE_URL موجود لكن شكله غير صالح. تحقّق من ملف الإعداد — يجب أن يكون رابط اتصال ' +
      'PostgreSQL كاملاً وصحيحاً (postgresql://USER:PASSWORD@HOST:PORT/DATABASE).'
    );
  }
  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new ConfigError(
      `DATABASE_URL يستخدم بروتوكولاً غير مدعوم ("${parsed.protocol}") — يجب أن يبدأ بـ ` +
      'postgres:// أو postgresql://.'
    );
  }
}

// M3 — Studix's production port is fixed at 4000: the built frontend (src/services/api.js) and
// the installer's Start-menu shortcut both target it, so changing PORT alone would break the UI.
// The operator's only correct action is to free the port. Shared by describeStartupFailure below
// (runtime EADDRINUSE) and firstInstall.js's pre-start port check, so the two never drift apart.
// `port` is reported as-is so development/smoke-test runs on another port still say which one.
export const STUDIX_APP_PORT = 4000;

export function describePortInUse(port = STUDIX_APP_PORT) {
  return (
    `المنفذ ${port} مستخدَم بالفعل من برنامج آخر على هذا الجهاز. يعمل Studix على المنفذ الثابت ` +
    `${STUDIX_APP_PORT} ولا يُدعَم تغييره من ملف الإعداد (واجهة Studix مبنيّة على هذا المنفذ). ` +
    `أغلق البرنامج الذي يستخدم المنفذ ${port} أو أوقف تشغيله التلقائي، ثم أعد تشغيل خدمة StudixApp ` +
    `أو أعد تشغيل برنامج إعداد Studix. للتشخيص: netstat -ano | findstr :${port}`
  );
}

// describeStartupFailure: best-effort classification for the log/console summary line.
// Anything unrecognized falls back to err.message verbatim — safe, since none of the
// recognized Prisma/Node error shapes handled here ever embed the DATABASE_URL value itself.
export function describeStartupFailure(err) {
  if (err instanceof ConfigError) return err.message;

  if (err?.code === 'EADDRINUSE') {
    return describePortInUse(err.port ?? STUDIX_APP_PORT);
  }

  const message = String(err?.message || '');
  if (err?.errorCode === 'P1001' || /Can't reach database server/i.test(message)) {
    return 'تعذّر الوصول إلى خادم PostgreSQL — تأكد أن خدمة PostgreSQL تعمل وأن DATABASE_URL يشير إلى المضيف والمنفذ الصحيحين.';
  }
  if (/Environment variable not found/i.test(message)) {
    return 'إعداد ناقص: متغيّر بيئة مطلوب غير موجود — راجع ملف الإعداد.';
  }
  return message || 'فشل غير متوقَّع أثناء بدء التشغيل.';
}
