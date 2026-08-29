// backend/src/lib/productionConfig.test.js
// INSTALL-02 — pure unit tests for the production config/secret generator. Every test uses a
// temp directory + injected fs functions or an explicit configPath, exactly like
// config.test.js — never touches the real C:\ProgramData.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import {
  generateSessionSecret,
  ensureProductionConfig,
  resolveProductionConfigPath,
  ProductionConfigError,
} from './productionConfig.js';

const ENV_KEYS_TO_RESTORE = ['STUDIX_CONFIG_PATH', 'ProgramData'];
let savedEnv;
let tmpDir;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS_TO_RESTORE.map((k) => [k, process.env[k]]));
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-prodconfig-test-'));
});

afterEach(() => {
  for (const key of ENV_KEYS_TO_RESTORE) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('generateSessionSecret', () => {
  it('produces 64 lowercase hex characters (32 bytes / 256 bits of entropy)', () => {
    const secret = generateSessionSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a different value on every call', () => {
    const a = generateSessionSecret();
    const b = generateSessionSecret();
    expect(a).not.toBe(b);
  });

  it('is generated via a CSPRNG (crypto.randomBytes-shaped), not Math.random', () => {
    const spy = vi.fn((n) => crypto.randomBytes(n));
    const secret = generateSessionSecret(spy);
    expect(spy).toHaveBeenCalledWith(32);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('ensureProductionConfig — fresh install (file does not exist)', () => {
  it('creates the config directory and file, and generates SESSION_SECRET', () => {
    const configPath = path.join(tmpDir, 'nested', 'config', '.env');
    const result = ensureProductionConfig({ configPath });

    expect(result).toEqual({ created: true, path: configPath });
    expect(fs.existsSync(configPath)).toBe(true);

    const written = fs.readFileSync(configPath, 'utf8');
    const secretLine = written.match(/^SESSION_SECRET=([0-9a-f]{64})$/m);
    expect(secretLine).not.toBeNull();
  });

  it('writes DATABASE_URL only when explicitly supplied by the caller, never invented', () => {
    const withoutDb = path.join(tmpDir, 'no-db', '.env');
    ensureProductionConfig({ configPath: withoutDb });
    expect(fs.readFileSync(withoutDb, 'utf8')).not.toMatch(/DATABASE_URL/);

    const withDb = path.join(tmpDir, 'with-db', '.env');
    ensureProductionConfig({
      configPath: withDb,
      databaseUrl: 'postgresql://studix_app:pw@localhost:5432/studix',
    });
    expect(fs.readFileSync(withDb, 'utf8')).toContain(
      'DATABASE_URL=postgresql://studix_app:pw@localhost:5432/studix'
    );
  });
});

describe('ensureProductionConfig — idempotency', () => {
  it('running generation twice preserves the exact same secret', () => {
    const configPath = path.join(tmpDir, '.env');
    ensureProductionConfig({ configPath });
    const firstSecret = fs.readFileSync(configPath, 'utf8').match(/SESSION_SECRET=([0-9a-f]{64})/)[1];

    const second = ensureProductionConfig({ configPath });
    const secondSecret = fs.readFileSync(configPath, 'utf8').match(/SESSION_SECRET=([0-9a-f]{64})/)[1];

    expect(second.created).toBe(false);
    expect(secondSecret).toBe(firstSecret);
  });

  it('a pre-existing valid SESSION_SECRET is never rotated, even across many runs', () => {
    const configPath = path.join(tmpDir, '.env');
    fs.writeFileSync(configPath, 'SESSION_SECRET=preexisting0123456789abcdef0123456789abcdef0123456789abcd\n', 'utf8');

    for (let i = 0; i < 3; i++) {
      const result = ensureProductionConfig({ configPath });
      expect(result.created).toBe(false);
    }

    expect(fs.readFileSync(configPath, 'utf8')).toBe(
      'SESSION_SECRET=preexisting0123456789abcdef0123456789abcdef0123456789abcd\n'
    );
  });

  it('preserves existing unrelated configuration values untouched (file is never rewritten)', () => {
    const configPath = path.join(tmpDir, '.env');
    const original =
      'SESSION_SECRET=abc0123456789abcdef0123456789abcdef0123456789abcdef0123456789\n' +
      'DATABASE_URL=postgresql://real:creds@db-host:5432/studix\n' +
      'PORT=4000\n' +
      '# an operator comment\n';
    fs.writeFileSync(configPath, original, 'utf8');

    ensureProductionConfig({ configPath });

    expect(fs.readFileSync(configPath, 'utf8')).toBe(original);
  });

  it('does not touch the filesystem at all when the secret already exists (no read-then-rewrite)', () => {
    const configPath = path.join(tmpDir, '.env');
    fs.writeFileSync(configPath, 'SESSION_SECRET=abc0123456789abcdef0123456789abcdef0123456789abcdef0123456789\n', 'utf8');
    const writeFileSync = vi.fn();
    const mkdirSync = vi.fn();

    ensureProductionConfig({ configPath, writeFileSync, mkdirSync });

    expect(writeFileSync).not.toHaveBeenCalled();
    expect(mkdirSync).not.toHaveBeenCalled();
  });
});

describe('ensureProductionConfig — fails safe on an existing-but-invalid config', () => {
  it('missing SESSION_SECRET key: throws ProductionConfigError and leaves the file untouched', () => {
    const configPath = path.join(tmpDir, '.env');
    const original = 'PORT=4000\nDATABASE_URL=postgresql://x:y@localhost:5432/studix\n';
    fs.writeFileSync(configPath, original, 'utf8');

    expect(() => ensureProductionConfig({ configPath })).toThrow(ProductionConfigError);
    expect(fs.readFileSync(configPath, 'utf8')).toBe(original);
  });

  it('empty SESSION_SECRET value: also treated as missing, throws and leaves the file untouched', () => {
    const configPath = path.join(tmpDir, '.env');
    const original = 'SESSION_SECRET=\nPORT=4000\n';
    fs.writeFileSync(configPath, original, 'utf8');

    expect(() => ensureProductionConfig({ configPath })).toThrow(ProductionConfigError);
    expect(fs.readFileSync(configPath, 'utf8')).toBe(original);
  });

  it('the error message never contains the word "SESSION_SECRET" value, only the fact it is missing (no secret to leak anyway)', () => {
    const configPath = path.join(tmpDir, '.env');
    fs.writeFileSync(configPath, 'PORT=4000\n', 'utf8');

    try {
      ensureProductionConfig({ configPath });
      expect.fail('expected ensureProductionConfig to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ProductionConfigError);
      expect(err.message).toContain(configPath);
    }
  });
});

describe('ensureProductionConfig — STUDIX_CONFIG_PATH override integration', () => {
  it('resolves the default configPath via resolveProductionConfigPath when none is passed explicitly', () => {
    const overridePath = path.join(tmpDir, 'override', '.env');
    process.env.STUDIX_CONFIG_PATH = overridePath;

    const result = ensureProductionConfig();

    expect(result.path).toBe(overridePath);
    expect(fs.existsSync(overridePath)).toBe(true);
  });
});

describe('ensureProductionConfig — no secret leakage', () => {
  it('the return value never contains the generated secret (safe even if a caller logs the result)', () => {
    const configPath = path.join(tmpDir, '.env');
    const result = ensureProductionConfig({ configPath });
    const secret = fs.readFileSync(configPath, 'utf8').match(/SESSION_SECRET=([0-9a-f]{64})/)[1];

    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('never writes to console.log/console.error (nothing for a caller to accidentally leave visible)', () => {
    const configPath = path.join(tmpDir, '.env');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    ensureProductionConfig({ configPath });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('production paths stay outside the repo/release directory', () => {
  it('the default production config path is anchored under ProgramData, never under the repo/release tree', () => {
    delete process.env.STUDIX_CONFIG_PATH;
    process.env.ProgramData = 'C:\\FakeProgramData';

    const resolved = resolveProductionConfigPath();

    expect(resolved).toBe(path.join('C:\\FakeProgramData', 'Studix', 'config', '.env'));
    expect(resolved).not.toContain('release');
    expect(resolved.toLowerCase()).not.toContain(process.cwd().toLowerCase());
  });
});

describe('production backup/log directories share the same ProgramData root as the config path', () => {
  it('resolveLogDir (lib/logger.js) and resolveProductionConfigPath both resolve under the same overridden ProgramData root', async () => {
    delete process.env.STUDIX_CONFIG_PATH;
    delete process.env.STUDIX_LOG_DIR;
    process.env.ProgramData = 'C:\\FakeProgramData';

    const { resolveLogDir } = await import('./logger.js');

    expect(resolveProductionConfigPath().startsWith(path.join('C:\\FakeProgramData', 'Studix'))).toBe(true);
    expect(resolveLogDir().startsWith(path.join('C:\\FakeProgramData', 'Studix'))).toBe(true);
  });
});
