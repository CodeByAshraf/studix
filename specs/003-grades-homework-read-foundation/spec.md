# Feature Specification: Grades + Homework Submissions Backend Read Foundation

**Feature Branch**: `[003-grades-homework-read-foundation]`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "Add the backend read foundation needed to eventually migrate the frontend away from the global grades and hwSubmissions collections, following the exact proven architecture already used by the attendance backend foundation (C4 Attendance Phase 1). Backend-only, additive: a scoped grades lookup (by student, by exam), a scoped homework-submissions lookup (by student, by homework assignment), and a minimal homework-submissions summary (by status, by homework assignment) — no average-score/ranking aggregate for grades in this feature, no frontend changes, no database schema changes, no removal of either collection from the existing bulk-sync list, no changes to existing write endpoints."

## Clarifications

### Session 2026-09-21 (post-analyze remediation)

- Q: When a `studentId`/`examId`/`homeworkId` scoping query parameter is present but empty (e.g. `?studentId=`), should the request be rejected or treated as no filter? → A: Reject with 400 before any lookup when the parameter key is present but empty; treat a fully absent parameter as "no filter for that dimension." Applies identically to grades and homework-submissions scoped lookups. `groupBy` validation is unchanged.

## User Scenarios & Testing *(mandatory)*

<!--
  This feature has no end-user-facing behavior change (explicitly out of scope: any frontend
  change). Its "users" are the engineering work that depends on it — the next migrations that
  will move the Grades and Homework Submissions screens off the full-history data source, the
  same way the Attendance screens already were. User stories below describe what becomes
  possible for that future work, not a change staff will see today.
-->

### User Story 1 - Look up one student's grade history without loading everyone's (Priority: P1)

Today, retrieving a single student's grade history requires pulling the center's entire grade record set into memory first, then discarding everything that isn't that student's. This story makes it possible to ask for exactly one student's grades directly.

