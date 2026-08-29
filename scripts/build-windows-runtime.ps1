# scripts/build-windows-runtime.ps1
#
# INSTALL-01 — assembles a self-contained Windows x64 production runtime folder for Studix:
# a portable node.exe + the backend runtime files (production dependencies only, correct
# Windows-native Prisma query engine) + the built frontend (dist/). The result is meant to be
# proof that Studix can run on a clean Windows machine without a global Node.js install, npm,
# Git, or any dev tooling — NOT an installer. It does not touch PostgreSQL, does not register
# any Windows service, does not write to %ProgramData%, and never contains secrets.
#
# Output: release\win-x64\studix\ (gitignored — rebuilt from scratch every run).
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/build-windows-runtime.ps1
#        Add -SkipSmokeTest to skip the smoke-test step (e.g. on a non-Windows CI runner —
#        every other step still requires Windows since it needs the Windows Prisma engine).

param(
    [switch]$SkipSmokeTest
)

$ErrorActionPreference = 'Stop'

function Fail($msg) {
    Write-Host "BUILD FAILED: $msg" -ForegroundColor Red
    exit 1
}

function Step($msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$OutDir   = Join-Path $RepoRoot 'release\win-x64\studix'
$Backend  = Join-Path $RepoRoot 'backend'

# ── 1. Prerequisite checks ───────────────────────────────────────────────────────────────
Step 'Checking prerequisites'

if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
    Fail "This script must run on Windows x64 (detected PROCESSOR_ARCHITECTURE=$env:PROCESSOR_ARCHITECTURE). The assembled Prisma engine must match the target platform."
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { Fail 'node.exe not found on PATH. The build machine needs a local Node.js install (the assembled OUTPUT will not).' }
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) { Fail 'npm not found on PATH.' }

if (-not (Test-Path (Join-Path $RepoRoot 'package.json'))) { Fail "Repo root not found at expected location: $RepoRoot" }
if (-not (Test-Path (Join-Path $Backend 'package.json')))  { Fail "backend/package.json not found." }
if (-not (Test-Path (Join-Path $Backend 'package-lock.json'))) { Fail "backend/package-lock.json not found — npm ci requires a committed lockfile." }

$prismaCli = Join-Path $Backend 'node_modules\prisma\build\index.js'
if (-not (Test-Path $prismaCli)) { Fail "Prisma CLI not found at $prismaCli — run 'npm install' in backend/ first." }

Write-Host "Repo root : $RepoRoot"
Write-Host "Node      : $($nodeCmd.Source) ($(node --version))"
Write-Host "npm       : $(npm --version)"

# ── 2. Clean output directory ────────────────────────────────────────────────────────────
Step "Preparing output directory: $OutDir"
if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutBackend = Join-Path $OutDir 'backend'
New-Item -ItemType Directory -Force -Path $OutBackend | Out-Null

# ── 3. Build the production frontend ─────────────────────────────────────────────────────
Step 'Building production frontend (vite build)'
Push-Location $RepoRoot
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { Fail 'npm run build (frontend) failed.' }
} finally {
    Pop-Location
}

$DistSrc = Join-Path $RepoRoot 'dist'
if (-not (Test-Path (Join-Path $DistSrc 'index.html'))) { Fail 'dist/index.html not found after build — frontend build did not produce expected output.' }

Step 'Copying dist/ into runtime package'
Copy-Item -Recurse -Force $DistSrc (Join-Path $OutDir 'dist')

# ── 4. Copy backend runtime source (excluding tests) ─────────────────────────────────────
Step 'Copying backend runtime source (src/, migrations/, prisma/, scripts/)'

function Copy-ExcludingTests($src, $dst) {
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    Get-ChildItem -Path $src -Recurse -File | Where-Object {
        $_.Name -notmatch '\.test\.js$' -and $_.Name -notmatch '\.integration\.test\.js$'
    } | ForEach-Object {
        $rel = $_.FullName.Substring($src.Length + 1)
        $target = Join-Path $dst $rel
        New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
        Copy-Item -Force $_.FullName $target
    }
}

