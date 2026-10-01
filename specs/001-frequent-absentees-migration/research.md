# Phase 0 Research: Frequent Absentees Report Data Migration

No `NEEDS CLARIFICATION` markers remain in the Technical Context — this is a same-codebase,
same-pattern migration with a fully-known target implementation (verified directly against
the repository during the read-only C4 Phase 2 audit that preceded this spec). The items below
record the decisions and the alternatives that were rejected, rather than open unknowns.

## 1. Data source for the report

**Decision**: Reuse `GET /api/attendance/aggregate?groupBy=student&studentIds=<active ids>[&groupId=]`
(via the existing `pgGetAttendanceAggregate` client in `src/services/api.js`) as the sole data
source, in place of the global `attendance` store array.

**Rationale**: This route already exists, is already mounted, and already returns exactly
`{ key: studentId, total, present, absent, late }` per student for `groupBy: 'student'`
(`backend/src/routes/attendance.js`, `aggregateByDimension` with `column: 'student_id'`), with
an optional `groupId` filter already wired through `buildAggregateWhere`. It is already used
identically by `GroupsPage.jsx` (`groupBy: 'group'`) and `GroupStatistics.jsx`
(`groupBy: 'group'`), and by-student unscoped by `StudentPerformance.jsx`. It is also already
covered by `backend/src/routes/attendance.integration.test.js` (test 14: "studentIds batch
aggregation … groupBy=student"). Reusing it needs zero backend changes.

**Alternatives considered**:
- *New dedicated endpoint* (e.g., `/api/attendance/frequent-absentees?threshold=`) that does
  the threshold filtering server-side. Rejected: duplicates the aggregate logic that already
  exists, and adds a new endpoint to build/test/maintain for a comparison (`absent >= N`) that
  is cheap to do client-side over at most ~500 rows (SC-001's scale target) — the exact
  filtering already done in the current code, just relocated. Violates Simplicity & YAGNI.

## 1a. Bounding the request to active students (resolved via spec.md's second clarification session)

**Decision**: The frontend MUST pass `studentIds=<comma-separated active, group-filtered
student IDs>` alongside `groupBy=student` on every call — not rely on `groupBy=student` alone.

**Rationale**: `groupBy=student` on its own has no concept of student status — Prisma's
`GROUP BY` on `attendance.student_id` returns one row per student who has *any* attendance
record in scope, whether that student is currently active or not. Because Studix never deletes
a student who has attendance history (the delete guard forces suspension instead — see
`StudentsPage.jsx`'s delete flow), a long-running center accumulates inactive-but-historical
students indefinitely, and an unscoped `groupBy=student` call would return a row for every one
of them. SC-001's "2 seconds for up to 500 active students" target implicitly assumes the
payload is bounded by *active* students specifically — which is only true once `studentIds` is
passed, since the aggregate route's `buildAggregateWhere` already applies it as a
`student_id IN (...)` filter *before* the `GROUP BY` runs. This was flagged as a cross-artifact
inconsistency by `/speckit-analyze` (finding I1) and resolved via spec.md's clarification
session as: scope explicitly, don't leave it to the endpoint's default behavior.

**Alternatives considered**:
- *Leave `groupBy=student` unscoped and redefine SC-001/SC-002 to describe the weaker bound*
  ("scales with all students who ever had attendance," not "active students"). Rejected by the
  clarification answer — the whole point of the migration is to make this report's cost
  proportional to the *current, relevant* roster, not to the center's entire operating history.
- *Add active-status filtering inside the backend aggregate route itself* (e.g., join against
  student status server-side). Rejected: requires a backend code change for something the
  existing `studentIds` parameter already solves with zero backend work — violates Simplicity &
  YAGNI when a cheaper, already-available mechanism exists.
- *Keep the full global `attendance` array and just narrow the store selector* (e.g., select
  only recent months). Rejected: the store still requires shipping the entire historical
  attendance table to every client, which is precisely the scaling problem this migration
  exists to fix (SC-002).

## 2. What triggers a re-fetch vs. a client-side re-filter

**Decision**: Only a **group filter** change triggers a new network request (it changes the
server-side `groupId` scope). A **threshold** change is a pure client-side re-filter of the
already-fetched per-student aggregate rows — no new request.

**Rationale**: The aggregate endpoint has no threshold concept and shouldn't gain one (see
§1). Since the endpoint already returns every in-scope student's `absent` count, comparing that
number against the currently-selected threshold is a cheap, synchronous operation over an
already-small array (bounded by active-student count, not history size). This matches FR-009
("update in place, no full page reload") and keeps the interaction instant regardless of
threshold choice.

**Alternatives considered**:
- *Re-fetch on every threshold change too*. Rejected: unnecessary network round-trips for data
  that didn't change server-side; the threshold is purely a display/filter concern.

## 3. Client-side stats computation

**Decision**: Adapt `getFrequentAbsentees` in `src/services/attendanceService.js` to accept a
per-student stats lookup (keyed by `studentId`, shaped like the aggregate rows) instead of a
raw `records` array, and drop its internal dependency on `getAttendanceStats` (which does the
now-redundant `records.filter(r => r.studentId === id)` scan).

**Rationale**: This mirrors the convention already established for `GroupCard.jsx`, which takes
pre-aggregated `attendanceStats` as a prop into `getGroupStats(group, students, payments,
attendanceStats, treasuryTxn)` rather than filtering a global array itself. No new pattern is
introduced — the codebase already treats "pre-aggregated stats in, computed presentation out"
as the norm for every other migrated consumer.

**Alternatives considered**:
- *Reshape the aggregate rows back into fake per-record arrays* just to keep
  `getFrequentAbsentees`'s existing `(students, records, threshold)` signature unchanged.
  Rejected: pure indirection — manufactures data that immediately gets re-aggregated by
  `getAttendanceStats`, which becomes dead code the moment the aggregate already supplies
  `total/present/absent/late` directly.

## 4. Student profile fields (name, group, grade, phone)

**Decision**: Continue joining per-student aggregate rows against the already-loaded
`students` store array on the client, exactly as today — the aggregate endpoint returns
attendance figures only, never student profile fields.

**Rationale**: `students` is a boot-synced store array already present in this component and
untouched by this migration (only the `attendance` selector is being removed). No other
migrated consumer embeds profile fields in the attendance aggregate response either
(`GroupCard`, `StudentPerformance` all do this same client-side join).

**Alternatives considered**:
- *Extend the aggregate endpoint to embed student name/group/grade*. Rejected: breaks the
  single-responsibility of an endpoint shared by three other already-shipped consumers, none
  of which need or want profile fields mixed into an attendance summary.

## 5. Active-student eligibility

**Decision**: Active-status filtering (`students.filter(s => s.status === 'active')`) stays
exactly where it is today — computed client-side against the `students` store. The aggregate
endpoint has no concept of student status and must not gain one. This same computed list now
serves **two** purposes, not one: (a) it is the `studentIds` value sent on the request itself
(§1a — bounding what gets fetched), and (b) after the response comes back, it's still applied
again during the `getFrequentAbsentees` join (a student's `status` can only be known from the
`students` store, never from an attendance row) — cheap and correct even though (a) already
narrowed the server-side result to the same set, since it keeps the pure function's contract
self-contained and correct even if called with a stats map that wasn't pre-scoped.

**Rationale**: `attendance` rows are historical facts independent of a student's current
status; only the presentation layer knows "active" is the eligibility rule for this report
(FR-008). A student the aggregate endpoint has no row for at all (zero attendance history, or —
after §1a — simply not in the requested `studentIds` list at all) never appears in the returned
rows — which is the correct behavior already required by FR-010 (no false 0%, no error) since
such a student can never meet an absence threshold ≥ 2 anyway.

**Alternatives considered**: None — no gap exists here; this is a direct continuation of
existing, correct behavior, now additionally reused as the `studentIds` request scope (§1a).
