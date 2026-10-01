# Quickstart: Validating the Grades + Homework Submissions Backend Read Foundation

This is a backend-only feature with no UI. Validation is entirely through automated integration
tests (real PostgreSQL + Express) and, optionally, manual `curl`/HTTP calls against a locally
running dev backend. No frontend build or browser step is involved.

## Prerequisites

- A reachable local PostgreSQL instance usable for scratch-database integration tests (same
  requirement every existing `*.integration.test.js` file in `backend/src/routes/` already has).
- Dependencies installed: `cd backend && npm install` (if not already done).
- **Do not** point this at the installed production-like `StudixApp`/`StudixPostgreSQL` Windows
  services on this machine — integration tests create/drop their own scratch database via
  `backend/src/test-helpers/scratchDb.js` and do not touch any existing installation.

## Automated validation (primary path)

From `backend/`:

```sh
npm run test:integration -- grades.integration.test.js
npm run test:integration -- hwSubmissions.integration.test.js
```

Or run the whole suite:

```sh
npm run test:integration
```

Each new integration test file follows `attendance.integration.test.js`'s structure: spins up a
real ephemeral-port Express app mounting only the new router, against a real scratch Postgres
database, and tears both down in `afterAll`. If PostgreSQL is unreachable, a single clear
"SKIPPED" test is recorded — never a silent skip, never a false pass.

**Expected scenarios covered** (per spec.md Success Criteria):

- `GET /api/grades?studentId=` / `?examId=` / both together → only matching rows, verified
  against seeded fixture data (SC-001).
- `GET /api/hwSubmissions?studentId=` / `?homeworkId=` / both together → only matching rows
  (SC-002).
- `GET /api/hwSubmissions/aggregate?groupBy=status` and `?groupBy=homework` → counts numerically
  identical to a direct `.filter(...).length` count over the same seeded rows (SC-003).
- Unscoped `GET /api/grades` and `GET /api/hwSubmissions` (no query params) → byte-identical to
  what the existing generic route already returns for the same seeded data (SC-004 — proves no
  regression to today's boot-sync path).
- Empty-result cases (a real but grade-less student, a real but submission-less homework) →
  `{ok:true, data:[], count:0}` / `{ok:true, data:[]}`, never an error.
- Invalid `groupBy` value → 400 with a clear message, before any DB lookup.

A separate auth/permission integration test (extending the existing
`phase4ScopedGetAuth.integration.test.js`-style coverage) validates:

- A user with the `exams` permission can call `GET /api/grades`; a user without it gets 403; an
  unauthenticated request gets 401.
- A user with the `homework` permission can call `GET /api/hwSubmissions` (list and aggregate);
  a user without it gets 403; an unauthenticated request gets 401.

## Manual spot-check (optional, requires a running dev backend + activated license)

Not required for this feature to be considered complete (automated integration tests are the
source of truth), but useful for a human sanity check against real seeded data:

```sh
# Assuming the dev backend is running on its usual local port and you have a valid session token
curl -H "Authorization: Bearer <token>" "http://localhost:4000/api/grades?studentId=<real-student-id>"
curl -H "Authorization: Bearer <token>" "http://localhost:4000/api/hwSubmissions?homeworkId=<real-homework-id>"
curl -H "Authorization: Bearer <token>" "http://localhost:4000/api/hwSubmissions/aggregate?groupBy=status"
```

Confirm: response shape matches `contracts/*.md`, and that the equivalent unscoped call
(`GET /api/grades` / `GET /api/hwSubmissions` with no query params) still returns exactly what it
did before this feature — i.e., existing frontend boot-sync is provably unaffected.

## Regression check (required before calling this feature done)

Run the full existing backend test suite (unit + integration) to confirm nothing outside the two
new files changed behavior:

```sh
cd backend
npm run test
npm run test:integration
```

No existing test file should need to change as part of this feature (FR-011, SC-004) — if one
does, that is a signal scope has drifted beyond this feature's boundary.
