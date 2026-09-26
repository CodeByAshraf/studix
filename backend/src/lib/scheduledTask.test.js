// backend/src/lib/scheduledTask.test.js
// Phase 3/4 — pure, dependency-injected unit tests. NEVER calls a real schtasks.exe and NEVER
// registers/queries/deletes a real Windows Scheduled Task — every execFileSync/writeFileSync/
// unlinkSync call is injected. Mirrors windowsService.test.js's own DI-at-the-command-boundary
// approach.
import { describe, it, expect, vi } from 'vitest';
import {
  STUDIX_STARTUP_TASK_NAME,
  ScheduledTaskError,
  resolveStartupOrchestratorPath,
  buildDesiredTaskConfig,
  buildTaskXml,
  parseTaskXml,
  taskConfigMatches,
  queryStartupTaskXml,
  ensureStartupTask,
  removeStartupTask,
  STUDIX_BACKUP_TASK_NAME,
  resolveRoutineBackupScriptPath,
  buildDesiredBackupTaskConfig,
  buildBackupTaskXml,
  parseBackupTaskXml,
  backupTaskConfigMatches,
  ensureBackupTask,
} from './scheduledTask.js';

const INSTALL_ROOT = 'C:\\Program Files\\Studix';
const NODE_EXE = 'C:\\Program Files\\Studix\\node\\node.exe';
const SCRIPT_PATH = 'C:\\Program Files\\Studix\\backend\\src\\db\\startupOrchestrator.js';

function desiredConfig() {
  return buildDesiredTaskConfig({ nodeExe: NODE_EXE, scriptPath: SCRIPT_PATH, installRoot: INSTALL_ROOT });
}

function xmlForDesired() {
  return buildTaskXml(desiredConfig());
}

function notFoundError() {
  const err = new Error('ERROR: The system cannot find the file specified.');
  err.status = 1;
  return err;
}

describe('resolveStartupOrchestratorPath', () => {
  it('derives the absolute bundled path from the install root', () => {
    expect(resolveStartupOrchestratorPath(INSTALL_ROOT)).toBe(
      'C:\\Program Files\\Studix\\backend\\src\\db\\startupOrchestrator.js'
    );
  });
});

describe('buildDesiredTaskConfig', () => {
  it('uses the bundled node.exe, the absolute startupOrchestrator.js path (quoted), and the install root as working directory', () => {
    const config = desiredConfig();
    expect(config.command).toBe(NODE_EXE);
    expect(config.arguments).toBe(`"${SCRIPT_PATH}"`);
    expect(config.workingDirectory).toBe(INSTALL_ROOT);
  });

  it('runs as SYSTEM at boot with highest privileges, whether or not a user is logged on', () => {
    const config = desiredConfig();
    expect(config.userId).toBe('S-1-5-18');
    expect(config.runLevel).toBe('HighestAvailable');
    expect(config.bootTriggerEnabled).toBe(true);
  });

  it('disallows parallel instances, sets a ~10 minute execution limit, configures no automatic restart, and has no network dependency', () => {
    const config = desiredConfig();
    expect(config.multipleInstancesPolicy).toBe('IgnoreNew');
    expect(config.executionTimeLimit).toBe('PT10M');
    expect(config.restartOnFailure).toBe(false);
    expect(config.runOnlyIfNetworkAvailable).toBe(false);
  });
});

describe('buildTaskXml / parseTaskXml round-trip', () => {
  it('parses back exactly what was built, and taskConfigMatches recognizes it as a match', () => {
    const desired = desiredConfig();
    const parsed = parseTaskXml(buildTaskXml(desired));
    expect(taskConfigMatches(desired, parsed)).toBe(true);
  });

  it('parses a real-shaped `schtasks /query /xml ONE` SYSTEM-account rendering (NT AUTHORITY\\SYSTEM spelling) as matching', () => {
    const desired = desiredConfig();
    const realShaped = buildTaskXml(desired).replace('<UserId>S-1-5-18</UserId>', '<UserId>NT AUTHORITY\\SYSTEM</UserId>');
    expect(taskConfigMatches(desired, parseTaskXml(realShaped))).toBe(true);
  });
});