# backend/src — excludes *.test.js/*.integration.test.js, and test-helpers/ (test-only, never
# imported by server.js's own runtime import graph).
Copy-ExcludingTests (Join-Path $Backend 'src') (Join-Path $OutBackend 'src')
$TestHelpersInOut = Join-Path $OutBackend 'src\test-helpers'
if (Test-Path $TestHelpersInOut) { Remove-Item -Recurse -Force $TestHelpersInOut }

# backend/migrations — required at runtime by migrationRunner.js (DEFAULT_MIGRATIONS_DIR).
Copy-Item -Recurse -Force (Join-Path $Backend 'migrations') (Join-Path $OutBackend 'migrations')

# backend/prisma — schema.prisma is needed to run `prisma generate` in step 6 below (not read
# by the app at runtime itself, but kept in the package for diagnostics/future bootstrap use,
# per "do not delete files merely to make the package smaller"). studix-schema.sql IS read at
# runtime by bootstrapDatabase.js on a fresh install.
Copy-Item -Recurse -Force (Join-Path $Backend 'prisma') (Join-Path $OutBackend 'prisma')

# backend/scripts — bootstrapDatabase.js/runMigrations.js/adminCreate.js are the only way to
# get a fresh install operational before INSTALL-04's first-run wizard exists. Excludes
# generateSchemaArtifact.js deliberately: a maintainer-only tool that regenerates
# studix-schema.sql from a live scratch DB via pg_dump — never invoked by the running app or
# by any installation step, out of place in a customer-facing runtime package.
New-Item -ItemType Directory -Force -Path (Join-Path $OutBackend 'scripts') | Out-Null
foreach ($f in @('bootstrapDatabase.js', 'runMigrations.js', 'adminCreate.js')) {
    Copy-Item -Force (Join-Path $Backend "scripts\$f") (Join-Path $OutBackend "scripts\$f")
}

# backend/package.json — not read at runtime (node is invoked directly on server.js, not via
# `npm start`), kept only for diagnostics/version reference.
Copy-Item -Force (Join-Path $Backend 'package.json') (Join-Path $OutBackend 'package.json')

# ── 5. Install production-only backend dependencies into the runtime package ─────────────
Step 'Installing production-only backend dependencies (npm ci --omit=dev)'
Copy-Item -Force (Join-Path $Backend 'package-lock.json') (Join-Path $OutBackend 'package-lock.json')

Push-Location $OutBackend
try {
    npm ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Fail 'npm ci --omit=dev failed in the assembled backend folder.' }
} finally {
    Pop-Location
}

# @prisma/client declares "prisma" (the maintainer-only CLI, backend's own devDependency) as
# an OPTIONAL peerDependency. npm auto-installs peer dependencies to satisfy that even under
# --omit=dev, so the CLI's full package (its own build/scripts/preinstall tooling, ~25-30 MB)
# ends up inside node_modules/ despite --omit=dev. The runtime never imports "prisma" — only
# "@prisma/client" (see backend/src/prisma.js) — and `prisma generate` in step 6 below is run
# via the main repo's OWN node_modules\prisma (see $prismaCli), not this package's copy. Strip
# it so it doesn't ship in the customer-facing package, matching the test-helpers removal above.
$PrismaCliInOut = Join-Path $OutBackend 'node_modules\prisma'
if (Test-Path $PrismaCliInOut) { Remove-Item -Recurse -Force $PrismaCliInOut }
if (Test-Path $PrismaCliInOut) { Fail "Failed to strip devDependency-only node_modules\prisma from the assembled package." }

# ── 6. Generate the Windows-native Prisma client into the runtime package ────────────────
Step 'Generating Prisma client (must produce the Windows-native query engine)'

