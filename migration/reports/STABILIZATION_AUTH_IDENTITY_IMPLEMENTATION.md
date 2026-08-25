# Stabilization Phase — Authorization & Identity: Implementation Closure

Implementation carried out per the approved contract (`POST_MIGRATION_STABILIZATION_AUTH_CONTRACT.md`), the four corrections, the explicit route matrix, and the pre-implementation checkpoint. This document records exactly what changed, what was verified, and every deviation from the approved plan.

---

## 1. Schema change (the only one)

`users.auth_version INT DEFAULT 1` and `roles.auth_version INT DEFAULT 1` — added via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, confirmed via `information_schema.columns` immediately after. `prisma db pull` + `prisma generate` re-synced `schema.prisma`/the client. Verified: both columns `NOT NULL DEFAULT 1`, exactly as approved.

## 2. Initial role permissions

Populated exactly the four arrays you approved, via `prisma.roles.update`. Verified immediately after: 4 roles, each `permissions` array matching byte-for-byte, `auth_version = 1` on all four, existing `admin` user row untouched (`last_login`, `password_hash` format, `active`, `is_admin` all unchanged), no row-count change anywhere (`users: 1`, `roles: 4`, `teachers: 0`).

## 3–6. Backend implementation

- **`backend/src/lib/authCache.js`** (new) — in-memory performance cache, Postgres-backed on miss, `invalidateUser`/`invalidateRole`.
- **`backend/src/middleware/permissions.js`** (new) — `requirePermission(pageId)`, fail-closed exactly per Correction 1: per-user override → role array → **empty** (never "full access" on NULL, including for `admin`, which now carries an explicit 16-entry array).
- **`backend/src/lib/session.js`** — session token now carries `{id, role, userAuthVersion, roleAuthVersion}`.
- **`backend/src/routes/session.js`** — login populates the cache and signs the token with live versions; response now also returns `name`, `active`, and the resolved `permissions` array (UI guidance only — see §10).
- **`backend/src/routes/users.js`**, **`backend/src/routes/roles.js`** (new) — the first real backend lifecycle for `users`/`roles`. Admin-only. Passwords hashed server-side only (`hashPbkdf2`, added to `passwordVerify.js`); `is_admin` derived from `roleId`, never accepted from the client; every authorization-affecting mutation increments `auth_version` in the same write and calls `invalidateUser`/`invalidateRole` immediately after. Safety guards: cannot delete/demote/deactivate the last active admin; cannot delete yourself; cannot delete a system role or one still assigned to a user (Postgres FK `NoAction` enforces the latter).
- **`backend/src/server.js`** — `COLLECTION_PERMISSIONS` map added (25 collections + the two new routes), replacing the old binary `ADMIN_ONLY_COLLECTIONS`. Every route in the approved matrix now carries `requireAuth` + `requirePermission(pageId)`. `activityLogs`/`centerProfile` normalized onto the same mechanism (no behavior change — still admin-only in practice).

**Live-tested end-to-end** (real HTTP, real Postgres, a temporary role+user created and fully deleted afterward — DB confirmed back to exactly 1 user / 4 roles / 0 teachers):
- No cookie → 401. Wrong/nonexistent account → identical 401 message (no enumeration).
- Granted permission → 200; ungranted permission → 403 (fail-closed proven, not just asserted).
- Per-user override correctly **replaces** the role's array rather than merging with it (Decision 2, verified both directions).
- Editing a role's permissions live-invalidated an already-issued session (401 "your permissions changed" on its very next request, not 403) — the session-version mechanism (Decision 3/Correction 3) proven, not just designed.
- `admin` cannot delete themself (409) or the `admin` system role (409) — both guards fired correctly.
- Financial dedicated routes (`payments`, `admissions/:id/cancel-with-refund`, `treasuryTxn`, `cashboxes`) confirmed reachable and still running their own pre-existing validation logic after the new middleware — no transaction/lock code was touched.

## 7. Deviation found and fixed during verification

My first pass of `users.js`'s BigInt-serialization helper dropped a `typeof input.toJSON !== 'function'` guard present in the original `crud.js` version it was modeled on. Without it, `Date` fields (`lastLogin`, `createdAt`) serialized as empty objects (`{}`) instead of ISO strings. Caught by live-testing the actual JSON response (not just status codes), fixed to match `crud.js`'s exact guard, and reverified live. No other deviations from the approved design.

