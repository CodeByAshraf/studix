// backend/scripts/version.consistency.test.js
// ─────────────────────────────────────────────────────────────
// New-installer Phase 1 — single version source of truth. Guards against the three-way manual
// version sync (backend/package.json / installer/studix.iss / scripts/build-windows-runtime.ps1)
// silently reappearing: backend/package.json is the one authoritative version, studix.iss must
// consume it via #include (never a second hardcoded #define MyAppVersion literal), and the
// build script must be the one place that reads backend/package.json and writes the generated
// include — so the build-side and installer-side versions can never diverge.
//
// Pure text/structure assertions on the actual files — no PowerShell/Inno Setup execution (this
// repo has no Pester/ISCC tooling to run either), consistent with "prepare the version handoff
// cleanly" rather than inventing a new build/test pipeline for this phase.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..'); // backend/scripts -> backend -> repo root

function read(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

describe('version single-source-of-truth (new-installer Phase 1)', () => {
  it('1. backend/package.json has a valid, readable X.Y.Z version — the authoritative source', () => {
    const pkg = JSON.parse(read('backend/package.json'));
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('2. installer/studix.iss no longer hardcodes a second MyAppVersion literal', () => {
    const iss = read('installer/studix.iss');
    expect(iss).not.toMatch(/#define\s+MyAppVersion\s+"/);
  });

  it('3. installer/studix.iss includes the generated version file instead, before AppVersion is used', () => {
    const iss = read('installer/studix.iss');
    const includeIndex = iss.indexOf('#include "version.generated.iss"');
    const useIndex = iss.indexOf('AppVersion={#MyAppVersion}');
    expect(includeIndex).toBeGreaterThan(-1);
    expect(useIndex).toBeGreaterThan(-1);
    expect(includeIndex).toBeLessThan(useIndex);
  });

  it('4. AppId is unchanged — Phase 1 must never touch it', () => {
    const iss = read('installer/studix.iss');
    expect(iss).toContain('AppId={{BE518660-3EBF-4DFF-BDF0-87E8052CE2E6}');
  });

  it('5. build-windows-runtime.ps1 reads backend/package.json as the version source and writes the generated include the installer consumes', () => {
    const ps1 = read('scripts/build-windows-runtime.ps1');
    expect(ps1).toMatch(/Join-Path\s+\$Backend\s+'package\.json'/);
    expect(ps1).toContain('installer\\version.generated.iss');
    expect(ps1).toMatch(/#define MyAppVersion/);
  });

  it('6. the build script fails clearly on a missing/invalid version, never silently falling back to another value', () => {
    const ps1 = read('scripts/build-windows-runtime.ps1');
    const versionSection = ps1.slice(
      ps1.indexOf('$AppVersion = $BackendPackageJson.version'),
      ps1.indexOf('$VersionIncludePath'),
    );
    expect(versionSection).toContain('IsNullOrWhiteSpace($AppVersion)');
    expect(versionSection).toContain("-notmatch '^\\d+\\.\\d+\\.\\d+$'");
    // PowerShell calls Fail without parentheses ("Fail "message""), not Fail(...).
    expect((versionSection.match(/Fail\s+"/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('7. the generated version-include file is gitignored — never committed, always regenerated at build time', () => {
    const gitignore = read('.gitignore');
    expect(gitignore).toContain('installer/version.generated.iss');
  });
});

// New-installer Phase 4 audit fix — closes the exact gap the final pre-build audit found:
// manageScheduledTask.js (installer/studix.iss's BestEffortRemoveScheduledTask() Exec()s it at
// uninstall time to remove Phase 3's StudixStartupOrchestrator Scheduled Task) was added to
// backend/scripts/ but never added to build-windows-runtime.ps1's explicit backend/scripts
// packaging allowlist, so a real build would silently ship without it and Phase 4's uninstall
// cleanup would be permanently inert. Pure text assertion — no PowerShell/Windows build execution.
describe('backend/scripts packaging allowlist (new-installer Phase 4)', () => {
  it('build-windows-runtime.ps1 packages manageScheduledTask.js alongside every other Exec()-target script', () => {
    const ps1 = read('scripts/build-windows-runtime.ps1');
    const allowlistMatch = ps1.match(/foreach \(\$f in @\(([^)]*)\)\)/);
    expect(allowlistMatch).not.toBeNull();
    const allowlist = allowlistMatch[1];
    expect(allowlist).toContain("'manageScheduledTask.js'");
    // Also present alongside its Phase-3-era sibling, confirming this is the same allowlist that
    // already ships manageWindowsServices.js — never a second, independent packaging list.
    expect(allowlist).toContain("'manageWindowsServices.js'");
  });
});