describe('taskConfigMatches — detects each kind of drift', () => {
  it('flags a missing boot trigger', () => {
    const desired = desiredConfig();
    const actual = parseTaskXml(buildTaskXml(desired).replace(/<Triggers>[\s\S]*?<\/Triggers>/, '<Triggers></Triggers>'));
    expect(taskConfigMatches(desired, actual)).toBe(false);
  });

  it('flags a wrong run level (e.g. LeastPrivilege instead of HighestAvailable)', () => {
    const desired = desiredConfig();
    const actual = parseTaskXml(buildTaskXml(desired).replace('<RunLevel>HighestAvailable</RunLevel>', '<RunLevel>LeastPrivilege</RunLevel>'));
    expect(taskConfigMatches(desired, actual)).toBe(false);
  });

  it('flags a wrong multiple-instances policy (e.g. Parallel instead of IgnoreNew)', () => {
    const desired = desiredConfig();
    const actual = parseTaskXml(buildTaskXml(desired).replace('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>', '<MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>'));
    expect(taskConfigMatches(desired, actual)).toBe(false);
  });

  it('flags a wrong executable path (drifted install root)', () => {
    const desired = desiredConfig();
    const actual = parseTaskXml(buildTaskXml(desired).replace(NODE_EXE, 'C:\\Old\\node\\node.exe'));
    expect(taskConfigMatches(desired, actual)).toBe(false);
  });

  it('flags a RestartOnFailure element present in Settings', () => {
    const desired = desiredConfig();
    const xmlWithRestart = buildTaskXml(desired).replace(
      '</Settings>',
      '  <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>\n</Settings>'
    );
    expect(taskConfigMatches(desired, parseTaskXml(xmlWithRestart))).toBe(false);
  });

  it('flags a disabled task', () => {
    const desired = desiredConfig();
    const actual = parseTaskXml(buildTaskXml(desired).replace('<Enabled>true</Enabled>\n    <Hidden>', '<Enabled>false</Enabled>\n    <Hidden>'));
    expect(taskConfigMatches(desired, actual)).toBe(false);
  });

  it('taskConfigMatches(desired, null) is false (task not registered at all)', () => {
    expect(taskConfigMatches(desiredConfig(), null)).toBe(false);
  });
});

describe('queryStartupTaskXml', () => {
  it('returns the raw XML text when schtasks /Query succeeds', () => {
    const execFileSync = vi.fn(() => xmlForDesired());
    const xml = queryStartupTaskXml(STUDIX_STARTUP_TASK_NAME, { execFileSync });
    expect(xml).toBe(xmlForDesired());
    expect(execFileSync).toHaveBeenCalledWith(
      'schtasks.exe', ['/Query', '/TN', STUDIX_STARTUP_TASK_NAME, '/XML', 'ONE'],
      expect.objectContaining({ encoding: 'utf8' })
    );
  });

  it('returns null when the task does not exist (schtasks /Query fails)', () => {
    const execFileSync = vi.fn(() => { throw notFoundError(); });
    expect(queryStartupTaskXml(STUDIX_STARTUP_TASK_NAME, { execFileSync })).toBeNull();
  });
});

// baseIo: a fully-mocked IO surface — no real process is ever spawned and no real file is ever
// written/deleted from any test in this describe block.
function baseIo(overrides = {}) {
  const calls = [];
  const execFileSync = vi.fn((cmd, args) => {
    calls.push(['execFileSync', cmd, args]);
    if (cmd === 'schtasks.exe' && args[0] === '/Query') return xmlForDesired();
    return '';
  });
  const writeFileSync = vi.fn((...args) => calls.push(['writeFileSync', ...args]));
  const unlinkSync = vi.fn((...args) => calls.push(['unlinkSync', ...args]));
  return { io: { execFileSync, writeFileSync, unlinkSync, ...overrides }, calls, execFileSync, writeFileSync, unlinkSync };
}

