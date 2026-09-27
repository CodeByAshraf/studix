// backend/scripts/uninstallWipe.consistency.test.js
// ─────────────────────────────────────────────────────────────
// INSTALL-08 follow-up — the opt-in data-wipe uninstall ("Mode B") must also remove the legacy
// root-level {commonappdata}\Studix\pg-startup.log that pre-abc5b60 builds wrote next to pgdata\
// (current builds write %TEMP%\studix-pg-startup.log instead). A real Mode B run on 2026-09-27
// left exactly that one file behind beside the preserved backups\.
//
// Pure text/structure assertions on installer/studix.iss (this repo has no ISCC/Pascal Script
// execution in its test tooling — same approach as version.consistency.test.js). The real
// behaviour is validated by an installer lifecycle run; these tests pin the contract so it
// cannot silently regress:
//   - the legacy file is deleted, by exact name, only inside the WipeDataConfirmed branch
//     (Mode B), never on a normal (Mode A) uninstall;
//   - backups\ is never a deletion target, and nothing deletes the Studix root itself or uses
//     a wildcard that could reach backups\.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..'); // backend/scripts -> backend -> repo root
const ISS = fs.readFileSync(path.join(REPO_ROOT, 'installer', 'studix.iss'), 'utf8');

// Code only — Pascal `//` comments and Inno `;` comment lines stripped, so comments that merely
// mention a path can never satisfy (or break) an assertion about what the code actually does.
const CODE = ISS.split(/\r?\n/)
  .filter((line) => !/^\s*;/.test(line))
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

// The body of CurUninstallStepChanged, from its header to the `end;` that closes the procedure.
function curUninstallStepChangedBody() {
  const start = CODE.indexOf('procedure CurUninstallStepChanged(');
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = CODE.slice(start);
  const end = rest.search(/\nend;/);
  expect(end).toBeGreaterThan(0);
  return rest.slice(0, end);
}

// The block guarded by `(CurUninstallStep = usPostUninstall) and WipeDataConfirmed`.
function wipeBranch() {
  const body = curUninstallStepChangedBody();
  const guard = body.indexOf('(CurUninstallStep = usPostUninstall) and WipeDataConfirmed');
  expect(guard).toBeGreaterThanOrEqual(0);
  return body.slice(guard);
}

const DELETE_CALL_RE = /\b(DelTree|DeleteFile|RemoveDir|DelTreeEx)\s*\(\s*ExpandConstant\('([^']*)'\)/g;
const deletionTargets = (text) => [...text.matchAll(DELETE_CALL_RE)].map((m) => ({ fn: m[1], target: m[2] }));

describe('Mode B (opt-in data wipe) cleanup contract — installer/studix.iss', () => {
  it('1. the wipe branch deletes pgdata, config and logs trees (unchanged contract)', () => {
    const targets = deletionTargets(wipeBranch());
    for (const dir of ['pgdata', 'config', 'logs']) {
      expect(targets).toContainEqual({ fn: 'DelTree', target: `{commonappdata}\\Studix\\${dir}` });
    }
  });

  it('2. the wipe branch deletes the legacy root-level pg-startup.log by its exact name', () => {
    const targets = deletionTargets(wipeBranch());
    expect(targets).toContainEqual({ fn: 'DeleteFile', target: '{commonappdata}\\Studix\\pg-startup.log' });
  });

  it('3. the legacy file is deleted ONLY in the wipe branch — Mode A (normal uninstall) never touches it', () => {
    const outsideWipe = CODE.replace(wipeBranch(), '');
    expect(outsideWipe).not.toMatch(/pg-startup\.log/);
  });

  it('4. every Mode B deletion target is one of the four known items — backups\\ is never targeted', () => {
    const targets = deletionTargets(wipeBranch()).map((t) => t.target);
    expect(targets.sort()).toEqual([
      '{commonappdata}\\Studix\\config',
      '{commonappdata}\\Studix\\logs',
      '{commonappdata}\\Studix\\pg-startup.log',
      '{commonappdata}\\Studix\\pgdata',
    ]);
    for (const t of targets) expect(t.toLowerCase()).not.toContain('backups');
  });

  it('5. nothing anywhere deletes the Studix data root itself, uses a wildcard under it, or targets backups\\', () => {
    const all = deletionTargets(CODE).map((t) => t.target);
    expect(all).not.toContain('{commonappdata}\\Studix');
    expect(all.filter((t) => t.includes('*'))).toEqual([]);
    expect(all.filter((t) => t.toLowerCase().includes('backups'))).toEqual([]);
    // [UninstallDelete] may only ever cover {app} (Program Files), never the data root.
    const section = CODE.match(/^\[UninstallDelete\]\s*$([\s\S]*?)^\[/m);
    expect(section).not.toBeNull();
    expect(section[1]).toMatch(/Name: "\{app\}"/);
    expect(section[1]).not.toMatch(/commonappdata/);
  });

  it('6. current provisioning still writes its startup log to %TEMP%, not the data root (unchanged)', () => {
    const provisioning = fs.readFileSync(path.join(REPO_ROOT, 'backend', 'src', 'db', 'postgresProvisioning.js'), 'utf8');
    expect(provisioning).toMatch(/path\.join\(os\.tmpdir\(\), 'studix-pg-startup\.log'\)/);
  });
});