# Run via the main repo's Prisma CLI, but with cwd set to the assembled backend folder, so
# the generated client (including its native query engine binary) is written into THIS
# package's own node_modules/.prisma/client — not the developer's — and is guaranteed to
# match the dependency versions actually shipped in this package (from npm ci above).
Push-Location $OutBackend
try {
    node $prismaCli generate --schema="$OutBackend\prisma\schema.prisma"
    if ($LASTEXITCODE -ne 0) { Fail 'prisma generate failed for the assembled runtime package.' }
} finally {
    Pop-Location
}

# ── 7. Verify the Windows-native engine is present (not "it generated successfully") ─────
Step 'Verifying Windows-native Prisma query engine'

$PrismaClientDir = Join-Path $OutBackend 'node_modules\.prisma\client'
if (-not (Test-Path $PrismaClientDir)) { Fail "node_modules\.prisma\client not found after generate." }

$engineFiles = Get-ChildItem $PrismaClientDir -File | Where-Object { $_.Name -match 'query_engine|libquery_engine' }
if ($engineFiles.Count -eq 0) { Fail "No Prisma query engine binary found in $PrismaClientDir." }

$windowsEngine = $engineFiles | Where-Object { $_.Name -match 'windows' }
if (-not $windowsEngine) {
    Fail "No Windows-native query engine found. Found instead: $($engineFiles.Name -join ', ')"
}
$nonWindowsEngine = $engineFiles | Where-Object { $_.Name -notmatch 'windows' }
if ($nonWindowsEngine) {
    Fail "Non-Windows engine binaries were bundled unexpectedly: $($nonWindowsEngine.Name -join ', ')"
}
Write-Host "Windows-native engine present: $($windowsEngine.Name) ($([math]::Round($windowsEngine.Length/1MB, 1)) MB)" -ForegroundColor Green

# Prove it actually loads (not just "the file exists") by instantiating PrismaClient — this
# loads the native addon into a real Node process; a platform/arch mismatch throws here
# immediately. No DB connection is attempted (no query is run).
$verifyScript = @'
import { PrismaClient } from "@prisma/client";
try {
  const prisma = new PrismaClient();
  console.log("PRISMA_CLIENT_OK");
  process.exit(0);
} catch (err) {
  console.error("PRISMA_CLIENT_FAILED: " + err.message);
  process.exit(1);
}
'@
$verifyPath = Join-Path $OutBackend '_verify_prisma_client.mjs'
Set-Content -Path $verifyPath -Value $verifyScript -Encoding UTF8

Push-Location $OutBackend
try {
    $result = node $verifyPath 2>&1
    Remove-Item -Force $verifyPath
    if ($LASTEXITCODE -ne 0 -or $result -notmatch 'PRISMA_CLIENT_OK') {
        Fail "PrismaClient failed to instantiate from the assembled package: $result"
    }
    Write-Host "PrismaClient instantiates correctly from the assembled node_modules." -ForegroundColor Green
} finally {
    Pop-Location
}

# ── 8. Bundle a portable node.exe ─────────────────────────────────────────────────────────
Step 'Bundling portable node.exe'
$NodeOutDir = Join-Path $OutDir 'node'
New-Item -ItemType Directory -Force -Path $NodeOutDir | Out-Null
Copy-Item -Force $nodeCmd.Source (Join-Path $NodeOutDir 'node.exe')

$bundledVersion = & (Join-Path $NodeOutDir 'node.exe') --version
Write-Host "Bundled node.exe reports: $bundledVersion"

# ── 9. Portability scan — no developer-machine paths baked into the package ──────────────
# Note: `prisma generate` embeds the absolute cwd it was run from as diagnostic DMMF metadata
# (a "sourceFilePath"/config value) into node_modules/.prisma/client/{index,edge}.js — always,
# for every Prisma project, regardless of platform. Since step 6 runs generate with cwd set to
# THIS package's own backend folder, what gets embedded is the package's OWN location — not
# the developer's original repo checkout, and not read at runtime (engine resolution uses
# __dirname-relative paths, not this field). Verified empirically: an assembled package copied
# to an unrelated path (outside the repo entirely) still instantiates PrismaClient correctly —
# see the relocation check right after this scan. So a match is only a real problem if it
# points OUTSIDE this package's own output directory (e.g. back into backend/src, or some other
# developer-machine location) — that would mean a real leak (e.g. a sourcemap referencing the
# dev source tree). Matches fully contained within $OutDir itself are the expected, harmless,
# self-referential case and are not failures.
Step 'Scanning assembled package for developer-machine paths'

