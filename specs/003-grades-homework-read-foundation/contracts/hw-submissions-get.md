# Contract: `GET /api/hwSubmissions`

**Router file**: `backend/src/routes/hwSubmissionsScopedGet.js` (new — named to avoid colliding
with the existing `backend/src/routes/hwSubmissions.js` atomic write router; see tasks.md T001
drift note)
**Mounted**: `app.use('/api/hwSubmissions', requireAuth, requirePermission('homework'),
hwSubmissionsScopedGetRouter)` in `backend/src/server.js`, before the generic
`COLLECTION_MODELS` loop.
**Reference implementation**: `backend/src/routes/attendance.js`'s `GET /` (lines 102-120).

## Request

| Query param | Type | Required | Notes |
|---|---|---|---|
| `studentId` | string | no | Exact match on `hw_submissions.student_id`. |
| `homeworkId` | string | no | Exact match on `hw_submissions.homework_id`. |

Both may be supplied together (AND-composed). Neither supplied → identical to the existing
unscoped generic route.

## Response — success (200)

```json
{
  "ok": true,
  "data": [
    { "id": "hs_1", "homeworkId": "hw_1", "studentId": "s_1", "status": "submitted", "submittedAt": "2026-01-10T00:00:00.000Z", "score": null, "notes": null }
  ],
  "count": 1
}
```

- `data`: array of submission rows, camelCase, via `snakeToCamel` + `serializeBigInt` — same
  fields as today's generic `GET /api/hwSubmissions` response, no additions/removals/renames.
- `count`: `data.length`.
- No matches → `{ ok: true, data: [], count: 0 }`, not an error.

## Response — invalid request (400)

**Rule (resolved 2026-09-21, closes analyze finding U1)**: if `studentId` or `homeworkId` is
present on the query string but empty (e.g. `?studentId=`), the request MUST be rejected with
400 before any Prisma call — same `badRequest()` convention as the grades contract. If the query
param key is absent entirely, it is treated as "no filter for that dimension," not an error. A
non-empty value proceeds through the normal query path unchanged — no further format validation
(opaque strings); an unknown-but-non-empty id yields an empty result (FR-009), never a 404.

## Response — auth/permission

| Condition | Status |
|---|---|
| No authenticated user | 401 (via `requireAuth`) |
| Authenticated, missing `homework` permission | 403 (via `requirePermission('homework')`) |
| Authenticated, has `homework` permission | proceeds to the handler above |

Reuses `COLLECTION_PERMISSIONS.hwSubmissions = 'homework'`, already defined in `server.js`.

## Non-goals (explicitly out of scope for this contract)

- No pagination/`limit`/`offset` beyond what scoping itself already provides.
- Does not intercept `GET /api/hwSubmissions/:id` or any write method — those continue to be
  served by the generic `makeCrudRouter('hwSubmissions')` exactly as today.
- Does not intercept `/api/hwSubmissions/aggregate` — see `hw-submissions-aggregate.md`; that
  route is defined on the same router, mounted at the same base path, matching
  `attendance.js`'s `GET /aggregate` technique (a literal path segment checked before the
  generic route's `GET /:id` could ever treat `"aggregate"` as an id).
