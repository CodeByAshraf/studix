# Post-Migration Stabilization — Authorization & Identity Implementation Contract

**Status: DECISION AUDIT + IMPLEMENTATION CONTRACT ONLY. No application code, schema, or database rows were modified to produce this document.** As before: **[FACT]** = directly verified this session, file/line cited; **[RISK]** = inferred, not proven; **[RECOMMENDATION]** = proposed direction, not an approved decision; **[DECISION NEEDED]** = the audit found the intent genuinely ambiguous and is explicitly not guessing.

This document does not authorize implementation. Per the gate at the end of this document, implementation begins only after explicit approval of §8.

---

## 1. Route Authorization Matrix (Priority 1)

Columns: **Permission** = the `pageId`-equivalent permission key this route should be checked against (derived from `INITIAL_ROLES`/`roles.permissions`, §2 of the prior audit — not invented). **Ownership/Scope Check** = whether any row-level (not just page-level) restriction currently exists or is implied by current behavior. **Required Change** = the minimum change needed to reach the target model in §6, phrased as an action, not code.

| Route | Authentication | Intended Role(s) | Permission | Ownership/Scope Check | Current Enforcement | Required Change |
|---|---|---|---|---|---|---|
| `POST /api/session` | none (public) | all | n/a | n/a | Real PBKDF2 check, no role gate needed | Add rate limiting only (§4) |
| `DELETE /api/session` | none | all | n/a | n/a | n/a | none |
| `GET /health` | none | all | n/a | n/a | n/a | none |
| `users` | **no backend route exists today** | admin | `users` | none | n/a | Out of scope for this contract (§2 covers why); when built, must be `requirePermission('users')` |
| `roles` | **no backend route exists today** | admin | `users` (roles are managed from the same UI view) | none | n/a | Out of scope for this contract; when built, admin-only |
| `students` | requireAuth | admin, teacher, reception | `students` | **none exists in current behavior** — any role with the page permission sees all students, not a subset | requireAuth only | Add `requirePermission('students')` |
| `groups` | requireAuth | admin, teacher, reception | `groups` | none in current behavior | requireAuth only | Add `requirePermission('groups')` |
| `parents` | requireAuth | admin, teacher, reception (transitively, via `communications`) | `students` | none | requireAuth only | Add `requirePermission('students')` — **[DECISION NEEDED]**: no dedicated page owns this collection directly; confirm it should ride on `students`' permission rather than its own |
| `teachers` (Zustand/Postgres collection — distinct from the local `auth.context` teachers list, see §2) | requireAuth | admin | `users` | none | requireAuth only | Add `requirePermission('users')`; note this collection currently has zero real consumers (§2) |
| `attendance` / `attendance-sessions` / `absenceFollowup` | requireAuth | admin, teacher | `attendance` | none in current behavior (a teacher sees/marks attendance for every group, not just their own) | requireAuth only | Add `requirePermission('attendance')` |
| `exams` / `exam-grades` / `grades` | requireAuth | admin, teacher | `exams` | none | requireAuth only | Add `requirePermission('exams')` |
| `homeworks` / `hw-submissions` | requireAuth | admin, teacher | `homework` | none | requireAuth only | Add `requirePermission('homework')` |
| `invMaterials` / `inventoryTxn` / `inventorySettings` / `material-distributions` | requireAuth | admin, teacher | `materials` | none | requireAuth only | Add `requirePermission('materials')` |
| `communications` / `commTasks` | requireAuth | admin, teacher, reception | `students` | none | requireAuth only | Add `requirePermission('students')` |
| `waReportLog` | requireAuth | admin, teacher, reception | `students` | none | requireAuth only, writable/deletable by anyone | Add `requirePermission('students')`; additionally restrict writes to system-generated only (mirror `activityLogs`'s interceptor pattern) — **[DECISION NEEDED]**: confirm no legitimate UI path needs to directly edit/delete a send-log row |
| `admissions` (CRUD) | requireAuth | admin | `admissions` | none | **none** | Add `requirePermission('admissions')` |
| `admissions/:id/activate` | requireAuth | admin | `admissions` | none | **none** | Add `requirePermission('admissions')` |
| `admissions/:id/cancel-with-refund` | requireAuth | admin | `admissions` | none | **none** | Add `requirePermission('admissions')` — highest-priority single change in this table |
| `admissionPayments` (read-only) | requireAuth | admin | `admissions` | none | **none** | Add `requirePermission('admissions')` |
| `admissionFollowups` | requireAuth | admin | `admissions` | none | **none** | Add `requirePermission('admissions')` |
| `admissionSystemLog` | requireAuth | admin | `admissions` | none | **none**, writable/deletable by anyone | Add `requirePermission('admissions')`; additionally restrict writes to system-generated only |
| `payments` (read via generic route; write via dedicated route) | requireAuth | admin, accountant, reception | `payments` | none | requireAuth only | Add `requirePermission('payments')` |
| `cashboxes` | requireAuth | admin, accountant | `treasury` | none | requireAuth only | Add `requirePermission('treasury')` |
| `treasuryTxn` | requireAuth | admin, accountant | `treasury` | none | requireAuth only | Add `requirePermission('treasury')` |
| `activityLogs` | requireAuth + `requireRole('admin')` | admin | `activity-log` | n/a | ✅ already correct | **None required** — optionally normalize to `requirePermission('activity-log')` for consistency of mechanism only, not behavior |
| `centerProfile` | requireAuth + `requireRole('admin')` | admin | `settings` | n/a | ✅ already correct | Same as above — normalize mechanism only |
| Reports / export | **no dedicated route** — `ReportsPage` (pageId `reports`, accountant+admin) is a pure client-side aggregation over already-permission-gated collection GETs (`payments`, `treasury`, `students`, etc.) | admin, accountant | `reports` (client-side only; each underlying collection GET is separately gated per row above) | none | Governed entirely by the underlying collections' own gates | No new route to guard; ensure the underlying collections used by this view (`payments`, `treasuryTxn`, etc.) are correctly gated — no independent action needed here beyond the rows above |

**[FACT — cross-cutting]** No route in the application implements a row-level ownership/scope check today (e.g., "a teacher may only see their assigned groups"). Every existing non-admin restriction is page-level, not row-level. This audit does **not** invent row-level scoping as a requirement — it does not exist in current behavior and inventing it would exceed "derive from existing application behavior," which the gate explicitly prohibited. If row-level scoping is wanted, that is a new product decision, not a stabilization fix, and is called out as **[DECISION NEEDED]** in §8.

---

## 2. Identity Lifecycle Audit (Priority 2)

**[FACT] 1. User creation** — Only one path exists: `UsersPage.jsx` → `createUser()` (`src/services/usersService.js:82-95`). Client-generated `id` (typed directly by the admin in the form, uniqueness checked only against the in-memory local `users` array — not authoritative, not checked against Postgres at all). No backend route exists (`users`/`roles` are explicitly excluded from `COLLECTION_MODELS`, per its own comment: "users/roles مقصودة الاستبعاد في Phase 1 (auth خارج النطاق)").

**[FACT] 2. Password hashing** — `hashPassword()` (`src/utils/crypto.js`): PBKDF2-SHA256, 100,000 iterations, 16-byte random salt, 32-byte (256-bit) derived key, stored as `pbkdf2:<iterations>:<base64_salt>:<base64_hash>`. **Confirmed byte-for-byte compatible with the backend's `verifyPbkdf2()`** (`backend/src/lib/passwordVerify.js`) — same prefix, same iteration/salt/hash encoding, same `crypto.pbkdf2Sync(..., 32, 'sha256')`, same `timingSafeEqual` comparison. The backend file's own header comment states this explicitly: "يتحقق من هاش PBKDF2 بنفس تنسيق src/utils/crypto.js (الفرونت-إند) … بدون تغيير أي هاش مخزَّن." **This is a materially important, positive finding: a locally-hashed password can be inserted as-is into Postgres `users.password_hash` and will validate correctly — no rehash/reset is structurally required for any account whose stored value already matches the `pbkdf2:` format.**

**[FACT] 3. User storage** — **Two entirely separate, non-communicating stores exist**, not one:
   - Postgres `users` table (schema-complete: `id`, `name`, `role_id` FK→`roles`, `teacher_id` FK→`teachers`, `password_hash`, `is_admin`, `active`, `permissions Json?`, `email`, etc.) — currently **one row** (`admin`).
   - `auth.context.jsx`'s local React state, persisted to **`localStorage['studix-auth-users']`** (a key entirely separate from `studix-v1` and from any `PG_COLLECTIONS` sync) — currently seeded from `INITIAL_USERS_V2` (also just `admin`), but this is where any admin-created teacher/accountant/reception account actually lives today.
   There is no code path anywhere that reads or writes Postgres `users` from the frontend, other than the login request itself (`pgLogin` → `POST /api/session`).

**[FACT] 4. Login** — `auth.context.jsx`'s `login()`: calls `pgLogin(id, password)` first. If the backend is reachable, its answer (success or 401) is **final** — no fallback. Only a genuine `BackendUnreachableError` (network/timeout failure) triggers the **separate** local path: look up `id` in the local `users` array (from `studix-auth-users`), verify via `verifyPassword()` (same PBKDF2 algorithm as above, plus a plaintext-fallback branch for legacy unhashed values — see §3/Priority 3).

**[FACT] 5. Session creation** — `backend/src/lib/session.js`'s `signSession({id, role})`: HMAC-SHA256 over a JSON payload (`{id, role, exp}`), base64url-encoded, `SESSION_SECRET` from `backend/.env` (never sent to the client). `role` is computed at sign-time in `session.js` as `user.is_admin ? 'admin' : (user.role_id || 'user')` — i.e., directly from Postgres, not from any client input.

**[FACT] 6. Session validation** — `requireAuth` (`backend/src/middleware/auth.js`): parses the `studix_session` cookie, calls `verifySession()` (constant-time signature check + expiry check), sets `req.user = {id, role}` from the verified payload only. Nothing from the request body/headers is ever trusted for identity.

**[FACT] 7. Role retrieval** — Exists only at session-sign time (`session.js`, from `users.role_id`/`users.is_admin`), then carried inside the signed token for the token's lifetime (12 hours). There is no per-request re-fetch of the role from the database — a role change would not take effect until the user's session token expires/is reissued. This is a real design characteristic worth naming for the contract (§8, item 4): whether that staleness window is acceptable or whether authorization should look up the role fresh per request.

**[FACT] 8. Permission retrieval** — **Does not exist server-side at all.** `roles.permissions` (Postgres) is `NULL` on all four seeded rows and is never read by any backend code. Every permission decision today happens exclusively in the frontend (`auth.context.jsx`'s `canAccess()`).

**[FACT — a nuance not previously captured]** `canAccess()`'s actual logic (`auth.context.jsx:80-89`) is more layered than "role → permissions": it checks `currentUser.permissions` **first** (a **per-user** override, if non-null and non-empty, takes precedence over the user's role entirely), and only falls back to `roles[currentUser.role].permissions` if the user has no personal override. **The existing frontend model supports per-user permission overrides, not just per-role permissions.** Any server-side permission model that copies only the role→permissions mapping and ignores per-user overrides would be a narrower model than what the frontend already implements. This is flagged as **[DECISION NEEDED]** in §8 — carrying this nuance over adds real complexity; dropping it is a behavior change from current frontend semantics.

**[FACT] 9. User update** — Local only, `UsersPage.jsx`'s save flow (`hashNewPassword()` re-hashes only if a new password was typed; otherwise the existing hash is kept as-is). No backend route.

**[FACT] 10. User disable/activation** — The `active` boolean exists in both the Postgres schema and the local user object shape, and is checked in `canAccess()` (`if (!currentUser || !currentUser.active) return false`) and in `session.js`'s login check (`user.active`). Toggling it, however, is only exposed through the local `UsersPage.jsx` edit form (no backend route) — so disabling a Postgres-side account is not currently possible through any UI.

**[FACT] 11. User deletion behavior** — Local-only removal from the `studix-auth-users` array (`setUsers(prev => prev.filter(...))`, confirmed pattern used identically for the local `teachers` list). No backend route; a Postgres `users` row (today, only `admin`) cannot be deleted through any UI path.

**[FACT] 12. Existing local users** — `INITIAL_USERS_V2` seeds only the `admin` account. Any teacher/accountant/reception account in existence today was created at runtime through `UsersPage.jsx` and lives **only** in whichever browser's `localStorage['studix-auth-users']` created it — there is no shared/authoritative copy anywhere, including Postgres.

**[FACT] 13. Existing local password hashes** — Confirmed format-compatible with the backend's verifier (item 2). The one exception is the single seeded `admin` literal (`'admin123'`, plaintext, not `pbkdf2:`-prefixed) — this specific value would need special handling (forced reset, not direct insertion) in any migration, since inserting a raw plaintext string into `password_hash` would make `isPbkdf2Format()` reject it outright (`verifyPbkdf2` returns `false` for anything not in `pbkdf2:` format) — the account would become **unable to log in at all** via the real backend if migrated naively.

**[FACT] 14. Relationship between `users` and `roles`** — Postgres already models this correctly as a real FK (`users.role_id → roles.id`), and `roles` is already seeded with the 4 real ids/labels matching `INITIAL_ROLES`/`auth.context.jsx`'s local `roles` state exactly. The **only** missing piece is that `roles.permissions` was never populated and nothing server-side reads it. The frontend's own `roles` "table" (`auth.context.jsx`'s local state, persisted separately to `studix-auth-roles`) is a third, independent copy of the same conceptual data, editable through `UsersPage.jsx`'s "الأدوار والصلاحيات" view with no connection to Postgres at all.

### Why non-admin users cannot currently authenticate against the live backend (the audit's specific question)

**[FACT — root cause, precisely]** It is not a bug in the login code — it is a straightforward consequence of the data simply not existing where the real login path looks. `POST /api/session` correctly and exclusively checks Postgres `users`; Postgres `users` has exactly one row; therefore only `admin` can ever succeed against the real backend. Any account created via `UsersPage.jsx` exists only in `localStorage['studix-auth-users']`, a store the real backend has no knowledge of and no connection to. The local/offline fallback that *would* let such an account in only activates on genuine network failure, not on "account not found" — so under normal (backend reachable) operation, these accounts have no working login path at all.

### **[Important architectural correction to the prior assessment's "teachers" characterization]**

**[FACT]** There are **two structurally separate "teachers" collections**, not one with a write gap as previously framed:
1. **Zustand `app.store.js`'s `teachers` slice** — a real `PG_COLLECTIONS` member, correctly boot-synced from Postgres `teachers` (currently empty). Confirmed via grep: **it has zero consumers anywhere in the codebase** outside the sync mechanism itself — nothing reads `useAppStore(s => s.teachers)`.
2. **`auth.context.jsx`'s local `teachers` state** — a fully separate array, seeded from `INITIAL_TEACHERS` (empty by default), persisted to `localStorage['studix-auth-teachers']`, and **this is the only teacher list `UsersPage.jsx` actually reads and writes** (confirmed: `UsersPage.jsx` destructures `teachers`/`setTeachers` from `useAuth()`, never from `useAppStore()`).

These two arrays never reconcile with each other. The prior assessment's framing ("teachers is read-real but write-fake") described what looks like one collection with divergent read/write paths; the more precise fact is that **the real, Postgres-backed `teachers` collection is simply unused**, and the collection actually driving the UI is a second, entirely local one that Postgres has never heard of. This matters directly for scoping any future `teachers` migration work (§8 will flag this, but implementation remains explicitly out of scope for this contract, per the gate).

---

## 3. `admin123` — Final Determination (Priority 3)

**[FACT]** Confirmed dev-seed-only in terms of literal placement: `src/data/initialData.js:37,109` (frontend source, plaintext). **Not** accepted by the real backend's authentication path (`session.js` checks only `users.password_hash` via `verifyPbkdf2`, never the frontend literal). **Is** reachable through the frontend's own local/offline-fallback comparison in `verifyPassword()` (`src/utils/crypto.js`), but only when the backend is genuinely unreachable **and** the local `studix-auth-users` array still contains an unhashed (`admin`/`admin123`) entry, i.e., before any real password change has ever been made for that account.

**Classification: fallback-only + seed-only, not production-backend-reachable, but present in client source and genuinely exploitable during backend downtime.** It does not depend on a hardcoded production credential in the backend sense — the backend has no default credential at all (it depends entirely on whatever `password_hash` actually exists in Postgres for the `admin` row). The exposure is confined to the frontend's own offline-mode design.

**[RECOMMENDATION — not implemented, decision only]**: the minimum safe remediation is removing the plaintext-comparison branch from `verifyPassword()` (item 13 in §2 above already establishes that any real account should hold a `pbkdf2:`-format hash; the plaintext branch's only purpose was bootstrapping the very first login before a hash existed). A safe bootstrap path can be preserved explicitly and securely by: seeding the Postgres `admin` row with a real PBKDF2 hash at deploy/setup time (not a literal in source) and requiring the local seed's `admin` entry to already carry a `pbkdf2:`-hashed value rather than a raw string, generated once at setup rather than shipped as a literal.

---

## 4. Login Rate-Limiting Design (Priority 4)

**[FACT]** No `trust proxy` is configured in `backend/src/server.js`, and no reverse proxy is currently part of this deployment (confirmed: no proxy-related config anywhere in `server.js`/`package.json`). `req.ip`/`req.socket.remoteAddress` can therefore be trusted directly as the real connecting address today — this would need revisiting only if a reverse proxy is introduced later.

**[RECOMMENDATION]** A minimum server-side mechanism, deliberately avoiding a new infrastructure dependency (no Redis, no separate service):
- Track failed attempts **keyed by account id** (primary signal — there are only ever a handful of real accounts, and per-account lockout directly protects what actually matters: a specific credential being guessed) **and, secondarily, by source IP** (protects against a single source hammering many ids).
- An in-process (in-memory) counter is sufficient for the current single-process deployment shape; it resets on server restart, which is an acceptable trade-off for a first server-side layer given there is currently zero protection at all.
- Exponential backoff (mirroring the existing client-side `AUTH_CONFIG` shape/parameters, so behavior is consistent and not confusing to legitimate users who already see a client-side lockout message) rather than a hard permanent ban.
- This can be implemented as a small, dependency-free module (a `Map` keyed by id+ip with timestamps), or `express-rate-limit` if a dependency is acceptable — this is a genuine, open choice, not decided here (see §8, item 12).

---

## 5. Authorization Architecture (design only, not implemented)

**[RECOMMENDATION]** A single new middleware factory, `requirePermission(pageId)`, to be placed after `requireAuth` on every route in §1's "Required Change" column:
- Reads the permission set for `req.user.role` from `roles.permissions` (populated per §8 item 3), with `admin`/`null` short-circuiting to always-allow (mirroring the frontend's own convention exactly).
- Fails closed: any missing/malformed permission data → 403, never a silent allow.
- Returns 401 (via the existing `requireAuth`, unchanged) for "not authenticated," and a distinct 403 for "authenticated but not permitted" — the same distinction the codebase already makes in `requireRole()` today, just generalized.
- Derives identity **only** from `req.user` (the verified session) — never from the request body, matching how every dedicated route in this codebase already handles actor identity (`activityLogs.js`'s `resolveActivityLogActor`, every 3B-14 route's `created_by`).
- Is a single reusable function, not duplicated per-route logic — each route only supplies its own `pageId` string.

This satisfies every bullet in the user's "Authorization Architecture Requirements" section using the existing `roles`/`INITIAL_ROLES` model as the starting point, with no new authorization system invented.

---

## 6. Financial Route Requirement — Mapping

| Financial route | Change needed | Transaction logic touched? |
|---|---|---|
| `payments` create/refund (`payments.js`) | Add `requirePermission('payments')` before the existing handler | No — middleware only, added before the route's existing logic runs |
| `admissionPayments` create (`admissionPayments.js`) | Add `requirePermission('admissions')` | No |
| `admissions/:id/cancel-with-refund` (`admissionCancellation.js`) | Add `requirePermission('admissions')` | No |
| `treasuryTxn` (`treasuryTxn.js`) | Add `requirePermission('treasury')` | No |
| `cashboxes` (dedicated wrapper + generic route) | Add `requirePermission('treasury')` | No |

**[FACT]** In every case, the change is additive middleware inserted before the route's existing handler in `server.js`'s `app.use(...)` chain — none of the already-verified transaction bodies (`runInTransaction`, the `SELECT ... FOR UPDATE` lock in refunds, the conditional-`updateMany` locks in cancellation) need to change at all. Regression verification (§9) is required specifically because middleware ordering mistakes are a realistic risk (e.g., a route mounted before its guard), not because the transaction logic itself is expected to be affected.

---

## 7. Ambiguities Flagged for Explicit Decision (not guessed)

1. `parents` collection has no dedicated page/permission of its own — riding on `students`'s permission is the audit's best derivation, not a confirmed intent.
2. Whether per-user permission overrides (§2, item 8) must be preserved server-side, or whether a pure role→permission model is an acceptable simplification.
3. Whether role changes should take effect immediately (requiring a per-request Postgres lookup) or only at next login (current token-lifetime behavior, cheaper, already how it works today).
4. Whether row-level ownership/scope checks (e.g., a teacher restricted to their own groups) should be introduced now, given that no such restriction exists anywhere in current behavior.
5. Whether `admissionSystemLog`/`waReportLog` have any legitimate direct-edit use case, or can be safely restricted to system-generated writes only (like `activityLogs`).
6. Scope of the `teachers`/`users` migration: given §2's correction (two disconnected teacher lists, one dead), whether to (a) migrate only the Zustand-visible `teachers` collection (which would not fix non-admin login at all, since it's unrelated to `auth.context.jsx`'s data), or (b) migrate the `users`/`roles`/local-`teachers` model that `UsersPage.jsx` actually operates on (which is what would actually unblock non-admin login) — these are different-sized efforts and this contract does not assume which is wanted. **Per the gate, neither is implemented now regardless.**
7. Rate-limiting implementation choice: dependency-free in-memory module vs. `express-rate-limit`.
8. `admin123` bootstrap replacement mechanism (setup script vs. first-run flow vs. environment-variable-provided initial password).

---

## 8. Implementation Contract (for approval — nothing below is implemented yet)

1. **Final role model**: the existing four roles (`admin`, `teacher`, `accountant`, `reception`) as already seeded in Postgres `roles` — no new role invented, pending resolution of ambiguity §7.6 for anything beyond these four.
2. **Permission model**: page-scoped permission strings identical to the existing frontend `pageId` set (`dashboard`, `students`, `groups`, `attendance`, `payments`, `treasury`, `exams`, `homework`, `materials`, `notifications`, `reports`, `id-cards`, `activity-log`, `settings`, `users`, `admissions`) — pending resolution of §7.2 (per-user override support).
3. **Sourcing from PostgreSQL**: populate `roles.permissions` (currently `NULL` on all 4 rows) with arrays matching `INITIAL_ROLES` exactly, as a one-time data update — no schema change required (the column already exists).
4. **Attaching roles to sessions**: unchanged from today (`role` embedded at sign-time from `users.role_id`/`is_admin`) unless §7.3 is decided in favor of live lookup.
5. **Route middleware/guard design**: `requirePermission(pageId)` per §5, applied per §1's matrix, layered after the existing `requireAuth`.
6. **Ownership/scope-check strategy**: none added (matches current behavior, per §1's cross-cutting finding), unless §7.4 is decided otherwise.
7. **User creation flow**: unchanged for now — remains local-only pending §7.6's decision on migration scope.
8. **Login flow**: unchanged mechanically; only the rate-limiting layer (§4) is added in front of it.
9. **Password hashing strategy**: unchanged — the existing PBKDF2 format is already correct and already cross-compatible (§2 item 2); no new hashing scheme needed.
10. **Existing-user migration strategy**: not undertaken in this contract (§7.6 unresolved); if/when undertaken, must (a) insert already-`pbkdf2:`-hashed local values directly (no rehash needed), (b) force a reset for the one plaintext seed value (`admin`/`admin123`), (c) validate `role_id` values against the real `roles` table, (d) resolve id collisions between local and Postgres `users`.
11. **admin bootstrap strategy**: replace the plaintext-fallback branch in `verifyPassword()`; provide a real PBKDF2-hashed bootstrap value generated at setup time rather than a literal in source — exact mechanism pending §7.8.
12. **Rate-limit strategy**: per-account + per-IP in-memory counter with exponential backoff, per §4 — dependency choice pending §7.7.
13. **Failure/HTTP status behavior**: 401 = not authenticated (existing `requireAuth`, unchanged); 403 = authenticated but not permitted (new `requirePermission`, matching the existing `requireRole` convention already used for `activityLogs`/`centerProfile`).
14. **Financial-route protection**: additive `requirePermission(...)` middleware only, per §6 — zero changes to any transaction body, lock, or concurrency mechanism proven in Phase 3B-14.
15. **Regression verification plan**: per the user's "Required Verification After Approval" list verbatim — unauthenticated/wrong-role/authorized request outcomes, spoofing resistance (role/permission never trusted from request body — already true architecturally and simply preserved), full re-run of the existing Phase 3B-14 atomicity/concurrency test suite unchanged (to prove the new middleware layer didn't alter transaction behavior), plus new tests for the `requirePermission` middleware itself.

---

**No application code, schema, or database has been modified. Awaiting explicit approval of §8 before any implementation begins. Teachers/matDist implementation and any new migration phase remain paused, as instructed.**