$forbiddenPatterns = @(
    [regex]::Escape($env:USERPROFILE),
    'C:\\Users\\[^\\]+\\',
    'OneDrive'
)
$textExtensions = @('.js', '.mjs', '.json', '.html', '.map', '.css', '.sql', '.md')
$outDirEscaped = [regex]::Escape($OutDir)
$offenders = @()
Get-ChildItem -Path $OutDir -Recurse -File | Where-Object { $textExtensions -contains $_.Extension } | ForEach-Object {
    $content = Get-Content -Raw -LiteralPath $_.FullName -ErrorAction SilentlyContinue
    if ($null -eq $content) { return }
    foreach ($pattern in $forbiddenPatterns) {
        $regexMatches = [regex]::Matches($content, $pattern)
        foreach ($m in $regexMatches) {
            # Look at a window around the match to see whether the actual path it's part of
            # falls inside $OutDir (self-reference, allowed) or points elsewhere (real leak).
            $windowStart = [math]::Max(0, $m.Index - 20)
            $windowLen = [math]::Min(400, $content.Length - $windowStart)
            $window = $content.Substring($windowStart, $windowLen)
            if ($window -notmatch $outDirEscaped) {
                $offenders += "$($_.FullName)  (matched: '$($m.Value)', context: $($window.Substring(0, [math]::Min(120, $window.Length))))"
            }
        }
    }
}
if ($offenders.Count -gt 0) {
    Write-Host "Developer-machine paths found (outside this package's own output dir) in:" -ForegroundColor Red
    $offenders | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    Fail "Assembled package is not portable — see paths above."
}
Write-Host "No developer-machine paths found in scanned text/JS/JSON/HTML/SQL files (outside the package's own self-referential build metadata)." -ForegroundColor Green

# ── 9b. Relocation check — physically prove the package is portable, not just grep for it ──
Step 'Relocating a copy of the package and re-verifying PrismaClient from the new path'
$relocatedDir = Join-Path $env:TEMP "studix-relocation-check-$([guid]::NewGuid())"
Copy-Item -Recurse -Force $OutDir $relocatedDir
try {
    $relocVerifyPath = Join-Path "$relocatedDir\backend" '_verify_relocated.mjs'
    Set-Content -Path $relocVerifyPath -Value $verifyScript -Encoding UTF8
    Push-Location "$relocatedDir\backend"
    try {
        $relocResult = & "$relocatedDir\node\node.exe" $relocVerifyPath 2>&1
        if ($LASTEXITCODE -ne 0 -or $relocResult -notmatch 'PRISMA_CLIENT_OK') {
            Fail "PrismaClient failed to instantiate after relocating the package to a different absolute path: $relocResult"
        }
        Write-Host "Relocated package (at a different absolute path) still instantiates PrismaClient correctly." -ForegroundColor Green
    } finally {
        Pop-Location
    }
} finally {
    Remove-Item -Recurse -Force $relocatedDir -ErrorAction SilentlyContinue
}

