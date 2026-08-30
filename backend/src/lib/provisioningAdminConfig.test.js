// backend/src/lib/provisioningAdminConfig.test.js
// INSTALL-10 — pure unit tests for the separate admin-only provisioning config, mirroring
// productionConfig.test.js's own conventions exactly. Every test uses a temp directory or an
// explicit configPath — never touches the real C:\ProgramData.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ensureProvisioningAdminConfig,
  readProvisioningAdminUrl,
  resolveProvisioningAdminConfigPath,
  ProvisioningAdminConfigError,
} from './provisioningAdminConfig.js';

const ENV_KEYS_TO_RESTORE = ['STUDIX_ADMIN_CONFIG_PATH', 'ProgramData'];
let savedEnv;
let tmpDir;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS_TO_RESTORE.map((k) => [k, process.env[k]]));
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studix-adminconfig-test-'));
});

afterEach(() => {
  for (const key of ENV_KEYS_TO_RESTORE) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const ADMIN_URL = 'postgresql://studix_admin:adminsecret@127.0.0.1:55432/studix';

describe('ensureProvisioningAdminConfig — fresh (file does not exist)', () => {
  it('creates the config directory and file with the given databaseUrl', () => {
    const configPath = path.join(tmpDir, 'nested', 'config', 'admin.env');
    const result = ensureProvisioningAdminConfig({ configPath, databaseUrl: ADMIN_URL });

    expect(result).toEqual({ created: true, path: configPath });
    expect(fs.existsSync(configPath)).toBe(true);
    expect(fs.readFileSync(configPath, 'utf8')).toContain(`STUDIX_DB_ADMIN_URL=${ADMIN_URL}`);
  });

  it('throws when databaseUrl is missing — never invents one', () => {
    const configPath = path.join(tmpDir, 'admin.env');
    expect(() => ensureProvisioningAdminConfig({ configPath })).toThrow(ProvisioningAdminConfigError);
    expect(fs.existsSync(configPath)).toBe(false);
  });
});

describe('ensureProvisioningAdminConfig — idempotency (mirrors ensureProductionConfig exactly)', () => {
  it('running it twice preserves the exact same value, second call reports created: false', () => {
    const configPath = path.join(tmpDir, 'admin.env');
    ensureProvisioningAdminConfig({ configPath, databaseUrl: ADMIN_URL });
    const second = ensureProvisioningAdminConfig({ configPath, databaseUrl: 'postgresql://different:x@host:1/db' });

    expect(second.created).toBe(false);
    expect(readProvisioningAdminUrl({ configPath })).toBe(ADMIN_URL); // NOT overwritten with the second call's value
  });

  it('does not touch the filesystem at all when the value already exists (no read-then-rewrite)', () => {
    const configPath = path.join(tmpDir, 'admin.env');
    fs.writeFileSync(configPath, `STUDIX_DB_ADMIN_URL=${ADMIN_URL}\n`, 'utf8');
    const writeFileSync = vi.fn();
    const mkdirSync = vi.fn();

    ensureProvisioningAdminConfig({ configPath, databaseUrl: ADMIN_URL, writeFileSync, mkdirSync });

    expect(writeFileSync).not.toHaveBeenCalled();
    expect(mkdirSync).not.toHaveBeenCalled();
  });

  it('an existing file with an empty value throws rather than silently overwriting', () => {
    const configPath = path.join(tmpDir, 'admin.env');
    fs.writeFileSync(configPath, 'STUDIX_DB_ADMIN_URL=\n', 'utf8');
    expect(() => ensureProvisioningAdminConfig({ configPath, databaseUrl: ADMIN_URL })).toThrow(ProvisioningAdminConfigError);
  });
});

describe('readProvisioningAdminUrl', () => {
  it('returns null when the file does not exist — never throws for the expected common case', () => {
    const configPath = path.join(tmpDir, 'does-not-exist.env');
    expect(readProvisioningAdminUrl({ configPath })).toBeNull();
  });

  it('returns the persisted value after ensureProvisioningAdminConfig writes it', () => {
    const configPath = path.join(tmpDir, 'admin.env');
    ensureProvisioningAdminConfig({ configPath, databaseUrl: ADMIN_URL });
    expect(readProvisioningAdminUrl({ configPath })).toBe(ADMIN_URL);
  });

  it('never calls dotenv.config()-style process.env mutation — process.env is untouched by a read', () => {
    const configPath = path.join(tmpDir, 'admin.env');
    ensureProvisioningAdminConfig({ configPath, databaseUrl: ADMIN_URL });
    delete process.env.STUDIX_DB_ADMIN_URL;

    readProvisioningAdminUrl({ configPath });

    expect(process.env.STUDIX_DB_ADMIN_URL).toBeUndefined();
  });
});

describe('resolveProvisioningAdminConfigPath', () => {
  it('defaults to %ProgramData%\\Studix\\config\\admin.env — a DIFFERENT file than the runtime .env', () => {
    delete process.env.STUDIX_ADMIN_CONFIG_PATH;
    process.env.ProgramData = 'C:\\FakeProgramData';

    const resolved = resolveProvisioningAdminConfigPath();

    expect(resolved).toBe(path.join('C:\\FakeProgramData', 'Studix', 'config', 'admin.env'));
    expect(resolved.endsWith('admin.env')).toBe(true);
  });

  it('respects STUDIX_ADMIN_CONFIG_PATH override', () => {
    const overridePath = path.join(tmpDir, 'override', 'admin.env');
    process.env.STUDIX_ADMIN_CONFIG_PATH = overridePath;
    expect(resolveProvisioningAdminConfigPath()).toBe(overridePath);
  });
});

describe('no secret leakage', () => {
  it('the ensure result never contains the admin connection string itself', () => {
    const configPath = path.join(tmpDir, 'admin.env');
    const result = ensureProvisioningAdminConfig({ configPath, databaseUrl: ADMIN_URL });
    expect(JSON.stringify(result)).not.toContain('adminsecret');
  });

  it('never writes to console.log/console.error', () => {
    const configPath = path.join(tmpDir, 'admin.env');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    ensureProvisioningAdminConfig({ configPath, databaseUrl: ADMIN_URL });
    readProvisioningAdminUrl({ configPath });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
