# Product Completion — Phase 1 — Implementation Audit

Status: **Implemented, tested, verified.** All four approved issues are complete. This is a fresh, read-only post-implementation audit — every claim below was re-checked against the actual code/tests/build/database after implementation, not copied from the plan.

Scope discipline maintained throughout: Teachers untouched; Materials/parentExtras/matDist/Identity-Auth (all CLOSED) untouched; no schema migration was needed or performed for any of the four issues; no unrelated cleanup/refactoring was done.

---

## Issue 1 — Communication/Inventory unreachable from sidebar

**Implemented exactly as planned.**

### Changes
- `src/constants/nav.js` — added two `NAV_ITEMS` entries: `ROUTES.COMMUNICATION` ("مركز التواصل", icon `communication`, section العمليات, placed after Admissions) and `ROUTES.INVENTORY` ("مخزون المواد", icon `inventory`, section الأكاديمي, placed after Materials).
- `src/layouts/components/NavIcon.jsx` — added two new SVG path entries (`communication`, `inventory`) to the `PATHS` registry.
- `src/layouts/Sidebar.jsx` — the critical fix. `canSeeItem` previously mapped a nav item's id directly to a permission key, with only `'student-report'` as a special case. `Communication`'s real permission (per `App.jsx`'s `ProtectedRoute pageId` and backend `COLLECTION_PERMISSIONS`) is `'students'`, and `Inventory`'s is `'materials'` — neither matches its own route id, and no permission literally named `'communication'`/`'inventory'` exists in any role. Without this fix the two new items would have been added but permanently invisible. Added a module-level `PAGE_ID_OVERRIDES = { 'student-report': 'students', communication: 'students', inventory: 'materials' }` lookup, used by `canSeeItem`.

### Tests
New file `src/layouts/Sidebar.test.jsx` (none existed before) — renders the real `Sidebar` behind real `AuthProvider`/`UIProvider`/`MemoryRouter`, seeding `sessionStorage`'s session user with different `permissions` arrays:
- Both items visible with `permissions: ['students', 'materials']`.
- Both items hidden with `permissions: ['dashboard']` only.
- Independent mapping proven: `permissions: ['materials']` shows Inventory but hides Communication.

3/3 passing. This specifically proves the permission-mapping fix works, not just that the nav entries exist.

### Database impact
None.

---

## Issue 2 — Fresh installation cannot record its first payment (cashbox bootstrap)

**Option A implemented, exactly as approved.**

### Changes
- `src/modules/treasury/TreasuryPage.jsx`:
  - New module-level `syncSeedCashboxOnce()` + `cashboxSyncAttempted` guard flag: on first `TreasuryPage` mount in the app session, calls `pgCreateCashbox(seed)` with the exact `cb_main` object from `INITIAL_CASHBOXES` (imported from `src/data/initialData.js`, not re-declared). Any failure — 409 conflict (already exists) or anything else (network, etc.) — is caught and silently swallowed; nothing is surfaced to the user. The existing "no active cashbox" empty-state message in `PaymentForm.jsx` remains the fallback, untouched.
  - The guard is module-scoped (not component state) so it survives remounts as the user navigates away from/back to Treasury within one session — only a full page reload resets it, which is safe because a repeat attempt after reload just hits the same 409-treated-as-success path.
  - A `useEffect(() => { syncSeedCashboxOnce(); }, [])` fires it once on mount.
  - A test-only export, `__resetCashboxSyncGuardForTests`, was added so the existing cashbox/treasury-txn test suites (which also mount `TreasuryPage`) could be made deterministic — see Tests below. It is never called outside test files and has no effect on production behavior.
- No backend, schema, or payment-logic changes — `pgCreateCashbox` and the generic `cashboxes` CRUD route already existed and already supported client-supplied ids for this exact purpose (confirmed via the pre-existing `PRESERVE_CLIENT_ID_COLLECTIONS` comment in `api.js`).

### Tests
- New file `src/modules/treasury/TreasuryPage.cashboxSync.test.jsx` (5 tests): POSTs the exact seed body once on mount; a 409 response produces no visible error; a 500 (any other failure) also produces no visible error; the sync does not re-fire on remount within the same session; the sync never mutates local `cashboxes` state itself (it's a pure background network step).
- Updated `src/modules/treasury/TreasuryPage.cashboxes.test.jsx` (5 tests) and `src/modules/treasury/TreasuryPage.treasuryTxn.test.jsx` (7 tests): both already asserted exact `fetch`/POST call counts for user-driven cashbox CRUD and treasury-txn flows. Since every `TreasuryPage` mount now also fires the background `cb_main` sync POST to the same `/api/cashboxes` endpoint, these existing, already-passing tests needed updating as a **direct, necessary consequence** of the approved change (same category as prior sessions' test updates, not unrelated work): added a `userPostCalls()` filter (excludes the sync call by its `id: 'cb_main'` body) where the tests care about user-driven creates, and updated four raw `fetchMock`-call-count assertions from 1→2 to account for the extra background call. No test's actual intent changed — only the call-count bookkeeping.

All 17 treasury tests + the 5 new sync tests pass (22 total in the treasury module).

### Database impact
None from implementation/testing — all tests mock `fetch`, no real network call was made. Live read-only check after implementation: `cashboxes.count() === 0` (unchanged from before this phase). The real `cb_main` row will be created automatically, once, the first time a real user visits the Treasury page against a live backend.

### Rollback note (unchanged from the plan, restated here)
This is the one part of this whole plan with a real, non-trivial rollback cost: once a real `cb_main` row is created in Postgres, it cannot be deleted via the API (`pgDeleteCashbox` does not exist, by design — deletion is blocked server-side). Reverting the `TreasuryPage.jsx` effect is trivial; removing an already-created `cb_main` row, if ever desired, would require a manual, explicit decision outside the app.

---

## Issue 3 — `students.parent_id` never populated

**Implemented exactly as planned**, at both creation points.

### Changes
- `src/modules/students/StudentsPage.jsx` — added a module-level `findOrCreateParentId(phone)` helper (normalizes via `normalizeParentPhone` from `parentService.js`, then `pgCreateParent`, with the same 409-phone-conflict retry pattern `CommunicationPage.jsx`'s `handleSaveParent` already uses — read, not copied verbatim; that file was not touched). In the direct-creation branch of `handleSave`, before `pgCreateStudent`, resolves `parentId` from `formData.parentPhone` and includes it in the payload only when non-null. The edit branch is untouched (out of scope). An invalid/missing phone leaves `parent_id` unset exactly as before.
- `src/modules/admissions/AdmissionsPage.jsx` — same `findOrCreateParentId` helper (duplicated, not shared — matches this codebase's existing convention of duplicating small phone/parent-linking logic rather than factoring a shared util, e.g. `normalizeParentPhone` itself is already duplicated between `parentService.js` and `studentWhatsappService.js`). In `attendFirstLesson`, before calling `pgActivateAdmission`, resolves `parentId` from the admission's own `parentPhone` and includes it in the `student` object sent to the atomic activation endpoint.
- `backend/src/routes/admissionActivation.js` — `validateStudentInput` gains one additive, optional field: accepts `student.parentId`, converts it to `BigInt` (mirroring the existing `admissionPayments.js` conversion pattern for `materialId`), and includes it as `parent_id` in the `tx.students.create` data. No other line of the transaction's core logic (idempotency check, code generation, admission-state transition, system-log entries) was touched.
  - **One necessary addition beyond the plan's literal text**, found and fixed during implementation, not a scope expansion: `students.parent_id` is a `BigInt` column, and this route's response path (`snakeToCamel(result.student)`) never previously needed to serialize a `BigInt` value (`parent_id` was always `null` before this change). `JSON.stringify` throws on a raw `BigInt`, so the very first real activation with a resolved `parentId` would have crashed the response with a 500 after successfully writing the row. Added a local `serializeBigInt` helper (same duplicated pattern already used in `crud.js`/`admissionPayments.js` — no shared util in this project) and wrapped the student result in it. Covered by a dedicated test (see below) that asserts `JSON.stringify(result)` does not throw and that `parentId` round-trips as a string.

### Tests
- `src/modules/students/StudentsPage.test.jsx` — 3 new tests: find-or-creates a parent by normalized phone and includes `parentId` in the `pgCreateStudent` payload; re-resolves the existing parent id on a 409 phone conflict instead of failing; omits `parentId` entirely (no `pgCreateParent` call at all) when no parent phone is given. 5/5 passing (2 pre-existing delete-guard tests unaffected).
- `src/modules/admissions/AdmissionsPage.activation.test.jsx` — updated the existing "exactly ONE call" activation test to account for the new parent-link POST (now asserts 2 calls: the parent find-or-create, then the one atomic activation call — the atomic-activation guarantee itself is unchanged, only the total network-call count grew by the one new, deliberate step) and asserts `parentId` is threaded through correctly. Added 2 new tests: omits `parentId` when the admission has no parent phone (and makes no `/api/parents` call at all); re-resolves the existing parent id on a 409 conflict. 5/5 passing. A full run of all `src/modules/admissions/*.test.jsx` files (20 tests total) confirms no regression to the other admissions flows (core CRUD, payments).
- `backend/src/routes/admissionActivation.test.js` (**new file** — no backend test infrastructure existed in this project before this phase; see "Test infrastructure" below) — 6 tests, mocking the Prisma client entirely (no live DB touched): sets `parent_id` correctly when a valid `parentId` is provided; leaves it `null` when omitted; rejects a non-numeric `parentId` before touching the transaction; confirms the `BigInt` serialization fix (response is JSON-stringifiable, `parentId` comes back as a string); confirms the pre-existing idempotent-re-activation guarantee is unaffected; confirms the pre-existing inconsistent-state rejection is unaffected. 6/6 passing.

### Test infrastructure note (new, disclosed explicitly)
This project had **no backend test runner at all** before this phase (`backend/package.json` had no `vitest` devDependency, no test script; the root `vite.config.js`'s `test.include` is scoped to `src/**/*.test.{js,jsx}` only, frontend-only). The plan assumed `admissionActivation.js` was "tested by direct function import, confirmed pattern" — that assumption was incorrect; no such test ever existed. Rather than skip backend testing or write to the live database as a substitute for real unit tests, a minimal `backend/vitest.config.js` was added (Node environment, `src/**/*.test.js`, no plugins) and a `"test": "vitest run"` script was added to `backend/package.json` — reusing the vitest binary already installed at the repo root (no new dependency was installed; `npm run test` from `backend/` resolves it via ancestor `node_modules/.bin`, and `npx vitest run --root backend` works identically from the repo root). This is the smallest possible addition that let the plan's own required backend test actually exist, entirely isolated (mocks Prisma, never touches the live database).

### Database impact
No schema change (`parent_id`/`parents` were already real, pre-existing). No backfill of the 2 existing verification-artifact students, per instruction. Live read-only check after implementation: `parents.count() === 0`, `students.count(parent_id IS NOT NULL) === 0` — unchanged, since all testing was fully mocked and no real student/admission was created or activated against the live backend during this phase.

---

## Issue 4 — Notifications structurally dead

**Option A implemented, exactly per the user's approval wording** — which is slightly broader than the plan document's own example: the approval explicitly named *"overdue/due-today follow-ups, repeated no-answer parents, payment promises due"* as the signal set, so `todayFollowups` is included alongside `overdueFollowups`, `repeatedNoAnswer`, and `paymentPromisesDue`. `tomorrowFollowups` and `priorityTasks` are deliberately **not** included — outside the approved signal set.

### Changes
- **New file `src/services/notificationService.js`** — `deriveNotifications(reminders)`, a pure function (no React, no state) mapping `reminderService.js`'s existing `generateReminders()` output into the notification shape `NotificationsPage.jsx` already expects (`{id, type, title, body, time, read, urgent}`). `reminderService.js` itself was not modified — only its return value is read. Mapping: `overdueFollowups`/`todayFollowups`/`repeatedNoAnswer` → `type: 'system'`; `paymentPromisesDue` → `type: 'payment'`. Every derived item always defaults to `read: false` — this function has no notion of read state.
- `src/store/ui.context.jsx`:
  - `notifications` is no longer an independent `useState([])`. It now reads `communications`/`commTasks` directly from the Zustand store via `useAppStore` (no Provider/prop-threading needed — Zustand is reachable from any component), computes `reminders = generateReminders(communications, commTasks)`, then `derivedNotifs = deriveNotifications(reminders)`.
  - Read/dismissed state has nowhere to live on the underlying source records, so a small, purely local `readIds` `Set` is kept in `ui.context.jsx` state, persisted to `localStorage` under `tc_notif_read_ids` via the same `storage` helper already used for `tc_theme` (same category of local-only, non-business, per-browser state — not synced to Postgres, not shared across devices).
  - `markNotifRead(id)` adds one id to the set; `markAllNotifsRead()` adds every currently-derived id. The exposed `notifications` array is `derivedNotifs` with `read: true` overlaid wherever `readIds` has the id.
  - **Stale-state avoidance** (explicitly required by the plan): a `useEffect` prunes `readIds` down to only ids still present in the current `derivedNotifs` list every time reminders recompute — a read id for a reminder whose underlying condition has resolved (e.g. a follow-up got completed) is automatically dropped, not retained forever.
  - The dead `setNotifications` raw setter was removed from the exposed context value (it had zero real importers — confirmed by grep — the only reference was in `src/store/index.js`, an already-dead, zero-importer Phase-2→3 compatibility shim untouched by this phase) and would no longer make sense once `notifications` became a derived `useMemo` rather than independent state.
- `src/modules/notifications/NotificationsPage.jsx` — **unchanged**, exactly as the plan predicted. Its existing `TYPE_META`/filtering/mark-read UI already matched the derived shape.

### Tests
- New file `src/services/notificationService.test.js` — 8 pure-function tests: empty input → empty output; correct type/urgency/id for each of the four signal categories; confirms `tomorrowFollowups`/`priorityTasks` produce nothing (proving the narrower approved scope, not the plan's original broader example); stable, deterministic ids across recomputations (needed for read-state matching); multiple signal sources combine into one flat list. 8/8 passing.
- New file `src/modules/notifications/NotificationsPage.test.jsx` — 7 integration tests rendering the real page behind the real `UIProvider` with real Zustand store data (no mocking of `ui.context.jsx` or the store): honest empty state when there's nothing to report; real overdue/payment-promise/repeated-no-answer content renders correctly; mark-read on click works end-to-end and updates the unread count; mark-all-read clears every derived notification; **the stale-read-id pruning is verified directly** by marking one notification read, then removing its underlying source record from the store and confirming both the UI and the persisted `localStorage` read-id set correctly drop it. 7/7 passing.

### Database impact
None — purely a frontend derivation over already-real, already-boot-synced Zustand data, exactly as planned. The only new persisted state is a client-side `localStorage` key (`tc_notif_read_ids`), not sent to the server.

---

## Full verification run (this session, after all four issues)

- **Frontend test suite**: `npx vitest run` — **30 files, 205 tests, all passing.**
- **Backend test suite** (new infra, see Issue 3 above): `npm run test` (from `backend/`) — **1 file, 6 tests, all passing.**
- **Production build**: `npm run build` — succeeds, no errors, no new warnings beyond pre-existing ones.
- **Live, read-only database check** (run twice — after Issue 3, and again after Issue 4 — to confirm no drift):
  ```
  cashboxCount: 0, cashboxes: [], parentCount: 0, studentsWithParent: 0,
  studentCount: 2, admissionCount: 0
  ```
  Unchanged from the pre-implementation baseline. No schema was altered (no `ALTER TABLE`, no `db:pull`/`db:generate` re-run — none of the four issues required one, as anticipated). `students.count() === 2` reflects the two pre-existing verification-artifact rows from earlier phases, untouched.

---

## Files touched (complete list)

**Frontend — application code**
- `src/constants/nav.js`
- `src/layouts/components/NavIcon.jsx`
- `src/layouts/Sidebar.jsx`
- `src/modules/students/StudentsPage.jsx`
- `src/modules/admissions/AdmissionsPage.jsx`
- `src/modules/treasury/TreasuryPage.jsx`
- `src/store/ui.context.jsx`
- `src/services/notificationService.js` *(new)*

**Frontend — tests**
- `src/layouts/Sidebar.test.jsx` *(new)*
- `src/modules/students/StudentsPage.test.jsx` *(extended)*
- `src/modules/admissions/AdmissionsPage.activation.test.jsx` *(extended)*
- `src/modules/treasury/TreasuryPage.cashboxes.test.jsx` *(extended — call-count bookkeeping only)*
- `src/modules/treasury/TreasuryPage.treasuryTxn.test.jsx` *(extended — call-count bookkeeping only)*
- `src/modules/treasury/TreasuryPage.cashboxSync.test.jsx` *(new)*
- `src/services/notificationService.test.js` *(new)*
- `src/modules/notifications/NotificationsPage.test.jsx` *(new)*

**Backend**
- `backend/src/routes/admissionActivation.js`
- `backend/src/routes/admissionActivation.test.js` *(new)*
- `backend/vitest.config.js` *(new — test infra)*
- `backend/package.json` *(added `"test"` script only)*

**Not touched (confirmed by design and by re-grep during this audit):** Teachers domain; `src/modules/materials/*`, `parentExtras`/`CommunicationPage.jsx`'s own logic, `matDist`/`materialDistribution.js`, Identity/Auth (`auth.context.jsx` was read-only referenced, never edited); `backend/prisma/schema.prisma` (zero diff); `src/services/api.js` (zero diff — every function this phase needed already existed).

---

## Remaining gaps / honest limitations (not defects — in-scope boundaries)

- **Issue 2**: `cb_main` sync only runs when a user visits the Treasury page. A fresh install where the very first action is a payment attempt (without ever opening Treasury first) will still hit the pre-existing empty-state message once, exactly as today — this matches the approved design ("On `TreasuryPage.jsx` mount... the same page the existing error message already points users toward"), not a gap.
- **Issue 3**: Parent linking only succeeds when the phone normalizes to a valid Egyptian format (via the pre-existing, unmodified `normalizeParentPhone`). A non-Egyptian or malformed number silently leaves `parent_id` `NULL` — this is `normalizeParentPhone`'s existing, already-approved behavior from Phase 3B-16, not new.
- **Issue 4**: `absence`, `exam`, and `announcement` notification categories remain structurally empty (no source is wired to them) — honest per the approved narrow Option A scope, not broken (nothing currently claims otherwise in the UI; the filter dropdown simply has no matching items for those types yet). Read state is per-browser (`localStorage`), not synced across devices — matches the plan's explicit `tc_theme`-style design choice.
- **Test-only surface**: `TreasuryPage.jsx` exports one test-only function, `__resetCashboxSyncGuardForTests`, required because the sync guard is intentionally module-level (not component state) so it survives real remounts within a session — this is inert in production (never imported outside test files).

No other gaps identified. All four issues are complete, tested, and ready for real-world use.
