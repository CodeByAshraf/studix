// backend/src/installer/dataDirAcl.test.js
// Unit tests for the %ProgramData%\Studix lockdown and the temporary pgdata provisioning access —
// the exact icacls/whoami contract and the ACL verification rules, with every external call
// injected (no real ACL is touched here). The real-ACL / real-PostgreSQL proof is
// dataDirAcl.integration.test.js.
import path from 'path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ADMINISTRATORS_SID, SYSTEM_SID, DataDirAclError, resolveStudixDataRoot, buildDataRootAclCommands,
  lockDownDataRootAcl, resolveCurrentUserSid, buildPgProvisioningGrantCommand, grantPgProvisioningAccess,
  findDataRootAclViolations, verifyDataRootAcl, restoreDataRootAcl, ICACLS_EXE, WHOAMI_EXE, POWERSHELL_EXE,
} from './dataDirAcl.js';

const ROOT = 'C:\\ProgramData\\Studix';
const PGDATA = 'C:\\ProgramData\\Studix\\pgdata';
const USER_SID = 'S-1-5-21-111-222-333-1001';

describe('buildDataRootAclCommands — the lockdown icacls contract', () => {
  const commands = buildDataRootAclCommands(ROOT);

  it('runs the Windows tools by absolute System32 path, never through a PATH lookup (elevated process)', () => {
    for (const exe of [ICACLS_EXE, WHOAMI_EXE, POWERSHELL_EXE]) {
      expect(path.isAbsolute(exe)).toBe(true);
      expect(exe.toLowerCase()).toContain('\\system32\\');
    }
  });

  it('uses the well-known SIDs for Administrators and SYSTEM', () => {
    expect(ADMINISTRATORS_SID).toBe('S-1-5-32-544');
    expect(SYSTEM_SID).toBe('S-1-5-18');
  });

  it('is exactly three quiet icacls calls', () => {
    expect(commands).toHaveLength(3);
    for (const [cmd, args] of commands) {
      expect(cmd).toBe(ICACLS_EXE);
      expect(args).toContain('/Q');
    }
  });

  it('1st: takes ownership of the whole tree for Administrators (by SID, recursive)', () => {
    expect(commands[0][1]).toEqual([ROOT, '/setowner', '*S-1-5-32-544', '/T', '/Q']);
  });

  it('2nd: removes inheritance on the root and grants exactly Administrators + SYSTEM, inherited by all children — BEFORE any reset', () => {
    expect(commands[1][1]).toEqual([
      ROOT, '/inheritance:r', '/grant:r', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F', '/Q',
    ]);
  });

  it('3rd: resets only the children (never the root itself, which would re-enable %ProgramData% inheritance), recursively', () => {
    expect(commands[2][1]).toEqual([path.join(ROOT, '*'), '/reset', '/T', '/Q']);
    expect(commands.some(([, args]) => args[0] === ROOT && args.includes('/reset'))).toBe(false);
  });

  it('skips the children reset for an empty root', () => {
    const empty = buildDataRootAclCommands(ROOT, { hasChildren: false });
    expect(empty.map(([, a]) => a[1])).toEqual(['/setowner', '/inheritance:r']);
  });

  it('never names a localized principal, never grants Users/Everyone/Authenticated Users/CREATOR OWNER, never uses /C', () => {
    const all = commands.flatMap(([, args]) => args).join(' ');
    expect(all).not.toMatch(/Administrators|SYSTEM|Users|Everyone|Authenticated/i);
    expect(all).not.toMatch(/S-1-5-32-545|S-1-1-0|S-1-5-11|S-1-3-0/);
    expect(all).not.toMatch(/(^|\s)\/C(\s|$)/i);
  });

  it('keeps a path with spaces as a single argv element (no shell quoting involved)', () => {
    const spaced = 'D:\\Program Data\\Studix';
    for (const [, args] of buildDataRootAclCommands(spaced)) expect(args[0].startsWith(spaced)).toBe(true);
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
  it('creates the root first (fresh install), then runs the icacls calls in order as argv arrays', () => {
    const order = [];
    const mkdirSync = vi.fn(() => order.push('mkdir'));
    const readdirSync = vi.fn(() => ['logs']);
    const execFileSync = vi.fn((cmd, args) => { order.push(args[1]); return ''; });

    expect(lockDownDataRootAcl({ dataRoot: ROOT }, { mkdirSync, readdirSync, execFileSync })).toEqual({ dataRoot: ROOT });

    expect(mkdirSync).toHaveBeenCalledWith(ROOT, { recursive: true });
    expect(order).toEqual(['mkdir', '/setowner', '/inheritance:r', '/reset']);
    for (const call of execFileSync.mock.calls) {
      expect(call[0]).toBe(ICACLS_EXE);
      expect(Array.isArray(call[1])).toBe(true);
      expect(call[2]).toMatchObject({ windowsHide: true });
    }
  });

  it('an empty root is locked without the children reset', () => {
    const execFileSync = vi.fn(() => '');
    lockDownDataRootAcl({ dataRoot: ROOT }, { mkdirSync: vi.fn(), readdirSync: () => [], execFileSync });
    expect(execFileSync.mock.calls.map((c) => c[1][1])).toEqual(['/setowner', '/inheritance:r']);
  });

  it('runs the full correction again on an existing installation (upgrade) — nothing is skipped', () => {
    const execFileSync = vi.fn(() => '');
    const io = { mkdirSync: vi.fn(), readdirSync: () => ['config', 'pgdata'], execFileSync };
    lockDownDataRootAcl({ dataRoot: ROOT }, io);
    lockDownDataRootAcl({ dataRoot: ROOT }, io);
    expect(execFileSync).toHaveBeenCalledTimes(6);
    expect(execFileSync.mock.calls.slice(3).map((c) => c[1])).toEqual(buildDataRootAclCommands(ROOT).map(([, a]) => a));
  });

  it('stops at the first failing icacls call and reports it (fail-closed), without running the rest', () => {
    const execFileSync = vi.fn((cmd, args) => {
      if (args[1] === '/inheritance:r') {
        const err = new Error('Command failed');
        err.stderr = 'C:\\ProgramData\\Studix: Access is denied.';
        throw err;
      }
      return '';
    });

    expect(() => lockDownDataRootAcl({ dataRoot: ROOT }, { mkdirSync: vi.fn(), readdirSync: () => ['x'], execFileSync }))
      .toThrow(/icacls \/inheritance:r .*Access is denied/);
    expect(execFileSync).toHaveBeenCalledTimes(2);
  });
});

describe('resolveCurrentUserSid — locale-independent', () => {
  it.each([
    ['English', '"desktop-01\\my computer","S-1-5-21-111-222-333-1001"\r\n'],
    ['Arabic account name', '"مكتب\\مدير النظام","S-1-5-21-111-222-333-1001"\r\n'],
    ['a name that itself looks like a SID', '"S-1-5-99\\S-1-5-18","S-1-5-21-111-222-333-1001"\r\n'],
  ])('takes the SID column, never the (localized) name: %s', (_label, output) => {
    const execFileSync = vi.fn(() => output);
    expect(resolveCurrentUserSid({ execFileSync })).toBe(USER_SID);
    expect(execFileSync).toHaveBeenCalledWith(WHOAMI_EXE, ['/user', '/fo', 'csv', '/nh'], expect.objectContaining({ windowsHide: true }));
  });

  it('fails closed when no SID can be read', () => {
    expect(() => resolveCurrentUserSid({ execFileSync: () => 'garbage' })).toThrow(DataDirAclError);
  });
});

describe('grantPgProvisioningAccess — pgdata only', () => {
  it('the grant is full control for that one SID on pgdata, inherited inside pgdata only', () => {
    expect(buildPgProvisioningGrantCommand(PGDATA, USER_SID)).toEqual([ICACLS_EXE, [PGDATA, '/grant', `*${USER_SID}:(OI)(CI)F`, '/Q']]);
  });

  it('creates pgdata (fresh install) and grants the installing user on pgdata — and on nothing else', () => {
    const mkdirSync = vi.fn();
    const execFileSync = vi.fn((cmd) => (cmd === WHOAMI_EXE ? `"pc\\admin","${USER_SID}"` : ''));

    expect(grantPgProvisioningAccess({ pgDataDir: PGDATA }, { mkdirSync, execFileSync })).toEqual({ sid: USER_SID, granted: true });

    expect(mkdirSync).toHaveBeenCalledWith(PGDATA, { recursive: true });
    const icaclsCalls = execFileSync.mock.calls.filter((c) => c[0] === ICACLS_EXE);
    expect(icaclsCalls).toHaveLength(1);
    expect(icaclsCalls[0][1]).toEqual([PGDATA, '/grant', `*${USER_SID}:(OI)(CI)F`, '/Q']);
    const touched = icaclsCalls.map((c) => c[1][0]);
    expect(touched.every((p) => p === PGDATA)).toBe(true);
  });

  it('an installer running as SYSTEM needs no extra grant', () => {
    const execFileSync = vi.fn((cmd) => (cmd === WHOAMI_EXE ? '"nt authority\\system","S-1-5-18"' : ''));
    expect(grantPgProvisioningAccess({ pgDataDir: PGDATA }, { mkdirSync: vi.fn(), execFileSync })).toEqual({ sid: SYSTEM_SID, granted: false });
    expect(execFileSync.mock.calls.filter((c) => c[0] === ICACLS_EXE)).toHaveLength(0);
  });

  it('a failing grant is reported (fail-closed)', () => {
    const execFileSync = vi.fn((cmd) => {
      if (cmd === WHOAMI_EXE) return `"pc\\admin","${USER_SID}"`;
      throw Object.assign(new Error('Command failed'), { stderr: 'Access is denied.' });
    });
    expect(() => grantPgProvisioningAccess({ pgDataDir: PGDATA }, { mkdirSync: vi.fn(), execFileSync })).toThrow(/icacls \/grant .*Access is denied/);
  });
});

describe('findDataRootAclViolations — the final state rules', () => {
  const inheritedOk = [
    { sid: ADMINISTRATORS_SID, inherited: true, allow: true },
    { sid: SYSTEM_SID, inherited: true, allow: true },
  ];
  const lockedRoot = {
    path: ROOT, protected: true,
    rules: [{ sid: ADMINISTRATORS_SID, inherited: false, allow: true }, { sid: SYSTEM_SID, inherited: false, allow: true }],
  };
  const good = [
    lockedRoot,
    { path: PGDATA, protected: false, rules: inheritedOk },
    { path: `${ROOT}\\config`, protected: false, rules: inheritedOk },
    { path: `${PGDATA}\\base`, protected: false, rules: inheritedOk },
  ];

  it('accepts exactly the intended final state', () => {
    expect(findDataRootAclViolations(ROOT, good)).toEqual([]);
  });

  it('rejects a leftover temporary grant on pgdata (explicit, and a non-admin principal)', () => {
    const entries = [...good.filter((e) => e.path !== PGDATA), {
      path: PGDATA, protected: false, rules: [...inheritedOk, { sid: USER_SID, inherited: false, allow: true }],
    }];
    const v = findDataRootAclViolations(ROOT, entries);
    expect(v.join('\n')).toMatch(new RegExp(`access granted to ${USER_SID}`));
    expect(v.join('\n')).toMatch(/explicit \(non-inherited\)/);
  });

  it('rejects the temporary grant still inherited deeper inside pgdata', () => {
    const entries = [...good, { path: `${PGDATA}\\pg_wal`, protected: false, rules: [...inheritedOk, { sid: USER_SID, inherited: true, allow: true }] }];
    expect(findDataRootAclViolations(ROOT, entries).join('\n')).toMatch(/pg_wal: access granted to/);
  });

  it('rejects a root that still inherits from %ProgramData% or carries Users', () => {
    const entries = [{ ...lockedRoot, protected: false, rules: [...lockedRoot.rules, { sid: 'S-1-5-32-545', inherited: true, allow: true }] }];
    const v = findDataRootAclViolations(ROOT, entries).join('\n');
    expect(v).toMatch(/inheritance is still enabled/);
    expect(v).toMatch(/S-1-5-32-545/);
  });

  it('finds the root by the reader\'s isRoot marker even when its path is spelled differently (8.3 short name)', () => {
    const shortRoot = 'C:\\PROGRA~3\\Studix';
    const entries = good.map((e) => (e === lockedRoot ? { ...e, isRoot: true } : { ...e, isRoot: false }));
    expect(findDataRootAclViolations(shortRoot, entries)).toEqual([]);
  });

  it('rejects a root missing SYSTEM, and a missing root entry', () => {
    expect(findDataRootAclViolations(ROOT, [{ ...lockedRoot, rules: [lockedRoot.rules[0]] }]).join('\n')).toMatch(/expected exactly Administrators \+ SYSTEM/);
    expect(findDataRootAclViolations(ROOT, [])).toEqual([`${ROOT}: missing from the ACL listing`]);
  });
});

describe('verifyDataRootAcl / restoreDataRootAcl', () => {
  const lockedJson = JSON.stringify([
    { path: ROOT, protected: true, rules: [{ sid: ADMINISTRATORS_SID, inherited: false, allow: true }, { sid: SYSTEM_SID, inherited: false, allow: true }] },
    { path: PGDATA, protected: false, rules: [{ sid: ADMINISTRATORS_SID, inherited: true, allow: true }, { sid: SYSTEM_SID, inherited: true, allow: true }] },
  ]);

  it('reads the ACLs through PowerShell with the root passed via the environment, never in the command text', () => {
    const execFileSync = vi.fn(() => lockedJson);
    verifyDataRootAcl({ dataRoot: ROOT }, { execFileSync });
    const [cmd, args, opts] = execFileSync.mock.calls[0];
    expect(cmd).toBe(POWERSHELL_EXE);
    expect(args.join(' ')).not.toContain(ROOT);
    expect(opts.env.STUDIX_ACL_VERIFY_ROOT).toBe(ROOT);
  });

  it('throws (fail-closed) when the final state is not exactly Administrators + SYSTEM', () => {
    const leftover = JSON.stringify([...JSON.parse(lockedJson), {
      path: `${PGDATA}\\base`, protected: false, rules: [{ sid: USER_SID, inherited: true, allow: true }],
    }]);
    expect(() => verifyDataRootAcl({ dataRoot: ROOT }, { execFileSync: () => leftover })).toThrow(DataDirAclError);
  });

  it('throws when the ACLs cannot be read at all', () => {
    const execFileSync = vi.fn(() => { throw Object.assign(new Error('failed'), { stderr: 'Access denied' }); });
    expect(() => verifyDataRootAcl({ dataRoot: ROOT }, { execFileSync })).toThrow(/Access denied/);
  });

  it('restore = full lockdown (which removes the temporary grant) followed by verification', () => {
    const order = [];
    const execFileSync = vi.fn((cmd, args) => { order.push(cmd === ICACLS_EXE ? args[1] : 'powershell'); return cmd === POWERSHELL_EXE ? lockedJson : ''; });
    restoreDataRootAcl({ dataRoot: ROOT }, { execFileSync, mkdirSync: vi.fn(), readdirSync: () => ['pgdata'] });
    expect(order).toEqual(['/setowner', '/inheritance:r', '/reset', 'powershell']);
  });
});
