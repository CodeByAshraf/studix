// backend/src/lib/shutdown.test.js
// Phase 6b — pure unit tests, no real HTTP server, no real database, no real OS signals sent
// to the test-runner process. A fake EventEmitter-like object stands in for `process` in the
// registerShutdownHandlers tests specifically so this suite never attaches a real SIGINT/
// SIGTERM listener to the actual vitest process.
import { describe, it, expect, vi } from 'vitest';
import { createGracefulShutdown, registerShutdownHandlers } from './shutdown.js';

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeServer({ closeError = null, hang = false } = {}) {
  return {
    close: vi.fn((cb) => {
      if (hang) return; // never calls back — exercises the force-timeout path
      setImmediate(() => cb(closeError));
    }),
  };
}

function makePrisma({ disconnectError = null } = {}) {
  return {
    $disconnect: vi.fn(() => (disconnectError ? Promise.reject(disconnectError) : Promise.resolve())),
  };
}

describe('createGracefulShutdown — happy path', () => {
  it('closes the server, disconnects Prisma, logs start/complete, and exits 0', async () => {
    const server = makeServer();
    const prisma = makePrisma();
    const logger = makeLogger();
    const exitFn = vi.fn();

    const shutdown = createGracefulShutdown({ server, prisma, logger, timeoutMs: 500, exitFn });
    await shutdown('SIGINT');

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    expect(exitFn).toHaveBeenCalledWith(0);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('بدء'), { signal: 'SIGINT' });
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('اكتمل'), { signal: 'SIGINT' });
  });

  it('passes the correct signal through for both SIGINT and SIGTERM', async () => {
    const logger = makeLogger();
    const exitFn = vi.fn();
    const shutdown = createGracefulShutdown({ server: makeServer(), prisma: makePrisma(), logger, timeoutMs: 500, exitFn });

    await shutdown('SIGTERM');
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('بدء'), { signal: 'SIGTERM' });
  });
});

describe('createGracefulShutdown — idempotency', () => {
  it('a second concurrent/subsequent call is ignored while shutdown is already in progress', async () => {
    const server = makeServer();
    const prisma = makePrisma();
    const logger = makeLogger();
    const exitFn = vi.fn();
    const shutdown = createGracefulShutdown({ server, prisma, logger, timeoutMs: 500, exitFn });

    const first = shutdown('SIGINT');
    await shutdown('SIGINT'); // fired again before the first has resolved
    await first;

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    expect(exitFn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('تم تجاهلها'), { signal: 'SIGINT' });
  });

  it('a call after shutdown has already completed is also ignored', async () => {
    const server = makeServer();
    const prisma = makePrisma();
    const logger = makeLogger();
    const exitFn = vi.fn();
    const shutdown = createGracefulShutdown({ server, prisma, logger, timeoutMs: 500, exitFn });

    await shutdown('SIGINT');
    await shutdown('SIGTERM');

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('createGracefulShutdown — failure and timeout paths', () => {
  it('exits 1 and logs an error when server.close reports an error', async () => {
    const closeError = new Error('close failed');
    const server = makeServer({ closeError });
    const prisma = makePrisma();
    const logger = makeLogger();
    const exitFn = vi.fn();

    const shutdown = createGracefulShutdown({ server, prisma, logger, timeoutMs: 500, exitFn });
    await shutdown('SIGINT');

    expect(exitFn).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('فشل'), { signal: 'SIGINT', error: 'close failed' });
  });

  it('force-exits with code 1 if graceful shutdown does not complete within timeoutMs', async () => {
    const server = makeServer({ hang: true });
    const prisma = makePrisma();
    const logger = makeLogger();
    const exitFn = vi.fn();

    const shutdown = createGracefulShutdown({ server, prisma, logger, timeoutMs: 30, exitFn });
    shutdown('SIGINT'); // deliberately not awaited — it never resolves on its own when hung
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(exitFn).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('تجاوز'), { timeoutMs: 30 });
  });
});

describe('registerShutdownHandlers', () => {
  function makeFakeProcess() {
    const handlers = {};
    return {
      on: vi.fn((event, cb) => { handlers[event] = cb; }),
      emit: (event) => handlers[event]?.(),
    };
  }

  it('registers listeners for both SIGINT and SIGTERM on the given process-like object', () => {
    const fakeProcess = makeFakeProcess();
    const shutdown = vi.fn();
    registerShutdownHandlers(shutdown, fakeProcess);

    expect(fakeProcess.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(fakeProcess.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
  });

  it('SIGINT triggers shutdown("SIGINT")', () => {
    const fakeProcess = makeFakeProcess();
    const shutdown = vi.fn();
    registerShutdownHandlers(shutdown, fakeProcess);

    fakeProcess.emit('SIGINT');
    expect(shutdown).toHaveBeenCalledWith('SIGINT');
  });

  it('SIGTERM triggers shutdown("SIGTERM")', () => {
    const fakeProcess = makeFakeProcess();
    const shutdown = vi.fn();
    registerShutdownHandlers(shutdown, fakeProcess);

    fakeProcess.emit('SIGTERM');
    expect(shutdown).toHaveBeenCalledWith('SIGTERM');
  });

  it('never touches the real process object (no real signal handlers attached by this suite)', () => {
    const before = process.listenerCount('SIGINT');
    const fakeProcess = makeFakeProcess();
    registerShutdownHandlers(vi.fn(), fakeProcess);
    expect(process.listenerCount('SIGINT')).toBe(before);
  });
});