// Real Windows verification (see the dedicated Windows-verification report) found two
// production defects in the generated XML: real `schtasks.exe /Create /XML` rejects a
// plain-UTF-8-bytes file outright ("unable to switch the encoding"), and separately rejects
// <LogonType>ServiceAccount</LogonType> as "incorrectly formatted or out of range" regardless of
// encoding or UserId spelling. This describe block proves both fixes.
describe('Windows compatibility fix — Issue C (XML encoding + invalid LogonType)', () => {
  const params = { installRoot: INSTALL_ROOT, nodeExe: NODE_EXE, scriptPath: SCRIPT_PATH };

  it('1. the generated XML no longer contains a <LogonType> element at all', () => {
    const xml = xmlForDesired();
    expect(xml).not.toContain('<LogonType>');
    expect(xml).not.toContain('ServiceAccount');
  });

  it('2. the generated XML still contains <UserId>S-1-5-18</UserId>', () => {
    expect(xmlForDesired()).toContain('<UserId>S-1-5-18</UserId>');
  });

  it('3. the generated XML still contains <RunLevel>HighestAvailable</RunLevel>', () => {
    expect(xmlForDesired()).toContain('<RunLevel>HighestAvailable</RunLevel>');
  });

  it('4. the XML declaration names UTF-16 (matching the actual bytes ensureStartupTask writes)', () => {
    expect(xmlForDesired()).toMatch(/^<\?xml version="1\.0" encoding="UTF-16"\?>/);
  });

  it('5. ensureStartupTask writes the definition file as real UTF-16LE bytes with a leading BOM', () => {
    const { io } = baseIo();
    io.execFileSync = vi.fn((cmd, args) => {
      if (args[0] === '/Query') throw notFoundError();
      return '';
    });
    let capturedBytes = null;
    let capturedEncoding = null;
    io.writeFileSync = vi.fn((_path, content, encoding) => {
      capturedEncoding = encoding;
      // Buffer.from(..., 'utf16le') is the exact same primitive Node's real fs.writeFileSync
      // itself uses to turn a string + encoding into bytes — this proves the REAL byte output,
      // not a re-implementation of the encoding logic.
      capturedBytes = Buffer.from(content, encoding);
    });

    ensureStartupTask(params, io);

    expect(capturedEncoding).toBe('utf16le');
    // UTF-16LE BOM is the two bytes 0xFF 0xFE.
    expect(capturedBytes[0]).toBe(0xff);
    expect(capturedBytes[1]).toBe(0xfe);
    // The bytes decode back to the leading BOM character followed by the exact XML this module
    // builds — never a re-encoded or subtly different copy.
    expect(capturedBytes.toString('utf16le')).toBe(`﻿${xmlForDesired()}`);
  });

  it('6. every other field of the desired configuration is unchanged by this fix', () => {
    const config = desiredConfig();
    expect(config).toEqual({
      bootTriggerEnabled: true,
      userId: 'S-1-5-18',
      runLevel: 'HighestAvailable',
      multipleInstancesPolicy: 'IgnoreNew',
      executionTimeLimit: 'PT10M',
      enabled: true,
      runOnlyIfNetworkAvailable: false,
      restartOnFailure: false,
      command: NODE_EXE,
      arguments: `"${SCRIPT_PATH}"`,
      workingDirectory: INSTALL_ROOT,
    });
  });

  it('a real-shaped task with no <LogonType> element at all still matches (the new normal shape)', () => {
    const desired = desiredConfig();
    const parsed = parseTaskXml(buildTaskXml(desired));
    expect(taskConfigMatches(desired, parsed)).toBe(true);
  });
});

