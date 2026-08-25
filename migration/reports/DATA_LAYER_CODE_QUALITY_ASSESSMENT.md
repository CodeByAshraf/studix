# Data Layer & Code Quality Assessment

**Status: ASSESSMENT ONLY. No application code, schema, or data was modified to produce this report.** Every claim below is labeled **[FACT]** (directly verified against live code/schema/DB this session — file and line cited), **[RISK]** (an inferred or theoretical concern, not directly proven), or **[RECOMMENDATION]** (a suggested direction, not a decision). This document does not authorize any implementation — it is a baseline snapshot to inform whether/how to continue Phase 3B-15 and beyond.

Methodology: four parallel read-only investigations covering (a) core + academic domains, (b) inventory + communication + admissions-core domains, (c) a complete localStorage/persistence inventory, and (d) backend code quality across every route file not authored in Phase 3B-14/15 — combined with direct, first-hand investigation (this session) of the financial domain, activity log, database-wide constraint/trigger inventory, and authentication/authorization code, both of which the assessor implemented directly in the immediately preceding phases.

---

## 1. Executive Summary

The application is **substantially, but not completely, migrated to PostgreSQL**. Of the domains that matter for day-to-day business operation, the overwhelming majority (students, groups, attendance, exams, grades, homework, materials catalog, inventory ledger, communications, admissions core, and the entire financial domain built across Phases 3B-14A–D and 3B-15) are genuinely PostgreSQL-authoritative: real tables, real server-truth-first write paths, real boot-sync. A small number of domains are **intentionally, permanently local-only** (`users`/`roles`/`teachers` — explicitly excluded from migration since Phase 1; UI theme; login rate-limiting) and this appears to be a deliberate, documented decision, not an oversight.

However, three findings are significant enough to weigh before treating the application as fully "PostgreSQL authoritative":

1. **`teachers` is read-real but write-fake** — the table boot-syncs from Postgres, but every teacher create/update/delete in the UI is a pure local mutation that never reaches the server. A teacher created today will vanish the next time the real (empty) Postgres table is synced down, or be silently shadowed by it.
2. **Authorization is enforced almost entirely in the frontend.** Only two collections (`activityLogs`, `centerProfile`) have server-side role checks (`requireRole('admin')`). Every other route — including every financial write path built across 3B-14 — accepts any authenticated session regardless of role. A non-admin's session token, used directly against the API (bypassing the UI), has effectively admin-equivalent write access to the entire business domain.
3. **A blanket `localStorage['studix-v1']` mirror exists for every single top-level state key**, including domains that are now fully Postgres-authoritative. This is currently low-risk (the boot-sync merge never lets local-only rows silently overwrite something the server already confirmed), but it means "PostgreSQL authoritative" is not yet an architectural guarantee for any domain — it's the current, mergeable behavior of a system that still treats the browser as a legitimate second copy of everything.

Code quality is generally strong and improved markedly across the Phase 3B-14/15 work specifically (atomic transactions, session-derived identity, no client-trusted `created_by`, deterministic concurrency proofs). The database schema is well-designed with consistent CHECK-constraint discipline. The main gaps are architectural/security (authorization scope, a hardcoded default admin password shipped in source, no server-side login rate-limiting) rather than correctness bugs in the migrated code itself.

**Recommendation (detailed in §16): Option B — pause new phases briefly to address the `teachers` write gap and the authorization scope gap, both of which are cheap to fix and get materially worse the longer they're left, before resuming Phase 3B-15's remaining call-site rollout or any new domain.**

---

## 2. Current Architecture

**[FACT]** Backend: Express + Prisma over PostgreSQL (`studix`, 27 tables). A generic CRUD router (`backend/src/routes/crud.js`) auto-registers every table in `backend/src/routes/collections.js`'s `COLLECTION_MODELS` map; `writable`/`preserveClientId`/role-gating are configured per-collection in `backend/src/server.js` via three sets (`READ_ONLY_COLLECTIONS`, `PRESERVE_CLIENT_ID_COLLECTIONS`, `ADMIN_ONLY_COLLECTIONS`). Composite or business-rule-heavy writes get a dedicated route file, mounted before the generic loop, each exporting its core logic as a standalone testable function (an established, consistently-applied pattern from `attendanceSessions.js` through `admissionCancellation.js`/`activityLogs.js`).

**[FACT]** Frontend: Zustand store (`src/store/app.store.js`) composed from 13 slice files (`src/store/slices/*.js`), each merged via spread. A `useApp()` compatibility shim (`src/store/index.js`) exists for pre-Zustand-migration components. A second, older, fully-superseded Context implementation (`src/context/AppContext.jsx`) still exists in the tree but has **zero remaining importers** (§8) — its own header comment claiming "56 components still import this" is stale.

**[FACT]** Boot sequence: `src/hooks/useDB.jsx` / `src/store/db.middleware.js` fetch every collection in `PG_COLLECTIONS` from Postgres on boot and merge it into local state via `mergeById` (local-only rows are always kept; Postgres rows always win on id collision; Postgres being empty never erases local history). This merge behavior is a deliberate, documented safety choice from early in the migration, still governing every domain today, migrated or not.

**[FACT]** Auth: session identity is a signed (HMAC-SHA256), `httpOnly` cookie (`backend/src/lib/session.js`), carrying only `{id, role}`, verified via `requireAuth` on every protected route. Every dedicated write path built in this migration correctly derives `created_by`/`user_id`/actor identity from `req.user`, never from the request body.

---

## 3. Domain Migration Matrix

Legend: 🟢 PostgreSQL Real · 🟡 Hybrid · 🟠 Local Persistence · 🔴 Mock/Demo · ⚪ Static/Config

