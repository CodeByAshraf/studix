# Data Model: Attendance C4 Batch A — Safe Read Migration

No database schema changes. This document describes the view-level shapes each migrated
consumer reads and derives — all sourced from response shapes that already exist and are already
covered by `backend/src/routes/attendance.integration.test.js`.

## Attendance Status Summary (center-wide)

Source: `GET /api/attendance/aggregate?groupBy=status` (existing, unmodified).

| Field | Type | Notes |
|---|---|---|
| `key` | `'present' \| 'absent' \| 'late'` | |
| `count` | integer | |

**Consumers**: `ReportsPage.jsx` (§1), `AttendanceAnalytics.jsx` (§2), `AttendancePage.jsx` (§4)
— each derives `total = present+absent+late` and `pct = round(present/total*100)` (or `null`
when `total===0`) client-side, identical to today's formula.

## Attendance Group Summary

Source: `GET /api/attendance/aggregate?groupBy=group` (existing, unmodified — same dimension
already used by `GroupsPage.jsx`/`GroupStatistics.jsx`).

| Field | Type | Notes |
|---|---|---|
| `key` | string (group id) | Joined against the `groups` store array for display name, unchanged |
| `total`, `present`, `absent`, `late` | integer | |

**Consumer**: `AttendanceAnalytics.jsx`'s `byGroup` chart.

## Attendance Date Summary (windowed)

Source: `GET /api/attendance/aggregate?groupBy=date&from=<today-90d>&to=<today>` (existing,
unmodified).

| Field | Type | Notes |
|---|---|---|
| `key` | string, `"YYYY-MM-DD"` | Already sorted ascending by the endpoint itself |
| `total`, `present`, `absent`, `late` | integer | |

**Consumer**: `AttendanceAnalytics.jsx`'s `dailyTrend` — client takes `.slice(-14)` of the
response and computes `pct` per entry, unchanged from today's logic (see research.md §2 for why
90 days is the chosen window).

## Attendance Weekday-Absence Summary

Source: `GET /api/attendance/aggregate?groupBy=weekday&status=absent` (existing, unmodified).

| Field | Type | Notes |
|---|---|---|
| `key` | one of `sat/sun/mon/tue/wed/thu/fri` | Only weekdays with `count > 0`, already filtered server-side |
| `count` | integer | |

**Consumer**: `AttendanceAnalytics.jsx`'s `dayData` — client maps `key` to the existing Arabic
label and sorts descending by `count`, unchanged from today.

## Attendance Batch Summary (per student)

Source: `GET /api/attendance?studentIds=<comma-joined ids>` (existing, unmodified — same
endpoint and `studentIds` filter feature 001 built for `AttendanceReports.jsx`, and the same
batching principle `StudentsPage.jsx` already uses).

| Field | Type | Notes |
|---|---|---|
| `id`, `studentId`, `groupId`, `date`, `status`, `sessionTime`, `createdAt` | as returned today | Real rows, not counts — needed for the heat display's per-cell tooltips |

**Consumer**: `Dashboard.jsx`'s `StudentRow` — scoped to exactly `students.slice(0, 5)`'s ids;
client keeps its existing per-student `.filter().sort().slice(-10)` over this now-much-smaller
response.

## Same-Day Attendance Existence Check

Source: `GET /api/attendance?studentId=<id>&date=<today>` (existing, unmodified).

| Field | Type | Notes |
|---|---|---|
| `data` | array, 0 or 1 row | Client keeps `rows[0] ?? null` as `existingToday`, unchanged |

**Consumer**: `QRScanner.jsx`'s duplicate-scan check.

## Explicitly unmigrated (documented gaps — FR-005, FR-006)

| Figure | Consumer | Why no data-model entry exists |
|---|---|---|
| `sessions` (distinct group+date pairs, all-time) | `AttendancePage.jsx` | No aggregate dimension counts distinct `(group_id, date)` pairs; `groupBy=date` alone would double-count when groups share a session date. Stays on the full `attendance` array. |
| `pendingFollowup` | `AttendancePage.jsx` | Computed from `attendance` **and** `absenceFollowup` together; `absenceFollowup`/`AbsenceFollowup.jsx` are out of scope for this batch (per clarification). Stays entirely on the store. |

## Relationships

```text
students (store, unchanged)  ──┐
                                ├── join on studentId/groupId ──> rendered figures
groups (store, unchanged)    ──┤    (display names, per-student/per-group breakdowns)
                                │
Attendance *Summary (new       │
  data sources, per §1-§6)   ──┘
```
