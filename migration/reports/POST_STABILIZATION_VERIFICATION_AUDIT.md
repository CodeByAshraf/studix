# Post-Stabilization Verification Audit

**Status: READ-ONLY. No code, schema, database, or localStorage was modified to produce this report.** Every finding below was re-derived this session directly against the current codebase and live Postgres state — nothing is carried forward from the implementation closure report on trust alone. Where this audit contradicts something stated in that earlier report, it is called out explicitly rather than silently reconciled.

---

## A) Post-Stabilization Verification Result

### 1. Identity source of truth — **CONFIRMED**

- `grep` of the whole `src/` tree for `studix-auth-users`/`studix-auth-roles` found exactly **one** remaining live reference to each, both inside `SettingsPage.jsx`'s `handleClearAll()` — a "wipe all local app data" utility that calls `localStorage.removeItem(...)` on every known key, including these two. This is **intentional legacy compatibility** (it purges stale data from any browser that had it pre-migration); it is not a read/write dependency.
- `src/store/auth.context.jsx` no longer declares `users`/`roles` state at all, no longer touches those two keys, and `login()` has no local/offline fallback path left to depend on them.
- `INITIAL_USERS`, `INITIAL_USERS_V2`, `INITIAL_ROLES`, and the already-dead `ROLES` constant in `initialData.js` are confirmed to have **zero remaining importers anywhere in `src/`** — fully dead seed data now, not read by anything at runtime.
- A live Postgres read this session confirms `users` (1 row, `admin`) and `roles` (4 rows, all four permission arrays matching the approved values exactly, `auth_version: 1` on all five affected rows) are the only data `UsersPage.jsx`/`auth.context.jsx` now consult for identity/authorization.
- `studix-auth-teachers` remains fully isolated: still read/written only by `auth.context.jsx`'s local `teachers` state, still only consumed by `UsersPage.jsx`'s Teachers tab, confirmed untouched by this phase.

### 2. Authorization coverage — **CONFIRMED, with one corrected fact from the prior report (see §B)**

- Programmatic diff of `COLLECTION_MODELS` (25 entries) against `server.js`'s `COLLECTION_PERMISSIONS` map: **zero missing, zero extra** — every collection has exactly one permission mapping.
- Every dedicated route mount in `server.js` (14 of them, re-listed via `grep '^app.use('`) carries `requireAuth, requirePermission(...)` — only `/health` and `/api/session` are guard-free, correctly, since they must be reachable pre-authentication.
- `activityLogs`/`centerProfile`: now `requirePermission('activity-log')`/`requirePermission('settings')`. Live-confirmed against the actual role data that **only `admin`'s permission array contains `'activity-log'`/`'settings'`** — behavior is unchanged from the previous `requireRole('admin')`.
- Financial routes re-confirmed against the live `COLLECTION_PERMISSIONS` map and route mounts: `payments` → `payments` (admin/accountant/reception), `treasuryTxn`/`cashboxes` → `treasury` (admin/accountant), `admissionPayments`/admissions cancellation/activation → `admissions` (admin only) — matches the approved matrix exactly.

### 3. Permission consistency — **CONFIRMED**

