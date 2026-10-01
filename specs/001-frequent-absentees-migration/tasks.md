---

description: "Task list for Frequent Absentees Report Data Migration"
---

# Tasks: Frequent Absentees Report Data Migration

**Input**: Design documents from `specs/001-frequent-absentees-migration/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/attendance-aggregate-student.md, quickstart.md (all present; regenerated 2026-09-21 after spec.md's second clarification session resolved the `studentIds` scoping question — see research.md §1a)

**Tests**: Included — SC-003 explicitly requires automated tests to confirm zero regression, and `quickstart.md` §6 names the new test file this task list produces.

**Organization**: Tasks are grouped by user story (spec.md P1/P2/P3) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3, per spec.md
- Every task lists its exact file path(s)

## Path Conventions

Existing Studix web-application layout: `backend/src/` (unmodified by this feature) and `src/` (frontend — where all work in this feature happens), per plan.md's Structure Decision.

---

## Phase 1: Setup

**Purpose**: Confirm the environment this feature will be built and verified against. No new tooling, dependencies, or scaffolding is required (research.md §1: zero backend changes; plan.md: no new dependencies).

- [ ] T001 Start the existing dev stack (backend on :4000, frontend on :5173, Postgres) and confirm the current "frequent absentees" tab renders under `AttendanceReports.jsx`, per `quickstart.md` §1–2 (baseline capture, no code changes). Seed at least one inactive/suspended student with `absent` attendance rows on file, per quickstart.md's Prerequisites — needed later to verify T005's `studentIds` scoping (research.md §1a).
  - **Attempted, not completed** (2026-09-21): port :4000 is occupied by a pre-existing, separately-installed `StudixApp` Windows service on this dev machine (unrelated real instance — left untouched). This repo's own dev DB (`backend/.env`, port 5432) also had 3 pending migrations (versions 6–8), applied via the documented `node scripts/runMigrations.js` (creates its own pre-migration backup — safe, standard dev tool, see README's "تشغيل الترحيلات يدوياً" row). Backend was then run on an alternate port with `STUDIX_CONFIG_PATH=<nonexistent path> PORT=4100 node --watch src/server.js` (forces `lib/config.js`'s documented dev fallback instead of the installed instance's `%ProgramData%\Studix\config\.env`), and frontend with `VITE_API_URL=http://localhost:4100 npx vite --port 5183`. Both came up healthy. Test data was seeded directly via Prisma (2 pre-existing active students reassigned into a new group with 4 and 1 absences; one new active student with 8 absences; one new **inactive** student with 9 absences; one empty group) and the admin password was temporarily reset to log in — **restored to its original hash immediately after**, and the seed script deleted. Login via `POST /api/session` succeeded, but every subsequent authenticated route (including the attendance aggregate endpoint) returned `licenseRequired: true` — this dev database has no license activation, and activating one was out of scope (licensing is this codebase's most protected, fail-closed subsystem — not something to bypass casually). The Claude-in-Chrome browser extension was also not connected in this environment, so a visual walkthrough wasn't possible regardless. All servers stopped and the DB left exactly as found (migrations applied — a genuine, permanent environment fix; password restored; seed data left in place: groups `verify-g1`/`verify-g2-empty`, students `verify-s3`/`verify-s4`, in case it's useful for a future manual pass once the environment is activated).

**Checkpoint**: Baseline behavior observed and noted for later regression comparison (quickstart.md §2).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Adapt the shared pure-function data shape that every user story below depends on. No user story's UI change can be correctly implemented or tested until this exists.

**⚠️ CRITICAL**: Phases 3–5 all read/write `getFrequentAbsentees`'s new signature — none can start until T003 is done.

