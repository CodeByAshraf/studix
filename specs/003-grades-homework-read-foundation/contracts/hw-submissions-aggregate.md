# Contract: `GET /api/hwSubmissions/aggregate`

**Router file**: `backend/src/routes/hwSubmissionsScopedGet.js` (same file as the scoped list
route; see `hw-submissions-get.md` for the filename-collision note)
**Mounted**: same `app.use('/api/hwSubmissions', requireAuth, requirePermission('homework'),
hwSubmissionsScopedGetRouter)` line as `hw-submissions-get.md` — both routes live on one router,
matching `attendance.js`'s single-router-two-routes design.
**Reference implementation**: `backend/src/routes/attendance.js`'s `GET /aggregate` (lines
200-222) and its `aggregateByStatus`/`aggregateByDimension` helpers (lines 160-181).

## Request

| Query param | Type | Required | Notes |
|---|---|---|---|
| `groupBy` | `"status"` \| `"homework"` | **yes** | Any other value → 400. |
| `studentId` | string | no | Optional additional scope, AND-composed into the aggregate's `where`, for consistency with the list route. |
| `homeworkId` | string | no | Same. |

## Response — `groupBy=status` (200)

```json
{ "ok": true, "data": [ { "key": "late", "count": 3 }, { "key": "missing", "count": 5 }, { "key": "submitted", "count": 12 } ] }
```

- Real SQL-side `GROUP BY status, COUNT(*)` (`prisma.hw_submissions.groupBy({ by: ['status'],
  _count: true })`) — never a full-table `findMany` + JS count.
- Sorted by `key` ascending (string compare).
- No submissions in scope → `data: []`.
- Count MUST equal a direct count over the same underlying rows (SC-003) — this falls out of
  using a genuine `GROUP BY`, not an approximation.

## Response — `groupBy=homework` (200)

```json
{
  "ok": true,
  "data": [
    { "key": "hw_1", "total": 8, "submitted": 5, "late": 1, "missing": 2 },
    { "key": "hw_2", "total": 6, "submitted": 6, "late": 0, "missing": 0 }
  ]
}
```

- Real SQL-side `GROUP BY homework_id, status, COUNT(*)`
  (`prisma.hw_submissions.groupBy({ by: ['homework_id', 'status'], _count: true })`), bucketed in
  application code into one row per `homework_id`, exactly as `attendance.js`'s
  `aggregateByDimension()` buckets by `group_id`/`student_id`/`date`.
- Sorted by `key` (the `homework_id`) ascending.
- No submissions in scope → `data: []`.

## Response — invalid `groupBy` (400)

```json
{ "ok": false, "error": "groupBy يجب أن يكون أحد: status, homework." }
```

Thrown before any Prisma call, matching `attendance.js`'s `GROUP_BY_DIMENSIONS`-allow-list
rejection message style (Arabic, names the allowed values).

## Response — auth/permission

Identical table to `hw-submissions-get.md` (same router, same permission gate).

## Non-goals (explicitly out of scope for this contract)

- No `groupBy=student` dimension (not requested for this feature, no named consumer — see
  research.md §5).
- No date-range (`from`/`to`) filter — `hw_submissions` has no per-occurrence date the way
  `attendance` does; `submitted_at` is not a requested scoping dimension in spec.md.
- No `threshold` filter (attendance-specific concept, not requested here).
