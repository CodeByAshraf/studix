# INSTALL-06 — Windows Installer & Binary Acquisition: Design/Implementation Report

Scope: the Inno Setup installer, the first-install/upgrade orchestrator, and build-time
acquisition of the PostgreSQL and NSSM binaries that INSTALL-03/05 already defined the runtime
contract for but never vendored. Reuses INSTALL-01 through INSTALL-05 exactly as committed —
`server.js`, `shutdown.js`, `logger.js`, `postgresProvisioning.js`, `firstAdmin.js`, `setup.js`,
`windowsService.js`, schema, and migrations are all byte-for-byte untouched by this phase.

## 1. Installer technology

**Inno Setup**, pinned to **6.4.3** — already the assumed technology in already-committed code
(`lib/productionConfig.js`'s and the INSTALL-03 design doc's own comments name it explicitly,
before this phase started), and 6.4.3 is the last version before JRSoftware's optional
commercial-license request introduced in 6.5.0 (verified by reading the actual Inno Setup
License text: fully free for commercial use at *any* version, no legal payment obligation — the
6.5.0+ request is a business courtesy ask, not a license term). Pinning 6.4.3 avoids that
question entirely rather than making a business decision on your behalf.

## 2. Runtime dependency layout (as approved)

```
release\win-x64\studix\        (INSTALL-01 output, unchanged)
├─ node\node.exe
├─ backend\...
├─ dist\...
├─ pgsql\                       (INSTALL-03's existing contract — unchanged)
│  └─ bin\{postgres,initdb,pg_ctl,pg_isready,psql}.exe, lib\, share\
└─ tools\
   └─ nssm.exe                  (NEW — decision #3)
```

`backend/src/installer/firstInstall.js` pins `nssmPath` explicitly to
`<installRoot>\tools\nssm.exe` when calling `registerAppService()` — **never** the bare
`"nssm.exe"` PATH-lookup default `windowsService.js` otherwise falls back to — so the
orchestrator never depends on a globally installed NSSM, exactly per decision #3.

## 3. Binary acquisition — versions, source, checksum policy

