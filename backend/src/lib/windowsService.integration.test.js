// backend/src/lib/windowsService.integration.test.js
// Real-nssm.exe verification for the AppParameters quoting fix (registerAppService/
// unregisterAppService in windowsService.js). A mocked execFileSync cannot prove anything about
// how NSSM actually reconstructs its child process command line at service-start time — this
// file installs a REAL, disposable NSSM-managed service under a deliberately SPACE-CONTAINING
// install path (the exact condition, "C:\Program Files\Studix\...", that exposed the bug), and
// confirms a real node.exe process actually receives the complete, unmangled script path.
//
// Requires: a real nssm.exe (STUDIX_NSSM_PATH override, else the build output at
// release/win-x64/studix/tools/nssm.exe) AND an elevated shell (installing/removing a Windows
// service requires Administrator). Skips itself with a clear reason — never a false pass — if
// either prerequisite is missing, mirroring postgresProvisioning.integration.test.js's own
// skip-with-reason convention.
//
// Never touches the real StudixApp/StudixPostgreSQL services — uses its own uniquely-named,
// fully disposable service and scratch directory, removed in afterAll whether tests pass or fail.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  registerAppService, unregisterAppService, queryServiceConfig,
} from './windowsService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // backend/src/lib

function findRealNssm() {
  if (process.env.STUDIX_NSSM_PATH && fs.existsSync(process.env.STUDIX_NSSM_PATH)) {
    return process.env.STUDIX_NSSM_PATH;
  }
  const candidate = path.join(__dirname, '..', '..', '..', 'release', 'win-x64', 'studix', 'tools', 'nssm.exe');
  return fs.existsSync(candidate) ? candidate : null;
}

