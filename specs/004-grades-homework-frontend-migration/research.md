# Phase 0 Research: Grades + Homework Submissions Frontend Migration (Batch A)

No `NEEDS CLARIFICATION` markers were left in `plan.md`'s Technical Context. Every entry below
was resolved by direct inspection of the 9 consumer call sites, `src/services/api.js`,
`src/store/db.middleware.js`, and the existing C4-migration precedent files
(`AttendanceAnalytics.jsx`, `ReportsPage.jsx`, `Dashboard.jsx`, `QRScanner.jsx`), all read in full
before this document was written.

## 1. Fetch pattern — `useAsyncData`, not a new hook

- **Decision**: Every migrated call site uses the existing `useAsyncData(fetcher, deps,
  initialValue)` hook (`src/hooks/useAsyncData.js`) exactly as already proven — it already
  handles race conditions (a stale response after `deps` change is discarded) and unmount
  cancellation, with zero per-consumer boilerplate.
- **Rationale**: This hook is already the sole fetch mechanism for every attendance/payments/
  communications C4-migrated consumer; introducing a second pattern here would violate
  Simplicity & YAGNI for no benefit.
- **Alternatives considered**: A bespoke `useEffect`+local-state per component (the pattern this
  hook was explicitly introduced to replace, per its own header comment) — rejected.

## 2. Response normalization — mirror `COLLECTION_FIXUPS`, not the raw backend shape

- **Decision**: `pgGetGrades` and `pgGetHwSubmissions` (new functions in `api.js`) each call
  `.map(normalizeGradeResponse)` / `.map(normalizeHwSubmissionResponse)` on the raw
  `{ok,data,count}` response's `data` array before returning it to callers. These two normalizer
  functions replicate `db.middleware.js`'s `COLLECTION_FIXUPS.grades`/`.hwSubmissions` exactly:
  - `grades`: `score` converted from the raw Decimal-as-string to a JS number (`null` stays
    `null`).
  - `hwSubmissions`: the raw `homeworkId` key renamed to `hwId` (the only name every consumer —
    `HomeworkTracking.jsx`, `HomeworkPage.jsx`, `buildHomeworkReport.js` — reads), `score`
    converted to a number, `submittedAt` normalized to a date-only string.
  - `pgGetHwSubmissionsAggregate`'s two response shapes (`{key,count}` and
    `{key,total,submitted,late,missing}`) need **no** normalization — neither shape contains a
    `score`, `submittedAt`, or `homeworkId`-named field.
