# Quickstart: Validating the Frequent Absentees Report Migration

Prerequisites: a running Studix dev environment (backend + frontend + Postgres) with at least
one active student who has several `absent` attendance rows, at least one student with zero
attendance history, and — to validate the `studentIds` scoping fix (research.md §1a) — at least
one **inactive/suspended** student who also has `absent` attendance rows on file.

## 1. Start the app

```
cd backend && npm run dev     # backend on :4000
npm run dev                   # frontend on :5173 (repo root)
```

## 2. Baseline (before migration) — capture current behavior

1. Log in, go to **Attendance Reports → الطلاب كثيرو الغياب (frequent absentees tab)**.
2. Note the list at the default threshold (3+): names, absence counts, percentages, severity
   labels, and sort order.
3. Open browser dev tools → Network tab. Confirm today's implementation makes **no dedicated
   request** for this tab (data comes from the boot-time global `attendance` sync).

## 3. After migration — verify contract usage

1. Reload the page, open the frequent-absentees tab again.
2. In the Network tab, confirm exactly one request:
   `GET /api/attendance/aggregate?groupBy=student&studentIds=<...>` (no `groupId` when "all
   groups" is selected). Confirm `studentIds` is present and its id list matches exactly the
   center's **active** students — not every student in the database.
3. Confirm the rendered list is **identical** to the Step 2 baseline: same students, same order,
   same absence counts, same percentages, same severity labels.
4. Confirm the inactive/suspended student from the Prerequisites (with `absent` rows on file)
   never appears on this list at any threshold, and — inspecting the request from step 2 — that
   their id is **not** included in `studentIds` at all (not merely filtered out after the fact;
   see data-model.md's Edge Cases and research.md §1a).

## 4. Validate filtering (User Story 2)

1. Click a different threshold button (e.g., 5+). Confirm the list narrows accordingly, and
   confirm in the Network tab that **no new request** was made (per FR-009 / research.md §2).
2. Select a single group from the group dropdown. Confirm the list narrows to that group's
   active students only, and confirm exactly one new request was made:
   `GET /api/attendance/aggregate?groupBy=student&studentIds=<...>&groupId=<id>`, with
   `studentIds` now narrowed to just that group's active students.
3. Pick a threshold/group combination with no matching students. Confirm the friendly
   "لا يوجد طلاب تجاوزوا N غيابات" empty state renders (FR-005), not a blank or broken screen.

## 5. Validate edge cases

1. Pick a student with zero attendance history; confirm they never appear on this list at any
   threshold (FR-010) — check directly against the `students` table/admin view if needed.
2. Temporarily stop the backend (or block the `/api/attendance/aggregate` request in dev tools)
   and reopen the tab. Confirm a clear error toast/message appears (FR-005), not a silently
   empty or stale list.
3. Confirm the call (📞) action still opens the device's call flow for each listed student,
   unchanged (FR-006).

## 6. Automated verification

```
npm run test -- AttendanceReports          # frontend suite, includes the new absentees-tab test
cd backend && npm run test:integration -- attendance.integration.test.js
```

Expected: all existing `AttendanceReports.*.test.jsx` files still pass (no regression to the
by-student/by-group/print tabs), the new `AttendanceReports.absenteesTab.test.jsx` passes, and
the backend integration suite is unchanged (this feature adds no backend code, so no new
backend test is required beyond what already covers `groupBy=student`).
