# Phase 0 Research: Attendance C4 Batch A — Safe Read Migration

No `NEEDS CLARIFICATION` markers remain — both open questions from the spec's clarification
session (the 14-day trend's lookback window; the "needs follow-up" indicator's scope) are
already resolved and encoded in `spec.md` FR-002/FR-006. The items below record verified
mappings between each current client-side computation and its exact backend equivalent,
confirmed by reading `backend/src/routes/attendance.js` directly (the same route feature 001
already migrated `AttendanceReports.jsx` onto).

## 1. `ReportsPage.jsx` — `OverviewDashboard.attPct`

**Current**: `attRecs = attendance; attPct = round(present/total*100)` over the *entire* global
array, unscoped by date or group (`src/modules/reports/ReportsPage.jsx:93-94`).

**Decision**: `GET /api/attendance/aggregate?groupBy=status` → `aggregateByStatus` returns
`[{key:'present',count},{key:'absent',count},{key:'late',count}]`; `attPct` becomes
`round(presentCount / (presentCount+absentCount+lateCount) * 100)`. Exact match — no date/group
scoping exists today either, so none is introduced.

**Alternatives considered**: None — this is the same one-to-one mapping feature 001 already
proved is safe for a global percentage.

## 2. `AttendanceAnalytics.jsx` — four sub-computations

**Current** (`src/modules/reports/AttendanceAnalytics.jsx:20-64`), each still reading the full
global `attendance` array after this feature (only its `absentees` sub-computation was migrated
in feature 001, via `statsByStudentFromRecords`):

- `total/present/absent/late/pct` — same shape as §1 → `groupBy=status`.
- `byGroup` (per-group present % for the bar chart) — `attendance.filter(r=>r.groupId===g.id)`
  per group → `GET /api/attendance/aggregate?groupBy=group` returns
  `[{key:groupId,total,present,absent,late}]` per group directly; `pct = round(present/total*100)`
  computed client-side exactly as today, just over pre-aggregated rows instead of a client-side
  filter.
