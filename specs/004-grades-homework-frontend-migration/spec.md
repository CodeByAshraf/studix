# Feature Specification: Grades + Homework Submissions Frontend Migration (Batch A)

**Feature Branch**: `[004-grades-homework-frontend-migration]`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "Migrate the low/medium-risk frontend consumers of the global grades and hwSubmissions collections that can now use the scoped/aggregate backend APIs implemented in feature 003, while deliberately deferring the consumers that require new backend join/search capabilities (grades average/ranking aggregates, HomeworkSearch full cross-product search). Nine named consumers across the Students, Exams, and Homework areas; preserve every existing number, loading/error/empty state, and write path exactly."

## Clarifications

### Session 2026-09-21 (pre-plan, resolved during grounding research before this spec was written)

- Q: Does the new scoped-read API need to return data shaped exactly like the current global-store data (numeric `score`, `hwId` field name), or can consumers be updated to handle the raw backend shape? → A: The new frontend service functions must reproduce the exact shape every consumer already reads today (numeric `score`, `hwId` not `homeworkId`), by applying the same normalization the store's boot-sync pipeline already applies. No consumer's own field-name or numeric logic changes. This was resolved through direct code inspection (not a user round-trip) because the existing codebase already establishes the exact needed pattern (`pgGetPayments`/`pgGetCommunications` already do this for their own collections) — an unambiguous technical fact, not a product decision.
- Q: Is `HomeworkReports.jsx` fully migratable, or does part of it need to stay deferred like the request anticipated? → A: Fully migratable — every one of its four report tabs and its summary totals reduce to the same per-homework `{total,submitted,late,missing}` shape the new `groupBy=homework`/`groupBy=status` aggregates already provide, grouped by homework-level properties (subject/teacher/grade/due date) that are not being migrated away. Resolved by direct inspection of `HomeworkReports.jsx`'s `getStats()` helper, not a product ambiguity.

## User Scenarios & Testing *(mandatory)*

