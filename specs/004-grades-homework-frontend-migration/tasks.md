# Tasks: Grades + Homework Submissions Frontend Migration (Batch A)

**Input**: Design documents from `/specs/004-grades-homework-frontend-migration/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Explicitly requested in spec.md — folded into T006 (its own task) rather than
interleaved per-consumer, per the requested 8-10-task sizing.

**Scope reminder (applies to every task below)**: frontend-only, additive/replacing data source
only. No task may touch `backend/`, the Prisma schema, `PG_COLLECTIONS`, Zustand `partialize`,
the grades average/ranking aggregate (Grades module, ReportsPage, StudentPerformance,
ExamReports), `HomeworkSearch.jsx`, the installer, licensing, or WhatsApp-related code. No task
may change `pgSaveExamGrades`, `pgSaveHwSubmissions`, `pgDeleteStudent`, or feature 003's backend
routes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Maps to spec.md's User Story 1-4 (US1/US2 P1, US3 P2, US4 P3)

## Path Conventions

Existing `src/` (frontend) — no `backend/` paths appear in this task list.

---

## T001 — Inspect current consumers and finalize `api.js` contracts

**Purpose**: Every later task depends on these three functions existing and being correctly
normalized (research.md §2, data-model.md) before any consumer can be migrated.

- [x] T001 In `src/services/api.js`, add `pgGetGrades(params)`, `pgGetHwSubmissions(params)`,
  `pgGetHwSubmissionsAggregate(params)`, following the exact `pgGetAttendance`/`pgGetPayments`/
  `pgGetCommunications` fetch-wrapper shape (base URL, `credentials:'include'`,
  `{ok,error}`/`Array.isArray(data)` checks, thrown `Error` on failure). Add two private
  normalizer helpers, `normalizeGradeResponse`/`normalizeHwSubmissionResponse`, mirroring
  `src/store/db.middleware.js`'s `COLLECTION_FIXUPS.grades`/`.hwSubmissions` exactly (data-model.md —
  numeric `score`, `homeworkId`→`hwId` rename, date-only `submittedAt`). `pgGetGrades`/
  `pgGetHwSubmissions` each `.map()` their normalizer over the response; `pgGetHwSubmissionsAggregate`
  needs no normalization (contracts/hw-submissions-aggregate-consumers.md). Re-verify against the
  live `db.middleware.js`/`api.js` files that no drift has occurred since research.md/data-model.md
  were written (same grounding-verification principle as feature 003's T001) — report any drift
  before proceeding to T002+.

**Checkpoint**: All three client functions exist, correctly normalized, ready to import.

---

## T002 [US1][US2] — Migrate Grades scoped consumers (items 1-4)

**Purpose**: `StudentProfile`'s Exams tab, `ExamResults`, `GradeEntry`, and `StudentsPage`'s
grades delete-guard check all read from `pgGetGrades` instead of the global store array, with
every number and the delete guard's blocking behavior unchanged (spec.md User Stories 1-2).

**Independent Test**: Open each grade-related screen for a student/exam with known grades and
confirm identical stats/pre-fill/ranking to before migration; attempt to delete a student with
recorded grades and confirm the block still occurs.

- [x] T002a `src/modules/students/StudentProfile.jsx`'s `ExamsTab`: replace the `grades` prop's
  store source with `useAsyncData(() => pgGetGrades({studentId: student.id}), [student.id], [])`;
  gate the "لا توجد نتائج بعد" empty-state behind `loading===false` (research.md §5 —
  `useMemo`-derived, reactive; gating is for the empty-state flash only). **Error state (closes
  analyze finding U1, FR-011)**: add a `useEffect` on the hook's `error` that calls
  `toast.error(error.message || '<Arabic fallback>')`, the same convention
  `AttendanceAnalytics.jsx` already uses for its own `useAsyncData` calls — no new error-UI
  component. Per contracts/grades-scoped-consumers.md Consumer 2.
- [x] T002b `src/modules/exams/ExamResults.jsx`: replace the `grades` store selector with
  `useAsyncData(() => pgGetGrades({examId: exam.id}), [exam.id], [])`; gate the "لم يتم إدخال
  الدرجات بعد" empty-state behind `loading===false`. `getExamStatsWithPass`/`eligibleStudents`/
  `ranked`/distribution stay unchanged (reactive `useMemo`). **Error state (closes analyze
  finding U1, FR-011)**: same `useEffect`-on-`error`→`toast.error(...)` convention as T002a. Per
  contracts/grades-scoped-consumers.md Consumer 3.
- [x] T002c `src/modules/exams/GradeEntry.jsx`: replace the `grades` store selector with
  `useAsyncData(() => pgGetGrades({examId: exam.id}), [exam.id], [])`, used only to seed
  `localGrades`. **Correctness requirement, not cosmetic (research.md §5)**: do not mount the
  editable grade-row table (whose `localGrades` is a one-time `useState` lazy initializer) until
  `loading===false` — render a loading placeholder until then, so the lazy initializer runs
  against real data, never an empty placeholder. **Error state (closes analyze finding U1,
  FR-011)**: same `useEffect`-on-`error`→`toast.error(...)` convention as T002a, shown in
  addition to the loading placeholder. `handleSave`'s `pgSaveExamGrades` call and its
  `setGrades(...)` global-store sync stay completely unchanged. Per
  contracts/grades-scoped-consumers.md Consumer 4.
- [ ] T002d `src/modules/students/StudentsPage.jsx`'s `handleDelete` (grades half): replace
  `grades.filter(g => g.studentId === s.id).length` with `(await pgGetGrades({studentId:
  s.id})).length`, using the exact try/catch-block-delete-on-failure shape already used two
  checks below it for `pgGetPayments`/`pgGetCommunications`. Per
  contracts/grades-scoped-consumers.md Consumer 1. (Implement together with T003d — same
  function, same file, do not split across two edit passes.)

**Checkpoint**: Every grades-scoped consumer migrated, independently testable via T006.

---

## T003 [US2][US3] — Migrate Homework Submissions scoped consumers (items 5-6)

**Purpose**: `HomeworkTracking` and `StudentsPage`'s hwSubmissions delete-guard check read from
`pgGetHwSubmissions` instead of the global store array (spec.md User Stories 2-3).

**Independent Test**: Open tracking for an assignment with known submissions and confirm
identical pre-fill/print output to before migration; attempt to delete a student with recorded
homework submissions and confirm the block still occurs.

- [x] T003a `src/modules/homework/HomeworkTracking.jsx`: replace the `hwSubmissions` store
  selector with `useAsyncData(() => pgGetHwSubmissions({homeworkId: hw.id}), [hw.id], [])`, used
  to seed `localSubs` AND passed to `openHomeworkReportPrint(...)`. **Correctness requirement,
  not cosmetic (research.md §5)**: do not mount the editable submission-status table (whose
  `localSubs` is a one-time `useState` lazy initializer) until `loading===false`; the print
  button must only be reachable once real data has loaded. **Error state (closes analyze finding
  U1, FR-011)**: add a `useEffect` on the hook's `error` that calls `toast.error(error.message ||
  '<Arabic fallback>')`, the same convention `AttendanceAnalytics.jsx` already uses — shown in
  addition to the loading placeholder, no new error-UI component. `handleSave`'s
  `pgSaveHwSubmissions` call and its `setHwSubmissions(...)` global-store sync stay completely
  unchanged. Per contracts/hw-submissions-scoped-consumers.md Consumer 6.
- [ ] T003d `src/modules/students/StudentsPage.jsx`'s `handleDelete` (hwSubmissions half):
  replace `hwSubmissions.filter(h => h.studentId === s.id).length` with `(await
  pgGetHwSubmissions({studentId: s.id})).length`, same try/catch shape as T002d. Implement
  together with T002d in the same edit pass. Per contracts/hw-submissions-scoped-consumers.md
  Consumer 5.

**Checkpoint**: Every hwSubmissions-scoped consumer migrated, independently testable.

---

## T004 [US4] — Migrate HomeworkPage aggregates (items 7-8)

**Purpose**: `HomeworkPage`'s center-wide KPI and per-row breakdown read from
`pgGetHwSubmissionsAggregate` (both dimensions), fetched once per page view, not once per row
(spec.md User Story 4, FR-007/SC-002).

**Independent Test**: Open the homework list with a known mix of submitted/late/missing
submissions across several assignments; confirm the KPI and every row's breakdown match a direct
count, with only 2 aggregate requests total regardless of row count.

- [x] T004 `src/modules/homework/HomeworkPage.jsx`: add
  `useAsyncData(() => pgGetHwSubmissionsAggregate({groupBy:'status'}), [], [])` for
  `kpi.totalSub` (read the `submitted` entry's `count`) and
  `useAsyncData(() => pgGetHwSubmissionsAggregate({groupBy:'homework'}), [], [])` for
  `getHwStats` — build `new Map(perHomeworkAgg.map(r => [r.key, r]))` ONCE per page view;
  `getHwStats(hw)` looks up `map.get(hw.id)` instead of filtering `hwSubmissions` per row.
  **Required (FR-008)**: `total` stays `getHomeworkEligibleStudents(hw, students).length` — never
  the aggregate row's own `total` field. Per contracts/hw-submissions-aggregate-consumers.md
  Consumers 7-8.

**Checkpoint**: HomeworkPage's submission-data dependency on the global store is fully removed.

---

## T005 [US4] — Migrate HomeworkReports only where exact semantics are supported (item 9)

**Purpose**: All 4 report tabs and the summary totals read from the same two page-level
aggregates as T004 — confirmed fully reproducible, no deferred sub-part (research.md §7).

**Independent Test**: Open each of the 4 report tabs and confirm every group's and every
homework row's counts, and the top-level summary, match a direct count over the same seeded
data.

- [x] T005 `src/modules/homework/HomeworkReports.jsx`: replace the `hwSubmissions` store
  selector with the same two `pgGetHwSubmissionsAggregate` calls as T004 (`groupBy:'status'` for
  the summary totals, `groupBy:'homework'` for `getStats`, same total-stays-eligible-count rule).
  `getStats(hwList)` is called identically by all 4 tabs and the summary — migrate it once, all 5
  call sites benefit. Per contracts/hw-submissions-aggregate-consumers.md Consumer 9. **Confirm
  during implementation that no dimension needs anything beyond these two aggregates; if one is
  found, STOP and flag it — do not invent a new endpoint or approximate** (spec.md's semantic
  rule) — per current grounding, no such case is expected.

**Checkpoint**: All 9 consumers migrated. No file still reads the global `grades`/
`hwSubmissions` store arrays except the explicitly deferred ones and the two intentionally-kept
write-path `setGrades`/`setHwSubmissions` sync calls (T002c/T003a).

---

## T006 — Focused regression tests (covers all 9 consumers)

**Purpose**: Verify every migrated call site's numerical/behavioral equivalence, empty/loading/
error states, delete-guard blocking, and aggregate correctness — per spec.md's testing
requirement and quickstart.md's per-file breakdown.

- [ ] T006a `[P]` Extend `StudentsPage.test.jsx`: mock `pgGetGrades`/`pgGetHwSubmissions`,
  assert delete is blocked when either resolves ≥1 row (same message format), proceeds when both
  resolve empty, and is blocked (not silently allowed) if either call rejects.
- [x] T006b `[P]` Extend `StudentProfile.test.jsx` (or its family): mock `pgGetGrades`, assert
  `ExamsTab`'s average/passed/absent counts match a known fixture, empty-state gated correctly.
  **(Closes analyze finding U1)**: add a focused assertion that when `pgGetGrades` rejects, a
  visible error toast/message appears (asserted via the mocked toast call, same technique already
  used for this app's other `useAsyncData` error-path tests).
- [x] T006c `[P]` Create `ExamResults.test.jsx` (does not exist today): mock `pgGetGrades`,
  assert stats/ranking/distribution match a known fixture, empty-state gated correctly.
  **(Closes analyze finding U1)**: add a focused assertion that a rejected `pgGetGrades` call
  produces a visible error state.
- [x] T006d `[P]` Extend `GradeEntry.test.jsx`: mock `pgGetGrades`, assert pre-filled
  scores/absences match a known fixture, verified AFTER the mocked fetch resolves (not
  synchronously at mount); assert save behavior unchanged. **(Closes analyze finding U1)**: add a
  focused assertion that a rejected `pgGetGrades` call produces a visible error state (in
  addition to, not instead of, the loading-placeholder assertion).
- [x] T006e `[P]` Extend `HomeworkTracking.test.jsx`/`.print.test.jsx`: mock
  `pgGetHwSubmissions`, assert pre-filled status/score/notes match a known fixture (after load),
  printed report content unchanged. **(Closes analyze finding U1)**: add a focused assertion that
  a rejected `pgGetHwSubmissions` call produces a visible error state.
- [x] T006f `[P]` Extend `HomeworkPage.test.jsx`/`.groupFilter.test.jsx`: mock
  `pgGetHwSubmissionsAggregate`, assert KPI and every row's breakdown match a known aggregate
  fixture, and the per-homework aggregate is fetched exactly once regardless of row count
  (SC-002).
- [x] T006g `[P]` Extend `HomeworkReports.groupFilter.test.jsx`: mock
  `pgGetHwSubmissionsAggregate`, assert all 4 tabs' and the summary's counts match a known
  aggregate fixture, each dimension fetched exactly once per view (SC-002).

**Checkpoint**: Every FR in spec.md tied to a specific consumer (FR-001 through FR-011) has
direct automated coverage.

---

## T007 — Global-consumer verification

**Purpose**: Confirm no other file still reads the global `grades`/`hwSubmissions` store arrays
unexpectedly, and every explicitly deferred consumer is genuinely untouched (spec.md FR-012).

- [x] T007 Search the entire `src/` tree for remaining `useAppStore((s) => s.grades)`/
  `useAppStore((s) => s.hwSubmissions)` selectors (and any other direct reads). Confirm the only
  remaining ones are: (a) the two intentionally-kept write-path sync calls (T002c/T003a), and
  (b) the explicitly deferred consumers (Grades module's own average, `ReportsPage.jsx`,
  `StudentPerformance.jsx`, `ExamReports.jsx`, `HomeworkSearch.jsx`, and any dead/unused hooks
  already identified in prior inventories as having zero real importers). Report any unexpected
  remaining consumer before proceeding — do not silently migrate or silently leave it.

**Checkpoint**: The migrated/deferred boundary matches spec.md exactly, confirmed against the
live codebase.

---

## T008 — Production build + full relevant regression

**Purpose**: Prove this feature builds cleanly and introduces no regression outside its own 9
consumers (SC-006).

- [ ] T008 Run `npm run test` (full frontend suite) and `npm run build` (production build) from
  repo root. Confirm every pre-existing test still passes unmodified and the build succeeds with
  no new errors. Spot-check via `git diff`/`git status` that no file outside `src/services/api.js`,
  the 7 consumer component files, and the test files touched in T006 was changed. Document any
  pre-existing failure unrelated to this feature plainly (same "defer, document, don't
  approximate" convention established in feature 003), rather than weakening this check.

**Checkpoint**: Feature builds and passes its full regression scope.

---

## T009 — Final read-only diff/scope audit

**Purpose**: Confirm the feature stayed exactly within its declared boundary before calling it
done.

- [ ] T009 Read-only audit: confirm (a) no file under `backend/` was touched, (b) the Prisma
  schema, `PG_COLLECTIONS`, and `partialize` are unchanged, (c) `pgSaveExamGrades`/
  `pgSaveHwSubmissions`/`pgDeleteStudent` are byte-identical to their pre-feature state except
  for the two read-side call-site edits within `handleDelete` (T002d/T003d), which do not touch
  the save functions themselves, (d) every deferred consumer named in spec.md's Edge Cases still
  reads its original full-collection source, and (e) `HomeworkReports.jsx`'s migration (T005)
  ended up complete, not partial, per research.md §7's prediction — report explicitly if it did
  not, rather than silently shipping a partial migration framed as complete.

**Checkpoint**: Feature complete and independently verifiable; scope matches spec.md exactly.

---

## Dependencies & Execution Order

- **T001**: No dependencies — start immediately. **Blocks every other task.**
- **T002, T003, T004, T005**: Each depends only on T001. T002/T003/T004/T005 touch 5 distinct
  files (`StudentProfile.jsx`, `ExamResults.jsx`, `GradeEntry.jsx`, `HomeworkTracking.jsx`,
  `HomeworkPage.jsx`, `HomeworkReports.jsx`) plus one shared file (`StudentsPage.jsx`, edited
  once across T002d+T003d together) — **may run in parallel** except T002d/T003d, which must be
  done together in one pass.
- **T006**: Each sub-item depends on its own implementation task (T006a↔T002d/T003d,
  T006b↔T002a, T006c↔T002b, T006d↔T002c, T006e↔T003a, T006f↔T004, T006g↔T005) — **all 7 may run
  in parallel** once their dependencies land.
- **T007**: Depends on T002-T005 all being done.
- **T008**: Depends on T006-T007.
- **T009**: Depends on T008.

### Parallel Opportunities

- T002a/T002b/T002c, T003a, T004, T005 (6 independent files, all depending only on T001).
- T006a-T006g (7 independent test files/suites), once their respective implementation lands.

---

## Implementation Strategy (for future reference — NOT executed in this planning-only pass)

1. T001 → {T002, T003, T004, T005} in parallel where files differ (T002d/T003d share
   `StudentsPage.jsx`, done together) → T006 (all sub-items in parallel once ready) → T007 → T008
   → T009.
2. MVP slice, if ever staged incrementally: T001 → T002d+T003d (both delete-guard halves) →
   T006a alone already delivers spec.md's highest-priority User Story 2 (the safety-critical
   delete guard) with full test coverage, independent of every other consumer.

**No implementation occurs as part of this planning pass.** This `tasks.md` is the Phase 2
output of the Spec Kit workflow (`/speckit-plan` → `/speckit-tasks`), produced strictly for
review; `/speckit-implement` has not been invoked.
