# Implementation Plan: Attendance C4 Batch A — Safe Read Migration

**Branch**: `002-attendance-c4-batch-a` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-attendance-c4-batch-a/spec.md`

## Summary

Migrate five remaining production readers of the global `attendance` Zustand-store array —
`ReportsPage.jsx`'s overview tab, `AttendanceAnalytics.jsx`, `Dashboard.jsx`'s per-student heat
row, `AttendancePage.jsx`'s overview KPIs, and `QRScanner.jsx`'s same-day duplicate check — onto
the already-implemented, already-tested scoped (`GET /api/attendance`) and aggregate
(`GET /api/attendance/aggregate`) attendance endpoints, reusing exactly the patterns proven by
feature 001 (Frequent Absentees) and the earlier Groups/Students/Payments migrations. No backend
changes are required: every dimension this batch needs (`groupBy=status`, `groupBy=group`,
`groupBy=date` with `from/to`, `groupBy=weekday`, and the scoped `studentId`/`studentIds`/`date`
filters) already exists and is already covered by `backend/src/routes/attendance.integration.test.js`.
Two figures are explicitly and permanently left on their current data source rather than migrated
or approximated, per the spec's clarified decisions: `AttendancePage.jsx`'s distinct-session count
(no aggregate dimension reproduces "count of unique group+date pairs") and its "needs follow-up"
indicator (belongs to the out-of-scope `AbsenceFollowup`/`absenceFollowup` domain). The 14-day
trend in `AttendanceAnalytics.jsx` fetches a 90-day window (per clarification) and takes the last
14 dates with real data client-side, preserving today's "last 14 session-dates," not "last 14
calendar days," semantics exactly.

## Technical Context

**Language/Version**: JavaScript (ES2022+), React 18 (frontend); Node.js + Express 4 (backend, unchanged by this feature)

**Primary Dependencies**: React, Zustand (existing store, several selectors removed), existing `useAsyncData` hook, existing `pgGetAttendance`/`pgGetAttendanceAggregate` clients (`src/services/api.js`) — no new dependencies

**Storage**: PostgreSQL via Prisma — no schema change; reuses `backend/src/routes/attendance.js`'s existing `GET /` (scoped list) and `GET /aggregate` (status/group/date/weekday dimensions) routes verbatim

**Testing**: Vitest + React Testing Library for each migrated component; no new backend tests needed — `groupBy=status`, `groupBy=group`, `groupBy=date` with `from/to`, `groupBy=weekday`, and the scoped `studentId`/`studentIds`/`date` filters are already covered by `backend/src/routes/attendance.integration.test.js`

**Target Platform**: Existing Studix web app (Electron-hosted, offline-first, single-installation-per-center per the project constitution)

**Project Type**: Web application (frontend `src/` only — backend `backend/src/` untouched) — Option 2 structure below

**Performance Goals**: Every migrated consumer's data need scales with what it displays (a handful of students, a 90-day window, or center-wide counts) rather than with total historical attendance row count — matching SC-002; no new latency targets beyond "no worse than the already-shipped feature 001 pattern"

**Constraints**: Every migrated figure MUST be numerically identical to its current value for the same underlying data (SC-001); the two documented gaps (distinct-session count, needs-follow-up indicator) MUST NOT be approximated — they stay on their current data source, unchanged; none of the four explicitly out-of-scope consumers (`AbsenceFollowup.jsx`, `ui.context.jsx`'s overdue-notification derivation, `Dashboard.jsx`'s `attendance.slice(-50)`-based `attPct`, any attendance write path) may be touched

**Scale/Scope**: Single-center installation; same ~500-active-student order of magnitude established in feature 001; attendance history spanning multiple years — every migrated figure is now bounded by aggregate/scope rather than by total history depth

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I. Fail-Closed Security (NON-NEGOTIABLE) | N/A — no licensing/signing/auth logic touched. All five routes stay behind the existing `requireAuth` + `requirePermission('attendance')` gate, unchanged. **PASS** |
| II. Offline-First, Single-Installation Model | No new network dependency; same-origin `fetch` to the co-located backend, identical to every prior migrated consumer. **PASS** |
| III. Deterministic, Idempotent DB Provisioning | No schema/migration change. **PASS** |
| IV. Test-First for Security/Money-Critical Paths | Not a security/money path — not mandated by this principle — but the established project convention (every prior C4 consumer shipped with tests) is followed anyway. **PASS** |
| V. Documentation Reflects Current Reality | No README-documented behavior changes (internal dashboards/reports, all figures preserved exactly). **PASS / N/A** |
| VI. Simplicity & YAGNI | Reuses five already-existing, already-tested aggregate/scoped dimensions rather than adding any new backend capability; two figures that have no exact match are explicitly left alone rather than forcing a new capability into existence for them. **PASS** |

**Result**: No violations. Complexity Tracking not needed.

## Project Structure

### Documentation (this feature)

```text
specs/002-attendance-c4-batch-a/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   └── attendance-batch-a-endpoints.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
backend/
└── src/routes/attendance.js        # REUSED AS-IS — no changes; every dimension this
                                     #   batch needs already exists & is already tested

src/
├── modules/
│   ├── reports/
│   │   ├── ReportsPage.jsx               # OverviewDashboard.attPct → groupBy=status
│   │   └── AttendanceAnalytics.jsx       # total/present/absent/late/pct → groupBy=status;
│   │                                     #   byGroup → groupBy=group; dailyTrend →
│   │                                     #   groupBy=date&from=&to= (90-day window);
│   │                                     #   dayData → groupBy=weekday&status=absent
│   ├── Dashboard.jsx                     # StudentRow heat (5 students) → studentIds=
│   ├── attendance/
│   │   └── AttendancePage.jsx            # overview total/present/absent/late/pct →
│   │                                     #   groupBy=status; sessions + pendingFollowup
│   │                                     #   left unmigrated (documented gaps)
│   └── id-cards/components/
│       └── QRScanner.jsx                 # same-day duplicate check → studentId=&date=
│                                          #   (write path untouched — out of scope)
└── (new/extended *.test.jsx per migrated component, one per Phase 3 task below)
```

**Structure Decision**: Existing Studix web-application layout (`backend/src` + `src/`) is
reused unchanged. This feature touches only the frontend half, across five files spanning three
existing modules (`reports/`, root `Dashboard.jsx`, `attendance/`, `id-cards/components/`); the
backend aggregate/scoped routes already provide everything needed and require zero modification.

## Complexity Tracking

*No violations — table omitted.*
