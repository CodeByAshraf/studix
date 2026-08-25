# Product Completion — Phase 1 Implementation Plan

**Status: READ-ONLY.** No code, schema, database, or localStorage was modified to produce this report. Nothing here is authorized or implemented. This is a separate track from the now-closed local-persistence migration program — none of it is reopened here except as read-only evidence. Teachers is not touched. Each of the four issues below is treated as an independent, separately-implementable fix, not one refactor.

---

## Issue 1 — Communication/CRM and Inventory unreachable from the sidebar

### Problem
Both `CommunicationPage.jsx` and `InventoryPage.jsx` are fully built, working, and (for Communication) extensively tested, but neither appears in the sidebar navigation. A user has no discoverable path to either page through normal use.

### Evidence (re-read fresh this session)
- `src/layouts/Sidebar.jsx:7` and `Topbar.jsx:4` import `NAV_ITEMS`/`NAV_SECTIONS` from `src/constants/nav.js` — this is the actual, live navigation source.
- `nav.js`'s `NAV_ITEMS` array does not contain `ROUTES.COMMUNICATION` or `ROUTES.INVENTORY`.
- `src/App.jsx:47,83,197` (Communication) and `:46,82,196` (Inventory) register real, working, lazy-loaded routes for both — `<ProtectedRoute pageId="students">` for Communication, `<ProtectedRoute pageId="materials">` for Inventory.
- A project-wide search found zero other in-app links to either route.
- **A second, non-obvious defect that would make a naive fix silently fail**: `Sidebar.jsx:27-30`'s `canSeeItem` computes the permission key to check as `item.id === 'student-report' ? 'students' : item.id` — i.e., it uses the nav item's own `id` (which equals the route string, e.g. `'communication'`/`'inventory'`) directly as the permission key, with exactly one existing special case. `auth.context.jsx:78-81`'s `canAccess(pageId)` does a literal `currentUser.permissions.includes(pageId)` check against the real permission array the server returned at login — and confirmed via `backend/src/server.js`'s `COLLECTION_PERMISSIONS`/route guards that **no permission key named `'communication'` or `'inventory'` exists anywhere in the system** (the real keys are `'students'` and `'materials'`, matching the `ProtectedRoute pageId` values above). Adding nav entries with `id: 'communication'`/`id: 'inventory'` without also extending `canSeeItem`'s special-case mapping would make both items invisible to every user, including admin — a fix that looks complete but does nothing.

