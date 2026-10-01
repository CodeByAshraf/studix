# Quickstart: Validating Attendance C4 Batch A

Prerequisites: a running Studix dev environment (backend + frontend + Postgres) with attendance
data spanning several months across at least 2 groups and several students, including at least
one absence on at least 3 different weekdays (to exercise `dayData` meaningfully), and at least
one student with zero attendance history.

## 1. Baseline (before migration) — capture current numbers

For each of the five pages below, note the exact figures shown today, using a fixed, known
dataset (or a database snapshot) so before/after comparison is exact, not approximate:

1. Reports → Overview tab: overall attendance %.
2. Reports → Attendance-analytics tab: total/present/absent/late counts and %, the per-group bar
   chart, the 14-day trend chart, and the weekday-absence chart.
3. Dashboard: the attendance heat indicator for each of the (up to 5) listed students.
4. Attendance → Overview: present/absent/late counts and %, the sessions count, and the
   "needs follow-up" count.
5. ID Cards → QR check-in: scan/enter a student who already has today's attendance recorded, and
   note the exact warning text and existing-record details shown.

## 2. After migration — verify contract usage and exact parity

1. Reload each page from step 1 and confirm every noted figure is **byte-for-byte identical** to
   its baseline value.
2. Open the Network tab for each page and confirm:
   - Reports Overview: `GET /api/attendance/aggregate?groupBy=status`, exactly once.
   - Attendance-analytics: four aggregate requests (`groupBy=status`, `groupBy=group`,
     `groupBy=date&from=...&to=...`, `groupBy=weekday&status=absent`), no request for the full
     unscoped attendance list.
   - Dashboard: `GET /api/attendance?studentIds=<exactly the 5 displayed students' ids>`, exactly
     once, no per-student separate requests.
   - Attendance Overview: `GET /api/attendance/aggregate?groupBy=status`, exactly once — and
     confirm `sessions`/`pendingFollowup` still render correctly with **no** new request beyond
     what the page already made today (they remain store-sourced).
   - QR check-in: `GET /api/attendance?studentId=<id>&date=<today>` fires only on a scan/manual
     submit, not on page load.
3. Confirm none of the four out-of-scope consumers changed: open Absence Follow-up and the
   notification bell and confirm both still work exactly as before (same figures, same items) —
   this exercises `AbsenceFollowup.jsx` and `ui.context.jsx` without any code in either having
   changed.

## 3. Validate edge cases

1. A student with zero attendance history: confirm their Dashboard heat row shows the same
   empty/neutral state as before (not an error), and — if a QR scan is attempted for them —
   proceeds as a fresh check-in with no "already recorded" warning.
2. A center/dataset with fewer than 14 session-dates within the last 90 days: confirm the
   attendance-analytics trend chart simply shows fewer than 14 points, matching what today's
   calculation would produce for the same sparse data — not an error, not a padded/fake trend.
3. Temporarily block one of the aggregate/scoped requests in dev tools and confirm each page
   shows a clear error message (not a blank or stale display) — matching the existing
   `useAsyncData` + toast-on-error pattern already used throughout the app.

## 4. Automated verification

```
npm run test -- ReportsPage AttendanceAnalytics Dashboard AttendancePage QRScanner
cd backend && npm run test:integration -- attendance.integration.test.js
```

Expected: every existing test file for these five components continues to pass, the new/extended
regression tests added by this feature's tasks pass, and the backend integration suite is
unchanged (no backend code added, so no new backend test is required — see research.md).
