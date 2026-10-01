# Tasks: Grades + Homework Submissions Backend Read Foundation

**Input**: Design documents from `/specs/003-grades-homework-read-foundation/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Explicitly requested in spec.md ("comprehensive integration tests" is a named
requirement, mirroring `attendance.integration.test.js`) — test tasks are included.

**Scope reminder (applies to every task below)**: backend-only, additive. No task may touch the
frontend (`src/`), `PG_COLLECTIONS`, `partialize`, the Prisma schema, the installer, the grades
average/ranking aggregate, or the existing `/api/exam-grades` / `/api/hw-submissions` atomic
write routers.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Maps to spec.md's User Story 1-4 (P1/P1/P2/P3)

## Path Conventions

Web app split already in place: `backend/src/routes/` for all new files in this feature. No
`frontend/`/`src/` paths appear in this task list.

---

## Phase 1: Setup

**Purpose**: Confirm the live codebase still matches the assumptions research.md/data-model.md/
contracts/ were written against, before any file is created.

- [X] T001 Verify grounding assumptions against the current codebase: re-read
  `backend/src/server.js`'s `COLLECTION_PERMISSIONS` map (confirm `grades: 'exams'`,
  `hwSubmissions: 'homework'` still present, currently lines 112-113), the exact insertion point
  for new `app.use(...)` mount lines (immediately before the
  `for (const [apiPath, modelName] of Object.entries(COLLECTION_MODELS))` loop, currently
  starting at line 386), and `backend/src/routes/collections.js`'s `COLLECTION_MODELS` entries
  (`grades: 'grades'`, `hwSubmissions: 'hw_submissions'`, currently lines 31-32). Confirm
  `backend/src/routes/attendance.js` is unchanged since research.md was written (still the
  reference implementation). Report any drift before proceeding to T002-T004; if none, this task
  is a no-op confirmation.
  **DRIFT FOUND**: `backend/src/routes/hwSubmissions.js` already exists — it is the existing
  atomic roster-write router (`PUT /:homeworkId`, mounted at the hyphenated
  `/api/hw-submissions`, imported in `server.js` as `hwSubmissionsRouter`). plan.md/tasks.md's
  assumption that this filename was free (by analogy with `attendance.js`) was wrong — unlike
  attendance, whose write router has a distinct name (`attendanceSessions.js`), hwSubmissions'
  write router kept the bare collection name. **Resolution**: the new scoped-read router for
  hwSubmissions is named `backend/src/routes/hwSubmissionsScopedGet.js` instead (mirroring the
  `*ScopedGet` suffix convention already used for `paymentsScopedGet.integration.test.js` /
  `communicationsScopedGet.integration.test.js`), imported as `hwSubmissionsScopedGetRouter`.
  The existing `hwSubmissions.js` file and its `/api/hw-submissions` mount are completely
  untouched. All task references below (T003, T004, T006, T007, T008) are updated accordingly.
  `grades.js` had no such collision (its write router is `examGrades.js`) and needed no change.

**Checkpoint**: No Foundational phase is needed beyond T001 — this feature reuses
`attendance.js`'s already-proven architecture and existing middleware/helpers directly; there is
no new shared infrastructure, schema, or auth framework to build first.

---

## Phase 2: User Story 1 + User Story 2 — Grades scoped by student / by exam (Priority: P1) 🎯 MVP

**Goal**: `GET /api/grades?studentId=` and `?examId=` (composable) return only matching grade
rows, with unscoped calls unchanged (spec.md User Stories 1-2).

**Independent Test**: Seed a student with several grades across exams and an exam with grades
from several students; confirm `studentId`-scoped and `examId`-scoped requests each return
exactly the matching rows, and that an unscoped call still matches the existing generic route.

- [X] T002 [P] [US1] [US2] Create `backend/src/routes/grades.js`: `GET /` scoped by `studentId`
  and `examId` (AND-composed via a single Prisma `where`, both optional), reusing
  `snakeToCamel`/`serializeBigInt`/`asyncHandler` exactly as `attendance.js` does, returning
  `{ok:true, data, count}`; no params → identical query/shape to today's generic
  `GET /api/grades`. **Empty-but-present param rule (FR-010, closes analyze finding U1)**: if
  `studentId` or `examId` is present on the query string but empty, reject with 400 via a
  `badRequest()`-style helper before any Prisma call; if the key is absent entirely, treat it as
  no filter for that dimension. Follow `contracts/grades-get.md` and the Grade Record section of
  `data-model.md` exactly — no `groupBy`/aggregate route in this file (FR-012, deferred to
  Grades Batch B). Export the router as `default`, matching `attendance.js`'s export shape.

**Checkpoint**: Grades scoped list is implementable and independently testable (via T006) without
touching `hwSubmissions.js`.

---

## Phase 3: User Story 3 — Homework submissions scoped by student / by assignment (Priority: P2)

**Goal**: `GET /api/hwSubmissions?studentId=` and `?homeworkId=` (composable) return only
matching submission rows, with unscoped calls unchanged (spec.md User Story 3).

**Independent Test**: Seed a student with submissions across several assignments and an
assignment with submissions from several students; confirm each scoped request returns exactly
the matching rows.

- [X] T003 [P] [US3] Create `backend/src/routes/hwSubmissionsScopedGet.js` (renamed from the
  original `hwSubmissions.js` — see T001 drift note; that filename is already the existing
  write router): `GET /` scoped by `studentId`
  and `homeworkId` (AND-composed, both optional), same shaping/response-shape conventions as
  T002, per `contracts/hw-submissions-get.md` and the Homework Submission Record section of
  `data-model.md`. No params → identical query/shape to today's generic `GET /api/hwSubmissions`.
  **Empty-but-present param rule (FR-010, closes analyze finding U1)**: same rule as T002 — if
  `studentId` or `homeworkId` is present but empty, reject with 400 before any Prisma call; if
  the key is absent entirely, treat it as no filter for that dimension. Export the router as
  `default`. (Runs in parallel with T002 — different file, no shared state.)

**Checkpoint**: Homework-submissions scoped list is implementable and independently testable
without the aggregate endpoint existing yet.

---

## Phase 4: User Story 4 — Homework submission status / per-assignment summaries (Priority: P3)

**Goal**: `GET /api/hwSubmissions/aggregate?groupBy=status` and `?groupBy=homework` return counts
matching a direct count over the same rows (spec.md User Story 4).

**Independent Test**: Seed a mix of submitted/late/missing submissions across several
assignments; confirm the status summary and per-assignment summary each match a manual count,
and that an invalid `groupBy` value is rejected before any lookup.

- [X] T004 [US4] Add `GET /aggregate` to `backend/src/routes/hwSubmissionsScopedGet.js` (same
  file as T003 — **sequential with T003, not parallel**): `groupBy=status` via
  `prisma.hw_submissions.groupBy({by:['status'], _count:true})` (mirrors `attendance.js`'s
  `aggregateByStatus`), `groupBy=homework` via
  `prisma.hw_submissions.groupBy({by:['homework_id','status'], _count:true})` bucketed per
  assignment (mirrors `attendance.js`'s `aggregateByDimension`), both accepting optional
  `studentId`/`homeworkId` scope filters for consistency with T003's list route. Any other
  `groupBy` value → 400 via the same `badRequest()`-style allow-list rejection
  `attendance.js` uses. Follow `contracts/hw-submissions-aggregate.md` exactly. No
  `groupBy=student`, no date-range filter, no `threshold` (explicitly out of scope, research.md §5).

**Checkpoint**: All three new endpoints (grades list, hwSubmissions list, hwSubmissions
aggregate) are implemented and independently testable.

---

## Phase 5: Integration Tests (covers US1-US4)

**Purpose**: Real-PostgreSQL, real-Express integration coverage for every endpoint added in
Phases 2-4, mirroring `attendance.integration.test.js`'s structure and rigor.

- [X] T005 [P] [US1] [US2] Create `backend/src/routes/grades.integration.test.js`: mount only
  `grades.js` (no auth middleware, matching `attendance.integration.test.js`'s bare-router
  pattern) against a scratch Postgres DB via `backend/src/test-helpers/scratchDb.js`. Cover:
  `studentId`-only, `examId`-only, both composed, unscoped-identical-to-generic-route,
  empty-result cases (known id with no grades, unknown id), and response shape (`{ok,data,count}`,
  camelCase fields matching `data-model.md`'s Grade Record table). **Add one assertion for the
  U1 remediation**: `GET /?studentId=` (empty value) → 400, before any DB lookup. Record a single
  clear "SKIPPED" test if PostgreSQL is unreachable, per `attendance.integration.test.js`'s
  convention. (Runs in parallel with T006 — different file.)

- [X] T006 [P] [US3] [US4] Create `backend/src/routes/hwSubmissionsScopedGet.integration.test.js`
  (renamed — the original name collides with the existing write router's own test file; see T001
  drift note): mount only `hwSubmissionsScopedGet.js` against a scratch Postgres DB. Cover: `studentId`-only,
  `homeworkId`-only, both composed, unscoped-identical-to-generic-route, empty-result cases,
  `groupBy=status` counts matching a direct count over seeded rows, `groupBy=homework` counts
  matching a direct count per assignment, empty-scope aggregate results (`[]`, not an error),
  and invalid `groupBy` → 400 before any DB lookup. **Add one assertion for the U1 remediation**:
  `GET /?homeworkId=` (empty value) → 400, before any DB lookup. (Runs in parallel with T005 —
  different file.)

**Checkpoint**: Every FR in spec.md tied to a specific endpoint (FR-001 through FR-010, FR-013)
has direct automated coverage.

---

## Phase 6: Route Mounting & Security Verification

**Purpose**: Wire the two new routers into `server.js` exactly like `attendance.js`, and prove
the auth/permission boundary holds — the one piece of behavior that cannot be verified by T005/
T006 alone, since those mount the routers bare (no auth middleware), matching
`attendance.integration.test.js`'s own split from `phase4ScopedGetAuth.integration.test.js`.

- [X] T007 In `backend/src/server.js`, add exactly two additive `app.use(...)` lines
  immediately before the generic `COLLECTION_MODELS` loop (same position/style as the existing
  `app.use('/api/attendance', requireAuth, requirePermission('attendance'), attendanceRouter)`
  line): `app.use('/api/grades', requireAuth, requirePermission('exams'), gradesRouter)` and
  `app.use('/api/hwSubmissions', requireAuth, requirePermission('homework'),
  hwSubmissionsScopedGetRouter)`, with the matching `import` statements added alongside the
  existing `import attendanceRouter from './routes/attendance.js'` line — using the name
  `hwSubmissionsScopedGetRouter` (not `hwSubmissionsRouter`, which is already taken by the
  existing write router imported at the current `import hwSubmissionsRouter from
  './routes/hwSubmissions.js'` line; that line is untouched). No other line in `server.js` may
  change. Then create (or extend, if a shared file is preferred) an auth/permission boundary
  integration test — same structure as `phase4ScopedGetAuth.integration.test.js`'s `stubAuth` +
  real-Express-app-behind-`requirePermission` pattern — proving: a user with `exams` can call
  `GET /api/grades` (200), a user without it gets 403, unauthenticated gets 401; and the same
  three cases for `GET /api/hwSubmissions` (list and `/aggregate`) against the `homework`
  permission. (Depends on T002, T003, T004 existing.)
  **Result**: created `backend/src/routes/gradesHwSubmissionsAuth.integration.test.js` (new
  shared file, both collections) — 9 assertions covering the 200/403/401 matrix for
  `GET /api/grades`, `GET /api/hwSubmissions`, and `GET /api/hwSubmissions/aggregate`.

**Checkpoint**: Both routers are live on the real Express app behind the correct, already-proven
permission gates — no new permission model introduced (FR-008).

---

## Phase 7: Full Backend Verification & Audit

**Purpose**: Prove this feature changed nothing outside its own two new files + the two-line
`server.js` mount (FR-011, SC-004), before considering it complete.

- [X] T008 Run `cd backend && npm run test && npm run test:integration` (full existing suite,
  not just the two new files) and confirm every pre-existing test still passes unmodified. Spot-
  check via `git diff` that no file outside `backend/src/routes/grades.js`,
  `backend/src/routes/grades.integration.test.js`,
  `backend/src/routes/hwSubmissionsScopedGet.js`,
  `backend/src/routes/hwSubmissionsScopedGet.integration.test.js`, the T007 auth-test file, and
  the two-line `backend/src/server.js` mount change was touched — and explicitly confirm
  `backend/src/routes/hwSubmissions.js` (the existing write router) and
  `backend/src/routes/hwSubmissions.integration.test.js` (its existing test file) are byte-
  identical to their pre-feature state. Confirm the unscoped
  `GET /api/grades` and `GET /api/hwSubmissions` responses are byte-identical in shape to their
  pre-feature behavior (per T005/T006's unscoped-parity assertions). Walk `quickstart.md`'s
  Regression Check section and record the result. Document any environment blocker (e.g.
  PostgreSQL unreachable) plainly rather than weakening or skipping this verification — per the
  project's established "defer, document, don't approximate" convention.
  **Result**: `npm run test` — 746/746 passed. `npm run test:integration` (full suite) — 590/613
  passed, 12 skipped, 11 failed; all 11 failures isolated to `bootstrapDatabase.integration.test.js`
  and `databaseSwitch.integration.test.js` (files this feature never touches) with a Postgres
  advisory-lock-contention error; re-running those two files alone (single fork, no parallel
  workers) passed 40/40 — confirmed pre-existing parallel-worker flakiness, not a regression.
  New feature tests: 27/27 passed across the 3 new integration files. `git status`/`git diff`
  confirmed only the 5 new files + the intended 2-import/2-mount-line `server.js` diff were
  touched; `hwSubmissions.js` and `hwSubmissions.integration.test.js` (existing write router)
  are byte-identical to their pre-feature state. `npm run lint` (root) is scoped to `src`
  (frontend) only by its own script definition — backend has no ESLint config at all, pre-
  existing and unrelated to this feature — so no lint gate applies to these files.

**Checkpoint**: Feature complete and independently verifiable; no frontend, schema, installer, or
unrelated file was touched.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)**: No dependencies — start immediately.
- **US1+US2 (T002)** and **US3 (T003)**: Both depend only on T001; independent of each other —
  **may run in parallel**.
- **US4 (T004)**: Depends on T003 (same file, `hwSubmissions.js`) — sequential after T003, but
  independent of T002.
- **Integration Tests (T005, T006)**: T005 depends on T002; T006 depends on T003 **and** T004
  (since it covers the aggregate route too) — **T005 and T006 may run in parallel** with each
  other once their respective implementation tasks land.
- **Route Mounting & Security (T007)**: Depends on T002, T003, T004 all existing (needs both
  routers importable).
- **Full Verification (T008)**: Depends on everything above (T001-T007).

### Parallel Opportunities

- T002 and T003 (different files, `grades.js` vs `hwSubmissions.js`).
- T005 and T006 (different test files), once their respective implementation tasks are done.

---

## Implementation Strategy (for future reference — NOT executed in this planning-only pass)

1. T001 (verify grounding) → T002 + T003 in parallel → T004 (after T003) → T005 + T006 in
   parallel (after their respective implementations) → T007 (mounting + auth boundary) → T008
   (full-suite regression audit).
2. MVP slice, if ever staged incrementally: T001 → T002 → T005 alone already delivers spec.md's
   highest-priority User Stories 1-2 (grades scoped list) with full test coverage, independent of
   US3/US4.

**No implementation occurs as part of this planning pass.** This `tasks.md` is the Phase 2
output of the Spec Kit workflow (`/speckit-plan` → `/speckit-tasks`), produced strictly for
review; `/speckit-implement` has not been invoked.
