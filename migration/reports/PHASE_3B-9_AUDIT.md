# Phase 3B-9 — Audit & Closure Report

**Module:** `waReportLog` (`wa_report_log` table)
**Status:** Retrospective audit — the implementation was already shipped before this report was written. This document is the persisted record of the Phase 3B-9 audit, following the same pattern established by Phase 3B-8.
**Type of change:** Documentation only. No application code, schema, routes, migrations, tests, or data were modified to produce this report or during its closure.

---

## 1. Current frontend runtime model and every real write path

Runtime payload shape (verified from `buildWaReportLogRequestBody`, `StudentReportPage.jsx`, and the test's asserted payload):
```js
{ studentId, parentPhone, reportType, messageType, createdBy, status: 'prepared' }
```

**Exactly one real write caller exists**: `handleWaOpen` in `src/modules/student-report/StudentReportPage.jsx:179-205`.
```js
const res = openWhatsapp(parentPhone, message);        // irreversible side effect (window.open), happens first
if (!res.ok) { toast.error(res.error); return; }
toast.success('تم فتح واتساب بالرسالة الجاهزة');         // success shown BEFORE the API call resolves
setWaPreview(null);
try {
  const saved = await pgCreateWaReportLog({ ... });      // awaited syntactically...
  addWaReportLog(saved);                                  // ...but local state only updates on success
} catch (err) {
  toast.warning(...);                                     // failure = non-blocking warning, never toast.error
}
```

Classification: **awaited, non-transactional, best-effort/non-blocking — not fire-and-forget, not local-only.** This is a deliberately different contract from every other migrated collection: the user-visible success is already irreversible (WhatsApp is open) before the log write even starts, so its failure cannot and does not roll anything back. Confirmed by the test suite's own header comment and its third test case.

A second UI action, "copy message" (`copyMessage`, wired to the same preview modal's `onCopy`), **never calls `pgCreateWaReportLog`** — copying and manually sending a report is completely unlogged. Verified by grep: no reference to `pgCreateWaReportLog` or `addWaReportLog` outside `handleWaOpen`.

No component anywhere reads `waReportLog` back for display — case-insensitive grep across `src/` for `wareportlog` returns only the write path, store plumbing, and the test file. It is currently a write-only audit trail from the user's perspective.

## 2. PostgreSQL/Prisma model and live constraints

```prisma
model wa_report_log {
  id           String    @id
  student_id   String?
  parent_phone String?
  report_type  String?
  message_type String?
  status       String    @default("prepared")
  created_by   String?
  created_at   DateTime  @default(now()) @db.Timestamptz(6)
  users        users?    @relation(fields: [created_by], references: [id], onDelete: NoAction, onUpdate: NoAction)
  students     students? @relation(fields: [student_id], references: [id], onDelete: NoAction, onUpdate: NoAction)
  @@index([student_id], map: "idx_wa_student")
}
```

No `updated_at` column at all — consistent with an append-only intent, though nothing at the DB or route layer actually *enforces* append-only (generic CRUD still exposes PUT/PATCH/DELETE; see §5/§10).

**Live trigger check** (`information_schema.triggers`, queried directly): `communications`, `activity_logs`, `admission_system_log`, `inventory_txn`, `treasury_txn` each have a `trg_no_delete_*` BEFORE DELETE trigger. **`wa_report_log` has none.** Unlike `communications` (permanently undeletable — see `CommunicationPage.jsx:95`), rows in this table can be deleted normally.

## 3. Exact frontend ↔ DB field mapping, including naming mismatches

Direct camelCase↔snake_case, **no aliasing, no naming mismatches** (unlike `communications.legacyParentName` or `hwSubmissions.homeworkId`→`hwId` elsewhere): `studentId↔student_id`, `parentPhone↔parent_phone`, `reportType↔report_type`, `messageType↔message_type`, `status↔status`, `createdBy↔created_by`. `id`/`createdAt` are server-managed (`SERVER_MANAGED_FIELDS` in `crud.js`) and never sent by the client — confirmed by the test asserting `sentPayload.id`/`sentPayload.createdAt` are `undefined`.

One data-quality note, not a naming mismatch: the `parentPhone` value logged is the **raw, unnormalized** `student.parentPhone`, while the actual `wa.me` link uses a `normalizePhone()`-cleaned version. The two can differ in formatting for the same send.

## 4. Date/Decimal/JSON serialization risks

None. `created_at` is `@db.Timestamptz(6)`, which round-trips as a full ISO string over JSON — it does not have the midnight-UTC corruption bug that `@db.Date` columns elsewhere in this schema (`attendance.date`, `exams.date`) require explicit fixups for. There are no `Decimal` columns on this table. `db.middleware.js`'s `COLLECTION_FIXUPS` map correctly has no entry for `waReportLog`.

## 5. Generic CRUD vs. dedicated endpoint suitability

Generic CRUD is correct and is what's shipped: `POST /api/waReportLog` via `makeCrudRouter('wa_report_log', { writable: true })`, auto-registered through `collections.js` → `server.js`'s dynamic loop. Single-record, no roster/batch shape, no cross-row atomicity requirement — no dedicated endpoint is needed. The generic router also exposes GET-by-id, PUT, PATCH, and DELETE for this collection even though the frontend only ever calls POST — nothing blocks those other verbs at the route layer.

## 6. Authentication and authorization behavior

`requireAuth` only (signed session cookie). `waReportLog` appears in none of `ADMIN_ONLY_COLLECTIONS`, `READ_ONLY_COLLECTIONS`, or `PRESERVE_CLIENT_ID_COLLECTIONS` in `server.js`. Frontend route gating is `pageId="students"` (`App.jsx:199`, `ProtectedRoute`) — there is no dedicated `student-report` or `waReportLog` permission; access rides on the Students module permission. Any authenticated session (any role) hitting `/api/waReportLog` directly, bypassing the UI, can write — same pattern already accepted for every non-admin-only collection in prior phases, not a new gap.

## 7. ID generation / preserve-client-id requirements

`waReportLog` is absent from `PRESERVE_CLIENT_ID_COLLECTIONS` (only `{students, groups}`), and `id` has no `@default` in the schema, so `crud.js`'s POST handler unconditionally generates a UUID via `crypto.randomUUID()`. The frontend never sends `id` and always adopts the response's server-issued `id` — confirmed by the passing test. No preserve-client-id behavior applies or is needed here.

## 8. `db.middleware.js` PG_COLLECTIONS and merge normalization

`waReportLog` is present in `PG_COLLECTIONS` (`db.middleware.js:20`). No `COLLECTION_FIXUPS` entry exists for it, correctly — there's nothing to normalize (§4). Standard `mergeById` applies: PostgreSQL rows win by `id`; any local-only `id` not present server-side is preserved, never deleted purely because the server returned fewer rows.

## 9. Validation gaps between frontend and DB

- **Server-side:** none beyond Prisma type/FK checks. `report_type`, `message_type`, and `status` accept arbitrary strings — no CHECK constraint, no enum enforcement.
- **Frontend-side:** `reportType`/`messageType` are not user-editable; they come from `generateMessage()`'s default parameter (`MessageType.FOLLOWUP_SUMMARY`), and today's single call site never overrides it. So even without server enforcement, the current UI cannot actually produce an invalid value — the gap is theoretical against the shipped UI, but real against any direct API call.
- The one place validation *is* enforced is `created_by`, and it's enforced by a real FK (§10), not application logic.

## 10. FK/delete semantics and interaction with existing modules

- `created_by → users.id`, `onDelete: NoAction` (RESTRICT) — a genuine FK, unlike `communications.created_by` (confirmed by direct schema comparison: `communications.created_by String?` has no `@relation` at all, while `wa_report_log.created_by` does). Sending a display name instead of a real user id throws Prisma `P2003` → mapped to `409` by `errorHandler.js`. The shipped code already does this correctly (`createdBy: currentUser?.id ?? null`), and the test suite locks in the "never fall back to a display name" behavior explicitly.
- `student_id → students.id`, `onDelete: NoAction` — same RESTRICT pattern as every other student-referencing table. Deleting a student with any `wa_report_log` row would fail with `P2003` via the existing generic `pgDeleteStudent` (`DELETE /api/students/:id`, no dedicated cascading delete exists for students at all). This is a pre-existing, long-standing risk class already present before `wa_report_log` existed (via `attendance`, `payments`, `communications`, etc.) — `wa_report_log` just adds one more table to that set. Not a 3B-9-specific blocker.
- No interaction with any 3B-8 (`absence_followup`) or other in-flight phase was found.

## 11. Existing tests and actual coverage

`StudentReportPage.waReportLog.test.jsx` — **3/3 passing**, re-verified during this closure step with no code changes in between. Covers: server-truth adoption on success, `createdBy: null` when no session exists (never a display-name fallback), and non-blocking-warning-on-failure with no local record added on failure.

**Explicitly not covered:**
- The `copyMessage` path never logging (§1) — not asserted anywhere, only true by absence of a call.
- No test exercises a real `P2003` from either FK (`created_by` or `student_id`) — only a generic mocked error string.
- No test exercises `DELETE /api/waReportLog/:id`, `GET`, or `PUT`/`PATCH`, even though the generic router leaves them live (§5).

## 12. Database baseline and residuals

Baseline captured during the audit: `wa_report_log`: 0 rows, `users`: 1 row. No `__test_`-prefixed or otherwise identifiable residual data. Re-verified at closure: **still 0 rows, zero residuals** — no test data was created at any point during audit or closure.

## 13. Files that would need modification

**None.** The implementation is complete and matches the audit's findings on every axis checked (§1–§10). There is no remaining migration work for this collection.

## 14. Files that must remain untouched

Consistent with every prior phase's discipline: `backend/src/lib/caseMapper.js`, `backend/src/routes/crud.js` (generic router, reused as-is — no per-collection branching was added for this table), `src/store/app.store.js` / `index.js` (pre-existing state shape, unmodified). Also untouched by this closure step specifically: `src/services/api.js`, `src/store/db.middleware.js`, `StudentReportPage.jsx`, the Prisma schema, all routes, and all migration/import code.

## 15. Blockers / product decisions — resolved at closure

1. **`copyMessage` unlogged.**
   **Decision (2026-08-20): accepted as intentional current scope.** No logging added to the `copyMessage` path. `StudentReportPage.jsx` was not modified. If a future requirement needs a complete communication/report audit trail covering both copy and open-WhatsApp actions, that is separate future scope, not a 3B-9 gap.

2. **`status`/message-text design.**
   **Decision (2026-08-20): accepted as intentional and final for now.** `status` remains `'prepared'` with no workflow. No message text is persisted. This is a lightweight "report prepared/opened via WhatsApp" metadata log — explicitly **not** a sent-message confirmation system and **not** a message archive. No `message` column, no status workflow, no `pgUpdateWaReportLog`, no copy-message logging, and no schema change were added.

## 16. Recommended implementation architecture

N/A — nothing was built. For the record, the architecture actually shipped is the right one: generic CRUD, best-effort non-blocking write placed after an already-irreversible side effect, server-generated UUID, and a real FK on `created_by` instead of trusting a client-supplied display name.

## 17. Test plan (verification only, mirroring prior phases)

1. `npx vitest run src/modules/student-report/StudentReportPage.waReportLog.test.jsx` — **3/3 passing**, re-confirmed at closure.
2. DB baseline reconfirmed at closure: `wa_report_log` at 0 rows, zero `__test_` residuals. No write SQL, no HTTP create calls, and no test rows were issued during audit or closure.
3. If a future phase revisits §15.1 or §15.2, add: (a) an explicit test for `copyMessage` behavior (confirming it either remains unlogged or now logs, per whatever is decided then), (b) end-to-end tests for the `student_id`/`created_by` FK violations returning a real 409, not just a mocked error string.

---

## Closure summary

| Item | Decision | Action taken |
|---|---|---|
| §15.1 `copyMessage` unlogged | Accepted as intentional scope | None — `StudentReportPage.jsx` not modified |
| §15.2 `status`/message design | Accepted as intentional and final for now | None — no schema change, no `pgUpdateWaReportLog`, no `message` column |
| waReportLog implementation itself | Complete, shipped, verified | None (not reimplemented or modified) |

**Phase 3B-9 is CLOSED.** No implementation work was performed because `waReportLog` was already shipped and the audit found no implementation gap. No code, schema, route, migration, test, or data changes were made as part of this closure — only this report was created.
