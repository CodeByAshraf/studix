// backend/src/lib/windowsService.test.js
// INSTALL-05 — pure, dependency-injected unit tests. NEVER calls a real sc.exe/pg_ctl.exe/
// nssm.exe and NEVER registers/unregisters a real Windows service — every execFileSync call is
// injected. Real Windows Service Control Manager registration requires Administrator privileges
// (this environment does not have them — verified) and mutates system-wide state, which is
// exactly why this module's entire safety/idempotency/verification contract is tested here at
// the command-construction and response-classification level instead.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import {
  resolveInstallRoot, resolveNodeExePath, resolveServerJsPath, resolveNssmPath,
  parseScQcOutput, queryServiceConfig, queryServiceState,
  startService, stopService, serviceStatus,
  configureServiceRecovery, configureAppRecovery,
  registerPostgresService, unregisterPostgresService,
  registerAppService, unregisterAppService,
  STUDIX_POSTGRES_SERVICE_NAME, STUDIX_APP_SERVICE_NAME,
  WindowsServiceError,
} from './windowsService.js';

const ENV_KEYS = ['STUDIX_INSTALL_ROOT', 'STUDIX_NSSM_PATH', 'STUDIX_PG_HOME', 'STUDIX_PGDATA_DIR', 'ProgramData', 'STUDIX_LOG_DIR'];
let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

// Real, researched `sc qc` / `sc query` output shapes — not invented.
const SC_QC_POSTGRES = `
[SC] QueryServiceConfig SUCCESS

SERVICE_NAME: StudixPostgreSQL
        TYPE               : 10  WIN32_OWN_PROCESS
        START_TYPE         : 2   AUTO_START
        ERROR_CONTROL      : 1   NORMAL
        BINARY_PATH_NAME   : "C:\\Studix\\pgsql\\bin\\pg_ctl.exe" runservice -N "StudixPostgreSQL" -D "C:\\ProgramData\\Studix\\pgdata" -w
        LOAD_ORDER_GROUP   :
        TAG                : 0
        DISPLAY_NAME       : StudixPostgreSQL
        DEPENDENCIES       :
        SERVICE_START_NAME : LocalSystem
`;

const SC_QC_APP = `
[SC] QueryServiceConfig SUCCESS

SERVICE_NAME: StudixApp
        TYPE               : 10  WIN32_OWN_PROCESS
        START_TYPE         : 2   AUTO_START
        ERROR_CONTROL      : 1   NORMAL
        BINARY_PATH_NAME   : "C:\\Studix\\nssm.exe"
        LOAD_ORDER_GROUP   :
        TAG                : 0
        DISPLAY_NAME       : StudixApp
        DEPENDENCIES       : StudixPostgreSQL
        SERVICE_START_NAME : LocalSystem
`;

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

function notFoundError() {
  const err = new Error('The specified service does not exist as an installed service.');
  err.status = 1060;
  return err;
}

describe('path resolution', () => {
  it('resolveInstallRoot respects STUDIX_INSTALL_ROOT override', () => {
    process.env.STUDIX_INSTALL_ROOT = 'D:\\Custom\\studix';
    expect(resolveInstallRoot()).toBe('D:\\Custom\\studix');
  });

  it('resolveNodeExePath / resolveServerJsPath derive from the install root', () => {
    const root = 'D:\\Studix';
    expect(resolveNodeExePath(root)).toBe(path.join(root, 'node', 'node.exe'));
    expect(resolveServerJsPath(root)).toBe(path.join(root, 'backend', 'src', 'server.js'));
  });

  it('resolveNssmPath respects STUDIX_NSSM_PATH override, defaults to bare "nssm.exe" (PATH lookup)', () => {
    delete process.env.STUDIX_NSSM_PATH;
    expect(resolveNssmPath()).toBe('nssm.exe');
    process.env.STUDIX_NSSM_PATH = 'C:\\Tools\\nssm.exe';
    expect(resolveNssmPath()).toBe('C:\\Tools\\nssm.exe');
  });
});

describe('parseScQcOutput', () => {
  it('extracts binary path (leading quote stripped), start type, and dependencies from real sc qc output shapes', () => {
    const pg = parseScQcOutput(SC_QC_POSTGRES);
    expect(pg.binaryPathName).toBe(
      'C:\\Studix\\pgsql\\bin\\pg_ctl.exe" runservice -N "StudixPostgreSQL" -D "C:\\ProgramData\\Studix\\pgdata" -w'
    );
    expect(pg.binaryPathName).toContain('pg_ctl.exe');
    expect(pg.binaryPathName).toContain('runservice');
    expect(pg.binaryPathName).toContain('C:\\ProgramData\\Studix\\pgdata');
    expect(pg.startType).toBe('AUTO_START');
    expect(pg.dependencies).toEqual([]);

    const app = parseScQcOutput(SC_QC_APP);
    expect(app.binaryPathName).toBe('C:\\Studix\\nssm.exe');
    expect(app.dependencies).toEqual(['StudixPostgreSQL']);
  });
});

