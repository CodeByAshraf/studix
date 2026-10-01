# Phase 1 Data Model: Grades + Homework Submissions Backend Read Foundation

No schema changes. This documents the two existing entities this feature exposes new *read*
access patterns for (per `backend/prisma/schema.prisma`), and the new scoping/summary shapes
built on top of them. Both tables and all their fields already exist and are already returned by
the existing generic route — this feature adds no field.

## Entity: Grade Record (`grades` table, Prisma model `grades`)

| Field | Type | Notes |
|---|---|---|
| `id` | String (PK) | Unchanged, opaque id. |
| `exam_id` | String (FK → `exams.id`) | New scoping dimension (FR-002): `examId` query param. |
| `student_id` | String (FK → `students.id`) | New scoping dimension (FR-001): `studentId` query param. |
| `score` | Decimal? (nullable) | Passed through unchanged (`serializeBigInt`/Prisma Decimal → JSON number, same as today's generic route). |
| `absent` | Boolean | Passed through unchanged. |
| `created_at` | DateTime | Passed through unchanged. |

- **Uniqueness**: `@@unique([exam_id, student_id])` — one grade row per student per exam. This is
  the concrete evidence for why `studentId`+`examId` are the two (and only two) scoping
  dimensions in FR-001/FR-002/FR-003.
- **Row shape returned**: camelCase via `snakeToCamel` — `{id, examId, studentId, score, absent,
  createdAt}` — identical to what the existing generic `GET /api/grades` already returns today
  (FR-013: no field removed, renamed, or reshaped).
- **No new derived/computed field.** A percentage (`score / exams.total`) is explicitly NOT
  computed by this feature (FR-012) — it would require joining in `exams.total`, deferred to
  "Grades Batch B" (see research.md §3).
- **Validation rules for this feature's new params**:
  - `studentId` (optional): non-empty string when provided; unknown id → empty result, not an
    error (FR-009).
  - `examId` (optional): non-empty string when provided; unknown id → empty result, not an error.
  - Both may be provided together (AND-composed, FR-003); neither provided → unscoped, identical
    to today.

## Entity: Homework Submission Record (`hw_submissions` table, Prisma model `hw_submissions`)

| Field | Type | Notes |
|---|---|---|
| `id` | String (PK) | Unchanged, opaque id. |
| `homework_id` | String (FK → `homeworks.id`) | New scoping dimension (FR-005): `homeworkId` query param; also the "by assignment" summary dimension (FR-007). |
| `student_id` | String (FK → `students.id`) | New scoping dimension (FR-004): `studentId` query param. |
| `status` | String, default `'missing'` | Direct, ungrouped column — the "by status" summary dimension (FR-006). Known values: `submitted` / `late` / `missing` (per spec User Story 4's acceptance scenarios and existing frontend usage). |
| `submitted_at` | DateTime? (nullable) | Passed through unchanged. |
| `score` | (existing field) | Passed through unchanged. |
| `notes` | (existing field) | Passed through unchanged. |

- **Uniqueness**: `@@unique([homework_id, student_id])` — one submission row per student per
  homework assignment. Concrete evidence for why `studentId`+`homeworkId` are the scoping
  dimensions in FR-004/FR-005.
- **Row shape returned**: camelCase via `snakeToCamel` — identical field set to what the existing
  generic `GET /api/hwSubmissions` already returns today (FR-013).
- **Validation rules for the scoped list (`GET /`)**:
  - `studentId` (optional): non-empty string when provided; unknown id → empty result.
  - `homeworkId` (optional): non-empty string when provided; unknown id → empty result.
  - Both optional and independently composable; neither provided → unscoped, identical to today.

### Derived shape: Status Summary (`GET /aggregate?groupBy=status`)

Not a stored entity — a server-side `GROUP BY status, COUNT(*)` over `hw_submissions` (optionally
narrowed by the same `studentId`/`homeworkId` filters, composable, for consistency with the list
route and with `attendance.js`'s own aggregate route accepting the same scope filters as its list
route).

```
[{ key: "submitted", count: 12 }, { key: "late", count: 3 }, { key: "missing", count: 5 }]
```

- Sorted by `key` ascending (string compare), matching `attendance.js`'s `aggregateByStatus()`.
- No rows in the table (or in the filtered scope) → `[]`, not an error (FR-009, User Story 4
  Acceptance Scenario 3).

### Derived shape: Per-Assignment Summary (`GET /aggregate?groupBy=homework`)

Not a stored entity — a server-side `GROUP BY homework_id, status, COUNT(*)` over
`hw_submissions`, bucketed in application code into one row per `homework_id` carrying its own
status breakdown (same bucketing technique as `attendance.js`'s `aggregateByDimension()`).

```
[
  { key: "hw_1", total: 8, submitted: 5, late: 1, missing: 2 },
  { key: "hw_2", total: 6, submitted: 6, late: 0, missing: 0 }
]
```

- `key` is the `homework_id`; `total` is the sum of that assignment's submission rows;
  `submitted`/`late`/`missing` are per-status counts (any status value present in the data gets
  its own key on the bucket object, same dynamic-key technique `aggregateByDimension()` already
  uses for `present`/`absent`/`late`).
- Sorted by `key` ascending, matching `attendance.js`.
- No submissions at all → `[]`.

### Invalid `groupBy` value

Any value other than `status` or `homework` → HTTP 400 before any Prisma call, same
`GROUP_BY_DIMENSIONS`-allow-list technique as `attendance.js`'s aggregate route (FR-010).

## Relationships relevant to this feature (read-only, unchanged)

- `grades.exam_id → exams.id`, `grades.student_id → students.id` — both already-existing FKs;
  this feature reads by them, adds no new relation.
- `hw_submissions.homework_id → homeworks.id`, `hw_submissions.student_id → students.id` — same.

## State transitions

None. Both entities are read-only in this feature; their write/lifecycle behavior is entirely
owned by the existing atomic roster-save routers (`examGrades.js` for grades,
`hw-submissions.js` for hwSubmissions), which this feature does not touch (FR-011).
