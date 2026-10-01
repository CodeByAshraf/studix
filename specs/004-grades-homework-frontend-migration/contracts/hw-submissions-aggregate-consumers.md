# Contract: `pgGetHwSubmissionsAggregate` consumers

**New function**: `src/services/api.js` — `pgGetHwSubmissionsAggregate(params = {})`
```js
export async function pgGetHwSubmissionsAggregate(params = {}) {
  const res = await fetch(`${PG_API_BASE}/api/hwSubmissions/aggregate${buildQueryString(params)}`, { credentials: 'include' });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `PG GET /hwSubmissions/aggregate → ${res.status}`);
  if (!Array.isArray(json?.data)) throw new Error('PG GET /hwSubmissions/aggregate → استجابة غير صالحة (data ليست مصفوفة)');
  return json.data; // no normalization needed — see data-model.md
}
```

Backend: `GET /api/hwSubmissions/aggregate?groupBy=status|homework` (feature 003, unchanged,
permission `homework`).

## Consumer 7 — `HomeworkPage.jsx`, `kpi.totalSub`

- **Call**: `useAsyncData(() => pgGetHwSubmissionsAggregate({groupBy:'status'}), [], [])`.
- **Replaces**: `hwSubmissions.filter(s => s.status==='submitted').length` (line 174 today).
- **Read**: the `submitted` entry's `count` from the resolved array (default `0` if the array is
  empty or the entry is absent — matches today's "no submissions → 0" behavior).

## Consumer 8 — `HomeworkPage.jsx`, `getHwStats(hw)`

- **Call**: `useAsyncData(() => pgGetHwSubmissionsAggregate({groupBy:'homework'}), [], [])`,
  fetched ONCE for the whole page (not per row — FR-007/SC-002).
- **Replaces**: the per-row `hwSubmissions.filter(s => s.hwId===hw.id)` (lines 201-210 today).
- **Required**: build `new Map(perHomeworkAgg.map(r => [r.key, r]))` once; `getHwStats(hw)` looks
  up `map.get(hw.id)` instead of filtering.
- **Required (FR-008)**: `total` stays `getHomeworkEligibleStudents(hw, students).length` —
  never the aggregate row's own `total` field. See data-model.md's Per-Assignment Submission
  Summary section for the exact combine logic.

## Consumer 9 — `HomeworkReports.jsx` (all 4 tabs + summary — fully migratable, no deferred sub-part)

- **Calls**: the SAME two page-level fetches as consumers 7-8, reused across every tab:
  - `useAsyncData(() => pgGetHwSubmissionsAggregate({groupBy:'status'}), [], [])` → top-level
    summary totals (`totalSub`/`totalLate`/`totalMis`, lines 150-154 today).
  - `useAsyncData(() => pgGetHwSubmissionsAggregate({groupBy:'homework'}), [], [])` → `getStats`
    (lines 75-85 today), reused identically by `bySubject`/`byTeacher`/`byGroup`/`byPeriod`
    (lines 88-147 today).
- **Replaces**: the `hwSubmissions` store selector (line 66 today) — the ONLY store dependency
  this file has for submission data (subject/teacher/group/period grouping dimensions all come
  from the unmigrated `homeworks`/`groups` collections, untouched).
- **Required**: same `total`-field rule as consumer 8 — every `getStats` entry's `total` stays
  `eligibleStudents.length`.
- **Confirmed** (research.md §7): no dimension in this file requires anything beyond these two
  aggregates — this is a complete migration of the file's submission-data dependency, not a
  partial one.