describe('ensureStartupTask', () => {
  const params = { installRoot: INSTALL_ROOT, nodeExe: NODE_EXE, scriptPath: SCRIPT_PATH };

  it('1. fresh registration: no existing task -> creates it via schtasks /Create /XML /F', () => {
    const { io, writeFileSync } = baseIo();
    io.execFileSync = vi.fn((cmd, args) => {
      if (args[0] === '/Query') throw notFoundError();
      return '';
    });
    const result = ensureStartupTask(params, io);
    expect(result).toEqual({ status: 'created', taskName: STUDIX_STARTUP_TASK_NAME });
    expect(writeFileSync).toHaveBeenCalled();
    const createCall = io.execFileSync.mock.calls.find((c) => c[1][0] === '/Create');
    expect(createCall[0]).toBe('schtasks.exe');
    expect(createCall[1]).toEqual(
      expect.arrayContaining(['/Create', '/TN', STUDIX_STARTUP_TASK_NAME, '/F'])
    );
    expect(createCall[1]).toContain('/XML');
  });

  it('2. existing task already matches the desired configuration -> idempotent no-op (never calls /Create)', () => {
    const { io, execFileSync } = baseIo();
    const result = ensureStartupTask(params, io);
    expect(result).toEqual({ status: 'already_registered', taskName: STUDIX_STARTUP_TASK_NAME });
    expect(execFileSync).not.toHaveBeenCalledWith('schtasks.exe', expect.arrayContaining(['/Create']), expect.anything());
  });

  it('3. existing task has an incorrect configuration -> corrected via schtasks /Create /XML /F', () => {
    const { io } = baseIo({
      execFileSync: vi.fn((cmd, args) => {
        if (args[0] === '/Query') {
          return xmlForDesired().replace('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>', '<MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>');
        }
        return '';
      }),
    });
    const result = ensureStartupTask(params, io);
    expect(result).toEqual({ status: 'corrected', taskName: STUDIX_STARTUP_TASK_NAME });
    expect(io.execFileSync).toHaveBeenCalledWith(
      'schtasks.exe', expect.arrayContaining(['/Create', '/TN', STUDIX_STARTUP_TASK_NAME, '/F']),
      expect.anything()
    );
  });

  it('4. missing task -> created (same path as scenario 1, asserted independently)', () => {
    const { io } = baseIo({
      execFileSync: vi.fn((cmd, args) => {
        if (args[0] === '/Query') throw notFoundError();
        return '';
      }),
    });
    const result = ensureStartupTask(params, io);
    expect(result.status).toBe('created');
  });

  it('5. registration failure (schtasks /Create throws) -> throws ScheduledTaskError, fails clearly', () => {
    const { io } = baseIo({
      execFileSync: vi.fn((cmd, args) => {
        if (args[0] === '/Query') throw notFoundError();
        if (args[0] === '/Create') throw new Error('Access is denied.');
        return '';
      }),
    });
    expect(() => ensureStartupTask(params, io)).toThrow(ScheduledTaskError);
    try {
      ensureStartupTask(params, io);
      expect.fail('expected ensureStartupTask to throw');
    } catch (err) {
      expect(err.reason).toBe('register_failed');
    }
  });

  it('5b. registration failure never silently reports success, and never starts the task itself', () => {
    const { io } = baseIo({
      execFileSync: vi.fn((cmd, args) => {
        if (args[0] === '/Query') throw notFoundError();
        if (args[0] === '/Create') throw new Error('boom');
        return '';
      }),
    });
    expect(() => ensureStartupTask(params, io)).toThrow(ScheduledTaskError);
    expect(io.execFileSync).not.toHaveBeenCalledWith('schtasks.exe', expect.arrayContaining(['/Run']), expect.anything());
  });

  it('6. uses the bundled node.exe (installRoot\\node\\node.exe), not a bare/PATH node', () => {
    const { io, writeFileSync } = baseIo();
    io.execFileSync = vi.fn((cmd, args) => {
      if (args[0] === '/Query') throw notFoundError();
      return '';
    });
    ensureStartupTask(params, io);
    const [, xmlWritten] = writeFileSync.mock.calls[0];
    expect(xmlWritten).toContain(`<Command>${NODE_EXE}</Command>`);
  });

  it('7. uses the correct absolute, quoted startupOrchestrator.js path as the task argument', () => {
    const { io, writeFileSync } = baseIo();
    io.execFileSync = vi.fn((cmd, args) => {
      if (args[0] === '/Query') throw notFoundError();
      return '';
    });
    ensureStartupTask(params, io);
    const [, xmlWritten] = writeFileSync.mock.calls[0];
    expect(xmlWritten).toContain(`<Arguments>&quot;${SCRIPT_PATH}&quot;</Arguments>`);
  });

  it('8. registers SYSTEM + boot trigger + highest privileges in the written definition', () => {
    const { io, writeFileSync } = baseIo();
    io.execFileSync = vi.fn((cmd, args) => {
      if (args[0] === '/Query') throw notFoundError();
      return '';
    });
    ensureStartupTask(params, io);
    const [, xmlWritten] = writeFileSync.mock.calls[0];
    expect(xmlWritten).toContain('<UserId>S-1-5-18</UserId>');
    expect(xmlWritten).toContain('<RunLevel>HighestAvailable</RunLevel>');
    expect(xmlWritten).toContain('<BootTrigger>');
  });

  it('9. multiple-instance policy is "do not allow parallel instances" (IgnoreNew) in the written definition', () => {
    const { io, writeFileSync } = baseIo();
    io.execFileSync = vi.fn((cmd, args) => {
      if (args[0] === '/Query') throw notFoundError();
      return '';
    });
    ensureStartupTask(params, io);
    const [, xmlWritten] = writeFileSync.mock.calls[0];
    expect(xmlWritten).toContain('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>');
  });

  it('10. never executes via a shell — schtasks.exe is always invoked as a bare argv array (no cmd.exe, no string concatenation)', () => {
    const { io } = baseIo();
    io.execFileSync = vi.fn((cmd, args, opts) => {
      expect(cmd).not.toMatch(/cmd(\.exe)?$/i);
      expect(Array.isArray(args)).toBe(true);
      expect(opts?.shell).not.toBe(true);
      if (args[0] === '/Query') return xmlForDesired();
      return '';
    });
    ensureStartupTask(params, io);
  });

  it('does not use the "ONE" query result as a signal to skip the /F force flag on correction', () => {
    const { io } = baseIo({
      execFileSync: vi.fn((cmd, args) => {
        if (args[0] === '/Query') return xmlForDesired().replace('IgnoreNew', 'Parallel');
        return '';
      }),
    });
    ensureStartupTask(params, io);
    const createCall = io.execFileSync.mock.calls.find((c) => c[1][0] === '/Create');
    expect(createCall[1]).toContain('/F');
  });

  it('cleans up the temporary XML definition file after a successful create', () => {
    const { io, unlinkSync } = baseIo();
    io.execFileSync = vi.fn((cmd, args) => {
      if (args[0] === '/Query') throw notFoundError();
      return '';
    });
    ensureStartupTask(params, io);
    expect(unlinkSync).toHaveBeenCalled();
  });

  it('cleans up the temporary XML definition file even when create fails', () => {
    const { io, unlinkSync } = baseIo({
      execFileSync: vi.fn((cmd, args) => {
        if (args[0] === '/Query') throw notFoundError();
        if (args[0] === '/Create') throw new Error('boom');
        return '';
      }),
    });
    expect(() => ensureStartupTask(params, io)).toThrow(ScheduledTaskError);
    expect(unlinkSync).toHaveBeenCalled();
  });
});

