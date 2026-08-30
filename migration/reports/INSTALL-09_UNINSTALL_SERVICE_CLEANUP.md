# INSTALL-09 — Normal-Uninstall Service Cleanup: Design/Implementation Report

## Scope

Exactly one gap, traced from already-committed text: `migration/reports/INSTALL-08_DATA_WIPE_UNINSTALL.md`'s own decision **D1** explicitly recorded *"a separate, pre-existing correctness gap"* — a normal (declined-wipe) uninstall never stopped or unregistered `StudixApp`/`StudixPostgreSQL`, leaving both registered and pointing at binaries `{app}`'s removal had just deleted. Scope (and the four decisions below) was confirmed with you directly via a dedicated architecture audit, run against three traced candidate deferred items (this one, code-signing, and a least-privilege PostgreSQL role) before any code was written — this was the one you selected.

## Approved decisions (recorded verbatim in intent)

- **OD1 — Best-effort / non-fatal.** The new cleanup never aborts the uninstall on failure. Unlike INSTALL-08's wipe path, there is no destructive data deletion downstream of this step — a failure here just means the orphaning bug isn't fully closed on this particular run, never a reason to make the application harder to uninstall.
- **OD2 — `CurUninstallStepChanged(usUninstall)`, not `InitializeUninstall`.** The cleanup runs only after the user has accepted Inno Setup's own standard "are you sure you want to remove Studix?" confirmation, while `{app}\node\node.exe` and `manageWindowsServices.js` are still present (before `{app}`'s files are removed).
- **OD3 — A separate best-effort helper**, not a call to `TeardownServiceForWipe` with its return value discarded. `BestEffortUnregisterServiceForUninstall` mirrors `BestEffortStopServiceForUpgrade`'s exact best-effort shape (log-and-continue on any failure), keeping INSTALL-08's fail-closed helper and INSTALL-09's best-effort helper independently readable and maintainable.
- **OD4 — Informational, not a code change.** No retroactive cleanup utility was built. A service already orphaned by a *past* uninstall (performed with a pre-INSTALL-09 installer) is unaffected — this fix is forward-looking only, for future uninstalls.

## Design

- **New Pascal Script only, in the same already-INSTALL-06/07/08-owned file (`installer/studix.iss`)** — no INSTALL-01 through INSTALL-08 code was touched, no backend JS file was touched.
- **`BestEffortUnregisterServiceForUninstall(ServiceArg: String)`** — reuses `backend/scripts/manageWindowsServices.js`'s existing `unregister` action verbatim via `Exec()`, identical mechanism to `TeardownServiceForWipe`/`BestEffortStopServiceForUpgrade` (decision #1: reuse INSTALL-05, never reimplement service logic in Pascal Script). Any failure (launch failure, nonzero exit code, missing script) is logged and the function simply returns — never aborts anything, matching OD1.
- **Hooked into `CurUninstallStepChanged`'s existing `usUninstall` branch (newly added, alongside the pre-existing, untouched `usPostUninstall` branch)** — per OD2, this fires after Inno's own standard confirmation and before `{app}` removal.
- **Order**: `'app'` before `'postgres'`, matching the established dependency-respecting convention already used by `BestEffortStopServiceForUpgrade` and `TeardownServiceForWipe`.
- **Unconditional** — runs on every uninstall, regardless of whether the operator also accepted INSTALL-08's data wipe.

## Wipe-accepted path compatibility (explicit verification, per your requirement #7)

Traced through the actual control flow, not assumed:

1. `InitializeUninstall` always runs to completion (and returns) **before** any `TUninstallStep` — including `usUninstall` — ever fires (Inno Setup's documented event ordering, already relied on by INSTALL-08's own D5 design).
2. If the operator accepted the wipe, `InitializeUninstall`'s own `TeardownServiceForWipe('app')` then `TeardownServiceForWipe('postgres')` already ran and succeeded (that's the only way `WipeDataConfirmed` becomes `True` and the uninstall is allowed to proceed at all) — both services are therefore **already unregistered** by the time `usUninstall` fires.
3. `CurUninstallStepChanged(usUninstall)` then calls `BestEffortUnregisterServiceForUninstall('app')`/`('postgres')` unconditionally. Each call re-invokes `manageWindowsServices.js <target> unregister`, which (per `unregisterAppService`/`unregisterPostgresService`, `backend/src/lib/windowsService.js:241-258, 322-347`) returns `{status: 'not_registered'}` — **exit code 0** — when nothing is registered. There is no code path where re-unregistering an already-unregistered service throws or exits nonzero.
4. Therefore the `usUninstall` branch, when the wipe was accepted, performs two harmless, fast, log-only no-ops. It never attempts to stop a process that isn't running, never conflicts with D1-D5, and never delays or interferes with the subsequent `usPostUninstall` `DelTree` calls (which depend only on `WipeDataConfirmed`, untouched by this addition).
5. When the wipe was **declined**, this is the *only* place either service gets torn down at all — exactly closing the gap this phase exists for.

## What was explicitly NOT done

- No backend/JS file touched — zero new backend code, same reuse pattern as INSTALL-07/08.
- No change to `InitializeUninstall`, `TeardownServiceForWipe`, `WipeDataConfirmed`, or any `usPostUninstall` logic — the existing `if (CurUninstallStep = usPostUninstall) and WipeDataConfirmed then` block is byte-for-byte unchanged.
- No change to `PrepareToInstall`, `BestEffortStopServiceForUpgrade`, `RunFirstInstall`, or `CurStepChanged` (INSTALL-06/07 install-time logic).
- No retroactive cleanup tool for already-orphaned services from prior installer versions (OD4).
- No new Pascal Script test infrastructure — same reasoning as INSTALL-07/08: no such infrastructure exists in this repository, and this addition introduces zero new backend logic to unit-test.

## Testing / verification performed

- Full backend unit suite re-run fresh (see implementation report below) — unaffected, since zero backend files changed.
- `installer/studix.iss` syntax reviewed by hand against Inno Setup's documented `CurUninstallStepChanged`/`TUninstallStep`/`usUninstall`/`Exec`/`FileExists`/`Log`/`ExpandConstant` APIs — all already used elsewhere in this file (from INSTALL-07/08), so no new API surface introduced by this phase specifically.
- **Not verified**: real `.iss` compilation (`ISCC.exe` still not installed — unchanged limitation), a real elevated uninstall exercising the declined-wipe path (install → uninstall, decline the prompt → confirm via `sc query StudixApp`/`sc query StudixPostgreSQL` that both are actually gone) — this is the one path no previous phase's testing covered, since INSTALL-08's own verification focused on the wipe-accept path.

## Files changed

- `installer/studix.iss` — modified (new `BestEffortUnregisterServiceForUninstall` procedure, new `usUninstall` branch in `CurUninstallStepChanged`, header/decision-comment updates for accuracy).
- `migration/reports/INSTALL-08_DATA_WIPE_UNINSTALL.md` — modified (one-line-scope pointer update to D1, same pattern used for INSTALL-06 §8/§9).
- `migration/reports/INSTALL-09_UNINSTALL_SERVICE_CLEANUP.md` — new (this report).

No other file touched. No backend/JS/frontend file touched.