### Proposed Solution
1. Add two entries to `NAV_ITEMS` in `src/constants/nav.js`: one for `ROUTES.COMMUNICATION` (suggested section: `'العمليات'`, alongside Admissions/Students/Groups/Attendance, since it's a daily front-office activity) and one for `ROUTES.INVENTORY` (suggested section: `'الأكاديمي'`, immediately adjacent to Materials, since both are now unified on the same backend table).
2. Extend `Sidebar.jsx`'s `canSeeItem` to map `'communication'` → `'students'` and `'inventory'` → `'materials'`, exactly mirroring the existing `'student-report'` → `'students'` special case (same function, same pattern, two more branches).
3. Icons: `NavIcon.jsx` returns `null` (a safe, non-crashing blank) for any unmapped name, so this is not a hard blocker — but two `NAV_ITEMS` entries with blank icons would look unfinished. Smallest options, in order of preference: (a) reuse an existing icon key that fits reasonably (e.g., `'staff'` for Communication, `'materials'` for Inventory — though sharing an icon with an adjacent item is visually ambiguous), or (b) add two new icon path entries to `NavIcon.jsx`'s `PATHS` object (a pure data addition — an SVG path string, zero logic, zero risk to anything else). Recommend (b) as the more polished, still-minimal option.

### Exact Files
- `src/constants/nav.js` — add 2 `NAV_ITEMS` entries.
- `src/layouts/Sidebar.jsx` — extend `canSeeItem`'s special-case mapping (2 lines).
- `src/layouts/components/NavIcon.jsx` — optionally add 2 icon path entries (no existing entries touched).

### Backend/Schema Impact
None. This is a pure frontend navigation-data change.

### Tests Required
No dedicated test file exists for `Sidebar.jsx`/`nav.js` today (confirmed by search). A minimal new test would render `Sidebar` (or just call `canSeeItem`/inspect `NAV_ITEMS` directly, whichever is more idiomatic here) with a mock `currentUser.permissions` array containing `'students'`/`'materials'` and assert the two new items are visible; and with a permissions array lacking them, assert they're hidden — proving the permission-key mapping fix actually works, not just that the items were added.

### Regression Risks
Very low. `NAV_ITEMS` is additive-only (existing entries untouched). `canSeeItem`'s new branches only affect the two new item ids — every other item's permission check is unchanged. The one real risk is the exact failure mode already identified (forgetting the `canSeeItem` mapping) — the required test directly guards against it.

### Verification Procedure
1. Full test suite + build.
2. Manually confirm (via the running app, if run is available in review) that both items appear in the sidebar for an admin user and navigate correctly.
3. Confirm a role without `'students'`/`'materials'` permissions does not see the corresponding item (matches every other nav item's existing behavior).

### Rollback
Trivial — revert the 2-3 small, additive edits. No data, schema, or persisted state involved.

---

## Issue 2 — Fresh installation cannot record its first payment

### Problem
A brand-new install has zero real cashboxes in Postgres, but the local Zustand seed `cb_main` (`active: true`, `isDefault: true`) makes `PaymentForm.jsx` behave as if a valid cashbox already exists — so the payment form's own, already-correct empty-state error message never fires. The user instead fills out an entire payment form and only then gets a late, generic "cashbox not found or inactive" failure from the server.

### Evidence (re-read fresh this session)
- `src/data/initialData.js:125-136` — `INITIAL_CASHBOXES` seeds exactly one local cashbox, `cb_main`, `active: true`.
- `src/store/slices/treasury.slice.js:12` — `cashboxes: INITIAL_CASHBOXES` — this seed is the actual initial store state on every fresh load.
- `src/modules/payments/PaymentForm.jsx:72,144-148` — `activeCashboxes = cashboxes.filter(cb => cb.active)`; the explicit, already-written failure message (*"لا توجد خزنة نشطة لتسجيل الدفعة. أنشئ خزنة من صفحة الخزنة أولاً"*) only renders `if (activeCashboxes.length === 0)` — which is false on a fresh install because `cb_main` is present and `active`.
- `backend/src/routes/payments.js:107-108` — the real, atomic payment-creation transaction does `tx.cashboxes.findUnique({ where: { id: cashboxId } })` and rejects if not found/inactive — `cb_main` was never created server-side, so any payment attempt against it fails here, late, after the whole form was filled.
- **The original design intent, found directly in a code comment, not inferred**: `src/services/api.js:152-158`, the Phase 3B-14A header comment, states cashboxes are deliberately in `PRESERVE_CLIENT_ID_COLLECTIONS` "خاصة cb_main المزروعة محلياً" — *"especially for cb_main planted locally"* — meaning the original design explicitly anticipated `cb_main` being POSTed to the server with its exact id preserved. This sync step was apparently never built. The comment also confirms `pgDeleteCashbox` does not exist by deliberate design (deletion is blocked server-side) — irrelevant to this fix, noted only so it isn't mistaken for a gap.
- `backend/src/middleware/errorHandler.js:9-10` — a Prisma `P2002` (unique/PK conflict) already maps to a clean `409` — confirmed this session — so a "try to create `cb_main`, ignore if it already exists" pattern is safe and already the established idiom elsewhere in this codebase (materials' code-conflict retry, `parentExtras`' phone-conflict retry).

### Proposed Solution — DECISION NEEDED

Two evidence-backed options, not silently resolved:

**Option A (recommended) — complete the already-documented original intent: sync the local seed cashbox to Postgres automatically, once.** On `TreasuryPage.jsx` mount (the same page the existing error message already points users toward), attempt `pgCreateCashbox({ id: 'cb_main', ...fields })`; if it fails with a conflict (already exists — e.g. a second browser already created it, or a prior sync succeeded), silently treat as success; on any other error, fail silently and let the existing empty-state message still be the fallback (do not surface a new error for this background step). Once this succeeds, `cb_main` becomes a genuinely real, usable cashbox with zero further user action required — the "Main Cashbox" the UI already shows them simply starts working. Smallest change in user-facing behavior; most faithful to the evidence of original intent.

**Option B — remove the misleading local seed and make the existing message actionable.** Empty `INITIAL_CASHBOXES` to `[]` so the already-correct "no active cashbox" message fires immediately and honestly on a fresh install (no phantom cashbox ever shown), and add a real navigation button/link inside that message pointing directly at Treasury's "add cashbox" flow (currently just informational text). This is more explicit — every install gets a cashbox the user deliberately named and configured — but is a bigger behavior change (removes something currently shown, even if it's non-functional) and requires the user to take a manual step before their very first payment, every time, on every fresh install.

This report recommends Option A but does not implement either without your confirmation.

### Exact Files
- Option A: `src/modules/treasury/TreasuryPage.jsx` (add a one-time sync-on-mount effect), `src/services/api.js` (no new function needed — `pgCreateCashbox` already exists and already accepts a client-supplied id for this collection).
- Option B: `src/data/initialData.js` (empty the seed array), `src/modules/payments/PaymentForm.jsx` (add a navigation link/button to the existing message).

### Backend/Schema Impact
None either way. `pgCreateCashbox`/the generic `cashboxes` CRUD route already exist and already support this exact use (client-id preservation was built for it).

### Tests Required
- Option A: a new test asserting that on `TreasuryPage` mount with no real cashboxes, `pgCreateCashbox` is called once with `cb_main`'s exact seed data; that a 409 response is treated as success (no error surfaced, no duplicate attempt); and that once synced, `PaymentForm.jsx`'s cashbox dropdown/submit behavior is unaffected (still requires an explicit, real, server-confirmed cashbox — no change to `payments.js`'s own validation).
- Option B: an update to `PaymentForm.jsx`'s existing "no active cashbox" test (if one exists — needs confirming at implementation time) to assert `activeCashboxes.length === 0` on a fresh seed, and a new assertion that the message's link navigates to Treasury.

### Regression Risks
- Option A: the sync call must not block or interfere with `TreasuryPage.jsx`'s existing, already-tested cashbox CRUD flows (`pgCreateCashbox`/`pgUpdateCashbox` for user-created cashboxes) — it must run once, early, and never re-fire on every render (needs a mount-only effect with a guard, not a naive `useEffect` with no dependency safety). Must not surface a confusing error to the user if the sync itself fails for an unrelated reason (network) — the existing empty-state message is the correct fallback in that case.
- Option B: removes a piece of default local data every current install already has — low risk given it's already known to be non-functional server-side, but is a more visible behavior change than Option A.

### Verification Procedure
1. Full test suite + build.
2. A live, read-only-preserving check: confirm `cashboxes.count()` in Postgres before and after a simulated fresh-install boot (Option A) — should go from 0 to 1, with `id='cb_main'`. (This check is deferred to implementation-time verification, not run in this planning pass, since it requires the fix to exist first.)
3. Confirm a payment can be recorded end-to-end against the now-real `cb_main` without any manual cashbox-creation step (Option A) or after the one guided step (Option B).

### Rollback
Option A: revert the `TreasuryPage.jsx` effect; the one real `cb_main` row created in Postgres during testing would need a manual, explicit decision to remove (cashboxes cannot be deleted via the API by design — noted above) — **this is the one part of this whole plan with a real, non-trivial rollback cost**, worth flagging explicitly before implementation. Option B: revert the seed-array and message-link changes; no server-side state is ever created, so rollback is trivial.

---

## Issue 3 — `students.parent_id` is never populated

### Problem
`students.parent_id` is a real, pre-existing, nullable FK to `parents.id`. Neither of the two student-creation paths (`StudentsPage.jsx` direct creation, or admission activation) ever sets it — both only ever set the separate, plain-text `students.parent_phone` column. The just-closed `parentExtras`/Phase 3B-16 work made `parents` a real, fully-writable table with exactly this kind of find-or-create-by-phone matching already built and tested — but nothing wires a `Student` to a `parents` row.

### Evidence (re-read fresh this session)
- `backend/prisma/schema.prisma` — `students.parent_id BigInt?`, `students.parent_phone String?` (two separate, independent columns — confirmed both exist).
- `src/modules/students/StudentForm.jsx:11,93,125-127` — collects `parentPhone` as free text only; no parent-linking of any kind.
- `src/modules/students/StudentsPage.jsx:11,72` — `handleSave` calls `pgCreateStudent(ns)` directly; `ns` has no `parentId`.
- `backend/src/routes/admissionActivation.js:54-68,96-98` — `validateStudentInput` builds `parent_phone` from the input but never `parent_id`; `tx.students.create({ data: { id, code, ...studentData } })` — confirmed no `parent_id` key present, so it's always `NULL`.
- **Direct reuse opportunity, not a new pattern**: `src/modules/communication/parentService.js`'s `normalizeParentPhone` (added in Phase 3B-16) and `src/services/api.js`'s `pgCreateParent`/`pgUpdateParent` (also Phase 3B-16) already implement exactly the "find-or-create a real `parents` row by normalized phone" logic this fix needs — confirmed by re-reading both this session. `pgCreateStudent`/`pgUpdateStudent` (`api.js:68-79`) send whatever object they're given as-is with no field-filtering — so a caller including `parentId` in that object is automatically mapped to the real `parent_id` column by the existing generic CRUD's `camelToSnake` conversion, with **no change needed to `api.js` or the students CRUD route at all**.

### Proposed Solution
Add a small, additive step — reusing existing, already-tested infrastructure — at each of the two creation points, without touching `CommunicationPage.jsx`/`parentExtras` itself (which stays closed, per instruction):

1. **`StudentsPage.jsx`'s direct-creation path**: before calling `pgCreateStudent`, if `formData.parentPhone` normalizes successfully (`normalizeParentPhone`), find-or-create the matching `parents` row (mirroring the exact find-or-create-with-409-retry pattern `CommunicationPage.jsx`'s own `handleSaveParent` already uses — read, not copied verbatim, to avoid touching that file), and include `parentId: parent.id` in the object passed to `pgCreateStudent`. If the phone doesn't normalize, proceed exactly as today (`parent_id` stays `NULL`) — no new required field, no blocking behavior added.
2. **Admission activation**: the same find-or-create-by-phone step happens **client-side**, in `AdmissionsPage.jsx`'s activation handler, *before* calling `PUT /api/admissions/:id/activate` — using the admission's own phone field. The resolved `parent.id` is included as `parentId` in the `student` object already sent to that endpoint. `admissionActivation.js`'s `validateStudentInput` (backend) needs exactly one small, additive change: accept an optional `student.parentId`, convert it to `BigInt` (mirroring the existing `parseIdParam`-style conversion already used elsewhere for this exact table's BigInt id), and include `parent_id` in the `tx.students.create` data. **No change to the transaction's core logic** (idempotency, code generation, admission-state transition, system-log entries) — a new optional field on an existing create call, nothing else in the file touched.

