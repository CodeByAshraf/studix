# Phase 3B-8 — Audit & Closure Report

**Module:** `absenceFollowup` (`absence_followup` table)
**Status:** Retrospective audit — implementation was already shipped before this report was written. This document exists because the code comments referencing it (`src/services/api.js`, `collections.js`, `fieldMaps.js`) predate any persisted report.
**Type of change:** Documentation only. No application code, schema, routes, or data were modified to produce this report or during its closure.

---

## 1. Scope

Single-record follow-up on an absent `attendance` row (reason, follower, contact status, notes, parent-contacted-us flag). 1:1 with `attendance` via `attendance_id UNIQUE`. No roster/batch shape — plain generic-CRUD single-record writes, unlike `attendance`/`exams`/`homeworks` which required dedicated atomic endpoints.

## 2. Frontend write paths (complete)

- `src/modules/attendance/AbsenceFollowup.jsx:218-247` (`handleSave`) is the only entry point: `pgCreateAbsenceFollowup` (no existing record) or `pgUpdateAbsenceFollowup(existing.id, …)` (existing record). Local state (`setAbsenceFollowup`) is mutated only after server success, adopting the server response verbatim — same server-truth-first contract as SessionMarking/ExamsPage/CommunicationPage.
- No delete path exists anywhere in the frontend. `AttendancePage.jsx` and `StudentReportPage.jsx` only read `absenceFollowup` for stats/badges.
- No `pgDeleteAbsenceFollowup` exists in `api.js` — consistent with the "no UI caller, no function" scoping rule used in every prior phase.

## 3. PostgreSQL schema

```prisma
model absence_followup {
  id                  String     @id
  attendance_id       String     @unique
  absence_reason      String?
  followed_by         String?
  followed_at         DateTime?  @db.Timestamptz(6)
  follow_status       String     @default("pending")
  notes               String?
  parent_contacted_us Boolean    @default(false)
  attendance          attendance @relation(fields: [attendance_id], references: [id], onDelete: NoAction, onUpdate: NoAction)
}
```

