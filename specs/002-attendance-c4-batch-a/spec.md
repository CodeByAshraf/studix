# Feature Specification: Attendance C4 Batch A — Safe Read Migration

**Feature Branch**: `[002-attendance-c4-batch-a]`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "Attendance C4 Batch A — Safe Read Migration: migrate five remaining low/medium-risk production consumers of the global attendance collection (ReportsPage overview attendance %, AttendanceAnalytics' attendance charts, Dashboard's per-student attendance heat for the 5 displayed students, AttendancePage's overview attendance counts, and QRScanner's same-day duplicate check) to the existing scoped/aggregate attendance data sources, preserving every existing number and behavior exactly — explicitly excluding AbsenceFollowup, the global notification derivation, Dashboard's recent-attendance trend stat, AttendancePage's sessions count, and any write behavior, which stay on the current data source."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reports & Analytics dashboards stay accurate without loading full attendance history (Priority: P1)

Center staff open the Reports page's overview tab and its dedicated attendance-analytics tab to see center-wide attendance figures (overall percentage, per-group comparison, a 14-day trend, and which weekdays see the most absences). These numbers must be identical to what they show today, but the page must no longer need to pull the center's entire historical attendance log to compute them.

**Why this priority**: This is the highest-value, lowest-risk unit in this batch — every one of these figures is a straightforward count or percentage that the system already computes the same way elsewhere (the Groups and Frequent-Absentees migrations already proved this exact approach), so it carries the least behavioral risk while removing the largest remaining unscoped read.

**Independent Test**: With a known set of attendance records, open both the Reports overview tab and the attendance-analytics tab; every displayed figure (overall %, per-group %, the 14-day trend chart, and the weekday-absence chart) must match what the same data currently produces, with no separate data-loading step required to see them.

**Acceptance Scenarios**:

1. **Given** the center has attendance records spanning several months, **When** staff open the Reports overview tab, **Then** the overall attendance percentage shown matches exactly what today's calculation over the same records would produce.
2. **Given** the same data, **When** staff open the attendance-analytics tab, **Then** the total/present/absent/late counts and percentage, the per-group comparison, the 14-day trend, and the weekday-absence breakdown all match today's figures exactly.
3. **Given** a center with no attendance records at all, **When** either page is opened, **Then** all figures show as empty/zero states, not errors.

---

### User Story 2 - Dashboard's per-student attendance snapshot stays accurate for the students shown (Priority: P2)

Center staff open the main Dashboard and see, for each of the handful of students listed there, a small recent-attendance indicator (the same "heat" style already used on the Students page). This must keep showing the correct data for exactly those students, without needing every student's or every historical attendance record.