| Domain | DB Table | Real Read | Real Write | Local Persistence | Mock Data | Classification | Remaining Work |
|---|---|---|---|---|---|---|---|
| students | `students` | ✅ | ✅ | mirrored (studix-v1) | none | 🟢 | none |
| groups | `groups` | ✅ | ✅ | mirrored | none | 🟢 | none |
| **teachers** | `teachers` | ✅ (boot-synced) | ❌ (100% local mutation) | authoritative in practice | none | 🟡 | **build the real write path — see §12** |
| parents | `parents` | ✅ | — (by design, bulk-import only) | mirrored | none | 🟢 (read) | confirm intentional; consider whether a real write path is ever needed |
| users | *(none — excluded)* | ❌ | ❌ | ✅ authoritative | seed admin `admin123` | 🟠 | intentional per Phase 1 scope decision — re-confirm still desired |
| roles | *(none — excluded)* | ❌ | ❌ | ✅ authoritative | none | 🟠 | same as users |
| centerProfile | `center_profile` | ✅ | ✅ (partial) | one field (`slogan`) permanently local by design | none | 🟡 | none — already a closed, documented decision (Phase 3B-10) |
| attendance | `attendance` | ✅ | ✅ (atomic session replace) | mirrored | none | 🟢 | none |
| absenceFollowup | `absence_followup` | ✅ | ✅ | mirrored | none | 🟢 | none |
| exams | `exams` | ✅ | ✅ (atomic cascade delete) | mirrored | none | 🟢 | none |
| grades | `grades` | ✅ | ✅ (atomic roster save) | mirrored | none | 🟢 | none |
| homeworks | `homeworks` | ✅ | ✅ (atomic cascade delete) | mirrored | none | 🟢 | none |
| hwSubmissions | `hw_submissions` | ✅ | ✅ (atomic roster save) | mirrored | none | 🟢 | none |
| invMaterials | `inv_materials` | ✅ | ✅ | mirrored | none | 🟢 | none |
| inventoryTxn | `inventory_txn` | ✅ | ✅ (via atomic material-distribution endpoint only) | mirrored | none | 🟢 | remove the dead local `addInventoryTxn` action (cosmetic) |
| inventorySettings | `inventory_settings` | ✅ | ❌ (no UI, dead local action) | n/a | none | ⚪ | build a save UI, or explicitly declare this config-only |
| **matDist** | *(none — derived cache of `inventory_txn`)* | partial | ✅ (writes real `inventory_txn`) | ❌ **not boot-synced, but read as if it were** | none | 🟡 | **fix stale reads — see §12** |
| communications | `communications` | ✅ | ✅ (create only) | mirrored | none | 🟢 | none |
| commTasks | `comm_tasks` | ✅ | ✅ (create only) | mirrored | none | 🟢 | no status-transition UI exists (feature gap, not data-layer) |
| waReportLog | `wa_report_log` | ✅ | ✅ | mirrored | none | 🟢 | none |
| admissions (core) | `admissions` | ✅ | ✅ | mirrored | none | 🟢 | no append-only trigger, unlike its own child tables (§7) |
| admissionFollowups | `admission_followups` | ✅ | ✅ | mirrored | none | 🟢 | none |
| admissionSystemLog | `admission_system_log` | ✅ | ✅ | mirrored | none | 🟢 | none |
| cashboxes | `cashboxes` | ✅ | ✅ | mirrored | one seeded default (`cb_main`, legitimate config) | 🟢 | none |
| treasuryTxn | `treasury_txn` | ✅ | ✅ (atomic) | mirrored | none | 🟢 | none |
| payments | `payments` | ✅ | ✅ (atomic) | mirrored | none | 🟢 | none |
| admissionPayments | `admission_payments` | ✅ | ✅ (atomic) | mirrored | none | 🟢 | none |
| activityLogs | `activity_logs` | ✅ | ✅ | mirrored | none | 🟢 | 27 call sites migrated (Phase 3B-15) |
| **parentExtras** (frontend-only, no table) | — | — | — | ✅ authoritative | none | 🟠 | intentional CRM-layer concept, not a migration candidate as-is |
| **login rate-limit** (frontend-only) | — | — | — | ✅ local counter | none | ⚪ | intentional, but trivially bypassable (§9) |
| UI theme | — | — | — | ✅ local | none | ⚪ | correctly local, no action needed |
| auto-backup snapshot | — | — | — | write-only, never read | none | ⚪/dead | harmless but pointless — never consumed (§4/§11) |

---

## 4. Complete LocalStorage Inventory

**[FACT]** Seven distinct storage keys exist across the frontend:

| Key | Owner file(s) | What it stores | Authoritative? | Postgres equivalent | Divergence risk |
|---|---|---|---|---|---|
| `studix-v1` | `app.store.js` (Zustand `persist`, whole-store) | **Every** top-level state key across all 13 slices — confirmed zero exclusions | Was fully authoritative pre-migration; now a redundant mirror for every migrated domain | Yes, for most domains now | Low today (merge always prefers server rows on id match), but structurally this means no domain has actually been architecturally "cut over" — see §14 |
| `tc_session` | `auth.context.jsx` | Current logged-in user snapshot | Yes (session identity) | n/a | none, tab-scoped |
| `tc_login_attempts` | `auth.context.jsx` | Failed-login counter per user id, drives lockout | Yes | none | none directly, but see §9 (trivially bypassable) |
| `studix-auth-users` / `-teachers` / `-roles` | `auth.context.jsx` | Full users/teachers/roles arrays | **Yes — the only copy** | tables exist, unused for this path | High in theory, moot in practice — there is no second copy to diverge from |
| `tc_center_profile` | `centerProfile.slice.js` | Center profile fields, incl. the one permanently-local field (`slogan`) | Partial | `center_profile` real for the rest | Low (by design, Phase 3B-10) |
| `tc_theme` | `ui.context.jsx` | UI theme preference | Yes | n/a | none |
| `studix_autobackup` | `app.store.js`'s `saveAutoBackup`, triggered by `data.context.jsx` | Snapshot of 6 domains | **No — write-only, never read back anywhere** (grep-confirmed) | all 6 domains real | n/a — dead-end, not a source of truth |
| `tc_error_log` | `ErrorBoundary.jsx` | Last 20 crash reports | Yes, diagnostic only | none, none proposed | n/a — intentionally local |

