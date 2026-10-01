# Feature Specification: Frequent Absentees Report Data Migration

**Feature Branch**: `[001-frequent-absentees-migration]`

**Created**: 2026-09-21

**Status**: Draft

**Input**: User description: "Migrate ReportFrequentAbsentees (the 'absents' tab in AttendanceReports.jsx) off the global attendance store onto the scoped/aggregate attendance API, matching the other 11 migrated consumers."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Identify students needing absence follow-up (Priority: P1)

A center staff member opens the Attendance Reports "frequent absentees" view to find which currently-enrolled students have missed too many sessions, so they can follow up with the student or parent.

**Why this priority**: This is the entire purpose of the report — without an accurate, responsive list of frequently-absent students, staff cannot do timely follow-up, which is the report's core business value.

**Independent Test**: Open the report with no filters applied and confirm every active student whose absence count meets the default threshold appears, sorted by absence count descending, each with a working "call" action.

**Acceptance Scenarios**:

1. **Given** the center has active students with varying attendance histories, **When** staff open the frequent-absentees report, **Then** every active student with at least the default minimum number of absences is listed, most-absent first, with their absence count, attendance percentage, and a severity indicator.
2. **Given** the report is open, **When** staff tap a student's call action, **Then** the device's call flow starts for that student's (or parent's) phone number, unchanged from today.

---

### User Story 2 - Narrow the list by threshold and group (Priority: P2)

Staff adjust the minimum-absence threshold or restrict the list to one group to focus follow-up efforts (e.g., only students with 5+ absences in a specific group).

**Why this priority**: Filtering is what makes the report usable at scale — without it, staff at larger centers would have to scan every flagged student regardless of severity or class, which is less actionable.

**Independent Test**: With the report open and populated, change the threshold and/or select a single group, and confirm the list updates to reflect only students meeting the new criteria, without reloading the page.

**Acceptance Scenarios**:

1. **Given** the report is showing students at the default threshold, **When** staff select a higher threshold, **Then** only students meeting or exceeding the new threshold remain listed.
2. **Given** the report is showing all groups, **When** staff select a single group, **Then** only active students from that group are considered for the list.
3. **Given** a threshold/group combination matches no students, **When** the filter is applied, **Then** a friendly "no students need follow-up" message is shown instead of an empty or broken list.

---

### User Story 3 - Report stays fast and reliable as attendance history grows (Priority: P3)

As the center accumulates years of attendance records, the report continues to load quickly and reliably rather than degrading or freezing the page.

**Why this priority**: This is the reason for the migration — the current implementation reads the entire historical attendance dataset into the browser, which does not scale. It is lower priority than the visible behaviors above because it changes nothing the user sees when working correctly, but it protects the feature's long-term usability.

**Independent Test**: With a large volume of historical attendance data present, open the report and confirm it renders the correct list within an acceptable time, and that changing the threshold or group filter does not require re-downloading the full attendance history.

**Acceptance Scenarios**:

1. **Given** the center has multiple years of attendance history, **When** staff open the report, **Then** the list of frequent absentees appears without a noticeable delay or browser slowdown.
2. **Given** the underlying attendance data cannot be retrieved (e.g., a network or server problem), **When** staff open the report, **Then** a clear error message is shown instead of a silently empty or stale list.

---

### Edge Cases

- A student has zero attendance records at all: they must not appear as having 0% attendance or be falsely flagged — they simply have no absences to report.
- A student was transferred between groups during the term: their historical absences must continue to be attributed the same way this report (and the rest of the system) already attributes transferred-student history — no new attribution logic is introduced.
- An inactive/suspended student has many absences: they must never appear on this list, only active students are eligible.
- The selected group has no active students at all: the report shows the "no students need follow-up" empty state, not an error.
- Rapid, repeated changes to threshold or group filter (e.g., staff clicking through options quickly): the report must always end up showing results consistent with the last selection made, never a stale result from an earlier, superseded selection.

## Clarifications

### Session 2026-09-21

