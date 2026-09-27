// backend/src/installer/dataDirAcl.test.js
// Unit tests for the %ProgramData%\Studix lockdown — the exact icacls contract, with icacls and
// mkdir injected (no real ACL is touched here). The real-ACL proof is
// dataDirAcl.integration.test.js, which needs an elevated Windows shell.
import path from 'path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ADMINISTRATORS_SID, SYSTEM_SID, resolveStudixDataRoot, buildDataRootAclCommands, lockDownDataRootAcl,
} from './dataDirAcl.js';

const ROOT = 'C:\\ProgramData\\Studix';

describe('buildDataRootAclCommands — the icacls contract', () => {
  const commands = buildDataRootAclCommands(ROOT);

  it('uses the well-known SIDs for Administrators and SYSTEM', () => {
    expect(ADMINISTRATORS_SID).toBe('S-1-5-32-544');
    expect(SYSTEM_SID).toBe('S-1-5-18');
  });

  it('is exactly three icacls calls, each targeting the data root, all quiet', () => {
    expect(commands).toHaveLength(3);
    for (const [cmd, args] of commands) {
      expect(cmd).toBe('icacls');
      expect(args[0]).toBe(ROOT);
      expect(args).toContain('/Q');
    }
  });

  it('1st: takes ownership of the whole tree for Administrators (by SID, recursive)', () => {
    expect(commands[0][1]).toEqual([ROOT, '/setowner', '*S-1-5-32-544', '/T', '/Q']);
  });

  it('2nd: resets every object in the tree to inherited-only (drops explicit ACEs on children)', () => {
    expect(commands[1][1]).toEqual([ROOT, '/reset', '/T', '/Q']);
  });

  it('3rd: removes inheritance on the root and grants exactly Administrators + SYSTEM full, inherited by all children', () => {
    expect(commands[2][1]).toEqual([
      ROOT, '/inheritance:r', '/grant:r', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F', '/Q',
    ]);
  });

  it('never names a localized principal, never grants Users/Everyone/Authenticated Users, never uses /C', () => {
    const all = commands.flatMap(([, args]) => args).join(' ');
    expect(all).not.toMatch(/Administrators|SYSTEM|Users|Everyone|Authenticated/i);
    expect(all).not.toMatch(/S-1-5-32-545|S-1-1-0|S-1-5-11|S-1-3-0/);
    expect(all).not.toMatch(/(^|\s)\/C(\s|$)/i);
  });

  it('keeps a path with spaces as a single argv element (no shell quoting involved)', () => {
    const spaced = 'D:\\Program Data\\Studix';
    for (const [, args] of buildDataRootAclCommands(spaced)) expect(args[0]).toBe(spaced);
  });
});

describe('resolveStudixDataRoot', () => {
  const original = process.env.ProgramData;
  afterEach(() => {
    if (original === undefined) delete process.env.ProgramData;
    else process.env.ProgramData = original;
  });

  it('is %ProgramData%\\Studix', () => {
    process.env.ProgramData = 'E:\\PD';
    expect(resolveStudixDataRoot()).toBe(path.join('E:\\PD', 'Studix'));
  });

  it('falls back to C:\\ProgramData when the variable is missing', () => {
    delete process.env.ProgramData;
    expect(resolveStudixDataRoot()).toBe(path.join('C:\\ProgramData', 'Studix'));
  });
});

describe('lockDownDataRootAcl', () => {
  it('creates the root first (fresh install), then runs the three icacls calls in order as argv arrays', () => {
    const order = [];
    const mkdirSync = vi.fn(() => order.push('mkdir'));
    const execFileSync = vi.fn((cmd, args) => { order.push(args[1]); return ''; });

    expect(lockDownDataRootAcl({ dataRoot: ROOT }, { mkdirSync, execFileSync })).toEqual({ dataRoot: ROOT });

    expect(mkdirSync).toHaveBeenCalledWith(ROOT, { recursive: true });
    expect(order).toEqual(['mkdir', '/setowner', '/reset', '/inheritance:r']);
    for (const call of execFileSync.mock.calls) {
      expect(call[0]).toBe('icacls');
      expect(Array.isArray(call[1])).toBe(true);
      expect(call[2]).toMatchObject({ windowsHide: true });
    }
  });

  it('runs the full correction again on an existing installation (upgrade) — nothing is skipped', () => {
    const execFileSync = vi.fn(() => '');
    const io = { mkdirSync: vi.fn(), execFileSync };
    lockDownDataRootAcl({ dataRoot: ROOT }, io);
    lockDownDataRootAcl({ dataRoot: ROOT }, io);
    expect(execFileSync).toHaveBeenCalledTimes(6);
    expect(execFileSync.mock.calls.slice(3).map((c) => c[1])).toEqual(buildDataRootAclCommands(ROOT).map(([, a]) => a));
  });

  it('stops at the first failing icacls call and reports it (fail-closed), without running the rest', () => {
    const execFileSync = vi.fn((cmd, args) => {
      if (args[1] === '/reset') {
        const err = new Error('Command failed');
        err.stderr = 'C:\\ProgramData\\Studix\\pgdata\\x: Access is denied.';
        throw err;
      }
      return '';
    });

    expect(() => lockDownDataRootAcl({ dataRoot: ROOT }, { mkdirSync: vi.fn(), execFileSync }))
      .toThrow(/icacls \/reset .*Access is denied/);
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });
});
