// backend/src/db/databaseSwitch.cli.test.js
// Phase 2C-3C Part 1 — pure, dependency-injected unit tests for the new CLI entry point
// (parseSwitchCliArgs/runSwitchCli in databaseSwitch.js). NEVER touches a real PostgreSQL
// connection, a real Windows service, or the real restore-state.json/admin.env — every
// dependency runSwitchCli() takes is injected/faked. Not wired into HTTP or a UAC launcher
// (Phase 2C-3C Part 1 scope only) — these tests only exercise the CLI's own argument-parsing,
// orchestration, and error-redaction contract.
import { describe, it, expect, vi } from 'vitest';
import { parseSwitchCliArgs, runSwitchCli, SwitchCliError, DatabaseSwitchError } from './databaseSwitch.js';
import { RestoreLockError } from './restoreLock.js';

describe('parseSwitchCliArgs — malformed/missing/unsafe arguments', () => {
  it('valid invocation: --action switch', () => {
    expect(parseSwitchCliArgs(['--action', 'switch'])).toEqual({ action: 'switch' });
  });

  it('valid invocation: --action rollback', () => {
    expect(parseSwitchCliArgs(['--action', 'rollback'])).toEqual({ action: 'rollback' });
  });

  it('missing --action entirely', () => {
    expect(() => parseSwitchCliArgs([])).toThrow(SwitchCliError);
    try {
      parseSwitchCliArgs([]);
    } catch (err) {
      expect(err.reason).toBe('invalid_cli_action');
    }
  });

  it('malformed: an unrecognized action value', () => {
    let caught;
    try {
      parseSwitchCliArgs(['--action', 'nuke-everything']);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SwitchCliError);
    expect(caught.reason).toBe('invalid_cli_action');
  });

  it('malformed: --action with no value at all', () => {
    let caught;
    try {
      parseSwitchCliArgs(['--action']);
    } catch (err) {
      caught = err;
    }
    expect(caught.reason).toBe('invalid_cli_action');
  });

  it('unsafe argument: rejects a bare postgres:// URL anywhere in argv', () => {
    let caught;
    try {
      parseSwitchCliArgs(['postgresql://user:pass@host:5432/db', '--action', 'switch']);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SwitchCliError);
    expect(caught.reason).toBe('connection_string_in_cli_rejected');
  });

  it('unsafe argument: rejects a connection string passed as --action\'s OWN value, not just a bare positional', () => {
    let caught;
    try {
      parseSwitchCliArgs(['--action', 'postgres://user:pass@host/db']);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SwitchCliError);
    expect(caught.reason).toBe('connection_string_in_cli_rejected');
  });

  it('credential redaction: the rejection error message itself never echoes the rejected connection string back', () => {
    let caught;
    try {
      parseSwitchCliArgs(['postgresql://user:supersecret@host:5432/db', '--action', 'switch']);
    } catch (err) {
      caught = err;
    }
    expect(caught.message).not.toContain('supersecret');
    expect(caught.message).not.toContain('postgresql://user:supersecret');
  });
});

function fakeAdaptersDeps() {
  return {
    createRealStopAppFnFn: () => async () => {},
    createRealStartAppFnFn: () => async () => {},
    createRealGetAppStatusFnFn: () => async () => ({ running: true }),
    createRealFetchHealthFnFn: () => async () => ({ ok: true }),
  };
}