## 8. Admin bootstrap

`backend/scripts/adminCreate.js` (new, `npm run admin:create`) — interactive id/name/password prompt (password masked character-by-character, never echoed or logged), hashes via the same server-side `hashPbkdf2`. Refuses to run if an active admin already exists unless `--reset` is passed, and even then requires typing `RESET` literally. **Not executed against the real database** — running it would have modified the one real, already-working admin credential, which you explicitly said not to touch. Verified only via `node --check` (syntax) and code review. `verifyPassword()` in `src/utils/crypto.js` had its plaintext-comparison branch removed — any non-`pbkdf2:`-formatted stored value now fails closed instead of matching raw text.

## 9. Login rate limiting

`express-rate-limit` installed. Two independent, in-memory limiters on `POST /api/session`: IP-keyed (broad) and account-id-keyed (tight, keyed on the submitted id regardless of whether it exists). Both return an identical 429 body/message — verified that a wrong password and a wholly nonexistent account id produce byte-identical 401 responses today (no enumeration signal), consistent with the same principle applying to the rate-limit responses.

## 10. Frontend: UsersPage / identity migration off local storage

- **`src/store/auth.context.jsx`** — `users`/`roles` state and their `localStorage['studix-auth-users']`/`['studix-auth-roles']` persistence removed entirely. `login()` no longer has an offline/local fallback path (nothing left to fall back to); a genuinely unreachable backend now returns a clear, honest failure message instead of a silent local success. `canAccess()` simplified to read the `permissions` array the backend already resolved and returned at login — the frontend no longer computes permissions itself; it mirrors what the server already decided (**"backend authorization is authoritative; frontend permissions are UI guidance only,"** per your required final architecture). `teachers`/`localStorage['studix-auth-teachers']` were **not** touched — Teachers domain remains fully out of scope, exactly as instructed.
- **`src/services/api.js`** — added `pgGetUsers/pgCreateUser/pgUpdateUser/pgDeleteUser` and `pgGetRoles/pgCreateRole/pgUpdateRole/pgDeleteRole`, matching the codebase's existing fetch/error conventions exactly.
- **`src/modules/users/UsersPage.jsx`** — the Users and Roles tabs now fetch from and write to PostgreSQL via the functions above; the Teachers tab is byte-for-byte unchanged (still local, still `studix-auth-teachers`). One necessary behavior change, flagged explicitly rather than silently absorbed: a user's `teacherId` link is **no longer sent to the backend at all** — `users.teacher_id` is a real FK to the (currently empty) `teachers` table, and sending a local-only teacher id would violate that constraint. The local, teacher-side link (`teacher.userId`) still works exactly as before; only the reverse, user-side field was dropped, since persisting it server-side isn't possible until the separately-scoped Teachers migration exists.
- **`src/store/index.js`** (`useApp()` compatibility shim, confirmed to have zero real component consumers already) — its stale `users`/`setUsers`/`roles`/`setRoles` re-exports (which would otherwise silently be `undefined`) were removed, and a login-audit-log description that depended on the removed local `users` array was fixed to use the login result's own `name` field instead.

## Verification summary

- `npx vite build` — clean build, zero errors (one pre-existing, unrelated warning in `StudentForm.jsx`, not touched by this work).
- `npx vitest run` — **153/153 tests passed across all 23 test files**, no regressions.
- Full live HTTP authorization test pass (§3–6 above), including the version-invalidation and per-user-override mechanisms specifically, not just the common-case allow/deny path.
- Database state before and after: identical row counts everywhere except the two intentional additions (the `auth_version` columns and their default values) and the four roles' `permissions`/`auth_version` fields, exactly as approved. The real `admin` account's password hash, `active` flag, and `last_login` were never touched by any step.

## Explicitly not done (as instructed)

Teachers domain migration, `matDist` fixes, `admissionSystemLog`/`waReportLog` write-hardening (pending its own separate audit, per Decision 5), Phase 3B-16, and any generic refactoring beyond what this change directly required.

---

**Status: implementation complete per the approved contract, live-verified, zero data loss, real admin account untouched. Awaiting your review.**