# ── 10. Runtime smoke test — run the ASSEMBLED package, not the source tree ──────────────
if ($SkipSmokeTest) {
    Write-Host ""
    Write-Host "Skipping smoke test (-SkipSmokeTest passed)." -ForegroundColor Yellow
} else {
    Step 'Smoke-testing the assembled runtime package'

    # Never touches a real database, never writes to %ProgramData%. STUDIX_CONFIG_PATH points
    # at a throwaway .env in the OS temp dir so lib/config.js's existing override mechanism is
    # used instead of the default %ProgramData%\Studix\config\.env path.
    $smokeEnvPath = Join-Path $env:TEMP "studix-smoketest-$([guid]::NewGuid()).env"
    $smokePort = 39217
    @"
DATABASE_URL=postgresql://studix_smoketest:x@127.0.0.1:1/studix_smoketest
SESSION_SECRET=smoketest-only-not-a-real-secret-0123456789abcdef
PORT=$smokePort
FRONTEND_ORIGIN=http://localhost:$smokePort
"@ | Set-Content -Path $smokeEnvPath -Encoding UTF8

    $env:STUDIX_CONFIG_PATH = $smokeEnvPath

    # Uses System.Diagnostics.Process directly (rather than Start-Process -RedirectStandard*)
    # for reliable async output capture with a hard timeout — avoids depending on PowerShell
    # console/file redirection edge cases for a subprocess that is expected to exit quickly on
    # its own anyway (server.js calls process.exit(1) on a migration/DB failure).
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = Join-Path $NodeOutDir 'node.exe'
    $psi.Arguments = '"' + (Join-Path $OutBackend 'src\server.js') + '"'
    $psi.WorkingDirectory = $OutDir
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true

    $outBuf = New-Object System.Text.StringBuilder
    $errBuf = New-Object System.Text.StringBuilder
    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    $stdoutAction = { if ($null -ne $Event.SourceEventArgs.Data) { $Event.MessageData.AppendLine($Event.SourceEventArgs.Data) | Out-Null } }
    $stdoutEvent = Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action $stdoutAction -MessageData $outBuf
    $stderrEvent = Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action $stdoutAction -MessageData $errBuf

    $proc.Start() | Out-Null
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()
    $exited = $proc.WaitForExit(10000)
    if (-not $exited) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        $proc.WaitForExit(3000) | Out-Null
    }
    Unregister-Event -SourceIdentifier $stdoutEvent.Name -ErrorAction SilentlyContinue
    Unregister-Event -SourceIdentifier $stderrEvent.Name -ErrorAction SilentlyContinue

    Remove-Item -Force $smokeEnvPath -ErrorAction SilentlyContinue
    Remove-Item Env:\STUDIX_CONFIG_PATH -ErrorAction SilentlyContinue

    $combined = "$($outBuf.ToString())`n$($errBuf.ToString())"

    $badSignals = @('Cannot find module', 'MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND',
                     'query engine', 'libquery_engine', 'was compiled against a different Node.js version',
                     'is not recognized as an internal or external command')
    $foundBad = $badSignals | Where-Object { $combined -match [regex]::Escape($_) }

    # Expected-safe stopping points: a syntactically valid but unreachable DATABASE_URL should
    # surface as a connection failure surfaced through describeStartupFailure/runMigrations,
    # which is exactly the "acceptable" stop condition the audit spec calls for. Matched in
    # English only (Prisma's own connection-refused message, plus the process's own exit
    # code) to avoid any source-encoding fragility with the app's Arabic log text.
    $reachedExpectedStop = ($combined -match 'ECONNREFUSED') -or
                            ($combined -match "Can.t reach database") -or
                            ($combined -match 'connect ETIMEDOUT') -or
                            ($proc.ExitCode -eq 1)

    if ($foundBad) {
        Fail "Smoke test hit a packaging defect (not an expected config/DB stop): $($foundBad -join ', ')`n--- output ---`n$combined"
    }
    if (-not $reachedExpectedStop) {
        Fail "Smoke test did not reach the expected database-connection stopping point. Full output:`n$combined"
    }
    Write-Host "Smoke test OK — process started, all imports/engine resolved, stopped at the expected DB-connection check (no real DB used)." -ForegroundColor Green
}

# ── Done ───────────────────────────────────────────────────────────────────────────────────
Step 'Build complete'
$sizeBytes = (Get-ChildItem -Recurse -File $OutDir | Measure-Object -Property Length -Sum).Sum
Write-Host "Runtime package: $OutDir"
Write-Host ("Total size: {0:N1} MB" -f ($sizeBytes / 1MB))

