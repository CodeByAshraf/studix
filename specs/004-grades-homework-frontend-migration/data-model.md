# Phase 1 Data Model: Grades + Homework Submissions Frontend Migration (Batch A)

No new entities, no schema change. This documents the exact shape each new `api.js` function
must produce so every existing consumer's logic needs zero changes — the "shape contract"
between feature 003's backend and this feature's 9 consumers.

## Grade Record (as returned by `pgGetGrades`)

| Field | Type after normalization | Source | Notes |
|---|---|---|---|
| `id` | string | passthrough | |
| `examId` | string | passthrough | |
| `studentId` | string | passthrough | |
| `score` | number \| null | `Number(raw)` if not null/undefined, else `null` | Raw backend value is a Decimal-as-string (`"88"`); every consumer (`GradeEntry`'s clamp, `ExamsTab`'s `avgScore`, `ExamResults`' pass/fail/ranking) requires a real number. |
| `absent` | boolean | passthrough | |
| `createdAt` | string (ISO) | passthrough | Not read by any of the 9 migrated consumers, kept for shape parity with the store. |

Matches `db.middleware.js`'s `COLLECTION_FIXUPS.grades` exactly:
`(r) => ({ ...r, score: r.score == null ? null : toNum(r.score) })`.

## Homework Submission Record (as returned by `pgGetHwSubmissions`)

| Field | Type after normalization | Source | Notes |
|---|---|---|---|
| `id` | string | passthrough | |
| `hwId` | string | **renamed from** raw `homeworkId` | The only name any consumer reads — `HomeworkTracking.jsx` (`x.hwId===hw.id`), `buildHomeworkReport.js` (`x.hwId===hw.id`). |
| `studentId` | string | passthrough | |
| `status` | `'submitted'` \| `'late'` \| `'missing'` | passthrough | |
| `submittedAt` | string (date-only, `YYYY-MM-DD`) \| null | sliced to 10 chars if present | Raw backend value may be a full timestamp string. |
| `score` | number \| null | `Number(raw)` if not null/undefined, else `null` | |
| `notes` | string \| null | passthrough | |

Matches `db.middleware.js`'s `COLLECTION_FIXUPS.hwSubmissions` exactly:
```
(r) => {
  const { homeworkId, ...rest } = r;
  return {
    ...rest,
    hwId: homeworkId ?? r.hwId,
    score: r.score == null ? null : toNum(r.score),
    submittedAt: r.submittedAt ? String(r.submittedAt).slice(0, 10) : r.submittedAt,
  };
}
```

## Submission Status Summary (as returned by `pgGetHwSubmissionsAggregate({groupBy:'status'})`)

No normalization needed — passthrough of feature 003's `{key, count}[]` shape.

| Field | Type | Notes |
|---|---|---|
| `key` | `'submitted'` \| `'late'` \| `'missing'` | |
| `count` | number | Already a real number server-side (`prisma...groupBy`'s `_count`), not a Decimal. |

Consumer usage: `HomeworkPage.kpi.totalSub` reads the `submitted` entry's `count`;
`HomeworkReports`' summary totals read all three entries' `count`.

## Per-Assignment Submission Summary (as returned by `pgGetHwSubmissionsAggregate({groupBy:'homework'})`)

No normalization needed — passthrough of feature 003's `{key, total, submitted, late, missing}[]`
shape.

| Field | Type | Notes |
|---|---|---|
| `key` | string | The `homework_id` — matches `hw.id` in the already-loaded `homeworks` collection directly (bare id string, no field-name mismatch). |
| `total` | number | Submission-ROW count for this assignment — **not used** by either consumer's own `total` field (see data-model note below). |
| `submitted` / `late` / `missing` | number | Used directly by `HomeworkPage.getHwStats` and `HomeworkReports.getStats`. |

Consumer usage: both `HomeworkPage.getHwStats(hw)` and `HomeworkReports.getStats(hwList)` build
`new Map(perHomeworkAgg.map(r => [r.key, r]))` once per page view, then per homework:
```
const agg = map.get(hw.id) ?? { submitted: 0, late: 0, missing: 0 };
return {
  total:     getHomeworkEligibleStudents(hw, students).length,  // unchanged, client-computed
  submitted: agg.submitted,
  late:      agg.late,
  missing:   agg.missing,
};
```
The aggregate's own `total` field is deliberately never read by either consumer (FR-008).

## Relationship to feature 003's backend shapes

| Backend route (feature 003, unchanged) | New `api.js` function (this feature) | Normalization applied |
|---|---|---|
| `GET /api/grades?studentId=&examId=` | `pgGetGrades(params)` | `score` → number |
| `GET /api/hwSubmissions?studentId=&homeworkId=` | `pgGetHwSubmissions(params)` | `homeworkId`→`hwId`, `score`→number, `submittedAt`→date-only |
| `GET /api/hwSubmissions/aggregate?groupBy=` | `pgGetHwSubmissionsAggregate(params)` | none — response contains no `score`/`submittedAt`/`homeworkId` field |

## State transitions

None new. Every write path this feature's consumers still call
(`pgSaveExamGrades`, `pgSaveHwSubmissions`, `pgDeleteStudent`) is unchanged, including their
existing global-store sync (`setGrades`/`setHwSubmissions`) that keeps not-yet-migrated
consumers correct.