- `dailyTrend` (last 14 *session-dates with data*, not last 14 calendar days) —
  `groupBy=date&from=<today-90d>&to=<today>` returns `[{key:date,total,present,absent,late}]`
  already sorted ascending by date (`aggregateByDimension`'s own `.sort()`); client still does
  `.slice(-14)` and `pct = round(present/total*100)` per entry — identical to today's
  `Object.entries(byDate).sort().slice(-14).map(...)`. The 90-day lookback (clarified) makes this
  an exact-match migration for any realistically-scheduled center; see §5 for the residual risk.
- `dayData` (absences per weekday, sorted descending, zero-count days hidden) —
  `groupBy=weekday&status=absent` returns `[{key:'sat',count},...]` (only weekdays with
  `count > 0`, already filtered server-side by `aggregateByWeekday`) — client maps `key` to the
  existing Arabic day label and still sorts descending by count, exactly as today (the aggregate
  route itself returns `DAY_KEYS_AR_ORDER` order, not count order — the client-side sort step is
  unchanged, not new).

**Decision**: Migrate all four via the four aggregate dimensions above; `absentees` is already
migrated (feature 001) and untouched by this feature.

**Alternatives considered**: A single combined "analytics summary" endpoint returning all four
shapes in one call. Rejected: each dimension already exists as its own tested, reusable primitive
(shared with Groups/GroupStatistics/StudentsPage/AttendanceReports); a combined endpoint would be
a new, single-purpose backend capability for a component that can already assemble its view from
four independent, already-proven calls — violates Simplicity & YAGNI (constitution Principle VI)
for no measurable benefit (four small aggregate queries vs. one, on an internal admin dashboard,
is not a meaningful performance difference).

## 3. `Dashboard.jsx` — `StudentRow` heat (5 students)

**Current**: `attendance.filter(a=>a.studentId===student.id).sort(...).slice(-10)` computed
client-side, once per row, from the *full* global array, for `students.slice(0,5)`
(`src/modules/Dashboard.jsx:84-96,415-416`).

**Decision**: One batched `GET /api/attendance?studentIds=<the exact 5 ids>` call (identical
pattern to `StudentsPage.jsx`'s per-page-of-students batch, and to feature 001's guard against
ever sending zero/omitted `studentIds`), then the same client-side per-student
`.filter().sort().slice(-10)` over the now-much-smaller batched response. `attRecs =
attendance.slice(-50)` (the separate, out-of-scope `stats.attPct` at `Dashboard.jsx:211-212`) is
**not** touched — it stays reading the full global array, per FR-008/spec Edge Cases.

**Alternatives considered**: Reusing `AttendanceHeatMap`'s existing aggregate-free component
unchanged (no alternative needed — it already takes raw records as a prop, same as today; only
the data source feeding it changes, exactly as `StudentsPage.jsx` already did).

## 4. `AttendancePage.jsx` — overview KPIs

**Current** (`src/modules/attendance/AttendancePage.jsx:57-67`): `total/present/absent/late/pct`
computed over the full global array (unscoped, all-time — identical scope to §1); `sessions =
[...new Set(attendance.map(r=>`${r.groupId}-${r.date}`))].length` (distinct group+date pairs,
all-time); `absentees` (already migrated in feature 001 via the adapter); `pendingFollowup =
attendance.filter(absent).filter(no completed followup).length`.

**Decision**:
- `total/present/absent/late/pct` → `groupBy=status`, identical mapping to §1.
- `sessions` → **left unmigrated** (FR-005). No aggregate dimension in `attendance.js` counts
  distinct `(group_id, date)` pairs — `groupBy=date` counts rows per date across *all* groups
  combined, which double-counts distinct pairs whenever two different groups share a session
  date, and `groupBy=group` counts rows per group, not per group+date pair. Inventing a sixth
  aggregate dimension (`groupBy=session`) purely for this one KPI, on a page that will still read
  the full array anyway for `pendingFollowup`, fails the "reuse before build" YAGNI ordering — see
  spec.md's Assumptions and FR-005/FR-009.
- `pendingFollowup` → **left unmigrated** (FR-006, per the clarification). It is computed from
  `attendance` *combined with* `absenceFollowup`, and `absenceFollowup`/`AbsenceFollowup.jsx` are
  explicitly out of scope for this batch — migrating only the `attendance` half while
  `absenceFollowup` stays store-sourced would create two differently-timed data sources feeding
  one number, a real correctness risk for zero net payload reduction (the page still needs the
  full `attendance` array in scope for `sessions` regardless).

**Consequence**: because `sessions` and `pendingFollowup` both stay on the full global array,
`AttendancePage.jsx` keeps its `useAppStore(s => s.attendance)` selector after this feature —
only the four migrated KPI values switch to the aggregate call; the store read is not removed
from this file, unlike `AttendanceReports.jsx` in feature 001. This is a deliberate, documented
partial migration, not an oversight.

**Alternatives considered**: Migrating `sessions` to a client-side count over a *scoped* fetch
(e.g., `groupBy=date` combined with `groupBy=group` cross-referenced) — rejected: reconstructing
distinct-pair counting from two separate aggregate calls client-side is more complex and more
fragile than the one-line `Set` computation already in production today, for a KPI whose exact
current behavior the spec explicitly forbids changing (FR-005) — there's no simplification to be
had, only risk, so "leave it exactly as it is" is the correct, simplest choice here.

## 5. `QRScanner.jsx` — same-day duplicate check

**Current**: `attendance.find(r => r.studentId===studentId && r.date===today)` over the full
global array, per scan (`src/modules/id-cards/components/QRScanner.jsx:62-64`).

**Decision**: `GET /api/attendance?studentId=<id>&date=<today>` — already-existing, already-tested
scoped filter combination (`buildAggregateWhere`'s sibling, the plain list route's own
`studentId`+`date` WHERE clause). Returns `[]` or `[{...}]`; client keeps the exact same
`existingToday = rows[0] ?? null` check and warning logic.

**Explicitly not touched**: the write path (`setAttendance(prev => [...prev, newRecord])`,
`QRScanner.jsx:85`) never calls the backend at all today — this is a pre-existing, unrelated gap
(the component's own header comment: "Simulates QR scanner... in production wire to..."). FR-007
covers only the read; the write path is out of scope per the user's explicit instruction, and
`AttendancePage.jsx`'s "QR (قريباً)" beta tab is a *different* component entirely (`QRAttendance`,
not `QRScanner`) — not touched by this feature either way.

**Alternatives considered**: None — single-student, single-date lookup is the simplest possible
scoped-GET use case, already proven by `SessionMarking.jsx`'s own existing-session check pattern.

## 6. Residual risk: weekday convention (dayData / §2)

`aggregateByWeekday` (backend) computes each row's weekday via `dayCodeOf()` from
`attendanceEligibility.js`; the current frontend computes it via `new Date(r.date).getDay()`
directly (`AttendanceAnalytics.jsx:51`). Both were verified to agree for this deployment's fixed
timezone (Egypt, UTC+2/+3 — a positive offset from UTC never rolls a UTC-midnight date-only value
back to the previous local day, only forward within the same day), so no discrepancy is expected.
This is flagged here as a residual risk to cover with an explicit test assertion during
implementation (comparing the aggregate's weekday buckets against the client's own current
computation over the same fixture data), not as an open question — the constitution's offline,
single-locale deployment model means this is a one-time, verifiable fact for this codebase, not a
general timezone-safety concern requiring a design decision.