**[FACT — config drift]** `src/config/app.config.js`'s `STORAGE_KEYS.AUTOBACKUP` (`'tc_autobackup_v2'`) is defined but never used — the real code uses the literal `'studix_autobackup'` instead, a different string. `LOG_CONFIG.STORAGE_KEY` (`'tc_activity_log'`) is now fully orphaned since Phase 3B-15 rewrote `activity.slice.js` to stop touching that key. Both are dead configuration, not bugs, but a maintainability smell (the constants lie about what's actually used).

**[FACT]** No IndexedDB usage exists anywhere in the frontend. No other persistence mechanism was found beyond the above.

---

## 5. Remaining Mock/Local Data — the critical list

Per the assessment's own framing, this is the most important deliverable. Each entry: what it stores, why it exists, intentional or not, migration target, and whether migration is blocked.

1. **`users`/`roles`/`teachers` full local authority.** Stores: login credentials (including a **hardcoded plaintext-looking default admin password, `admin123`**, shipped in `src/data/initialData.js:37,109`), role/permission definitions, teacher roster. **Intentional** — explicitly documented as out of Phase 1 scope. **Should it be migrated?** Real tables already exist for all three; the decision to exclude them was presumably about auth-model complexity, not technical infeasibility. **Owning table if migrated:** `users`/`roles`/`teachers` (already exist, already have real FKs from `admissions`/`treasury_txn`/`activity_logs`/`groups` pointing at `users.id`/`teachers.id`). **Blocked by:** an explicit, not-yet-revisited architectural decision from early in the migration — not a technical blocker.