describe('removeStartupTask (Phase 4 — uninstall cleanup)', () => {
  it('1. task exists -> deleted via schtasks /Delete /TN <name> /F', () => {
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === '/Query') return xmlForDesired();
      return '';
    });
    const result = removeStartupTask({ taskName: STUDIX_STARTUP_TASK_NAME }, { execFileSync });
    expect(result).toEqual({ status: 'removed', taskName: STUDIX_STARTUP_TASK_NAME });
    expect(execFileSync).toHaveBeenCalledWith(
      'schtasks.exe', ['/Delete', '/TN', STUDIX_STARTUP_TASK_NAME, '/F'],
      expect.objectContaining({ encoding: 'utf8' })
    );
  });

  it('2. task does not exist -> continues successfully, never calls schtasks /Delete at all', () => {
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === '/Query') throw notFoundError();
      return '';
    });
    const result = removeStartupTask({ taskName: STUDIX_STARTUP_TASK_NAME }, { execFileSync });
    expect(result).toEqual({ status: 'not_registered', taskName: STUDIX_STARTUP_TASK_NAME });
    expect(execFileSync).not.toHaveBeenCalledWith('schtasks.exe', expect.arrayContaining(['/Delete']), expect.anything());
  });

  it('3. task deletion fails -> throws a distinct ScheduledTaskError (existing best-effort uninstall philosophy is applied by the caller, not swallowed here)', () => {
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === '/Query') return xmlForDesired();
      if (args[0] === '/Delete') throw new Error('Access is denied.');
      return '';
    });
    expect(() => removeStartupTask({ taskName: STUDIX_STARTUP_TASK_NAME }, { execFileSync })).toThrow(ScheduledTaskError);
    try {
      removeStartupTask({ taskName: STUDIX_STARTUP_TASK_NAME }, { execFileSync });
      expect.fail('expected removeStartupTask to throw');
    } catch (err) {
      expect(err.reason).toBe('remove_failed');
    }
  });

  it('5. repeated calls are idempotent: first call deletes, second call (task now gone) is a safe no-op', () => {
    let registered = true;
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === '/Query') {
        if (!registered) throw notFoundError();
        return xmlForDesired();
      }
      if (args[0] === '/Delete') {
        registered = false;
        return '';
      }
      return '';
    });
    const first = removeStartupTask({ taskName: STUDIX_STARTUP_TASK_NAME }, { execFileSync });
    const second = removeStartupTask({ taskName: STUDIX_STARTUP_TASK_NAME }, { execFileSync });
    expect(first).toEqual({ status: 'removed', taskName: STUDIX_STARTUP_TASK_NAME });
    expect(second).toEqual({ status: 'not_registered', taskName: STUDIX_STARTUP_TASK_NAME });
  });

  it('6. never executes via a shell — schtasks.exe is always invoked as a bare argv array', () => {
    const execFileSync = vi.fn((cmd, args, opts) => {
      expect(cmd).not.toMatch(/cmd(\.exe)?$/i);
      expect(Array.isArray(args)).toBe(true);
      expect(opts?.shell).not.toBe(true);
      if (args[0] === '/Query') return xmlForDesired();
      return '';
    });
    removeStartupTask({ taskName: STUDIX_STARTUP_TASK_NAME }, { execFileSync });
  });

  it('defaults taskName to STUDIX_STARTUP_TASK_NAME when not given', () => {
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === '/Query') throw notFoundError();
      return '';
    });
    const result = removeStartupTask({}, { execFileSync });
    expect(result.taskName).toBe(STUDIX_STARTUP_TASK_NAME);
  });
});

