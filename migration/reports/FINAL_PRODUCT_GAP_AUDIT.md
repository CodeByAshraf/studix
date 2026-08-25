# Final Product Gap Audit

Read-only audit. Nothing was modified — no code, schema, database, or localStorage changes were made in producing this report. Product Completion Phase 1 (Navigation, students.parent_id, Cashbox bootstrap, Notifications) and the prior closed migration domains (Materials, parentExtras, matDist, Identity/Auth) were treated as closed and re-verified only for regressions, not re-audited from scratch. Teachers remains explicitly deferred — no evidence found that this standing decision has changed.

Methodology: six parallel read-only investigations covering all twelve requested areas, cross-checked against `migration/reports/*.md` for existing decisions/deferrals, plus a direct full test-suite run, backend test run, and production build performed by the coordinator.

---

## Verdict

**3 — Not production-ready: one specific blocker remains.**

The blocking issue (Finding 1 below) is narrow and isolated — a single feature, "transfer student between groups," is wired into the UI, looks and behaves like it works, but never reaches the server and silently reverts on the next sync. Every other core workflow a real center depends on daily (login, admissions→activation, student CRUD, groups, attendance, exams, homework, payments, treasury, communications, inventory, reports, notifications) was independently traced this session and found to be genuinely real, Postgres-persisted, and working. Once Finding 1 is fixed, this product is realistically at **verdict 2 (production-ready with known limitations)** — the remaining HIGH items are a documentation problem and two dead-but-unreachable code landmines, not live defects in reachable functionality.

---

## Test/build health

- **Frontend test suite**: `npx vitest run` → **30 files, 205 tests, all passing.**
- **Backend test suite**: `npm run test` (from `backend/`) → **1 file, 6 tests, all passing.**
- **Production build**: `npm run build` → succeeds, no errors.

**Weakly-tested critical areas (finding, not a defect):**
- Backend transaction logic — `payments.js` (atomic create + immutable + locked refund), `treasuryTxn.js` (locked reversal/transfer), `admissionPayments.js`, `attendanceSessions.js`, `examGrades.js`, `hwSubmissions.js`, `materialDistribution.js` — has **zero direct backend unit tests**. The only backend test file in the whole project is the one added in Phase 1 for `admissionActivation.js`. Everything else is only indirectly exercised by frontend tests that mock `fetch` and assert on request/response *shapes* — real Prisma transaction behavior (locking, atomicity, cascade rules) is never actually executed in CI. This is a real risk concentration: it's exactly the code most responsible for financial correctness and data integrity, and it's the least covered.
- Frontend modules with **zero** test files: `activity-log`, `id-cards`, `reports`, `users`. `ReportsPage.jsx`/`SettingsPage.jsx`/`UsersPage.jsx` were confirmed correct by code inspection this session, but none of that correctness is regression-guarded.
- Severity: **C (MEDIUM)** as a standalone finding — not blocking, but worth prioritizing before the next round of financial/backend changes.

---

## Findings — summary table

