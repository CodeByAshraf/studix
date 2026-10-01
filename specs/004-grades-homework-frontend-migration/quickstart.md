# Quickstart: Validating the Grades + Homework Submissions Frontend Migration (Batch A)

Frontend-only feature; validation is primarily automated tests, with an optional manual
browser walkthrough.

## Prerequisites

- `npm install` at repo root (if not already done).
- Feature 003's backend routes (`GET /api/grades`, `GET /api/hwSubmissions`,
  `GET /api/hwSubmissions/aggregate`) already exist and are unchanged by this feature — no
  backend setup beyond what's already in the repo.

## Automated validation (primary path)

From repo root:

```sh
npm run test -- StudentsPage GradeEntry ExamResults HomeworkTracking HomeworkPage HomeworkReports StudentProfile
```

Or the full frontend suite:

```sh
npm run test
```

**Expected scenarios covered** (per spec.md Success Criteria), each mocking
`src/services/api.js`'s new functions via the established `vi.mock('.../services/api', ...)`
pattern:

- `StudentsPage.test.jsx` — delete blocked when `pgGetGrades`/`pgGetHwSubmissions` resolve with
  ≥1 row; delete proceeds when both resolve empty; a failed check blocks delete with a toast
  (SC-004).
- `StudentProfile.test.jsx` (or a new sibling) — `ExamsTab` stats match a known fixture's
  hand-computed average/passed/absent counts; empty state only shows once loaded, not during the
  loading window (SC-001, SC-003).
- `ExamResults.test.jsx` (NEW) — stats/ranking/distribution match a known fixture exactly; empty
  state gated correctly (SC-001, SC-003).
- `GradeEntry.test.jsx` — pre-filled scores/absences match a known fixture exactly, verified
  AFTER the mocked fetch resolves (not asserted synchronously at mount, since the form must not
  render its editable state until loaded — research.md §5); save behavior unchanged (SC-001).
- `HomeworkTracking.test.jsx`/`.print.test.jsx` — pre-filled statuses/scores/notes match a known
  fixture exactly, verified after load; print report content unchanged (SC-001).
- `HomeworkPage.test.jsx`/`.groupFilter.test.jsx` — KPI `totalSub` and every row's
  submitted/late/missing match a known aggregate fixture, verified to fetch the per-homework
  aggregate exactly once regardless of row count (SC-001, SC-002).
- `HomeworkReports.groupFilter.test.jsx` — all 4 tabs' and the summary's counts match a known
  aggregate fixture exactly, verified to fetch each aggregate exactly once per view (SC-001,
  SC-002).

## Manual spot-check (optional)

Not required for completion (automated tests are the source of truth), but useful for a human
sanity check:

1. Start the dev backend and frontend (`npm run dev` in `backend/`, `npm run dev` at repo root).
2. Open a student's profile → Exams tab; confirm the same results/stats as before migration for
   a known student.
3. Open Grade Entry for an exam with existing grades; confirm every score pre-fills correctly
   before making any edit.
4. Open Homework Tracking for an assignment with existing submissions; confirm every
   status/score/notes pre-fills correctly, then print the report and compare to a
   pre-migration printout.
5. Open the Homework list and Homework Reports; confirm the KPI, per-row breakdown, and every
   report tab's numbers match what they showed before migration.
6. Attempt to delete a student known to have grades or homework submissions; confirm the same
   block message appears.

## Regression check (required before calling this feature done)

```sh
npm run test
npm run build
```

No existing test file outside the 9 listed consumers' own test files should need to change
(FR-005/FR-012, SC-005) — if the deferred consumers' tests (Grades average, ReportsPage,
StudentPerformance, ExamReports, HomeworkSearch) need any change, that is a signal scope has
drifted beyond this feature's boundary.
