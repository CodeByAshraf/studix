# Data Model: Frequent Absentees Report Data Migration

No database schema changes. This document describes the view-level shapes this feature reads,
derives, and joins — all sourced from data structures that already exist.

## Student Absence Summary (per-student aggregate row)

Source: `GET /api/attendance/aggregate?groupBy=student&studentIds=<active ids>[&groupId=]`
(existing, unmodified — the `studentIds` parameter already exists on this endpoint and is now
a **required** part of this feature's request, not optional — see research.md §1a).

| Field | Type | Origin | Notes |
|---|---|---|---|
| `key` | string (student id) | server aggregate | Matches a `students` store entry's `id` |
| `total` | integer | server aggregate | Count of attendance rows for this student (within `groupId`/`studentIds` scope) |
| `present` | integer | server aggregate | |
| `absent` | integer | server aggregate | The figure the threshold filter compares against |
| `late` | integer | server aggregate | Displayed but not part of threshold/severity logic (unchanged from today) |

**Cardinality**: One row per requested `studentIds` entry that has **at least one** attendance
record in scope. A student with zero attendance history has no row at all (see Edge Cases
below). Because `studentIds` is always populated with the client's current active (and
optionally group-filtered) student list, the row count is bounded by that active roster size
(SC-001/SC-002) — never by the center's total historical student count.

## Derived: Frequent Absentee (client-side, per listed student)

Computed by joining a Student Absence Summary row against the matching `students` store entry,
then applying the unchanged presentation rules already in `ReportFrequentAbsentees`.

| Field | Derivation | Unchanged from today? |
|---|---|---|
| `id`, `name`, `groupId`, `grade`, `phone`/`parentPhone` | From the `students` store entry | Yes |
| `absent` | From the Student Absence Summary row | Yes (value now sourced differently, same meaning) |
| `pct` | `total > 0 ? round(present / total * 100) : null` | Yes |
| `severity` | `absent >= 7 ? 'critical' : absent >= 5 ? 'warning' : 'follow-up'` | Yes |

**Eligibility rule** (unchanged): only entities where the joined `students` entry has
`status === 'active'` are included.

**Threshold rule** (unchanged): only entities where `absent >= selectedThreshold` are included
in the rendered list; the threshold comparison itself never changes value sourcing, only when
the comparison runs (client-side re-filter vs. today's client-side filter over the full store —
see research.md §2).

**Sort order** (unchanged): descending by `absent`.

## Relationships

```text
students (store, unchanged)  ──┐
                                ├── join on studentId ──> Frequent Absentee (rendered row)
Student Absence Summary (new   │
  data source, per student)  ──┘
```

## Edge cases mapped to this model

- **No attendance history for a student** → no Student Absence Summary row exists for that
  `studentId` → the join simply never produces a Frequent Absentee row for them → correctly
  absent from the list (matches FR-010; not an error, not a false 0%).
- **Inactive/suspended student with a high absence count** → they are never included in the
  `studentIds` sent on the request (§1a), so no Student Absence Summary row for them is even
  fetched, let alone rendered — a stronger guarantee than "excluded at render time" alone, and
  the mechanism that keeps request size bounded despite Studix never deleting students who have
  attendance history (matches FR-008 and closes the gap `/speckit-analyze` flagged as I1).
- **Transferred student** → the Student Absence Summary row is keyed by `studentId`, not by
  their group history; a transferred student's older records remain attributed to whichever
  `group_id` was recorded at the time (existing, unchanged system-wide convention — see spec
  Edge Cases). When a `groupId` filter is active, only rows whose underlying attendance records
  carry that `group_id` count toward `total`/`absent` for that view, exactly as today.