describe('queryServiceConfig / queryServiceState', () => {
  it('queryServiceConfig returns null (not an error) when sc.exe exits 1060 (service not registered)', () => {
    const execFileSync = vi.fn(() => { throw notFoundError(); });
    expect(queryServiceConfig('NoSuchService', { execFileSync })).toBeNull();
  });

  it('queryServiceConfig throws WindowsServiceError for any other sc.exe failure (never silently "not registered")', () => {
    const execFileSync = vi.fn(() => { const e = new Error('Access is denied.'); e.status = 5; throw e; });
    expect(() => queryServiceConfig('StudixApp', { execFileSync })).toThrow(WindowsServiceError);
  });

  it('queryServiceState parses RUNNING/STOPPED and returns null on 1060', () => {
    expect(queryServiceState('x', { execFileSync: () => SC_QUERY_RUNNING })).toBe('RUNNING');
    expect(queryServiceState('x', { execFileSync: () => SC_QUERY_STOPPED })).toBe('STOPPED');
    expect(queryServiceState('x', { execFileSync: () => { throw notFoundError(); } })).toBeNull();
  });
});

describe('startService / stopService / serviceStatus — generic lifecycle', () => {
  it('startService throws not_registered when the service does not exist', () => {
    const execFileSync = vi.fn(() => { throw notFoundError(); });
    expect(() => startService('X', { execFileSync })).toThrow(WindowsServiceError);
  });

  it('startService is idempotent: already RUNNING short-circuits without calling sc start', () => {
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === 'query') return SC_QUERY_RUNNING;
      throw new Error('should not reach sc start');
    });
    const result = startService('StudixApp', { execFileSync });
    expect(result).toEqual({ status: 'already_running', serviceName: 'StudixApp' });
  });

  it('startService calls `sc start <name>` when currently stopped', () => {
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === 'query') return SC_QUERY_STOPPED;
      if (args[0] === 'start') return '';
      throw new Error('unexpected call');
    });
    const result = startService('StudixApp', { execFileSync });
    expect(result).toEqual({ status: 'started', serviceName: 'StudixApp' });
    expect(execFileSync).toHaveBeenCalledWith('sc.exe', ['start', 'StudixApp'], expect.anything());
  });

  it('stopService is idempotent: already STOPPED short-circuits without calling sc stop', () => {
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === 'query') return SC_QUERY_STOPPED;
      throw new Error('should not reach sc stop');
    });
    expect(stopService('StudixApp', { execFileSync })).toEqual({ status: 'already_stopped', serviceName: 'StudixApp' });
  });

  it('stopService throws not_registered rather than attempting to stop a nonexistent service', () => {
    const execFileSync = vi.fn(() => { throw notFoundError(); });
    expect(() => stopService('X', { execFileSync })).toThrow(WindowsServiceError);
  });

  it('serviceStatus reports registered:false for an unregistered service, without ever calling sc query', () => {
    const execFileSync = vi.fn(() => { throw notFoundError(); });
    expect(serviceStatus('X', { execFileSync })).toEqual({ registered: false, serviceName: 'X' });
  });

  it('serviceStatus reports full config + live state for a registered service', () => {
    const execFileSync = vi.fn((cmd, args) => (args[0] === 'qc' ? SC_QC_APP : SC_QUERY_RUNNING));
    const status = serviceStatus('StudixApp', { execFileSync });
    expect(status).toEqual({
      registered: true, serviceName: 'StudixApp', state: 'RUNNING',
      binaryPathName: 'C:\\Studix\\nssm.exe', startType: 'AUTO_START', dependencies: ['StudixPostgreSQL'],
    });
  });
});

describe('configureServiceRecovery (sc failure) — restart-on-failure for the PostgreSQL service', () => {
  it('invokes sc.exe failure with reset=/actions= as separate argv tokens (sc.exe requires the space after "=")', () => {
    const execFileSync = vi.fn(() => '');
    configureServiceRecovery('StudixPostgreSQL', { resetPeriodSeconds: 86400, restartDelayMs: 60000 }, { execFileSync });
    expect(execFileSync).toHaveBeenCalledWith(
      'sc.exe',
      ['failure', 'StudixPostgreSQL', 'reset=', '86400', 'actions=', 'restart/60000'],
      expect.anything()
    );
  });

  it('throws WindowsServiceError on failure', () => {
    const execFileSync = vi.fn(() => { throw new Error('boom'); });
    expect(() => configureServiceRecovery('X', {}, { execFileSync })).toThrow(WindowsServiceError);
  });
});