| # | Finding | Area | Severity | Persistence? | Deferred? | Next-phase? |
|---|---|---|---|---|---|---|
| 1 | Group transfer is fake — no server call, silently reverts | Groups | **A BLOCKER** | yes | no | yes — fix now |
| 2 | READMEs describe an obsolete architecture; fake default credentials; real setup step undocumented | Docs/Ops | **B HIGH** | no | no | yes (docs pass) |
| 3 | Follow-up tasks/communications can never be marked done — dead update actions, one dashboard stat stuck at 0 | Communication/CRM | **B HIGH** | yes (missing write path) | no | yes |
| 4 | Dead local-only financial write code left behind by prior migrations (`usePayments.js`, `reverseTreasuryTxn`/`transferBetweenCashboxes`), one stale/misleading comment | Payments/Treasury | **B HIGH** (as a landmine; zero live impact today) | yes (if ever wired up) | no | no — cleanup only |
| 5 | Weak backend test coverage for transactional/financial logic | Test health | **C MEDIUM** | n/a | no | consider before next financial-code phase |
| 6 | Financial reports ignore year in several places (month-only filters) | Reports | **C MEDIUM** | no (read bug) | no | maybe |
| 7 | Student/Group delete-guard pre-checks incomplete (server safely backstops; confusing error message) | Students/Groups | **C MEDIUM** | no | no | maybe |
| 8 | Cashbox cannot be deactivated/reactivated via UI | Treasury | **C MEDIUM** | yes | no | maybe |
| 9 | Communications linked by free-text name, not real FK, despite schema support | Communication/CRM | **C MEDIUM** | yes | no | maybe |
| 10 | `students.parent_id` (Phase 1) is written but never read/displayed anywhere | Students | **C MEDIUM** | yes (write side only) | implicit (out of Phase 1 scope) | maybe |
| 11 | No duplicate-phone prevention on admissions; student dedup is client-side only | Admissions/Students | **D LOW** | yes (schema gap) | no | no |
| 12 | `UsersPage.jsx` Users tab has no empty-state message (Teachers tab does) | Users | **D LOW** | no | no | no |
| 13 | Secondary activity-log write failures show a user-facing error toast even when the primary action succeeded | Product-wide | **D LOW** | no | no (appears deliberate/uniform) | no |
| 14 | Dead code: plaintext `admin`/`admin123` still present in `initialData.js` | Security hygiene | **D LOW** | no (unreachable) | no | no — delete |
| 15 | Dead `NAV_SECTIONS` export in `routes.js` | Navigation | **D LOW** | no | no | no |
| 16 | Dead `INITIAL_ROLES`/`INITIAL_USERS`/`INITIAL_USERS_V2`/`INITIAL_MAT_DIST` constants | Data hygiene | **D LOW** | no | no | no |
| 17 | Cosmetic duplicate notification for one record (today + payment-promise) | Notifications | **D LOW** | no | implicit (observed & accepted in Phase 1 testing) | no |
| 18 | `centerProfile` redundant dual-storage (raw localStorage key + Zustand persist) | Settings | **D LOW** | no (both always in sync) | no | no |
| — | Teachers domain remains fully local-only | Users | **E DEFERRED** | — | yes, standing decision, confirmed unchanged | no |
| — | `materials.slice.js` dead state (`materials`/`addMaterial`/etc.) | Materials | **E DEFERRED** | — | yes, `MATERIALS_DOMAIN_DECISION_AUDIT.md` Decision #10/#11 | no |
| — | `treasuryMeta` legacy-compat local state | Treasury | **E DEFERRED** | — | yes, pre-existing, documented "legacy compat" | no |

---

## A — BLOCKER

### Finding 1: "Transfer students between groups" is entirely fake — no network call, silently reverts on next sync

**Evidence**: `src/modules/groups/GroupStudents.jsx:111-123`, `handleTransfer`:
```js
const handleTransfer = async () => {
  ...
  setLoading(true);
  await new Promise(r => setTimeout(r, 400));   // fake delay, no fetch/pgUpdateStudent call
  setStudents(prev => prev.map(s =>
    selected.includes(s.id) ? { ...s, groupId: targetGroup, updatedAt: new Date().toISOString() } : s
  ));
  toast.success(`تم نقل ${selected.length} طالب إلى "${targetName}" ✓`);
```
This is the app's only transfer mechanism, wired from `GroupsPage.jsx:347-349` via `TransferModal`. It shows a real loading spinner, a fake 400ms delay, and a real success toast — but never calls `pgUpdateStudent` or any endpoint. It mutates local Zustand state directly.

**Affected files/modules**: `src/modules/groups/GroupStudents.jsx`, reachable from `src/modules/groups/GroupsPage.jsx`.

**User impact**: A secretary transfers one or more students to a different group; the UI confirms success convincingly (spinner, delay, success toast — nothing about it looks broken). On the next boot-sync (reload, or any other browser/session), `mergeById`'s "server wins on id collision" rule silently reverts every transferred student's `groupId` back to whatever Postgres actually has — the transfer is completely lost with no error, no warning, ever. This is actively deceptive, not just incomplete: staff will believe transfers happened when they did not, and attendance/exam/payment data already recorded after the "transfer" will remain attributed to the old group in reports.

**Persistence involved**: Yes — `students.group_id` is a real, already-writable column; `pgUpdateStudent` already exists and is used correctly elsewhere (`StudentsPage.jsx`). This is a pure implementation oversight, not a missing backend capability.

**Existing decision/deferment**: None found in any prior audit — appears to have been missed entirely, likely because the fake `await`/spinner/toast sequence looks superficially like a working async flow on inspection.

**Recommended next action**: Replace the fake local mutation with real `pgUpdateStudent` calls per transferred student (or a small dedicated bulk-transfer endpoint), server-truth-first, matching the pattern already used throughout this codebase. This should be fixed before the product is used for real, ongoing group management.

**Next-phase candidate**: Yes — small, well-isolated, high-value fix. Recommend this be the very next piece of work, ahead of any new-feature phase.

