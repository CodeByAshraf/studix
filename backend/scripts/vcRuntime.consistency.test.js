// backend/scripts/vcRuntime.consistency.test.js
// ─────────────────────────────────────────────────────────────
// Installer B1 — the bundled PostgreSQL 18.6 binaries (initdb/pg_ctl/postgres/pg_dump/
// pg_restore/libpq, linked with MSVC 14.44) import vcruntime140.dll, vcruntime140_1.dll and
// msvcp140.dll, which are not part of Windows and not in the EDB binaries zip. The installer now
// ships Microsoft's pinned VC++ 2015-2022 x64 Redistributable and installs it before
// firstInstall.js can run any PostgreSQL binary.
//
// Pure text/structure assertions (no ISCC/Pascal Script execution in this repo's tooling — same
// approach as version.consistency.test.js / uninstallWipe.consistency.test.js). The real
// behaviour is validated by the clean-machine installer test; these pin the contract.
// ─────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, URL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, 'windows-runtime-dependencies.json'), 'utf8'));
const FETCH_SCRIPT = fs.readFileSync(path.join(__dirname, 'fetchWindowsRuntimeDependencies.js'), 'utf8');
const BUILD_SCRIPT = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'build-windows-runtime.ps1'), 'utf8');
const ISS = fs.readFileSync(path.join(REPO_ROOT, 'installer', 'studix.iss'), 'utf8');

// Code only — Pascal `//` comments and Inno `;` comment lines stripped.
const CODE = ISS.split(/\r?\n/)
  .filter((line) => !/^\s*;/.test(line))
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n');

function routineBody(header) {
  const start = CODE.indexOf(header);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = CODE.slice(start);
  const end = rest.search(/\nend;/);
  expect(end).toBeGreaterThan(0);
  return rest.slice(0, end);
}

// Established once (see the manifest's _verifiedNote): the aka.ms permalink's redirect target,
// downloaded, hashed with Get-FileHash and sha256sum (both agreed, and equal to the hash in
// Microsoft's own versioned URL), Authenticode "Valid" signed by CN=Microsoft Corporation,
// FileVersion 14.44.35211.0 — matching the 14.44 linker version of the bundled PostgreSQL.
const ESTABLISHED_VCREDIST_SHA256 = 'cc0ff0eb1dc3f5188ae6300faef32bf5beeba4bdd6e8e445a9184072096b713b';
const ESTABLISHED_VCREDIST_URL =
  'https://download.visualstudio.microsoft.com/download/pr/bd1c8d9d-ba95-4eee-bc6e-df1fcc876373/' +
  'CC0FF0EB1DC3F5188AE6300FAEF32BF5BEEBA4BDD6E8E445A9184072096B713B/VC_redist.x64.exe';