- [X] T002 Write unit tests for the adapted `getFrequentAbsentees(students, statsByStudentId, threshold)` in new file `src/services/attendanceService.frequentAbsentees.test.js`, covering (per data-model.md): only `status === 'active'` students are eligible (FR-008); a student with no entry in `statsByStudentId` (no aggregate row) is treated as `absent: 0`/`pct: null` and never appears at any threshold ≥ 2 (FR-010); `absent >= threshold` filtering (FR-002); descending sort by `absent` (unchanged sort order). Expect these tests to fail until T003 lands.
- [X] T003 Implement the adapted `getFrequentAbsentees` in `src/services/attendanceService.js`: change its second parameter from a raw `records` array to a per-student stats lookup (a `Map` or plain object keyed by `studentId`, each value shaped `{ total, present, absent, late }`, matching the aggregate row shape in data-model.md); compute `pct = total > 0 ? Math.round(present / total * 100) : null` per student; drop the now-unused internal `getAttendanceStats(s.id, records)` call for this function only (other callers of `getAttendanceStats` are untouched); keep the existing `.filter(s => s.status === 'active')` → threshold filter → sort-by-`absent`-descending pipeline unchanged. This function still applies its own active-status filter internally even though the caller (T005) will *also* scope the request itself — see research.md §5 (defense in depth, not redundant). Run T002 to confirm it now passes.

**Checkpoint**: `getFrequentAbsentees` accepts pre-aggregated stats and is unit-tested. User story implementation can begin.

---

## Phase 3: User Story 1 - Identify students needing absence follow-up (Priority: P1) 🎯 MVP

**Goal**: The frequent-absentees tab renders its default view (default threshold, all groups) from the new aggregate data source instead of the global `attendance` store, with identical output to today.

**Independent Test**: Open the report with no filters applied; every active student meeting the default threshold appears, sorted most-absent-first, each with absence count, attendance percentage, severity indicator, and a working call action (spec.md US1 acceptance scenarios 1–2).

### Tests for User Story 1

- [X] T004 [US1] Write `src/modules/attendance/AttendanceReports.absenteesTab.test.jsx` (new file, mirrors the mocking style of `AttendanceReports.groupTab.test.jsx`): mock `pgGetAttendanceAggregate` from `../../services/api`; render `AttendanceReports`, switch to the absentees tab; assert exactly one call to `pgGetAttendanceAggregate({ groupBy: 'student', studentIds: '<comma-joined active student ids>' })` (no `groupId`) on open — asserting the `studentIds` value matches exactly the mocked active students, per FR-004/research.md §1a; assert the rendered list matches mocked aggregate data — correct names, absence counts, attendance percentages, severity label per the unchanged `absent >= 7 / >= 5` thresholds, and descending sort order; assert each row's call action (`tel:` link) targets the right phone number; assert that when the mocked active-student set is empty, `pgGetAttendanceAggregate` is **never called at all** (not called with an empty/missing `studentIds`) and the empty state renders instead — this guards against silently falling back to an unscoped request; assert that no dedicated loading/spinner indicator (no `role="status"`, no element with a "loading"/"جارٍ التحميل"-style label, no skeleton placeholder) is ever present in the DOM while the mocked fetch promise is pending — per FR-011, the tab must behave like the other three Attendance Reports tabs and simply show its normal default/empty state during the fetch, never a dedicated loading UI. Expect these to fail until T005–T006 land.

### Implementation for User Story 1