---

## B — HIGH

### Finding 2: Both README files describe an obsolete architecture and would actively block or mislead a fresh deployment

**Evidence**:
- Root `README.md` describes SQL Server + SSMS setup, references a `database/schema.sql`/`seed.sql` that does not exist in this repo, a `server/` backend folder (the real backend is `backend/`, Express+Prisma+PostgreSQL), wrong ports/env vars, and a "بيانات الدخول" (login credentials) table listing `admin`/`admin123`, `sec01`/`sec123`, and three teacher accounts — **none of which exist or work** against the real backend. No default admin account is ever created (by explicit design, confirmed in `migration/reports/STABILIZATION_AUTH_IDENTITY_IMPLEMENTATION.md`).
- `backend/README.md` is frozen at "Phase 0 — Infrastructure Only," explicitly states no table is wired to a real endpoint yet and that `json-server` is still in use — both false today (dozens of real Postgres-backed routes exist; confirmed `json-server`/`db.json` are entirely gone from the repo).
- The one real, required manual step to make a fresh install usable at all — `npm run admin:create` (`backend/scripts/adminCreate.js`, confirmed well-built: interactive, masked password input, refuses to silently overwrite an existing admin, no baked-in default credentials) — is **not documented anywhere**.

**Affected files/modules**: `README.md`, `backend/README.md`. No application code affected.

**User impact**: Anyone (a new developer, a future maintainer, or someone standing up a second/test instance) following either README would be completely blocked — they'd try credentials that don't exist, look for a database setup process that doesn't apply, and have no discoverable path to actually create the first login-capable user. This is the one concrete piece of the "fresh-install experience" that genuinely fails today, once you get past the application code itself (which was independently traced and found to have no other hidden fresh-install traps beyond the two Phase 1 already fixed).

**Persistence involved**: No — documentation only.

**Existing decision/deferment**: None — this is simply stale documentation that was never updated as the backend was built out across many phases.

**Recommended next action**: Rewrite both READMEs to reflect the real stack (Express/Prisma/PostgreSQL, real `backend/` structure, real env vars) and document the `npm run admin:create` step as the required first action on a fresh install.

**Next-phase candidate**: Yes — cheap, isolated, high-value; a documentation-only pass, ideally paired with Finding 14 (dead plaintext credentials cleanup) since they're the same underlying stale-onboarding-story problem.

---

### Finding 3: Follow-up tasks and communication records can never be marked complete/cancelled/archived from the UI

**Evidence**: `src/store/slices/communication.slice.js:27-49` defines `updateCommunication`, `archiveCommunication`, and `updateCommTask` — all local-only `set()` actions, with no corresponding `pgUpdateCommunication`/`pgUpdateCommTask` anywhere in `src/services/api.js`. Grepped every component under `src/modules/communication/` for call sites of these three actions: **zero matches** — no button, no handler, nothing in the UI ever calls them. Consequences confirmed by tracing the read side: `reminderService.js`'s `priorityTasks` filters on `status === 'pending'` (tasks can never leave this state), and `communicationService.js`'s `completedToday` KPI (rendered as "اكتمل اليوم" in the CRM dashboard) filters on `status === 'completed'`, which nothing can ever set — **this dashboard number is permanently stuck at 0 on every install.**

**Affected files/modules**: `src/store/slices/communication.slice.js`, `src/modules/communication/CommunicationPage.jsx`, `src/modules/communication/components/crmParts.jsx`, `src/modules/communication/reminderService.js`, `src/modules/communication/communicationService.js`.

**User impact**: A secretary can log calls/WhatsApp messages and create follow-up tasks, but can never close them out. Over real, ongoing use, the reminder center and priority-task list become an ever-growing, unfiltered backlog mixing genuinely urgent items with long-resolved ones — undermining the entire point of the reminder feature. The "اكتمل اليوم" dashboard stat is visibly, permanently wrong from day one of real use.

**Persistence involved**: Yes, but the write path doesn't fully exist yet either — `pgUpdateCommunication`/`pgUpdateCommTask` need to be added (the generic CRUD route likely already supports `PUT /api/communications/:id` and `PUT /api/commTasks/:id` for free; needs a one-line confirmation at implementation time, no schema change expected).

**Existing decision/deferment**: None found.

**Recommended next action**: Add the missing `pg*` update functions and wire real UI affordances (mark task done/cancelled, close/archive a communication) using the same server-truth-first pattern already used for creates in this module.