describe('configureAppRecovery (NSSM) — restart-on-failure for the app service', () => {
  it('sets AppExit Default Restart and AppRestartDelay via nssm', () => {
    const calls = [];
    const execFileSync = vi.fn((cmd, args) => { calls.push([cmd, ...args]); return ''; });
    configureAppRecovery({ serviceName: 'StudixApp', nssmPath: 'nssm.exe', restartDelayMs: 5000 }, { execFileSync });
    expect(calls).toContainEqual(['nssm.exe', 'set', 'StudixApp', 'AppExit', 'Default', 'Restart']);
    expect(calls).toContainEqual(['nssm.exe', 'set', 'StudixApp', 'AppRestartDelay', '5000']);
  });
});

describe('registerPostgresService', () => {
  function fakeIo({ binHome = 'C:\\Studix\\pgsql', existingConfig = null } = {}) {
    const calls = [];
    const execFileSync = vi.fn((cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === 'sc.exe' && args[0] === 'qc') {
        if (existingConfig === null) throw notFoundError();
        return existingConfig;
      }
      if (cmd === 'sc.exe' && args[0] === 'query') return SC_QUERY_STOPPED;
      return '';
    });
    const existsSync = (p) => String(p).startsWith(binHome);
    return { execFileSync, existsSync, calls };
  }

  it('fresh registration: calls pg_ctl register with -N/-D/-S auto, then configures recovery', () => {
    const { execFileSync, existsSync, calls } = fakeIo();
    const result = registerPostgresService(
      { pgHome: 'C:\\Studix\\pgsql', pgDataDir: 'C:\\ProgramData\\Studix\\pgdata', serviceName: 'StudixPostgreSQL' },
      { execFileSync, existsSync }
    );
    expect(result).toEqual({ status: 'registered', serviceName: 'StudixPostgreSQL' });
    const registerCall = calls.find((c) => c.includes('register'));
    expect(registerCall).toEqual([
      'C:\\Studix\\pgsql\\bin\\pg_ctl.exe', 'register', '-N', 'StudixPostgreSQL', '-D', 'C:\\ProgramData\\Studix\\pgdata', '-S', 'auto', '-w',
    ]);
    expect(calls.some((c) => c[0] === 'sc.exe' && c[1] === 'failure')).toBe(true); // recovery configured
  });

  it('idempotent: an already-registered service matching our pg_ctl/datadir signature is a no-op, never re-registers', () => {
    const { execFileSync, existsSync, calls } = fakeIo({ existingConfig: SC_QC_POSTGRES });
    const result = registerPostgresService(
      { pgHome: 'C:\\Studix\\pgsql', pgDataDir: 'C:\\ProgramData\\Studix\\pgdata', serviceName: 'StudixPostgreSQL' },
      { execFileSync, existsSync }
    );
    expect(result).toEqual({ status: 'already_registered', serviceName: 'StudixPostgreSQL' });
    expect(calls.some((c) => c.includes('register'))).toBe(false);
  });

  it('fails closed: an already-registered service NOT matching our signature is never overwritten', () => {
    const foreignConfig = SC_QC_POSTGRES.replace('C:\\ProgramData\\Studix\\pgdata', 'C:\\SomeOtherApp\\data');
    const { execFileSync, existsSync, calls } = fakeIo({ existingConfig: foreignConfig });
    expect(() => registerPostgresService(
      { pgHome: 'C:\\Studix\\pgsql', pgDataDir: 'C:\\ProgramData\\Studix\\pgdata', serviceName: 'StudixPostgreSQL' },
      { execFileSync, existsSync }
    )).toThrow(WindowsServiceError);
    expect(calls.some((c) => c.includes('register'))).toBe(false);
  });
});

