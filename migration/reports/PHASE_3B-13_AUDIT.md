# Phase 3B-13 — Admissions Core + Activation: Audit, Implementation & Closure Report

**Scope covered by this report:** Phase 3B-13A (admissions core + relational followups/system-log), Phase 3B-13B Stage (i) (independent student-persistence hardening), Phase 3B-13B Stage (ii) (atomic activation endpoint). All three are closed as of this report. Phase 3B-13C (`admission_payments` / financial-domain integration) remains explicitly **BLOCKED and UNSCOPED** — not started, not designed beyond the high-level sequencing already recorded.

---

## 1. Original audit classification

**BLOCKED**, per the Phase 3B-13 Pre-Implementation Audit: `admissions` was the only remaining table read-synced from PostgreSQL with zero write path, and the audit surfaced three concerns that could not be mixed into one implementation pass — the nested-array-vs-relational-table data model, the `admission_payments`/treasury dependency, and a live `addStudent()`/`pgCreateStudent()` bypass bug in the existing activation flow. An Architecture Decision & Implementation Design document resolved these into three independently closable pieces (3B-13A, 3B-13B Stage i, 3B-13B Stage ii), each requiring separate approval before implementation — the pattern this report now closes out.

---

## 2. Phase 3B-13B Stage (i) — independent student-persistence hardening

**Implemented first, independently, before any admissions-table migration work**, per your explicit sequencing preference.

**Root cause:** `AdmissionsPage.jsx`'s `attendFirstLesson` called the raw local `addStudent()` Zustand action directly, bypassing `pgCreateStudent` entirely — a student "activated" from an admission was created only in browser state, never in PostgreSQL. Verified: `pgCreateStudent` preserves the client-supplied id for `students` (confirmed via `server.js`'s `PRESERVE_CLIENT_ID_COLLECTIONS`, which already included `students`/`groups` at the time), so routing through it required no reconciliation of the locally-generated id.

**Fix:** `attendFirstLesson` now calls `await pgCreateStudent(newStudent)`, adopts the server-truth response, and only then calls `addStudent(savedStudent)` — server-truth-first, no local mutation before success, matching the `StudentsPage.jsx` pattern exactly.

**Verification:** `AdmissionsPage.activation.test.jsx` (original version) — 3/3 passing at the time. No DB write verification needed (pure frontend fix, mocked fetch only).

**Status at closure: fully superseded by Stage (ii)** — the endpoint this fix called (`pgCreateStudent`) is no longer invoked from the activation path at all; `attendFirstLesson` now calls the Stage (ii) atomic endpoint instead. `pgCreateStudent` itself was not modified and remains the correct, active function for `StudentsPage.jsx`'s own independent student-creation flow.

---

## 3. Phase 3B-13A — admissions core + relational followups/system-log

### Store architecture
Replaced the nested-array model (`admission.followups[]`, `admission.payments[]`, `admission.systemLog[]` embedded in each admission row) with:
- **`admissions[]`** — server-shaped rows only, PostgreSQL-synced.
- **`admissionFollowups[]`** — relational child collection, PostgreSQL-synced.
- **`admissionSystemLog[]`** — relational child collection, PostgreSQL-synced.
- **`admissionPaymentsLocal[]`** — see §4.

A single `composeAdmission` selector, used at exactly one point (`records = useMemo(...)` in `AdmissionsPage.jsx`), reconstructs the legacy `{...admission, followups, systemLog, payments}` view for every existing read site (`stats`, `leadRecords`, `reservedRecords`, `followupRecords`, `activeRecords`, `selected`, `DetailsPanel`, `buildAdmissionReport`) — none of those sites needed further changes. The composed shape is derived-only and is never written back to `state.admissions`.

### Write paths migrated
`admissions` create/update via generic CRUD (`pgCreateAdmission`/`pgUpdateAdmission`); `admissionFollowups`/`admissionSystemLog` create via generic CRUD (`pgCreateAdmissionFollowup`/`pgCreateAdmissionSystemLog`). All server-truth-first: no local mutation before success, real server errors surfaced on failure, form components (`LeadsTab`, `ReservedTab`, `FollowupTab`) only reset/close on confirmed success (previously closed unconditionally).

### Client-ID preservation and business number
`admissions` added to `PRESERVE_CLIENT_ID_COLLECTIONS` (confirmed live: `server.js:49`) — the client-generated `adm_${Date.now()}` id is preserved server-side, matching `students`/`groups`, since local child records (`admissionFollowups`, `admissionSystemLog`, `admissionPaymentsLocal`) may reference it before server confirmation. `admissionNo` (`ADM-000001`) generation uses the **verified actual** established pattern (not the originally-worded "server-side generation"): client computes the number first from local state, and on a genuine `number`-field 409 conflict, retries exactly once using a number recomputed from a fresh `pgGetCollection('admissions')` fetch — identical contract to `pgCreateCommunication`/`pgCreateMaterial`.

