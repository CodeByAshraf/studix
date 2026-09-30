// backend/src/lib/machineIdentity.memo.test.js
// P1 (review) — computeCurrentMachineId() with no arguments (the production call from
// license.js) spawns reg.exe once per process, not once per licensed request. Separate file
// from machineIdentity.test.js because it mocks child_process for the whole module, and
// re-imports machineIdentity.js per test so each starts with an empty memo.
import process from 'node:process';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const regOutput = (guid) => `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    ${guid}\r\n`;
const GUID_A = '11111111-2222-3333-4444-555555555555';
const GUID_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const execFileSync = vi.fn();
vi.mock('child_process', () => ({ execFileSync: (...args) => execFileSync(...args) }));

async function freshModule() {
  vi.resetModules();
  return import('./machineIdentity.js');
}

describe.runIf(process.platform === 'win32')('computeCurrentMachineId — per-process memo (real-machine call only)', () => {
  beforeEach(() => {
    execFileSync.mockReset();
  });

  it('reads the registry once, then serves the same fingerprint from memory', async () => {
    const { computeCurrentMachineId } = await freshModule();
    execFileSync.mockReturnValue(regOutput(GUID_A));
    const first = computeCurrentMachineId();
    const second = computeCurrentMachineId();
    expect(second).toBe(first);
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });

  it('never caches a failure: the next call retries, and succeeds once the registry is readable', async () => {
    const { computeCurrentMachineId, MachineIdentityError } = await freshModule();
    execFileSync.mockImplementationOnce(() => { throw new Error('access denied'); });
    expect(() => computeCurrentMachineId()).toThrow(MachineIdentityError);
    execFileSync.mockReturnValue(regOutput(GUID_A));
    expect(computeCurrentMachineId()).toMatch(/^[0-9a-f]{64}$/);
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });

  it('an injected io/platform (tests) is always computed afresh and never touches the memo', async () => {
    const { computeCurrentMachineId } = await freshModule();
    execFileSync.mockReturnValue(regOutput(GUID_A));
    const real = computeCurrentMachineId();

    const injected = computeCurrentMachineId({ execFileSync: () => regOutput(GUID_B) }, 'win32');
    expect(injected).not.toBe(real);
    expect(computeCurrentMachineId()).toBe(real); // memo unchanged by the injected call
    expect(execFileSync).toHaveBeenCalledTimes(1);
  });
});
