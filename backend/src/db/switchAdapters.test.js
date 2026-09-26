// backend/src/db/switchAdapters.test.js
// Phase 2C-3C Part 1 — pure, dependency-injected unit tests. NEVER calls a real sc.exe and
// NEVER touches a real Windows service or a real network socket — every execFileSync/sleepSync/
// fetch call is injected, exactly like lib/windowsService.test.js's own established convention
// (real `sc qc`/`sc query` output shapes, not invented).
import { describe, it, expect, vi } from 'vitest';
import {
  createRealGetAppStatusFn, createRealStopAppFn, createRealStartAppFn, createRealFetchHealthFn,
  SwitchAdapterError,
} from './switchAdapters.js';
import { WindowsServiceError } from '../lib/windowsService.js';

const SC_QUERY_RUNNING = `
SERVICE_NAME: StudixApp
        TYPE               : 10  WIN32_OWN_PROCESS
        STATE              : 4  RUNNING
                                (STOPPABLE, NOT_PAUSABLE, ACCEPTS_SHUTDOWN)
        WIN32_EXIT_CODE    : 0  (0x0)
`;

const SC_QUERY_STOPPED = `
SERVICE_NAME: StudixApp
        TYPE               : 10  WIN32_OWN_PROCESS
        STATE              : 1  STOPPED
        WIN32_EXIT_CODE    : 0  (0x0)
`;

describe('createRealGetAppStatusFn', () => {
  it('reports running:true when sc query reports RUNNING', async () => {
    const execFileSync = vi.fn(() => SC_QUERY_RUNNING);
    const fn = createRealGetAppStatusFn({ io: { execFileSync } });
    expect(await fn()).toEqual({ running: true });
  });

  it('reports running:false when sc query reports STOPPED', async () => {
    const execFileSync = vi.fn(() => SC_QUERY_STOPPED);
    const fn = createRealGetAppStatusFn({ io: { execFileSync } });
    expect(await fn()).toEqual({ running: false });
  });
});

describe('createRealStopAppFn', () => {
  it('already stopped: resolves without ever calling `sc stop`', async () => {
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === 'query') return SC_QUERY_STOPPED;
      throw new Error('must never call sc stop when already stopped');
    });
    const fn = createRealStopAppFn({ io: { execFileSync } });
    await expect(fn()).resolves.toBeUndefined();
  });

  it('successful stop: issues `sc stop` and resolves once the real STOPPED state settles', async () => {
    let stopIssued = false;
    let pollsAfterStop = 0;
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === 'query') {
        if (!stopIssued) return SC_QUERY_RUNNING;
        pollsAfterStop += 1;
        return pollsAfterStop >= 2 ? SC_QUERY_STOPPED : SC_QUERY_RUNNING;
      }
      if (args[0] === 'stop') { stopIssued = true; return ''; }
      return '';
    });
    const fn = createRealStopAppFn({ io: { execFileSync, sleepSync: () => {} } });
    await expect(fn()).resolves.toBeUndefined();
    expect(pollsAfterStop).toBeGreaterThanOrEqual(2); // proves it actually polled
  });

  it('stop timeout: propagates stopService()\'s own WindowsServiceError(stop_timeout) — never swallowed', async () => {
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === 'query') return SC_QUERY_RUNNING; // never settles
      if (args[0] === 'stop') return '';
      return '';
    });
    const fn = createRealStopAppFn({ io: { execFileSync, sleepSync: () => {}, timeoutMs: 30, pollIntervalMs: 5 } });
    let caught;
    try {
      await fn();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WindowsServiceError);
    expect(caught.reason).toBe('stop_timeout');
  });

  it('service command failure: a real sc.exe failure (not a timeout) propagates as-is', async () => {
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === 'query') return SC_QUERY_RUNNING;
      if (args[0] === 'stop') { const e = new Error('access denied'); throw e; }
      return '';
    });
    const fn = createRealStopAppFn({ io: { execFileSync } });
    let caught;
    try {
      await fn();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WindowsServiceError);
    expect(caught.reason).toBe('stop_failed');
  });
});

describe('createRealStartAppFn', () => {
  it('successful start: issues `sc start` and waits for the real RUNNING state', async () => {
    let startIssued = false;
    let pollsAfterStart = 0;
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === 'query') {
        if (!startIssued) return SC_QUERY_STOPPED;
        pollsAfterStart += 1;
        return pollsAfterStart >= 2 ? SC_QUERY_RUNNING : SC_QUERY_STOPPED;
      }
      if (args[0] === 'start') { startIssued = true; return ''; }
      return '';
    });
    const fn = createRealStartAppFn({ io: { execFileSync, sleepSync: () => {} } });
    await expect(fn()).resolves.toBeUndefined();
    expect(pollsAfterStart).toBeGreaterThanOrEqual(2); // proves it actually polled for RUNNING
  });

  it('already running: resolves quickly (startService is idempotent, and the immediate poll already sees RUNNING)', async () => {
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === 'query') return SC_QUERY_RUNNING;
      throw new Error('must never call sc start when already running');
    });
    const fn = createRealStartAppFn({ io: { execFileSync, sleepSync: () => {} } });
    await expect(fn()).resolves.toBeUndefined();
  });

  it('start timeout: throws SwitchAdapterError(start_timeout) when the service never actually reaches RUNNING — proving startService() alone (which only issues the request) is not trusted', async () => {
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === 'query') return SC_QUERY_STOPPED; // never settles to RUNNING
      if (args[0] === 'start') return '';
      return '';
    });
    const fn = createRealStartAppFn({
      io: { execFileSync, sleepSync: () => {}, pollIntervalMs: 5 }, timeoutMs: 30,
    });
    let caught;
    try {
      await fn();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SwitchAdapterError);
    expect(caught.reason).toBe('start_timeout');
  });

  it('service command failure: a real sc.exe failure on `sc start` propagates as-is (start_failed), never masked as a timeout', async () => {
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === 'query') return SC_QUERY_STOPPED;
      if (args[0] === 'start') { throw new Error('service refused to start'); }
      return '';
    });
    const fn = createRealStartAppFn({ io: { execFileSync } });
    let caught;
    try {
      await fn();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WindowsServiceError);
    expect(caught.reason).toBe('start_failed');
  });
});

describe('createRealFetchHealthFn', () => {
  it('health success: returns {ok:true} with status/body from a real-shaped /health response', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ ok: true, database: { connected: true } }),
    }));
    const fn = createRealFetchHealthFn({ healthUrl: 'http://127.0.0.1:4000/health', fetchImpl });
    const result = await fn();
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, database: { connected: true } });
  });

  it('health failure: a non-2xx response returns {ok:false} rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false, status: 503, json: async () => ({ ok: false }),
    }));
    const fn = createRealFetchHealthFn({ healthUrl: 'http://127.0.0.1:4000/health', fetchImpl });
    const result = await fn();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });

  it('network failure (server not up yet): returns {ok:false} rather than throwing/crashing the caller', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const fn = createRealFetchHealthFn({ healthUrl: 'http://127.0.0.1:4000/health', fetchImpl });
    const result = await fn();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('a non-JSON/empty body still returns the status-code-derived ok/status, not a thrown parse error', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200, json: async () => { throw new Error('Unexpected end of JSON input'); },
    }));
    const fn = createRealFetchHealthFn({ healthUrl: 'http://127.0.0.1:4000/health', fetchImpl });
    const result = await fn();
    expect(result.ok).toBe(true);
    expect(result.body).toBeNull();
  });
});
