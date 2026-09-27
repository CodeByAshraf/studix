// backend/src/installer/dataDirAcl.js
// ─────────────────────────────────────────────────────────────
// Locks %ProgramData%\Studix down to Administrators + SYSTEM only. Everything sensitive lives
// under it: config\.env (SESSION_SECRET, studix_app password), config\admin.env (studix_admin),
// pgdata\ (the database files), backups\ (full dumps) and logs\.
//
// Why this is needed: %ProgramData% grants BUILTIN\Users read+execute (and create-file/folder)
// to everything created under it, by inheritance. installer/studix.iss's [Dirs]
// "Permissions: admins-full system-full" only ADDS grants — it never removes those inherited
// ACEs — so without this step any local Windows user can read the secrets, the database files
// and the dumps, and can drop files into backups\.
//
// lockDownDataRootAcl — three icacls calls, SIDs only (locale-independent — no
// "Administrators"/"SYSTEM"/"Users" names, which differ on Arabic Windows), argv arrays only (no
// shell), no /C (any failure stops the install; a re-run of the installer retries):
//   1. /setowner Administrators /T — a file someone planted here before the lockdown would
//      otherwise stay owned by them, and an owner can always rewrite its own DACL.
//   2. /inheritance:r /grant:r Administrators + SYSTEM (OI)(CI)F on the root — drops the ACEs
//      inherited from %ProgramData% and replaces them with exactly these two. Done BEFORE the
//      children are reset: every child that only inherits loses the Users ACEs immediately, and
//      the tree is never re-exposed to %ProgramData%'s inheritance at any point.
//   3. <root>\* /reset /T — every object below the root back to "inherited ACEs only": removes
//      any explicit ACE (e.g. an explicit Users grant, or the temporary provisioning grant
//      below), so every child ends up with exactly the root's two ACEs.
// Idempotent: the same calls on an already locked-down tree leave it unchanged, which is what
// makes it safe on every upgrade/re-run (existing installs are corrected, not assumed).
// Both Studix services and both scheduled tasks run as LocalSystem, and every
// install/restore/switch operator step runs elevated (Administrators) — both keep full access.
//
// Temporary PostgreSQL provisioning access: initdb and the ad-hoc `pg_ctl start` deliberately
// drop the Administrators group from their own token (PostgreSQL refuses to run with admin
// rights — see postgresProvisioning.js), so under the lockdown they have no access at all.
// grantPgProvisioningAccess gives the installing user's SID full control of pgdata\ ONLY — never
// the root, config\, backups\ or logs\ — for the duration of provisioning; restoreDataRootAcl
// (lockdown + verifyDataRootAcl) removes it again once PostgreSQL runs as the LocalSystem
// service, and fails closed if the final ACL is not exactly Administrators + SYSTEM.
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

export const ADMINISTRATORS_SID = 'S-1-5-32-544';
export const SYSTEM_SID = 'S-1-5-18';
const ALLOWED_SIDS = new Set([ADMINISTRATORS_SID, SYSTEM_SID]);

export class DataDirAclError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DataDirAclError';
  }
}

// Absolute %SystemRoot%\System32 paths, never a PATH lookup: this runs elevated, and PATH can
// hold same-named tools (e.g. Git for Windows' GNU `whoami`, which rejects `/user`).
const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
export const ICACLS_EXE = path.join(SYSTEM32, 'icacls.exe');
export const WHOAMI_EXE = path.join(SYSTEM32, 'whoami.exe');
export const POWERSHELL_EXE = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');

export function resolveStudixDataRoot() {
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  return path.join(programData, 'Studix');
}

const REAL_IO = { execFileSync, mkdirSync: fs.mkdirSync, readdirSync: fs.readdirSync };