**Next-phase candidate**: Yes — moderate, well-scoped, clearly valuable; a reasonable candidate for the next phase after Finding 1.

---

### Finding 4: Dead local-only financial write code left behind by prior migrations — a landmine, not a live defect

**Evidence**:
- `src/hooks/usePayments.js` — a complete, **zero-importer** hook whose `addPayment()` writes a payment purely to local Zustand state (`createPayment(...)` → `setPayments(...)`), with no `pgCreatePayment` call, no `treasury_txn` creation, no cashbox linkage at all. This is the pre-migration pattern, fully superseded by `PaymentsPage.jsx`'s real atomic flow. Confirmed unreachable — zero importers anywhere in `src/`.
- `src/store/slices/treasury.slice.js`'s `reverseTreasuryTxn` (lines 51-84) and `transferBetweenCashboxes` (lines 89-105) are local-only, fully client-computed compensating-transaction logic with no `pg*` call. Confirmed zero live callers — `TreasuryPage.jsx` correctly uses the real atomic `pgReverseTreasuryTxn`/`pgTransferBetweenCashboxes` and only calls the local slice actions to *adopt* an already-server-confirmed response (safe). **The specific hazard**: an inline comment at `TreasuryPage.jsx:557-559` claims the local `reverseTreasuryTxn` is "reserved for `PaymentsPage.jsx`'s `reverseLinkedTxn` path" — but that function was already documented as removed in the same slice file's own Phase 3B-14C comment. The comment is stale and actively misleading about the safety of resurrecting this code.

**Affected files/modules**: `src/hooks/usePayments.js`, `src/store/slices/treasury.slice.js`.

**User impact**: **None today** — both are unreachable dead code. The risk is entirely prospective: a future developer searching for "how do I reverse a transaction" or "how do I add a payment" could find and wire up the wrong, unsafe, non-persisting path, guided by a comment that sounds like it's pointing at a legitimate, safe, reserved use case.

**Persistence involved**: Yes, if this code were ever activated — that's precisely the danger.

**Existing decision/deferment**: None found.

**Recommended next action**: Delete `usePayments.js` entirely; delete the two dead slice actions and the stale/misleading comment in `TreasuryPage.jsx`.

**Next-phase candidate**: No — this is a pure subtractive cleanup, cheap enough to do as a five-minute fix whenever convenient, not substantial enough to be its own phase.

---

## C — MEDIUM

### Finding 5: Weak backend test coverage for transactional/financial logic
See "Test/build health" above for full detail. Concentrated in exactly the highest-stakes code (payments, treasury reversal/transfer, admission payments, atomic activation, material distribution). Recommend addressing before the next round of changes to any of those files, not necessarily as its own phase.

### Finding 6: Financial reports ignore year in several places
**Evidence**: `src/modules/reports/ReportsPage.jsx:50,75,147` and `src/modules/reports/FinancialAnalytics.jsx:18` filter payments by `p.month === X` with no year check, while the same files' monthly-trend calculations correctly guard `&& (!p.year || p.year === currentYear)` a few lines away — `payments.year` is a real, always-populated schema column (`backend/prisma/schema.prisma:396`), so the fix is trivial and the inconsistency is clearly an oversight, not a design choice.
**User impact**: once the center operates across a calendar-year boundary, "this month"/"last month revenue"/monthly-trend figures will silently sum payments from the same month number across different years.
**Recommended action**: apply the same `p.year === currentYear` guard already used elsewhere in the same files.
**Next-phase candidate**: maybe — small, isolated; could be bundled with other reporting fixes.

### Finding 7: Student/Group delete-guard pre-checks are incomplete (server safely backstops, but the error message is confusing)
**Evidence**: `StudentsPage.jsx:112-136`'s delete guard only pre-checks `attendance` and `grades`, but 8 tables FK-reference `students.id` with `onDelete: NoAction` (admissions, communications, hw_submissions, inventory_txn, payments, and others — `backend/prisma/schema.prisma`). Deleting a student with e.g. payment history but no attendance/grades yet fails server-side with a generic, not-very-actionable P2003 translation instead of the friendly, specific message the two checked cases get. Same incompleteness pattern in `GroupsPage.jsx:122-144` (checks students/attendance/exams, not homeworks/admissions/communications referencing the group).
**User impact**: not data-unsafe (the server always correctly blocks the delete) — just a confusing error in realistic scenarios instead of clear guidance.
**Recommended action**: extend both delete guards to check the remaining FK-referencing collections already present in Zustand state, with the same friendly-message pattern already established for the two cases that do work.
**Next-phase candidate**: maybe — small, mechanical, low-risk; reasonable "polish pass" material.

