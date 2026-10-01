# Implementation Plan: Grades + Homework Submissions Backend Read Foundation

**Branch**: `003-grades-homework-read-foundation` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-grades-homework-read-foundation/spec.md`

## Summary

Add two backend-only, additive, read-only Express routers — `backend/src/routes/grades.js` and
`backend/src/routes/hwSubmissions.js` — that give the future frontend migration a scoped way to
fetch grade and homework-submission records without loading the full collection first, mirroring
`backend/src/routes/attendance.js`'s proven architecture exactly (dedicated router mounted before
the generic dynamic CRUD loop in `server.js`, `next()` fallthrough for anything undefined,
existing `requireAuth` + `requirePermission` reused, `{ok:true,data,count}` / `{ok:true,data}`
response shapes, `snakeToCamel`/`serializeBigInt` row shaping). `grades.js` adds `GET /` scoped by
`studentId`/`examId` (composable). `hwSubmissions.js` adds `GET /` scoped by
`studentId`/`homeworkId`, plus `GET /aggregate?groupBy=status|homework` (SQL-side `groupBy`,
same technique as `attendance.js`'s `aggregateByStatus`/`aggregateByDimension`). No grades
average/ranking aggregate, no frontend change, no schema change, no `PG_COLLECTIONS` change —
all deferred per spec Assumptions. Both routers ship with real-PostgreSQL integration tests
(scoped-list behavior mirroring `attendance.integration.test.js`, auth/permission boundary
mirroring `phase4ScopedGetAuth.integration.test.js`).

## Technical Context

**Language/Version**: Node.js (ESM), same runtime as the rest of `backend/src`.

**Primary Dependencies**: Express (routing), Prisma Client (`grades`, `hw_submissions` models),
existing local helpers — `snakeToCamel` (`backend/src/lib/caseMapper.js`), `serializeBigInt`
(exported from `backend/src/routes/payments.js`), `asyncHandler`
(`backend/src/middleware/errorHandler.js`), `requireAuth` + `requirePermission`
(`backend/src/middleware/permissions.js`, already wired in `server.js`).

**Storage**: PostgreSQL via Prisma — `grades` table (`id, exam_id, student_id, score Decimal?,
absent Boolean, created_at`, unique `[exam_id, student_id]`) and `hw_submissions` table
(`id, homework_id, student_id, status String default 'missing', submitted_at, score, notes`,
unique `[homework_id, student_id]`). No schema changes in this feature.

**Testing**: Vitest, `backend/vitest.integration.config.js` — real ephemeral-port Express app +
real scratch PostgreSQL database via `backend/src/test-helpers/scratchDb.js`
(`setupScratchDb`/`teardownScratchDb`/`checkPostgresReachable`), same structure as
`attendance.integration.test.js` (route behavior) and `phase4ScopedGetAuth.integration.test.js`
(auth/permission boundary). Runs under `npm run test:integration`; a Postgres-unreachable
environment records one clear "SKIPPED" test, never a silent skip or false pass.

**Target Platform**: Backend only — Node/Express server (`backend/src/server.js`), no frontend,
no installer, no schema/migration change.

**Project Type**: Web application (existing `backend/` + `src/` split) — this feature touches
`backend/` only.

**Performance Goals**: Not a performance-driving feature; goal is simply "scoped query costs less
than today's full-table load," same bar `attendance.js` already met. No explicit throughput target.

**Constraints**: Additive only — must not change the existing generic `/api/grades` and
`/api/hwSubmissions` GET/:id/write behavior, must not change `/api/exam-grades` or
`/api/hw-submissions` (the existing atomic roster-save routers), must not touch
`COLLECTION_PERMISSIONS`, `PG_COLLECTIONS`, `partialize`, the Prisma schema, or the installer.

**Scale/Scope**: 2 new route files (~1 scoped GET each, +1 aggregate GET on the hwSubmissions
router), 2 new integration test files, 1 route-mounting change in `server.js`. No new tables,
no new frontend surface.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Fail-Closed Security** — PASS. Both routers reuse the existing `requireAuth` +
  `requirePermission('exams'|'homework')` gates already enforced for these two collections; no
  new auth/permission logic is introduced, so there is no new fail-open surface. Malformed scope
  params (FR-010) are rejected with a 400 *before* any Prisma lookup runs, matching
  `attendance.js`'s `badRequest()` convention — never a silent wrong-scope result.
- **II. Offline-First, Single-Installation Model** — PASS. Pure additive backend routes on the
  existing co-located Express/Postgres install; no network dependency introduced.
- **III. Deterministic, Idempotent DB Provisioning** — PASS (N/A). No schema change, no migration.
- **IV. Test-First for Security/Money Paths** — N/A for money paths (grades/homework are neither
  licensing nor payments); still honored in spirit — real-Postgres integration tests are written
  alongside the routes in this same feature, including the auth/permission boundary and the
  rejection paths (invalid params, empty results), not only the happy path.
- **V. Documentation Reflects Reality** — PASS. No README claims are made about a new
  user-facing capability, since this feature has no user-facing behavior change (spec.md
  Assumptions). Code comments on the new routers will document scope/non-scope inline, matching
  `attendance.js`'s own convention.
- **VI. Simplicity & YAGNI** — PASS. Reuses `attendance.js`'s exact architecture and existing
  helpers; adds only the two groupBy dimensions the spec asks for (`status`, `homework`) with no
  speculative aggregate, and explicitly excludes the grades avg/ranking aggregate that would
  require a join this foundation doesn't need to solve yet.

No violations. Complexity Tracking table is not needed.

## Project Structure

### Documentation (this feature)

```text
specs/003-grades-homework-read-foundation/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── grades-get.md
│   ├── hw-submissions-get.md
│   └── hw-submissions-aggregate.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
# Option 2: Web application (existing frontend + backend split) — this feature touches
# backend/ only.
backend/
├── src/
│   ├── routes/
│   │   ├── attendance.js                        # existing — architecture reference only
│   │   ├── grades.js                             # NEW — scoped GET /api/grades
│   │   ├── grades.integration.test.js            # NEW
│   │   ├── hwSubmissions.js                       # NEW — scoped GET + aggregate /api/hwSubmissions
│   │   ├── hwSubmissions.integration.test.js      # NEW
│   │   ├── examGrades.js                          # existing — unmodified (atomic roster save)
│   │   └── hw-submissions.js               # existing file is named hw-submissions.js — unmodified
│   └── server.js                                  # 2 new app.use(...) mount lines, before the
│                                                    # generic CRUD loop (same position as
│                                                    # app.use('/api/attendance', ...))
└── prisma/schema.prisma                           # read-only reference, no changes

frontend (src/) — untouched in this feature
```

**Structure Decision**: Existing `backend/` + `src/` web-application split is unchanged. All new
files live under `backend/src/routes/`, following the exact file-naming and co-location
convention `attendance.js` / `attendance.integration.test.js` already established. `server.js`
gets two additive `app.use(...)` lines placed immediately before the generic dynamic CRUD loop
(`for (const [apiPath, modelName] of Object.entries(COLLECTION_MODELS))`), in the same style as
the existing `app.use('/api/attendance', ...)` line — no other line in `server.js` is touched.

## Complexity Tracking

*No Constitution Check violations — table not needed.*
