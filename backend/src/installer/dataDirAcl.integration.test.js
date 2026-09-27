// backend/src/installer/dataDirAcl.integration.test.js
// Real-ACL and real-PostgreSQL proof of the %ProgramData%\Studix lockdown and of the temporary
// pgdata provisioning access, on disposable probe trees under %ProgramData% (which grants
// BUILTIN\Users read + create by inheritance — the exact starting state of a real
// %ProgramData%\Studix). The real %ProgramData%\Studix is never touched.
//
// Three groups, each skipping with a clear reason when its environment is missing — never a
// fake pass:
//   A. elevated: lockdown ACL by SID (setowner/reset/inheritance, planted files, re-run).
//   B. elevated + PostgreSQL binaries: the full installer lifecycle with the REAL restricted
//      token initdb/pg_ctl use under an elevated installer — lockdown -> pgdata-only grant ->
//      provisionPostgres (initdb + ad-hoc start) -> stop -> restore -> verify; then an
//      upgrade-shaped re-run over the initialized cluster.
//   C. NOT elevated + PostgreSQL binaries (a normal developer shell): a non-elevated token has
//      exactly the access PostgreSQL's restricted token has (Administrators present but
//      deny-only), so this proves the discovered failure and its fix with real processes: under
//      the locked root, provisioning fails without the grant and succeeds with it, while
//      config\/backups\/logs\ stay unreadable. (The installer-side steps a non-elevated shell
//      cannot perform — /setowner, the children reset, the final restore — are covered by B.)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import {
  lockDownDataRootAcl, grantPgProvisioningAccess, restoreDataRootAcl, verifyDataRootAcl,
  resolveCurrentUserSid, buildDataRootAclCommands, ADMINISTRATORS_SID, SYSTEM_SID,
} from './dataDirAcl.js';
import {
  provisionPostgres, stopPostgres, locatePgBinaries, classifyDataDir, PostgresProvisioningError,
} from '../db/postgresProvisioning.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

// STUDIX_PG_HOME, else the pinned binaries of the Windows runtime build, else a local install.
function findPgHome() {
  const hasPostgres = (home) => home && fs.existsSync(path.join(home, 'bin', 'postgres.exe'));
  if (hasPostgres(process.env.STUDIX_PG_HOME)) return process.env.STUDIX_PG_HOME;
  const built = path.join(__dirname, '..', '..', '..', 'release', 'win-x64', 'studix', 'pgsql');
  if (hasPostgres(built)) return built;
  const pgRoot = 'C:\\Program Files\\PostgreSQL';
  if (fs.existsSync(pgRoot)) {
    for (const v of fs.readdirSync(pgRoot).sort().reverse()) {
      if (hasPostgres(path.join(pgRoot, v))) return path.join(pgRoot, v);
    }
  }
  return null;
}

const onWindows = process.platform === 'win32';
const elevated = onWindows && isElevated();
const pgHome = onWindows ? findPgHome() : null;

function probeRoot(tag) {
  return path.join(process.env.ProgramData || 'C:\\ProgramData', `studix-${tag}-${crypto.randomBytes(4).toString('hex')}`);
}

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
].join('\n');

function readAcl(target) {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', READ_ACL_PS], {
    encoding: 'utf8', env: { ...process.env, STUDIX_ACL_PROBE_PATH: target }, windowsHide: true,
  });
  const acl = JSON.parse(out);
  acl.rules = [].concat(acl.rules || []);
  return acl;
}
const sidsOf = (acl) => new Set(acl.rules.map((r) => r.sid));

// Owner rights let the (non-elevated) creator of a probe tree reset its DACL for cleanup.
function removeProbe(root) {
  if (!root || !fs.existsSync(root)) return;
  try { execFileSync('icacls', [root, '/reset', '/T', '/C', '/Q'], { stdio: 'ignore' }); } catch { /* best effort */ }
  fs.rmSync(root, { recursive: true, force: true });
}

function seedDataRoot(root) {
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backups'), { recursive: true });
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', '.env'), 'SESSION_SECRET=probe\n');
  fs.writeFileSync(path.join(root, 'backups', 'studix-backup-probe.dump'), 'x');
}