### Exact Files
- `src/modules/students/StudentsPage.jsx` — add the find-or-create step before `pgCreateStudent`.
- `src/modules/admissions/AdmissionsPage.jsx` — add the same step before calling admission activation.
- `backend/src/routes/admissionActivation.js` — `validateStudentInput` gains one optional field (`parent_id`, `BigInt`-converted); `tx.students.create`'s data object includes it when present. No other line in this file changes.
- No change to `src/services/api.js` (existing `pgCreateStudent`/`pgCreateParent`/`pgUpdateParent` are reused as-is) or to `parentService.js` (its `normalizeParentPhone` is imported/reused, not modified).

### Backend/Schema Impact
No schema change — `parent_id` already exists on `students`. One backend route (`admissionActivation.js`) gets a small, additive, optional-field change. The generic `students` CRUD route needs no change at all (confirmed above).

### Tests Required
- `StudentsPage.jsx`: a new test (or an addition to the existing thin test file) asserting that creating a student with a valid parent phone results in a find-or-create call sequence and a `parentId` included in the `pgCreateStudent` payload; and that an invalid/missing phone leaves `parent_id` unset exactly as today (no regression to the existing, already-passing create flow).
- `AdmissionsPage.jsx`: same shape of test for the activation call, asserting `parentId` is included in the `student` object sent to `PUT /api/admissions/:id/activate` when the admission has a valid phone.
- `admissionActivation.js`: since this file is tested by direct function import (confirmed pattern — `activateAdmission` is exported separately for exactly this reason, per its own file comment), a new test asserting `parent_id` is correctly set when `parentId` is provided, correctly `NULL` when it's not, and that the existing idempotency/re-activation/error-path tests are unaffected.