- Q: While the report is fetching or re-fetching absentee data (on open, or after changing the threshold/group filter), what should staff see during that brief wait? → A: No dedicated loading indicator — behaves like the other three Attendance Reports tabs (list shows its normal empty state until data resolves)
- Q: What size of active student roster must the report stay fast for — i.e., what counts as a "typical center roster" for the 2-second target in SC-001? → A: Up to 500 active students
- Q: When this report fetches per-student attendance summaries, should the request be scoped to only the currently-active (and optionally group-filtered) students the frontend already knows about, or is it acceptable for the response to include every student who has ever had an attendance record, active or not? → A: The request MUST be explicitly scoped to the active (and group-filtered) student IDs the frontend already has — not left to include every student who has ever had an attendance record

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display, for each active student whose absence count meets or exceeds the selected threshold, their name, group, grade, absence count, attendance percentage, and a severity indicator, sorted from most to least absences.
- **FR-002**: Users MUST be able to choose a minimum-absence threshold from the same fixed set of values offered today (2, 3, 5, or 7 absences) to narrow the list.
- **FR-003**: Users MUST be able to restrict the list to a single group, or view all groups, exactly as today.
- **FR-004**: System MUST NOT require retrieving the center's entire historical attendance dataset to render this report — it must explicitly scope the request to only the currently-active, in-scope student IDs already known to the client (not merely "whatever the summary happens to return"), so a student who is no longer active but still has historical attendance records does not inflate the amount of data retrieved. This is consistent with how every other attendance-driven report and list in the system already operates.
- **FR-005**: System MUST show a friendly empty-state message when no student meets the selected threshold/group combination, and a distinct, clear error message if the underlying attendance data cannot be retrieved.
- **FR-006**: Each listed student MUST retain a one-action way to call the student's or parent's phone number, unchanged from current behavior.
- **FR-007**: The severity classification (follow-up / warning / critical, based on absence count) MUST remain unchanged in both thresholds and visual presentation.
- **FR-008**: Only students whose current status is active are eligible to appear on this list.
- **FR-009**: Changing the threshold or group filter MUST update the displayed list in place, without a full page reload.
- **FR-010**: A student with no recorded attendance history MUST show as having no absences (not an error, not a false 0% attendance rate).
- **FR-011**: While absentee data is being fetched or re-fetched (initial open, or after a threshold/group change), the report MUST NOT show a dedicated loading indicator — it follows the same convention as the other three Attendance Reports tabs, where the list simply reflects its normal empty state until data resolves.

### Key Entities *(include if feature involves data)*

- **Student Absence Summary**: Per-student aggregated attendance figures (present count, absent count, late count, total sessions), explicitly requested for only the currently-active student IDs (further narrowed by the selected group filter, if any) — not for every student who has ever had an attendance record — used to compute attendance percentage and to determine whether the student meets the selected absence threshold.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Staff can view the full, correctly-sorted list of students meeting a chosen absence threshold within 2 seconds of opening the report, for a center with up to 500 active students.
- **SC-002**: The amount of attendance data the report needs to retrieve no longer grows with the center's total historical attendance volume, nor with the number of formerly-enrolled/inactive students who happen to have attendance history — it scales only with the number of currently-active, in-scope students, because the request is explicitly scoped to that exact student set (see FR-004), matching the data-retrieval pattern already used by the rest of the Attendance Reports page, the Groups page, and the Students page.
- **SC-003**: All existing report behaviors — threshold selection, group filtering, sort order, severity tiers, call action, and empty state — are preserved with zero observable regression, confirmed by automated tests before and after the change.
- **SC-004**: The report produces correct absence counts and attendance percentages even for centers with multiple years of accumulated attendance history, without the page becoming slow or unresponsive.

## Assumptions

- This is a data-source relocation, not a behavior change: the report's visible logic (threshold options, severity cut-offs, sort order, filters, call action) stays exactly as it is today.
- The migration reuses the same per-student attendance summarization already powering the Groups page, Students page, and the other three Attendance Reports tabs — no new summarization logic is introduced.
- "Active" continues to mean the student's current status field equals active, exactly as today.
- Access to this report remains gated by the same permission that already governs the Attendance Reports page; no new permission model is introduced.
- The report's out-of-scope sibling (the top-level attendance data selector shared across all four Attendance Reports tabs) is addressed by this same change only insofar as removing this tab's dependency on it; no other tab's behavior is affected.