**Why this priority**: This unblocks the most common, lowest-risk future use (a student's own profile, and the "can this student be deleted" check) — the same category of read that was the first thing enabled for attendance.

**Independent Test**: Request grades scoped to one specific student and confirm only that student's grade records come back, with the same information each record already carries today.

**Acceptance Scenarios**:

1. **Given** a student with several recorded grades across different exams, **When** their grades are requested by student, **Then** exactly that student's grade records are returned, and no other student's.
2. **Given** a student with no recorded grades at all, **When** their grades are requested by student, **Then** an empty result is returned, not an error.

---

### User Story 2 - Look up every grade for one exam without loading unrelated exams (Priority: P1)

Entering or reviewing grades for a specific exam today requires the same "load everything, filter locally" pattern. This story makes it possible to ask for exactly one exam's grades directly.

**Why this priority**: Equally foundational to Story 1 — grade entry and per-exam results review are both existing, frequent workflows that currently pay the same unscoped cost.

**Independent Test**: Request grades scoped to one specific exam and confirm only that exam's grade records come back.

**Acceptance Scenarios**:

1. **Given** an exam with grades recorded for several students, **When** grades are requested by that exam, **Then** exactly that exam's grade records are returned, and no other exam's.
2. **Given** an exam with no grades recorded yet, **When** its grades are requested, **Then** an empty result is returned, not an error.

---

### User Story 3 - Look up one student's or one assignment's homework submissions without loading everything (Priority: P2)

The same unscoped-load pattern exists for homework submission records today. This story makes it possible to ask for exactly one student's submissions, or exactly one homework assignment's submissions, directly.

**Why this priority**: Same value as Stories 1-2, one domain later — homework tracking and per-student homework history are existing, frequent workflows.

**Independent Test**: Request submissions scoped to one student, and separately scoped to one homework assignment, and confirm each returns only the matching records.

**Acceptance Scenarios**:

1. **Given** a student with several homework submissions across different assignments, **When** their submissions are requested by student, **Then** exactly that student's submission records are returned.
2. **Given** a homework assignment with submissions from several students, **When** submissions are requested by that assignment, **Then** exactly that assignment's submission records are returned.
3. **Given** a student or assignment with no submissions at all, **When** requested, **Then** an empty result is returned, not an error.

---

### User Story 4 - Get homework submission counts without fetching every submission row (Priority: P3)

Building a summary view (how many submissions are late/missing/submitted center-wide, or per assignment) today requires loading every submission row and counting locally. This story makes it possible to ask for just the counts.

**Why this priority**: Lower priority than Stories 1-3 because it serves summary/reporting use cases specifically, not the more common single-record lookups, but it's what makes the future homework summary screens possible without the same unscoped cost.

**Independent Test**: Request a submission-status summary and confirm it returns counts per status matching what a manual count over the same records would produce; separately request a per-assignment summary and confirm the same for each assignment.

**Acceptance Scenarios**:

1. **Given** a mix of submitted/late/missing submissions center-wide, **When** a status summary is requested, **Then** the count for each status matches exactly what counting the same records directly would produce.
2. **Given** several homework assignments each with their own submissions, **When** a per-assignment summary is requested, **Then** each assignment's counts match exactly what counting its own records directly would produce.
3. **Given** no submissions exist at all, **When** either summary is requested, **Then** an empty/zero result is returned, not an error.

---

### Edge Cases

- Requesting grades or submissions with no scoping at all (neither student nor exam/assignment specified) must behave exactly as the existing unscoped listing does today — this feature adds new scoped/summary capability, it does not change or remove what already exists.
- An identifier that doesn't exist must produce a clear, empty result, not an error (see FR-009). An identifier parameter that is present but empty (e.g. `?studentId=`) must be clearly rejected (400) before any lookup, per FR-010 — never a server error or a silent wrong-scope result.
- Only someone with access to the existing Grades/Homework areas of the system may use these new lookups — the same access rule already governing those areas today, not a new or looser one.
- None of this feature's new capability may change what the existing grade-entry, exam-results, or homework-tracking save actions do — those remain exactly as they are today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow retrieving grade records scoped to a single specified student, returning only that student's records.
- **FR-002**: The system MUST allow retrieving grade records scoped to a single specified exam, returning only that exam's records.
- **FR-003**: The system MUST allow retrieving grade records scoped to both a specific student and a specific exam at once, when both are meaningful together, returning only records matching both.
- **FR-004**: The system MUST allow retrieving homework-submission records scoped to a single specified student, returning only that student's records.
- **FR-005**: The system MUST allow retrieving homework-submission records scoped to a single specified homework assignment, returning only that assignment's records.
- **FR-006**: The system MUST allow retrieving a count of homework submissions broken down by status (submitted / late / missing), matching exactly what counting the underlying records directly would produce.
- **FR-007**: The system MUST allow retrieving a count of homework submissions broken down by homework assignment, matching exactly what counting the underlying records directly would produce.
- **FR-008**: Every new lookup and summary introduced by this feature MUST require the same access permission the Grades or Homework area already requires today — no new or different permission model.
- **FR-009**: A scoped lookup or summary that matches no records MUST return a clear, empty result, never an error.
- **FR-010**: An invalid or malformed scoping value MUST be clearly rejected before any data lookup happens, with a message that identifies what was wrong. Specifically: if a student/exam/homework-assignment scoping parameter is present on the request but empty, the request MUST be rejected (400) before any lookup; if the parameter is absent entirely, it MUST be treated as "no filter for that dimension," not as an error. This rule applies identically to the grades and homework-submissions scoped lookups. (Resolved 2026-09-21 during `/speckit-analyze` remediation — see Clarifications.)
- **FR-011**: None of this feature's new capability may alter the existing unscoped listing behavior, the existing single-record lookup behavior, or any existing save/write action for grades or homework submissions — all of that MUST continue to work exactly as it does today.
- **FR-012**: This feature MUST NOT introduce a grade-percentage average, a student-ranking summary, or any other computed/derived grade statistic — those are explicitly deferred to later, separate work.
- **FR-013**: The grade and homework-submission records returned by the new lookups MUST carry the same information each record already carries today — no fields removed, renamed, or reshaped.

### Key Entities *(include if feature involves data)*

- **Grade Record**: One student's result for one exam (score, whether marked absent, when recorded) — the entity Stories 1-2 make scopeable by student or by exam.
- **Homework Submission Record**: One student's submission status for one homework assignment (status, submission date, score, notes) — the entity Story 3 makes scopeable by student or by assignment, and Story 4 makes summarizable by status or by assignment.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A request for one student's grades or one exam's grades returns only the matching records, verified against a known dataset with zero incorrect inclusions or omissions.
- **SC-002**: A request for one student's or one assignment's homework submissions returns only the matching records, verified the same way.
- **SC-003**: A homework-submission status or per-assignment summary's counts are numerically identical to a direct count over the same underlying records, verified against a known dataset.
- **SC-004**: None of this feature's new capability changes the outcome of any existing grade or homework-submission listing, lookup, or save action — confirmed by the existing automated coverage for those areas continuing to pass unmodified.
- **SC-005**: Every new lookup and summary is exercised by an automated test covering its normal use, its empty-result case, and its invalid-input case, before this feature is considered complete.

## Assumptions

- This feature changes only where a *future* migration could get its data from — it does not itself change anything a user of the application sees or does today. No frontend work is included.
- "Scoped by student/exam/assignment" mirrors exactly the same filtering concept already proven for attendance records — no new filtering concept is introduced.
- The grade-percentage average and any ranking/leaderboard capability are real, known future needs (already identified in prior analysis) but are deliberately excluded here because they require combining information from two different record types in a way this foundation does not yet need to solve.
- Access control for the new lookups reuses whatever already gates the Grades and Homework areas today; this feature does not introduce a new concept of who can see what.
- The existing bulk-sync list that currently includes grades and homework-submission records in full is unaffected by this feature — removing either from it is explicitly future work, contingent on migrating every consumer identified in prior analysis, not just adding this foundation.
