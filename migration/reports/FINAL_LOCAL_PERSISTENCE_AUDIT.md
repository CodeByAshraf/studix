# Final Local Persistence Audit

**Status: READ-ONLY. No code, schema, database, or localStorage was modified to produce this report.** Every fact below was re-derived this session — direct file reads, greps, and live (read-only) Postgres queries — not carried forward from any prior report on trust. Where a prior report's characterization turns out to be imprecise or now-obsolete, this is stated explicitly in §14.

---

## 1. Executive Summary

The application has **five, not one, independent client-side persistence mechanisms** running simultaneously: Zustand's `persist` (`studix-v1`), `auth.context.jsx`'s own direct `localStorage` calls (`studix-auth-teachers`, plus the now-retired `studix-auth-users`/`-roles`), a `sessionStorage` session mirror (`tc_session`) plus a client-side lockout counter (`tc_login_attempts`), a **separate, standalone** `localStorage` key for center-profile print data (`tc_center_profile`) that is written to *independently of and in addition to* the same data's presence inside `studix-v1`, a write-only diagnostic auto-backup snapshot (`studix_autobackup`), a UI theme preference (`tc_theme`), and an error-boundary crash log (`tc_error_log`). No IndexedDB usage exists anywhere. No other cookie besides the backend's own `httpOnly` session cookie (`studix_session`, unreadable by client JS) is used for anything.

Of `studix-v1`'s 27 persisted keys, **23 are genuine, boot-synced mirrors of a real Postgres collection** and function correctly as caches (server always wins on id collision — see §3). **Four are not**: `materials` (a real, actively-used, user-entered business domain — study-material catalog entries — with **zero** Postgres backing of any kind, not just a stale read like `matDist`), `parentExtras` (per-parent notes/alt-phone/preferred-contact data that **duplicates columns that already exist** on the real Postgres `parents` table — `alt_phone`, `preferred_method`, `preferred_time`, `notes` — which the frontend simply never reads or writes), `matDist` (previously identified stale-read gap, reconfirmed unchanged), and `treasuryMeta` (confirmed dead — zero consumers anywhere).

A live, direct query of the `studix` database this session found **payments: 0, treasury_txn: 0, cashboxes: 0, groups: 0, admissions: 0** rows — only `students` has any rows at all (2, both named "Verify Student" — leftover live-verification artifacts from an earlier phase, not real usage). This is a load-bearing fact for the whole audit: this environment's PostgreSQL side is still essentially empty of real business data. Whatever real, non-seed business data exists today, if any, exists only inside some browser's `studix-v1` — a browser this audit has no access to, exactly the same limitation the Identity Reconciliation Audit already documented for `studix-auth-*`. This report does not speculate about what that browser might contain.

---

## Final Persistence Matrix