### Finding 8: Cashbox cannot be deactivated/reactivated via the UI
**Evidence**: `TreasuryPage.jsx:575`'s `cbForm` state and `handleSaveCashbox` never include the `active` field, even though `cashboxes.active` is a real, meaningfully-used column (`PaymentForm.jsx:72` filters on it; the backend already accepts it via `pgUpdateCashbox`).
**User impact**: a center that creates and later retires a second/branch cashbox can never actually retire it in the UI — it stays selectable and counted forever. Low-medium friction; single-cashbox installs (likely the common case) are unaffected.
**Recommended action**: add an `active` toggle to the cashbox edit form — trivial, additive, no schema change.
**Next-phase candidate**: maybe — small, low-risk, not urgent.

### Finding 9: Communication records are linked to students/admissions by free-text name, not real FK ids, despite the schema already supporting it
**Evidence**: `communications.student_id`/`admission_id` are real, already-relational columns, but `CommFormModal.jsx:52`'s actual input field is a plain free-text `studentName` string — no student/admission picker exists anywhere in the form. In current real use, these FK columns stay `null`; the only linkage is the informal name/phone matching `parentService.js`/`reminderService.js` already use.
**User impact**: usually "good enough" for a human reading the CRM, but not reliably relational — a typo or shared phone number (e.g. siblings) can misattribute a follow-up, and it blocks any future feature wanting a real join.
**Recommended action**: add a real student/admission picker to `CommFormModal.jsx` that sets the real FK ids, falling back to free text only for genuinely new inquiries with no match yet.
**Next-phase candidate**: maybe — meaningful but not urgent; current name/phone matching mostly works.

### Finding 10: `students.parent_id` (Phase 1, Issue 3) is written but never read/displayed anywhere
**Evidence**: grepped every reference to `parentId`/`parent_id` in `src/` — only the Phase 1 write-side code (`StudentsPage.jsx`, `AdmissionsPage.jsx`, `api.js` pass-through) references it. `StudentProfile.jsx:451` only ever displays the plain-text `parentPhone` column; it never reads `student.parentId` or joins to the richer linked `parents` row (alt phone, notes, preferred contact method).
**User impact**: none negative — nothing is broken — but the value of Phase 1's linking work (a real FK to a real `parents` row with richer data) is currently invisible to end users.
**Existing decision**: implicitly out of scope for Phase 1, which was scoped narrowly to populating the column (`PRODUCT_COMPLETION_PHASE_1_PLAN.md`, Issue 3) — not a regression, just an unfinished second half of a two-part improvement.
**Recommended action**: a future phase could surface linked-parent info on `StudentProfile.jsx`.
**Next-phase candidate**: maybe — low urgency, genuinely optional.

---

## D — LOW

11. **No duplicate-phone prevention on admissions; student phone dedup is client-side only.** `students.phone`/`admissions.phone` have no `@unique` constraint; `studentService.js`'s dedup check only looks at the currently-loaded local array (race-condition-prone across sessions). Real risk only under concurrent multi-browser data entry. Not urgent.
12. **`UsersPage.jsx` Users tab has no empty-state message** when a search matches nothing (the Teachers tab in the same file does). Looks like a rendering glitch rather than "no results." Trivial fix.
13. **Secondary activity-log write failures show a user-facing error toast even when the primary save succeeded** — a uniform, repeated pattern across nearly every module (`StudentsPage.jsx`, `PaymentsPage.jsx`, `ExamsPage.jsx`, etc.), consistent enough to look deliberate rather than an oversight, but could read as "did my save fail?" to a user. Consider downgrading the toast severity/styling if ever revisited.
14. **Dead code: plaintext `admin`/`admin123` (and other fake) credentials still present in `src/data/initialData.js`** (`INITIAL_USERS`, `ROLES`), matching the stale README's bogus credentials table. Confirmed zero real importers — inert, not a live vulnerability, but a bad look and a copy-paste risk sitting in version control. Delete alongside the README rewrite (Finding 2).
15. **Dead `NAV_SECTIONS` export in `src/constants/routes.js`** — a full, unused duplicate of the real nav structure that actually lives in `src/constants/nav.js`. No live impact; risk is a future maintainer editing the wrong copy.
16. **Dead `INITIAL_ROLES`/`INITIAL_USERS`/`INITIAL_USERS_V2`/`INITIAL_MAT_DIST` constants** in `initialData.js` — superseded by Postgres-backed identity and `deriveMatDist` respectively, zero live readers.
17. **Cosmetic duplicate notification** — a communication record due today with `result: promiseToPay` correctly produces two separate, distinctly-labeled notifications ("متابعة اليوم" and "وعد دفع مستحق اليوم") since `todayFollowups` and `paymentPromisesDue` are independently-computed, non-exclusive signals by `reminderService.js`'s own existing design. Already observed and implicitly accepted during Phase 1's own testing. Purely cosmetic.
18. **`centerProfile` is stored redundantly** — once via a raw `localStorage['tc_center_profile']` key, and again via Zustand's own `persist(['studix-v1'])`. Both are always written together (server-truth-first), so they can never drift out of sync — pure storage redundancy, not a correctness issue.

