# Implementation Plan: Grades + Homework Submissions Frontend Migration (Batch A)

**Branch**: `004-grades-homework-frontend-migration` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-grades-homework-frontend-migration/spec.md`

## Summary

Migrate 9 frontend call sites (across `StudentsPage.jsx`, `StudentProfile.jsx`, `ExamResults.jsx`,
`GradeEntry.jsx`, `HomeworkTracking.jsx`, `HomeworkPage.jsx`, `HomeworkReports.jsx`) off the
global `grades`/`hwSubmissions` Zustand-store arrays onto the scoped/aggregate backend APIs
feature 003 already shipped (`GET /api/grades?studentId=&examId=`,
`GET /api/hwSubmissions?studentId=&homeworkId=`,
`GET /api/hwSubmissions/aggregate?groupBy=status|homework`), using the exact `useAsyncData` +
Map-lookup pattern already proven for attendance (features 001/002) and payments/communications.
Three new client functions in `src/services/api.js` — `pgGetGrades`, `pgGetHwSubmissions`,
`pgGetHwSubmissionsAggregate` — each apply the same client-side normalization
`src/store/db.middleware.js`'s `COLLECTION_FIXUPS.grades`/`.hwSubmissions` already apply during
boot-sync (numeric `score`, `homeworkId`→`hwId` rename, date-only `submittedAt`), mirroring the
already-established `pgGetPayments`/`pgGetCommunications` `.map(normalizeXResponse)` pattern, so
every migrated consumer needs zero changes to its own field names or numeric logic. Every write
path (`pgSaveExamGrades`, `pgSaveHwSubmissions`, `pgDeleteStudent`) and every explicitly deferred
consumer (grades center-wide average, HomeworkSearch, `PG_COLLECTIONS`, `partialize`) is
untouched.

## Technical Context

**Language/Version**: JavaScript (React 18, Vite), same runtime as the rest of `src/`.

**Primary Dependencies**: React, Zustand (`useAppStore` — unchanged), the existing
`useAsyncData` hook (`src/hooks/useAsyncData.js` — generic fetch/loading/error hook, already
used by every C4-migrated consumer), `src/services/api.js` (client fetch-wrapper conventions).

**Storage**: N/A for this feature — frontend-only, consumes feature 003's already-shipped HTTP
API. No schema, no database change.

**Testing**: Vitest + React Testing Library, `vi.mock('.../services/api', ...)` pattern (the
established convention for every C4-migrated consumer test file — see
`AttendanceAnalytics.test.jsx`, `ReportsPage.test.jsx`, `Dashboard.attendanceHeat.test.jsx`).

**Target Platform**: Browser (Vite dev server + production build).

**Project Type**: Web application (existing `backend/` + `src/` split) — this feature touches
`src/` only; no backend file is read or modified.

**Performance Goals**: Each of the two summary-driven screens (HomeworkPage, HomeworkReports)
must issue at most one status-summary request and one per-assignment-summary request per view
(SC-002) — never one request per rendered homework row.

**Constraints**: Every migrated number must remain byte-identical to its pre-migration value
(FR-005). No backend route, schema, `COLLECTION_PERMISSIONS`, `PG_COLLECTIONS`, or `partialize`
change. No write-path change. The two components whose local editable state is currently seeded
by a one-time `useState` lazy initializer (`GradeEntry.jsx`, `HomeworkTracking.jsx`) must not
mount that state until their scoped fetch has resolved — see research.md §5 for why this is a
correctness requirement, not a cosmetic one.

**Scale/Scope**: 3 new functions in `src/services/api.js`; 9 call sites across 7 component files;
up to 8 existing test files extended + 1 new one (`ExamResults.test.jsx`, which does not exist
today).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Fail-Closed Security** — PASS (N/A). No auth/permission logic changes — every migrated
  request reuses `pgGetGrades`/`pgGetHwSubmissions`/`pgGetHwSubmissionsAggregate`, which call
  feature 003's already-permission-gated endpoints (`requireAuth`+`requirePermission`), unchanged.
- **II. Offline-First, Single-Installation Model** — PASS. Purely additive frontend calls to the
  existing co-located backend; no new network dependency introduced.
- **III. Deterministic, Idempotent DB Provisioning** — PASS (N/A). No schema/DB change.
- **IV. Test-First for Security/Money Paths** — N/A directly (this is UI data-source migration,
  not a security/money path), but honored in spirit per spec.md's explicit testing requirement:
  focused tests for all 9 call sites land in the same change, including the student-delete
  safety-guard regression coverage (data-integrity-adjacent, given features 001/002's precedent
  of treating delete guards carefully).
- **V. Documentation Reflects Reality** — PASS. No README claim changes — this feature has no
  new user-facing capability, only a data-source change; inline code comments on each migrated
  call site will document the change, matching the existing C4-migration comment convention.
- **VI. Simplicity & YAGNI** — PASS. Reuses the exact `useAsyncData`+Map-lookup pattern already
  proven 3 times (attendance, payments, communications) with zero new abstractions; the
  normalization requirement (FR-006) reuses the exact `.map(normalizeXResponse)` pattern already
  proven twice (`pgGetPayments`, `pgGetCommunications`) rather than inventing a new mechanism.

No violations. Complexity Tracking table is not needed.

## Project Structure

### Documentation (this feature)

```text
specs/004-grades-homework-frontend-migration/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── grades-scoped-consumers.md
│   ├── hw-submissions-scoped-consumers.md
│   └── hw-submissions-aggregate-consumers.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
# Option 2: Web application (existing frontend + backend split) — this feature touches
# src/ only.
src/
├── services/
│   └── api.js                              # +3 functions: pgGetGrades, pgGetHwSubmissions,
│                                             # pgGetHwSubmissionsAggregate (+2 private
│                                             # normalizer helpers mirroring COLLECTION_FIXUPS)
├── modules/
│   ├── students/
│   │   ├── StudentsPage.jsx                 # handleDelete: 2 checks → scoped async fetches
│   │   ├── StudentsPage.test.jsx            # extended
│   │   ├── StudentProfile.jsx               # ExamsTab: scoped fetch + gated empty-state
│   │   └── StudentProfile.test.jsx (+family) # extended
│   ├── exams/
│   │   ├── ExamResults.jsx                  # scoped fetch + gated empty-state
│   │   ├── ExamResults.test.jsx             # NEW (no existing test file today)
│   │   ├── GradeEntry.jsx                   # scoped fetch; local-state mount gated on load
│   │   └── GradeEntry.test.jsx              # extended
│   └── homework/
│       ├── HomeworkTracking.jsx             # scoped fetch; local-state mount gated on load
│       ├── HomeworkTracking.test.jsx (+.print) # extended
│       ├── HomeworkPage.jsx                 # KPI + per-row breakdown → 2 page-level aggregates
│       ├── HomeworkPage.test.jsx (+.groupFilter) # extended
│       ├── HomeworkReports.jsx              # all 4 tabs + summary → same 2 page-level aggregates
│       └── HomeworkReports.groupFilter.test.jsx # extended
└── store/
    └── db.middleware.js                     # read-only reference (COLLECTION_FIXUPS source of
                                               # truth for the normalization this feature mirrors)
                                               # — NOT modified by this feature

backend/ — untouched in this feature (feature 003's routes are consumed as-is, not changed)
```

**Structure Decision**: Existing `backend/` + `src/` split is unchanged; this feature touches
`src/` only. New logic lives in `src/services/api.js` (3 new exported functions, following the
exact naming/shape convention of `pgGetAttendance`/`pgGetPayments`/`pgGetCommunications`) plus
targeted edits to the 7 component files listed above — no new component files, no new hooks
(`useAsyncData` is reused as-is), no new directories.

## Complexity Tracking

*No Constitution Check violations — table not needed.*