// Classic, reliable elevation probe: `net session` only succeeds for an elevated process,
// regardless of whether the account itself is an administrator (UAC-filtered tokens fail it).
function isElevated() {
  try {
    execFileSync('net', ['session'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const realNssmPath = findRealNssm();
const elevated = realNssmPath ? isElevated() : false;
const canRun = Boolean(realNssmPath) && elevated;

if (!realNssmPath) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n[windowsService.integration.test.js] No real nssm.exe found (checked STUDIX_NSSM_PATH ' +
    'and release/win-x64/studix/tools/nssm.exe) — real-NSSM verification SKIPPED, not simulated.\n'
  );
} else if (!elevated) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n[windowsService.integration.test.js] Not running elevated (Windows service install/' +
    'remove requires Administrator) — real-NSSM verification SKIPPED. Re-run from an elevated ' +
    'shell to actually exercise this file.\n'
  );
}

describe.skipIf(!canRun)('registerAppService/unregisterAppService — real nssm.exe, space-containing install path', () => {
  let scratchRoot;
  let serviceName;
  let scriptPath;

  beforeAll(() => {
    // Deliberately contains a space — the exact condition ("C:\Program Files\Studix\...") that
    // exposed the AppParameters-quoting bug. A space-free scratch path would not reproduce it.
    scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'Studix WinSvc IT '));
    fs.mkdirSync(path.join(scratchRoot, 'node'), { recursive: true });
    fs.mkdirSync(path.join(scratchRoot, 'backend', 'src'), { recursive: true });
    fs.copyFileSync(process.execPath, path.join(scratchRoot, 'node', 'node.exe'));
    scriptPath = path.join(scratchRoot, 'backend', 'src', 'server.js');
    // Stays alive for a few seconds after writing its result — an instantly-exiting script
    // (even with exit code 0) races NSSM's own start-confirmation/crash-loop-throttle logic and
    // can flip the service to PAUSED before `nssm start` finishes polling, which is a property of
    // the dummy script's timing, not of registerAppService/NSSM's AppParameters handling.
    fs.writeFileSync(
      scriptPath,
      `require('fs').writeFileSync(${JSON.stringify(path.join(scratchRoot, 'result.json'))}, ` +
      `JSON.stringify({ argv1: process.argv[1] })); setTimeout(() => process.exit(0), 4000);`
    );
    serviceName = `StudixWinSvcIT_${Date.now()}`;
  });

  afterAll(() => {
    try { execFileSync(realNssmPath, ['stop', serviceName], { stdio: 'ignore' }); } catch { /* best-effort */ }
    try {
      if (queryServiceConfig(serviceName)) {
        unregisterAppService({ installRoot: scratchRoot, serviceName, nssmPath: realNssmPath });
      }
    } catch {
      // best-effort — still attempt filesystem cleanup below regardless
    }
    // A just-stopped node.exe can hold its own exe file open for a brief moment after the SCM
    // reports it stopped — retry the scratch-dir removal a few times rather than failing the
    // whole suite on a transient EPERM.
    if (scratchRoot) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          fs.rmSync(scratchRoot, { recursive: true, force: true });
          break;
        } catch {
          sleepSync(500);
        }
      }
    }
  });

  it('installs with a properly-quoted AppParameters, and the real service actually launches node.exe with the complete script path', () => {
    const result = registerAppService({
      installRoot: scratchRoot, serviceName, dependsOnServiceName: 'RpcSs', nssmPath: realNssmPath,
    });
    expect(result).toEqual({ status: 'registered', serviceName });

    const storedParams = execFileSync(realNssmPath, ['get', serviceName, 'AppParameters'], { encoding: 'utf8' }).trim();
    expect(storedParams).toBe(`"${scriptPath}"`); // literal embedded quotes, confirmed via real nssm get

    // NSSM's own `start` subcommand polls for RUNNING for only a short, impatient window and can
    // report failure (e.g. "Unexpected status SERVICE_START_PENDING") even though the SCM goes on
    // to start the service successfully moments later — a property of nssm.exe's CLI, not of
    // registerAppService or the quoting fix. The real, unambiguous success signal is whether the
    // real node.exe process actually ran with the correct argv, proven below by polling for the
    // result file it writes — that is what this test actually asserts on.
    try { execFileSync(realNssmPath, ['start', serviceName]); } catch { /* see comment above */ }

    const resultFile = path.join(scratchRoot, 'result.json');
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(resultFile) && Date.now() < deadline) sleepSync(200);
    expect(fs.existsSync(resultFile)).toBe(true);

    const written = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    expect(written.argv1).toBe(scriptPath); // real node.exe received the COMPLETE, unmangled path

    try { execFileSync(realNssmPath, ['stop', serviceName]); } catch { /* best-effort */ }
  }, 30_000);

  it('registering again against the same real service is idempotent (already_registered, no reinstall)', () => {
    const result = registerAppService({ installRoot: scratchRoot, serviceName, nssmPath: realNssmPath });
    expect(result).toEqual({ status: 'already_registered', serviceName });
  });

  it('repairs a real legacy-unquoted service in place via nssm set, without reinstalling', () => {
    // Force the real service back into the pre-fix, unquoted shape to prove the repair path
    // against a genuinely NSSM-managed service, not a mock.
    execFileSync(realNssmPath, ['set', serviceName, 'AppParameters', scriptPath]); // unquoted, on purpose
    const before = execFileSync(realNssmPath, ['get', serviceName, 'AppParameters'], { encoding: 'utf8' }).trim();
    expect(before).toBe(scriptPath); // confirmed genuinely unquoted before repair

    const result = registerAppService({ installRoot: scratchRoot, serviceName, nssmPath: realNssmPath });
    expect(result).toEqual({ status: 'repaired', serviceName });

    const after = execFileSync(realNssmPath, ['get', serviceName, 'AppParameters'], { encoding: 'utf8' }).trim();
    expect(after).toBe(`"${scriptPath}"`);
  });

  it('unregisterAppService removes the real service cleanly', () => {
    const result = unregisterAppService({ installRoot: scratchRoot, serviceName, nssmPath: realNssmPath });
    expect(result).toEqual({ status: 'unregistered', serviceName });

    // The SCM can briefly report a service "marked for deletion" (still queryable) for a moment
    // after `nssm remove` returns before it's actually purged — poll rather than asserting the
    // very instant `unregisterAppService` returns.
    let config = queryServiceConfig(serviceName, {});
    const deadline = Date.now() + 5000;
    while (config !== null && Date.now() < deadline) {
      sleepSync(200);
      config = queryServiceConfig(serviceName, {});
    }
    expect(config).toBeNull();
  });
});
