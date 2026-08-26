// backend/src/lib/logger.test.js
// Phase 6b — pure unit tests against the real filesystem, scoped to a temp directory via
// STUDIX_LOG_DIR (same override-for-tests convention already used by db/backup.js's
// STUDIX_BACKUP_DIR) — never touches the real C:\ProgramData.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir;
let savedLogDir;
let logger;

beforeEach(async () => {
  savedLogDir = process.env.STUDIX_LOG_DIR;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-logger-test-'));
  process.env.STUDIX_LOG_DIR = tmpDir;
  vi.resetModules();
  logger = await import('./logger.js');
  logger.__resetForTests();
});

afterEach(() => {
  if (savedLogDir === undefined) delete process.env.STUDIX_LOG_DIR;
  else process.env.STUDIX_LOG_DIR = savedLogDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function readTodayLogLines() {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(tmpDir, `studix-${day}.log`);
  return fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

describe('logger — info/warn/error write to the file and to console', () => {
  it('info() writes a timestamped line with level=info to the log file', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('server started');
    const lines = readTodayLogLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('info');
    expect(lines[0].message).toBe('server started');
    expect(typeof lines[0].time).toBe('string');
    expect(new Date(lines[0].time).toString()).not.toBe('Invalid Date');
    expect(consoleSpy).toHaveBeenCalledWith('[INFO] server started');
  });

  it('warn() writes level=warn and calls console.warn', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('something odd');
    const lines = readTodayLogLines();
    expect(lines[0].level).toBe('warn');
    expect(consoleSpy).toHaveBeenCalledWith('[WARN] something odd');
  });

  it('error() writes level=error and calls console.error', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('boom');
    const lines = readTodayLogLines();
    expect(lines[0].level).toBe('error');
    expect(consoleSpy).toHaveBeenCalledWith('[ERROR] boom');
  });
});

describe('logger — creates the log directory when missing', () => {
  it('mkdirs a nested, not-yet-existing STUDIX_LOG_DIR before writing', () => {
    const nested = path.join(tmpDir, 'does', 'not', 'exist', 'yet');
    process.env.STUDIX_LOG_DIR = nested;
    expect(fs.existsSync(nested)).toBe(false);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('first ever write');

    expect(fs.existsSync(nested)).toBe(true);
    const day = new Date().toISOString().slice(0, 10);
    expect(fs.existsSync(path.join(nested, `studix-${day}.log`))).toBe(true);
  });
});

describe('logger — write failures never crash the application', () => {
  it('does not throw when the log directory path is unusable (a file occupies a required parent segment)', () => {
    // A real, portable way to force fs.mkdirSync(..., {recursive:true}) to fail: point the
    // log dir through a path segment that is already an existing FILE, not a directory.
    const blockerFile = path.join(tmpDir, 'blocker.txt');
    fs.writeFileSync(blockerFile, 'not a directory', 'utf8');
    process.env.STUDIX_LOG_DIR = path.join(blockerFile, 'logs');

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => logger.info('should not throw')).not.toThrow();
    expect(consoleLogSpy).toHaveBeenCalledWith('[INFO] should not throw');
    // one-time fallback warning printed to console instead of a silent failure
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('warns about a write failure only once per process, not on every subsequent call', () => {
    const blockerFile = path.join(tmpDir, 'blocker2.txt');
    fs.writeFileSync(blockerFile, 'not a directory', 'utf8');
    process.env.STUDIX_LOG_DIR = path.join(blockerFile, 'logs');

    vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logger.info('first');
    logger.info('second');
    logger.info('third');

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});

describe('logger — sensitive values are never emitted', () => {
  it('redacts known-sensitive metadata keys before writing to the file', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('activation attempt', {
      password: 'hunter2',
      databaseUrl: 'postgresql://user:hunter2@localhost:5432/studix',
      sessionSecret: 'abc123',
      privateKey: '-----BEGIN PRIVATE KEY-----',
      license_artifact: 'payload.signature',
      note: 'this is fine to keep',
    });

    const raw = fs.readFileSync(
      path.join(tmpDir, `studix-${new Date().toISOString().slice(0, 10)}.log`), 'utf8'
    );
    expect(raw).not.toContain('hunter2');
    expect(raw).not.toContain('abc123');
    expect(raw).not.toContain('BEGIN PRIVATE KEY');
    expect(raw).not.toContain('payload.signature');
    expect(raw).toContain('this is fine to keep');
    expect(raw).toContain('[REDACTED]');
  });
});
