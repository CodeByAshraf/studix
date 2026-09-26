// backend/scripts/manageScheduledTask.test.js
// Phase 4 — thin-CLI regression coverage, mirroring manageWindowsServices.test.js's own
// approach: mock the one side-effecting function this CLI imports from lib/scheduledTask.js,
// then drive its exported run() directly with a controlled action — never touches a real
// schtasks.exe or a real Scheduled Task, never relies on process.argv/process.exit.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const removeStartupTaskMock = vi.fn(() => ({ status: 'removed', taskName: 'StudixStartupOrchestrator' }));

vi.mock('../src/lib/scheduledTask.js', async () => {
  const actual = await vi.importActual('../src/lib/scheduledTask.js');
  return {
    ...actual,
    removeStartupTask: removeStartupTaskMock,
  };
});

const { run } = await import('./manageScheduledTask.js');
const { ScheduledTaskError } = await import('../src/lib/scheduledTask.js');

let logSpy;
let errorSpy;

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  process.exitCode = undefined;
});

describe('manageScheduledTask run("remove")', () => {
  it('P1-1: removes BOTH Studix tasks (boot orchestrator, then daily backup) and prints each JSON result', async () => {
    removeStartupTaskMock.mockImplementation(({ taskName }) => ({ status: 'removed', taskName }));
    await run('remove');
    expect(removeStartupTaskMock).toHaveBeenCalledTimes(2);
    expect(removeStartupTaskMock).toHaveBeenNthCalledWith(1, { taskName: 'StudixStartupOrchestrator' });
    expect(removeStartupTaskMock).toHaveBeenNthCalledWith(2, { taskName: 'StudixDailyBackup' });
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ status: 'removed', taskName: 'StudixStartupOrchestrator' }, null, 2));
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ status: 'removed', taskName: 'StudixDailyBackup' }, null, 2));
    expect(process.exitCode).toBeUndefined();
  });

  it('a ScheduledTaskError from removeStartupTask is reported with its [reason] and sets a non-zero exit code', async () => {
    removeStartupTaskMock.mockImplementationOnce(() => { throw new ScheduledTaskError('remove_failed', 'فشل الحذف'); });
    await run('remove');
    expect(errorSpy).toHaveBeenCalledWith('❌ [remove_failed] فشل الحذف');
    expect(process.exitCode).toBe(1);
  });

  it('P1-1: a failure removing the first task never skips removing the second', async () => {
    removeStartupTaskMock
      .mockImplementationOnce(() => { throw new ScheduledTaskError('remove_failed', 'فشل الحذف'); })
      .mockImplementationOnce(({ taskName }) => ({ status: 'removed', taskName }));
    await run('remove');
    expect(removeStartupTaskMock).toHaveBeenCalledTimes(2);
    expect(removeStartupTaskMock).toHaveBeenNthCalledWith(2, { taskName: 'StudixDailyBackup' });
    expect(process.exitCode).toBe(1);
  });

  it('an unexpected (non-ScheduledTaskError) error is still reported and sets a non-zero exit code', async () => {
    removeStartupTaskMock.mockImplementationOnce(() => { throw new Error('boom'); });
    await run('remove');
    expect(errorSpy).toHaveBeenCalledWith('❌ فشل غير متوقَّع:', 'boom');
    expect(process.exitCode).toBe(1);
  });
});

describe('manageScheduledTask run(<unrecognized action>)', () => {
  it('an unrecognized action prints usage, sets a non-zero exit code, and never calls removeStartupTask', async () => {
    await run('bogus');
    expect(removeStartupTaskMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('manageScheduledTask.js remove'));
  });

  it('a missing action (undefined) is treated the same as an unrecognized one', async () => {
    await run(undefined);
    expect(removeStartupTaskMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
