# INSTALL-08 — Opt-In Data-Wipe Uninstall Utility: Design/Implementation Report

## Scope

Exactly one gap, traced from already-committed text: INSTALL-06's own design doc §"Uninstall
policy" explicitly flagged *"A future explicit 'wipe all Studix data' utility, if ever wanted, is
a distinct, clearly-labeled opt-in feature — out of INSTALL-06's scope."* This report and its
implementation close exactly that gap, and nothing else. Scope (and the five design decisions
below) was confirmed with you directly via a dedicated architecture audit before any code was
written — see the audit transcript for the full traced evidence (ProgramData subdirectory
resolvers, `backups\`'s lack of off-machine replication, the pre-existing normal-uninstall
service-orphaning gap, Inno Setup's `InitializeUninstall`/`CurUninstallStepChanged` lifecycle
contract).

## Approved decisions (recorded verbatim in intent, not paraphrased away)

- **D1 — Do NOT fix the pre-existing normal-uninstall service-orphaning gap here.** The audit
  discovered that today's uninstaller (INSTALL-06/07, unmodified) never stops or unregisters
  `StudixApp`/`StudixPostgreSQL` on a normal (declined-wipe) uninstall, leaving both services
  registered and pointing at deleted binaries. This is a separate, pre-existing correctness gap —
  reported here for the record, **not fixed by INSTALL-08**. Normal uninstall behavior is
  unchanged.
- **D2 — `%ProgramData%\Studix\backups\` is never deleted**, wipe or no wipe. It is the only
  local disaster-recovery copy of the customer's database (`backend/src/db/backup.js`'s
  `pg_dump`-based logical backups have no off-machine replication anywhere in the codebase). The
  wipe deletes `pgdata\`, `config\`, and `logs\` only — individually, never the
  `{commonappdata}\Studix` root itself (which would also take `backups\` with it). No second
  backup-deletion option or additional UI was added.
- **D3 — Two sequential `MsgBox(..., MB_YESNO)` confirmations**, nothing pre-selected. First
  names exactly what will be deleted and states that backups are retained; second restates
  irreversibility. No custom VCL form was built.
- **D4 — Uninstaller-integrated only.** No standalone tool, no separate shortcut/executable, no
  independent "wipe data" workflow. The feature is reachable only by running the standard Studix
  uninstaller.
- **D5 — Fail-closed, whole-uninstall abort.** If the operator accepts the wipe but either
  `StudixApp` or `StudixPostgreSQL` cannot be *confirmed* stopped-and-unregistered, the **entire**
  uninstall aborts before `{app}` is touched — no files removed, no services further touched, no
  ProgramData deletion. This is a deliberate reversal of INSTALL-07's best-effort philosophy: that
  step always has `firstInstall.js` as an independent second safety net afterward; this one does
  not, because it precedes an irreversible delete.

## Design

- **New Pascal Script only, in the same already-INSTALL-06/07-owned file
  (`installer/studix.iss`)** — no INSTALL-01 through INSTALL-07 code was touched, no backend JS
  file was touched.
- **Reuses `backend/scripts/manageWindowsServices.js`'s existing `unregister` action verbatim**,
  via `Exec()` against the still-installed (about to be removed) `node.exe` — matches decision
  #1's "keep Pascal Script minimal, reuse Node-side tooling" precedent exactly, and reuses
  `unregisterAppService`/`unregisterPostgresService` (`backend/src/lib/windowsService.js:251,341`)
  as-is: both already stop the service first internally if it's `RUNNING`, so one `unregister`
  call per service does the full stop-then-unregister sequence with zero new backend code.
- **Lifecycle placement, traced against Inno Setup's documented event contract (not verified by a
  real compiled run — see Testing below):**
  - `InitializeUninstall(): Boolean` — the only Pascal Script hook whose return value can cancel
    the entire uninstall before Inno does anything, including before Inno's own standard "are you
    sure you want to remove {app}?" confirmation. Both confirmation prompts and the fail-closed
    teardown attempt live here, because D5 ("abort the entire uninstall") is only achievable from
    a hook that can veto the uninstall outright — `CurUninstallStepChanged` is a plain procedure
    with no such veto power.
  - `CurUninstallStepChanged(CurUninstallStep: TUninstallStep)` at `usPostUninstall` — the actual
    `DelTree` calls, gated on a module-level `WipeDataConfirmed` boolean set (at most) inside
    `InitializeUninstall`. Runs after Inno's own `{app}` removal, which is fine — `DelTree` is a
    Pascal Script builtin and needs no external process, unlike the teardown step which had to run
    while `node.exe` still existed.
- **Fresh/partial-install handling differs deliberately from INSTALL-07's**: `Teardown
  ServiceForWipe` treats a missing `manageWindowsServices.js` as a **failure**, not a safe skip —
  unlike `BestEffortStopServiceForUpgrade`'s fresh-install case (provably nothing was ever
  installed), an uninstall implies something *was* installed; if the script needed to *confirm*
  safe teardown is missing, teardown cannot be confirmed, and D5 requires failing closed rather
  than assuming safety.

## What was explicitly NOT done

- No changes to `manageWindowsServices.js`, `windowsService.js`, `firstInstall.js`, or any other
  backend file — confirmed via `git status`/diff (see below).
- No fix for the pre-existing normal-uninstall service-orphaning gap (D1) — recorded as a
  separate, still-open item.
- No deletion of `backups\` under any circumstance (D2).
- No custom VCL confirmation form (D3).
- No standalone wipe utility, shortcut, or second executable (D4).
- No new Pascal Script test infrastructure — same reasoning as INSTALL-07: no Pascal Script test
  infrastructure exists anywhere in this repository, and this addition introduces zero new backend
  logic to unit-test; verified by careful manual review against Inno Setup's documented
  `InitializeUninstall`/`CurUninstallStepChanged`/`TUninstallStep`/`DelTree`/`Exec`/`MsgBox`/`Log`
  semantics.

## Known, disclosed residual risk

`unregisterAppService`/`unregisterPostgresService` are each themselves a stop-then-unregister
*pair*, not a single atomic operation (pre-existing INSTALL-05 behavior, unchanged here). If the
`'app'` teardown succeeds but the `'postgres'` teardown then fails, `InitializeUninstall` still
returns `False` and aborts the whole uninstall — satisfying D5's letter (`{app}` is never removed,
no ProgramData is deleted) — but `StudixApp` will already have been unregistered while
`StudixPostgreSQL` was not: a narrow partial-state possibility inherent to reusing INSTALL-05's
existing, non-transactional primitives as-is. Fixing this would require new backend transactional
logic, which the approved implementation constraints explicitly rule out ("do not add new backend
service-management logic unless the audit proves an existing mechanism is insufficient" — it
wasn't proven insufficient, only imperfectly composable for this one edge case).

## Testing / verification performed

- Full backend unit suite re-run fresh (see results below) — unaffected, since zero backend files
  changed; this confirms nothing else regressed.
- `installer/studix.iss` syntax reviewed by hand against Inno Setup's documented
  `InitializeUninstall`/`CurUninstallStepChanged`/`TUninstallStep`/`DelTree`/`Exec`/`FileExists`/
  `MsgBox`/`Log`/`ExpandConstant` APIs — `DelTree`, `TUninstallStep`, `usPostUninstall`, and
  `InitializeUninstall`'s cancel-the-whole-uninstall contract are the only genuinely new API
  surface versus INSTALL-06/07 (which already used `Exec`/`FileExists`/`Log`/`ExpandConstant`/
  `MsgBox`/`PrepareToInstall`).
- **Not verified**: real `.iss` compilation (`ISCC.exe` still not installed in this environment —
  unchanged limitation from INSTALL-06/07), a real elevated uninstall run in any of its three
  paths (decline / accept-and-succeed / accept-and-fail-closed) — needs Administrator privileges
  and a disposable VM with a real prior install. Given this feature is irreversible by nature, a
  real run of all three paths (especially the fail-closed abort path, deliberately induced by
  e.g. a locked service) is recommended as a hard precondition before this ships to a real
  customer, not merely a nice-to-have.

## Files changed

- `installer/studix.iss` — modified (INSTALL-08's own addition to the INSTALL-06/07-owned file).
- `migration/reports/INSTALL-06_INSTALLER_DESIGN.md` — modified (one-line-scope factual
  correction to §9, same pattern INSTALL-07 used for §8).
- `migration/reports/INSTALL-08_DATA_WIPE_UNINSTALL.md` — new (this report).

No other file touched. No backend/JS/frontend file touched.