### Regression Risks
- The extra find-or-create step is a new network round-trip before student/activation creation — must not silently swallow a real failure (e.g., if `pgCreateParent` fails for a reason other than the expected phone-conflict, the student-creation flow should surface that error clearly, not proceed with a half-broken state) — mirrors the same error-handling discipline already used in `CommunicationPage.jsx`'s own version of this logic.
- Must not change `admissionActivation.js`'s idempotency guarantee — re-activating an already-active admission must still short-circuit before reaching the student-creation branch, unaffected by the new optional field.
- Does not touch or attempt to backfill any existing student's `parent_id` — per instruction, no data migration, and live data (2 verification-artifact students) has nothing meaningful to backfill regardless.

### Verification Procedure
1. Full test suite + build.
2. Live, read-only confirmation that `students.parent_id`/`parents` schema is unchanged (no migration was needed or performed).
3. Manual/test-driven confirmation that creating a student (either path) with a real phone number results in a real, matched-or-created `parents` row and a populated `parent_id` — and that omitting a phone still succeeds exactly as today.

### Rollback
Straightforward — revert the frontend additions and the one backend field addition. No schema to unwind. Any `parents` rows created during real usage before a rollback would remain (harmless, real data, not something to clean up).

---

## Issue 4 — Notifications is structurally dead