- **Rationale**: Feature 003's backend routes deliberately return the *generic route's* raw row
  shape (Decimal-as-string `score`, un-renamed `homeworkId`) — correct for that feature's own
  scope (it changed no frontend code), but every one of this feature's 9 consumers was written
  against the *boot-sync-normalized* shape. Without this step, every migrated consumer would
  silently break: `score`-as-string breaks every `>=`/`Math.min`/arithmetic comparison
  (`GradeEntry.jsx`'s clamp, `ExamsTab`'s `avgScore` division, `ExamResults.jsx`'s pass/fail),
  and `x.hwId` would read `undefined` everywhere in `HomeworkTracking.jsx`/`HomeworkPage.jsx`/
  `buildHomeworkReport.js`, since none of them read `homeworkId`.
- **Precedent**: This exact pattern — a scoped-GET client function applying the same normalizer
  already used for the write-response path — is already established twice: `pgGetPayments`
  (`.map(normalizePaymentResponse)`) and `pgGetCommunications`
  (`.map(normalizeCommunicationResponse)`), both in `api.js` today. `attendance`'s own scoped GET
  needed no such step only because `attendance.js`'s *backend* route normalizes `date`
  server-side — a choice feature 003 deliberately did not make for grades/hwSubmissions (see
  feature 003's own research.md §8, which matched the generic route's shape on purpose). This
  feature does not reopen that decision; it solves the gap entirely on the frontend side, which
  is squarely within this feature's own boundary.
- **Alternatives considered**: Changing every consumer to read `homeworkId`/string-`score`
  directly — rejected: touches far more call sites than necessary, and breaks the moment any
  consumer is later reverted or a hybrid state exists (some data from the still-populated store,
  some from the new scoped fetch) during the migration itself.

## 3. Avoiding duplicate/N+1 fetches — page-level aggregate + Map lookup

- **Decision**: `HomeworkPage.jsx`'s per-row `getHwStats(hw)` and `HomeworkReports.jsx`'s
  `getStats(hwList)` each build ONE `Map` per page view from a single
  `pgGetHwSubmissionsAggregate({groupBy:'homework'})` call (via `useAsyncData(..., [], [])`,
  deps `[]` — fetched once per mount, not once per homework), then look up each homework's
  breakdown via `map.get(hw.id)`. `HomeworkPage`'s KPI and `HomeworkReports`' summary totals
  each use a second, equally page-level `pgGetHwSubmissionsAggregate({groupBy:'status'})` call.
- **Rationale**: Directly required by spec.md FR-007/SC-002. This is copy-identical to
  `AttendanceAnalytics.jsx`'s own established pattern (`useAsyncData(() =>
  pgGetAttendanceAggregate({groupBy:'group'}), [], [])` then `new Map(groupAgg.map(r =>
  [r.key, r]))`), already proven for exactly this "one summary fetch, many per-row lookups"
  shape.
- **Alternatives considered**: A scoped `pgGetHwSubmissionsAggregate({groupBy:'homework',
  homeworkId: hw.id})` call per rendered row — rejected: this is exactly the N+1 pattern
  FR-007/SC-002 forbid, and the unscoped call already returns every assignment's breakdown in one
  round trip.

## 4. `total` field provenance — eligible-student count, never submission-row count

- **Decision**: `HomeworkPage.getHwStats` and `HomeworkReports.getStats` keep computing `total`
  from `getHomeworkEligibleStudents(hw, students).length` (client-side, `students` collection
  unmigrated) exactly as today — only `submitted`/`late`/`missing` are replaced by the aggregate
  Map lookup's fields.
- **Rationale**: Directly required by spec.md FR-008. The aggregate's own `total` field counts
  submission ROWS for that assignment, which is not guaranteed to equal the current count of
  grade-eligible students (a student's grade level, and therefore eligibility, can change after
  a homework's roster of submission rows was created) — conflating the two would silently change
  a number this feature is required to keep exact.

## 5. `useState` lazy-init vs `useMemo` — why 2 of the 4 "new loading state" consumers need more than a spinner

This is the most important correctness finding of this planning pass, not previously identified
in the original request.

- **`StudentProfile.jsx`'s `ExamsTab`** and **`ExamResults.jsx`** both derive their displayed
  stats via `useMemo(() => ..., [grades, ...])` (or the equivalent `examGrades`/`stats`/`ranked`
  memos) — **reactive**: when the scoped fetch's `data` changes from its `useAsyncData` initial
  value (`[]`) to the real resolved array, the memo recomputes automatically and the correct
  numbers render. The only correctness requirement here is to **gate the empty-state message**
  (`examGrades.length === 0` → "لم يتم إدخال الدرجات بعد" in `ExamResults.jsx`; the equivalent in
  `ExamsTab`) behind `loading === false`, so it doesn't flash incorrectly during the brief window
  before the real fetch resolves.
- **`GradeEntry.jsx`'s `localGrades`** and **`HomeworkTracking.jsx`'s `localSubs`** are each
  seeded via a **`useState(() => { ...find existing grade/sub...; return map; })` lazy
  initializer** — this function runs **exactly once**, at the component's first mount, and never
  re-runs when the scoped fetch later resolves. Today this is safe only because the global store
  is already synchronously hydrated by boot-sync before either component ever mounts. If migrated
  naively (fetch scoped data, but still lazy-init `useState` from it immediately), the editable
  form would permanently seed itself as empty/blank on every open, silently discarding every
  previously-saved score/status — a real data-loss-appearing regression, not a cosmetic one.
  **Required mitigation**: gate the mount of the actual editable table/form (whose `useState`
  lazy initializer reads the fetched data) behind the scoped fetch's `loading` flag — render a
  loading placeholder in its place until `loading` is `false`, then mount the real form fresh, so
  its one-time lazy initializer runs against the now-resolved data. This mirrors how these
  components are already opened fresh per `exam`/`hw` prop each time (a modal/panel remount), so
  no new remount mechanism is needed — only an added `loading` branch before the existing render
  path.
- **Rationale**: This distinction (memo-derived/reactive vs. one-time-lazy-seeded local state)
  determines whether "add a loading state" is a cosmetic nicety or a correctness requirement.
  Getting this wrong in `GradeEntry`/`HomeworkTracking` would violate spec.md FR-005 (numbers
  must stay identical) in the worst possible way — appearing to erase previously-saved grades/
  submissions in the UI (the underlying data is never touched, since `setGrades`/
  `setHwSubmissions` writes are unaffected, but the *form* would misrepresent it until saved
  again, and a careless save could actually overwrite real data with blanks).
- **Alternatives considered**: Re-seeding `localGrades`/`localSubs` via a `useEffect` that runs
  whenever the fetch resolves (instead of gating the mount) — rejected in favor of the simpler
  gate-then-mount approach, since these components are already always mounted fresh per
  `exam`/`hw` (no state to preserve across a `loading→loaded` transition within the same mount),
  making a `useEffect` re-sync solve a problem that doesn't exist here while adding a subtle new
  race (a user's in-progress edits being clobbered if the effect re-fires) that the gate-then-mount
  approach cannot have by construction.

## 6. Student-delete safety-guard pattern — no new pattern, reuse verbatim

- **Decision**: The two migrated checks in `StudentsPage.jsx`'s `handleDelete` (grades count,
  hwSubmissions count) are rewritten using the exact same `try { ... } catch (e) { toast.error(...);
  closeModal(); return; }` shape already used two checks later in the same function for
  `pgGetCommunications`/`pgGetPayments` — same error-message-on-failure behavior, same
  fail-closed "don't allow delete if the check itself failed" behavior.
- **Rationale**: Zero new design needed; this file already establishes the exact pattern twice.

## 7. `HomeworkReports.jsx` — confirmed fully migratable, no deferred sub-part

- **Decision**: All 4 tabs (`bySubject`/`byTeacher`/`byGroup`/`byPeriod`) and the top-level
  summary totals are re-derived from the same two page-level aggregate fetches described in §3,
  grouped/filtered by homework-level properties (`subject`, `teacher`, grade-derived group,
  `dueDate`) that come from the already-loaded, unmigrated `homeworks` collection — none of these
  four groupings are a property of the submission data itself, so none of them requires anything
  beyond the two aggregates this feature already adds.
- **Rationale**: Confirmed by reading `getStats(hwList)` (called identically by all 4 tabs and
  the summary) — it needs exactly `{total, submitted, late, missing}` per homework, which is
  exactly the `groupBy=homework` Map lookup (§3) plus the unchanged eligible-student `total` (§4).

## Outcome

All Technical Context unknowns resolved. No `NEEDS CLARIFICATION` markers remain. §5's finding
is carried forward into `data-model.md`/`contracts/` and flagged explicitly in the final planning
report as a risk requiring careful implementation, not just a UI nicety. Ready for Phase 1.