// ── A. lockdown ACL (elevated) ─────────────────────────────────────────────────────────────
describe.skipIf(!elevated)('A. lockDownDataRootAcl — real Windows ACL (elevated)', () => {
  const root = probeRoot('acl-it');
  const secretFile = path.join(root, 'config', '.env');
  const planted = path.join(root, 'backups', 'studix-backup-planted.dump');

  beforeAll(() => {
    seedDataRoot(root);
    fs.writeFileSync(planted, 'x');
    // An explicit Users grant on a child — what a local user could have left behind.
    execFileSync('icacls', [planted, '/grant', `*${USERS_SID}:(F)`], { stdio: 'ignore' });
    if (!readAcl(secretFile).rules.some((r) => r.sid === USERS_SID)) {
      throw new Error('precondition failed: the probe tree did not inherit BUILTIN\\Users access');
    }
    lockDownDataRootAcl({ dataRoot: root });
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('root: inheritance removed, exactly Administrators + SYSTEM (allow), owned by Administrators', () => {
    const acl = readAcl(root);
    expect(acl.protected).toBe(true);
    expect(acl.owner).toBe(ADMINISTRATORS_SID);
    expect(sidsOf(acl)).toEqual(new Set([ADMINISTRATORS_SID, SYSTEM_SID]));
    expect(acl.rules.every((r) => r.type === 'Allow')).toBe(true);
  });

  it('existing children keep only the inherited Administrators + SYSTEM ACEs', () => {
    for (const target of [secretFile, path.join(root, 'backups'), path.join(root, 'config')]) {
      const acl = readAcl(target);
      expect(sidsOf(acl)).toEqual(new Set([ADMINISTRATORS_SID, SYSTEM_SID]));
      expect(acl.rules.every((r) => r.inherited)).toBe(true);
      expect(acl.owner).toBe(ADMINISTRATORS_SID);
    }
  });

  it('a previously planted file loses its explicit Users grant and its owner', () => {
    const acl = readAcl(planted);
    expect(acl.rules.some((r) => r.sid === USERS_SID)).toBe(false);
    expect(acl.owner).toBe(ADMINISTRATORS_SID);
  });

  it('verifyDataRootAcl accepts the result; a re-run (upgrade) keeps it', () => {
    expect(() => verifyDataRootAcl({ dataRoot: root })).not.toThrow();
    lockDownDataRootAcl({ dataRoot: root });
    expect(() => verifyDataRootAcl({ dataRoot: root })).not.toThrow();
  });
});

// ── B. full installer lifecycle with real PostgreSQL (elevated) ─────────────────────────────
describe.skipIf(!(elevated && pgHome))('B. temporary pgdata access — real PostgreSQL, elevated installer lifecycle', () => {
  const root = probeRoot('prov-it');
  const pgDataDir = path.join(root, 'pgdata');
  let userSid;
  let binaries;

  beforeAll(() => {
    seedDataRoot(root);
    userSid = resolveCurrentUserSid();
    binaries = locatePgBinaries(pgHome);
  });

  afterAll(() => {
    try { stopPostgres({ pgCtlPath: binaries.pg_ctl, dataDir: pgDataDir }); } catch { /* already stopped */ }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('fresh install: locked root + pgdata-only grant -> initdb and the ad-hoc start succeed -> restore -> Administrators + SYSTEM only', async () => {
    lockDownDataRootAcl({ dataRoot: root });
    expect(grantPgProvisioningAccess({ pgDataDir })).toEqual({ sid: userSid, granted: true });

    // Isolation while the grant exists: only pgdata carries the installing user's SID.
    expect(sidsOf(readAcl(pgDataDir)).has(userSid)).toBe(true);
    for (const other of [root, path.join(root, 'config'), path.join(root, 'config', '.env'), path.join(root, 'backups'), path.join(root, 'logs')]) {
      expect(sidsOf(readAcl(other)).has(userSid)).toBe(false);
    }

    const result = await provisionPostgres({ pgHome, pgDataDir, preferredPort: 55860, database: 'studix_acl_it' });
    expect(result.status).toBe('initialized');
    stopPostgres({ pgCtlPath: binaries.pg_ctl, dataDir: pgDataDir });

    restoreDataRootAcl({ dataRoot: root });
    for (const target of [root, pgDataDir, path.join(pgDataDir, 'base'), path.join(pgDataDir, 'PG_VERSION'), path.join(root, 'config', '.env')]) {
      const acl = readAcl(target);
      expect(sidsOf(acl)).toEqual(new Set([ADMINISTRATORS_SID, SYSTEM_SID]));
    }
    expect(readAcl(root).protected).toBe(true);
    expect(classifyDataDir(pgDataDir).state).toBe('initialized');
  });

  it('upgrade / re-run over the initialized cluster: the same grant -> start -> restore cycle works and ends locked', async () => {
    lockDownDataRootAcl({ dataRoot: root });
    grantPgProvisioningAccess({ pgDataDir });
    const result = await provisionPostgres({ pgHome, pgDataDir, preferredPort: 55860, database: 'studix_acl_it' });
    expect(result.status).toBe('already_initialized');
    stopPostgres({ pgCtlPath: binaries.pg_ctl, dataDir: pgDataDir });
    restoreDataRootAcl({ dataRoot: root });
    expect(sidsOf(readAcl(pgDataDir))).toEqual(new Set([ADMINISTRATORS_SID, SYSTEM_SID]));
  });

  it('without the temporary grant, the same fresh provisioning fails (the blocker this fixes)', async () => {
    const bare = probeRoot('prov-it-nogrant');
    try {
      fs.mkdirSync(bare, { recursive: true });
      lockDownDataRootAcl({ dataRoot: bare });
      await expect(provisionPostgres({ pgHome, pgDataDir: path.join(bare, 'pgdata'), preferredPort: 55861 }))
        .rejects.toBeInstanceOf(PostgresProvisioningError);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});

// ── C. restricted-equivalent token (NOT elevated) with real PostgreSQL ───────────────────────
describe.skipIf(!(onWindows && !elevated && pgHome))('C. temporary pgdata access — real PostgreSQL under a non-admin token', () => {
  const protectRootArgs = (root) => buildDataRootAclCommands(root)[1][1]; // production step 2

  it('locked root WITHOUT the grant: provisioning fails at initdb (Permission denied)', async () => {
    const root = probeRoot('prov-c-nogrant');
    try {
      seedDataRoot(root);
      execFileSync('icacls', protectRootArgs(root), { stdio: 'ignore' });
      const err = await provisionPostgres({ pgHome, pgDataDir: path.join(root, 'pgdata'), preferredPort: 55871 }).catch((e) => e);
      expect(err).toBeInstanceOf(PostgresProvisioningError);
      expect(err.reason).toBe('initdb_failed');
      expect(err.message).toMatch(/Permission denied/i);
    } finally {
      removeProbe(root);
    }
  });

  it('locked root WITH the pgdata-only grant: initdb + ad-hoc start + readiness succeed, while config/backups/logs stay unreadable', async () => {
    const root = probeRoot('prov-c');
    const pgDataDir = path.join(root, 'pgdata');
    let binaries;
    try {
      seedDataRoot(root);
      // The grant is applied before the root is protected only because a non-elevated shell
      // cannot rewrite pgdata's DACL afterwards; the resulting ACL is the same as the installer's.
      const { sid, granted } = grantPgProvisioningAccess({ pgDataDir });
      expect(granted).toBe(true);
      expect(sid).toMatch(/^S-1-5-21-/);
      execFileSync('icacls', protectRootArgs(root), { stdio: 'ignore' });

      // Isolation, checked with this (restricted-equivalent) token's real access:
      expect(() => fs.readFileSync(path.join(root, 'config', '.env'))).toThrow(/EPERM|EACCES/);
      expect(() => fs.readdirSync(path.join(root, 'backups'))).toThrow(/EPERM|EACCES/);
      expect(() => fs.writeFileSync(path.join(root, 'logs', 'x.log'), 'x')).toThrow(/EPERM|EACCES/);
      expect(() => fs.readdirSync(root)).toThrow(/EPERM|EACCES/);
      expect(() => fs.writeFileSync(path.join(root, 'planted.txt'), 'x')).toThrow(/EPERM|EACCES/);

      binaries = locatePgBinaries(pgHome);
      const result = await provisionPostgres({ pgHome, pgDataDir, preferredPort: 55872, database: 'studix_acl_c' });
      expect(result.status).toBe('initialized');
      expect(classifyDataDir(pgDataDir).state).toBe('initialized');
    } finally {
      if (binaries) {
        try { stopPostgres({ pgCtlPath: binaries.pg_ctl, dataDir: pgDataDir }); } catch { /* not started */ }
      }
      removeProbe(root);
    }
  });
});

// ── D. the production ACL reader against a real tree (any Windows shell) ────────────────────
describe.skipIf(!onWindows)('D. readDataRootAcls / verifyDataRootAcl — real PowerShell, real ACLs', () => {
  it('parses and reports real ACLs by SID, and rejects an unlocked tree with concrete violations (never a script error)', () => {
    const root = fs.mkdtempSync(path.join(process.env.TEMP || process.env.TMP || 'C:\\Windows\\Temp', 'studix-reader-it-'));
    try {
      fs.mkdirSync(path.join(root, 'pgdata', 'base'), { recursive: true });
      fs.writeFileSync(path.join(root, 'pgdata', 'PG_VERSION'), '18');
      let err;
      try { verifyDataRootAcl({ dataRoot: root }); } catch (e) { err = e; }
      expect(err).toBeDefined();
      expect(err.name).toBe('DataDirAclError');
      expect(err.message).toMatch(/inheritance is still enabled/);
      expect(err.message).not.toMatch(/ParserError|IncompleteHashLiteral|missing from the ACL listing/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe.skipIf(elevated)('A/B (elevated-only groups)', () => {
  it.skip(`SKIPPED — groups A and B need an elevated Windows shell (platform=${process.platform}); run npm run test:integration from an elevated prompt`, () => {});
});
describe.skipIf(Boolean(pgHome) || !onWindows)('B/C (PostgreSQL binaries)', () => {
  it.skip('SKIPPED — no PostgreSQL binaries found (set STUDIX_PG_HOME, or build release\\win-x64\\studix\\pgsql)', () => {});
});