---

## E — Confirmed standing deferrals (re-verified, not new findings)

- **Teachers domain** remains fully local-only by explicit, standing design (`auth.context.jsx`'s own comment: *"'teachers' يبقى محلياً تماماً... خارج هذه المرحلة"*) — confirmed unchanged across every fork that touched adjacent code (Users page, admissions, group teacher fields). No evidence the deferral has been revisited.
- **`materials.slice.js`'s dead `materials`/`addMaterial`/`updateMaterial`/`removeMaterial`/`setMaterials`** — confirmed zero live callers, matching the explicit, already-documented decision in `MATERIALS_UNIFICATION_*.md`/`MATERIALS_DOMAIN_DECISION_AUDIT.md` (Decision #10/#11: left in place deliberately, not deleted, to keep that migration strictly additive). No new drift.
- **`treasuryMeta`** — pre-existing, explicitly-commented "legacy compat" local state with no live consumers. Inert, not a new gap.

---

## F — Explicitly ruled out (verified clean, worth stating for the record)

- Navigation/permission mapping: no other latent nav-id-vs-permission-key mismatch exists beyond the three already handled by `PAGE_ID_OVERRIDES` (`student-report`, `communication`, `inventory`) — every other nav item's id matches its real permission key exactly.
- Routes/nav/permission-list are fully 1:1 — no orphaned routes, no pages without a sidebar entry, no sidebar entries pointing nowhere.
- Users/Roles management is fully real, Postgres-backed CRUD with no dead controls.
- Materials/Inventory/matDist: the closed unification work is fully intact — both `MaterialsPage.jsx` and `InventoryPage.jsx` write through real `pg*` calls against the unified `invMaterials`/`inv_materials` table; `matDist` remains a pure derived view with no independent state drift; live check confirms `inv_materials.count() === 1` (unchanged verification row).
- Attendance/Exams/Homework: fully migrated to real atomic backend endpoints; zero local-only writes found anywhere in these three modules.
- Payments/Treasury core: genuinely solid — atomic creation, immutable payments (PUT/PATCH/DELETE return 405), refund path uses real `SELECT...FOR UPDATE` locking with a tested concurrency guard, balance checks are always recomputed live from `treasury_txn`, never client-trusted. This is real, working reconciliation infrastructure.
- Notifications (Phase 1, Issue 4): re-verified fresh — the approved four-signal derivation, the stale-read-id pruning logic, and mark-read/mark-all-read all work exactly as the Phase 1 report claimed. No edge case found where pruning fails or over-prunes.
- No orphaned backend routes — every one of the 19 route files in `backend/src/routes/` has a confirmed live frontend caller.
- No unhandled/uncaught promise rejections found in the sampled modules; every network call routes through either `useErrorHandler`'s `run()` wrapper or an explicit `.catch(toast.error)`.
- Fresh-install cashbox bootstrap (Phase 1, Issue 2) and Communication/Inventory sidebar visibility (Phase 1, Issue 1): both re-verified intact from a fresh code-path trace, no regression.

---

## Recommended sequencing (for whenever implementation resumes — not started here)

1. **Fix Finding 1** (fake group transfer) — the one true blocker, small and isolated.
2. **Documentation pass** (Finding 2) + delete the dead plaintext-credential seed data (Finding 14) — cheap, high onboarding value, same root cause.
3. **Cleanup pass** (Finding 4) — delete the dead financial-write landmines and the stale misleading comment. Five-minute fix, best done before any future treasury/payments work touches that file.
4. Everything else in this report is genuinely optional, non-blocking, or already deferred by a standing decision — worth triaging into a future phase at the user's discretion, but none of it should block calling the product usable today once Finding 1 is fixed.