### Problem
`NotificationsPage.jsx` is a fully-built UI (type/read filters, mark-read, mark-all-read, urgent badges) backed by `ui.context.jsx`'s `notifications` state, seeded from `INITIAL_NOTIFICATIONS = []`. Confirmed independently this session: every `setNotifications` call site (`ui.context.jsx:71,75`) only transforms *existing* items — nothing anywhere in the app ever adds one. The page cannot ever show real content on any install.

### Evidence (re-read fresh this session)
- `src/store/ui.context.jsx:24,70-76` — `notifications` is a plain `useState`, no persistence, no boot-sync, no producer.
- `src/modules/notifications/NotificationsPage.jsx:8-14` — the page's own `TYPE_META` defines exactly 5 categories: `absence`, `payment`, `exam`, `announcement`, `system`, and expects each item to carry `{id, type, title, body, time, read, urgent}`.
- `src/modules/communication/reminderService.js:19-59` — `generateReminders(records, tasks)` already computes real, meaningful, already-tested signals purely from existing data: overdue/due-today/tomorrow follow-ups, 3+ repeated-no-answer parents, payment-promises-due-today. This is the closest, most directly reusable real source — already used by `CommunicationPage.jsx`'s own `ReminderCenter` component, so its correctness is already indirectly exercised.
- No other module currently computes a similarly ready-made "here's something requiring attention" signal in one place — attendance absences and unpaid-student lists exist as raw data but are not currently pre-aggregated into a single reusable "needs attention" shape anywhere.

### Proposed Solution — DECISION NEEDED (which real signal source(s) count as "a notification" for this first fix)

**Option A (recommended, narrowest) — derive Notifications entirely from `reminderService.js`'s already-computed output**, as a pure read-only mapping (no new write path, no new persisted state — same "derive, don't duplicate" architecture already proven for `matDist`). Map `overdueFollowups`/`repeatedNoAnswer` → `type:'system'` (or a precise variant), `paymentPromisesDue` → `type:'payment'`. This alone makes the page genuinely non-empty and genuinely real on any install with active communication records, using zero new business logic — it only reads what `reminderService.js` already, correctly computes. It does **not** populate the `absence`/`exam`/`announcement` categories — those remain empty filter options, which is honest (nothing currently claims otherwise) rather than broken.

**Option B (broader, still zero new persistence, larger file footprint)** — additionally derive `type:'absence'` entries from pending `absence_followup` records and/or `type:'payment'` entries from the existing unpaid-students computation already used by `PaymentsPage.jsx`'s "Unpaid" view. Covers more of the page's designed categories; touches more files; still no new backend/schema work, since all source data is already real and already boot-synced.

**Option C (explicitly not recommended, named only to rule it out)** — a general-purpose "any module can push a notification" event system. This would be new architecture, not a fix to an existing gap, and is explicitly out of scope per "do not add new features beyond what is necessary."

**A real design wrinkle that must be decided alongside the source question**: because these notifications would be *derived*, not independently stored, "read" state has nowhere to live today — the underlying source records (`communications`, `commTasks`, etc.) have no `read`/`dismissed` concept. Recommended: keep a small, purely local (not PostgreSQL, not business data — akin to `tc_theme`) set of dismissed/read derived-notification-ids in `ui.context.jsx`, layered over the live-recomputed list, so the already-built and already-tested `markNotifRead`/`markAllNotifsRead` UX keeps working without requiring any new persistence layer or schema.

This report recommends Option A, with the local read-state layer described above, but does not implement any option without your confirmation on both the source-scope question and the read-state approach.

