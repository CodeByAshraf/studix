// backend/src/installer/dataDirAcl.integration.test.js
// Real-ACL proof of lockDownDataRootAcl on a disposable probe tree under %ProgramData% (which
// grants BUILTIN\Users read + create by inheritance — the exact starting state of a real
// %ProgramData%\Studix). The real %ProgramData%\Studix is never touched.
//
// Requires Windows AND an elevated shell (icacls /setowner needs it, and only an elevated
// process can read the locked-down ACL back). Otherwise every test reports a clear skip —
// never a fake pass. ACEs are compared by SID, so the result holds on any Windows language.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { lockDownDataRootAcl, ADMINISTRATORS_SID, SYSTEM_SID } from './dataDirAcl.js';

const USERS_SID = 'S-1-5-32-545';

// Same probe as windowsService.integration.test.js: `net session` succeeds only when elevated.
function isElevated() {
  try {
    execFileSync('net', ['session'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const canRun = process.platform === 'win32' && isElevated();

// ACL of one path, by SID. The path is passed through an environment variable, never spliced
// into the PowerShell command text.
const READ_ACL_PS = [
  '$a = Get-Acl -LiteralPath $env:STUDIX_ACL_PROBE_PATH',
  '$sid = { param($r) try { $r.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { $r.Value } }',
  '[pscustomobject]@{',
  '  owner = (& $sid $a.GetOwner([System.Security.Principal.NTAccount]))',
  '  protected = $a.AreAccessRulesProtected',
  '  rules = @($a.Access | ForEach-Object { [pscustomobject]@{ sid = (& $sid $_.IdentityReference); inherited = $_.IsInherited; type = $_.AccessControlType.ToString() } })',
  '} | ConvertTo-Json -Depth 4 -Compress',
].join('; ');

function readAcl(target) {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', READ_ACL_PS], {
    encoding: 'utf8', env: { ...process.env, STUDIX_ACL_PROBE_PATH: target }, windowsHide: true,
  });
  const acl = JSON.parse(out);
  acl.rules = [].concat(acl.rules || []);
  return acl;
}

describe.skipIf(!canRun)('lockDownDataRootAcl — real Windows ACL (elevated)', () => {
  const root = path.join(process.env.ProgramData || 'C:\\ProgramData', `studix-acl-it-${crypto.randomBytes(4).toString('hex')}`);
  const secretFile = path.join(root, 'config', '.env');
  const planted = path.join(root, 'backups', 'studix-backup-planted.dump');

  beforeAll(() => {
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.mkdirSync(path.join(root, 'backups'), { recursive: true });
    fs.writeFileSync(secretFile, 'SESSION_SECRET=probe\n');
    fs.writeFileSync(planted, 'x');
    // An explicit Users grant on a child — what a local user could have left behind.
    execFileSync('icacls', [planted, '/grant', `*${USERS_SID}:(F)`], { stdio: 'ignore' });

    const before = readAcl(secretFile);
    if (!before.rules.some((r) => r.sid === USERS_SID)) {
      throw new Error('precondition failed: the probe tree did not inherit BUILTIN\\Users access');
    }

    lockDownDataRootAcl({ dataRoot: root });
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('root: inheritance removed, exactly Administrators + SYSTEM (allow), owned by Administrators', () => {
    const acl = readAcl(root);
    expect(acl.protected).toBe(true);
    expect(acl.owner).toBe(ADMINISTRATORS_SID);
    expect(new Set(acl.rules.map((r) => r.sid))).toEqual(new Set([ADMINISTRATORS_SID, SYSTEM_SID]));
    expect(acl.rules.every((r) => r.type === 'Allow')).toBe(true);
  });

  it('existing children (a secret file, the backups dir) keep only the inherited Administrators + SYSTEM ACEs', () => {
    for (const target of [secretFile, path.join(root, 'backups'), path.join(root, 'config')]) {
      const acl = readAcl(target);
      expect(new Set(acl.rules.map((r) => r.sid))).toEqual(new Set([ADMINISTRATORS_SID, SYSTEM_SID]));
      expect(acl.rules.every((r) => r.inherited)).toBe(true);
      expect(acl.owner).toBe(ADMINISTRATORS_SID);
    }
  });

  it('a previously planted file loses its explicit Users grant and its owner', () => {
    const acl = readAcl(planted);
    expect(acl.rules.some((r) => r.sid === USERS_SID)).toBe(false);
    expect(acl.owner).toBe(ADMINISTRATORS_SID);
  });

  it('a file created after the lockdown inherits the same restriction', () => {
    const later = path.join(root, 'backups', 'later.dump');
    fs.writeFileSync(later, 'y');
    const acl = readAcl(later);
    expect(new Set(acl.rules.map((r) => r.sid))).toEqual(new Set([ADMINISTRATORS_SID, SYSTEM_SID]));
  });

  it('running it again (upgrade / re-run) succeeds and leaves the same ACL', () => {
    lockDownDataRootAcl({ dataRoot: root });
    const acl = readAcl(root);
    expect(acl.protected).toBe(true);
    expect(new Set(acl.rules.map((r) => r.sid))).toEqual(new Set([ADMINISTRATORS_SID, SYSTEM_SID]));
  });
});

describe.skipIf(canRun)('lockDownDataRootAcl — real Windows ACL', () => {
  it.skip(`SKIPPED — needs Windows and an elevated shell (platform=${process.platform}); run npm run test:integration from an elevated prompt`, () => {});
});