<!--
  This feature has no end-user-facing behavior change to numbers, filtering, or write actions —
  every figure a staff user sees today must remain identical. Its one small, real UX change is
  that four screens (StudentProfile's Exams tab, ExamResults, GradeEntry, HomeworkTracking) that
  currently read already-hydrated store data synchronously will briefly show a loading state
  they don't show today, because their data now comes from a network request instead of memory.
  User stories below describe that migration from the staff user's and the engineering
  precedent's point of view.
-->

### User Story 1 - Grade-related screens load a student's or an exam's grades without fetching every grade in the center (Priority: P1)

Today, opening a student's Exams tab, entering grades for an exam, or viewing one exam's results all depend on the browser already holding the center's entire grade history in memory. This story moves those three screens (plus the student-delete safety check) onto a request scoped to exactly the student or exam being viewed.

**Why this priority**: These are the highest-traffic grade-related screens (viewed constantly during grading season) and the least risky to migrate — feature 003 already proved the exact backend capability they need.

**Independent Test**: Open a student's profile Exams tab, open Grade Entry for an exam, and view Exam Results for an exam; in each case confirm the same records, same stats, and same pass/fail/absent outcomes appear as before, with a brief loading indicator where the data used to be already there.

**Acceptance Scenarios**:

1. **Given** a student with several recorded grades, **When** their profile's Exams tab is opened, **Then** the same exam results, same "average", "passed", and "absent" counts appear as would be computed from the full grade history today.
2. **Given** an exam with existing grades, **When** Grade Entry is opened for it, **Then** every student's previously-saved score/absence is pre-filled exactly as it is today, and saving still updates the same records the same way.
3. **Given** an exam with recorded grades, **When** its Results view is opened, **Then** the same average, highest, lowest, pass rate, distribution, and ranked list appear as today.
4. **Given** a student with zero recorded grades, **When** any of the above screens is opened for them, **Then** the same empty-state message appears as today, not an error.

---

### User Story 2 - Deleting a student still correctly blocks when they have grades or homework submissions (Priority: P1)

The student-delete safety check must keep working exactly as it does today, just sourced from a scoped request instead of the full in-memory collections — a student with a shared name/id but no real dependent records must never be blocked, and one with real dependent records must always be blocked.

**Why this priority**: This is a safety/data-integrity guard already proven with the same pattern for payments and communications in this exact function — same risk class, must not regress.

**Independent Test**: Attempt to delete a student with recorded grades, and separately one with recorded homework submissions; confirm both are blocked with the same message format as today, and a student with neither is not blocked by these checks.

**Acceptance Scenarios**:

1. **Given** a student with at least one recorded grade, **When** an admin attempts to delete them, **Then** the deletion is blocked with the same "has N grades" message as today.
2. **Given** a student with at least one recorded homework submission, **When** an admin attempts to delete them, **Then** the deletion is blocked with the same "has N homework submissions" message as today.
3. **Given** a student with neither, **When** an admin attempts to delete them, **Then** these two checks do not block the deletion (other unrelated checks are unaffected).

---

### User Story 3 - Homework tracking for one assignment loads only that assignment's submissions (Priority: P2)

Opening the submission-tracking view for one homework assignment currently depends on the browser holding every submission for every assignment ever created. This story scopes that view (and its printed report) to just the one assignment being tracked.

**Why this priority**: Same category of value as Story 1, one domain later — homework tracking is a frequent, recurring workflow.

**Independent Test**: Open tracking for a homework assignment with existing submissions and confirm every student's previously-saved status/score/notes is pre-filled exactly as today, and that printing the report produces the same output as today.

**Acceptance Scenarios**:

1. **Given** a homework assignment with existing submissions, **When** its tracking view is opened, **Then** every student's previously-saved status, submission date, score, and notes are pre-filled exactly as today.
2. **Given** the tracking view is opened and the roster is printed, **When** the print report is generated, **Then** it shows the same data as it would from today's full in-memory submissions.
3. **Given** a homework assignment with zero submissions recorded yet, **When** its tracking view is opened, **Then** every student shows the same default "missing" state as today.

---

### User Story 4 - Homework dashboards and reports show center-wide and per-assignment submission counts without loading every submission row (Priority: P3)

The homework list's KPI tile, its per-row submission breakdown, and the full homework reports screen (all four of its groupings, plus its summary totals) currently require the browser to hold every submission ever recorded. This story moves all of them onto two server-computed summaries instead.

**Why this priority**: Lower priority than Stories 1-3 because these are read-only reporting/summary views, not data-entry workflows, but they are what finally makes the underlying full-collection load unnecessary for this area of the app.

**Independent Test**: Open the homework list and confirm its center-wide "submitted" count and every row's submitted/late/missing breakdown match what counting the full submission history directly would produce; separately open the homework reports screen and confirm every one of its four groupings and its summary totals match the same direct count.

**Acceptance Scenarios**:

1. **Given** a mix of submitted/late/missing submissions center-wide, **When** the homework list is opened, **Then** its center-wide "submitted" KPI matches exactly what counting all submissions directly would produce.
2. **Given** several homework assignments each with their own submissions, **When** the homework list is opened, **Then** each assignment's row shows the same submitted/late/missing counts as counting that assignment's own submissions directly would produce, and the same "total eligible students" count as today (unchanged, computed from grade-eligibility, not from submission rows).
3. **Given** the same data, **When** the homework reports screen is opened and each of its four groupings (subject/teacher/group/period) is viewed, **Then** every group's counts and every homework row's counts exactly match today's values, and the top-level summary totals exactly match today's values.
4. **Given** no submissions exist at all, **When** either screen is opened, **Then** every count shows zero, not an error, exactly as today.

---

### Edge Cases

- A migrated screen requesting data for a student/exam/homework assignment that has no records at all must show the exact same empty state it shows today, not an error and not a different message.
- If a scoped/aggregate request fails (e.g., a network error), the affected screen must show a clear error state — never silently show stale, wrong, or partial numbers, and never block on a request unrelated to what the user is doing.
- The four screens that currently read this data synchronously from memory (StudentProfile's Exams tab, ExamResults, GradeEntry, HomeworkTracking) will now show a brief loading state before their data appears — this is a new-but-expected behavior change, not a regression, and must use the same loading-indicator convention already used elsewhere in the app for scoped fetches.
- None of this feature's changes may alter what happens when a grade or a homework submission is actually saved (the existing save actions, and what they write to the shared in-app data store for other, not-yet-migrated screens to keep reading) — those remain exactly as they are today.
- A screen deferred by this feature (the center-wide grade average shown on the Grades module, Reports page, Student Performance page, or Exam Reports page; the homework full-text/cross-product search) must continue reading from the exact same full in-memory source it reads from today, completely unaffected by this migration.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST retrieve a single student's grades, for the student-profile Exams view and the student-delete safety check, scoped to that one student rather than the full grade history.
- **FR-002**: The system MUST retrieve a single exam's grades, for Grade Entry and Exam Results, scoped to that one exam rather than the full grade history.
- **FR-003**: The system MUST retrieve a single student's or a single homework assignment's submissions, for the student-delete safety check and homework tracking (plus its printed report), scoped rather than drawn from the full submission history.
- **FR-004**: The system MUST retrieve a center-wide submission-status summary and a per-assignment submission summary, for the homework list's KPI/per-row breakdown and the homework reports screen, computed server-side rather than by loading every submission row.
- **FR-005**: Every migrated screen MUST show the exact same numbers (counts, averages, pass/fail outcomes, rankings, distributions) it shows today for the same underlying data — no approximation, rounding difference, or reshaping is acceptable.
- **FR-006**: Every migrated screen's field names and value types (in particular: a submission's assignment-reference field, and a grade's/submission's numeric score) MUST remain exactly what each screen already reads today, regardless of how the new scoped/summary data is shaped when it arrives from the network.
- **FR-007**: The homework list's per-row breakdown and the homework reports screen MUST fetch each server-computed summary once per screen view, not once per homework assignment shown.
- **FR-008**: The homework list's and homework reports' "total" figure for each assignment MUST continue to reflect the count of students currently eligible for that assignment, not the count of submission records that happen to exist for it — these can differ and must not be conflated.
- **FR-009**: None of the four save actions this feature touches indirectly (saving grades, saving homework submissions, deleting a student, deleting nothing else) MUST change in any way — same requests, same server-side behavior, same effect on the shared in-app data store that other, not-yet-migrated screens still depend on.
- **FR-010**: A migrated screen requesting data for a student, exam, or homework assignment with zero matching records MUST show the same empty state it shows today, never an error.
- **FR-011**: A migrated screen whose data request fails MUST show a clear error state and MUST NOT silently show incomplete or stale numbers as if they were complete.
- **FR-012**: This feature MUST NOT alter any of the explicitly deferred consumers (grades center-wide average on the Grades module, Reports page, Student Performance page, or Exam Reports page's ranking/average; the homework full-text/cross-product search) — they continue reading the full in-memory collections exactly as today.
- **FR-013**: This feature MUST NOT remove grades or homework submissions from the app's startup data sync, and MUST NOT change how that data is persisted locally — both remain exactly as they are today, since other, not-yet-migrated screens still depend on them.

### Key Entities *(include if feature involves data)*

- **Grade Record** (as read by the migrated screens): a student's result for one exam — same fields, same score type, every migrated screen already reads today.
- **Homework Submission Record** (as read by the migrated screens): a student's submission status for one homework assignment — same fields (including the assignment-reference field every screen already reads under its current name), every migrated screen already reads today.
- **Submission Summary**: a server-computed count breakdown (by status, or by assignment) that replaces loading every submission row for the two reporting screens in scope.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every number shown on the 9 migrated screens/call sites (student Exams tab stats, Grade Entry pre-fill and live stats, Exam Results stats/ranking, the two student-delete safety checks, homework tracking pre-fill and printed report, the homework list's KPI and per-row breakdown, and every one of homework reports' four groupings plus its summary) is verified numerically identical to what the same screen shows before this migration, for the same underlying data.
- **SC-002**: The homework list and homework reports screens each issue at most one status-summary request and one per-assignment-summary request per view, regardless of how many homework assignments are displayed.
- **SC-003**: Every migrated screen's empty-state and error-state behavior is verified to match its pre-migration behavior exactly (same message, same non-error empty display).
- **SC-004**: The student-delete safety check continues to correctly block deletion for a student with existing grades or homework submissions, and does not block one without, verified against the same scenarios covered before this migration.
- **SC-005**: None of the explicitly deferred consumers' figures change as a result of this feature — confirmed by their existing automated coverage continuing to pass unmodified.
- **SC-006**: A full production build of the application succeeds after this migration, with no new build-time errors introduced.

## Assumptions

- This feature changes only where 9 specific, already-identified screens/call sites get their grades/homework-submission data from — it does not add, remove, or change any user-facing feature, filter, action, or save behavior beyond the loading-state addition on 4 of them, called out explicitly in Edge Cases.
- The backend scoped/aggregate capability this feature relies on (feature 003) already exists and is not being changed by this feature; if its response shape doesn't already match what a screen's existing logic expects (e.g., a numeric field arriving in a different form, or an internal field under a different name than what the screen reads), that reshaping happens entirely on the frontend side of this feature, mirroring how the same class of difference is already solved today for other already-migrated collections (payments, communications) — this is not a backend change and not a new concept for the codebase.
- The four screens gaining a new loading state will use the app's already-established loading/error/empty convention for scoped fetches (the same one already used for the equivalent attendance migration), not a new pattern.
- Homework reports' migration is complete, not partial — every one of its four groupings and its summary totals are reproducible exactly from the two server-computed summaries this feature adds, with no dimension left needing the old full-collection source.
- The explicitly deferred consumers (grades center-wide average across Grades/Reports/Student Performance/Exam Reports, and the homework full-text/cross-product search) are unaffected because they are not touched by this feature at all, not because their current behavior was found acceptable to approximate.
- No new backend capability is required beyond what feature 003 already shipped; if migration work reveals a genuine need for one, that specific figure is left on its current full-collection source and documented as deferred, rather than this feature inventing a new backend endpoint.