**Why this priority**: Directly reuses a pattern already shipped and proven (the Students page's per-row attendance indicator), scoped to a small, fixed number of students — low risk, high confidence.

**Independent Test**: With a known set of students and attendance records, open the Dashboard and confirm the attendance indicator for each listed student matches exactly what today's full-history calculation for that same student produces.

**Acceptance Scenarios**:

1. **Given** the Dashboard lists its usual handful of students, **When** it loads, **Then** each student's attendance indicator reflects only that student's own records, identical to today's output.
2. **Given** one of the listed students has no attendance history at all, **When** the Dashboard loads, **Then** that student's indicator shows the same empty/neutral state it shows today, not an error.

---

### User Story 3 - Attendance overview counts stay accurate on the Attendance page (Priority: P3)

Center staff open the Attendance section's overview and see summary counts (total sessions recorded, present/absent/late counts, and overall percentage) plus a "needs follow-up" indicator. These counts must keep matching today's figures exactly, without needing the full attendance history loaded into the browser — except for whichever specific figure cannot be reproduced exactly by the data source this batch relies on, which must be left exactly as it works today rather than replaced with an approximation.

**Why this priority**: Mixed-risk — most figures here are as safe as User Story 1's, but one existing figure (the distinct-session count) has no equivalent in the data source this batch uses, so this story carries a documented, deliberate partial-migration outcome rather than a clean one.

**Independent Test**: With a known set of attendance records, open the Attendance page overview and confirm every migrated figure matches today's output exactly, and confirm the one figure that is intentionally not migrated still works exactly as it does today.

**Acceptance Scenarios**:

1. **Given** known attendance records, **When** the Attendance page overview loads, **Then** the present/absent/late counts and overall percentage match today's figures exactly.
2. **Given** the same data, **When** the overview loads, **Then** the distinct-session count continues to be produced exactly as it is today (unchanged data source), and is visibly no different to a user than before.
3. **Given** absences with no completed follow-up, **When** the overview loads, **Then** the "needs follow-up" indicator matches today's count exactly, computed the same way it is today (out of scope for migration in this batch).

---

### User Story 4 - QR check-in still detects a same-day duplicate correctly (Priority: P4)

A staff member scans or enters a student's code at the ID-cards check-in station. Before recording anything, the station checks whether that specific student already has an attendance record for today and warns the operator if so. This check must keep working exactly as it does today.

**Why this priority**: Smallest, most contained change in this batch — a single-student, single-day lookup — but touches an active operator workflow, so it's sequenced after the purely-display migrations above.

**Independent Test**: With a student who already has a record for today, attempt to scan/enter their code again and confirm the same "already recorded" warning appears, with the same details, as today.

**Acceptance Scenarios**:

1. **Given** a student has no attendance record for today, **When** their code is scanned/entered, **Then** the check-in proceeds exactly as it does today.
2. **Given** a student already has an attendance record for today, **When** their code is scanned/entered again, **Then** the same "already recorded" warning appears, with the same existing-record details shown today.

---

### Edge Cases

- A figure that cannot be reproduced exactly by this batch's data source (the Attendance page's distinct-session count, and — by explicit decision, since it belongs to the out-of-scope follow-up domain — the "needs follow-up" count) must remain on its current data source, unchanged — never approximated or silently redefined.
- A student, group, or center with zero attendance history must show the same empty/zero states across all five migrated consumers as it does today, never an error.
- Two migrated consumers computing the same underlying figure (e.g., an overall attendance percentage appearing on more than one page) must continue to agree with each other, exactly as they do today.
- None of the explicitly out-of-scope consumers (absence follow-up management, the global overdue-absence notification derivation, the Dashboard's recent-attendance trend stat, and any attendance write action) may change in any observable way as a side effect of this batch.

## Clarifications

### Session 2026-09-21

- Q: For the attendance-analytics 14-day trend, the current code takes the last 14 dates that actually have attendance sessions (not the last 14 calendar days). Since the migration needs to fetch a bounded date range up front, how far back should that lookup window reach to reliably still capture those 14 session-dates? → A: 90 days back — safely covers weekly/biweekly cadences with margin.
- Q: The Attendance page's "needs follow-up" indicator is computed from attendance combined with follow-up records, and follow-up management is out of scope for this batch. Should it attempt a partial migration (attendance from the new source, follow-up from its current source), or stay entirely on its current data source? → A: Leave the entire "needs follow-up" calculation on its current data source — do not touch it in this batch.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Reports overview's attendance percentage MUST match exactly what today's calculation over the same underlying records produces.
- **FR-002**: The attendance-analytics view's total/present/absent/late counts and percentage, per-group comparison, 14-day trend, and weekday-absence breakdown MUST each match exactly what today's calculation over the same underlying records produces. For the 14-day trend specifically, the system MUST look back at least 90 calendar days when gathering candidate session-dates, to reliably still surface the most recent 14 dates that have real session data (not 14 calendar days), matching today's "last 14 session-dates with data" behavior rather than a fixed calendar window.
- **FR-003**: The Dashboard's per-student attendance indicator MUST reflect only the listed student's own records and MUST match exactly what today's full-history calculation for that student produces, for every student currently shown there.
- **FR-004**: The Attendance page overview's present/absent/late counts and overall percentage MUST match exactly what today's calculation over the same underlying records produces.
- **FR-005**: The Attendance page's distinct-session count MUST NOT be replaced by an approximation; it MUST continue to work exactly as it does today.
- **FR-006**: The Attendance page's "needs follow-up" indicator is part of the (out-of-scope) follow-up domain displayed on this page — it MUST stay entirely on its current data source in this batch, not be partially or fully migrated, so it continues to match today's exact count with zero risk of two differently-sourced inputs disagreeing.
- **FR-007**: The QR check-in station's same-day duplicate check MUST continue to detect an existing record for the scanned/entered student on the current date, with the same warning and existing-record details as today.
- **FR-008**: None of the five migrated consumers may change how much data is fetched or computed for any consumer explicitly out of scope for this batch (absence follow-up management, the global overdue-absence notification derivation, the Dashboard's recent-attendance trend stat, and any attendance write action).
- **FR-009**: Wherever a currently-existing figure cannot be reproduced exactly by the data source this batch uses, the system MUST keep that figure on its current data source rather than substitute a differently-defined figure, and this MUST be documented explicitly as a known gap rather than presented as equivalent.
- **FR-010**: A student, group, or center with no attendance history MUST show the same empty/zero state in each migrated consumer as it does today, never an error.

### Key Entities *(include if feature involves data)*

- **Attendance Summary (center-wide)**: Aggregated present/absent/late/total figures across the whole center, optionally broken down by group, by calendar date within a recent window, or by weekday — feeds the Reports overview and attendance-analytics figures (User Story 1).
- **Attendance Summary (per student)**: The same aggregated figures scoped to one student at a time — feeds the Dashboard's per-student indicator (User Story 2) and, where applicable, the Attendance page overview (User Story 3).
- **Same-Day Attendance Check**: A yes/no fact — does this specific student already have a record for today — feeding the QR check-in duplicate warning (User Story 4).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every migrated figure across all five consumers is numerically identical to its pre-migration value when computed over the same underlying attendance data, verified by automated comparison before and after the change.
- **SC-002**: None of the five migrated consumers requires loading the center's complete historical attendance log to render — each one's data need scales with what it actually displays (a handful of students, a recent date window, or center-wide counts) rather than with total historical record count.
- **SC-003**: Zero observable behavior change in any of the four explicitly out-of-scope consumers, confirmed by their existing test coverage continuing to pass unmodified.
- **SC-004**: Every figure that cannot be reproduced exactly by this batch's data source is explicitly documented as a gap (not migrated, not approximated) rather than silently left ambiguous.

## Assumptions

- This is a data-source relocation, not a behavior or design change: every migrated figure's visible value, formatting, and placement stays exactly as it is today.
- The migration reuses the same scoped and aggregated attendance data-retrieval patterns already proven by the Frequent Absentees migration (feature 001) and the earlier Groups/Students/Payments migrations — no new summarization concept is introduced.
- "Today's calculation" for each figure is defined by the current, unmodified formula already implemented for that figure (e.g., percentage = present ÷ total); this batch changes only where the underlying records come from, never the formula.
- Access to each of the five affected pages remains gated by whatever permission already governs it today; no new permission model is introduced.
- If, during planning, a figure turns out to have no exact equivalent in the available data source, it is left unmigrated and documented — this is an expected, acceptable outcome for this batch, not a blocking failure.