2. **`teachers` specifically (write side)** — this is a narrower, more urgent case than the general users/roles exclusion: the boot-sync READ side already trusts Postgres, while the WRITE side is 100% local, meaning the two are actively diverging every time a teacher is added/edited in the UI. **Not clearly intentional** — nothing in the code documents this as a deliberate stopping point the way the broader users/roles exclusion is documented. **Should be migrated:** yes, this looks like unfinished work, not a decision. **Owning table:** `teachers` (already exists, already boot-synced). **Blocked by:** nothing technical — no `pgCreateTeacher`/`pgUpdateTeacher`/`pgDeleteTeacher` exist in `api.js`; this is a straightforward gap to close, same shape as any other already-migrated simple CRUD domain (mirrors `groups`' own pattern almost exactly).

3. **`matDist` (material distribution display cache).** Stores: a denormalized "who received/paid for which material" view. **Why it exists:** legitimate performance/display cache for `MaterialDistribution.jsx`'s own write flow (which is correctly server-truth-first). **Is it intentional to be un-synced?** No evidence of a deliberate decision — appears to be an oversight: it was never added to `PG_COLLECTIONS`, so two real read consumers (`MaterialDistribution.jsx`'s own "already distributed?" check, and `StudentReportPage.jsx`'s materials section) silently return stale/empty data after a refresh, even though the real, correct data (`inventory_txn`) is sitting in Postgres, boot-synced correctly. **Owning table if fixed:** derive `matDist`'s two read consumers from the already-real, already-synced `inventoryTxn` state instead of the separate local-only cache (or add `matDist` reconstruction logic to the boot-sync path). **Blocked by:** nothing architectural — a bounded, well-scoped fix.

4. **`inventorySettings`.** Stores: inventory-wide configuration. **Why local-only in effect:** no write path was ever built (dead local action, `updateInventorySettings`, zero call sites). **Intentional?** Unclear — could be an unfinished feature or a deliberate "not needed yet" state; the code gives no signal either way. **Owning table:** `inventory_settings` (already real, already boot-synced, singleton-row pattern already proven for `center_profile`). **Blocked by:** nothing technical, just not yet built.

5. **`parentExtras`.** Stores: CRM-layer notes/metadata keyed by a derived (not real-table) parent identity, used only by `parentService.js`'s `deriveParents()` — a synthesized, frontend-only "parent" concept distinct from the real `parents` table. **Intentional** — this is a genuinely different concept (a CRM view over students/admissions/communications grouped by phone) than the real `parents` table (populated by one-time bulk import, used for FK relationships). **Should it be migrated:** only if the CRM notes themselves need to survive across devices/browsers — currently a UX nice-to-have gap, not a data-integrity one. **Naming risk:** the coexistence of `parentService.js`'s synthesized "parent" and the real `parents` table under very similar names is a genuine confusion risk for future maintainers (§8).

6. **`studix_autobackup`.** Write-only, never read. **Not a real persistence layer at all** — dead weight, harmless, but pointless. Candidate for removal (not done here, per the no-changes rule) or for being wired into an actual restore feature if one was ever intended.

7. **Login rate-limiting (`tc_login_attempts`).** Entirely client-side; trivially defeated by clearing storage or calling `POST /api/session` directly. **Intentional as a UX deterrent, not a security control** — but nothing in the code documents it as "UX-only, not a real defense," so it could be mistaken for one. See §9/§11.

---

## 6. Runtime Source-of-Truth Analysis

**[FACT]** For every 🟢-classified domain, the traced path is genuinely: Component → (Zustand action / direct `pg*` call) → `src/services/api.js` → `fetch` (credentials included) → Express route (dedicated or generic CRUD) → Prisma → PostgreSQL, with server-truth-first adoption (no local mutation before the awaited response resolves) — this was directly verified for the financial domain and activity log (built this session and the immediately preceding ones) and independently re-confirmed by both domain-audit forks for every other 🟢 domain.

**[FACT — genuine bypass #1]** `teachers`: Component (`UsersPage.jsx`) → Zustand `setTeachers` → **stops here**. Never reaches `api.js`. The boot-sync path (Component ← `db.middleware.js` ← Postgres) is real and separate — meaning this domain has **two independent, non-communicating write paths converging on the same state key**: one real (Postgres, currently empty), one local-only (whatever the browser has accumulated). Postgres will never see local edits; local edits will be silently reconciled away (not deleted, but shadowed) the next time a real Postgres row with the same id exists.

**[FACT — genuine bypass #2]** `matDist`: Component (`MaterialDistribution.jsx`) → real atomic write (`pgSaveMaterialDistribution`) → **real Postgres write succeeds** → but the READ side for two consumers goes Component → local `matDist` cache only, never Component ← `db.middleware.js` ← Postgres (since `matDist` is absent from `PG_COLLECTIONS`). This is the inverse of the `teachers` problem: writes are real, but part of the read path never rejoins reality after a refresh.

**[FACT — two sources of truth, benign in current form]** Every domain, real or not, is also mirrored into `localStorage['studix-v1']` via the blanket `persist()` whitelist (§4). This is a second source of truth for literally everything, currently kept harmless only by `mergeById`'s specific "server always wins on id match, local-only rows are additive, never subtractive" behavior — a behavior that was designed for the migration's transitional period, not stated anywhere as a permanent architectural guarantee.

---

## 7. Database Quality Assessment

### Good design decisions already present [FACT]

- **Consistent, disciplined CHECK-constraint usage** across nearly every table with a bounded-vocabulary or bounded-range column (verified via a full live query of all CHECK constraints in the database — 40+ constraints spanning `attendance`, `exams`, `grades`, `groups`, `homeworks`, `hw_submissions`, `students`, `communications`, `comm_tasks`, `admissions`, `admission_followups`, `admission_system_log`, `admission_payments`, `inv_materials`, `inventory_txn`, `cashboxes`, `payments`, `treasury_txn`, `center_profile`, `inventory_settings`). This is not limited to the financial domain built most recently — it's a schema-wide, long-standing discipline.
- **Singleton-row tables enforced by CHECK, not convention** (`center_profile`/`inventory_settings`, both `CHECK (id = 1)`) — a clean, DB-enforced way to prevent a config table from ever holding more than one row.
- **UNIQUE constraints on every natural key that needs one**: `students.code`, `admissions.number`, `communications.number`, `inv_materials.code`, `inventory_txn.number`, `parents.phone`, plus meaningful composite uniques (`attendance(student,date,group)`, `grades(exam,student)`, `hw_submissions(homework,student)`, `absence_followup.attendance_id`).
- **Append-only protection applied deliberately, not universally, to the tables where it matters**: `activity_logs`, `admission_payments`, `admission_system_log`, `communications`, `inventory_txn`, `payments`, `treasury_txn` all have unconditional `trg_no_delete_*` triggers. This correctly distinguishes "ledger/audit-trail records that must never disappear" from ordinary mutable business records (students, groups, exams — which correctly have no such protection, since editing/correcting them is a legitimate operation).
- **Real FKs everywhere a relationship exists**, all `NoAction` (never silently cascading a delete), which correctly forces the application layer to make an explicit decision about dependent rows rather than losing data by surprise — and several pages (`StudentsPage.jsx`, `GroupsPage.jsx`) do implement exactly this kind of pre-delete dependency check.
- **`created_by`-style columns follow a consistent "real FK + optional denormalized display name" pattern** (`treasury_txn.created_by`/`created_by_name`, `admissions.created_by`, `activity_logs.user_id`/`user_name`) — and, as of this session's own implementation, every write path that populates these correctly derives them from the session, never the client.
- **Decimal types used correctly for every monetary column** (`@db.Decimal(12,2)` throughout) — no floating-point money anywhere in the schema.

### Remaining database risks [FACT / RISK]

- **[FACT]** `admissions` has no append-only protection, while its own child tables (`admission_payments`, `admission_system_log`) do. A fresh admission with zero child rows today has no guard at any level against a raw `DELETE /api/admissions/:id` (no DB trigger; confirmed no dedicated app-level guard either). Once child rows exist, the FK relationship would block it — but the empty-admission window is real and inconsistent with the pattern applied to its own children.
- **[FACT]** `hw_submissions.score` and (unconfirmed either way, not independently re-verified this session) `grades.score` have no CHECK constraint bounding valid values — the only floor is application-level logic in the dedicated route files. If that logic ever has a bug or a future code path bypasses it, nothing at the DB layer would catch an out-of-range score.
- **[RISK]** The generic CRUD path (`crud.js`) has **no validation floor of any kind** beyond whatever CHECK constraints exist — for any writable column without a CHECK, the frontend's own request shape is the only gate. This is consistent with the schema's own generally-good CHECK coverage, but it means any future column added without a matching CHECK is silently unguarded at the DB layer.
- **[FACT]** `cashboxes` has no DB-level delete protection (by explicit, already-documented Phase 3B-14A decision — an app-level 405 guard substitutes for it). This is a known, deliberate exception, not an oversight, but it is the one place in the financial domain relying on app-level-only enforcement rather than DB-level.

---

## 8. Backend Code Quality Assessment

### Strong, consistent patterns [FACT]

- Every dedicated atomic route (from `attendanceSessions.js` through the full Phase 3B-14/15 series) follows the same shape: export the core logic as a standalone function, wrap composite writes in `runInTransaction` with the decisive read inside the transaction, derive identity from `req.user` only. This consistency is a genuine architectural strength — a new contributor can predict the shape of any new dedicated route by reading two or three existing ones.
- `middleware/errorHandler.js` centralizes Prisma error translation (unique/FK/not-found/CHECK violations) into friendly, consistent JSON error shapes, and never leaks raw internals for unexpected errors.
- `materialDistribution.js`'s sequence-number generation correctly retries once on a real UNIQUE conflict rather than ignoring the race — a deliberate, documented mitigation (with a small, explicitly-acknowledged residual gap: a third simultaneous writer during the retry window is unhandled).

### Confirmed issues [FACT]

- **`crud.js`'s `prepareWriteData` silently drops any client field with no matching DB column** — the exact mechanism that caused the `description`/`notes` silent-data-loss bug found and fixed during Phase 3B-14B's own verification, and structurally still present for every table that goes through generic CRUD. Every dedicated route in this migration has had to work around this per-table; the underlying generic behavior itself was never changed (correctly, since fixing it in one place could have unpredictable effects on 20+ already-working collections — but it remains a standing risk for any future field added to a generic-CRUD table without updating both the frontend and being aware of this silent-drop behavior).
- **`errorHandler.js`'s CHECK-violation-name recovery parses a Rust-debug-escaped string**, self-documented as non-structured — a Prisma engine version bump could silently degrade this to a generic 500 message without any test catching it (no test currently exercises this specific fallback path).
- **`session.js`'s cookie is `secure: false`**, with an explicit, correct comment that this must change for HTTPS deployment — a real, concrete pre-production checklist item, not a bug in local development.
- **No server-side rate-limiting on `POST /api/session`** — the only brute-force deterrent is a client-side `localStorage` counter, trivially bypassed by any direct API caller.
- **`GET /health` is unauthenticated** and discloses host/port/database name/username (not the password) and live table counts to any caller — a minor information-disclosure surface, a common and often-acceptable tradeoff for infrastructure health checks, but worth a deliberate decision rather than a default.
- **Authorization scope**: `requireRole` is used in exactly two places in the entire backend (`activityLogs`, `centerProfile`). Every other route, including every financial write path, is reachable by any authenticated session regardless of role. This is the single most consequential backend finding in this assessment (elaborated in §10).

### Was 3B-14 code better or worse than the rest? [FACT]

**Better**, on every axis checked: it is the only part of the backend with proven (not just reasoned-about) concurrency safety, the only part with a documented, repeatable DB-verification methodology (disposable scratch databases, before/after row counts), and the only part where a real bug (the reversal race, the double-cancellation race) was found, fixed, and proven fixed before being called done. The older dedicated routes (`examDelete.js`, `homeworkDelete.js`) have a minor, lower-severity version of a similar pattern (an existence check outside the transaction, before a separate atomic cascade-delete) that was never revisited with the same rigor — not a proven defect, but a lower bar than what 3B-14 later established.

---

## 9. Frontend Code Quality Assessment

**[FACT]** The frontend has **substantially converged** toward granular Zustand selectors. The old monolithic `useApp()` compatibility shim (`src/store/index.js`) has exactly **one remaining live consumer** (`Dashboard.jsx`) — the other two files that still call it (`hooks/usePayments.js`, `hooks/useStudents.js`) were independently confirmed dead (zero importers) during Phase 3B-14C/15's own investigations. A separate, older Context-based implementation (`src/context/AppContext.jsx`) is **fully dead** (zero importers) despite its own header comment claiming 56 live consumers — that comment is stale, not current.

**[FACT — dead code inventory, confirmed this session]**: `hooks/usePayments.js`, `hooks/useAttendance.js`, `hooks/useStudents.js` (zero importers each); `treasury.slice.js`'s former `addLinkedTxn`/`reverseLinkedTxn` (removed in 3B-14C after confirmation); `inventory.slice.js`'s `addInventoryTxn` and `updateInventorySettings` (zero call sites); `data/initialData.js`'s `ROLES` constant (superseded by `INITIAL_ROLES`, zero importers); `src/context/AppContext.jsx` (zero importers); `students.slice.js`'s `updateStudent`/`removeStudent` actions (shadowed by a same-named but unrelated helper import in `StudentsPage.jsx`, creating a naming collision rather than outright dead code).

**[FACT]** Naming collisions exist between unrelated concepts sharing a name: `store/app.store.js`'s raw-selector `usePayments`/`useAttendance` exports vs. the dead hook files of the same name; `parentService.js`'s synthesized CRM "parent" concept vs. the real `parents` table.

**[FACT]** Server-truth-first discipline is consistently applied in every domain built or touched during this migration series (no local mutation before an awaited server response resolves; adoption of the full server response on success; explicit failure surfacing without silent local fallback, most recently and explicitly enforced for `activityLogs` in Phase 3B-15). This is not universal in older, not-yet-touched code (`teachers`' local-only mutations are optimistic by construction, since there's no server round-trip at all).

**[RISK]** Business logic embedded in components rather than shared services exists in a few places (e.g., `PaymentForm.jsx`'s subscription/material duplicate-payment warnings are client-only convenience checks, correctly not treated as authoritative — this is fine as designed, but worth confirming this pattern is understood consistently, not accidentally relied upon as validation).

---

## 10. Authentication/Authorization Assessment

**[FACT]** Identity source: a signed, `httpOnly`, HMAC-verified session cookie (`backend/src/lib/session.js`), carrying `{id, role}` only, verified via `crypto.timingSafeEqual`. `req.user` is populated exclusively from this verified token — never from any client-supplied header/body field. Every dedicated write path in this migration correctly uses `req.user.id` for `created_by`/`user_id`-style fields.

**[FACT]** Password verification: PBKDF2-SHA256, 100,000 iterations, per-password salt, constant-time comparison (`backend/src/lib/passwordVerify.js`) — sound, standard practice.

**[FACT — real finding]** Role enforcement (`requireRole`) exists in exactly **two** places: `activityLogs` and `centerProfile`. Every other collection and every dedicated route (including every financial write path: payments, treasury_txn, cashboxes, admission_payments, admission cancellation) is guarded only by `requireAuth` (a valid session of *any* role). The frontend's own `roles`/`permissions` model (`ROLES`/`INITIAL_ROLES` in `initialData.js`, `canAccess()` in `auth.context.jsx`) — which defines, for example, a "teacher" role restricted to `dashboard/attendance/exams` — has **no server-side enforcement counterpart** for any of that restriction. A teacher's own valid session, called directly against the API rather than through the UI, can create payments, cancel admissions, or write to any non-admin-only collection.

**[FACT]** Activity/audit logs (`activity_logs`) cannot be spoofed for *identity* — `user_id`/`user_name` are always session-derived, verified via direct DB testing this session (a spoofed client-supplied `user_id` is overridden server-side, and a genuinely nonexistent one is rejected by the real FK on insert). `action`/`module`/`entity_type`/`entity_id`/`details` **are** fully client-controlled with no validation — a real but low-severity gap, since the row is still correctly attributed to its real, authenticated author; a user can only write misleading *content* to their own attributed entries, not impersonate someone else.

**[FACT]** Tenant/ownership enforcement: this application has no multi-tenancy concept, so the question doesn't directly apply — but the same principle applies laterally: nothing prevents an authenticated non-admin user from reading or writing another user's/student's/admission's data via direct API calls, since row-level ownership is not checked anywhere server-side (the frontend simply doesn't expose UI for it).

**[RISK]** Login brute-force protection exists only client-side (`localStorage` counter) — trivially defeated.

**[FACT]** A hardcoded, plaintext-looking default admin password (`admin123`) is shipped in `src/data/initialData.js` as the local-only seed fallback for the (out-of-migration-scope) `users` domain. Whether any live deployment still uses this literal value was not (and should not be) probed by this assessment — flagged as a source-level fact only.

---

## 11. Test Quality Assessment

**[FACT]** 23 test files, 153 tests, all currently passing. Coverage is strong and consistently present for every domain touched by this migration series (students, groups, exams, grades, homework, attendance, absence follow-up, materials/inventory distribution, communications, admissions core + activation + payments + cancellation, the full financial domain, activity log) — each with at least one dedicated write-path contract test using the established "mock `fetch` directly, assert exact request/response shape, assert no premature local mutation" technique.

**[FACT — coverage gaps]** No test file exists for: `UsersPage.jsx` (the entire users/teachers/roles domain — consistent with it being local-only and out of scope, but means the confirmed `teachers` write gap, §12, is also untested); `ActivityLogPage.jsx`/`Dashboard.jsx` as display components (lower risk — read-only, and their data shape is exercised indirectly by the tests that populate `activityLogs`/other domains); `inventorySettings` (no write path exists to test); `matDist`'s stale-read behavior (the bug itself, §5 item 3, has no regression test — meaning if this is fixed later, there's no existing test that would have caught the original problem or would prevent a regression).

**[FACT]** The concurrency-proof tests built for Phase 3B-14B/D (deterministic scratch-database races, proven not asserted) are a genuine strength — not common practice, and directly responsible for catching two real bugs (a reversal race, a double-cancellation race) before they reached production. No equivalent test exists for `materialDistribution.js`'s own documented residual concurrency gap (a third simultaneous writer during its retry window) — consistent with that gap being explicitly flagged as low-probability and not yet proven to have occurred, rather than a known live bug.

---

## 12. Code Quality Scores

Scored out of 10. Not inflated because tests pass — scores reflect the full picture including the gaps above.

| Category | Score | Why |
|---|---|---|
| Architecture | 7/10 | Consistent, well-documented dedicated-route pattern; clean separation of generic vs. composite writes. Docked for the blanket localStorage mirror and the two-independent-write-paths pattern (`teachers`) that architecture alone doesn't prevent from recurring. |
| Database design | 8/10 | Excellent CHECK-constraint discipline, correct Decimal usage, deliberate append-only protection where it matters, real FKs everywhere. Docked for the `admissions` append-only gap relative to its own children and the un-tested `hw_submissions.score` bound. |
| Backend quality | 7/10 | Strong, consistent, well-tested dedicated-route pattern with proven concurrency safety in the newest work. Docked for the authorization-scope gap (the most consequential finding in this report), the `secure:false` cookie flag, and no server-side rate-limiting. |
| Frontend quality | 7/10 | Real, substantial convergence toward granular Zustand selectors (only one live `useApp()` consumer left); consistent server-truth-first discipline everywhere it's been built. Docked for confirmed dead code, naming collisions, and the `teachers`/`matDist` gaps. |
| Data integrity | 7/10 | Every migrated domain has real, proven-atomic integrity (financial domain especially). Docked specifically for `teachers` (silent write-path divergence) and `matDist` (stale reads of otherwise-correct data). |
| Security | 5/10 | Sound password hashing and session signing. Significantly docked for the authorization-scope gap (any authenticated session, any role, can write to almost everything via direct API access) and the hardcoded default credential in source — both are the kind of finding that matters regardless of how trusted the current user base is. |
| Error handling | 8/10 | Centralized, friendly, consistent error translation; explicit non-blocking-secondary-action pattern applied correctly and repeatedly (activity log, system log). Docked slightly for the fragile CHECK-violation-name recovery mechanism. |
| Test coverage/quality | 8/10 | Strong, consistent contract-testing convention; genuine concurrency proofs, not assertions. Docked for the gaps named in §11 (`teachers`, `matDist`, `inventorySettings`). |
| Maintainability | 7/10 | Extensive, genuinely useful Arabic comments explaining *why*, not just *what*, throughout the newer code. Docked for stale comments (the `AppContext.jsx` "56 components" claim, the renamed-but-uncommented `admissionPaymentsLocal` constant), orphaned config constants, and the two role-shape duplication (`ROLES` vs `INITIAL_ROLES`). |
| Migration completeness | 8/10 | The large majority of meaningful domains are genuinely real; the two concrete gaps (`teachers`, `matDist`) are both small and well-scoped, not systemic. See §15 for the full breakdown. |

**Overall: 7.2/10.** A genuinely well-engineered, actively-improving codebase with a small number of specific, fixable gaps — not a codebase with a systemic quality problem. The financial domain specifically (3B-14/15) represents the strongest work in the repository; the main outstanding risks are in older, not-yet-revisited code and in a cross-cutting architectural decision (authorization scope) that no single phase was ever asked to address.

---

## 13. Technical Debt

### Critical
*(can cause data loss, financial corruption, security problems, or serious integrity violations)*

1. **Authorization is not enforced server-side for almost anything.** *Location:* `backend/src/server.js` (`ADMIN_ONLY_COLLECTIONS`), every dedicated route file. *Impact:* any authenticated session, regardless of role, has effectively full read/write access to the entire business domain (including financial writes) via direct API calls, bypassing whatever the frontend hides. *Recommended direction:* define and enforce a real role-to-collection/route permission map server-side, reusing the frontend's existing `ROLES`/`canAccess` model as the starting point rather than inventing a new one. *Blocks further migration:* no, but should be prioritized before adding more roles/permissions surface area.
2. **`teachers` writes are 100% local while reads are real** — a genuine, unremarked data-loss risk (local edits are never persisted server-side and will be silently reconciled away). *Location:* `src/modules/users/UsersPage.jsx`, no matching `api.js` functions. *Recommended direction:* build `pgCreateTeacher`/`pgUpdateTeacher`/`pgDeleteTeacher`, mirroring the already-proven `groups` pattern almost exactly. *Blocks further migration:* no, self-contained.

### High
*(can cause meaningful incorrect behavior or architectural instability)*

3. **`matDist` stale-read bug** — two real UI consumers show incorrect/empty data after a browser refresh despite the underlying data being correctly in Postgres. *Location:* `src/modules/materials/MaterialDistribution.jsx`, `src/modules/student-report/StudentReportPage.jsx`, `src/store/db.middleware.js` (`PG_COLLECTIONS` missing `matDist`). *Recommended direction:* derive both read sites from the already-synced `inventoryTxn` state instead of the local-only cache. *Blocks further migration:* no.
4. **Hardcoded default admin password in source** (`admin123`). *Location:* `src/data/initialData.js`. *Recommended direction:* at minimum, a documented forced-change-on-first-login flow; ideally removed from source entirely in favor of a setup-time prompt. *Blocks further migration:* no.
5. **No server-side login rate-limiting.** *Location:* `backend/src/routes/session.js`. *Recommended direction:* move the lockout logic server-side (it already exists client-side, so the business logic doesn't need to be redesigned, just relocated and made authoritative). *Blocks further migration:* no.
6. **`admissions` lacks append-only protection that its own child tables have.** *Location:* live DB schema. *Recommended direction:* a `trg_no_delete_*` trigger matching the existing family, or an explicit documented decision that this table is intentionally exempt. *Blocks further migration:* no.

### Medium
*(maintainability/design problems that should be addressed)*

7. **Generic CRUD's silent field-drop behavior** (`crud.js`'s `prepareWriteData`) remains a standing risk for any future column added to a generic-CRUD table. *Recommended direction:* at minimum, a code comment/runbook note for future contributors (already implicitly known by every dedicated-route author in this migration, but not written down anywhere generic-CRUD-adjacent).
8. **`inventorySettings` has a real table and real boot-sync read but no write path or UI at all.** *Recommended direction:* either build the save UI or explicitly document this as intentionally read-only for now.
9. **Two duplicate/near-duplicate concepts under confusingly similar names**: `parentService.js`'s synthesized "parent" vs. the real `parents` table; `ROLES` vs. `INITIAL_ROLES`. *Recommended direction:* rename one side of each pair, or remove the dead one (`ROLES`).
10. **Fragile CHECK-violation-name recovery in `errorHandler.js`** depends on an undocumented Prisma error-message string format. *Recommended direction:* a small regression test pinning the current Prisma version's error format, so a future upgrade fails loudly instead of silently degrading.

### Low
*(cleanup, consistency, or cosmetic improvements)*

11. Dead code: `hooks/usePayments.js`, `hooks/useAttendance.js`, `hooks/useStudents.js`, `treasury.slice.js` remnants (already cleaned in 3B-14C), `inventory.slice.js`'s `addInventoryTxn`/`updateInventorySettings`, `src/context/AppContext.jsx`, `ROLES` constant.
12. Orphaned config constants (`STORAGE_KEYS.AUTOBACKUP` unused/wrong value, `LOG_CONFIG.STORAGE_KEY` orphaned since 3B-15).
13. Stale comments: `AppContext.jsx`'s "56 components" claim; `INITIAL_ADMISSION_PAYMENTS_LOCAL`'s comment still describing pre-3B-14D behavior.
14. `studix_autobackup` is write-only and never consumed — either wire it into a real restore feature or remove it.
15. `commTasks` has no status-transition UI despite the DB supporting `pending|completed|cancelled` — a feature-completeness gap, not a data-layer one.

---

## 14. Migration Blockers

**Explicit answer to "what prevents us from confidently declaring the application 'PostgreSQL authoritative'?"**

**Actual blockers** (concrete, must be resolved before the phrase is accurate):
- `teachers`' write-side local-only status (§5/§13 item 2).
- `matDist`'s stale-read gap (§5/§13 item 3).
- The `studix-v1` blanket persist means no domain has an *architectural* guarantee against localStorage divergence — only a behavioral one (`mergeById`'s current merge rule). This is not broken today, but it is not the same thing as "PostgreSQL is authoritative," and should be named honestly as a structural characteristic of the current system, not a past-tense fact.

**Technical debt** (real, but doesn't block the *migration* claim specifically):
- Authorization scope (§10/§13 item 1) — a security posture question, not a data-authority question.
- The database/backend/frontend code-quality items in §13 medium/low.

**Intentional local state** (by design, not a gap):
- `users`/`roles`/`teachers` (except the `teachers` write-gap above), UI theme, login-attempt counter, the `slogan`/`logoUrl` fields on `centerProfile`, `parentExtras`.

**Harmless local caching** (mirrors real data, no divergence risk in practice):
- The `studix-v1` mirror for every already-🟢 domain, given the current merge behavior.
- `tc_error_log`, `tc_session`.

**Future improvements** (not blockers at all):
- `inventorySettings`'s missing write UI, `commTasks`' missing status UI, the dead-code/naming cleanups.

---

## 15. Migration Progress

**Not simply "X of 27 tables."** Multiple denominators, explained:

**Table-level (27 tables, `users`/`roles` excluded by scope decision → 25 in-scope):**
- 22 of 25 in-scope tables: real read + real write (🟢).
- 1 of 25 (`teachers`): real read, fake write (🟡).
- 1 of 25 (`inventorySettings`): real read, no write path (⚪, effectively unreachable for writes).
- `parents`: real read, no write path *by design* (not counted as a gap).
- `users`/`roles`: out of scope by explicit decision, not counted against migration completeness.

**Domain-level (meaningful application features, including frontend-only concepts with no table):**
- Financial domain (cashboxes, treasury_txn, payments, admission_payments): 100% real, atomic, proven concurrency-safe.
- Activity log: 100% real as of this session.
- Academic domain (attendance, exams, grades, homework, submissions): 100% real.
- Admissions (core + activation + cancellation + payments): 100% real.
- Inventory: real except `inventorySettings` (unreachable writes) and `matDist` (read-side gap).
- Communication: real for create; no update/complete UI exists (not a migration gap, a feature gap).
- Users/teachers/roles: 0% migrated, `teachers` specifically regressed relative to its own read-side.

**Real runtime write-path status:** 22 of 25 in-scope tables have a genuinely live, exercised write path reaching Postgres from the UI today (not just a theoretical CRUD route that nothing calls).

**localStorage remaining as a genuine second authority (not just a mirror):** `users`/`roles`/`teachers`' credentials/permissions data, `parentExtras`, UI theme, login-attempt counter — a small, mostly-intentional set.

**Hybrid domains remaining:** `teachers`, `centerProfile` (intentional, closed), `matDist`.

**Mock/demo domains remaining:** none of substance — the only hardcoded data of consequence is the single default admin credential, not business/demo data.

**Percentage, with an explicit denominator:** **~88% (22/25) of in-scope tables are fully real** (read+write); including the two hybrid gaps as "half-done," a more conservative **~90%** weighted completion. This is a meaningfully different, more useful number than "22 of 27," which would incorrectly penalize the migration for two tables (`users`/`roles`) that were never in scope to begin with.

---

## 16. Phase 3B-15 Recommendation

**Recommendation: B — pause new-phase work briefly to close the `teachers` write gap and the authorization-scope gap, then resume.**

Reasoning, not based on remaining-table count:

- Phase 3B-15 itself (activity log) is **already fully implemented and verified** as of the prior session — this recommendation is not about finishing 3B-15's own remaining call sites (there are none remaining; all 27 were migrated). It is about whether to proceed to a **new** phase immediately.
- The `teachers` gap is small, well-understood, and directly analogous to work already done four times over (`groups`, `students`, etc.) — it is cheap to fix and gets *more* expensive to fix the longer real teacher data accumulates locally across browsers with no server copy to reconcile against.
- The authorization-scope gap is not something any single domain-migration phase would naturally surface or fix — it is cross-cutting, and every new phase that adds a new writable collection *widens* the exposure (one more thing reachable by any authenticated session regardless of role) rather than narrowing it. Fixing the pattern once (a role-to-route permission map) is far cheaper now, with ~25 routes, than after several more phases add more.
- Neither of these is large: the `teachers` fix mirrors an existing, proven pattern almost exactly; the authorization fix requires a decision (what should each role actually be allowed to do server-side) more than large amounts of new code, and that decision only gets harder to make cleanly the more routes exist without it.
- Nothing else in this assessment rises to the same urgency — `matDist` and the other findings are real but narrower and don't compound the way these two do.

---

## 17. Top 10 Actions Recommended Next

1. Decide and implement a server-side role-to-route/collection permission model (extending `requireRole` usage beyond the current two collections), reusing the frontend's existing `ROLES` definitions as the starting point.
2. Build the real `teachers` write path (`pgCreateTeacher`/`pgUpdateTeacher`/`pgDeleteTeacher`), mirroring `groups`'s existing pattern.
3. Fix `matDist`'s stale-read gap by deriving its two read consumers from the already-synced `inventoryTxn` state.
4. Move login rate-limiting server-side (the logic already exists client-side and just needs relocating/hardening).
5. Address the hardcoded default admin credential (forced change flow, or remove from source).
6. Set `session.js`'s cookie `secure` flag correctly for whatever the production deployment target actually is, and confirm this is tracked on a pre-launch checklist.
7. Add a `trg_no_delete_*` trigger to `admissions` (or explicitly document why it's intentionally exempt, matching its own children's protection).
8. Clean up the confirmed-dead code list (§13 item 11) and the two duplicate-naming pairs (§13 item 9) — low-risk, improves maintainability, no behavior change.
9. Decide `inventorySettings`' and `commTasks`' fate — either build the missing UI or explicitly close them as out of scope.
10. Add a regression test for `matDist`'s stale-read behavior once fixed, and consider a small test for `errorHandler.js`'s CHECK-violation-name recovery to catch a future Prisma-version regression early.

---

## 18. Final Assessment

This is a codebase in the **later, stronger half** of a long, disciplined migration — not one that is struggling or has drifted. The financial domain and activity log, built most recently, represent genuinely rigorous engineering: proven (not asserted) concurrency safety, honest documentation of every discovered contradiction before resolving it, and a consistent refusal to trust client-supplied identity anywhere it matters. That discipline has not yet been retroactively applied everywhere (`teachers`, the authorization-scope question, a few older routes' less rigorous concurrency handling) — but the gaps that remain are specific, named, and small relative to what's already been done correctly. The recommendation to pause briefly (§16) is about closing two compounding gaps while they're still cheap, not a signal that the migration approach itself needs to change. Continuing the same phase-by-phase, audit-first, decision-gated discipline that produced 3B-14/15 — applied next to `teachers` and to authorization — is the direct, evidence-based path forward.
