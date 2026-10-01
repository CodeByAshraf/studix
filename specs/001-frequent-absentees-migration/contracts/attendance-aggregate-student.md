# Contract: GET /api/attendance/aggregate (groupBy=student)

**Status**: Existing, unmodified by this feature. Documented here because this feature is a
new consumer of it, not because its behavior changes.

**Source of truth**: `backend/src/routes/attendance.js` (`router.get('/aggregate', …)`,
`aggregateByDimension`), already covered by
`backend/src/routes/attendance.integration.test.js`.

## Request

```
GET /api/attendance/aggregate?groupBy=student&studentIds=<id1,id2,...>[&groupId=<uuid>]
```

Auth: `requireAuth` + `requirePermission('attendance')` (existing, unchanged — the same gate
already protecting every tab of this report).

| Param | Required | Used by this feature? | Notes |
|---|---|---|---|
| `groupBy` | yes | yes, always `student` | Only value this feature ever sends |
| `studentIds` | no on the endpoint, but **required by this feature** | **yes, always** | Comma-separated list of the client's current active (and, if a group is selected, group-filtered) student IDs — see research.md §1a. This is what bounds the response to the active roster instead of every student who has ever had an attendance record; never call this endpoint for this report without it |

**`studentIds` failure modes — read before touching T005's guard**:
- An **empty or whitespace-only** `studentIds` value (e.g., `studentIds=` or `studentIds=%20`) makes the server throw a 400 (`buildAggregateWhere` in `backend/src/routes/attendance.js`: `ids.length === 0` after trimming → `badRequest(...)`).
- **Omitting** `studentIds` entirely (no such query param at all) does **not** error — it silently falls through to an **unscoped** request, returning every student who has any attendance record in scope, active or not. This is the exact behavior this feature must never trigger (it's the root cause `/speckit-analyze` flagged as finding I1).
- Consequence for this feature: when the client's active (and group-filtered) student-id list is empty, the correct behavior is to **skip calling this endpoint entirely** — never send the request with an empty `studentIds`, and never send it with `studentIds` omitted. See `tasks.md` T005's `activeStudentIds.length > 0` guard, which resolves to `[]` locally instead.
| `groupId` | no | yes, when a group filter is selected | Omitted entirely when "all groups" is selected; narrows both `studentIds`'s upstream computation (client-side) and this param together |
| `studentId` | no | **no** | Not used — that's the single-student form; this feature always needs a batch |
| `date` / `from` / `to` | no | **no** | Not used — this report is not date-scoped |
| `status` | no | **no** | Not used — this report needs all statuses to compute `present`/`absent`/`late` together |
| `threshold` | no | **no** | This is the aggregate route's own absence-threshold filter on a *different* dimension shape; this feature applies its own client-side threshold against `absent` instead (see research.md §2) — do not pass it |

## Response (on success)

```json
{
  "ok": true,
  "data": [
    { "key": "<studentId>", "total": 12, "present": 9, "absent": 2, "late": 1 },
    { "key": "<studentId>", "total": 6,  "present": 4, "absent": 2, "late": 0 }
  ]
}
```

- `data` includes one row per requested `studentIds` entry that has **at least one** attendance
  record in scope (further narrowed by `groupId`, if provided). Students with zero attendance
  history — or simply not included in `studentIds` — are absent from the array entirely; see
  data-model.md's Edge Cases.
- Row order is not guaranteed/relied upon; this feature sorts client-side by `absent`
  descending after joining against the `students` store.

## Response (on failure)

Standard Studix API error shape: `{ "ok": false, "error": "<message>" }` with a non-2xx status.
This feature surfaces that as the "clear error message" required by FR-005, via the same
`useAsyncData` + toast-on-error pattern already used by the other 3 tabs in
`AttendanceReports.jsx`.

## Non-goals of this contract doc

No new endpoint, parameter, or response field is being added. If a future feature needs
server-side threshold filtering or student-profile fields embedded in this response, that is
out of scope here and would need its own spec — see spec.md's Assumptions.
