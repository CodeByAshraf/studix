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