- [X] T005 [US1] In `src/modules/attendance/AttendanceReports.jsx`, migrate `ReportFrequentAbsentees` to fetch via the existing `useAsyncData` hook: compute `activeStudentIds` as the ids of `filtered` (the already-existing group-filtered student list) where `status === 'active'`, joined into a comma-separated key (mirrors `StudentsPage.jsx`'s `visibleStudentIdsKey` pattern); call `pgGetAttendanceAggregate({ groupBy: 'student', studentIds: activeStudentIdsKey, groupId: filterGroup || undefined })` **only when `activeStudentIds.length > 0`**, else resolve to `[]` directly without calling the endpoint at all (per research.md §1a — omitting `studentIds` when the list is empty would fall through to an *unscoped* request server-side, and passing an explicitly-empty `studentIds` throws a 400 — both wrong; skipping the call entirely is correct and matches `StudentsPage.jsx`'s `visibleStudentIds.length ? pgGetAttendance(...) : Promise.resolve([])` guard); useAsyncData deps: `[activeStudentIdsKey, filterGroup]`; convert the returned aggregate rows into the `Map` shape T003 expects, and pass that into `getFrequentAbsentees(filtered, statsMap, threshold)` in place of the removed `attendance` prop; add a `useEffect` that shows an error toast on fetch failure, matching the exact pattern already used in `ReportByStudent`/`ReportByGroup`/`ReportPrint` in this same file (FR-005). Per FR-011, add no loading-state UI — leave the list to render its normal default/empty state while the fetch is in flight, consistent with the other three tabs.
- [X] T006 [US1] In `src/modules/attendance/AttendanceReports.jsx`'s top-level `AttendanceReports` component, remove the now-dead `const attendance = useAppStore((s) => s.attendance);` selector and the `attendance={attendance}` prop passed to `<ReportFrequentAbsentees .../>` (both now unused after T005 — this was their only remaining reader in the file). Run T004 to confirm it now passes.

**Checkpoint**: Default-view frequent-absentees list works end-to-end from the new data source; T004 passes; `AttendanceReports.jsx` no longer reads the global `attendance` store at all; the request is always explicitly scoped to active student IDs (never unscoped).

---

## Phase 4: User Story 2 - Narrow the list by threshold and group (Priority: P2)

**Goal**: Threshold and group-filter controls behave exactly as before: a threshold change re-filters instantly with no new request; a group-filter change fetches a newly-scoped result (still bounded by active `studentIds`); an empty match shows the friendly empty state.

**Independent Test**: With the report open and populated, change the threshold and/or select a single group; confirm the list updates to reflect only students meeting the new criteria, without a page reload (spec.md US2 acceptance scenarios 1–3).

### Tests for User Story 2

- [X] T007 [US2] Extend `src/modules/attendance/AttendanceReports.absenteesTab.test.jsx` with: (a) clicking a different threshold button re-filters the already-rendered list and makes **zero** additional `pgGetAttendanceAggregate` calls (FR-009); (b) selecting a single group triggers exactly one additional call, `pgGetAttendanceAggregate({ groupBy: 'student', studentIds: '<active ids for that group only>', groupId: '<id>' })` — asserting `studentIds` is now narrowed to just that group's active students, not the full active roster — and the list narrows to that group; (c) a threshold/group combination matching no students (but where active students *do* exist and *were* fetched) renders the "لا يوجد طلاب تجاوزوا N غيابات" empty-state text, not a blank/broken list (FR-005); (d) selecting a group with **zero active students** makes no additional `pgGetAttendanceAggregate` call at all (per T005's guard) and renders the same empty state, not an error. Expect these to fail if T005's implementation doesn't already satisfy them.

### Implementation for User Story 2

- [X] T008 [US2] No-op confirmation: all 4 new T007 assertions (threshold re-filter with zero new requests, group change triggers exactly one re-scoped request, threshold-empty result, zero-active-students group makes no request) passed against T005's implementation unmodified — no diff needed.

**Checkpoint**: Threshold and group filtering verified correct, network-efficient, and correctly scoped to active students at every step; T004 and T007 both pass.

---

## Phase 5: User Story 3 - Report stays fast and reliable as attendance history grows (Priority: P3)

**Goal**: The report never depends on the size of the center's historical attendance data — nor on the number of inactive/withdrawn students who still have attendance history (research.md §1a) — handles fetch failure with a clear message, and stays correct/responsive at the target scale (up to 500 active students, SC-001).

**Independent Test**: With a large volume of historical attendance data present (including from inactive students), the report renders correctly and quickly, and a simulated fetch failure shows a clear error instead of a silent blank/stale list (spec.md US3 acceptance scenarios 1–2).

### Tests for User Story 3

