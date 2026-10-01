# Contract: Endpoints consumed by Attendance C4 Batch A

**Status**: All five endpoint shapes below already exist and are unmodified by this feature —
documented here because this feature is a new consumer of each, not because behavior changes.
Source of truth: `backend/src/routes/attendance.js`, covered by
`backend/src/routes/attendance.integration.test.js`.

## 1. `GET /api/attendance/aggregate?groupBy=status`

Used by: `ReportsPage.jsx`, `AttendanceAnalytics.jsx`, `AttendancePage.jsx`.

- No params beyond `groupBy=status`. No date/group scoping — matches today's unscoped, all-time
  behavior for these three consumers exactly.
- Response: `{ ok: true, data: [{key:'present'|'absent'|'late', count: number}] }` — one entry
  per status that has at least one row; a status with zero rows is simply absent from the array
  (client must default missing keys to `0`, not assume all three are always present).

## 2. `GET /api/attendance/aggregate?groupBy=group`

Used by: `AttendanceAnalytics.jsx` (`byGroup`).

- No params beyond `groupBy=group`.
- Response: `{ ok: true, data: [{key: groupId, total, present, absent, late}] }` — one entry per
  group that has at least one attendance row. A group with zero attendance rows is absent from
  the array; client renders it with `pct: 0`/no bar, matching today's behavior where
  `recs.length ? ... : 0` already handles the empty case identically.

## 3. `GET /api/attendance/aggregate?groupBy=date&from=<YYYY-MM-DD>&to=<YYYY-MM-DD>`

Used by: `AttendanceAnalytics.jsx` (`dailyTrend`).

- `from` MUST be computed client-side as 90 calendar days before "today" (per spec.md's
  clarification); `to` MUST be "today". Both in `YYYY-MM-DD` form, matching every other date
  param already used elsewhere in this codebase (e.g., `attendanceSessions.js`).
- Response: `{ ok: true, data: [{key: "YYYY-MM-DD", total, present, absent, late}] }` — already
  sorted ascending by `key` (server-side, per `aggregateByDimension`'s own `.sort()`); one entry
  per date that has at least one row within the window. Client takes `.slice(-14)`.
- If the resulting array has fewer than 14 entries (a new or low-frequency center), that is
  correct, expected behavior — identical to today's trend showing fewer than 14 points in the
  same situation. Do not widen the window client-side to compensate.

## 4. `GET /api/attendance/aggregate?groupBy=weekday&status=absent`

Used by: `AttendanceAnalytics.jsx` (`dayData`).

- `status=absent` is required — omitting it would count all statuses per weekday, not just
  absences, changing the figure's meaning.
- Response: `{ ok: true, data: [{key: 'sat'|'sun'|'mon'|'tue'|'wed'|'thu'|'fri', count: number}] }`
  — already filtered server-side to `count > 0`; returned in `DAY_KEYS_AR_ORDER` (Saturday-first),
  **not** sorted by count. Client must still sort descending by `count` itself, exactly as today.

## 5. `GET /api/attendance?studentIds=<id1,id2,...>`

Used by: `Dashboard.jsx` (`StudentRow` heat, scoped to `students.slice(0,5)`'s ids).

- Same endpoint and parameter feature 001 built `AttendanceReports.jsx`'s frequent-absentees tab
  on; see that feature's own contract doc
  (`specs/001-frequent-absentees-migration/contracts/attendance-aggregate-student.md`) for the
  full failure-mode documentation (empty `studentIds` → 400; omitted `studentIds` → unscoped,
  dangerous fallback).
- **Consequence for this consumer**: `Dashboard.jsx` always has at least the students it's about
  to render (`students.slice(0,5)`), but the guard from feature 001 still applies — if that slice
  is ever empty (a center with zero students at all), skip the call entirely rather than send an
  empty/omitted `studentIds`.
- Response: `{ ok: true, data: [{id, studentId, groupId, date, status, sessionTime, createdAt}] }`
  — real rows, not counts, needed for the heat display's per-cell tooltips (unchanged from
  feature 001's identical need).

## 6. `GET /api/attendance?studentId=<id>&date=<YYYY-MM-DD>`

Used by: `QRScanner.jsx` (same-day duplicate check).

- `date` MUST be "today" in `YYYY-MM-DD` form (same `today` variable the component already
  computes for its own record-writing logic).
- Response: `{ ok: true, data: [] }` or `{ ok: true, data: [{...one row...}] }` — the
  `student_id, date, group_id` unique constraint on the `attendance` table guarantees at most one
  row per student per date, so `data.length` is always 0 or 1.

## Non-goals of this contract doc

No new endpoint, parameter, or response field is being added for this feature. `AttendancePage.jsx`'s
`sessions` and `pendingFollowup` figures have no corresponding contract here — see
`data-model.md`'s "Explicitly unmigrated" section and `research.md` §4 for why.