Classification legend: **KEEP_LOCAL** (genuinely belongs only on the client, no PG equivalent needed), **CACHE_ONLY** (PG-backed, local copy is a correctly-behaving mirror), **REMOVE_LEGACY** (dead, safe to remove whenever convenient), **MIGRATE_REQUIRED** (real business data with no adequate server backing), **DEFERRED** (known gap, explicitly out of scope for now), **INVESTIGATE** (this audit could not fully resolve it without information this session doesn't have, e.g. real-browser contents).

| Store/Key | Domain | Writers | Readers | Data Type | PG Equivalent | Current Role | Refresh Behavior | Risk | Classification | Recommended Action |
|---|---|---|---|---|---|---|---|---|---|---|
| `studix-v1` → `students` | Students | `students.slice.js` via `pgCreateStudent`/`pgUpdateStudent` | `StudentsPage.jsx` + many | Business | `students` table | Cache | Boot-sync re-merges from PG; local-only rows survive | Low | CACHE_ONLY | None |
| `studix-v1` → `groups` | Groups | `groups.slice.js` via `pgCreate/UpdateGroup` | `GroupsPage.jsx` + many | Business | `groups` table (0 rows live) | Cache | Same | Low (mechanism), but nothing to sync against today | CACHE_ONLY | None |
| `studix-v1` → `payments` | Financial | server-confirmed only (`payments.js` route) | `PaymentsPage.jsx` + reports | Business/financial | `payments` table (0 rows live) | Cache | Same | Low | CACHE_ONLY | None |
| `studix-v1` → `attendance` | Academic | `attendanceSessions.js` route | `AttendancePage.jsx` + reports | Business | `attendance` table | Cache | Same | Low | CACHE_ONLY | None |
| `studix-v1` → `absenceFollowup` | Academic | `absence_followup` route | `AbsenceFollowup.jsx` | Business | `absence_followup` table | Cache | Same | Low | CACHE_ONLY | None |
| `studix-v1` → `exams` | Academic | `examDelete.js`/generic route | `ExamsPage.jsx` + reports | Business | `exams` table | Cache | Same | Low | CACHE_ONLY | None |
| `studix-v1` → `grades` | Academic | `examGrades.js` route | `GradeEntry.jsx` + reports | Business | `grades` table | Cache | Same | Low | CACHE_ONLY | None |
| `studix-v1` → `homeworks` | Academic | `homeworkDelete.js`/generic | `HomeworkPage.jsx` | Business | `homeworks` table | Cache | Same | Low | CACHE_ONLY | None |
| `studix-v1` → `hwSubmissions` | Academic | `hwSubmissions.js` route | `HomeworkPage.jsx`/tracking | Business | `hw_submissions` table | Cache | Same | Low | CACHE_ONLY | None |
| `studix-v1` → `invMaterials` | Inventory | generic route | `InventoryPage.jsx` | Business | `inv_materials` table | Cache | Same | Low | CACHE_ONLY | None |
| `studix-v1` → `inventoryTxn` | Inventory | generic route + `material-distributions` | `InventoryPage.jsx`, reports | Business | `inventory_txn` table | Cache | Same | Low | CACHE_ONLY | None |
| `studix-v1` → `inventorySettings` | Inventory config | generic route | `InventoryPage.jsx` | Configuration | `inventory_settings` (singleton) | Cache (singleton merge) | Same | Low | CACHE_ONLY | None |
| `studix-v1` → `communications` | CRM | `pgCreateCommunication` | `CommunicationPage.jsx` | Business | `communications` table | Cache | Same | Low | CACHE_ONLY | None |
| `studix-v1` → `commTasks` | CRM | `pgCreateCommTask` | `CommunicationPage.jsx` | Business | `comm_tasks` table | Cache | Same | Low | CACHE_ONLY | None |
| `studix-v1` → `waReportLog` | Reporting | `pgCreateWaReportLog` | `StudentReportPage.jsx` | Business/log | `wa_report_log` table (no write-hardening yet, Decision 5 deferred) | Cache | Same | Low-Medium (write exposure, not persistence) | CACHE_ONLY | None (persistence-wise); write-hardening is DEFERRED separately |
| `studix-v1` → `cashboxes` | Treasury | generic route | `TreasuryPage.jsx` | Business | `cashboxes` table (**0 rows live**) | Cache mechanism, but local seed (`cb_main`) may be the only copy anywhere | Same | **Medium** — see §7 | INVESTIGATE | Confirm with a real browser export whether any payment history depends on the local `cb_main` before assuming Postgres can safely become sole source |
| `studix-v1` → `treasuryTxn` | Treasury | `treasuryTxn.js` route | `TreasuryPage.jsx` | Business/financial | `treasury_txn` table (0 rows live) | Cache | Same | Low | CACHE_ONLY | None |
| `studix-v1` → `activityLogs` | Audit | `pgCreateActivityLog` | `ActivityLogPage.jsx`, `Dashboard.jsx` | Log | `activity_logs` table | Cache (despite a stale in-code comment claiming no localStorage — see §3) | Same | Low | CACHE_ONLY | None (functionally); the stale comment is cosmetic |
| `studix-v1` → `centerProfile` | Print/config | **two** paths — Zustand persist AND `centerProfile.slice.js`'s own `storage.set('tc_center_profile', ...)` | `SettingsPage.jsx`, print headers | Configuration | `center_profile` (singleton; `slogan` intentionally local-only) | Mixed — dual persistence | Both keys updated together today | Low-Medium (redundant, not yet observed to diverge) | INVESTIGATE | Clarify whether the dual write is intentional before any cleanup |
| `studix-v1` → `admissions` | Admissions | `pgCreateAdmission`/`pgUpdateAdmission` | `AdmissionsPage.jsx` | Business | `admissions` table (0 rows live) | Cache | Same | Low | CACHE_ONLY | None |
| `studix-v1` → `admissionFollowups` | Admissions | `pgCreateAdmissionFollowup` | `AdmissionsPage.jsx` | Business | `admission_followups` table | Cache | Same | Low | CACHE_ONLY | None |
| `studix-v1` → `admissionSystemLog` | Admissions/log | `pgCreateAdmissionSystemLog` | `AdmissionsPage.jsx` | Log | `admission_system_log` (delete-blocked trigger; update still open) | Cache | Same | Low-Medium (write exposure) | CACHE_ONLY | None (persistence); write-hardening DEFERRED |
| `studix-v1` → `admissionPayments` | Admissions/financial | `pgCreateAdmissionPayment` | `AdmissionsPage.jsx` | Business/financial | `admission_payments` table | Cache | Same | Low | CACHE_ONLY | None |
| `studix-v1` → `materials` | Study-materials catalog | **local only** — `addMaterial`/`updateMaterial`, never touches network | `MaterialsPage.jsx`, `MaterialReports.jsx`, `AdmissionsPage.jsx`, `PaymentForm.jsx`, `StudentReportPage.jsx` | Business | **None** | **Local source of truth** | Survives refresh (persisted), but never leaves the browser | **High** | MIGRATE_REQUIRED | Build the schema/route/frontend wiring — largest genuine gap found |
| `studix-v1` → `matDist` | Material distribution | Real write via `pgSaveMaterialDistribution`, but read from this local array | `MaterialDistribution.jsx`, `StudentReportPage.jsx` | Business | `inventory_txn` (write target), but no `matDist`-shaped read route | Write-real/read-stale | Local copy persists; not re-derived from PG on refresh | Medium | MIGRATE_REQUIRED | Fix the read side to derive from `inventoryTxn` (already scoped in prior reports) |
| `studix-v1` → `parentExtras` | Parent contact info | `updateParentExtra` (`communication.slice.js`) | `CommunicationPage.jsx`/`parentService.js` | Business | **Already exists**: `parents.alt_phone`/`preferred_method`/`preferred_time`/`notes` | **Local source of truth for data that already has a PG home** | Survives refresh, never syncs | Medium-High | MIGRATE_REQUIRED | Wire `CommunicationPage.jsx` onto the real `parents` collection |
| `studix-v1` → `treasuryMeta` | Treasury config | Nothing — no writer found anywhere | Nothing — no reader found anywhere | Dead | N/A | Dead | N/A | None | REMOVE_LEGACY | Safe to remove whenever convenient |
| `studix-auth-users` | Identity (retired) | Nothing (only `removeItem` in a cleanup utility) | Nothing | Legacy | `users` table (now authoritative) | Dead | N/A | None | REMOVE_LEGACY | Already effectively retired; key removal already present in `handleClearAll` |
| `studix-auth-roles` | Identity (retired) | Same as above | Nothing | Legacy | `roles` table (now authoritative) | Dead | N/A | None | REMOVE_LEGACY | Same |
| `studix-auth-teachers` | Teachers (local) | `auth.context.jsx` | `UsersPage.jsx` (Teachers tab) | Business | None (Teachers domain deferred) | **Local source of truth**, explicitly out of scope | Persists across refresh | Medium (unreconciled with the unused Zustand `teachers` key) | DEFERRED | Do not touch — wait for Teachers domain migration |
| `sessionStorage['tc_session']` | Auth UX | `auth.context.jsx` | `auth.context.jsx` (session restore on load) | Authentication state (mirror only) | `studix_session` cookie (the real credential) | Cache/convenience mirror | Cleared on tab close (sessionStorage); real auth re-checked server-side regardless | Low | KEEP_LOCAL | None |
| `localStorage['tc_login_attempts']` | Auth UX | `auth.context.jsx` | `auth.context.jsx` | UI state (lockout counter) | Server-side rate limiter (real boundary) | Cosmetic only, already documented as such | Persists across refresh | Low (already known non-boundary) | KEEP_LOCAL | None |
| `localStorage['tc_center_profile']` | Print/config | `centerProfile.slice.js` | `centerProfile.slice.js` (initial load) | Configuration | `center_profile` table | Second, independent copy of the same data as `studix-v1`'s `centerProfile` | Persists; loaded before Zustand rehydration | Low-Medium | INVESTIGATE | See recommendation above |
| `localStorage['studix_autobackup']` | Backup | `app.store.js`'s `saveAutoBackup`, triggered by `data.context.jsx` on every app load | **Nothing** — no restore feature exists | Business (snapshot) | N/A (client-side insurance copy) | Write-only, functionally inert | Overwritten on every load | Low (just unused storage) | INVESTIGATE | Decide whether a restore feature was ever intended, or remove the write |
| `localStorage['tc_theme']` | UI preference | `ui.context.jsx` | `ui.context.jsx` | UI state | None needed | Correctly local | Persists | None | KEEP_LOCAL | None |
| `localStorage['tc_error_log']` | Diagnostics | `ErrorBoundary.jsx` | Nothing (manual DevTools inspection only) | Diagnostic | None needed | Correctly local | Persists (capped at 20 entries) | None | KEEP_LOCAL | None |
| Cookie `studix_session` | Auth (real) | Backend only (`session.js`) | Backend only (`requireAuth`) | Authentication (real credential) | N/A — this *is* the authoritative session | Authoritative | Survives refresh, cleared on logout/expiry | None (by design; not client-readable) | KEEP_LOCAL | None |
| `notifications` (in-memory, `ui.context.jsx`) | UI | `ui.context.jsx` `useState` | `NotificationsPage.jsx` | UI state | None | Ephemeral | **Lost on every refresh** — not persisted anywhere | None (by apparent design) | KEEP_LOCAL | None — confirm this is intentional if not already known |

---

## 2. Complete Persistence Inventory (all mechanisms, not just `studix-v1`)

| Mechanism | Key(s) | Owner file(s) |
|---|---|---|
| Zustand `persist` (localStorage) | `studix-v1` | `src/store/app.store.js` |
| Direct localStorage (auth) | `studix-auth-teachers` | `src/store/auth.context.jsx` |
| Direct localStorage (auth, retired but still cleaned up) | `studix-auth-users`, `studix-auth-roles` | referenced only in `SettingsPage.jsx`'s reset utility |
| sessionStorage (session mirror) | `tc_session` | `src/store/auth.context.jsx` |
| localStorage (client-side lockout counter) | `tc_login_attempts` | `src/store/auth.context.jsx` |
| localStorage (print/center-profile) | `tc_center_profile` | `src/store/slices/centerProfile.slice.js` — **separate from, and in addition to, `studix-v1`'s own `centerProfile` field** (see §5) |
| localStorage (write-only backup snapshot) | `studix_autobackup` | written by `src/store/app.store.js`'s `saveAutoBackup`, triggered once per app load by `src/store/data.context.jsx` |
| localStorage (UI theme) | `tc_theme` | `src/store/ui.context.jsx` |
| localStorage (crash log) | `tc_error_log` | `src/components/ErrorBoundary.jsx` |
| Cookie (server-issued, `httpOnly`) | `studix_session` | set/cleared only by the backend (`backend/src/lib/session.js`/`session.js` route) — **not readable or writable by any client-side code**, included here only because it is a real client-persisted credential |
| In-memory only, no persistence at all | `notifications` (React `useState` in `ui.context.jsx`, seeded from an empty array) | `src/store/ui.context.jsx` — confirmed not read from or written to any storage mechanism; gone on every refresh |
| IndexedDB | none found anywhere in `src/` | — |

---

## 3. `studix-v1` Slice-by-Slice Analysis

Legend: **PG?** = does a real Postgres collection back this key (checked against `backend/src/routes/collections.js`'s `COLLECTION_MODELS` and `db.middleware.js`'s `PG_COLLECTIONS`, not assumed). **Actually written locally from** = what the write path is on success.

| Key | PG? | Actually written locally from | Verdict |
|---|---|---|---|
| `students` | Yes | Confirmed server response only (`pgCreateStudent`/`pgUpdateStudent`) + boot-sync merge | Correct cache |
| `groups` | Yes | Same pattern | Correct cache |
| `payments` | Yes (read-only collection; writes via dedicated route) | Confirmed server response only | Correct cache |
| `attendance` | Yes | Same pattern | Correct cache |
| `absenceFollowup` | Yes | Same pattern | Correct cache |
| `exams` | Yes | Same pattern | Correct cache |
| `grades` | Yes | Same pattern | Correct cache |
| `homeworks` | Yes | Same pattern | Correct cache |
| `hwSubmissions` | Yes | Same pattern | Correct cache |
| `invMaterials` | Yes | Same pattern | Correct cache |
| `inventoryTxn` | Yes | Same pattern | Correct cache |
| `inventorySettings` | Yes (singleton merge) | Same pattern | Correct cache |
| `communications` | Yes | Same pattern | Correct cache |
| `commTasks` | Yes | Same pattern | Correct cache |
| `waReportLog` | Yes | Same pattern | Correct cache |
| `cashboxes` | Yes (schema-wise) | Same pattern — **but Postgres `cashboxes` has 0 rows today** (verified live); the only cashbox that currently exists anywhere is the local seed `cb_main` (`INITIAL_CASHBOXES`) | Correct mechanism, but currently the *only* copy of this record is local — see §7 |
| `treasuryTxn` | Yes | Same pattern | Correct cache (0 rows either side today) |
| `activityLogs` | Yes | Confirmed server response only (`pgCreateActivityLog`) | Correct cache — **but see below: the slice's own comment claims otherwise** |
| `centerProfile` | Yes (singleton merge; `slogan` field is permanently local-only, no DB column, by design) | Mixed — see §5, this key has a second, independent write path | Mostly-correct cache, with a real duplication issue |
| `admissions` | Yes | Confirmed server response only | Correct cache |
| `admissionFollowups` | Yes | Same pattern | Correct cache |
| `admissionSystemLog` | Yes | Same pattern | Correct cache |
| `admissionPayments` | Yes (read-only) | Same pattern | Correct cache |
| `materials` | **No** — not in `COLLECTION_MODELS`, not in `PG_COLLECTIONS`, no backend route named `materials` anywhere | Directly from local `addMaterial`/`updateMaterial` actions — **never touches the network at all** | **Local source of truth for a real, actively-used business domain** (see §6) |
| `matDist` | **No** — absent from `PG_COLLECTIONS` | Writes go to the real `inventory_txn` table via `pgSaveMaterialDistribution`, but the local `matDist` array itself is what `MaterialDistribution.jsx`/`StudentReportPage.jsx` read back | Write-real/read-stale (unchanged finding from prior audits, reconfirmed) |
| `parentExtras` | **No** direct route, but see finding below | Directly from local `updateParentExtra` | **Duplicates real Postgres `parents` columns** (see §6) |
| `treasuryMeta` | No | Never written by any component — only its slice-internal initial value exists | **Dead** — confirmed zero consumers anywhere in `src/` outside the store definition itself |

**A discovered inconsistency worth stating precisely, not smoothing over:** `src/store/slices/activity.slice.js`'s own header comment reads *"Phase 3B-15: PostgreSQL هو مصدر الحقيقة الآن... لا localStorage إطلاقاً بعد الآن"* ("no localStorage at all anymore") — but `activityLogs` **is** still listed in `app.store.js`'s `partialize`, and therefore **is** still written to `localStorage['studix-v1']` on every change. In practice this is harmless (every write into the slice comes from a confirmed server response, so the persisted copy never diverges from what the server already confirmed), but the comment is factually inaccurate about where the data lives, and this audit is not silently fixing or removing the persistence to make the comment true.

---

## 4. Auth Persistence Status

- `studix-auth-users` / `studix-auth-roles`: **zero active runtime references** — the only remaining mentions anywhere in `src/` are inside `SettingsPage.jsx`'s `handleClearAll()` (a "wipe all local app data" utility that `removeItem`s every known key, including these two, for cleanup purposes). `auth.context.jsx` no longer declares any `users`/`roles` state and has no code path that reads or writes either key. Confirmed via full-tree grep.
- `studix-auth-teachers`: **still an active, real runtime dependency**, read and written only by `auth.context.jsx`, consumed only by `UsersPage.jsx`'s Teachers tab. Correctly isolated — untouched by the identity/authorization stabilization work, exactly as instructed. This audit does not touch it and is not recommending any change to it.
- `tc_session` (sessionStorage): mirrors the currently-logged-in user's identity (`id`, `name`, `role`, `active`, `permissions`, `isAdmin`, `authSource`) so a page refresh doesn't require re-authenticating against the backend. `permissions` here is exactly the array the backend resolved and returned at login time (Stabilization phase) — it is not recomputed locally. This is UI-convenience state, not a second identity source: every actual authorization decision is re-checked server-side on every request regardless of what this mirror says.
- `tc_login_attempts`: client-side lockout counter, explicitly documented in the earlier stabilization audit as *not* a real security boundary (the real one is the server-side rate limiter added in that phase). Still present, still cosmetic-only, unchanged.
- PostgreSQL `users`/`roles` are confirmed live as the sole authoritative source: 1 user (`admin`), 4 roles, permission arrays matching the approved values exactly (re-verified this session).

---

## 5. Mock/Demo Data Still Remaining

- **`MOCK_GROUPS`** (`src/modules/admissions/mockData.js`): a hardcoded array of three literal Arabic group-name strings (`'مجموعة السبت والثلاثاء'`, `'مجموعة الأحد والأربعاء'`, `'مجموعة الجمعة'`), **actively used today** as the group-selection dropdown in the admission-intake form (`AdmissionsPage.jsx`, both the empty-form default and the select options). This is a real, live architectural gap: an admission's intake-stage `group` field is free text chosen from this fixed fake list, entirely disconnected from the real, Postgres-backed `groups` collection (which currently has 0 rows anyway — see §1). A separate field, `confirmedGroupId` (set later, at activation), is the one that can reference a real group. This was not clearly named as "remaining mock data" in prior reports at this level of precision.
- `src/data/initialData.js`'s seed constants are otherwise confirmed empty (`INITIAL_STUDENTS`, `INITIAL_GROUPS`, `INITIAL_PAYMENTS`, `INITIAL_ADMISSIONS`, `INITIAL_MATERIALS`, `INITIAL_MAT_DIST`, `INITIAL_TREASURY_TXN`, etc. — all `[]`), **except**:
  - `INITIAL_CASHBOXES` — one real, non-fake default record (`cb_main`, "الخزنة الرئيسية"), a legitimate bootstrap default (every install needs at least one cashbox), not demo/mock data in the fabricated-content sense.
  - `INITIAL_INVENTORY_SETTINGS` — a legitimate default config object (`{defaultMinStock: 10, allowNegativeStock: false, reservationExpiryDays: 7}`).
  - `INITIAL_USERS`/`INITIAL_USERS_V2` — the single seeded `admin` entry (dead code — confirmed zero importers, per the prior stabilization audits, reconfirmed this session).
  - The dead `ROLES` constant and `INITIAL_ROLES` (also dead, zero importers, reconfirmed).

---

## 6. Business Data Still Remaining Outside PostgreSQL

Two distinct, genuine cases — not the same shape of gap:

1. **`materials` (study-material catalog)** — a real business domain (title/subject/price/etc. for handouts sold to students, referenced in `MaterialsPage.jsx`, `MaterialReports.jsx`, `AdmissionsPage.jsx`, `PaymentForm.jsx`, `StudentReportPage.jsx`) that has **no Postgres table, no backend route, and no write path of any kind** — every material a user creates lives only in `localStorage['studix-v1']`. This is more severe than `matDist`'s "write-real, read-stale" pattern: here there is no real write path at all, in either direction. **This is confirmed to require a full migration (schema + backend route + frontend rewire), not a read-side patch.**
2. **`parentExtras` (parent contact preferences/notes)** — confirmed this session that the real Postgres `parents` table (`backend/prisma/schema.prisma`) already has `alt_phone`, `preferred_method`, `preferred_time`, and `notes` columns — the exact same fields `parentExtras` stores locally. The frontend's `CommunicationPage.jsx` derives synthetic "parent" records from `communications`/`students` rather than reading the real `parents` collection at all, and stores the supplementary fields in this separate local map instead. **This is not a case of "no PG equivalent exists yet" — the target already exists; only the frontend wiring is missing.** This is a more precise and more actionable finding than any prior report stated.

---

## 7. Divergence Risks

- **`cashboxes`**: mechanism is correct (server-truth-first, `mergeById`), but Postgres currently has 0 rows while the local seed provides `cb_main`. If any real payment has ever been recorded in some browser against `cb_main`, that payment's `cashboxId` reference and the cashbox itself may exist only in that browser's `studix-v1`, with nothing in Postgres to reconcile against — this cannot be confirmed or ruled out without the same kind of browser-side export the Identity Reconciliation Audit used for `studix-auth-*`.
- **`materials`**: unbounded divergence risk by construction — every browser that has ever added a material has a private, unshareable catalog. Not a "risk" so much as a certainty that no two browsers agree today.
- **`parentExtras`**: same — private per-browser data with no reconciliation path, compounded by the fact that a real schema destination already exists and nothing is flowing into it.
- **`activityLogs`/other confirmed caches**: **low risk**, per the existing `mergeById` guarantee (server always wins on id collision; local-only rows are kept, never silently deleted) — this was independently re-verified this session by re-reading `db.middleware.js` in full, not assumed.
- **`teachers`** (the Zustand-side, not the `auth.context.jsx`-side): effectively **no divergence risk today**, for a fact more precise than previously stated — see §14.

---

## 8. Dead Persistence Code

- `treasuryMeta` (`studix-v1` key) — zero consumers anywhere; confirmed by grep.
- `verifyPassword`, `maskPassword`, `isHashed` (`src/utils/crypto.js`) — zero callers (already surfaced in the previous verification audit, reconfirmed unchanged).
- `createUser`, `hashNewPassword` (`src/services/usersService.js`) — zero callers (same).
- `INITIAL_USERS`, `INITIAL_USERS_V2`, `INITIAL_ROLES`, the dead `ROLES` constant (`initialData.js`) — zero importers (reconfirmed).
- The Zustand `app.store.js` `teachers` key referenced only inside `db.middleware.js`'s `PG_COLLECTIONS` array — see the corrected characterization in §14; it is not merely "unconsumed," it functionally **never gets set at all** under current data conditions.

---

## 9. Recommended Cleanup Order (descriptive — nothing here is authorized or implemented)

1. `materials` migration (schema + route + frontend) — the largest genuine gap, real business data with zero server backing.
2. `parentExtras` → wire `CommunicationPage.jsx` onto the real `parents` collection — the schema destination already exists; this is frontend-only work.
3. `matDist` stale-read fix — already scoped in the prior stabilization audits, unchanged.
4. Resolve the `centerProfile` dual-key persistence (§5) — a correctness/clarity question, not urgent, no evidence it currently produces wrong data.
5. `MOCK_GROUPS` → connect admission intake to the real `groups` collection once `groups` itself has real usage.
6. Teachers domain — unchanged position from prior reports (see §14 for the one precision correction).
7. Cosmetic/dead-code removal (§8) — lowest priority, no functional impact.

---

## 10. What Is Safe to Remove Now

Nothing was removed, and this section describes what *could* be removed without functional loss if you choose to, not a recommendation to act:
- The dead code listed in §8 (zero callers/importers, confirmed, not inferred).
- `studix_autobackup`'s write call could be removed without breaking anything **only if** you're certain no one has ever relied on manually recovering it via DevTools — this audit cannot confirm or rule that out (it is genuinely write-only; nothing in the codebase ever reads it back).

## 11. What Must NOT Be Removed Yet

- `studix-auth-teachers` — active Teachers-domain dependency, explicitly out of scope.
- `materials` / `matDist` / `parentExtras` local data — each holds real, unreconciled business data with no server copy to fall back on; removing the local key before the corresponding migration would be a genuine data-loss event, not cleanup.
- `cashboxes`'s local seed (`cb_main`) — Postgres has zero cashboxes today; removing the local record without first confirming whether any browser has real payment history tied to it would risk breaking the only cashbox reference that may exist anywhere.
- `tc_center_profile` — still one of the two live write targets for center-profile data; removing it without first resolving the dual-persistence question (§5, §9 item 4) could silently drop the `slogan` field or any field not also present in Postgres.

## 12. What Should Wait for Teachers or a Later Phase

- Anything touching `studix-auth-teachers`, the unused Zustand `teachers` key, or reconciling the two into one real Postgres-backed `teachers` table — explicitly deferred, per repeated instruction across this whole engagement.
- `MOCK_GROUPS` → real `groups` wiring for admissions intake depends on `groups` itself having real, non-empty usage first, which is a separate, unscoped question from Teachers but similarly not yet ready to act on.

## 13. Final "PostgreSQL Source-of-Truth Readiness" Assessment

**Identity/authorization**: fully ready — re-verified this session, no gaps found beyond the two already-flagged, small, independent follow-ups from the previous verification audit (frontend 401 handling; `wa_report_log`/`admission_system_log` write-hardening).

**Business data**: **not yet fully ready**, and more precisely so than prior reports stated. Two categories:
- Domains where the *mechanism* is already correct and Postgres is already the practical source of truth for anything that reaches it (students, groups-the-mechanism, attendance, exams, homework, inventory ledger, communications, admissions core, the full financial domain, activity logs) — but where **Postgres itself is currently almost empty** (see §1), so "authoritative" today mostly means "correctly wired for whenever real data starts flowing through it," not "already holding the real data."
- Domains where the mechanism itself is still local-only regardless of what Postgres holds: `materials` (no backend at all), `parentExtras` (backend exists, unused), `matDist` (write real, read stale), and the admissions-intake `MOCK_GROUPS` disconnect.

The rule *"PostgreSQL is the authoritative source of truth for business data"* is **true as an architectural direction and mostly true as implemented for the 23 correctly-caching domains**, but **not yet true in practice** for `materials`, `parentExtras`, and the `groups`↔admissions-intake connection, and **not yet tested against real volume** for anything else, since the live database currently holds almost no real rows.

---

## 14. Comparison Against Previous Reports — What's Obsolete, What's Corrected

- **`DATA_LAYER_CODE_QUALITY_ASSESSMENT.md`**: its `teachers`/`matDist` framing is superseded in precision, not in conclusion, by this audit and by the stabilization work's own contract report. Its characterization of `parentExtras` as a small, low-risk local field is now **materially corrected**: this audit found the real Postgres `parents` table already has the matching columns — a stronger, more actionable finding than "low risk local field" implied.
- **`POST_MIGRATION_STABILIZATION_AUDIT.md`** and **`POST_MIGRATION_STABILIZATION_AUTH_CONTRACT.md`**: their identity/authorization findings are confirmed still accurate (re-verified independently, not reused on trust) and are unaffected by this persistence-focused audit.
- **`IDENTITY_RECONCILIATION_AUDIT.md`**: its central limitation — "this audit cannot see into any real browser's local storage" — is now shown to apply equally to **business data**, not only identity data (see §1's Postgres row-count finding). This is a generalization of that report's finding, not a correction of it.
- **`STABILIZATION_AUTH_IDENTITY_IMPLEMENTATION.md`** and **`POST_STABILIZATION_VERIFICATION_AUDIT.md`**: fully consistent with what this audit re-confirmed for auth persistence (§4); no contradictions found.
- **One correction to this engagement's own prior characterization of the Zustand `teachers` slice** (previously described in the stabilization contract as "a real, correctly boot-synced mirror of Postgres `teachers`... with zero consumers"): this audit traced the actual boot-sync code (`db.middleware.js`/`useDB.jsx`) and found that because the fetch-and-merge step only ever applies a collection when the server returns **at least one row**, and Postgres `teachers` has zero rows, the Zustand store's `teachers` key **is never actually set into runtime state at all** under current data — it is not "an unused but present mirror," it is a code path that has never yet executed its assignment. Same practical conclusion (nothing depends on it, nothing is at risk), but a more precise mechanism than previously stated.

---

**No code, schema, database, or localStorage was modified to produce this report. Stopping here per instruction — no recommendation in this report has been implemented.**