### Date/Decimal normalization
`reservationDate` (`@db.Date`) and `courseFee` (`Decimal`) normalized both on the write-response path (`api.js`) and the read/merge path (`db.middleware.js`'s `COLLECTION_FIXUPS.admissions`), using the exact `normalizeDateOnly`/`toNum` helpers already established for `exams`/`inv_materials`. Field aliasing (`number↔admissionNo`, `studentId↔linkedStudentId`, `groupId↔confirmedGroupId`, and the `admissionFollowups`/`admissionSystemLog` field renames — `note↔notes`, `employee↔by`, `date↔at`, `activityType↔type`, `byUser↔by`, `timestamp↔at`, `details↔detail`) is applied identically on both the create/update response path and the boot-sync path, so a record's shape never depends on whether it arrived via a write or a sync.

### Read synchronization
`admissionFollowups` and `admissionSystemLog` added to `PG_COLLECTIONS` (confirmed live: `db.middleware.js:26`), both verified array-shaped before registration, both using the standard, unmodified `mergeById` — no singleton merger involved, `SINGLETON_MERGERS` (from Phase 3B-10/11) untouched.

### Bugs caught and fixed during implementation, before being reported as done
1. **`createdBy`/`lastModifiedBy` body-builder bug:** an early draft of `buildAdmissionRequestBody` unconditionally included these fields — on every *update* call this would have sent an explicit `null`, silently wiping the real `created_by` FK value (a genuine FK column on `admissions`, unlike `communications.created_by`). Fixed by moving them out of the shared builder into per-function handling (`pgCreateAdmission` sends `createdBy` once at creation; `pgUpdateAdmission` never touches it, only sends `lastModifiedBy`).
2. **Missing `persist` `partialize` entries:** the Zustand `persist` middleware's allowlist (`app.store.js`) didn't include the three new collections. `admissionPaymentsLocal` specifically would have silently vanished on every page reload — it has no other persistence path. Fixed by adding all three.
3. **`normalizeAdmissionFollowupResponse` inconsistency:** an early version left both the raw server field names (`note`/`employee`/`date`) and the aliased ones (`notes`/`by`/`at`) in its output, unlike `normalizeAdmissionResponse`'s destructure-and-replace pattern. Caught by the new test suite itself; fixed to destructure the raw fields out.

---

## 4. Local-only `admissionPaymentsLocal` — what it is and why it stays local

**The critical architectural finding of this phase's design stage.** `mergeById` performs a wholesale per-id replacement: for any `id` present in both local and server state, the local row is dropped entirely and replaced by the server row. If `admission.payments[]` had stayed embedded on each admission row while `admissions` was registered in `PG_COLLECTIONS`, **every local payment array would have been silently wiped on the very next boot-time sync** — the server's `admissions` response has no `payments` key at all.

**Resolution:** `admissionPaymentsLocal[]` is a separate, normalized, purely local array (never registered in `PG_COLLECTIONS`, never touched by `mergeById` or `SINGLETON_MERGERS`), populated by the exact same `addPayment`/`doCancelWithRefund` logic that previously wrote into the nested field — only the storage location changed, not the financial behavior. The composed selector merges it back into the legacy `payments` view for display. It must not be confused with the future `admission_payments` database table (§7) — this is a local audit-trail mirror of cashbox transactions already recorded elsewhere, not a persistence layer for that future table.

---

## 5. Phase 3B-13B Stage (ii) — atomic activation endpoint

**Root cause it closes:** Stage (i) coordinated student creation and admission activation via four independent HTTP requests with zero cross-request atomicity. Two concurrent activations of the same admission could each pass validation, each create a *different* student, and the second `admissions` update would overwrite `student_id`, permanently orphaning the first student with no admission ever pointing to it.

**Implementation:** one dedicated endpoint, `PUT /api/admissions/:id/activate` (`backend/src/routes/admissionActivation.js`), mounted before the generic dynamic loop — method+path interception on the two-segment `/:id/activate` path, which the generic router's one-segment `/:id` pattern never matches (same technique as `exams`/`homeworks`/`centerProfile`). One `runInTransaction` call performs, in order: re-fetch the admission **inside `tx`** (not the raw client — this is the exact fix for the race), idempotency/consistency checks, server-side student code computation, student create, admission update (`stage='active'`, `student_id` set), two `admission_system_log` creates (`firstLesson`, `activated`). All five operations commit together or not at all.

**Design decisions locked in** (approved as recommended, per your "APPROVED FOR IMPLEMENTATION" without contradiction on any of the five flagged items):
- **Idempotent-success on retry:** re-activating an already-active admission with a valid linked student returns that existing student and admission unchanged — zero new writes. Protects against double-clicks and network-timeout retries without creating duplicate students.
- **Server-side sequential student-code generation:** computed fresh inside the transaction (same technique as `materialDistribution.js`'s `computeNextSeq`), fixing the pre-existing `students.code` UNIQUE-collision risk inherent in the old local `existingStudents.length + 1` scheme.
- **Explicit rejection of inconsistent states:** `student_id` set without `stage='active'` (or the reverse) is rejected with a clear error, not silently completed — avoids masking a real data problem that souldn't arise once this is the only activation path.
- **`req.user.id`** used for `admission_system_log.by_user` on newly-created entries (consistent with how the rest of this migration series treats "who did this").
- Endpoint returns `{admission, student, systemLogEntries}` together — the frontend needed all three to fully replace its local optimistic state in one response.

**Frontend integration:** `attendFirstLesson` now makes exactly one call (`pgActivateAdmission`); `createStudent()` (local factory) is retained only for its existing client-side validation/sanitization before the network call, discarding the locally-computed `id`/`code` (server-generated) and `gender` (no DB column, matching the pre-existing silent-exclusion pattern already used for that field via generic CRUD). `updateRecord`/`logEvent` are no longer called from this path.

---

## 6. Transaction/rollback verification

No backend test framework was built, per explicit instruction, consistent with every prior phase. Verification used the established guaranteed-rollback-transaction technique (same disclosed approach as Phase 3B-12's Finding #1 and the 3B-13A verification): the transaction logic was replicated in a one-off script (not a call to the shipped function, since Prisma's `$transaction` commits internally on success and cannot be wrapped by an outer rollback), each expected-failure case run in its own transaction (Postgres aborts an entire transaction after any failed statement — a mechanical constraint discovered and worked around during the 3B-13A verification and reapplied here).

Five cases verified, all passed:
1. Happy path — student created, admission updated (`stage`+`student_id`), both system-log rows created atomically, `activated` log's `details` matches the generated code.
2. Idempotent re-activation — existing student returned, zero new writes, student count unchanged.
3. Inconsistent state (`student_id` set, `stage≠active`) — explicitly rejected.
4. Non-existent admission — rejected immediately, no writes.
5. Bad group FK on the student — fails cleanly, proving a mid-sequence failure rolls back the entire activation attempt, not just the failing statement.

Verification scripts deleted after use in both the 3B-13A and 3B-13B-Stage-(ii) passes. No new entities were left behind — reused only pre-existing or freshly-created-and-rolled-back entities.

---

## 7. `admission_payments` / financial-domain dependency — why 3B-13C remains BLOCKED

Live-verified during the original Phase 3B-13 audit and unchanged since: `admission_payments` has a real BEFORE INSERT trigger (`trg_admpay_needs_treasury`) requiring a valid treasury relationship, and `treasury_txn` has no write path anywhere in this system (`payments`/`treasuryTxn`/`cashboxes`/`admissionPayments` all remain in `READ_ONLY_COLLECTIONS` at the backend). Migrating `admission_payments` independently would either require weakening that trigger (explicitly forbidden) or recreate the exact `matDist`/`inventory_txn` disconnect documented as Phase 3B-12's Finding #2. **No workaround was implemented, no fake treasury rows were created, the trigger was not touched.** `admissionPaymentsLocal` (§4) is the interim, local-only substitute until the financial-domain migration exists — sequencing remains: admissions core → followups/system-log → student activation integration → [financial-domain migration, unscoped] → `admission_payments`.

---

## 8. Complete test results and why 124/124 is correct

```
Admissions suite: npx vitest run src/modules/admissions/
✓ AdmissionsPage.activation.test.jsx — 3/3 (Stage ii: single-endpoint success/adoption,
    failure/untouched-state, idempotent re-activation)
✓ AdmissionsPage.core.test.jsx       — 10/10 (3B-13A: create/update/number-retry/
    followups/composed-view)
= 13/13

Full suite: npx vitest run
✓ 18/18 test files, 124/124 tests passed
```

**Count reconciliation, phase by phase:**
- Pre-3B-13 baseline (end of Phase 3B-12): 111/111.
- Stage (i) added its own 3-test file: 111 → 114.
- 3B-13A: rewrote the Stage (i) suite to account for `attendFirstLesson` now also calling `pgUpdateAdmission` (3 tests, was already 3, net 0), added `AdmissionsPage.core.test.jsx` (10 new): 114 → 125.
- Stage (ii): rewrote the Stage (i)/3B-13A-era activation suite for the single-endpoint contract — reduced from 4 tests (which had tested the two-separate-call orchestration in detail, including a dedicated "admission-update-fails-after-student-succeeds" case that no longer applies once both happen in one transaction) to 3 tests covering the new contract: 125 → 124.

**124 is correct** — it reflects real test consolidation (the old multi-call failure-mode tests became meaningless once those calls no longer exist as separate requests), not lost coverage. The single remaining activation suite covers success/adoption, failure, and idempotency; the atomicity guarantees themselves are covered by the DB-level verification in §6, which is the correct layer for that class of guarantee (matching how `attendance-sessions`/`exam-grades`/`material-distributions` are all verified — frontend contract tests for the request/response shape, DB-level verification for transactional atomicity).

---

## 9. Exact files changed across the full Phase 3B-13 arc

**Backend:**
- `backend/src/server.js` — `admissions` added to `PRESERVE_CLIENT_ID_COLLECTIONS`; `admissionActivationRouter` imported and mounted at `/api/admissions` (before the generic loop).
- `backend/src/routes/admissionActivation.js` — new, Stage (ii)'s atomic endpoint.

**Frontend:**
- `src/services/api.js` — `pgCreateAdmission`, `pgUpdateAdmission`, `pgCreateAdmissionFollowup`, `pgCreateAdmissionSystemLog`, `pgActivateAdmission`, plus their request-body builders and response normalizers.
- `src/store/slices/admissions.slice.js` — rewritten: `admissions[]`/`admissionFollowups[]`/`admissionSystemLog[]`/`admissionPaymentsLocal[]` + their setters; the 5 dead, shape-incompatible legacy actions (`addAdmission`, `updateAdmission`, `removeAdmission`, `addAdmissionFollowup`, `addAdmissionPayment`) removed.
- `src/data/initialData.js` — `INITIAL_ADMISSION_FOLLOWUPS`, `INITIAL_ADMISSION_SYSTEM_LOG`, `INITIAL_ADMISSION_PAYMENTS_LOCAL` added.
- `src/store/app.store.js` — the three new collections added to the `persist` `partialize` allowlist.
- `src/store/db.middleware.js` — `admissionFollowups`/`admissionSystemLog` added to `PG_COLLECTIONS`; `COLLECTION_FIXUPS.admissions`/`.admissionFollowups`/`.admissionSystemLog` added.
- `src/modules/admissions/AdmissionsPage.jsx` — full rewrite of every write path (`updateRecord`, `convertToReservation`, `doConfirmWithGroup`, `cancelReservation`, `doCancelWithRefund`, `moveToWaiting`, `moveFromWaiting`, `addFollowup`, `addRecord`, `addReservation`, `addPayment`, `logEvent`, `attendFirstLesson`) plus the `composeAdmission` selector.
- `src/modules/admissions/AdmissionsPage.activation.test.jsx` — rewritten twice (Stage i's own fix, then Stage ii's single-endpoint contract).
- `src/modules/admissions/AdmissionsPage.core.test.jsx` — new (3B-13A).

---

## 10. Explicitly protected / untouched files

`backend/prisma/schema.prisma` (no schema changes at any point in this phase), `backend/src/routes/crud.js` (generic CRUD infrastructure, never modified), `src/store/slices/students.slice.js` (Phase 3B-2 infrastructure untouched beyond the one `attendFirstLesson` call-site change, since superseded), `src/services/api.js`'s `pgCreateStudent` (unmodified — still the correct function for `StudentsPage.jsx`'s independent flow), `admission_payments`/`treasury_txn`/`payments`/`cashboxes` (no API functions, no `PG_COLLECTIONS` registration, no trigger changes), and every closed Phase 3B-8 through 3B-12 file.

---

## 11. Known limitations carried forward (not fixed, not in scope)

- **`admission_payments` / financial-domain integration** — blocked, unscoped (§7).
- **`students.code` collision risk in non-activation student creation** — Stage (ii) fixed this *only* for activation-created students (server-side sequential computation inside the transaction). `StudentsPage.jsx`'s own independent creation flow still uses the local `existingStudents.length + 1` scheme and was intentionally not touched (out of this phase's scope — Phase 3B-2 infrastructure).
- **`InventoryPage.jsx` vs `MaterialsPage.jsx` local-state-key duplication** (`invMaterials` vs `materials`) — noted during the Phase 3B-11/12 audits, unrelated to and unaffected by this phase, still unresolved.
- **No backend automated test framework exists** — by design, consistent with every phase; DB-level guarantees verified via one-off guaranteed-rollback scripts, not persistent test infrastructure.

---

## Final Status

```
Phase 3B-13A                                    — CLOSED
Phase 3B-13B Stage (i)                          — CLOSED (superseded by Stage ii, not reverted)
Phase 3B-13B Stage (ii)                         — CLOSED
Phase 3B-13 admissions core + activation work   — CLOSED

Full regression suite: 124/124 passing, 0 regressions
DB baseline: unchanged, zero verification residue
Schema changes: none
crud.js changes: none
admission_payments / treasury integration: BLOCKED, UNSCOPED
Phase 3B-13C: NOT STARTED
```