function run(exec, cmd, args, label, target) {
  try {
    return exec(cmd, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const detail = err && err.stderr ? String(err.stderr).trim() : '';
    throw new DataDirAclError(`${label} فشل على ${target}: ${detail || err.message}`);
  }
}

// ── lockdown ────────────────────────────────────────────────────────────────────────────────

// The exact icacls invocations, in order — exported so the contract is unit-testable without
// touching a real ACL. `hasChildren` false (an empty root) skips the children reset: a wildcard
// that matches nothing is an icacls error, and there is nothing to reset.
export function buildDataRootAclCommands(dataRoot, { hasChildren = true } = {}) {
  const commands = [
    [ICACLS_EXE, [dataRoot, '/setowner', `*${ADMINISTRATORS_SID}`, '/T', '/Q']],
    [ICACLS_EXE, [
      dataRoot, '/inheritance:r', '/grant:r',
      `*${ADMINISTRATORS_SID}:(OI)(CI)F`, `*${SYSTEM_SID}:(OI)(CI)F`, '/Q',
    ]],
  ];
  if (hasChildren) commands.push([ICACLS_EXE, [path.join(dataRoot, '*'), '/reset', '/T', '/Q']]);
  return commands;
}

export function lockDownDataRootAcl({ dataRoot = resolveStudixDataRoot() } = {}, io = {}) {
  const { execFileSync: exec, mkdirSync, readdirSync } = { ...REAL_IO, ...io };
  mkdirSync(dataRoot, { recursive: true });
  const hasChildren = readdirSync(dataRoot).length > 0;
  for (const [cmd, args] of buildDataRootAclCommands(dataRoot, { hasChildren })) {
    run(exec, cmd, args, `icacls ${args[1]}`, dataRoot);
  }
  return { dataRoot };
}

// ── temporary provisioning access (pgdata only) ─────────────────────────────────────────────

// The SID of the user this (elevated) installer process runs as — the same SID initdb/pg_ctl's
// restricted token keeps. `whoami /user /fo csv /nh` prints `"<name>","<SID>"`; the name part is
// localized/user-controlled, the SID is not, so only the last S-1-… token is used.
export function resolveCurrentUserSid(io = {}) {
  const { execFileSync: exec } = { ...REAL_IO, ...io };
  const out = String(run(exec, WHOAMI_EXE, ['/user', '/fo', 'csv', '/nh'], 'whoami /user', 'the current process'));
  const sids = out.match(/S-1-\d+(?:-\d+)+/g);
  if (!sids) throw new DataDirAclError(`تعذّر تحديد SID المستخدم الحالي من مخرجات whoami: ${out.trim()}`);
  return sids[sids.length - 1];
}

export function buildPgProvisioningGrantCommand(pgDataDir, sid) {
  return [ICACLS_EXE, [pgDataDir, '/grant', `*${sid}:(OI)(CI)F`, '/Q']];
}

// Creates pgdata (an empty directory is exactly what initdb expects) and grants the installing
// user full control of it — and of nothing else. SYSTEM (an installer run as LocalSystem, e.g.
// by deployment tooling) already has access, so no grant is added for it.
export function grantPgProvisioningAccess({ pgDataDir }, io = {}) {
  const { execFileSync: exec, mkdirSync } = { ...REAL_IO, ...io };
  const sid = resolveCurrentUserSid(io);
  mkdirSync(pgDataDir, { recursive: true });
  if (sid === SYSTEM_SID) return { sid, granted: false };
  const [cmd, args] = buildPgProvisioningGrantCommand(pgDataDir, sid);
  run(exec, cmd, args, 'icacls /grant', pgDataDir);
  return { sid, granted: true };
}

// ── verification + restore ──────────────────────────────────────────────────────────────────

// Reads the ACLs of the root and everything up to two levels below it (the root's children and
// theirs — e.g. pgdata\base, pgdata\pg_wal), by SID. Paths go through an environment variable,
// never into the PowerShell command text.
// Newline-joined (never '; '): statements inside the @{...} hashtable literals must not be
// separated by a stray ';'.
const READ_ACLS_PS = [
  '$ErrorActionPreference = "Stop"',
  '$root = $env:STUDIX_ACL_VERIFY_ROOT',
  '$sid = { param($r) try { $r.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { $r.Value } }',
  '$rootItem = Get-Item -LiteralPath $root -Force',
  '$items = @($rootItem) + @(Get-ChildItem -LiteralPath $root -Force -Recurse -Depth 1)',
  '$result = @($items | ForEach-Object {',
  '  $a = Get-Acl -LiteralPath $_.FullName',
  '  [pscustomobject]@{',
  '    path = $_.FullName',
  '    isRoot = ($_.FullName -eq $rootItem.FullName)',
  '    protected = $a.AreAccessRulesProtected',
  '    rules = @($a.Access | ForEach-Object { [pscustomobject]@{ sid = (& $sid $_.IdentityReference); inherited = $_.IsInherited; allow = ($_.AccessControlType.ToString() -eq "Allow") } })',
  '  }',
  '})',
  'ConvertTo-Json -InputObject $result -Depth 5 -Compress',
].join('\n');

export function readDataRootAcls(dataRoot, io = {}) {
  const { execFileSync: exec } = { ...REAL_IO, ...io };
  let out;
  try {
    out = exec(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', READ_ACLS_PS], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, STUDIX_ACL_VERIFY_ROOT: dataRoot },
    });
  } catch (err) {
    const detail = err && err.stderr ? String(err.stderr).trim() : '';
    throw new DataDirAclError(`تعذّر قراءة صلاحيات ${dataRoot}: ${detail || err.message}`);
  }
  const parsed = JSON.parse(String(out) || '[]');
  return [].concat(parsed).map((entry) => ({ ...entry, rules: [].concat(entry.rules || []) }));
}

