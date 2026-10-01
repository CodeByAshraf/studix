# Contract: `GET /api/grades`

**Router file**: `backend/src/routes/grades.js` (new)
**Mounted**: `app.use('/api/grades', requireAuth, requirePermission('exams'), gradesRouter)` in
`backend/src/server.js`, before the generic `COLLECTION_MODELS` loop.
**Reference implementation**: `backend/src/routes/attendance.js`'s `GET /` (lines 102-120).

## Request

| Query param | Type | Required | Notes |
|---|---|---|---|
| `studentId` | string | no | Exact match on `grades.student_id`. |
| `examId` | string | no | Exact match on `grades.exam_id`. |

Both may be supplied together (AND-composed). Neither supplied → identical to the existing
unscoped generic route.

## Response — success (200)

```json
{
  "ok": true,
  "data": [
    { "id": "g_1", "examId": "e_1", "studentId": "s_1", "score": 85, "absent": false, "createdAt": "2026-01-10T00:00:00.000Z" }
  ],
  "count": 1
}
```

- `data`: array of grade rows, camelCase, via `snakeToCamel` + `serializeBigInt` — same fields
  as today's generic `GET /api/grades` response, no additions/removals/renames.
- `count`: `data.length`.
- No matches (valid, known or unknown id) → `{ ok: true, data: [], count: 0 }`, not an error.

## Response — invalid request (400)

**Rule (resolved 2026-09-21, closes analyze finding U1)**: if `studentId` or `examId` is present
on the query string but empty (e.g. `?studentId=`), the request MUST be rejected with 400 before
any Prisma call — same `badRequest()` pattern as `attendance.js` (an Arabic message identifying
which param was empty). If the query param key is absent entirely, it is treated as "no filter
for that dimension," not an error. A non-empty `studentId`/`examId` value proceeds through the
normal query path unchanged — no further format validation is performed (they are opaque
strings, matching how `attendance.js` treats `studentId`/`groupId` today); an unknown-but-
non-empty id simply yields an empty result (FR-009), never a 404.

## Response — auth/permission

| Condition | Status |
|---|---|
| No authenticated user | 401 (via `requireAuth`) |
| Authenticated, missing `exams` permission | 403 (via `requirePermission('exams')`) |
| Authenticated, has `exams` permission | proceeds to the handler above |

Reuses `COLLECTION_PERMISSIONS.grades = 'exams'`, already defined in `server.js` — no new
permission introduced.

## Non-goals (explicitly out of scope for this contract)

- No average-score / percentage computation.
- No ranking / `groupBy=student` aggregate.
- No pagination/`limit`/`offset` beyond what scoping itself already provides (research.md §7).
- Does not intercept `GET /api/grades/:id` or any write method — those continue to be served by
  the generic `makeCrudRouter('grades')` exactly as today.