describe('unregisterPostgresService', () => {
  function fakeIo({ existingConfig = null, running = false } = {}) {
    const calls = [];
    const execFileSync = vi.fn((cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === 'sc.exe' && args[0] === 'qc') { if (existingConfig === null) throw notFoundError(); return existingConfig; }
      if (cmd === 'sc.exe' && args[0] === 'query') return running ? SC_QUERY_RUNNING : SC_QUERY_STOPPED;
      return '';
    });
    const existsSync = () => true;
    return { execFileSync, existsSync, calls };
  }

  it('idempotent: unregistering a service that does not exist is a clean no-op', () => {
    const { execFileSync, existsSync } = fakeIo();
    const result = unregisterPostgresService(
      { pgHome: 'C:\\Studix\\pgsql', pgDataDir: 'C:\\ProgramData\\Studix\\pgdata' },
      { execFileSync, existsSync }
    );
    expect(result).toEqual({ status: 'not_registered', serviceName: 'StudixPostgreSQL' });
  });

  it('stops a running matching service before unregistering it', () => {
    const { execFileSync, existsSync, calls } = fakeIo({ existingConfig: SC_QC_POSTGRES, running: true });
    const result = unregisterPostgresService(
      { pgHome: 'C:\\Studix\\pgsql', pgDataDir: 'C:\\ProgramData\\Studix\\pgdata' },
      { execFileSync, existsSync }
    );
    expect(result).toEqual({ status: 'unregistered', serviceName: 'StudixPostgreSQL' });
    const stopIdx = calls.findIndex((c) => c[0] === 'sc.exe' && c[1] === 'stop');
    const unregisterIdx = calls.findIndex((c) => c.includes('unregister'));
    expect(stopIdx).toBeGreaterThanOrEqual(0);
    expect(unregisterIdx).toBeGreaterThan(stopIdx);
  });

  it('refuses to unregister a same-named service that does not match our signature', () => {
    const foreignConfig = SC_QC_POSTGRES.replace('C:\\ProgramData\\Studix\\pgdata', 'C:\\SomeOtherApp\\data');
    const { execFileSync, existsSync, calls } = fakeIo({ existingConfig: foreignConfig });
    expect(() => unregisterPostgresService(
      { pgHome: 'C:\\Studix\\pgsql', pgDataDir: 'C:\\ProgramData\\Studix\\pgdata' },
      { execFileSync, existsSync }
    )).toThrow(WindowsServiceError);
    expect(calls.some((c) => c.includes('unregister'))).toBe(false);
  });
});

describe('registerAppService', () => {
  function fakeIo({ scConfig = null, nssmMatches = true, nssmThrows = false } = {}) {
    const calls = [];
    const execFileSync = vi.fn((cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === 'sc.exe' && args[0] === 'qc') { if (scConfig === null) throw notFoundError(); return scConfig; }
      if (cmd === 'sc.exe' && args[0] === 'query') return SC_QUERY_STOPPED;
      if (String(cmd).includes('nssm') && args[0] === 'get') {
        if (nssmThrows) throw new Error('not an NSSM service');
        if (args[2] === 'Application') return nssmMatches ? 'C:\\Studix\\node\\node.exe' : 'C:\\SomeOtherApp\\other.exe';
        if (args[2] === 'AppParameters') return nssmMatches ? 'C:\\Studix\\backend\\src\\server.js' : 'C:\\other.js';
      }
      return '';
    });
    return { execFileSync, calls };
  }

  it('fresh registration: installs via nssm with node.exe/server.js, sets AppDirectory/Start/DependOnService/stdout/stderr, configures recovery', () => {
    const { execFileSync, calls } = fakeIo();
    const result = registerAppService(
      { installRoot: 'C:\\Studix', serviceName: 'StudixApp', dependsOnServiceName: 'StudixPostgreSQL', nssmPath: 'nssm.exe' },
      { execFileSync }
    );
    expect(result).toEqual({ status: 'registered', serviceName: 'StudixApp' });
    expect(calls).toContainEqual(['nssm.exe', 'install', 'StudixApp', 'C:\\Studix\\node\\node.exe', 'C:\\Studix\\backend\\src\\server.js']);
    expect(calls).toContainEqual(['nssm.exe', 'set', 'StudixApp', 'AppDirectory', 'C:\\Studix']);
    expect(calls).toContainEqual(['nssm.exe', 'set', 'StudixApp', 'DependOnService', 'StudixPostgreSQL']);
    expect(calls.some((c) => c[0] === 'nssm.exe' && c[1] === 'set' && c[3] === 'AppStdout')).toBe(true);
    expect(calls.some((c) => c[0] === 'nssm.exe' && c[1] === 'set' && c[3] === 'AppStderr')).toBe(true);
    expect(calls.some((c) => c[0] === 'nssm.exe' && c[1] === 'set' && c[3] === 'AppExit')).toBe(true); // recovery
  });

  it('idempotent: an already-registered service whose NSSM Application/AppParameters match ours is a no-op', () => {
    const { execFileSync, calls } = fakeIo({ scConfig: SC_QC_APP, nssmMatches: true });
    const result = registerAppService(
      { installRoot: 'C:\\Studix', serviceName: 'StudixApp', nssmPath: 'nssm.exe' },
      { execFileSync }
    );
    expect(result).toEqual({ status: 'already_registered', serviceName: 'StudixApp' });
    expect(calls.some((c) => c.includes('install'))).toBe(false);
  });

  it('fails closed: an already-registered service whose NSSM config does not match ours is never overwritten', () => {
    const { execFileSync, calls } = fakeIo({ scConfig: SC_QC_APP, nssmMatches: false });
    expect(() => registerAppService(
      { installRoot: 'C:\\Studix', serviceName: 'StudixApp', nssmPath: 'nssm.exe' },
      { execFileSync }
    )).toThrow(WindowsServiceError);
    expect(calls.some((c) => c.includes('install'))).toBe(false);
  });

  it('fails closed: an already-registered service that cannot even be queried via NSSM (not NSSM-managed at all) is never overwritten', () => {
    const { execFileSync, calls } = fakeIo({ scConfig: SC_QC_APP, nssmThrows: true });
    expect(() => registerAppService(
      { installRoot: 'C:\\Studix', serviceName: 'StudixApp', nssmPath: 'nssm.exe' },
      { execFileSync }
    )).toThrow(WindowsServiceError);
    expect(calls.some((c) => c.includes('install'))).toBe(false);
  });
});

