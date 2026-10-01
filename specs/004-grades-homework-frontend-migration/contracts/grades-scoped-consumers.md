# Contract: `pgGetGrades` consumers

**New function**: `src/services/api.js` — `pgGetGrades(params = {})`
```js
export async function pgGetGrades(params = {}) {
  const res = await fetch(`${PG_API_BASE}/api/grades${buildQueryString(params)}`, { credentials: 'include' });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG GET /grades → ${res.status}`);
  if (!Array.isArray(json?.data)) throw new Error('PG GET /grades → استجابة غير صالحة (data ليست مصفوفة)');
  return json.data.map(normalizeGradeResponse);
}
```
(`normalizeGradeResponse` per data-model.md's Grade Record table — new private helper, same
file, mirroring `normalizePaymentResponse`'s existing placement/convention.)

Backend: `GET /api/grades?studentId=&examId=` (feature 003, unchanged, permission `exams`).

## Consumer 1 — `StudentsPage.jsx`, `handleDelete`, grades safety check

- **Call**: `await pgGetGrades({ studentId: s.id })`, read `.length` for the count.
- **Replaces**: `grades.filter(g => g.studentId === s.id).length` (global selector removed from
  this file if item 5's hwSubmissions check is the only other reader — see
  `hw-submissions-scoped-consumers.md`).
- **Error handling**: identical try/catch shape already used in the same function for
  `pgGetPayments`/`pgGetCommunications` — a failed check blocks the delete with a toast, never
  silently allows it.
- **Loading**: none needed — this runs inside an already-async `handleDelete`, no render-blocking
  concern.

## Consumer 2 — `StudentProfile.jsx`, `ExamsTab`

- **Call**: `useAsyncData(() => pgGetGrades({ studentId: student.id }), [student.id], [])`.
- **Replaces**: the `grades` prop's global-store source.
- **Unchanged**: `studentGrades`/`passed`/`avgScore` — all `useMemo`-derived from the fetched
  array joined against the already-loaded `exams` collection (research.md §5 — reactive, no
  mount-gating required for correctness).
- **Required**: gate the `studentGrades.length === 0` empty-state message ("لا توجد نتائج بعد")
  behind `loading === false`, so it doesn't flash before the fetch resolves.
- **Required (closes analyze finding U1, FR-011)**: on a failed fetch (`error` non-null from
  `useAsyncData`), surface a clear, user-visible error state using the app's existing convention
  for `useAsyncData`-driven reads — a `useEffect` watching `error` that calls
  `toast.error(error.message || '<Arabic fallback message>')`, exactly as
  `AttendanceAnalytics.jsx` already does for its own `useAsyncData` calls. No new error-UI
  component or abstraction — no inline banner, no change to the empty-state markup.

## Consumer 3 — `ExamResults.jsx`

- **Call**: `useAsyncData(() => pgGetGrades({ examId: exam.id }), [exam.id], [])`.
- **Replaces**: the `grades` store selector.
- **Unchanged**: `getExamStatsWithPass`, `eligibleStudents`, `ranked`, distribution — all
  `useMemo`-derived, reactive (research.md §5).
- **Required**: gate the `examGrades.length === 0` empty-state message ("لم يتم إدخال الدرجات
  بعد") behind `loading === false`.
- **Required (closes analyze finding U1, FR-011)**: same error-state convention as Consumer 2 —
  `useEffect` on `error` → `toast.error(error.message || '<Arabic fallback message>')`. No new
  error-UI component.
- **Test file**: `ExamResults.test.jsx` does not exist today — must be created new.

## Consumer 4 — `GradeEntry.jsx`

- **Call**: `useAsyncData(() => pgGetGrades({ examId: exam.id }), [exam.id], [])`, used ONLY to
  seed `localGrades`' initial state.
- **Required (correctness, not cosmetic — research.md §5)**: do not mount the editable grade-row
  table (whose `localGrades` is a one-time `useState` lazy initializer) until the fetch's
  `loading` is `false`. Render a loading placeholder in its place until then.
- **Unchanged**: `handleSave`'s `pgSaveExamGrades` call and its `setGrades(...)` global-store sync
  (lines 196-201 today) — completely untouched, still keeps the store correct for
  StudentPerformance/ExamReports/Grades-average (deferred, unmigrated consumers).
- **Required (closes analyze finding U1, FR-011)**: same error-state convention as Consumer 2 —
  `useEffect` on `error` → `toast.error(error.message || '<Arabic fallback message>')`, shown in
  addition to (not instead of) the loading-gate requirement above. No new error-UI component.