describe('manifest — pinned official Microsoft VC++ redistributable', () => {
  it('1. is pinned to a specific version, not the moving aka.ms "latest" permalink', () => {
    expect(MANIFEST.vcredist.version).toBe('14.44.35211');
    expect(MANIFEST.vcredist.url).toBe(ESTABLISHED_VCREDIST_URL);
    expect(MANIFEST.vcredist.url).not.toMatch(/aka\.ms/);
  });

  it('2. is downloaded over https from Microsoft\'s own download host only', () => {
    const u = new URL(MANIFEST.vcredist.url);
    expect(u.protocol).toBe('https:');
    expect(u.hostname).toBe('download.visualstudio.microsoft.com');
  });

  it('3. has the real, established SHA-256 (not a placeholder), equal to the hash in Microsoft\'s URL', () => {
    expect(MANIFEST.vcredist.sha256).toBe(ESTABLISHED_VCREDIST_SHA256);
    expect(MANIFEST.vcredist.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(MANIFEST.vcredist.url.toLowerCase()).toContain(`/${MANIFEST.vcredist.sha256}/`);
  });

  it('4. is placed next to nssm.exe in the runtime package, so the [Files] wildcard ships it', () => {
    expect(MANIFEST.vcredist.extractTo).toBe('tools/vc_redist.x64.exe');
    expect(ISS).toMatch(/Source: "\.\.\\release\\win-x64\\studix\\\*"; DestDir: "\{app\}"; Flags: recursesubdirs ignoreversion/);
  });
});

describe('build — fetched through the same verified path as PostgreSQL/NSSM', () => {
  it('5. fetchWindowsRuntimeDependencies.js fetches it with fetchAndVerify (SHA-256 gate) from the manifest', () => {
    expect(FETCH_SCRIPT).toMatch(/async function fetchVcRedist\(/);
    expect(FETCH_SCRIPT).toMatch(/const cfg = manifest\.vcredist;/);
    const body = FETCH_SCRIPT.slice(FETCH_SCRIPT.indexOf('async function fetchVcRedist('));
    expect(body.slice(0, body.indexOf('\n}\n'))).toMatch(/await fetchAndVerify\(\{\s*url: cfg\.url, expectedSha256: cfg\.sha256/);
    expect(FETCH_SCRIPT).toMatch(/\{ name: 'VC\+\+ runtime', run: \(\) => fetchVcRedist\(manifest, outDir, tmpDir\) \}/);
  });

  it('6. the build script fails if the verified redistributable is missing from the package', () => {
    expect(BUILD_SCRIPT).toMatch(/tools\\vc_redist\.x64\.exe/);
    expect(BUILD_SCRIPT).toMatch(/Fail ".*vc_redist\.x64\.exe/);
  });
});

describe('installer — VC++ runtime before firstInstall.js, fail-closed', () => {
  it('7. ssPostInstall runs EnsureVcRuntime first and only then RunFirstInstall', () => {
    const body = routineBody('procedure CurStepChanged(');
    const ensureAt = body.indexOf('EnsureVcRuntime()');
    const firstInstallAt = body.indexOf('RunFirstInstall()');
    expect(ensureAt).toBeGreaterThan(-1);
    expect(firstInstallAt).toBeGreaterThan(ensureAt);
    expect(body).toMatch(/if not EnsureVcRuntime\(\) then\s+Exit;/);
  });

  it('8. RunFirstInstall is called from nowhere else (no path around the gate)', () => {
    const calls = CODE.match(/^\s*RunFirstInstall\(\);/gm) || []; // call sites, not the declaration
    expect(calls).toHaveLength(1);
    expect(CODE).toMatch(/procedure RunFirstInstall\(\);/);
  });

  it('9. runs the bundled redistributable silently, without a reboot, and waits for it', () => {
    const body = routineBody('function EnsureVcRuntime(');
    expect(body).toMatch(/ExpandConstant\('\{app\}\\tools\\vc_redist\.x64\.exe'\)/);
    expect(body).toMatch(/'\/install \/quiet \/norestart/);
    expect(body).toMatch(/ewWaitUntilTerminated/);
  });

  it('10. already-installed (1638) and reboot-pending (3010) are success; anything else fails', () => {
    const body = routineBody('function EnsureVcRuntime(');
    expect(body).toMatch(/\(ResultCode <> 0\) and \(ResultCode <> 1638\) and \(ResultCode <> 3010\)/);
  });

  it('11. success also requires the three DLLs PostgreSQL imports to exist in 64-bit System32', () => {
    const body = routineBody('function VcRuntimeDllsPresent(');
    for (const dll of ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']) {
      expect(body).toContain(`{sys}\\${dll}`);
    }
    expect(routineBody('function EnsureVcRuntime(')).toMatch(/if not VcRuntimeDllsPresent\(\) then/);
    expect(ISS).toMatch(/ArchitecturesInstallIn64BitMode=x64compatible/); // {sys} = native System32
  });

  it('12. every failure branch reports an error and returns False (never falls through to True)', () => {
    const body = routineBody('function EnsureVcRuntime(');
    expect(body).toMatch(/^\s*Result := False;/m);
    const trueAssignments = body.match(/Result := True;/g) || [];
    expect(trueAssignments).toHaveLength(1);
    expect(body.lastIndexOf('Result := True;')).toBeGreaterThan(body.lastIndexOf('Exit;'));
    expect((body.match(/mbCriticalError/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});