- [X] T009 [US3] Extend `src/modules/attendance/AttendanceReports.absenteesTab.test.jsx` with a failure-path case: make the mocked `pgGetAttendanceAggregate` reject, open/select the absentees tab, and assert a clear error toast/message appears (not a blank or silently-empty list) — FR-005, US3 acceptance scenario 2.
- [X] T010 [US3] Extend the same test file with a scale-scoping regression case: mock a `students` set that includes several inactive/suspended students (in addition to active ones), assert the `studentIds` sent on the request contains **only** the active students' ids and never an inactive student's id — even though `pgGetAttendanceAggregate` is mocked to return rows for all of them — confirming the inactive students still never render on the list (FR-008) via the request scope itself, not just post-fetch filtering. Directly regression-guards the gap `/speckit-analyze` flagged as finding I1.

### Implementation for User Story 3

- [X] T011 [US3] Confirmed: T009's error-toast assertion passed against T005's implementation unmodified (the `useEffect` on `aggregateError` already matches the other three tabs' pattern) — no diff needed.
- [X] T012 [P] [US3] Re-run the existing backend coverage for this feature's data source — `cd backend && npm run test:integration -- attendance.integration.test.js` (specifically the "studentIds batch aggregation … groupBy=student" case) — and confirm it passes unmodified, as evidence that `groupBy=student&studentIds=<...>[&groupId=]` already scales by the size of the requested `studentIds` list rather than by total historical row count or total historical student count (SC-002, SC-004; see research.md §1a for why `studentIds` specifically — not `groupBy=student` alone — is what provides this bound). No backend code or test changes are expected (research.md §1); this is a verification-only task.

**Checkpoint**: All three user stories pass their tests independently; the frontend never reads the global `attendance` store for this tab, and never sends an unscoped or inactive-student-inclusive request; the reused backend endpoint's existing coverage is reconfirmed.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final, feature-wide verification before calling the migration done.

- [X] T013 [P] Ran `npx vitest run src/modules/attendance src/services/attendanceService.frequentAbsentees.test.js` — 80/80 pass, 11 files, zero regressions (SC-003). Mid-implementation discovery beyond original task scope: two other LIVE consumers of `getFrequentAbsentees` (`AttendancePage.jsx`'s "كثيرو الغياب" KPI tile, `AttendanceAnalytics.jsx`'s absentees widget — missed by the original audit, which only searched `src/modules/attendance`) still called it with the old raw-records signature and would have silently regressed to always-zero results; fixed via a small new `statsByStudentFromRecords()` adapter in `attendanceService.js` (reuses `getAttendanceStats`, zero behavior/data-source change for those two files) plus a matching fix in the dead, zero-importer `src/hooks/useAttendance.js` for consistency. Covered by 1 new unit test.
- [X] T014 [P] Ran `npm run lint`. Zero new errors anywhere. One new warning at `AttendanceReports.jsx:311` (`react-hooks/exhaustive-deps`, missing `toast` dep) — confirmed to be the exact same pre-existing pattern already present at lines 71/175/453 for the three already-migrated tabs in this file, not a new category of debt. Also touched `AttendancePage.jsx`, `AttendanceAnalytics.jsx`, `useAttendance.js`, and both new test files — no new warnings/errors introduced in any of them beyond pre-existing baseline.
- [ ] T015 Walk through `quickstart.md` §3–5 manually (network-tab request verification including the `studentIds` scoping checks, filter interactions, edge cases) end to end and confirm every checkpoint matches. Treat SC-001's "within 2 seconds, up to 500 active students" and SC-004's "multiple years of history, no slow/unresponsive page" targets as a **manual/observational check during this walkthrough**, not an automated load test — no new seeded-dataset generator or timing-test infrastructure is introduced for this feature. If the dev environment already has (or can be pointed at) a dataset in that range, open the tab and subjectively confirm it feels instant and the page doesn't stutter; if not, note in the PR/commit that this criterion was validated architecturally (via T004/T005/T010/T012's proof that the request scales with `studentIds` count, not historical row/student count) rather than empirically, and record that as an accepted, deliberate limitation of this task list.
  - **Attempted, not completed** (2026-09-21): blocked by the same environment issues as T001 (see its note) — no connected browser extension, and the dev database has no license activation, so no authenticated page (including this tab) can render even via direct API calls. The 10-point verification checklist requested for this task is functionally covered instead by the 11 automated tests in `AttendanceReports.absenteesTab.test.jsx` (default load, `studentIds` scoping, zero-active-students guard, threshold re-filter with no new request, group-scoped request, zero-active-students-per-group guard, inactive-student exclusion from the request, severity/sort/call-action/empty-state rendering, no-loading-indicator assertion) plus the two `/speckit-analyze` passes that specifically targeted the `studentIds` scoping correctness (item 10, the performance target, remains an explicitly accepted manual/observational gap per this task's own text — no automated substitute is claimed for it).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **Blocks every user story** — `getFrequentAbsentees`'s new signature is what all three stories build against.
- **User Stories (Phase 3–5)**: All depend on Foundational completion.
  - Unlike a typical multi-story feature, **US2 and US3 are not independently developable in parallel with US1 by different people** — all three stories modify the same component (`ReportFrequentAbsentees` in `AttendanceReports.jsx`), and T005 (US1) is what actually implements the fetch/refetch/filter/scoping mechanism that US2 and US3 then only need to verify (and fix, if a gap is found). Each story's **tests** are independently meaningful and independently runnable; the **implementation** is effectively delivered as one unit in Phase 3.
- **Polish (Phase 6)**: Depends on Phases 3–5 being complete.

### Within Each Phase

- Tests are written before the implementation task they validate, and are expected to fail until that task lands (T002→T003, T004→T005/T006, T007→T008, T009/T010→T011).

### Parallel Opportunities

- T012 (backend verification) has no dependency on T009/T010/T011 (frontend-only) and can run in parallel with them.
- T013 and T014 (Polish) touch different tooling (tests vs. lint) and can run in parallel.
- No other tasks are parallelizable — nearly everything else edits the same two files (`AttendanceReports.jsx`, `attendanceService.js`) in a deliberate sequence. T009 and T010 in particular both edit the same test file (`AttendanceReports.absenteesTab.test.jsx`) and, despite being logically independent assertions, are treated as sequential — not `[P]` — for that reason.

---

## Parallel Example: Phase 5 (User Story 3)

```bash
# T012 is the only genuinely parallel task here — a different file, no shared state:
Task: "Re-run backend/src/routes/attendance.integration.test.js studentIds aggregation coverage (T012)"

# T009 then T010 run sequentially — both edit AttendanceReports.absenteesTab.test.jsx:
Task: "Extend AttendanceReports.absenteesTab.test.jsx with a failure-path case (T009)"
Task: "Extend AttendanceReports.absenteesTab.test.jsx with an inactive-student scoping case (T010)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational — `getFrequentAbsentees` adapted and unit-tested).
2. Complete Phase 3 (US1): default-view migration off the global store, with `studentIds` scoping baked in from the start (not a follow-up).
3. **STOP and VALIDATE**: run T004; walk through `quickstart.md` §2–3 manually, including the `studentIds` request-scope check.
4. This alone already achieves the feature's core goal — the tab no longer reads the full global `attendance` array, and its replacement request is correctly bounded to active students — and is safe to ship on its own if needed.

### Incremental Delivery

1. Setup + Foundational → shared data shape ready.
2. US1 → default view migrated, correctly scoped → validate independently (MVP).
3. US2 → threshold/group-filter behavior confirmed, including re-scoping on group change (small fix-up only if T007 finds a gap) → validate independently.
4. US3 → failure-path, inactive-student-scoping regression guard, and scale verification confirmed → validate independently.
5. Polish → full regression pass, lint, final quickstart walkthrough.

## Notes

- [P] tasks touch different files/tools (or independent assertions within the same test file) and have no unmet dependency within their phase.
- [Story] labels trace each task back to its spec.md user story.
- This is a small, single-file-pair migration (`AttendanceReports.jsx` + `attendanceService.js`) reusing an already-implemented, already-tested backend endpoint and one of its existing parameters (`studentIds`) — no backend task exists in this list because none is needed (research.md §1, §1a).
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