// 11. Existing StudixApp DEMAND_START behavior remains intact — this module never touches
// windowsService.js's app-service registration/start-type logic at all (no import of
// registerAppService/STUDIX_APP_START_TYPE, no call into it); verified by construction here via
// a simple absence check on this module's own export surface plus the untouched
// windowsService.test.js suite (run separately) continuing to pass unmodified.
describe('scheduledTask.js never touches StudixApp service registration', () => {
  it('exports nothing app-service-related', async () => {
    const mod = await import('./scheduledTask.js');
    expect(mod.registerAppService).toBeUndefined();
    expect(mod.STUDIX_APP_SERVICE_NAME).toBeUndefined();
  });
});

// ── P1-1 — the routine daily database backup task (StudixDailyBackup) ─────────────────────
describe('P1-1 — ensureBackupTask (StudixDailyBackup)', () => {
  const BACKUP_SCRIPT = 'C:\\Program Files\\Studix\\backend\\src\\db\\routineBackup.js';
  const params = { installRoot: INSTALL_ROOT, nodeExe: NODE_EXE, scriptPath: BACKUP_SCRIPT };
  const desired = () => buildDesiredBackupTaskConfig({ nodeExe: NODE_EXE, scriptPath: BACKUP_SCRIPT, installRoot: INSTALL_ROOT });

  function ioWithExisting(existingXml) {
    const writes = [];
    const execFileSync = vi.fn((cmd, args) => {
      if (args[0] === '/Query') {
        if (existingXml === null) throw notFoundError();
        return existingXml;
      }
      return '';
    });
    const writeFileSync = vi.fn((p, content, enc) => writes.push({ p, content, enc }));
    const unlinkSync = vi.fn();
    return { io: { execFileSync, writeFileSync, unlinkSync }, writes, execFileSync };
  }

  it('resolves the bundled routineBackup.js path under the install root', () => {
    expect(resolveRoutineBackupScriptPath(INSTALL_ROOT)).toBe(BACKUP_SCRIPT);
  });

  it('desired config: daily at 03:00, catch-up after a missed run, SYSTEM, highest privileges, no parallel runs, 2h limit, bundled node + quoted script', () => {
    expect(desired()).toEqual({
      dailyTriggerEnabled: true,
      dailyStartTime: '03:00:00',
      daysInterval: 1,
      startWhenAvailable: true,
      userId: 'S-1-5-18',
      runLevel: 'HighestAvailable',
      multipleInstancesPolicy: 'IgnoreNew',
      executionTimeLimit: 'PT2H',
      enabled: true,
      runOnlyIfNetworkAvailable: false,
      restartOnFailure: false,
      command: NODE_EXE,
      arguments: `"${BACKUP_SCRIPT}"`,
      workingDirectory: INSTALL_ROOT,
    });
    expect(STUDIX_BACKUP_TASK_NAME).toBe('StudixDailyBackup');
  });

  it('the XML carries a daily CalendarTrigger (no BootTrigger), StartWhenAvailable, SYSTEM, and no <LogonType>', () => {
    const xml = buildBackupTaskXml(desired());
    expect(xml).toMatch(/<CalendarTrigger>[\s\S]*<StartBoundary>2020-01-01T03:00:00<\/StartBoundary>[\s\S]*<DaysInterval>1<\/DaysInterval>/);
    expect(xml).not.toMatch(/<BootTrigger>/);
    expect(xml).toContain('<StartWhenAvailable>true</StartWhenAvailable>');
    expect(xml).toContain('<UserId>S-1-5-18</UserId>');
    expect(xml).toContain('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>');
    expect(xml).not.toMatch(/<LogonType>/);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-16"?>')).toBe(true);
  });

  it('round-trip: parseBackupTaskXml(buildBackupTaskXml(desired)) matches desired', () => {
    expect(backupTaskConfigMatches(desired(), parseBackupTaskXml(buildBackupTaskXml(desired())))).toBe(true);
  });

  it.each([
    ['a different time', (x) => x.replace('T03:00:00', 'T05:00:00')],
    ['StartWhenAvailable off', (x) => x.replace('<StartWhenAvailable>true', '<StartWhenAvailable>false')],
    ['the trigger removed', (x) => x.replace(/<Triggers>[\s\S]*?<\/Triggers>/, '<Triggers></Triggers>')],
    ['a boot trigger instead of a daily one', (x) => x.replace(/<CalendarTrigger>[\s\S]*?<\/CalendarTrigger>/, '<BootTrigger><Enabled>true</Enabled></BootTrigger>')],
    ['a disabled trigger', (x) => x.replace('<Enabled>true</Enabled>\n      <ScheduleByDay>', '<Enabled>false</Enabled>\n      <ScheduleByDay>')],
    ['every 2 days', (x) => x.replace('<DaysInterval>1<', '<DaysInterval>2<')],
    ['a drifted script path', (x) => x.replace('routineBackup.js', 'other.js')],
    ['parallel instances', (x) => x.replace('IgnoreNew', 'Parallel')],
    ['a non-SYSTEM user', (x) => x.replace('S-1-5-18', 'S-1-5-21-1-2-3-1001')],
  ])('drift detected: %s', (_label, mutate) => {
    expect(backupTaskConfigMatches(desired(), parseBackupTaskXml(mutate(buildBackupTaskXml(desired()))))).toBe(false);
  });

  it('missing task -> created via schtasks /Create /XML /F with UTF-16LE+BOM bytes, under its own task name', () => {
    const { io, writes, execFileSync } = ioWithExisting(null);
    expect(ensureBackupTask(params, io)).toEqual({ status: 'created', taskName: 'StudixDailyBackup' });
    const create = execFileSync.mock.calls.find((c) => c[1][0] === '/Create');
    expect(create[0]).toBe('schtasks.exe');
    expect(create[1]).toEqual(['/Create', '/TN', 'StudixDailyBackup', '/XML', writes[0].p, '/F']);
    expect(writes[0].enc).toBe('utf16le');
    const bytes = Buffer.from(writes[0].content, 'utf16le');
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xfe]);
  });

  it('matching task -> idempotent no-op (repeated installer runs never re-create it)', () => {
    const { io, execFileSync } = ioWithExisting(buildBackupTaskXml(desired()));
    expect(ensureBackupTask(params, io)).toEqual({ status: 'already_registered', taskName: 'StudixDailyBackup' });
    expect(execFileSync.mock.calls.some((c) => c[1][0] === '/Create')).toBe(false);
  });

  it('drifted task (e.g. moved install root) -> corrected', () => {
    const { io } = ioWithExisting(buildBackupTaskXml(desired()).replace(NODE_EXE, 'C:\\Old\\node.exe'));
    expect(ensureBackupTask(params, io)).toEqual({ status: 'corrected', taskName: 'StudixDailyBackup' });
  });

  it('registration failure -> ScheduledTaskError(register_failed), never silent success', () => {
    const { io } = ioWithExisting(null);
    io.execFileSync = vi.fn((cmd, args) => {
      if (args[0] === '/Query') throw notFoundError();
      throw new Error('Access is denied.');
    });
    expect(() => ensureBackupTask(params, io)).toThrow(ScheduledTaskError);
    try { ensureBackupTask(params, io); } catch (err) { expect(err.reason).toBe('register_failed'); }
  });

  it('the boot task is unaffected: its own XML still has a BootTrigger and no CalendarTrigger', () => {
    const xml = buildTaskXml(desiredConfig());
    expect(xml).toMatch(/<BootTrigger>/);
    expect(xml).not.toMatch(/<CalendarTrigger>/);
  });

  it('removeStartupTask({ taskName: STUDIX_BACKUP_TASK_NAME }) deletes the backup task (uninstall)', () => {
    const { io, execFileSync } = ioWithExisting(buildBackupTaskXml(desired()));
    expect(removeStartupTask({ taskName: STUDIX_BACKUP_TASK_NAME }, io)).toEqual({ status: 'removed', taskName: 'StudixDailyBackup' });
    expect(execFileSync).toHaveBeenCalledWith('schtasks.exe', ['/Delete', '/TN', 'StudixDailyBackup', '/F'], expect.anything());
  });
});
