// backend/src/lib/config.test.js
// Phase 6b — pure unit tests for env-loading precedence, no real database, no writes to the
// real C:\ProgramData or backend/.env. Every test uses a temp directory + STUDIX_CONFIG_PATH/
// ProgramData overrides, and restores process.env afterwards.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveProductionConfigPath, loadEnvConfig, resolveFrontendOrigin, DEV_FRONTEND_ORIGIN } from './config.js';

const ENV_KEYS_TO_RESTORE = ['STUDIX_CONFIG_PATH', 'ProgramData', 'STUDIX_TEST_PROBE_VALUE'];
let savedEnv;
let tmpDir;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS_TO_RESTORE.map((k) => [k, process.env[k]]));
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-config-test-'));
});

afterEach(() => {
  for (const key of ENV_KEYS_TO_RESTORE) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveProductionConfigPath', () => {
  it('uses STUDIX_CONFIG_PATH verbatim when set', () => {
    process.env.STUDIX_CONFIG_PATH = 'D:\\Custom\\studix.env';
    expect(resolveProductionConfigPath()).toBe('D:\\Custom\\studix.env');
  });

  it('falls back to %ProgramData%\\Studix\\config\\.env when unset', () => {
    delete process.env.STUDIX_CONFIG_PATH;
    process.env.ProgramData = 'C:\\FakeProgramData';
    expect(resolveProductionConfigPath()).toBe(path.join('C:\\FakeProgramData', 'Studix', 'config', '.env'));
  });
});

describe('loadEnvConfig — precedence', () => {
  it('production path wins when the file exists: mode is "production" and env vars from it are applied', () => {
    const prodPath = path.join(tmpDir, 'studix.env');
    fs.writeFileSync(prodPath, 'STUDIX_TEST_PROBE_VALUE=from-production-file\n', 'utf8');
    process.env.STUDIX_CONFIG_PATH = prodPath;

    const result = loadEnvConfig();

    expect(result).toEqual({ mode: 'production', path: prodPath });
    expect(process.env.STUDIX_TEST_PROBE_VALUE).toBe('from-production-file');
  });

  it('falls back to development mode when the production path does not exist', () => {
    process.env.STUDIX_CONFIG_PATH = path.join(tmpDir, 'does-not-exist.env');

    const result = loadEnvConfig();

    expect(result.mode).toBe('development');
    expect(result.path).toBeNull();
  });

  it('never throws when neither the production file nor a dev .env exists', () => {
    process.env.STUDIX_CONFIG_PATH = path.join(tmpDir, 'nope.env');
    expect(() => loadEnvConfig()).not.toThrow();
  });

  it('precedence is deterministic: production mode is chosen purely by file existence, never by which was checked first or how many times', () => {
    const prodPath = path.join(tmpDir, 'studix.env');
    fs.writeFileSync(prodPath, 'STUDIX_TEST_PROBE_VALUE=stable\n', 'utf8');
    process.env.STUDIX_CONFIG_PATH = prodPath;

    const first = loadEnvConfig();
    const second = loadEnvConfig();

    expect(first.mode).toBe('production');
    expect(second.mode).toBe('production');
  });

  it('supports dependency injection for existsSync/dotenvConfig without touching the real filesystem', () => {
    const calls = [];
    const result = loadEnvConfig({
      existsSync: () => true,
      dotenvConfig: (opts) => { calls.push(opts); },
    });
    expect(result.mode).toBe('production');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveProperty('path');
  });
});

// S1 — which origin may make credentialed cross-origin requests (server.js CORS) and pass the
// setup Origin guard. env and mode are passed explicitly: no dependence on this machine.
describe('resolveFrontendOrigin', () => {
  it('an explicit FRONTEND_ORIGIN always wins, in either mode', () => {
    const env = { FRONTEND_ORIGIN: 'http://localhost:3000' };
    expect(resolveFrontendOrigin(env, 'development')).toBe('http://localhost:3000');
    expect(resolveFrontendOrigin(env, 'production')).toBe('http://localhost:3000');
  });

  it('development mode without FRONTEND_ORIGIN defaults to the Vite dev server origin', () => {
    expect(resolveFrontendOrigin({}, 'development')).toBe(DEV_FRONTEND_ORIGIN);
    expect(DEV_FRONTEND_ORIGIN).toBe('http://localhost:5173');
  });

  it('production mode without FRONTEND_ORIGIN trusts no extra origin (null), even an empty value', () => {
    expect(resolveFrontendOrigin({}, 'production')).toBeNull();
    expect(resolveFrontendOrigin({ FRONTEND_ORIGIN: '' }, 'production')).toBeNull();
  });
});
