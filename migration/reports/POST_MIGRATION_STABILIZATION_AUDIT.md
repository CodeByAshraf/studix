# Post-Migration Stabilization Audit

**Status: READ-ONLY DECISION AUDIT. No database writes, no schema changes, no application-code changes, no refactoring were made to produce this report.** As in the prior assessment, every claim is labeled **[FACT]** (directly verified this session against live code/schema/DB, file+line cited), **[RISK]** (inferred/theoretical, not directly proven), or **[RECOMMENDATION]** (a proposed direction — not an approved decision). This report does not authorize implementation of anything. It exists to turn the broad findings of `DATA_LAYER_CODE_QUALITY_ASSESSMENT.md` into a small, controlled, sequenced stabilization plan.

---

## 1. Authorization Model Audit

### 1.1 Frontend permission model (the existing, real source of intent)

**[FACT]** `src/data/initialData.js:84-105` — `INITIAL_ROLES` (the live constant; a differently-shaped `ROLES` constant also exists at line 30 with zero importers anywhere in the tree — confirmed dead):

| Role | `permissions` array |
|---|---|
| `admin` | `null` (= full access, by convention) |
| `teacher` | `['dashboard','students','groups','attendance','exams','homework','materials']` |
| `accountant` | `['dashboard','payments','treasury','reports']` |
| `reception` | `['dashboard','students','groups','payments','notifications','id-cards']` |

**[FACT]** `src/store/auth.context.jsx`'s `canAccess(pageId)` checks the current user's role's `permissions` array against a `pageId` string. Enforcement is **frontend-only**: `ProtectedRoute` wrappers in `src/App.jsx` gate each `<Route>` by a `pageId` prop.