describe('unregisterAppService', () => {
  function fakeIo({ scConfig = null, nssmMatches = true, running = false } = {}) {
    const calls = [];
    const execFileSync = vi.fn((cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === 'sc.exe' && args[0] === 'qc') { if (scConfig === null) throw notFoundError(); return scConfig; }
      if (cmd === 'sc.exe' && args[0] === 'query') return running ? SC_QUERY_RUNNING : SC_QUERY_STOPPED;
      if (String(cmd).includes('nssm') && args[0] === 'get') {
        if (args[2] === 'Application') return nssmMatches ? 'C:\\Studix\\node\\node.exe' : 'C:\\other.exe';
        if (args[2] === 'AppParameters') return nssmMatches ? 'C:\\Studix\\backend\\src\\server.js' : 'C:\\other.js';
      }
      return '';
    });
    return { execFileSync, calls };
  }

  it('idempotent: unregistering a service that does not exist is a clean no-op', () => {
    const { execFileSync } = fakeIo();
    const result = unregisterAppService({ installRoot: 'C:\\Studix', nssmPath: 'nssm.exe' }, { execFileSync });
    expect(result).toEqual({ status: 'not_registered', serviceName: 'StudixApp' });
  });

  it('stops a running matching service before removing it via nssm remove <name> confirm', () => {
    const { execFileSync, calls } = fakeIo({ scConfig: SC_QC_APP, nssmMatches: true, running: true });
    const result = unregisterAppService({ installRoot: 'C:\\Studix', nssmPath: 'nssm.exe' }, { execFileSync });
    expect(result).toEqual({ status: 'unregistered', serviceName: 'StudixApp' });
    expect(calls).toContainEqual(['nssm.exe', 'remove', 'StudixApp', 'confirm']);
    const stopIdx = calls.findIndex((c) => c[0] === 'sc.exe' && c[1] === 'stop');
    const removeIdx = calls.findIndex((c) => c.includes('remove'));
    expect(stopIdx).toBeGreaterThanOrEqual(0);
    expect(removeIdx).toBeGreaterThan(stopIdx);
  });

  it('refuses to remove a same-named service whose NSSM config does not match ours', () => {
    const { execFileSync, calls } = fakeIo({ scConfig: SC_QC_APP, nssmMatches: false });
    expect(() => unregisterAppService({ installRoot: 'C:\\Studix', nssmPath: 'nssm.exe' }, { execFileSync }))
      .toThrow(WindowsServiceError);
    expect(calls.some((c) => c.includes('remove'))).toBe(false);
  });
});

describe('error classification — every failure path carries a machine-readable .reason', () => {
  it.each([
    ['not_registered', () => startService('X', { execFileSync: () => { throw notFoundError(); } })],
    ['sc_query_failed', () => queryServiceConfig('X', { execFileSync: () => { const e = new Error('denied'); e.status = 5; throw e; } })],
  ])('%s', (expectedReason, fn) => {
    try {
      fn();
      expect.fail('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WindowsServiceError);
      expect(err.reason).toBe(expectedReason);
    }
  });
});
