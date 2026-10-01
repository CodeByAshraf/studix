# Phase 0 Research: Grades + Homework Submissions Backend Read Foundation

No `NEEDS CLARIFICATION` markers were left in `plan.md`'s Technical Context — the feature
description was prescriptive enough (exact query params, exact response shape, exact
architecture reference) that every open question below was resolved by direct inspection of the
existing codebase rather than by asking the user. Each entry follows the Decision/Rationale/
Alternatives format.

## 1. Router architecture (mounting technique)

- **Decision**: Two dedicated Express routers (`grades.js`, `hwSubmissions.js`), each mounted
  with `app.use('/api/<collection>', requireAuth, requirePermission(<permission>), <router>)`
  immediately before the generic `for (const [apiPath, modelName] of
  Object.entries(COLLECTION_MODELS))` loop in `server.js` (currently starting at line 386).
  Each router defines only `GET /` (and, for hwSubmissions, `GET /aggregate`) and never calls
  `router.post/put/patch/delete`, so any write request or `GET /:id` request simply falls through
  Express's routing (no matching handler → `next()` implicitly) to the generic
  `makeCrudRouter('grades'|'hwSubmissions')` mounted later in the loop, completely unchanged.
- **Rationale**: This is exactly `attendance.js`'s Phase 1 design (`backend/src/routes/
  attendance.js:1-225`, mounted at `server.js:182`), already proven additive-and-safe in
  production use for the identically-shaped problem. Reusing it verbatim removes any design
  risk and keeps the codebase's "one way to do scoped reads" convention intact.
- **Alternatives considered**:
  - Extending `makeCrudRouter` (`backend/src/routes/crud.js`) with generic field-filtering —
    rejected: `crud.js` is shared by ~20 collections; adding query-filtering there is a much
    larger blast radius than this feature's stated scope, and the spec explicitly asks to mirror
    `attendance.js`, not to touch the generic CRUD layer.
  - A single combined router for both collections — rejected: `attendance.js`'s precedent is
    one router per collection, and `grades`/`hwSubmissions` already have separate
    `COLLECTION_PERMISSIONS` entries (`exams` vs `homework`) and separate atomic write routers
    (`examGrades.js` vs `hw-submissions.js`) — keeping them separate here matches that existing
    split and keeps each file's blast radius to one collection.

## 2. Grades scoping — studentId / examId, composable

- **Decision**: `GET /api/grades` accepts optional `studentId` and `examId` query params, AND-
  composed into a single Prisma `where` (`{ student_id, exam_id }`, only the provided keys set),
  identical in shape to `attendance.js`'s `where.student_id` / `where.group_id` composition. No
  params → identical to today's unfiltered generic route (same rows, same `{ok,data,count}`
  shape) — required by spec Edge Cases ("must behave exactly as the existing unscoped listing
  does today").
- **Rationale**: `grades` has exactly two meaningful scoping dimensions per the Prisma schema's
  own unique constraint (`@@unique([exam_id, student_id])`) — composing them together is the
  natural "give me this one row" query, already an explicit FR-003 requirement.
- **Alternatives considered**: A single `examId+studentId` "get one grade" endpoint instead of
  two independently-optional filters — rejected: the spec requires each to work alone too
  (FR-001, FR-002), and independently-optional query params compose to the same result with less
  API surface than three separate route shapes.

## 3. Grades — why no average/ranking aggregate here

- **Decision**: Confirmed by reading `backend/prisma/schema.prisma:247-260` — the `grades` table
  has only `score` (nullable `Decimal`) and `absent` (`Boolean`); the exam's `total` (needed to
  turn a raw score into a percentage) lives on the separate `exams` table. Any average-percentage
  or ranking aggregate therefore requires a join across `grades` and `exams`, a materially
  different (and materially riskier, since it changes two tables' worth of query shape) piece of
  work than the same-table `groupBy` aggregates `attendance.js` and this feature's
  `hwSubmissions` aggregate both use. FR-012 explicitly defers this to a separate future
  "Grades Batch B," matching the user's original request.
- **Rationale**: Keeps this feature's risk and review surface to single-table, already-proven
  query patterns only (Simplicity & YAGNI, Constitution Principle VI).
- **Alternatives considered**: Implementing the join now "since it's related work" — explicitly
  rejected per the user's own scope boundary; would also require deciding rounding/absent-score
  treatment rules that the spec deliberately does not make here.

## 4. Homework submissions scoping — studentId / homeworkId

- **Decision**: `GET /api/hwSubmissions` accepts optional `studentId` and `homeworkId`, same
  AND-composition pattern as grades (`hw_submissions` also has a matching
  `@@unique([homework_id, student_id])` constraint). No params → identical to today's unfiltered
  generic route.
- **Rationale**: Same reasoning as grades — the unique constraint is the natural evidence of
  "these two dimensions are the meaningful scoping axes."

## 5. Homework submissions aggregate — groupBy=status / groupBy=homework, SQL-side

- **Decision**: `GET /api/hwSubmissions/aggregate?groupBy=status` uses
  `prisma.hw_submissions.groupBy({ by: ['status'], _count: true })`, returning
  `[{key, count}, ...]` — the exact shape of `attendance.js`'s `aggregateByStatus()`.
  `?groupBy=homework` uses `prisma.hw_submissions.groupBy({ by: ['homework_id', 'status'],
  _count: true })`, bucketed in JS into `[{key: homeworkId, total, submitted, late, missing}, ...]`
  — the exact shape of `attendance.js`'s `aggregateByDimension()`, just with `hw_submissions`'
  own status vocabulary instead of present/absent/late. Any other `groupBy` value is a 400 (same
  `GROUP_BY_DIMENSIONS` allow-list technique as `attendance.js`).
- **Rationale**: `hw_submissions.status` is a direct column (`String`, default `'missing'`) with
  no join needed — architecturally the simple case, much closer to attendance's `status` column
  than to grades' derived-percentage problem. This exactly matches the two consumers already
  identified as needing it (`HomeworkPage.jsx`'s center-wide status counts,
  `HomeworkReports.jsx`'s per-homework breakdown) — no speculative third dimension is added,
  matching FR-006/FR-007 and the explicit "no speculative dimensions" instruction.
- **Alternatives considered**: A `groupBy=student` dimension (mirroring attendance's) —
  explicitly not requested by the user for this feature and not matched to any named consumer;
  omitted to keep the surface exactly as scoped.

## 6. Validation / rejection strategy for malformed scope values

- **Decision**: Reuse the `badRequest(message)` helper pattern from `attendance.js` (an
  `Error` with `.status = 400` and `.expose = true`, thrown before any Prisma call, caught by
  the existing `asyncHandler` + `errorHandler` middleware chain already wired in `server.js`).
  For `groupBy`, an unrecognized value is rejected the same way `attendance.js` rejects an
  unrecognized `groupBy` (`GROUP_BY_DIMENSIONS` allow-list). `studentId`/`examId`/`homeworkId`
  are treated as opaque string ids (same as `attendance.js`'s `studentId`/`groupId` — no format
  validation beyond non-empty, since these are UUID-shaped strings generated by the app itself,
  not user-typed free text) — an id that doesn't exist simply yields an empty result set (FR-009),
  never a 404, matching how `attendance.js`'s `studentId`/`groupId` already behave today.
- **Rationale**: Zero new validation vocabulary; the one new rule (an unrecognized `groupBy`) is
  copy-identical to the existing, already-tested pattern.

## 7. "Bounded results" meaning

- **Decision**: "Bounded" is satisfied by requiring at least one scope filter to reduce the row
  count from the full table — the same guarantee `attendance.js`'s scoped `GET /` already
  provides (no artificial `LIMIT`/pagination is added, matching `attendance.js` exactly, which
  also has none on its scoped route). The *unscoped* call path is intentionally left exactly as
  bounded/unbounded as it is today (FR-011 — existing unscoped listing behavior must not change),
  since changing that would be a behavior change outside this feature's stated boundary.
- **Rationale**: Matches the existing, already-shipped precedent bit-for-bit; inventing a new
  pagination/limit convention here would be new API surface the spec never asked for.
- **Alternatives considered**: Adding a hard `take` cap to the scoped routes — rejected as
  scope creep beyond what `attendance.js` itself does and beyond what any FR in spec.md asks for.

## 8. Response shape / row preservation

- **Decision**: `snakeToCamel(rows)` + `serializeBigInt(...)` on every row, `{ok:true,
  data, count}` for the list route, `{ok:true, data}` for the aggregate route — copy-identical
  to `attendance.js`. No field is added, removed, or renamed (FR-013); `grades.score` (Decimal)
  and any BigInt-shaped field pass through `serializeBigInt` exactly as the existing generic
  route already does for these same tables today, so a client switching from the generic route to
  this one sees byte-identical row shapes.
- **Rationale**: Directly required by FR-013 and SC-004 (no change to existing behavior); reusing
  the same two helpers already imported by `attendance.js` guarantees this by construction rather
  than by convention.

## 9. Testing strategy

- **Decision**: Two integration test files, mirroring two existing precedents exactly:
  - `grades.integration.test.js` / `hwSubmissions.integration.test.js` — real ephemeral-port
    Express app mounting *only* the new router (no auth middleware) against a real scratch
    Postgres database (`setupScratchDb`/`teardownScratchDb`), same structure as
    `attendance.integration.test.js` — covers scoped-list filtering (studentId/examId/
    homeworkId, composition, empty results, unscoped-identical-to-generic), and for
    hwSubmissions, both aggregate dimensions plus invalid-`groupBy` rejection.
  - A dedicated auth/permission boundary test (extending or adding to the existing
    `phase4ScopedGetAuth.integration.test.js`-style file) — real Express app mounting the new
    router *behind* `requirePermission('exams'|'homework')` with a `stubAuth` header-driven fake
    user, covering: permitted user succeeds, wrong-permission user gets 403, unauthenticated
    gets 401 — same three cases already proven for `payments`/`communications` in that file.
- **Rationale**: Directly matches the spec's own testing requirement ("use attendance tests as
  reference but don't blindly copy where the data model differs") and the constitution's
  Test-First principle in spirit (tests land in the same change as the routes, not after).
- **Alternatives considered**: Testing auth inline inside `grades.integration.test.js` itself
  (like `attendance.integration.test.js` does *not* do — it tests the router bare, with auth
  proven separately in `phase4ScopedGetAuth...`) — rejected in favor of following the existing
  split exactly, since it's already the established convention across the two closest precedent
  files.

## Outcome

All Technical Context unknowns resolved. No `NEEDS CLARIFICATION` markers remain. Ready for
Phase 1 (data-model.md, contracts/, quickstart.md).
