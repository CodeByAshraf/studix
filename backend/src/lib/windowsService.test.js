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
  resolveInstallRoot, resolveNodeExePath, resolveServerJsPath, resolveNssmPath, resolvePinnedNssmPath,
  parseScQcOutput, queryServiceConfig, queryServiceState,
  startService, stopService, serviceStatus,
  configureServiceRecovery, configureAppRecovery,
  registerPostgresService, unregisterPostgresService,
  registerAppService, unregisterAppService,
  isPostgresServiceRegisteredFor,
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

  // resolvePinnedNssmPath: the bundled nssm.exe's actual, fixed location — {installRoot}\tools\
  // nssm.exe. Deliberately NEVER a bare "nssm.exe" PATH lookup, unlike resolveNssmPath's own
  // default (that default exists only for manual/dev CLI convenience — see its header) — any
  // installer-driven caller (firstInstall.js already inlines this exact join; manageWindowsServices.js's
  // CLI now uses this shared helper for the same join) must always resolve the one place nssm.exe
  // is actually guaranteed to exist, never rely on it being on PATH (it never is — INSTALL-06 never
  // adds it there, deliberately).
  it('resolvePinnedNssmPath joins installRoot + tools + nssm.exe, ignoring STUDIX_NSSM_PATH entirely', () => {
    process.env.STUDIX_NSSM_PATH = 'C:\\SomewhereElse\\nssm.exe'; // must be ignored — pinned path never defers to this
    expect(resolvePinnedNssmPath('D:\\Studix')).toBe(path.join('D:\\Studix', 'tools', 'nssm.exe'));
  });

  it('resolvePinnedNssmPath defaults its installRoot from resolveInstallRoot() (STUDIX_INSTALL_ROOT override respected)', () => {
    delete process.env.STUDIX_NSSM_PATH;
    process.env.STUDIX_INSTALL_ROOT = 'E:\\CustomInstall';
    expect(resolvePinnedNssmPath()).toBe(path.join('E:\\CustomInstall', 'tools', 'nssm.exe'));
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
  // Stateful (not fixed-response) mock: `sc.exe stop` flips the tracked state to STOPPED and
  // `pg_ctl unregister` flips `registered` to false, so subsequent `sc.exe query`/`sc.exe qc`
  // calls reflect the command that was actually issued — this is what lets the new
  // waitUntil()-based polling in stopService/unregisterPostgresService (see windowsService.js)
  // actually converge instead of spinning until its real timeout. A fixed-response mock (the old
  // shape) can never satisfy "wait for the real state to change" and would hang every affected
  // test for the full 15s timeout.
  function fakeIo({ existingConfig = null, running = false } = {}) {
    const calls = [];
    let state = running ? 'RUNNING' : 'STOPPED';
    let registered = existingConfig !== null;
    const execFileSync = vi.fn((cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === 'sc.exe' && args[0] === 'qc') { if (!registered) throw notFoundError(); return existingConfig; }
      if (cmd === 'sc.exe' && args[0] === 'query') { if (!registered) throw notFoundError(); return state === 'RUNNING' ? SC_QUERY_RUNNING : SC_QUERY_STOPPED; }
      if (cmd === 'sc.exe' && args[0] === 'stop') { state = 'STOPPED'; return ''; }
      if (args.includes('unregister')) { registered = false; return ''; }
      return '';
    });
    const existsSync = () => true;
    // sleepSync: () => {} — no real waiting needed: this mock updates state synchronously
    // inside the exec call itself, so waitUntil's very first post-command poll already sees the
    // new state. A real sleepSync would still work, just slower for no reason in a unit test.
    return { execFileSync, existsSync, calls, sleepSync: () => {} };
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

  // Regression coverage for the real Phase 3B uninstall failure: `sc.exe stop`/`pg_ctl unregister`
  // exiting 0 does not mean the SCM has actually settled — it can still report the service as
  // RUNNING/registered for a bit afterward. Before this fix, stopService/unregisterPostgresService
  // trusted the exit code alone and returned immediately, so a teardown sequence that acted on
  // StudixApp then StudixPostgreSQL right after could hit StudixPostgreSQL while the SCM still
  // considered it not-yet-settled — exactly the "PostgreSQL unregister returned exit code 1"
  // symptom from the retry. These prove the module now waits for the REAL state instead.
  it('waits for the real STOPPED state even if it lags a few polls behind the `sc stop` exit code (never trusts the exit code alone)', () => {
    let queriesAfterStop = 0;
    let stopIssued = false;
    let registered = true;
    const execFileSync = vi.fn((cmd, args) => {
      if (cmd === 'sc.exe' && args[0] === 'qc') { if (!registered) throw notFoundError(); return SC_QC_POSTGRES; }
      if (cmd === 'sc.exe' && args[0] === 'query') {
        if (!registered) throw notFoundError();
        if (!stopIssued) return SC_QUERY_RUNNING;
        queriesAfterStop += 1;
        // Simulates real STOP_PENDING lag: `sc stop` already exited 0, but the SCM only reports
        // the genuine terminal STOPPED state a couple of polls later.
        return queriesAfterStop >= 3 ? SC_QUERY_STOPPED : SC_QUERY_RUNNING;
      }
      if (cmd === 'sc.exe' && args[0] === 'stop') { stopIssued = true; return ''; } // exits 0 immediately
      if (args.includes('unregister')) { registered = false; return ''; }
      return '';
    });
    const existsSync = () => true;
    const result = unregisterPostgresService(
      { pgHome: 'C:\\Studix\\pgsql', pgDataDir: 'C:\\ProgramData\\Studix\\pgdata' },
      { execFileSync, existsSync, sleepSync: () => {} }
    );
    expect(result).toEqual({ status: 'unregistered', serviceName: 'StudixPostgreSQL' });
    expect(queriesAfterStop).toBeGreaterThanOrEqual(3); // proves it actually polled, not just checked once
  });

  it('throws a fail-closed stop_timeout (never falls through to unregister) if the service never actually reaches STOPPED', () => {
    const execFileSync = vi.fn((cmd, args) => {
      if (cmd === 'sc.exe' && args[0] === 'qc') return SC_QC_POSTGRES;
      if (cmd === 'sc.exe' && args[0] === 'query') return SC_QUERY_RUNNING; // never settles
      if (cmd === 'sc.exe' && args[0] === 'stop') return '';
      if (args.includes('unregister')) throw new Error('must never reach pg_ctl unregister while still RUNNING');
      return '';
    });
    const existsSync = () => true;
    let caught;
    try {
      unregisterPostgresService(
        { pgHome: 'C:\\Studix\\pgsql', pgDataDir: 'C:\\ProgramData\\Studix\\pgdata' },
        // timeoutMs/pollIntervalMs shrunk to milliseconds — proving the timeout path fires does
        // not need to spend real wall-clock seconds waiting for it.
        { execFileSync, existsSync, sleepSync: () => {}, timeoutMs: 50, pollIntervalMs: 5 }
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WindowsServiceError);
    expect(caught.reason).toBe('stop_timeout');
  });
});

describe('registerAppService', () => {
  // appParamsShape controls the exact AppParameters NSSM's `get` reports back for the
  // already-registered case, so tests can distinguish the three states isOurAppService/
  // registerAppService must tell apart:
  //   'quoted'   — the current, correctly-quoted shape (quoteNssmParam(serverJs)) -> no-op
  //   'legacy'   — the pre-fix, unquoted-but-otherwise-matching shape -> repaired in place
  //   'mismatch' — genuinely some other service/app -> hard conflict, never touched
  function fakeIo({ scConfig = null, nssmApplicationMatches = true, appParamsShape = 'quoted', nssmThrows = false, serverJsPath = 'C:\\Studix\\backend\\src\\server.js' } = {}) {
    const calls = [];
    const execFileSync = vi.fn((cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === 'sc.exe' && args[0] === 'qc') { if (scConfig === null) throw notFoundError(); return scConfig; }
      if (cmd === 'sc.exe' && args[0] === 'query') return SC_QUERY_STOPPED;
      if (String(cmd).includes('nssm') && args[0] === 'get') {
        if (nssmThrows) throw new Error('not an NSSM service');
        if (args[2] === 'Application') return nssmApplicationMatches ? 'C:\\Studix\\node\\node.exe' : 'C:\\SomeOtherApp\\other.exe';
        if (args[2] === 'AppParameters') {
          if (appParamsShape === 'quoted') return `"${serverJsPath}"`;
          if (appParamsShape === 'legacy') return serverJsPath;
          return 'C:\\other.js'; // mismatch
        }
      }
      return '';
    });
    return { execFileSync, calls };
  }

  it('fresh registration: installs via nssm with node.exe/quoted server.js, sets AppDirectory/Start/DependOnService/stdout/stderr, configures recovery', () => {
    const { execFileSync, calls } = fakeIo();
    const result = registerAppService(
      { installRoot: 'C:\\Studix', serviceName: 'StudixApp', dependsOnServiceName: 'StudixPostgreSQL', nssmPath: 'nssm.exe' },
      { execFileSync }
    );
    expect(result).toEqual({ status: 'registered', serviceName: 'StudixApp' });
    expect(calls).toContainEqual(['nssm.exe', 'install', 'StudixApp', 'C:\\Studix\\node\\node.exe', '"C:\\Studix\\backend\\src\\server.js"']);
    expect(calls).toContainEqual(['nssm.exe', 'set', 'StudixApp', 'AppDirectory', 'C:\\Studix']);
    expect(calls).toContainEqual(['nssm.exe', 'set', 'StudixApp', 'DependOnService', 'StudixPostgreSQL']);
    expect(calls.some((c) => c[0] === 'nssm.exe' && c[1] === 'set' && c[3] === 'AppStdout')).toBe(true);
    expect(calls.some((c) => c[0] === 'nssm.exe' && c[1] === 'set' && c[3] === 'AppStderr')).toBe(true);
    expect(calls.some((c) => c[0] === 'nssm.exe' && c[1] === 'set' && c[3] === 'AppExit')).toBe(true); // recovery
  });

  // The exact bug this test guards against only manifests when the install path actually
  // contains a space (e.g. the real "C:\Program Files\Studix") — a space-free fixture like
  // "C:\Studix" would pass even with the old, unfixed code, so this test would not have caught
  // the regression. See migration report for the empirical nssm.exe round-trip this fix was
  // verified against before being written.
  it('fresh registration with a space-containing installRoot: the script-path argument is embedded in literal quotes', () => {
    const { execFileSync, calls } = fakeIo({ serverJsPath: 'C:\\Program Files\\Studix\\backend\\src\\server.js' });
    const result = registerAppService(
      { installRoot: 'C:\\Program Files\\Studix', serviceName: 'StudixApp', nssmPath: 'nssm.exe' },
      { execFileSync }
    );
    expect(result).toEqual({ status: 'registered', serviceName: 'StudixApp' });
    const installCall = calls.find((c) => c[1] === 'install');
    expect(installCall).toBeDefined();
    const scriptArg = installCall[installCall.length - 1];
    expect(scriptArg).toBe('"C:\\Program Files\\Studix\\backend\\src\\server.js"');
    expect(scriptArg.startsWith('"')).toBe(true);
    expect(scriptArg.endsWith('"')).toBe(true);
  });

  it('idempotent: an already-registered service whose NSSM AppParameters is already correctly quoted is a no-op', () => {
    const { execFileSync, calls } = fakeIo({ scConfig: SC_QC_APP, appParamsShape: 'quoted' });
    const result = registerAppService(
      { installRoot: 'C:\\Studix', serviceName: 'StudixApp', nssmPath: 'nssm.exe' },
      { execFileSync }
    );
    expect(result).toEqual({ status: 'already_registered', serviceName: 'StudixApp' });
    expect(calls.some((c) => c.includes('install'))).toBe(false);
    expect(calls.some((c) => c[1] === 'set' && c[3] === 'AppParameters')).toBe(false);
  });

  it('legacy repair: an already-registered service with the pre-fix UNQUOTED AppParameters is corrected in place via nssm set, never reinstalled', () => {
    const { execFileSync, calls } = fakeIo({ scConfig: SC_QC_APP, appParamsShape: 'legacy' });
    const result = registerAppService(
      { installRoot: 'C:\\Studix', serviceName: 'StudixApp', nssmPath: 'nssm.exe' },
      { execFileSync }
    );
    expect(result).toEqual({ status: 'repaired', serviceName: 'StudixApp' });
    expect(calls).toContainEqual(['nssm.exe', 'set', 'StudixApp', 'AppParameters', '"C:\\Studix\\backend\\src\\server.js"']);
    expect(calls.some((c) => c.includes('install'))).toBe(false); // non-destructive: no reinstall
    expect(calls.some((c) => c.includes('remove'))).toBe(false); // non-destructive: no unregister
  });

  it('fails closed: an already-registered service whose NSSM config does not match ours (neither quoted nor legacy-unquoted) is never overwritten', () => {
    const { execFileSync, calls } = fakeIo({ scConfig: SC_QC_APP, appParamsShape: 'mismatch', nssmApplicationMatches: false });
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
  // appParamsShape mirrors registerAppService's fakeIo above — 'legacy' (unquoted, pre-fix) is
  // the DEFAULT here specifically to prove INSTALL-09's uninstall path (which must work
  // unconditionally, including against the currently-broken real-world service shape) is
  // unaffected by the quoting fix: unregister only ever checks isOurAppService(...).matches,
  // which is true for EITHER legitimate shape — it never inspects legacyUnquoted.
  // Stateful (not fixed-response) mock — same reasoning as unregisterPostgresService's fakeIo
  // above: `sc.exe stop` flips the tracked state to STOPPED and `nssm remove ... confirm` flips
  // `registered` to false, so the new waitUntil()-based polling in stopService/
  // unregisterAppService (windowsService.js) actually converges instead of spinning to its real
  // timeout against a mock that never changes its answer.
  function fakeIo({ scConfig = null, nssmApplicationMatches = true, appParamsShape = 'legacy', running = false } = {}) {
    const calls = [];
    let state = running ? 'RUNNING' : 'STOPPED';
    let registered = scConfig !== null;
    const execFileSync = vi.fn((cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === 'sc.exe' && args[0] === 'qc') { if (!registered) throw notFoundError(); return scConfig; }
      if (cmd === 'sc.exe' && args[0] === 'query') { if (!registered) throw notFoundError(); return state === 'RUNNING' ? SC_QUERY_RUNNING : SC_QUERY_STOPPED; }
      if (cmd === 'sc.exe' && args[0] === 'stop') { state = 'STOPPED'; return ''; }
      if (String(cmd).includes('nssm') && args[0] === 'remove') { registered = false; return ''; }
      if (String(cmd).includes('nssm') && args[0] === 'get') {
        if (args[2] === 'Application') return nssmApplicationMatches ? 'C:\\Studix\\node\\node.exe' : 'C:\\other.exe';
        if (args[2] === 'AppParameters') {
          if (appParamsShape === 'quoted') return '"C:\\Studix\\backend\\src\\server.js"';
          if (appParamsShape === 'legacy') return 'C:\\Studix\\backend\\src\\server.js';
          return 'C:\\other.js'; // mismatch
        }
      }
      return '';
    });
    // sleepSync: () => {} — this mock updates state synchronously inside the exec call itself,
    // so waitUntil's first post-command poll already observes the new state; no real wait needed.
    return { execFileSync, calls, sleepSync: () => {} };
  }

  it('idempotent: unregistering a service that does not exist is a clean no-op', () => {
    const { execFileSync } = fakeIo();
    const result = unregisterAppService({ installRoot: 'C:\\Studix', nssmPath: 'nssm.exe' }, { execFileSync });
    expect(result).toEqual({ status: 'not_registered', serviceName: 'StudixApp' });
  });

  it('INSTALL-09 uninstall path still works against the legacy, pre-fix UNQUOTED service shape (the exact real-world broken state)', () => {
    const { execFileSync, calls } = fakeIo({ scConfig: SC_QC_APP, appParamsShape: 'legacy', running: true });
    const result = unregisterAppService({ installRoot: 'C:\\Studix', nssmPath: 'nssm.exe' }, { execFileSync });
    expect(result).toEqual({ status: 'unregistered', serviceName: 'StudixApp' });
    expect(calls).toContainEqual(['nssm.exe', 'remove', 'StudixApp', 'confirm']);
  });

  it('uninstall also works against the new, correctly-quoted service shape', () => {
    const { execFileSync, calls } = fakeIo({ scConfig: SC_QC_APP, appParamsShape: 'quoted', running: true });
    const result = unregisterAppService({ installRoot: 'C:\\Studix', nssmPath: 'nssm.exe' }, { execFileSync });
    expect(result).toEqual({ status: 'unregistered', serviceName: 'StudixApp' });
    expect(calls).toContainEqual(['nssm.exe', 'remove', 'StudixApp', 'confirm']);
  });

  it('stops a running matching service before removing it via nssm remove <name> confirm', () => {
    const { execFileSync, calls } = fakeIo({ scConfig: SC_QC_APP, nssmApplicationMatches: true, appParamsShape: 'legacy', running: true });
    const result = unregisterAppService({ installRoot: 'C:\\Studix', nssmPath: 'nssm.exe' }, { execFileSync });
    expect(result).toEqual({ status: 'unregistered', serviceName: 'StudixApp' });
    expect(calls).toContainEqual(['nssm.exe', 'remove', 'StudixApp', 'confirm']);
    const stopIdx = calls.findIndex((c) => c[0] === 'sc.exe' && c[1] === 'stop');
    const removeIdx = calls.findIndex((c) => c.includes('remove'));
    expect(stopIdx).toBeGreaterThanOrEqual(0);
    expect(removeIdx).toBeGreaterThan(stopIdx);
  });

  it('refuses to remove a same-named service whose NSSM config does not match ours', () => {
    const { execFileSync, calls } = fakeIo({ scConfig: SC_QC_APP, appParamsShape: 'mismatch' });
    expect(() => unregisterAppService({ installRoot: 'C:\\Studix', nssmPath: 'nssm.exe' }, { execFileSync }))
      .toThrow(WindowsServiceError);
    expect(calls.some((c) => c.includes('remove'))).toBe(false);
  });

  // Regression coverage mirroring unregisterPostgresService's own — see that describe block's
  // comment for the full Phase 3B incident this closes. StudixApp is the FIRST teardown call in
  // TeardownServiceForWipe (installer/studix.iss), so it is the one whose premature "success" put
  // StudixPostgreSQL's own teardown at risk.
  it('waits for the real STOPPED state even if it lags a few polls behind the `sc stop` exit code (never trusts the exit code alone)', () => {
    let queriesAfterStop = 0;
    let stopIssued = false;
    let registered = true;
    const execFileSync = vi.fn((cmd, args) => {
      if (cmd === 'sc.exe' && args[0] === 'qc') { if (!registered) throw notFoundError(); return SC_QC_APP; }
      if (cmd === 'sc.exe' && args[0] === 'query') {
        if (!registered) throw notFoundError();
        if (!stopIssued) return SC_QUERY_RUNNING;
        queriesAfterStop += 1;
        return queriesAfterStop >= 3 ? SC_QUERY_STOPPED : SC_QUERY_RUNNING;
      }
      if (cmd === 'sc.exe' && args[0] === 'stop') { stopIssued = true; return ''; }
      if (String(cmd).includes('nssm') && args[0] === 'remove') { registered = false; return ''; }
      if (String(cmd).includes('nssm') && args[0] === 'get') {
        return args[2] === 'Application' ? 'C:\\Studix\\node\\node.exe' : 'C:\\Studix\\backend\\src\\server.js';
      }
      return '';
    });
    const result = unregisterAppService(
      { installRoot: 'C:\\Studix', nssmPath: 'nssm.exe' },
      { execFileSync, sleepSync: () => {} }
    );
    expect(result).toEqual({ status: 'unregistered', serviceName: 'StudixApp' });
    expect(queriesAfterStop).toBeGreaterThanOrEqual(3);
  });

  it('throws a fail-closed stop_timeout (never falls through to nssm remove) if the service never actually reaches STOPPED', () => {
    const execFileSync = vi.fn((cmd, args) => {
      if (cmd === 'sc.exe' && args[0] === 'qc') return SC_QC_APP;
      if (cmd === 'sc.exe' && args[0] === 'query') return SC_QUERY_RUNNING; // never settles
      if (cmd === 'sc.exe' && args[0] === 'stop') return '';
      if (String(cmd).includes('nssm') && args[0] === 'get') {
        return args[2] === 'Application' ? 'C:\\Studix\\node\\node.exe' : 'C:\\Studix\\backend\\src\\server.js';
      }
      if (String(cmd).includes('nssm') && args[0] === 'remove') throw new Error('must never reach nssm remove while still RUNNING');
      return '';
    });
    let caught;
    try {
      unregisterAppService(
        { installRoot: 'C:\\Studix', nssmPath: 'nssm.exe' },
        { execFileSync, sleepSync: () => {}, timeoutMs: 50, pollIntervalMs: 5 }
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WindowsServiceError);
    expect(caught.reason).toBe('stop_timeout');
  });
});

// ── Phase 3B regression: the reported real-world uninstall failure ─────────────────────────────
// Retry summary (verified): both confirmation dialogs were answered YES, StudixApp was stopped/
// unregistered successfully, but StudixPostgreSQL remained RUNNING and its own unregister exited
// 1 — "the SCM dependency state had not fully settled." The installer's fail-closed guard aborted
// correctly (no data was deleted), but the root cause was a genuine source defect: unregisterApp
// Service reported success as soon as `nssm remove` exited 0, without confirming the SCM had
// actually finished settling StudixApp's removal — so TeardownServiceForWipe('postgres') (which
// runs immediately after in InitializeUninstall) could observe a StudixPostgreSQL that the SCM
// still refused to stop/unregister because a not-yet-fully-gone StudixApp still listed it via
// DependOnService.
//
// This test reproduces that exact mechanism with a single shared, stateful fake SCM: attempting
// to stop/unregister StudixPostgreSQL while StudixApp is not yet FULLY purged throws the same
// class of error `sc.exe`/`pg_ctl.exe` would really surface (ERROR_DEPENDENT_SERVICES_RUNNING).
// It proves the fix: because unregisterAppService now blocks until the SCM has genuinely purged
// StudixApp (waitUntil polling queryServiceConfig -> null) before returning, by the time
// TeardownServiceForWipe would move on to postgres, the dependency is verifiably already clear.
describe('cross-service teardown ordering (installer/studix.iss TeardownServiceForWipe reproduction)', () => {
  it('postgres teardown only succeeds once app teardown has genuinely, fully settled — not merely exited 0', () => {
    let tick = 0;
    let appState = 'RUNNING';
    let appRemoveTick = null;
    const APP_SETTLE_TICKS = 4; // real SCM purge lag after `nssm remove` returns

    let pgState = 'RUNNING';
    let pgRegistered = true;

    const appFullyGone = () => appRemoveTick !== null && (tick - appRemoveTick) >= APP_SETTLE_TICKS;

    const execFileSync = vi.fn((cmd, args) => {
      tick += 1;
      const forApp = args.includes('StudixApp') || String(cmd).includes('nssm');
      const forPg = !forApp && (args.includes('StudixPostgreSQL') || String(cmd).includes('pg_ctl'));

      if (forApp) {
        if (args[0] === 'qc') { if (appFullyGone()) throw notFoundError(); return SC_QC_APP; }
        if (args[0] === 'query') { if (appFullyGone()) throw notFoundError(); return appState === 'RUNNING' ? SC_QUERY_RUNNING : SC_QUERY_STOPPED; }
        if (args[0] === 'stop') { appState = 'STOPPED'; return ''; }
        if (args[0] === 'get') { return args[2] === 'Application' ? 'C:\\Studix\\node\\node.exe' : 'C:\\Studix\\backend\\src\\server.js'; }
        if (args[0] === 'remove') { appRemoveTick = tick; return ''; }
      }

      if (forPg) {
        if (args[0] === 'qc') { if (!pgRegistered) throw notFoundError(); return SC_QC_POSTGRES; }
        if (args[0] === 'query') { if (!pgRegistered) throw notFoundError(); return pgState === 'RUNNING' ? SC_QUERY_RUNNING : SC_QUERY_STOPPED; }
        if (args[0] === 'stop') {
          if (!appFullyGone()) { const err = new Error('The service cannot be stopped because other running services are dependent on it.'); err.status = 1; throw err; }
          pgState = 'STOPPED';
          return '';
        }
        if (args.includes('unregister')) {
          if (!appFullyGone()) { const err = new Error('The service cannot be stopped because other running services are dependent on it.'); err.status = 1; throw err; }
          pgRegistered = false;
          return '';
        }
      }
      return '';
    });

    const appResult = unregisterAppService(
      { installRoot: 'C:\\Studix', serviceName: 'StudixApp', nssmPath: 'nssm.exe' },
      { execFileSync, sleepSync: () => {} }
    );
    expect(appResult).toEqual({ status: 'unregistered', serviceName: 'StudixApp' });

    // By the time app teardown returns, the SCM must already be genuinely settled — this is the
    // exact guarantee TeardownServiceForWipe('app') needs before calling TeardownServiceForWipe
    // ('postgres') right after it.
    expect(appFullyGone()).toBe(true);

    const pgResult = unregisterPostgresService(
      { pgHome: 'C:\\Studix\\pgsql', pgDataDir: 'C:\\ProgramData\\Studix\\pgdata', serviceName: 'StudixPostgreSQL' },
      { execFileSync, existsSync: () => true, sleepSync: () => {} }
    );
    expect(pgResult).toEqual({ status: 'unregistered', serviceName: 'StudixPostgreSQL' });
  });
});

describe('isPostgresServiceRegisteredFor — service-ownership predicate (upgrade lifecycle fix)', () => {
  // Reuses queryServiceConfig/isOurPostgresService's own logic (not a bare "does a service with
  // this name exist" check) — a same-named service pointing at a DIFFERENT pgdata must never be
  // treated as ours. See db/postgresProvisioning.js's provisionPostgres(), which injects this
  // check to decide whether PostgreSQL lifecycle is already service-owned for a given data
  // directory (never a direct import — postgresProvisioning.js has no dependency on this module).
  it('true when StudixPostgreSQL is registered and points at this exact pgdata', () => {
    const execFileSync = vi.fn(() => SC_QC_POSTGRES);
    expect(isPostgresServiceRegisteredFor('C:\\ProgramData\\Studix\\pgdata', STUDIX_POSTGRES_SERVICE_NAME, { execFileSync }))
      .toBe(true);
  });

  it('false when a same-named service exists but points at a DIFFERENT pgdata (never treated as ours)', () => {
    const foreignConfig = SC_QC_POSTGRES.replace('C:\\ProgramData\\Studix\\pgdata', 'C:\\SomeOtherApp\\data');
    const execFileSync = vi.fn(() => foreignConfig);
    expect(isPostgresServiceRegisteredFor('C:\\ProgramData\\Studix\\pgdata', STUDIX_POSTGRES_SERVICE_NAME, { execFileSync }))
      .toBe(false);
  });

  it('false when no service is registered at all (fresh install, no service yet)', () => {
    const execFileSync = vi.fn(() => { throw notFoundError(); });
    expect(isPostgresServiceRegisteredFor('C:\\ProgramData\\Studix\\pgdata', STUDIX_POSTGRES_SERVICE_NAME, { execFileSync }))
      .toBe(false);
  });

  it('defaults serviceName to STUDIX_POSTGRES_SERVICE_NAME', () => {
    const execFileSync = vi.fn((cmd, args) => {
      expect(args).toEqual(['qc', STUDIX_POSTGRES_SERVICE_NAME]);
      return SC_QC_POSTGRES;
    });
    isPostgresServiceRegisteredFor('C:\\ProgramData\\Studix\\pgdata', undefined, { execFileSync });
    expect(execFileSync).toHaveBeenCalled();
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
