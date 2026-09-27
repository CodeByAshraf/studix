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
// Three icacls calls, SIDs only (locale-independent — no "Administrators"/"SYSTEM"/"Users"
// names, which differ on Arabic Windows), argv arrays only (no shell), no /C (any failure stops
// the install; a re-run of the installer retries):
//   1. /setowner Administrators /T — a file someone planted here before the lockdown would
//      otherwise stay owned by them, and an owner can always rewrite its own DACL.
//   2. /reset /T — every object back to "inherited ACEs only": removes any explicit ACE on any
//      child (e.g. an explicit Users grant) so nothing below the root keeps its own access.
//   3. /inheritance:r /grant:r Administrators + SYSTEM (OI)(CI)F on the root — drops the ACEs
//      inherited from %ProgramData% and replaces them with exactly these two; step 2 made every
//      child purely inherited, so the children end up with exactly these two as well.
// Idempotent: the same three calls on an already locked-down tree leave it unchanged, which is
// what makes it safe on every upgrade/re-run (existing installs are corrected, not assumed).
// Both Studix services and both scheduled tasks run as LocalSystem, and every
// install/restore/switch operator step runs elevated (Administrators) — both keep full access.
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

export const ADMINISTRATORS_SID = 'S-1-5-32-544';
export const SYSTEM_SID = 'S-1-5-18';

export function resolveStudixDataRoot() {
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  return path.join(programData, 'Studix');
}

// The exact icacls invocations, in order — exported so the contract is unit-testable without
// touching a real ACL.
export function buildDataRootAclCommands(dataRoot) {
  return [
    ['icacls', [dataRoot, '/setowner', `*${ADMINISTRATORS_SID}`, '/T', '/Q']],
    ['icacls', [dataRoot, '/reset', '/T', '/Q']],
    ['icacls', [
      dataRoot, '/inheritance:r', '/grant:r',
      `*${ADMINISTRATORS_SID}:(OI)(CI)F`, `*${SYSTEM_SID}:(OI)(CI)F`, '/Q',
    ]],
  ];
}

const REAL_IO = { execFileSync, mkdirSync: fs.mkdirSync };

export function lockDownDataRootAcl({ dataRoot = resolveStudixDataRoot() } = {}, io = {}) {
  const { execFileSync: exec, mkdirSync } = { ...REAL_IO, ...io };
  mkdirSync(dataRoot, { recursive: true });
  for (const [cmd, args] of buildDataRootAclCommands(dataRoot)) {
    try {
      exec(cmd, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      const detail = err && err.stderr ? String(err.stderr).trim() : '';
      throw new Error(`icacls ${args[1]} فشل على ${dataRoot}: ${detail || err.message}`);
    }
  }
  return { dataRoot };
}
