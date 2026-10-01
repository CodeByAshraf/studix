# Contract: `pgGetHwSubmissions` consumers

**New function**: `src/services/api.js` — `pgGetHwSubmissions(params = {})`
```js
export async function pgGetHwSubmissions(params = {}) {
  const res = await fetch(`${PG_API_BASE}/api/hwSubmissions${buildQueryString(params)}`, { credentials: 'include' });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG GET /hwSubmissions → ${res.status}`);
  if (!Array.isArray(json?.data)) throw new Error('PG GET /hwSubmissions → استجابة غير صالحة (data ليست مصفوفة)');
  return json.data.map(normalizeHwSubmissionResponse);
}
```
(`normalizeHwSubmissionResponse` per data-model.md's Homework Submission Record table — new
private helper, mirrors `db.middleware.js`'s `COLLECTION_FIXUPS.hwSubmissions` exactly, including
the `homeworkId`→`hwId` rename.)

Backend: `GET /api/hwSubmissions?studentId=&homeworkId=` (feature 003, unchanged, permission
`homework`).

## Consumer 5 — `StudentsPage.jsx`, `handleDelete`, hwSubmissions safety check

- **Call**: `await pgGetHwSubmissions({ studentId: s.id })`, read `.length`.
- **Replaces**: `hwSubmissions.filter(h => h.studentId === s.id).length`.
- **Error handling**: identical to consumer 1 — same function, same established try/catch shape.

## Consumer 6 — `HomeworkTracking.jsx`

- **Call**: `useAsyncData(() => pgGetHwSubmissions({ homeworkId: hw.id }), [hw.id], [])`.
- **Replaces**: the `hwSubmissions` store selector — used at TWO call sites in this file:
  1. Seeding `localSubs`' initial state (`x.hwId === hw.id && x.studentId === s.id` lookup).
  2. Passed as the `hwSubmissions` argument to `openHomeworkReportPrint({...})`
     (`buildHomeworkReport.js` reads `x.hwId === hw.id && x.studentId === s.id` — works
     unchanged once fed the normalized, `hwId`-bearing array).
- **Required (correctness, not cosmetic — research.md §5)**: do not mount the editable
  submission-status table (whose `localSubs` is a one-time `useState` lazy initializer) until
  `loading` is `false`. The print button must only be reachable once the real data has loaded
  (it already implicitly depends on `hwSubmissions` being the real array, not an empty
  placeholder).
- **Unchanged**: `handleSave`'s `pgSaveHwSubmissions` call and its `setHwSubmissions(...)`
  global-store sync (lines 193-196 today) — untouched, still keeps the store correct for
  HomeworkPage/HomeworkReports until they are migrated in this same feature (consumers 7-9) and
  for any other consumer.
- **Required (closes analyze finding U1, FR-011)**: on a failed fetch (`error` non-null from
  `useAsyncData`), surface a clear, user-visible error state using the app's existing convention
  for `useAsyncData`-driven reads — a `useEffect` watching `error` that calls
  `toast.error(error.message || '<Arabic fallback message>')`, exactly as
  `AttendanceAnalytics.jsx` already does. Shown in addition to (not instead of) the loading-gate
  requirement above. No new error-UI component or abstraction.
