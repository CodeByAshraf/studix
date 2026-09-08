// backend/scripts/manageWindowsServices.test.js
// Uninstall-defect regression coverage: Phase 3A E2E validation found that a normal uninstall
// left StudixApp/StudixPostgreSQL running (and the rest of the uninstall failing to delete
// locked files) because this CLI's `app unregister` action called unregisterAppService() with
// no nssmPath override — defaulting to a bare "nssm.exe" PATH lookup, which fails outright since
// nssm.exe is never on PATH (INSTALL-06 never puts it there). Every register/unregister/start/
// stop function this CLI calls is mocked — this file proves WHICH ARGUMENTS TARGETS.app's
// actions pass to unregisterAppService/registerAppService, never touches a real service.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

const registerPostgresServiceMock = vi.fn(() => ({ status: 'registered' }));
const unregisterPostgresServiceMock = vi.fn(() => ({ status: 'unregistered' }));
const registerAppServiceMock = vi.fn(() => ({ status: 'registered' }));
const unregisterAppServiceMock = vi.fn(() => ({ status: 'unregistered' }));
const startServiceMock = vi.fn(() => ({ status: 'started' }));
const stopServiceMock = vi.fn(() => ({ status: 'stopped' }));
const serviceStatusMock = vi.fn(() => ({ registered: true }));

// Mocks every side-effecting function this CLI imports, but keeps the REAL path-resolution
// helpers (resolveInstallRoot/resolvePinnedNssmPath/STUDIX_*_SERVICE_NAME) — the whole point of
// this test is to prove the CLI passes the REAL pinned-path value through unmodified.
vi.mock('../src/lib/windowsService.js', async () => {
  const actual = await vi.importActual('../src/lib/windowsService.js');
  return {
    ...actual,
    registerPostgresService: registerPostgresServiceMock,
    unregisterPostgresService: unregisterPostgresServiceMock,
    registerAppService: registerAppServiceMock,
    unregisterAppService: unregisterAppServiceMock,
    startService: startServiceMock,
    stopService: stopServiceMock,
    serviceStatus: serviceStatusMock,
  };
});

const { TARGETS } = await import('./manageWindowsServices.js');
const { resolvePinnedNssmPath } = await import('../src/lib/windowsService.js');

const ENV_KEYS = ['STUDIX_INSTALL_ROOT', 'STUDIX_NSSM_PATH'];
let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  vi.clearAllMocks();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('TARGETS.app.unregister — the confirmed uninstall-time defect', () => {
  it('passes the pinned bundled nssm.exe path (installRoot\\tools\\nssm.exe), never a bare PATH lookup', () => {
    process.env.STUDIX_INSTALL_ROOT = 'D:\\FakeInstall';
    delete process.env.STUDIX_NSSM_PATH;

    TARGETS.app.unregister();

    expect(unregisterAppServiceMock).toHaveBeenCalledTimes(1);
    expect(unregisterAppServiceMock).toHaveBeenCalledWith({ nssmPath: path.join('D:\\FakeInstall', 'tools', 'nssm.exe') });
  });

  it('never passes bare "nssm.exe", even when STUDIX_NSSM_PATH happens to be set (that override is for resolveNssmPath\'s manual/dev path, not this pinned one)', () => {
    process.env.STUDIX_INSTALL_ROOT = 'D:\\FakeInstall';
    process.env.STUDIX_NSSM_PATH = 'C:\\SomewhereElse\\nssm.exe';

    TARGETS.app.unregister();

    const callArg = unregisterAppServiceMock.mock.calls.at(-1)[0];
    expect(callArg.nssmPath).not.toBe('nssm.exe');
    expect(callArg.nssmPath).not.toBe('C:\\SomewhereElse\\nssm.exe');
    expect(callArg.nssmPath).toBe(resolvePinnedNssmPath('D:\\FakeInstall'));
  });

  it('resolves against the real install root when STUDIX_INSTALL_ROOT is unset (matches resolveInstallRoot()\'s own default, not a hardcoded test path)', () => {
    delete process.env.STUDIX_INSTALL_ROOT;
    delete process.env.STUDIX_NSSM_PATH;

    TARGETS.app.unregister();

    const callArg = unregisterAppServiceMock.mock.calls.at(-1)[0];
    expect(callArg.nssmPath).toBe(resolvePinnedNssmPath());
    expect(callArg.nssmPath.endsWith(path.join('tools', 'nssm.exe'))).toBe(true);
  });
});

describe('TARGETS — everything else keeps its pre-existing (unmodified) call shape', () => {
  it('postgres.register/postgres.unregister still call with no arguments (pg_ctl-based, never needed an nssm path)', () => {
    TARGETS.postgres.register();
    TARGETS.postgres.unregister();
    expect(registerPostgresServiceMock).toHaveBeenCalledWith();
    expect(unregisterPostgresServiceMock).toHaveBeenCalledWith();
  });

  it('app.register keeps its pre-existing no-argument call shape — this fix is narrowly scoped to app.unregister only (the confirmed uninstall defect)', () => {
    TARGETS.app.register();
    expect(registerAppServiceMock).toHaveBeenCalledWith();
  });

  it('serviceName is exposed correctly for both targets', () => {
    expect(TARGETS.postgres.serviceName).toBe('StudixPostgreSQL');
    expect(TARGETS.app.serviceName).toBe('StudixApp');
  });
});