No `@default` on `id` → server always generates a UUID. No CHECK constraint on `follow_status` (unlike `attendance.status`'s `chk_attendance_status`) — see §8.

## 4. Field mapping

Direct camelCase↔snake_case, no aliasing: `attendanceId/absenceReason/followedBy/followedAt/followStatus/notes/parentContactedUs`. `studentId`/`date` are UI-local convenience fields derived by joining `attendance`; never sent to the server, never read back.

## 5. Serialization — accepted as clean, no changes

`followed_at` is `@db.Timestamptz(6)`, which round-trips as a full ISO string via JSON — unlike the `@db.Date` columns elsewhere (`attendance.date`, `exams.date`, `homeworks.dueDate`) that need explicit fixups. `follow_status`/`notes`/etc. are plain strings/booleans, not `Decimal`, so no text-vs-number bug class. `db.middleware.js`'s `COLLECTION_FIXUPS` correctly has no entry for `absenceFollowup`.

**Decision (2026-08-20): accepted as-is. No changes made.**

## 6. FK / delete semantics — known cross-phase gap, fix deferred

`absence_followup.attendance_id → attendance.id` is `onDelete: NoAction` (RESTRICT). `backend/src/routes/attendanceSessions.js:70-76` (Phase 3B-4, written before `absence_followup` existed) deletes `attendance` rows for any student dropped from a resubmitted session roster. If that student already had a follow-up row, the `deleteMany` throws Prisma `P2003` (FK violation) → the entire session-save transaction rolls back for every student in that session, not just the affected one. Reachable in normal use (mark absent → secretary logs a follow-up → teacher later un-marks that student and resaves the session). Neither 3B-4's nor 3B-8's test suite exercises this interaction.

**Decision (2026-08-20): Option A — cascade-delete the related `absence_followup` row in the same transaction, at the point `attendanceSessions.js` legitimately removes an `attendance` row from the roster.**

**Deferred — NOT implemented as part of Phase 3B-8.** `attendanceSessions.js` belongs to Phase 3B-4's scope; this fix is out of bounds for 3B-8's boundary and must be handled explicitly in a future phase. Required test coverage when that phase lands:
- absent attendance + existing `absence_followup` → roster removal succeeds (no P2003)
- both rows (`attendance` and `absence_followup`) are deleted atomically
- a forced mid-transaction failure rolls back both deletions (nothing partially committed)
- existing behavior for attendance rows with **no** follow-up remains unchanged (no regression to the current delete path)

## 7. Generic vs. dedicated endpoint — accepted as-is

Correctly generic (`POST/PUT /api/absenceFollowup` via `makeCrudRouter('absence_followup', { writable: true })`, auto-wired by `server.js`'s dynamic loop over `COLLECTION_MODELS`). No dedicated endpoint built or needed — single-record writes only, no roster/batch semantics.

## 8. Validation — known limitation, left unchanged

Server-side: none beyond Prisma type/FK/unique constraints. `follow_status` accepts any string at the API level — a direct API call (bypassing the UI) could write a value outside `{pending, contacted, excused, unexcused}`. The UI's `FOLLOW_STATUS` lookup (`AbsenceFollowup.jsx:327`) has no fallback for an unrecognized key, so such a row would render incorrectly in the table. This mirrors the permissiveness of every other generic-CRUD collection in this backend — not a regression introduced by 3B-8.

**Decision (2026-08-20): leave unchanged. No modification to generic CRUD, schema, or a dedicated endpoint. The current UI remains the sole authoritative producer of valid `follow_status` values. Recorded here as a known limitation, not scheduled for a fix.**

## 9. Authentication — accepted as-is

`requireAuth` only (signed session cookie). `absenceFollowup` is not in `ADMIN_ONLY_COLLECTIONS`, `READ_ONLY_COLLECTIONS`, or `PRESERVE_CLIENT_ID_COLLECTIONS`. Any authenticated user/role can write via direct API call regardless of frontend role gating — matches the existing pattern for `attendance` itself; not a gap introduced by this module.

## 10. ID strategy — accepted as-is

Server-generated UUID always. `absenceFollowup` is absent from `PRESERVE_CLIENT_ID_COLLECTIONS` and `id` has no DB default, so `crypto.randomUUID()` fires unconditionally on create. Frontend never sends `id` and always trusts the response's `id`.

## 11. Merge behavior (read path) — accepted as clean, no changes

`absenceFollowup` is in `db.middleware.js`'s `PG_COLLECTIONS`, with no `COLLECTION_FIXUPS` entry (correctly, per §5). Standard `mergeById`: PG rows win by `id`; any local-only `id` not present server-side is preserved, never deleted for being "missing" on the server.

**Decision (2026-08-20): accepted as-is. No changes made.**

## 12. Testing — verified baseline

```
npx vitest run src/modules/attendance/AbsenceFollowup.test.jsx
✓ 8 tests passed
```
Covers: payload shape (no `id`/`studentId`/`date` sent), no local mutation before server success, verbatim server-response adoption on success, real error-message passthrough on failure, create-vs-update routing, all 4 `followStatus` values sent exactly as selected.

Not covered (by design — deferred, see §6/§8): the `attendance-sessions` FK-delete interaction; the create-time unique-constraint race on `attendance_id` (no retry logic, unlike `pgCreateCommunication`'s number-conflict retry — accepted as low-risk, not flagged for action).

## 13. Files touched by the original (already-shipped) 3B-8 implementation

- `backend/prisma/schema.prisma` — `absence_followup` model + `attendance.absence_followup` back-relation
- `backend/src/routes/collections.js` — registry entry
- `src/services/api.js:477-527` — `buildAbsenceFollowupRequestBody`, `pgCreateAbsenceFollowup`, `pgUpdateAbsenceFollowup`
- `src/modules/attendance/AbsenceFollowup.jsx` — `handleSave`
- `src/modules/attendance/AbsenceFollowup.test.jsx`
- `src/store/db.middleware.js:18` — `PG_COLLECTIONS` entry
- `migration/mapping/fieldMaps.js:125-135`, `migration/import-postgres.js:138` — pre-existing from 3B-4 prep

No files were modified during this closure step beyond creating this report.

## 14. Forbidden / correctly out-of-scope files

`backend/src/lib/caseMapper.js`, `backend/src/routes/crud.js` (generic router, reused as-is), `src/store/app.store.js` / `index.js` / `slices/attendance.slice.js` (pre-existing state shape). `backend/src/routes/attendanceSessions.js` was correctly left untouched by 3B-8's original scope — and remains untouched by this closure step; the §6 fix belongs to a future phase that explicitly touches that file.

## 15. Baseline counts (local dev DB, read-only, captured 2026-08-20)

```
students: 2 · attendance: 0 · attendance(status=absent): 0 · absence_followup: 0
```
Empty/near-empty local dev DB — no production data implicated by this audit or its closure.

---

## Closure summary

| Item | Decision | Action taken |
|---|---|---|
| §5 Serialization | Accepted as clean | None |
| §6 FK/delete (attendanceSessions ↔ absence_followup) | Option A: cascade-delete in same transaction | **Deferred** to a future phase that explicitly scopes `attendanceSessions.js` |
| §8 `follow_status` validation | Known limitation, UI remains authoritative | None |
| §11 Merge behavior | Accepted as clean | None |
| 3B-8 implementation itself | Complete, shipped, verified | None (not reimplemented or modified) |

**Phase 3B-8 is closed.** No code, schema, route, or data changes were made as part of this closure — only this report was created.