### Exact Files
- `src/store/ui.context.jsx` — replace the raw `useState([])` for `notifications` with a derivation (`useMemo`) over `reminderService.js`'s output (Option A) plus a small local read/dismissed-id tracking layer; `markNotifRead`/`markAllNotifsRead` updated to write to that tracking layer instead of mutating a plain array.
- Likely also needs read access to `state.communications`/`state.commTasks` (already boot-synced, already used elsewhere) from wherever `UIProvider` is composed — needs confirming the exact prop-threading or store-access pattern at implementation time, since `ui.context.jsx` is a separate context from the Zustand store today.
- `src/modules/notifications/NotificationsPage.jsx` — likely no change needed if the derived shape matches `TYPE_META`'s existing expectations exactly (to be confirmed once the exact mapping is written).
- Option B would additionally touch wherever the unpaid-students/absence-followup computations already live (to be identified precisely at implementation time, not guessed here).

### Backend/Schema Impact
None. Purely a frontend derivation over already-real, already-boot-synced data (same category of change as the `matDist` migration).

### Tests Required
- A new test file for the notification-derivation function itself (pure-function, mirroring the `deriveMatDist`/`bookletDeliveries` test pattern already established this session): correct mapping from `reminderService.js`'s reminder shapes to notification shapes; correct type assignment; correct `read` state layering (marking one read doesn't affect others; marking all read works; a freshly-derived item defaults to unread).
- A light test confirming `NotificationsPage.jsx` renders real derived content when the underlying store has real overdue/no-answer/payment-promise records, and still renders the existing honest empty state when it doesn't.

### Regression Risks
- Must not change `reminderService.js` itself (it's already correct and already used by `CommunicationPage.jsx` — any change there risks that already-working, already-tested feature) — this fix should only ever *read* its output, never modify it.
- The local read-state layer must not grow unbounded (old, resolved reminders should naturally drop out of the derived list once their underlying condition resolves — e.g., a follow-up is completed — so stale read-ids should be pruned or simply become harmless no-ops, not accumulate forever).
- `ui.context.jsx` currently has no dependency on Zustand store data at all — introducing one is a small architectural touch that should be scoped narrowly (read-only selector, not a new coupling of concerns) to avoid destabilizing an otherwise-simple context.

### Verification Procedure
1. Full test suite + build.
2. Manual/test confirmation that a store with real overdue-followup/no-answer/payment-promise data produces real, correctly-typed, correctly-titled notifications on the page.
3. Confirm mark-read/mark-all-read still work exactly as today from the user's perspective.

### Rollback
Straightforward — revert to the plain `useState([])` array. No persisted state (local or remote) is introduced by Option A, so rollback leaves nothing behind.

---

## Overall Implementation Order (across all four issues)

Recommended sequence, from lowest-risk/highest-clarity to highest-complexity, so each fix can be verified in isolation before the next begins:

1. **Issue 1** (navigation) — smallest, purely additive, zero backend/schema involvement, immediately testable and visible.
2. **Issue 3** (`students.parent_id`) — reuses already-tested Phase 3B-16 infrastructure directly; the backend touch is a single small additive field on one route.
3. **Issue 2** (cashbox bootstrap) — depends on your Option A/B decision; Option A has the one non-trivial rollback consideration in this whole plan (a real cashbox row, once created, cannot be deleted by design) and should be implemented and verified carefully, ideally after the smaller issues build confidence in the current session's rhythm.
4. **Issue 4** (Notifications) — the largest-scoped of the four (a genuine, if narrow, new derivation layer plus a UI-state design decision) — recommended last so the source-scope decision can be made with the fullest picture of the session's remaining time/risk appetite.

Each issue remains independently revertible and independently shippable — this order is a suggestion for sequencing within one session, not a dependency chain (only Issue 3's two call sites depend on each other internally; the four issues themselves are fully independent of one another).

---

## Cross-Cutting Notes

- None of these four fixes touch Teachers, reopen Materials/`parentExtras`/`matDist`/Identity-Auth, or implement `admissionSystemLog`/`wa_report_log` hardening — confirmed by file-scope review above; every file listed is either new to this plan or was already identified as in-scope for exactly this issue in the prior product-readiness audit.
- Two DECISION NEEDED points remain open (Issue 2's Option A vs. B; Issue 4's source-scope and read-state approach) — implementation of those two issues should not begin until you've resolved them, exactly as with every prior phase in this engagement.

---

**No code, schema, database, or localStorage was modified to produce this report. Stopping here — waiting for your review and approval before any implementation begins.**
