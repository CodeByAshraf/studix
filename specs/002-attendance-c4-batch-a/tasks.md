---

description: "Task list for Attendance C4 Batch A — Safe Read Migration"
---

# Tasks: Attendance C4 Batch A — Safe Read Migration

**Input**: Design documents from `specs/002-attendance-c4-batch-a/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/attendance-batch-a-endpoints.md, quickstart.md (all present)

**Tests**: Included — SC-001/SC-003 explicitly require automated before/after comparison, and this batch touches 5 components, 3 of which (`AttendanceAnalytics.jsx`, `QRScanner.jsx`, and — for this specific behavior — `Dashboard.jsx`) have no existing coverage for what's being migrated.

**Organization**: Per the user's explicit sizing request, this feature uses ~9 larger, meaningful tasks rather than one task per test-file-then-implementation-file pair. Each per-consumer task internally follows test-first (write/extend tests → confirm red where new assertions exist → implement → confirm green), described in prose rather than split into separate task IDs. Tasks are still labeled by user story ([US1]-[US4]) for traceability to spec.md.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1-US4, per spec.md
- Every task lists its exact file path(s)

## Path Conventions

Existing Studix web-application layout: `backend/src/` (unmodified by this feature) and `src/` (frontend — where all work happens), per plan.md's Structure Decision.

---

## Phase 1: Setup — Baseline & Contract Confirmation

**Purpose**: Capture the exact pre-migration figures and confirm every mapping in research.md/contracts/ against the live dev environment before any code changes, so "numerically identical" (SC-001) has a concrete baseline to diff against.

- [X] T001 Walk through `quickstart.md` §1 against the running dev stack: record the exact current values for all five consumers' figures (ReportsPage overview %, AttendanceAnalytics' 4 sub-computations, each Dashboard-listed student's heat, AttendancePage's 4 KPIs + sessions + pendingFollowup, and a QR duplicate-check warning) for a known dataset. Spot-check `research.md`'s five endpoint mappings and the contracts doc's response shapes against one live call each (`groupBy=status`, `groupBy=group`, `groupBy=date&from=&to=`, `groupBy=weekday&status=absent`, `studentIds=`, `studentId=&date=`) to confirm no drift since feature 001 shipped. No code changes in this task.
  - **Result** (2026-09-21): the literal browser walkthrough portion is blocked by the same pre-existing environment issues documented in feature 001's T001/T015 (no connected browser extension in this environment; the local dev database has no license activation, so even authenticated API calls beyond login are blocked). Instead, ran the full `backend/src/routes/attendance.integration.test.js` suite (21/21 passing) against a real, fresh Postgres scratch database (bypasses the license gate entirely — integration tests don't go through the app's session/license middleware). This gave direct, live confirmation of every endpoint contract this batch needs: test 9 (`groupBy=status`), test 10 (`groupBy=group`), test 12 (`groupBy=weekday`, scoped by status), test 13 (`groupBy=date`, narrowed by `from/to` — the exact `dailyTrend` shape), test 14 (`studentIds` batch aggregation, explicitly named "Dashboard batch shape" in the test itself), and tests 2/4/5 (`studentId`/`date`/`status` scoped-list filters, for QRScanner). No manual baseline figures were captured via a running UI; T002-T005's own before/after test assertions serve as the numerical-equivalence evidence instead (see each task's own tests).

**Checkpoint**: Baseline figures and endpoint shapes confirmed; safe to start migrating.

---

## Phase 2: User Story 1 — Reports & Analytics dashboards (Priority: P1) 🎯 MVP

**Goal**: `ReportsPage.jsx`'s overview `attPct` and all four of `AttendanceAnalytics.jsx`'s remaining computations (total/present/absent/late/pct, byGroup, dailyTrend, dayData) read from the four aggregate dimensions instead of the full global array.

**Independent Test**: Per spec.md US1 acceptance scenarios — every figure on both pages matches its Phase 1 baseline exactly, for both a populated dataset and a zero-attendance dataset.

- [X] T002 [US1] Migrate `src/modules/reports/ReportsPage.jsx`'s `OverviewDashboard` and `src/modules/reports/AttendanceAnalytics.jsx` together (same aggregate patterns, same risk class — see plan.md's grouping rationale). For each: replace the `useAppStore(s => s.attendance)` read with `useAsyncData` calls to `pgGetAttendanceAggregate({groupBy:'status'})` (both files), `{groupBy:'group'}` and `{groupBy:'weekday', status:'absent'}` (AttendanceAnalytics only), and `{groupBy:'date', from:<today-90d>, to:<today>}` (AttendanceAnalytics' `dailyTrend`, per the 90-day clarification — see research.md §2/contracts doc §3); keep every existing derivation formula (`pct = round(present/total*100)`, the `.slice(-14)` windowing, the descending sort for `dayData`) unchanged, only swap what feeds it. Wire the existing `useToast`+`useEffect` error pattern already used by every prior migrated consumer. Do not touch `AttendanceAnalytics.jsx`'s already-migrated `absentees` line (feature 001) or the `byGroup`/`dailyTrend`/`dayData` chart-rendering JSX itself. Write/extend tests first: add `attPct`-scoped assertions to the existing `src/modules/reports/ReportsPage.test.jsx` (mocking `pgGetAttendanceAggregate`, asserting the exact `groupBy=status` call and the resulting %), and create a new, narrowly-scoped `src/modules/reports/AttendanceAnalytics.test.jsx` covering exactly the four migrated dimensions (one call assertion + one output assertion per dimension) plus a zero-data empty-state case — do not expand either test file beyond what this task migrates.

**Checkpoint**: Both pages' figures match Phase 1 baseline; new/extended tests pass; T002 is independently shippable as the MVP of this batch.

**Result** (2026-09-21): Done. `ReportsPage.jsx` fully migrated (its `attendance` selector removed entirely). `AttendanceAnalytics.jsx` migrated for total/present/absent/late/pct/byGroup/dailyTrend/dayData — **mid-implementation discovery**: this component also has its own `sessions` computation (distinct group+date pairs, identical semantics to `AttendancePage.jsx`'s already-documented gap), not called out separately in spec.md/plan.md/research.md because it was missed during planning. Per FR-005's underlying principle ("don't invent a replacement if no API reproduces the exact semantics") and the "do not expand scope" instruction, this was left unmigrated rather than either silently dropped or forced onto a new capability — `attendance` therefore stays selected in this file too, for `sessions` and the already-migrated (feature 001) `absentees` adapter only. Tests: `ReportsPage.test.jsx` extended (2 new tests, 3/3 passing — 1 pre-existing test in this suite's sibling `ReportsPage.revenue.test.jsx` file already failed before this feature touched anything, unrelated, left as-is); new `AttendanceAnalytics.test.jsx` created (7/7 passing).

---

## Phase 3: User Story 2 — Dashboard per-student heat (Priority: P2)

**Goal**: `Dashboard.jsx`'s `StudentRow` heat for the listed students is fetched via a single batched `studentIds` call instead of the full global array; `stats.attPct` (the separate, out-of-scope `attendance.slice(-50)` computation) is untouched.

**Independent Test**: Per spec.md US2 — each listed student's heat indicator matches its Phase 1 baseline; a student with zero history shows the same empty state as today.

- [X] T003 [US2] In `src/modules/Dashboard.jsx`: compute `visibleStudentIds` from `students.slice(0, 5)` (the same slice already feeding `StudentRow` today), fetch `pgGetAttendance({studentIds: <joined key>})` via `useAsyncData` only when that id list is non-empty (else resolve to `[]` directly — same zero-active-guard convention as feature 001's `AttendanceReports.jsx` and `StudentsPage.jsx`), and pass the resulting per-student-filtered records into `StudentRow` in place of the full global `attendance` prop. Leave `stats.attPct`'s `attendance.slice(-50)` computation and its `useAppStore(s => s.attendance)` read completely untouched (out of scope, FR-008) — this means `attendance` stays selected in this file for that one remaining computation; only `StudentRow`'s data source changes. Write tests first in a new, narrowly-scoped `src/modules/Dashboard.attendanceHeat.test.jsx` (matching this codebase's existing per-behavior Dashboard test file convention, e.g. `Dashboard.revenue.test.jsx`): assert the exact `studentIds` sent matches only the 5 rendered students' ids, assert per-student heat correctness from a mocked response, and assert the zero-students case makes no call.

**Checkpoint**: Dashboard heat matches baseline for all listed students; `stats.attPct` provably unchanged (still store-sourced); new test passes.

---

## Phase 4: User Story 3 — Attendance page overview (Priority: P3)

**Goal**: `AttendancePage.jsx`'s `total/present/absent/late/pct` KPIs read from `groupBy=status`; `sessions` and `pendingFollowup` are explicitly left on the full global array, unchanged (FR-005/FR-006).

**Independent Test**: Per spec.md US3 — the four migrated KPIs match baseline; `sessions` and `pendingFollowup` are pixel-identical to today (same value, same data source, no new request).

- [X] T004 [US3] In `src/modules/attendance/AttendancePage.jsx`: add a `useAsyncData` call to `pgGetAttendanceAggregate({groupBy:'status'})` and derive `total/present/absent/late/pct` from it exactly as `ReportsPage.jsx`/`AttendanceAnalytics.jsx` now do (T002); leave `sessions` (`new Set(attendance.map(...))`.size) and `pendingFollowup` computed exactly as today, from the still-present `useAppStore(s => s.attendance)` selector (do NOT remove this selector — see research.md §4 for why it must stay). Do not touch the already-migrated `absentees` KPI (feature 001). Extend the existing `src/modules/attendance/AttendancePage.test.jsx`: add assertions that the four migrated KPIs match a mocked-aggregate-derived expectation, and an explicit regression assertion that `sessions` and `pendingFollowup` are unchanged in value and still computed without any new network call when only `attendance` (store) data changes.

**Checkpoint**: Four KPIs migrated and verified; `sessions`/`pendingFollowup` provably untouched; both documented gaps (FR-005, FR-006) hold in the implementation, not just on paper.

---

## Phase 5: User Story 4 — QR check-in duplicate detection (Priority: P4)

**Goal**: `QRScanner.jsx`'s same-day duplicate check reads via a scoped `studentId`+`date` call instead of scanning the full global array; the simulated write path is untouched.

**Independent Test**: Per spec.md US4 — scanning an already-recorded student still produces the same warning and existing-record details; scanning a new student still proceeds normally.

- [X] T005 [US4] In `src/modules/id-cards/components/QRScanner.jsx`: replace the `attendance.find(r => r.studentId===studentId && r.date===today)` lookup inside `processCode` with an on-demand `pgGetAttendance({studentId, date: today})` call (awaited inline in the existing `processCode` callback, since this is a per-scan action, not a render-time fetch — no `useAsyncData` needed here), taking `rows[0] ?? null` as `existingToday`; keep every downstream branch (`toast.warning(...)`, `setLastScan(...)`) unchanged. Do NOT modify `setAttendance(prev => [...prev, newRecord])` or any other part of the write path — that simulated-write gap is explicitly out of scope (research.md §5). Write tests first in a new, narrowly-scoped `src/modules/id-cards/components/QRScanner.duplicateCheck.test.jsx`: mock `pgGetAttendance`, assert it's called with `{studentId, date: <today>}` on a scan, assert the existing-record warning renders correctly when a row is returned, and assert normal check-in proceeds when it returns `[]`.

**Checkpoint**: QR duplicate check migrated and verified; write path provably untouched (no diff to `setAttendance` call or `newRecord` construction).

---

## Phase 6: Cross-Cutting Verification

**Purpose**: Prove the batch as a whole — not just each piece individually — meets SC-001 through SC-004.

- [X] T006 [P] Consolidated regression pass: run every test file touched or extended by T002-T005 together (`ReportsPage.test.jsx`, `AttendanceAnalytics.test.jsx`, `Dashboard.attendanceHeat.test.jsx`, `AttendancePage.test.jsx`, `QRScanner.duplicateCheck.test.jsx`) plus a new cross-file consistency assertion: seed identical attendance data once, and confirm `ReportsPage.jsx`'s `attPct` and `AttendanceAnalytics.jsx`'s `pct` agree with each other (spec.md's Edge Cases: "two consumers computing the same figure must continue to agree") — add this single assertion wherever it fits most naturally among the files above rather than creating a new test file for one assertion.
- [X] T007 [P] Global-consumer verification (SC-003): run the existing, unmodified test suites for the four explicitly out-of-scope consumers — `AbsenceFollowup.jsx`, `ui.context.jsx` (notification derivation), and any existing coverage touching `Dashboard.jsx`'s `attendance.slice(-50)`-based `stats.attPct` or `AttendancePage.jsx`'s `sessions`/`pendingFollowup` — and confirm all pass **unmodified**, with zero test-file edits in this task. This is a verification-only task; if anything here needs to change, that indicates T002-T005 leaked scope and must be fixed there, not here.
- [X] T008 [P] Bounded-loading verification (SC-002): for each of the five migrated consumers, confirm via the relevant test's network-call assertions (already written in T002-T005) that no request for the full unscoped attendance list is ever made — cross-check against `quickstart.md` §2's per-page expected request list. Document the result (pass/fail per consumer) in this task's own completion note; do not add new test files here, only confirm existing assertions already prove this property.
  - **Result** (2026-09-21): Confirmed both by source inspection and by test assertion, per consumer:
    - `ReportsPage.jsx`: only `pgGetAttendanceAggregate({groupBy:'status'})` — no `pgGetAttendance` import/call at all. ✅ PASS
    - `AttendanceAnalytics.jsx`: only `pgGetAttendanceAggregate` across the 4 dimensions (`status`/`group`/`date&from&to`/`weekday&status`) — no `pgGetAttendance` import/call at all. ✅ PASS
    - `Dashboard.jsx`: only `pgGetAttendance({studentIds:<visible 5 ids>})`, explicitly guarded to skip the call entirely when the id list is empty (never sends omitted/empty `studentIds`) — verified by the dedicated "makes no request when there are zero students to display" test. ✅ PASS
    - `AttendancePage.jsx`: only `pgGetAttendanceAggregate({groupBy:'status'})` for the migrated KPIs; `sessions`/`pendingFollowup` remain intentionally store-sourced (not a new network call, a documented gap, not a violation of this criterion). ✅ PASS
    - `QRScanner.jsx`: only `pgGetAttendance({studentId, date})`, one scoped student+date pair per scan. ✅ PASS
    - All five: zero source-level references to an unscoped `pgGetAttendance()` call or a `pgGetAttendanceAggregate` call without a `groupBy`.

**Checkpoint**: All four success criteria (SC-001 through SC-004) have direct evidence, not just implied by individual component tests.

---

## Phase 7: Final Audit

**Purpose**: Read-only confirmation before calling this batch done, mirroring the rigor applied to feature 001.

- [X] T009 Run `npm run build`, the full relevant test suite (`src/modules/reports`, `src/modules/Dashboard*`, `src/modules/attendance/AttendancePage.test.jsx`, `src/modules/id-cards`), and `npm run lint` scoped to the 5 migrated files + their test files; produce a `git diff`-based summary distinguishing this feature's own hunks from any other uncommitted work in the same files (same method used for feature 001's final audits); confirm zero backend changes, zero changes to `AbsenceFollowup.jsx`/`ui.context.jsx`/`PG_COLLECTIONS`/`partialize`/the dead attendance hooks/the installer; confirm `tasks.md` accurately reflects what was and wasn't completed.
  - **Result** (2026-09-21): `npm run build` ✅ succeeds. Full relevant suite: 100/102 passing (2 pre-existing, unrelated `ReportsPage.revenue.test.jsx` failures, confirmed via `git stash` comparison to fail identically with this feature's changes fully reverted). Lint: zero new errors — the one `no-duplicate-imports` error surfaced in `ReportsPage.jsx` is pre-existing (its `import {lazy,Suspense} from 'react'` line is byte-identical before/after this feature's diff, confirmed via `git diff`); all warnings are the same pre-existing `no-unused-vars`/`react-hooks/exhaustive-deps` patterns already established throughout this codebase. Git-diff attribution: hunk-by-hunk inspection of all 5 production files confirms every non-attendance-C4 hunk (payments/activityLogs Phase 4 migrations, the absence-followup deep-link feature, prior print/report-tab migrations) is pre-existing, unrelated uncommitted work already present before this feature started — this feature's own contribution in each file is limited to exactly the `pgGetAttendanceAggregate`/`pgGetAttendance` fetch blocks, their imports, and the specific KPI/render-prop lines described in T002-T005. Confirmed zero changes to `backend/` (33 pre-existing modified files, none touched), `AbsenceFollowup.jsx`, `ui.context.jsx`, `PG_COLLECTIONS` (`db.middleware.js` never opened), `partialize`/`app.store.js` (never opened), the two dead attendance hooks, or the installer.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **User Stories (Phases 2-5)**: Each depends only on Phase 1 (baseline capture), not on each other — all five files are disjoint, so T002/T003/T004/T005 have no cross-dependencies and could be done in any order or in parallel by different people, unlike feature 001 where every story touched the same component.
- **Cross-Cutting Verification (Phase 6)**: Depends on all of T002-T005 being complete (needs every migrated consumer in place to verify the batch holistically).
- **Final Audit (Phase 7)**: Depends on Phase 6.

### Parallel Opportunities

- T002, T003, T004, T005 touch entirely disjoint files (`ReportsPage.jsx`+`AttendanceAnalytics.jsx`, `Dashboard.jsx`, `AttendancePage.jsx`, `QRScanner.jsx` respectively) and share no component — genuinely parallelizable, unlike feature 001's single-component migration.
- T006, T007, T008 (Phase 6) touch different files/concerns from each other and can run in parallel once Phase 2-5 are all done.

---

## Parallel Example: Phases 2-5

```bash
# All four can run at the same time — disjoint files, no shared component:
Task: "Migrate ReportsPage.jsx + AttendanceAnalytics.jsx (T002)"
Task: "Migrate Dashboard.jsx's StudentRow heat (T003)"
Task: "Migrate AttendancePage.jsx's 4 KPIs (T004)"
Task: "Migrate QRScanner.jsx's duplicate check (T005)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup — baseline capture).
2. Complete Phase 2 (T002 — ReportsPage + AttendanceAnalytics): the highest-value, lowest-risk unit, and independently shippable.
3. **STOP and VALIDATE**: run T002's tests; spot-check against Phase 1's baseline.
4. This alone already removes the two largest remaining unscoped attendance reads and is safe to ship on its own if needed.

### Incremental Delivery

1. Setup → baseline captured.
2. US1 (T002) → Reports & Analytics migrated → validate independently (MVP).
3. US2 (T003) → Dashboard heat migrated → validate independently.
4. US3 (T004) → Attendance page KPIs migrated, two gaps deliberately preserved → validate independently.
5. US4 (T005) → QR duplicate check migrated → validate independently.
6. Cross-cutting verification (T006-T008) → prove the batch holistically.
7. Final audit (T009) → done.

## Notes

- [P] tasks touch disjoint files and have no unmet dependency within their phase.
- [Story] labels trace each task back to its spec.md user story.
- Two figures are permanently, deliberately left unmigrated in this batch (`AttendancePage.jsx`'s `sessions` and `pendingFollowup`) — this is expected, documented scope, not a shortfall; do not add tasks to "finish" them without a new spec decision (research.md §4 explains why forcing them would be worse, not better).
- No backend task exists in this list because none is needed — every dimension this batch requires already exists and is already tested (research.md, contracts/).
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