Live query of `roles.permissions` this session, compared field-by-field against the approved arrays: identical for all four roles, no unexpected entries, no drift. `resolveEffectivePermissions()` re-read fresh: per-user override → role array → **empty array** on NULL/empty/unresolved role, in that order, with no code path that treats `null` as "full access" for any role including `admin` (admin's array is explicit and 16 entries long).

### 4. Session invalidation — **CONFIRMED, read-only inspection only (no mutation test performed, per instruction)**

A full-repository grep for every `prisma.users.*`/`prisma.roles.*` write call found exactly 7 call sites system-wide: the 6 inside `users.js`/`roles.js` (all correctly bump `auth_version` and call `invalidateUser`/`invalidateRole` for every authorization-relevant field) plus one in `session.js` that only touches `last_login` (correctly does not need to bump anything). Because `users`/`roles` are deliberately excluded from `COLLECTION_MODELS`, there is no generic-CRUD bypass path that could mutate `role_id`/`permissions`/`active` without going through this code. No path was found where an authorization-relevant change escapes invalidation.

### 5. Legacy persistence — see the matrix in **C)** below.

### 6. Regression surface — **CONFIRMED, no regressions**

- `npx vitest run`, executed fresh this session: **153/153 tests passed, 23/23 files**, identical to the implementation closure report.
- Grep across `src/` for any remaining old-shape assumption (`useAuth()`/`useApp()` destructuring `roles`/`setUsers`/`setRoles`; `roles[currentUser.role]`; `currentUser.permissions` used as anything but an array) found **zero matches** anywhere outside `auth.context.jsx`'s own, correct implementation.
- One genuine, freshly-discovered side effect (not a bug, but worth naming): `verifyPassword`, `maskPassword`, and `isHashed` in `src/utils/crypto.js`, and `createUser`/`hashNewPassword` in `usersService.js`, now have **zero callers anywhere in the app** — the local/offline login fallback's removal made this entire code path dead. Nothing broke; nothing calls it. See §C for classification.

---

## B) Regressions / Corrections Found

**No functional regressions were found.** One factual correction to the prior implementation-closure report, discovered by re-deriving rather than assuming:

- The prior audit (and this phase's own earlier characterization) treated `admission_system_log` as having **no** protective trigger at all. A fresh, direct query of `information_schema.triggers` this session shows this is **not accurate**: `admission_system_log` already has `trg_no_delete_admlog`, blocking `DELETE` specifically (not `UPDATE`). `wa_report_log` genuinely has **no** trigger at all. This changes the precise shape of the remaining gap for Decision 5 (§D/§E) — it is narrower for `admission_system_log` (edits are still possible, deletes already are not) and unchanged for `wa_report_log` (fully open).
- **One newly-relevant, not-yet-covered gap surfaced by this audit** (a consequence of adding invalidation, not a bug in it): there is no global 401 handler on the frontend. When a session is invalidated server-side (role/permission/active change, or the version-mismatch path this phase added), the very next API call correctly fails with 401, but it currently just surfaces as a toast through the existing `run()`/error-handling pattern — `isLoggedIn`/`currentUser` in `auth.context.jsx` are not automatically cleared, so the UI can appear "still logged in" until the user manually logs out or refreshes. This was never built (it wasn't in the approved contract), but it is more relevant now that server-side revocation is a real, working mechanism. Flagged in §E, not implemented.

---

## C) Remaining Local/Partial Persistence Matrix

| Reference | Where | Classification |
|---|---|---|
| `studix-auth-users` | `SettingsPage.jsx` (`handleClearAll`) only | Intentional legacy compatibility (cleanup-only, purges stale data from pre-migration browsers) |
| `studix-auth-roles` | `SettingsPage.jsx` (`handleClearAll`) only | Intentional legacy compatibility (same as above) |
| `studix-auth-teachers` | `auth.context.jsx` (read+write), `UsersPage.jsx` (Teachers tab), `SettingsPage.jsx` (`handleClearAll`) | **Active runtime dependency — Teachers-domain-only**, correctly untouched and isolated |
| `INITIAL_USERS` / `INITIAL_USERS_V2` / `INITIAL_ROLES` / `ROLES` (in `initialData.js`) | Defined only, zero importers anywhere | Seed/dead code |
| `verifyPassword` / `maskPassword` / `isHashed` (`crypto.js`) | Defined only, zero callers | Dead code (direct consequence of removing the local login fallback) |
| `createUser` / `hashNewPassword` (`usersService.js`) | Defined only, zero callers | Dead code (superseded by `pgCreateUser`/server-side hashing) |
| Zustand `app.store.js` `teachers` slice (`PG_COLLECTIONS`-synced) | Boot-synced from Postgres `teachers` (currently empty) | Seed/dead code — real, correctly-synced, but zero component consumers (pre-existing finding, reconfirmed unchanged this session) |
| `localStorage['studix-v1']` (Zustand `persist`, all other domains) | Unchanged by this phase | Out of scope for this audit — carried forward from the prior architecture assessment, not re-verified here |

No entry in this table was deleted or modified — table is descriptive only, per instruction.

---

## D) Recommended Next Phase Ordering

1. **Frontend session-invalidation handling** (§B/§E) — small, direct consequence of this phase's own mechanism; cheapest to close while the code is fresh.
2. **`admissionSystemLog` / `wa_report_log` write-hardening** (Decision 5's deferred audit) — now more precisely scoped: `wa_report_log` needs the full investigation (no trigger exists at all); `admission_system_log` needs only the `UPDATE` side considered (delete is already blocked).
3. **Teachers domain** — still the largest remaining gap, and now additionally the only concrete example of the frontend/local vs. backend/authoritative split this whole phase was built to eliminate for `users`/`roles`. Two sub-problems remain, unchanged from the prior audit: (a) the two disconnected `teachers` lists (Zustand's synced-but-unused one vs. `auth.context.jsx`'s local-but-live one), (b) the real Postgres `teachers` table is still empty.
4. **`matDist` stale-read fix** — smallest, most isolated, no dependency on anything else; can be done at any point, including before item 3.
5. Any new migration phase (3B-16 or otherwise) — only after 1–2 above, given 1 is cheap and directly closes a gap this phase itself opened, and 2 is a data-integrity question this phase deliberately deferred rather than dropped.

---

## E) Issues to Fix Before Starting Another Migration Phase

- **Recommended, not blocking**: add a minimal global 401 handler (or a shared response-checking wrapper) so a server-invalidated session clears `isLoggedIn`/`currentUser` and redirects to login, instead of leaving the UI in a stale "still logged in" state until a manual refresh. This is a direct, small consequence of work already done in this phase.
- **Recommended, not blocking**: resolve `wa_report_log`'s and `admission_system_log`'s remaining write-exposure per Decision 5's own deferred audit, now re-scoped precisely per §B.
- **Not blocking**: the dead-code list in §C (crypto.js's unused functions, usersService.js's unused functions, the unused Zustand `teachers` slice) is safe to leave as-is; removing it would be cleanup/refactoring, explicitly out of scope unless you ask for it separately.
- **Nothing found in this audit prevents starting the next migration phase.** The two "recommended" items above are small and independent of any new phase; neither touches Teachers, `matDist`, or anything already deferred.

---

**No code, schema, database, or localStorage was modified to produce this report. Awaiting your review before any further action.**