| | PostgreSQL | NSSM |
|---|---|---|
| Pinned version | **18.6** | **2.24-101-g897c7ad** |
| Why this exact build | Current 18.x point release (matches INSTALL-03's major-version pin) | The `2.24-101` pre-release fixes a real, documented service-startup failure on Windows 10 Creators Update+ that the older "stable" 2.24 (2014) has — this is the build the community/package managers actually use for modern Windows |
| Source | `https://www.enterprisedb.com/download-postgresql-binaries` (landing page confirmed real; blocked to automated fetch — the exact direct-download URL must be confirmed by hand, see §4) | `https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip` (confirmed via research) |
| License | PostgreSQL License (permissive, redistribution in closed-source products explicitly allowed) | Public domain |
| Architecture | Windows x86-64 | Windows x64 (`win64\nssm.exe` extracted from the zip, which also contains an unused `win32\` build) |
| Checksum | **Not officially published by EDB for this archive** (verified during the audit) — self-established, see §4 | **Not officially published by nssm.cc** — self-established, see §4 |
| Committed to git? | **No** | **No** |
| Acquired | Build time, by `backend/scripts/fetchWindowsRuntimeDependencies.js` | Build time, same script |

## 4. The one-time manual checksum-establishment process (not yet performed)

Per decision #8, this session did **not** invent, guess, or fetch-and-silently-accept a
checksum — `backend/scripts/windows-runtime-dependencies.json` ships with the literal
placeholder string `"REPLACE_WITH_MANUALLY_VERIFIED_SHA256_BEFORE_USE"` for both `sha256`
fields, and `src/installer/fetchDependencies.js`'s `verifyChecksum()` refuses to proceed against
that placeholder — loudly, with a distinct `checksum_not_pinned` error, never silently treating
it as "verified." Before this script can be used for a real build, a human must:

1. Visit `https://www.enterprisedb.com/download-postgresql-binaries`, select PostgreSQL **18.6**
   Windows x86-64 binaries, and note the exact resulting download URL (the filename pattern is
   confirmed — `postgresql-18.6-<build>-windows-x64-binaries.zip` — but EDB's exact build-suffix
   for this specific version needs a human to actually load the page, which was blocked to
   automated fetching both during the INSTALL-03 and INSTALL-06 audits).
2. Download it, sanity-check it (file size in the expected ~300MB range, `bin\postgres.exe
   --version` reports 18.6, a virus scan comes back clean).
3. Compute its SHA256 (e.g. `Get-FileHash -Algorithm SHA256`) and record both the confirmed URL
   and the hash into `windows-runtime-dependencies.json`'s `postgresql.url`/`postgresql.sha256`.
4. Repeat steps 2–3 for `https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip` (URL already confirmed),
   recording the hash into `nssm.sha256`.

From that point on, every future build (this developer's machine, CI, another contributor)
verifies against these two **self-established, committed, trusted** hashes automatically — this
is the standard, correct pattern when upstream doesn't publish an official one.

## 5. Orchestrator (`backend/src/installer/firstInstall.js`)

Implements decision #10's exact contract, reusing every step from already-committed code:

```
provisionPostgres()                                                    (INSTALL-03)
  -> if status === 'initialized': ensureProductionConfig({ databaseUrl })   (INSTALL-02)
  -> loadEnvConfig() + validateDatabaseUrl()            (lib/config.js, lib/startupErrors.js)
  -> bootstrapDatabase({ schemaPath })                          (existing, pre-INSTALL-01)
  -> stopPostgres()                                                    (INSTALL-03)
  -> registerPostgresService() + startService(StudixPostgreSQL)        (INSTALL-05)
  -> registerAppService({ nssmPath: <installRoot>\tools\nssm.exe })
     + startService(StudixApp)                                        (INSTALL-05)
  -> poll GET http://127.0.0.1:<port>/health until 200
  -> open the default browser to http://localhost:<port>/  (best-effort, non-fatal on failure)
```

**Why `runMigrations()` isn't a separate step**: tracing `db/bootstrapDatabase.js`'s own script
wrapper (`scripts/bootstrapDatabase.js`) shows it already chains schema bootstrap +
`runMigrations()` in one call — and `server.js` *also* runs `runMigrations()` itself on every
boot, including the app service's very first start. A separate explicit migration step in the
orchestrator would be redundant with both.

**Idempotency, traced, not assumed** (why the exact same sequence is safe on every re-run):
`provisionPostgres()` never re-`initdb`s an initialized data directory and only returns a
`databaseUrl` on a genuinely fresh init, so `ensureProductionConfig` is skipped entirely on
every subsequent run — an existing `SESSION_SECRET`/`DATABASE_URL` is never touched (verified by
`ensureProductionConfig`'s own committed test asserting zero filesystem writes on that path).
`bootstrapDatabase()` is a no-op on an already-schema'd database. `register*Service()` verify an
existing registration's actual configuration before trusting it, and fail closed (never
overwrite) on a mismatch. Nothing in this chain ever writes to `users`, so first-admin/`/setup`
state is untouched (decision #12).

**`stopPostgres()` runs unconditionally, every time** (fresh install *and* every re-run) per the
approved contract — this is intentional, not an oversight: `provisionPostgres()` guarantees
PostgreSQL is running (ad-hoc-started or already running) by the time it returns successfully,
regardless of path, so there is always something to stop. On a re-run this produces a brief
Postgres restart via the SCM (stop, then `registerPostgresService` no-ops since already
registered, then `startService` restarts it) — harmless, and actually desirable on an upgrade
where `pgsql\bin\*.exe` may have just been overwritten by Inno Setup's file-copy phase.

**Failure handling**: each step is wrapped so a failure throws `FirstInstallError` with a
machine-readable `.step` and stops immediately — no later step runs. No custom rollback of
already-completed steps is attempted (decision #11) — every step is independently safe to
re-run, so re-invoking the installer (or `firstInstall.js` directly) always safely resumes.

**Browser-open failure is the one non-fatal step**: by the time `/health` returns 200, the
actual installation has already succeeded (both services registered, running, confirmed
healthy) — failing to auto-open a browser (no default browser configured, etc.) is reported in
the result (`browserOpened: false`) but does not flip an otherwise-successful install into a
reported failure. This is a deliberate implementation choice within decision #10's contract
(which specifies opening the browser as the last step without specifying its failure semantics),
not a deviation from anything explicitly approved.

## 6. Inno Setup script (`installer/studix.iss`) — mechanics only, per decision #1

- `[Setup]`: `PrivilegesRequired=admin`, `DefaultDirName={autopf}\Studix`. `AppId` is a
  **placeholder GUID that must be replaced with a real, permanently-fixed one** before any real
  release — Inno Setup's upgrade detection is keyed on it.
- `[Dirs]`: **one** entry, `{commonappdata}\Studix` with `Permissions: admins-full
  system-full` — see §7 for why this single entry covers the entire tree.
- `[Files]`: packages the already-assembled, already-dependency-fetched
  `release\win-x64\studix\*` wholesale — this script never itself runs npm/vite/prisma/binary
  downloads.
- `[Code]`: **one** `Exec()` call (`CurStepChanged` at `ssPostInstall`) running
  `node.exe backend\scripts\firstInstall.js` — no chain of separate CLI commands in Pascal
  Script, per decision #1. A non-zero exit code shows a clear message pointing at safe re-run,
  never attempts custom rollback (decision #11 mirrored here).
- **No `[UninstallDelete]` entry for `{commonappdata}\Studix`, and no Pascal Script code ever
  references it during uninstall** — the simplest, safest implementation of "never delete
  ProgramData" (decision #5) is to never mention it in any uninstall-time code path at all.
  Inno Setup's built-in uninstaller only ever removes what it tracked installing under `{app}`.

**Compilation status: unverified in this session.** Inno Setup's compiler (`ISCC.exe`) is
confirmed not installed in this environment; per decision #6, this phase did not install it.
Written against documented, standard Inno Setup 6.x syntax, but has not been compiled or run.

## 7. Security model

| Concern | Design |
|---|---|
| Elevation | `PrivilegesRequired=admin` — required for Program Files + service registration |
| Argument injection / quoting | The orchestrator is a single `Exec()` call with two clean arguments (node.exe, one script path) — no ad-hoc command-string composition in Pascal Script. Every downstream call (`windowsService.js`, `postgresProvisioning.js`) already uses array-form `execFileSync` (verified in INSTALL-05) — no shell involved anywhere in this chain |
| Untrusted install paths | `resolveInstallRoot()` (INSTALL-05, unchanged) already supports an arbitrary install root; `firstInstall.js` and the `.iss` script both pass the actual `{app}` through rather than assuming a hardcoded path |
| **ProgramData ACL** (decision #4) | `[Dirs]` `Permissions: admins-full system-full` on `{commonappdata}\Studix` itself — NTFS ACL inheritance covers every subdirectory the running app creates later (`pgdata\`, `logs\`, `backups\`, `config\`) automatically, since none of those `fs.mkdirSync` calls set an explicit ACL of their own. Both services run as LocalSystem (unchanged default), which is unaffected by this restriction — only ordinary interactive users are denied access |
| Malicious/replaced binaries | Pinned SHA256 verification (§3/§4) — a tampered download is rejected before extraction, before it can ever reach a shipped installer |
| Service hijacking/path substitution | Already solved by `windowsService.js`'s verify-before-trust discipline (INSTALL-05) — reused, not duplicated |
| Partial installation | Idempotency-first recovery (§5/§11) |
| Code-signing | **Deferred, out of scope** — needs a purchased certificate; affects SmartScreen warnings, not functional correctness |

## 8. Upgrade/reinstall behavior

Traced in §5: the *same* orchestrator run is already correct for both fresh installs and
upgrades, by construction of every reused primitive's own idempotency. The one thing this phase
adds beyond the orchestrator: Inno Setup's own `AppId`-based upgrade detection lets the same
installer `.exe` (a new version) recognize an existing install and reuse its chosen directory —
standard Inno Setup behavior, no custom code needed. **Deferred, not solved here**: stopping the
`StudixApp`/`StudixPostgreSQL` services *before* the `[Files]` copy phase overwrites their
binaries on an in-place upgrade (needed so Windows doesn't refuse to overwrite locked
`.exe`/`.dll` files) — a real concern identified but not yet implemented; `[Code]`'s
`CurStepChanged(ssInstall)` handler would be the natural place, left for the next iteration once
real elevated verification is possible.

## 9. Uninstall policy (decision #5, implemented as designed)

**Default uninstall never deletes `%ProgramData%\Studix\`** — config (`SESSION_SECRET`,
`DATABASE_URL`), `pgdata` (the actual customer database), `logs\`, and `backups\` are all
preserved. Implemented by omission, not by a compensating check: no `[UninstallDelete]` entry
and no uninstall-time Pascal Script code ever names that path. A future explicit "wipe all
Studix data" utility, if ever wanted, is a distinct, clearly-labeled opt-in feature — out of
INSTALL-06's scope.

## 10. Failure/rollback philosophy (decision #11)

No custom rollback transaction across services/filesystem/database is implemented or planned.
Every step in `firstInstall.js` is independently idempotent (traced in §5); on any failure, the
orchestrator stops immediately with a clear, machine-readable `.step`, and the `.iss` script
surfaces this to the operator with an explicit "safe to re-run" message. Re-running the
installer (or `firstInstall.js` directly) always safely resumes.

## 11. Testing — what was and wasn't done, and why

| Layer | Status |
|---|---|
| Orchestrator sequencing/branching (`firstInstall.js`) | **36 automated unit tests, DI-based** — call order, the fresh-vs-existing-install branch, every step's failure propagating the correct `.step`, health-timeout handling, browser-open-failure-is-non-fatal. Zero real PostgreSQL/services/network/browser |
| Checksum verify/mismatch, download, extraction (`fetchDependencies.js`) | **14 automated unit tests, DI-based** — placeholder rejection, real-hash-math correctness (genuine `crypto.createHash`), mismatch rejection with cleanup, `tar -xf` argv construction. Zero real network download, zero real `tar.exe` invocation |
| CLI argument/usage handling (`firstInstall.js`, `fetchWindowsRuntimeDependencies.js`) | Manually smoke-tested for real in this session — both correctly print usage and exit 1 with no arguments, with zero network/service calls attempted |
| `.iss` compilation | **Not verified** — `ISCC.exe` not installed in this environment; not installed during this phase per decision #6 |
| Real binary download + checksum establishment | **Not performed** — deliberately deferred to the one-time manual process (§4), never attempted with a placeholder/guessed hash |
| Real elevated install (services, Program Files, ProgramData, uninstall) | **Not performed** — no Administrator privileges in this session (reconfirmed); per decision #6, not attempted even if privileges existed. Recommended as a future manual step on a disposable VM |

## 12. Known, documented limitation carried forward from the audit

**Studix's own HTTP port (`server.js`'s `process.env.PORT \|\| 4000`) has no dynamic-fallback
mechanism** the way PostgreSQL's port does. Per decision #7, `server.js` is unmodified and no
installer-side dynamic-port workaround was introduced in this phase. If port 4000 happens to be
occupied on a target machine, the `StudixApp` service will fail closed (existing, unmodified
`server.js` behavior) and NSSM will retry it per its configured restart policy — the existing
`PORT` environment variable in the production config file (`%ProgramData%\Studix\config\.env`)
remains the supported manual escape hatch, unchanged.

## 13. Exact files changed/created

**New:**
- `backend/src/installer/firstInstall.js`, `firstInstall.test.js`
- `backend/src/installer/fetchDependencies.js`, `fetchDependencies.test.js`
- `backend/scripts/firstInstall.js`
- `backend/scripts/fetchWindowsRuntimeDependencies.js`
- `backend/scripts/windows-runtime-dependencies.json`
- `installer/studix.iss`
- This report.

**Modified (minimal, each individually justified above):**
- `scripts/build-windows-runtime.ps1` — new `-SkipDependencyFetch`-guarded step + one whitelist
  addition (`firstInstall.js`, needed at real install time; `fetchWindowsRuntimeDependencies.js`
  deliberately excluded, build-time only — same reasoning as the existing
  `generateSchemaArtifact.js` exclusion).
- `.gitignore` — one addition, `installer/Output/` (Inno Setup's compiled `.exe` output),
  mirroring the existing `release/` entry.

**Not modified**: `server.js`, `shutdown.js`, `logger.js`, `postgresProvisioning.js`,
`firstAdmin.js`, `setup.js`, `windowsService.js`, schema, migrations, licensing code.