**[FACT]** The real `pageId` values (from `grep -n 'pageId=' src/App.jsx`, which is authoritative — it does **not** always match `src/constants/nav.js`'s labels):

```
dashboard, students, admissions, groups, attendance, payments, treasury,
exams, homework, materials (shared by MaterialsPage AND InventoryPage),
students (also reused, unchanged, by CommunicationPage AND StudentReportPage),
users, reports, id-cards, notifications, activity-log, settings
```

Two non-obvious reuses, confirmed directly in code (this corrects an earlier working assumption that these had their own permission keys):
- `CommunicationPage` (CRM / `communications`+`commTasks`) → `pageId="students"`, **not** a separate `"communication"` key.
- `StudentReportPage` → `pageId="students"`, **not** a separate `"student_report"` key.
- `InventoryPage` → `pageId="materials"`, same key as `MaterialsPage`.

**[FACT]** Cross-referencing the real `pageId` list against `INITIAL_ROLES`, exactly **four** pages have no non-admin role that grants access at all: `admissions`, `users`, `activity-log`, `settings`. Every other page is reachable by at least one non-admin role (`payments`/`treasury`/`reports` → accountant; `students`/`groups`/`attendance`/`exams`/`homework`/`materials` → teacher; `students`/`groups`/`payments`/`notifications`/`id-cards` → reception).

### 1.2 Backend session/role model

**[FACT]** `backend/src/middleware/auth.js`:
- `requireAuth`: verifies the signed session cookie only (`{id, role}`), rejects with 401 if invalid/absent. Trusts nothing from the request body.
- `requireRole(...roles)`: checks `req.user.role` (from the verified session, never client input) against an allow-list, 403 otherwise.

**[FACT]** `backend/src/routes/session.js`: on login, `role = user.is_admin ? 'admin' : (user.role_id || 'user')` — the role embedded in the signed session is the user's raw `role_id` string from Postgres `users.role_id`.

**[FACT]** The Postgres schema already has a `roles` table (`backend/prisma/schema.prisma:415-423`: `id`, `label`, `color`, `is_system`, `permissions Json?`, `description`) that **structurally mirrors** `INITIAL_ROLES` exactly — same 4 ids/labels. A live query this session confirms it is already seeded with all four rows (`admin`, `teacher`, `accountant`, `reception`, labels matching `INITIAL_ROLES` verbatim) but **`permissions` is `NULL` on all four rows** — the schema anticipates a permissions-array model but it has never been populated or consulted server-side.

**[FACT]** A live query of Postgres `users` this session shows **exactly one row**: the seeded `admin` user (`role_id: 'admin'`, `is_admin: true`). No teacher/accountant/reception account currently exists in Postgres. `src/data/initialData.js`'s `INITIAL_USERS`/`INITIAL_USERS_V2` seed arrays likewise contain **only** the `admin` entry — there is no seeded non-admin demo account anywhere in the codebase today.

### 1.3 What is actually enforced today, end to end

**[FACT]** `backend/src/server.js:195-210` (verified this session, exact current wiring):
```js
app.use('/api/activityLogs', requireAuth, asyncHandler(activityLogsInterceptor));
...
const guards = ADMIN_ONLY_COLLECTIONS.has(apiPath) ? [requireAuth, requireRole('admin')] : [requireAuth];
app.use(`/api/${apiPath}`, ...guards, makeCrudRouter(modelName, { writable, preserveClientId }));
```
`ADMIN_ONLY_COLLECTIONS = new Set(['activityLogs', 'centerProfile'])` — confirmed unchanged. `requireRole('admin')` is used in **exactly these two places** system-wide (plus the explicit standalone `app.use('/api/centerProfile', requireAuth, requireRole('admin'), centerProfileRouter)` at line 123, which is the same admin-only guarantee restated for the dedicated router, not an additional one). **Every other route in the application — all 23 remaining collections and all 13 dedicated route files — uses `requireAuth` only.** There is no route today that distinguishes teacher vs. accountant vs. reception vs. admin, other than the admin/non-admin binary on those two collections.

**[FACT — the central finding of this section]** The frontend's real permission model has **four** pages reachable by no non-admin role (`admissions`, `users`, `activity-log`, `settings`), but the backend only enforces two of them (`activity-log`→`activityLogs` ✓, `settings`→`centerProfile` ✓). **`admissions` — an entire domain that includes real money movement (`admission_payments`, `cancel-with-refund`) — has zero server-side role check.** Any authenticated session, regardless of role (teacher, accountant, reception), can currently call `POST /api/admissions`, `PUT /api/admissions/:id`, `POST /api/admissions/:id/activate`, and — most notably — `POST /api/admissions/:id/cancel-with-refund` (a financial refund operation) directly against the API, bypassing the frontend's own restriction entirely. (`users`, the fourth admin-only page, has no backend route at all yet — moot until that domain is migrated, but its future route should be pre-emptively scoped as admin-only.)

**[FACT — secondary finding]** Even among pages reachable by more than one role, the backend does not distinguish *which* roles: e.g. `payments` is intended for `accountant`+`reception` (and admin) but **not** `teacher` per `INITIAL_ROLES`; `treasury` (`cashboxes`+`treasuryTxn`) is intended for `accountant` (and admin) only. Today, `requireAuth` alone means a `teacher` session can call `/api/payments` or `/api/treasuryTxn`/`/api/cashboxes` directly, and an `accountant` session can call `/api/students`/`/api/groups`/`/api/attendance`/etc. — none of this is blocked server-side.

**[FACT — additional finding, not previously called out]** `admissionSystemLog` and `waReportLog` are both intended as **system-generated audit trails** (admission stage-change history; WhatsApp report send-log), analogous in spirit to `activityLogs` (which is `requireRole('admin')`-gated **and** has an append-only trigger). Neither `admission_system_log` nor `wa_report_log` is in `READ_ONLY_COLLECTIONS` or `ADMIN_ONLY_COLLECTIONS`, and this session confirmed via `information_schema.triggers` that `admissions` itself has zero triggers (see §8) — I did not re-check `admission_system_log`/`wa_report_log` triggers specifically, so this is flagged as a risk, not a proven gap: **[RISK]** these two log-shaped tables may be freely writable/deletable by any authenticated user via the generic CRUD route with no special protection at all, which would be inconsistent with how `activityLogs` was deliberately hardened in Phase 3B-15.

### 1.4 What "minimum coherent server-side authorization" means here

**[RECOMMENDATION]** The schema already has the right shape for this (`roles.permissions Json?`, seeded with matching role ids) — it is unpopulated and unused, not absent. The natural minimum implementation is **not** a new permission taxonomy, but mirroring the existing one:
1. Populate `roles.permissions` from the existing `INITIAL_ROLES` arrays (a data-only change, one-time).
2. Add a single new middleware, e.g. `requirePermission(pageId)`, that looks up the caller's role's permissions (admin/`null` = always pass) and checks membership — the direct server-side twin of `canAccess()`.
3. Apply it per-route using the same `pageId` groupings already derived in §1.1/§1.3 above (no new grouping to invent — it already exists in `INITIAL_ROLES` and in `App.jsx`'s route wiring).
4. Do **not** widen `requireRole('admin')` ad hoc per route — that would only reproduce today's binary model with more copies of it. A `pageId`-driven check is the one architecture that stays in sync with the frontend model as it evolves, rather than needing hand-maintained parallel route-by-route judgment calls.

This is a decision point, not an instruction to implement — see §11.

---

## 2. Route Authorization Matrix

Legend: Authentication = what currently gates the route at all. Current Authorization = role-level check today. Intended Role(s) = derived strictly from `INITIAL_ROLES` × real `pageId` (§1.1), not invented. Risk = practical exposure given §1.3.

| Route / Collection | Authentication | Current Authorization | Intended Role(s) | Ownership Check | Risk |
|---|---|---|---|---|---|
| `POST /api/session` (login) | none (public, by design) | n/a | all | n/a | Low — real PBKDF2 check server-side, see §3 |
| `DELETE /api/session` (logout) | none | n/a | all | n/a | Low |
| `/health` | none | n/a | all | n/a | Low |
| `students` | requireAuth | none | admin, teacher, reception | none | Medium — accountant can write student records |
| `groups` | requireAuth | none | admin, teacher, reception | none | Medium |
| `parents` | requireAuth | none | admin, teacher(?), reception (derived transitively via `communications`, no dedicated page) | none | Low-Medium — no direct CRUD UI exists for this collection today |
| `teachers` | requireAuth | none | admin only (`users` page) | none | Medium — see §5; currently moot in practice since writes never reach this route (100% local) |
| `exams` (+`exam-grades`, exam-delete) | requireAuth | none | admin, teacher | none | Medium — accountant/reception can write grades/exams |
| `homeworks` (+`hw-submissions`, homework-delete) | requireAuth | none | admin, teacher | none | Medium |
| `attendance` (+`attendance-sessions`) | requireAuth | none | admin, teacher | none | Medium |
| `absenceFollowup` | requireAuth | none | admin, teacher | none | Medium |
| `grades` | requireAuth | none | admin, teacher | none | Medium |
| `invMaterials`/`inventoryTxn`/`inventorySettings`/`material-distributions` | requireAuth | none | admin, teacher | none | Medium |
| `payments` | requireAuth (read-only at collection level: no POST/PUT/DELETE via generic route — writes only via dedicated route below) | none | admin, accountant, reception | none | Medium — teacher can read all payment records |
| `payments` create/refund (dedicated route, `payments.js`) | requireAuth | none | admin, accountant, reception | n/a (no per-user ownership concept for this domain) | Medium — teacher can create/refund payments directly against the API |
| `cashboxes` | requireAuth | none | admin, accountant | none | Medium-High — teacher/reception can move treasury funds |
| `treasuryTxn` | requireAuth | none | admin, accountant | none | Medium-High |
| `admissions` (CRUD) | requireAuth | **none** | **admin only** | none | **High** — the entire admissions domain has no server-side role check despite being admin-only in the intended model |
| `admissions/:id/activate` | requireAuth | **none** | **admin only** | none | **High** — creates a real student record; reachable by any authenticated session |
| `admissions/:id/cancel-with-refund` | requireAuth | **none** | **admin only** | none | **High** — a financial refund operation, reachable by any authenticated session, including non-financial roles (teacher) |
| `admissionPayments` (read-only at collection level) | requireAuth | none | admin only | none | High — any authenticated user can read all admission payment history |
| `admissionFollowups` | requireAuth | none | admin only | none | Medium-High |
| `admissionSystemLog` | requireAuth | none | admin only | none | **High** — writable/deletable, not read-only, no trigger confirmed (see §1.3 risk note) |
| `communications`/`commTasks` | requireAuth | none | admin, teacher, reception | none | Low-Medium — matches the broadest of the 3 non-admin roles that touch "students" already |
| `waReportLog` | requireAuth | none | admin, teacher, reception (as a `students`-page byproduct) | none | Medium — a send-log table, writable/deletable like any other collection; see §1.3 risk note |
| `activityLogs` | requireAuth + **requireRole('admin')** | ✅ enforced | admin only | n/a (actor derived server-side from session, never client) | **Low — already correctly enforced** |
| `centerProfile` | requireAuth + **requireRole('admin')** | ✅ enforced | admin only | n/a | **Low — already correctly enforced** |
| `users`/`roles` | n/a — no backend route exists | n/a | admin only (future) | n/a | n/a today; flag for when this domain is migrated (§5) |

**[FACT]** Summary: of ~23 non-trivial routes/collections, exactly 2 (`activityLogs`, `centerProfile`) have any server-side role enforcement beyond "is authenticated." The single largest concrete exposure is the **entire `admissions` domain**, including a financial refund endpoint, being fully reachable by any authenticated session of any role.

---

## 3. Hardcoded Credential Assessment (`admin123`)

**[FACT]** Location: `src/data/initialData.js:37` (`INITIAL_USERS`) and `:109` (`INITIAL_USERS_V2`) — both contain, in plaintext, in frontend source under version control:
```js
{ id: 'admin', name: 'مدير النظام', role: 'admin', password: 'admin123', isAdmin: true, active: true, permissions: null }
```

**[FACT]** This literal is **not** used by the real backend login path. `backend/src/routes/session.js` validates exclusively against `users.password_hash` in Postgres via `verifyPbkdf2` (PBKDF2-SHA256, 100k iterations, real salt, `crypto.timingSafeEqual`) — sound, and entirely independent of anything in `initialData.js`. The live Postgres `admin` user's actual `password_hash` was not extracted/compared in this audit (out of scope — would require reading a secret), but the mechanism itself is correct.

**[FACT]** The literal **is** reachable through a second, frontend-only path: `src/utils/crypto.js`'s `verifyPassword()`:
```js
if (!storedHash.startsWith(HASH_PREFIX)) { return storedHash === password; }
```
`src/store/auth.context.jsx`'s `login()` calls this **only** when `pgLogin()` throws `BackendUnreachableError` — confirmed this is thrown **only** on a genuine network/fetch failure (`src/services/api.js:39-51`, wrapped in try/catch around `fetch`, `AbortSignal.timeout(5000)`). A real backend response, even a 401 (wrong credentials, or — critically — **user not found**), resolves normally as `{ ok: false, status: 401 }` and is treated as **final** by `login()`; it does not fall through to the local/offline path.

**[FACT — this changes the practical severity]** Because the real Postgres `users` table currently contains only the `admin` row, and because a reachable backend answers definitively for any id (401 if not found), the plaintext-comparison fallback in `verifyPassword` is reachable **only when**:
1. The backend is genuinely unreachable (network down / server not running), **and**
2. The attacker (or a legitimate offline user) supplies id `admin` with password `admin123`.

This is a real, exploitable local authentication bypass, but it is scoped to the offline-fallback window, and it only benefits/threatens the `admin` account specifically — every other role currently has no seeded local account with a matching vulnerability (accounts created via `UsersPage.jsx` use `hashNewPassword()`, i.e., real local PBKDF2 hashing, not plaintext — see §5). Its practical consequence when triggered: local-only `authSource:'local'` state (no real backend session cookie is created), so a subsequent API call would still be rejected by the real backend unless a separate valid session cookie already exists in that browser from a prior real login.

**[RISK]** Severity classification: **Medium** in a single-admin, actively-online deployment (the fallback path is rarely exercised); **higher** for any deployment where the backend has real downtime windows, since during those windows this is a direct, unauthenticated-knowledge-required (`admin`/`admin123` is a very guessable default), full local-admin-state bypass.

Per instruction, this credential was **not** changed and **not** replaced with a different hardcoded value. Minimum safe remediation (not implemented): remove the plaintext-comparison branch from `verifyPassword` entirely (require every locally-stored credential to already be a real PBKDF2 hash, generated once at first successful real login rather than shipped as a literal), and/or stop seeding a working default password in source at all, instead requiring a first-run admin-password-set flow.

---

## 4. Login Security / Rate-Limiting Assessment

**[FACT]** `backend/package.json` — confirmed dependencies are only `@prisma/client`, `cors`, `dotenv`, `express`; no `express-rate-limit`, no `helmet`, no equivalent. `backend/src/server.js` has no `trust proxy` setting and no rate-limiting middleware of any kind. **There is no server-side rate limiting or attempt-tracking anywhere in the backend.**

**[FACT]** `POST /api/session` (`session.js`) performs the real PBKDF2 comparison but has zero throttling — an attacker with network access to the API can attempt unlimited password guesses against any known user id (currently only `admin`) at whatever rate the server can process PBKDF2 hashes.

**[FACT]** The only existing lockout mechanism (`src/config/app.config.js`'s `AUTH_CONFIG`: `MAX_LOGIN_ATTEMPTS: 5`, a derived `LOCKOUT_MS`, tracked under `localStorage['tc_login_attempts']`) is entirely client-side, per-browser, trivially bypassed by clearing localStorage, using a different browser/incognito session, or simply calling `POST /api/session` directly (it is never consulted by the backend at all).

**[RECOMMENDATION — not implemented]** A minimum server-side strategy, scoped to what actually exists today (no reverse proxy / `trust proxy` configured, so `req.ip` should be treated as the raw connecting IP unless/until a proxy is introduced): track failed attempts by **(account id) primarily**, since IP-based limiting alone is weak for a small number of known ids and IP-based limiting becomes actively wrong the moment a proxy sits in front of this app without `trust proxy` being set correctly. A combined per-account + per-IP counter (e.g., a small in-memory or DB-backed counter with exponential backoff) is the standard minimum; `express-rate-limit` would need `trust proxy` decided first if ever deployed behind one.

---

## 5. Teachers Write-Gap Analysis

**[FACT]** `teachers` is a real Postgres table (`COLLECTION_MODELS.teachers → 'teachers'`), boot-synced (`PG_COLLECTIONS` includes `'teachers'`, confirmed in `db.middleware.js`), and reachable via the generic CRUD route (`requireAuth` only, no special read-only/admin flag). **However, `src/modules/users/UsersPage.jsx` — the only UI that creates/edits/deletes teacher records — never calls any `pgCreateTeacher`/`pgUpdateTeacher`/`pgDeleteTeacher`.** A grep of `src/services/api.js` confirms no such functions exist at all. Every teacher create/update/delete in the UI is a pure local Zustand mutation.

**[FACT — consequence]** A teacher record created today lives only in that browser's `studix-v1` local state. On the next boot-sync, `mergeById` will keep it (local-only ids are never pruned — see §7), so it does not vanish immediately, but it is never written to Postgres and never visible from any other browser/session. Multiple staff members using different browsers would each accumulate a divergent, non-shared set of "teacher" records.

**[FACT — a materially more severe, previously under-stated consequence, confirmed this session]** Both the Postgres `users` table and the frontend's own seed data (`INITIAL_USERS`/`INITIAL_USERS_V2`) currently contain **only the `admin` account** — there is no teacher/accountant/reception account in Postgres at all. Any non-admin staff account is necessarily created locally via `UsersPage.jsx` (which does use real PBKDF2 hashing via `hashNewPassword()` — not the plaintext path in §3). Because `pgLogin()` receives a definitive, non-network-error 401 from the real backend for any id it doesn't recognize (§3), and because `login()` treats any such definitive backend response as final (never falling through to the local/offline path), **a non-admin user created only via `UsersPage` currently cannot log in at all while the backend is reachable** — which is the normal operating condition. Their only working login path is the offline/local fallback, which only activates when the backend is genuinely down. In effect: **today, only the `admin` account can use this application under normal conditions.**

**[RECOMMENDATION — not implemented]** This is confirmed as a concrete, scoped migration gap, not a design decision: build the real write path (`pgCreateTeacher`/`pgUpdateTeacher`/`pgDeleteTeacher`), directly analogous to the already-proven `groups` pattern (`groups` uses the same generic-collection shape, already server-truth-first). Whether `users`/`roles` themselves also need a real write path (to let non-admin accounts actually authenticate under normal conditions) is a related but separate, larger decision — noted here because it was discovered as a corollary of this gap, not scoped for implementation in this audit.

---

## 6. matDist Read-Gap Analysis

**[FACT]** `matDist` (material distribution records) is **not** a Postgres table — it is a derived/cached client-side collection, absent from `PG_COLLECTIONS` (confirmed in `db.middleware.js:21-27`), meaning it is **never boot-synced** from the server.

**[FACT]** The write path is real: `MaterialDistribution.jsx` calls `pgSaveMaterialDistribution` (backed by the dedicated `/api/material-distributions` route, `requireAuth` only), which performs a genuine, atomic Postgres write (an `inventory_txn` row plus whatever else that atomic operation covers). The write itself succeeds and is durable.

**[FACT]** The **read** side for `MaterialDistribution.jsx` and `StudentReportPage.jsx` (the two named consumers) reads from the local `matDist` cache only — never re-derived from `db.middleware.js`'s boot-sync (since it isn't a `PG_COLLECTIONS` member), and never re-fetched from any real endpoint on refresh. A fresh browser session, or one whose local `matDist` cache is empty/stale for any reason, will show incomplete or missing distribution history for a student even though the underlying `inventory_txn` rows are correctly persisted in Postgres.

**[RECOMMENDATION — not implemented, scope only]** The minimum fix is a **read-side** change only, deriving `matDist`'s two consumers from the already-synced `inventoryTxn` state (which *is* in `PG_COLLECTIONS` and already correctly boot-synced) rather than from the separate, never-synced `matDist` local cache. This does not require touching `MaterialDistribution.jsx`'s write path, `inventory_txn`'s schema, or any other material/inventory logic — consistent with the user's instruction not to refactor unrelated material logic.

---

## 7. `studix-v1` Architecture Assessment

**[FACT]** `src/store/app.store.js`'s Zustand `persist` middleware whitelists (`partialize`) **every** top-level state key across all 13 slices under a single localStorage key, `'studix-v1'` — confirmed zero exclusions.

**[FACT]** `db.middleware.js:29-33` (comment, verified verbatim): the boot-sync merge (`mergeById`) rule is **"any local record whose id doesn't exist in the Postgres copy is kept as-is; any id present in both is won by the Postgres copy; nothing is ever deleted just because Postgres currently has fewer rows than the local copy."** This is stated in the code itself as a deliberate anti-data-loss design choice from earlier in the migration (guards against, e.g., a partially-synced Postgres table after activation wiping out real local attendance history).

**Classification: `studix-v1` is not one single thing — it is genuinely two different roles bundled under one key, and that is the reason it cannot be simply removed or simply kept without qualification:**

1. **For domains that are now 🟢 PostgreSQL-authoritative** (students, groups, attendance, exams, grades, homework, materials catalog, inventory ledger, communications, admissions core, the full financial domain, activity logs): `studix-v1` is currently a **redundant mirror / legacy persistence carryover**, not a second source of truth in practice — the merge rule always defers to Postgres on any id collision.
2. **For domains that are genuinely, intentionally local-only** (`users`/`roles`/`teachers` credentials and role assignments, UI theme, the login-attempt counter, `parentExtras`, `centerProfile.slogan`/`logoUrl`): `studix-v1` is the **only** copy that exists anywhere — removing it would be an outright, irreversible data-loss event for these fields, not a safe cleanup.

**[FACT — a real, specific divergence mode, not previously named this precisely]** The merge rule's explicit "never delete based on Postgres having fewer rows" guarantee has a direct converse: **a record deleted server-side (by any other session) is never removed from a browser's local `studix-v1` copy**, because a deleted id no longer exists in the Postgres payload to "win" the merge — it simply isn't compared against anything, and the stale local copy survives indefinitely. For an already-🟢 domain, this means a deletion made on one device will not visually propagate to another device's local cache until/unless something else independently prunes it.

**Conclusion:** `studix-v1` should **not** be removed now — for the local-only-domain portion, there is nothing to replace it with yet (that requires the `users`/`teachers` migration work in §5 to exist first), and for the migrated-domain portion, removing the mirror without first replacing the merge strategy (from "always keep local-only rows" to a real reconciliation/pruning strategy for server-authoritative domains) would re-introduce exactly the data-loss risk the current merge rule was built to avoid. It can be safely narrowed, domain by domain, only after each domain both (a) has a real server-side write path and (b) has a deletion-aware sync strategy — neither of which is scoped for this audit.

---

## 8. Admissions Mutability Assessment

**[FACT]** `admissions` records are genuinely, actively mutable business records — this is not incidental. `AdmissionsPage.jsx` uses `pgUpdateAdmission` (`PUT /api/admissions/:id`) for real, expected state transitions: `reservationStatus`/`stage` moves between `waiting` ↔ `reserved` ↔ (via the dedicated activation route) activated, `reservationDate` updates, and general field edits via a generic `updateRecord` path (name/phone/grade/group/notes/etc. are all editable through the form, confirmed at `AdmissionsPage.jsx:148,155,175,274,283`).

**[FACT]** **No deletion of an `admissions` row is exposed anywhere in the UI or service layer.** `grep` of both `AdmissionsPage.jsx` and `src/services/api.js` found no `pgDeleteAdmission` function and no delete affordance in the admissions UI (cancellation is handled exclusively via the dedicated `cancel-with-refund` route, which sets `reservation_status='cancelled'` — a status transition, not a row deletion; its own UI text explicitly states "the original payments will not be deleted, a separate refund entry will be recorded").

**[FACT]** A live query of `information_schema.triggers` this session for `event_object_table = 'admissions'` returned **zero rows** — there is no append-only or delete-prevention trigger on `admissions` today. DELETE is not blocked at the application level (the generic CRUD route allows it for any collection not explicitly read-only) and is not blocked by a trigger.

**[FACT]** DELETE **is** independently blocked at the database level for any admission with real financial history: `admission_payments.admission_id → admissions.id` is declared `onDelete: NoAction` (`schema.prisma:64`). Postgres will reject deleting an `admissions` row that has any `admission_payments` child row, regardless of application code. An admission with zero payments could theoretically be deleted today if a delete route existed — but none does.

**Conclusion — matching the instruction to derive this from actual business semantics, not reflexively add protection:**
- Admissions are **legitimately mutable** — the reservation → activation → (possible) cancellation lifecycle is the core, expected workflow, not an anomaly to be locked down.
- Deletion is **not a live risk today**: no UI or API path creates it, so there is nothing currently exposed to protect against.
- The financially-relevant history (`admission_payments`) is **already independently protected**, both by its own append-only trigger (established in Phase 3B-14D) and, additionally, by the `onDelete: NoAction` FK constraint that would block deleting a parent admission out from under real payment history even if a delete route were ever added.
- **An immutable-event/history model for the `admissions` table itself is not required by the actual business semantics observed** — the record is meant to change over its lifecycle, and its financial consequences are already durably protected independently of the parent row's mutability.

**[RECOMMENDATION]** No trigger is warranted on `admissions` at this time. If a future feature exposes admission deletion, the existing FK `NoAction` constraint already provides a safety net for any admission with payment history; the remaining decision at that point would be narrower — whether a *payment-free* admission should be deletable at all, or whether cancellation (already implemented) should be the only removal path — not whether the whole table needs to become append-only.

---

## 9. Priority Classification

| # | Item | Priority | Type |
|---|---|---|---|
| 1 | `admissions` domain (incl. `cancel-with-refund`) has zero server-side role enforcement despite being admin-only in the existing model | **P0** | Security — authorization |
| 2 | No non-admin user can currently log in under normal (backend-reachable) conditions | **P0** | Functional gap (discovered as a corollary of §5/§1) |
| 3 | `admin123` plaintext-fallback local bypass | **P0** | Security — credential |
| 4 | No server-side login rate limiting | **P0/P1** | Security |
| 5 | Broader authorization gap: payments/treasury/students/etc. not role-differentiated server-side | **P1** | Security — authorization |
| 6 | `admissionSystemLog`/`waReportLog` writable/deletable with no special protection | **P1** | Security — data integrity (flagged as risk, not confirmed exploited) |
| 7 | `teachers` write gap (local-only writes) | **P1** | Migration gap |
| 8 | `matDist` stale-read gap | **P1** | Migration gap |
| 9 | `studix-v1` architecture (retain as-is for now) | **P1 (documentation/awareness, no action required now)** | Architecture |
| 10 | `admissions` mutability / trigger question | **P2 — resolved: no action needed** | Business-semantics audit |

---

## 10. Proposed Stabilization Order

**[RECOMMENDATION — sequencing only, nothing here is authorized yet]**

1. **Authorization for `admissions`** first — it is the single highest-risk, most concretely exploitable gap (a live financial refund endpoint with no role check at all), and fixing it does not depend on anything else in this list.
2. **Populate `roles.permissions`** (data-only) and add the `requirePermission(pageId)` middleware described in §1.4, applying it across all routes in one coherent pass rather than admissions alone — since the same gap exists everywhere, fixing admissions in isolation would leave an inconsistent, partially-enforced model.
3. **`admin123` remediation** — independent of the above, can proceed in parallel; low interaction risk with anything else.
4. **Login rate limiting** — independent; can proceed in parallel with the above.
5. **`teachers` write path** — directly unblocks item 2 in §9 (non-admin login) once `users`/`roles` are considered, though `teachers` itself (as distinct from `users`/`roles`) is scoped narrower and can proceed alone first.
6. **`matDist` read-gap fix** — fully independent, smallest and lowest-risk item; could be done at any point, including before the above.
7. **`admissionSystemLog`/`waReportLog` write protection** — small, mechanical (mirror the existing `activityLogs` pattern), best done alongside item 1/2 since it's the same category of finding.
8. `studix-v1` and admissions-mutability: no action required now; revisit only when/if `teachers`/`users` migration (item 5) changes what "local-only domain" means.

---

## 11. Exact Implementation Decision Points

These are the concrete choices that would need explicit approval before any implementation begins — none are decided by this report:

1. **Authorization mechanism**: `requirePermission(pageId)` middleware reading `roles.permissions` (recommended, §1.4) vs. continuing to hand-add `requireRole(...)` per route. Affects every route in §2.
2. **`admissions` route guard set**: confirm the intended role is admin-only (matches `INITIAL_ROLES` today) before wiring it — or whether business reality has since diverged from that frontend config (e.g., should reception ever create/view admissions, given they already handle `students`/`payments`?). This audit derives strictly from existing config; it does not know whether that config itself is still correct.
3. **`admin123` remediation scope**: remove the plaintext-fallback branch only, vs. also removing the shipped default password entirely and requiring first-run admin setup.
4. **Rate-limiting strategy**: per-account counter, per-IP counter, or both; in-memory vs. persisted; whether `trust proxy` will ever need to be configured (depends on future deployment topology, unknown today).
5. **`teachers` (and, separately, `users`/`roles`) write-path scope**: whether to migrate `teachers` alone (unblocks nothing about login) or also address `users`/`roles` (which is what actually unblocks non-admin login) — these are two different sized efforts and the report does not assume which is wanted.
6. **`matDist` fix approach**: confirm deriving from `inventoryTxn` (recommended) doesn't require any shape change to the two consumer components beyond how they select data.
7. **`admissionSystemLog`/`waReportLog` protection**: confirm intended shape — likely read-only + admin-only, or read-only for all authenticated users with writes reserved to the system itself (mirroring how `activityLogs` was resolved in Phase 3B-15).

---

## 12. Risks of Delaying Each Item

- **Delaying `admissions` authorization**: the longer this remains open, the more real business data (activations, cancellations, refunds) accumulates that *could* have been created/altered by a non-intended role — even if it hasn't been in practice, the exposure window is continuous and widens with usage, not with time alone.
- **Delaying broader authorization**: identical risk shape but lower individual severity per route; the aggregate risk grows as more staff accounts and more routes are added over time without the enforcement ever catching up.
- **Delaying `admin123` fix**: risk is concentrated in backend-downtime windows specifically — low ongoing risk if the backend has high uptime, but does not shrink on its own, and remains a known, guessable default indefinitely.
- **Delaying rate limiting**: risk grows with public/network exposure of the login endpoint; negligible if the app is not network-reachable beyond a trusted LAN, significant otherwise.
- **Delaying `teachers`/`users` write path**: every additional locally-created teacher/non-admin-account record accumulated in a browser without a server copy makes eventual reconciliation harder and increases the chance of silent loss when that browser's storage is cleared or the device is replaced. This also means non-admin login continues to be broken under normal conditions for as long as it's delayed.
- **Delaying `matDist` fix**: low-growing risk — the underlying data is safe (Postgres has it correctly), the only cost is a persistently confusing/incomplete UI for report/distribution views, which does not compound the way data-loss risks do.
- **Delaying `studix-v1` narrowing**: no meaningful risk today per §7's analysis (the merge rule already prevents the worst case); this is correctly a "does not need to happen soon" item, not a hidden urgent one.
- **Delaying `admissionSystemLog`/`waReportLog` hardening**: risk is that these audit-trail tables could be tampered with (edited/deleted) by any authenticated user without detection, which — if ever relied upon for a real audit/compliance purpose — would undermine that purpose retroactively for the entire period left unprotected.

---

**End of audit. No further action has been taken. Awaiting explicit approval before any implementation of any item above.**
