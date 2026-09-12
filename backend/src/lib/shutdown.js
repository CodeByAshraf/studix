// backend/src/lib/shutdown.js
// ─────────────────────────────────────────────────────────────
// Phase 6b — graceful shutdown for a Node process meant to run unattended as a Windows
// Service (Phase 6a §9 — no SIGINT/SIGTERM handler existed before this). Separated from
// server.js so the shutdown sequence itself (idempotency, timeout, Prisma cleanup) is
// unit-testable without booting a real HTTP server or a real database connection — see
// shutdown.test.js.
//
// createGracefulShutdown returns a plain async function; it does NOT register any process
// signal listeners itself (see registerShutdownHandlers below) — kept separate so tests can
// invoke the shutdown logic directly, including calling it twice to prove idempotency,
// without ever sending a real OS signal to the test process.
//
// server.close() stops accepting new connections and waits for existing sockets to close
// (including idle keep-alive ones, which — under default Node HTTP keep-alive — could in
// principle linger). The timeoutMs backstop below is the deliberate, documented answer to
// that: rather than forcibly closing sockets (server.closeAllConnections(), Node 18.2+,
// which would also cut off a genuinely in-flight request), a short bounded wait is given for
// a normal close, and if it doesn't happen in time, the process exits anyway. This keeps the
// implementation simple while still guaranteeing the process never hangs forever on shutdown.
// ─────────────────────────────────────────────────────────────
export function createGracefulShutdown({ server, prisma, logger, timeoutMs = 10_000, exitFn = process.exit }) {
  let shuttingDown = false;

  return async function shutdown(signal) {
    if (shuttingDown) {
      logger.warn('إشارة إيقاف إضافية أثناء إيقاف تشغيل جارٍ بالفعل — تم تجاهلها.', { signal });
      return;
    }
    shuttingDown = true;
    logger.info('بدء إيقاف تشغيل آمن (graceful shutdown).', { signal });

    const forceTimer = setTimeout(() => {
      logger.error('تجاوز إيقاف التشغيل الآمن المهلة المسموحة — إنهاء إجباري للعملية.', { timeoutMs });
      exitFn(1);
    }, timeoutMs);

    try {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await prisma.$disconnect();
      clearTimeout(forceTimer);
      logger.info('اكتمل إيقاف التشغيل الآمن.', { signal });
      exitFn(0);
    } catch (err) {
      clearTimeout(forceTimer);
      logger.error('فشل إيقاف التشغيل الآمن.', { signal, error: err.message });
      exitFn(1);
    }
  };
}

// registerShutdownHandlers: the only piece that touches the real `process` object by default
// — injectable so tests never attach real SIGINT/SIGTERM listeners to the actual test-runner
// process.
export function registerShutdownHandlers(shutdown, processRef = process) {
  processRef.on('SIGINT', () => shutdown('SIGINT'));
  processRef.on('SIGTERM', () => shutdown('SIGTERM'));
}

// registerFatalErrorHandlers: catches errors that escape request scope entirely (a stray
// unawaited promise, a timer/event-listener callback that throws) — asyncHandler/errorHandler.js
// only cover errors inside a request handler. Node's default behavior for an unhandled
// rejection in current LTS releases is to crash the process exactly like an uncaught exception,
// and for a process running headless as a Windows Service there is no console to read (see
// logger.js's own note) — the process would just vanish, killing every active session with no
// diagnostic trail. This logs the real error via the existing persistent logger first, then
// reuses the SAME shutdown() closure passed in — its own idempotency guard (see
// createGracefulShutdown above) already covers both handlers firing, or either firing while a
// SIGINT/SIGTERM shutdown is already in progress, so no separate guard is needed here.
export function registerFatalErrorHandlers(shutdown, logger, processRef = process) {
  processRef.on('uncaughtException', (err) => {
    logger.error('استثناء غير مُلتقَط (uncaughtException) — إيقاف تشغيل آمن.', {
      error: err?.message, stack: err?.stack,
    });
    shutdown('uncaughtException');
  });
  processRef.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error('رفض Promise غير مُعالَج (unhandledRejection) — إيقاف تشغيل آمن.', {
      error: err.message, stack: err.stack,
    });
    shutdown('unhandledRejection');
  });
}
