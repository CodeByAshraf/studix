# Implementation Plan: Frequent Absentees Report Data Migration

**Branch**: `001-frequent-absentees-migration` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-frequent-absentees-migration/spec.md`

## Summary

Move the "frequent absentees" tab of `AttendanceReports.jsx` off the global `attendance`
Zustand-store array onto the already-implemented, already-tested per-student attendance
aggregate (`GET /api/attendance/aggregate?groupBy=student&studentIds=<active ids>[&groupId=]`)
— the same endpoint already powering `GroupsPage.jsx`, `GroupStatistics.jsx`, and (per-student,
unscoped by group) `StudentPerformance.jsx`. Per spec.md's second clarification session, the
request MUST pass the client's already-known active (and group-filtered) student IDs via the
endpoint's existing `studentIds` parameter — not rely on `groupBy=student` alone — so the
payload is genuinely bounded by active-student count rather than by every student who has ever
had an attendance record (see research.md §1a). No backend changes are required: `studentIds`
already exists on this endpoint. The report's visible behavior (threshold buttons, group
filter, sort order, severity tiers, call action, empty state) is unchanged; only where its
numbers come from changes. This is the last of the 11 C4 Attendance Phase 2 consumers to
migrate, and removes the last remaining reader of the global `attendance` store from
`AttendanceReports.jsx` entirely.

## Technical Context

**Language/Version**: JavaScript (ES2022+), React 18 (frontend); Node.js + Express 4 (backend, unchanged by this feature)

**Primary Dependencies**: React, Zustand (existing store, one selector removed), existing `useAsyncData` hook, existing `pgGetAttendanceAggregate` client (`src/services/api.js`) — no new dependencies

**Storage**: PostgreSQL via Prisma — no schema change; reuses the existing `attendance` table and the existing `aggregateByDimension(where, 'student_id')` query path in `backend/src/routes/attendance.js`

**Testing**: Vitest + React Testing Library for the frontend component/service test; no new backend tests needed (endpoint and its `groupBy=student`/`studentIds`/`groupId` behavior are already covered by `backend/src/routes/attendance.integration.test.js`)

**Target Platform**: Existing Studix web app (Electron-hosted, offline-first, single-installation-per-center per the project constitution)

**Project Type**: Web application (frontend `src/` + backend `backend/src/`) — Option 2 structure below

**Performance Goals**: List renders within 2s of opening the report for a center with up to 500 active students (SC-001); a threshold change re-filters already-fetched data with no network round trip; a group-filter change is the only interaction that triggers a new fetch, always scoped by `studentIds` to the active roster so the payload never grows with inactive-but-historical students

**Constraints**: No dedicated loading indicator during fetch/refetch (FR-011, matches the other 3 tabs in this file); no new backend endpoint or query param (the required `studentIds` param already exists on this endpoint — FR-004); must not regress any of the 11 already-migrated C4 Attendance consumers or the other 3 tabs in this same file

**Scale/Scope**: Single-center installation; up to ~500 active students; attendance history spanning multiple years (SC-004) — bounded by active-student count because the request is explicitly scoped via `studentIds` (FR-004/SC-002), not merely by the aggregate endpoint's `GROUP BY` design on its own (which alone would scale with every student who has ever had an attendance record, active or not — see research.md §1a)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I. Fail-Closed Security (NON-NEGOTIABLE) | N/A — no licensing/signing/auth logic touched. The route stays behind the existing `requireAuth` + `requirePermission('attendance')` gate, unchanged. **PASS** |
| II. Offline-First, Single-Installation Model | No new network dependency; still same-origin `fetch` to the co-located backend, same as every other migrated consumer. **PASS** |
| III. Deterministic, Idempotent DB Provisioning | No schema/migration change. **PASS** |
| IV. Test-First for Security/Money-Critical Paths | Not a security/money path, so not mandated by this principle — but the project's own established convention (all 11 prior C4 consumers shipped with tests) is followed anyway; see Phase 1 plan. **PASS** |
| V. Documentation Reflects Current Reality | No README-documented behavior changes (internal report tab, behavior preserved). **PASS / N/A** |
| VI. Simplicity & YAGNI | Reuses an existing, already-tested endpoint and an existing client hook (`useAsyncData`) rather than adding a new endpoint or a bespoke fetch pattern. No new abstraction introduced. **PASS** |

**Result**: No violations. Complexity Tracking not needed.

## Project Structure

### Documentation (this feature)

```text
specs/001-frequent-absentees-migration/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   └── attendance-aggregate-student.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
backend/
└── src/routes/attendance.js        # REUSED AS-IS — no changes; groupBy=student(+studentIds)(+groupId) already exists & tested

src/
├── services/
│   ├── api.js                      # REUSED AS-IS — pgGetAttendanceAggregate already exists
│   └── attendanceService.js        # getFrequentAbsentees signature adapted to accept
│                                    #   pre-aggregated per-student stats instead of raw records
└── modules/attendance/
    ├── AttendanceReports.jsx       # ReportFrequentAbsentees migrated to useAsyncData +
    │                                #   pgGetAttendanceAggregate({ groupBy: 'student',
    │                                #   studentIds: <active [+group-filtered] ids>, groupId? });
    │                                #   top-level `attendance` store selector removed (was
    │                                #   only feeding this tab)
    └── AttendanceReports.absenteesTab.test.jsx   # NEW — mirrors the existing
                                                   #   .groupTab/.printTab/.studentSearch test files
```

**Structure Decision**: Existing Studix web-application layout (`backend/src` + `src/`) is
reused unchanged. This feature touches only the frontend half; the backend aggregate route
already provides everything needed and requires zero modification.

## Complexity Tracking

*No violations — table omitted.*