describe('runSwitchCli — valid invocation', () => {
  it('acquires the lock, calls performDatabaseSwitch with the real adapter factories, releases the lock, and returns structured success info', async () => {
    const acquireRestoreLockFn = vi.fn();
    const releaseRestoreLockFn = vi.fn();
    const performDatabaseSwitchFn = vi.fn(async () => ({ status: 'active', productionDbName: 'studix' }));
    const performRollbackFn = vi.fn();

    const result = await runSwitchCli(['--action', 'switch'], {
      acquireRestoreLockFn, releaseRestoreLockFn, performDatabaseSwitchFn, performRollbackFn,
      ...fakeAdaptersDeps(),
    });

    expect(result).toEqual({ ok: true, action: 'switch', status: 'active', productionDbName: 'studix' });
    expect(acquireRestoreLockFn).toHaveBeenCalledTimes(1);
    expect(releaseRestoreLockFn).toHaveBeenCalledTimes(1);
    expect(performDatabaseSwitchFn).toHaveBeenCalledTimes(1);
    expect(performRollbackFn).not.toHaveBeenCalled();
  });

  it('routes --action rollback to performRollback, never performDatabaseSwitch', async () => {
    const performDatabaseSwitchFn = vi.fn();
    const performRollbackFn = vi.fn(async () => ({ status: 'rolled_back' }));

    const result = await runSwitchCli(['--action', 'rollback'], {
      acquireRestoreLockFn: vi.fn(), releaseRestoreLockFn: vi.fn(),
      performDatabaseSwitchFn, performRollbackFn, ...fakeAdaptersDeps(),
    });

    expect(result).toEqual({ ok: true, action: 'rollback', status: 'rolled_back' });
    expect(performRollbackFn).toHaveBeenCalledTimes(1);
    expect(performDatabaseSwitchFn).not.toHaveBeenCalled();
  });
});

describe('runSwitchCli — malformed/missing arguments never even attempt the lock', () => {
  it('an invalid --action rejects before acquireRestoreLock is ever called', async () => {
    const acquireRestoreLockFn = vi.fn();
    await expect(runSwitchCli([], { acquireRestoreLockFn, ...fakeAdaptersDeps() })).rejects.toThrow(SwitchCliError);
    expect(acquireRestoreLockFn).not.toHaveBeenCalled();
  });
});

describe('runSwitchCli — lock already held', () => {
  it('propagates RestoreLockError and never calls performDatabaseSwitch', async () => {
    const acquireRestoreLockFn = vi.fn(() => { throw new RestoreLockError('lock_held', 'another restore is in progress'); });
    const performDatabaseSwitchFn = vi.fn();

    await expect(runSwitchCli(['--action', 'switch'], {
      acquireRestoreLockFn, performDatabaseSwitchFn, releaseRestoreLockFn: vi.fn(), ...fakeAdaptersDeps(),
    })).rejects.toThrow(RestoreLockError);
    expect(performDatabaseSwitchFn).not.toHaveBeenCalled();
  });
});

describe('runSwitchCli — correct exit/cleanup behavior on failure', () => {
  it('releases the lock even when performDatabaseSwitch throws (finally-block cleanup)', async () => {
    const releaseRestoreLockFn = vi.fn();
    const performDatabaseSwitchFn = vi.fn(async () => { throw new DatabaseSwitchError('app_start_failed', 'فشل بدء التطبيق.'); });

    await expect(runSwitchCli(['--action', 'switch'], {
      acquireRestoreLockFn: vi.fn(), releaseRestoreLockFn, performDatabaseSwitchFn,
      performRollbackFn: vi.fn(), ...fakeAdaptersDeps(),
    })).rejects.toThrow(DatabaseSwitchError);

    expect(releaseRestoreLockFn).toHaveBeenCalledTimes(1);
  });

  it('the thrown error is never swallowed/replaced with a generic message — the real reason survives', async () => {
    const performDatabaseSwitchFn = vi.fn(async () => { throw new DatabaseSwitchError('health_wrong_identity', 'الهوية النشطة لا تطابق المتوقَّعة.'); });

    let caught;
    try {
      await runSwitchCli(['--action', 'switch'], {
        acquireRestoreLockFn: vi.fn(), releaseRestoreLockFn: vi.fn(), performDatabaseSwitchFn,
        performRollbackFn: vi.fn(), ...fakeAdaptersDeps(),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught.reason).toBe('health_wrong_identity');
  });
});