// Pure check of what readDataRootAcls returned — exported for unit tests. Root: inheritance
// removed, only allow rules, exactly {Administrators, SYSTEM}. Everything below: only inherited
// allow rules from that same set — no explicit ACE (the temporary pgdata grant included), no
// other principal.
export function findDataRootAclViolations(dataRoot, entries) {
  const violations = [];
  // The reader marks the root itself (isRoot) — a path comparison alone would miss it when the
  // two spellings differ (8.3 short names vs. long names, casing).
  const rootKey = path.resolve(dataRoot).toLowerCase();
  const roots = entries.filter((e) => e.isRoot === true || path.resolve(e.path).toLowerCase() === rootKey);
  if (roots.length !== 1) return [`${dataRoot}: missing from the ACL listing`];
  const [rootEntry] = roots;

  const rootSids = new Set(rootEntry.rules.map((r) => r.sid));
  if (!rootEntry.protected) violations.push(`${dataRoot}: inheritance is still enabled`);
  if (rootSids.size !== ALLOWED_SIDS.size || [...ALLOWED_SIDS].some((s) => !rootSids.has(s))) {
    violations.push(`${dataRoot}: principals are [${[...rootSids].join(', ')}], expected exactly Administrators + SYSTEM`);
  }
  for (const entry of entries) {
    const isRoot = entry === rootEntry;
    for (const rule of entry.rules) {
      if (!rule.allow) violations.push(`${entry.path}: unexpected deny rule for ${rule.sid}`);
      if (!ALLOWED_SIDS.has(rule.sid)) violations.push(`${entry.path}: access granted to ${rule.sid}`);
      if (!isRoot && !rule.inherited) violations.push(`${entry.path}: explicit (non-inherited) rule for ${rule.sid}`);
    }
  }
  return violations;
}

export function verifyDataRootAcl({ dataRoot = resolveStudixDataRoot() } = {}, io = {}) {
  const violations = findDataRootAclViolations(dataRoot, readDataRootAcls(dataRoot, io));
  if (violations.length > 0) {
    throw new DataDirAclError(`صلاحيات ${dataRoot} ليست مقفلة كما يجب:\n${violations.join('\n')}`);
  }
  return { dataRoot };
}

// Final lockdown after provisioning (also the failure-path cleanup): removes the temporary
// pgdata grant together with anything else explicit, then proves the result.
export function restoreDataRootAcl({ dataRoot = resolveStudixDataRoot() } = {}, io = {}) {
  lockDownDataRootAcl({ dataRoot }, io);
  return verifyDataRootAcl({ dataRoot }, io);
}
