# INSTALL-07 — Upgrade Safety (Pre-Copy Service Stop): Design/Implementation Report

## Scope

Exactly one gap, traced (not assumed) from already-committed text: INSTALL-06's own design
doc explicitly flagged *"stopping the StudixApp/StudixPostgreSQL services before the [Files]
copy phase overwrites their binaries on an in-place upgrade... a real concern identified but
not yet implemented."* No other file in the repository mentions `INSTALL-07`, `INSTALL-08`, or
`INSTALL-09` anywhere — this scope was confirmed with you directly (via a clarifying question)
rather than inferred silently, given the genuine ambiguity.

## The gap

Windows generally refuses to overwrite an executable file (`.exe`/`.dll`) that a running
process still has open. `installer/studix.iss` (INSTALL-06) already handles *starting* both
services after installation (`RunFirstInstall()` at `ssPostInstall`, via `firstInstall.js`'s
already-approved, unchanged orchestration) but had no logic to *stop* them first on an
in-place upgrade — meaning `[Files]`'s copy of a new `node.exe`/`postgres.exe`/`pg_ctl.exe`/
`nssm.exe` over an already-running previous version could fail outright.

## Design

- **New Pascal Script only, in the same already-INSTALL-06-owned file
  (`installer/studix.iss`)** — no INSTALL-01 through INSTALL-06 code was touched.
- **Reuses `backend/scripts/manageWindowsServices.js` (INSTALL-05) verbatim**, via `Exec()` —
  no service-stop logic is reimplemented in Pascal Script, matching decision #1's "keep Pascal
  Script minimal, reuse the Node-side tooling" principle exactly, the same principle
  `RunFirstInstall()` already follows for the orchestrator.
- **Hooked at `PrepareToInstall`** — the correct Inno Setup lifecycle point that runs after the
  user confirms installation but strictly *before* `[Files]` copies anything. What gets
  executed here is genuinely the *previous* version's own `node.exe`/`manageWindowsServices.js`
  (the new version's files don't exist on disk yet at this point).
- **Fresh-install detection is a plain file-existence check** (`FileExists` on the target's own
  `manageWindowsServices.js`) — if nothing was previously installed there, the step is skipped
  entirely; no reliance on Inno's registry-based upgrade-detection idioms.
- **Best-effort, never fatal to Setup**: `PrepareToInstall` always returns `''` (success)
  regardless of the stop attempts' outcome. This is deliberate, not an oversight — a fresh
  install has nothing registered yet (`manageWindowsServices.js`'s own `stop` action already
  exits non-zero with reason `not_registered` for exactly this case, an expected, common
  outcome this step must not treat as an error), and even a genuine stop failure for some other
  reason doesn't need to block Setup here: the real safety net remains `firstInstall.js`'s own
  unchanged, already-approved fail-closed register+start sequence at `ssPostInstall`, which
  always runs after file copy and will surface a clear, already-well-designed error if
  something is still genuinely wrong. This step is a head start that reduces the likelihood of
  a locked-file copy failure, not the final correctness gate.
- **Order**: app stopped before Postgres (the app depends on Postgres, matching
  `windowsService.js`'s existing `DependOnService` configuration direction), reversed
  implicitly on restart since `firstInstall.js` already registers/starts Postgres before the
  app.

## What was explicitly NOT done

- No changes to `manageWindowsServices.js`, `windowsService.js`, `firstInstall.js`, or any
  other INSTALL-01–06 file — confirmed via `git status` (see below).
- No new automated test infrastructure for Pascal Script — this project has no Pascal Script
  test infrastructure anywhere, and building one for a ~15-line addition would be
  disproportionate; verified instead by careful manual review against Inno Setup's documented
  `PrepareToInstall`/`Exec`/`FileExists`/`Log` semantics, consistent in rigor with how the rest
  of `studix.iss` was already written and reported (compilation unverified, `ISCC.exe` not
  installed in this environment, not installed for this phase either).
- INSTALL-06's design doc §8 was updated with a one-line factual correction
  ("Deferred, not solved here" → "Resolved in INSTALL-07, see...") — documentation accuracy,
  not a behavior change to anything INSTALL-06 built.

## Testing / verification performed

- Full backend unit suite, backend integration suite, frontend suite, production build, and
  Windows runtime build (`-SkipDependencyFetch`, since PostgreSQL's checksum remains the
  honest, documented placeholder from INSTALL-06) — all re-run fresh, see results below.
- `installer/studix.iss` syntax reviewed by hand against Inno Setup's documented
  `PrepareToInstall`/`Exec`/`FileExists`/`Log`/`ExpandConstant` APIs (all already used
  elsewhere in this same file from INSTALL-06, so no new API surface introduced).
- **Not verified**: real `.iss` compilation (`ISCC.exe` still not installed in this
  environment — unchanged limitation from INSTALL-06), a real elevated upgrade run (needs
  Administrator privileges and a disposable VM, per the same reasoning as INSTALL-06).

## Files changed

- `installer/studix.iss` — modified (INSTALL-07's own addition to an INSTALL-06-created file).
- `migration/reports/INSTALL-06_INSTALLER_DESIGN.md` — modified (one-line factual correction).
- `migration/reports/INSTALL-07_UPGRADE_SAFETY.md` — new (this report).

No other file touched.
