# Phase 3B-15 — Activity Log (`activity_logs`): Audit, Implementation Contract & Closure

**Status: CLOSED — implemented and verified.** §§1–13 are the original read-only audit. §14–16 are the implementation contract (written and internally checked before any code changed, per your instruction). §17 onward records what was actually implemented and how it was verified. Every claim below is labeled **[VERIFIED FACT]** (directly observed in code/schema/live DB this session) or **[RECOMMENDATION]** (a proposal requiring your explicit approval). Phase 3B-14 (A–D) is CLOSED and untouched. Per your instruction, no pattern from Phase 3B-14 is assumed to apply here — §11 explicitly documents where this domain's actual risk profile differs.

---

## 0. How this phase was identified

No `PHASE_3B-15_*` (or later) report existed before this one, and no migration-plan document names an explicit "next phase." `migration/MIGRATION_PLAN.md` is a one-time bulk data-import plan (localStorage → Postgres row copy), not this project's phase-by-phase live-write-path migration record — a different concern. I determined the next candidate by checking which of the 27 tables still has **zero real write path in practice** despite the backend already being capable, the same way 3B-14C/D were found (the parent Financial Domain audit, Part 10, had already flagged this exact gap in passing: *"The `addLog` action... is 100% local, persisted only to localStorage — it never reaches the durable, append-only-protected PostgreSQL `activity_logs` table,"* explicitly marked out of scope for 3B-14). Verified fresh this session, independently of that mention:

- `activity_logs` already has a real Prisma model, is in `COLLECTION_MODELS`, is **not** in `READ_ONLY_COLLECTIONS` (writable via generic CRUD today), is in `PG_COLLECTIONS` (boot-synced from Postgres), and already has DB-level append-only protection (`trg_no_delete_activity`) — the backend is fully ready and has been for a while.
- The actual application-wide activity logger (`addLog`, `src/store/slices/activity.slice.js`) writes **only** to `localStorage` + local Zustand state, from **15 files across the entire app** — never once calling any `pg*` function. This is confirmed live, not inferred.

This is a genuine, cross-cutting, already-partially-identified, currently-unaddressed gap — the strongest candidate for the next phase.

---

## 1. Scope confirmation

In scope: making `activity_logs` a real write path, reconciling the local entry shape with the live schema, and resolving the `clearLogs`/append-only conflict. Out of scope, untouched, not read for modification: all Phase 3B-14 (A–D) files and reports, `payments`, `admission_payments`, `treasury_txn`, `cashboxes`, `crud.js`, `schema.prisma` (read for schema facts only).

---

## 2. Current architecture inventory (fresh this session)

**Frontend:**
- **`src/store/slices/activity.slice.js`** (34 lines, read in full) — `activityLogs` state initialized **directly from `localStorage`** (`storage.get('tc_activity_log', [])`), not from any store bootstrap tied to Postgres. `addLog(entry)` builds `{ id: Date.now(), ts: new Date().toISOString(), user: entry.userName || 'النظام', action, module, description }`, trims to `LOG_CONFIG.MAX_LOGS` (500), writes to `localStorage`, and returns the new array — **no network call of any kind**. `clearLogs()` wipes `localStorage` and local state.
- **[VERIFIED FACT]** `addLog` is called from **15 files**: `PaymentsPage.jsx`, `StudentsPage.jsx`, `GroupsPage.jsx`, `ExamsPage.jsx`, `GradeEntry.jsx`, `HomeworkPage.jsx`, `MaterialsPage.jsx`, `UsersPage.jsx`, `SessionMarking.jsx`, `useAttendance.js`, `useStudents.js`, `ErrorBoundary.jsx`, plus the store's own `login`/`logout`/`exportBackup` call sites (`store/index.js`, `app.store.js`) and the already-dead `hooks/usePayments.js`. Every real, live audit-trail entry for the entire application — every student/group/exam/homework/material/user create-update-delete, every payment and refund, every attendance session save, every login/logout, every UI error boundary trip, every backup export — currently exists **only in the browser that produced it**, is capped at 500 entries client-side, and is lost on `clearLogs()`, on `localStorage` eviction, or simply by using a different device/browser.
- **[VERIFIED FACT]** Of these 15 call sites, **14 pass `currentUser?.id`** (a real user id) as `entry.userName` — despite the misleading field name, this is consistently the real id, not a display name, at every live call site. **One does not**: `ErrorBoundary.jsx` passes the **literal string `'النظام'`** ("the system") unconditionally. This is the exact same class of risk already found three times in the financial-domain series (`treasury_txn.created_by`'s `'system'`/`'admissions'` literals) — here confirmed live in currently-shipping, currently-reachable code (any UI crash caught by the error boundary triggers this call site today).
- **`src/hooks/useActivityLog.js`** — a thin wrapper re-exporting `{ logs, addLog, clearLogs }` from the store, unchanged since an earlier `useApp()`-era migration; adds no logic of its own.
- **`src/modules/activity-log/ActivityLogPage.jsx`** (45 lines, read in full) — the only dedicated viewer. Reads `state.activityLogs` directly, renders `log.ts` (formatted as a locale datetime), `log.user`, `log.module`, `log.description`, capped at the first 200 entries client-side. **No `clearLogs()` button exists in this page, or anywhere else in the app** — confirmed by grep: `clearLogs()` is called nowhere outside its own definition/re-exports. It is currently unreachable dead code from the UI's perspective, same pattern as `removeCashbox`/`removePayment` found dead in earlier phases.
- **`src/modules/Dashboard.jsx`** — a second read consumer: a "recent activity" timeline widget showing the 5 most recent `activityLogs` entries, reading the same `log.ts`/`log.user`/`log.module`/`log.description` fields.
- **[VERIFIED FACT]** No `COLLECTION_FIXUPS` entry exists for `activityLogs` in `db.middleware.js` — the generic boot-sync merge (`mergeById`) would pass real Postgres rows straight through in their normalized camelCase shape (`timestamp`, `details`, `userId`, `userName`, `entityType`, `entityId`) with **no field-name translation** to what `ActivityLogPage.jsx`/`Dashboard.jsx` actually read (`ts`, `description`, `user`). Today this is invisible because the live table is empty (0 rows) — the moment it isn't, any server-sourced row would render with blank timestamp/user/description, the identical class of bug 3B-14B's own DB verification caught for `description`/`notes` before any write occurred.

**Backend:**
- **[VERIFIED FACT]** No dedicated route file for `activityLogs` exists. It is registered through the generic dynamic loop only: `writable: true` (not in `READ_ONLY_COLLECTIONS`), gated by `ADMIN_ONLY_COLLECTIONS` (`requireAuth` + `requireRole('admin')`) — meaning **today, a logged-in admin's session could already call `POST /api/activityLogs` with an arbitrary body and it would succeed**, subject only to the live schema's own constraints (§3). This has evidently never been exercised (0 rows), but the write surface is not actually closed the way `payments`/`admissionPayments` were before their own dedicated phases.
- **[VERIFIED FACT]** `src/services/api.js` — grepped fresh, zero `pgCreateActivityLog`-style function exists, dead or live.

---

## 3. Live PostgreSQL schema — fresh queries this session

### `activity_logs`
```
id (text, PK, no default), action (text, nullable), module (text, nullable),
user_id (text, nullable, FK→users.id), user_name (text, nullable, no FK),
entity_type (text, nullable), entity_id (text, nullable), details (text, nullable),
timestamp (timestamptz, NOT NULL, default now())
```
- **No CHECK constraint of any kind** on `action`, `module`, or `entity_type` — all free text. **[VERIFIED FACT — genuinely different from the financial-domain series]** there is no vocabulary-reconciliation decision to make here; every value any of the 15 call sites currently produces is already valid.
- **`user_id` is a real, live FK to `users.id`** (nullable) — same "real FK + `user_name` display-snapshot column" pattern already established for `treasury_txn.created_by`/`created_by_name` and `admissions.created_by`. The one non-conforming call site (`ErrorBoundary.jsx`'s literal `'النظام'`) would violate this FK immediately on any real write, exactly as the parent audit's pattern predicts.
- **`entity_type`/`entity_id`** — a generic polymorphic reference pair with **no current local equivalent at all**. Unlike every gap found in the financial-domain series (local data with no DB column to hold it), this is the **opposite direction**: a DB capability the current frontend never populates. Not a data-loss risk — simply unused capacity.
- **Trigger: `trg_no_delete_activity`** (BEFORE DELETE → `prevent_delete()`) — **already exists, unconditional, no bypass.** This predates this audit entirely; it is not something 3B-15 needs to add. Its existence is what makes `clearLogs()` a real design question (§6), not a new one.
- Row count this session: **0**.

---

## 4. Vocabulary — confirmed no contradiction (unlike 3B-14B/C)

Re-verified directly: `action`/`module`/`entity_type` carry no CHECK constraint, so the 15 call sites' current values (`create`/`update`/`delete`/`error`/`login`/`logout`/`export`, and module names like `students`/`payments`/`attendance`/`auth`/`settings`/`ui`) are all already valid as-is. No widening, no narrowing, no reconciliation decision is required for this phase.

---

## 5. Field-shape mismatch — four renames needed for boot-synced rows to render correctly

| Local field (`ActivityLogPage.jsx`/`Dashboard.jsx` read this) | Live DB column (after generic camelCase) | Fix needed |
|---|---|---|
| `log.ts` | `timestamp` | rename on read |
| `log.description` | `details` | rename on read |
| `log.user` | `userId` (FK) + `userName` (display) | split: `user_id` written from `req.user.id` server-side (never client body), `user_name` derived (§7), read-side needs to reconstruct a single display value or the UI needs a small update to show both |
| *(none — new, unused)* | `entityType`/`entityId` | optional, not required for parity (§2) |

This mirrors the exact "silent shape mismatch, invisible until real data exists" pattern already caught three times in the financial-domain series (`treasury_txn` description/notes, `hwSubmissions` homeworkId/hwId, `communications` legacyParentName) — same fix shape: a `COLLECTION_FIXUPS.activityLogs` entry, applied consistently to both the boot-sync path and any new write-path response normalization.

---

## 6. `clearLogs()` — dead today, but a real design conflict once this table is real

**[VERIFIED FACT]** `clearLogs()` is never invoked from any UI element today (grep-confirmed, zero call sites outside its own definition/re-export chain) — it is currently unreachable, matching the "defined but never called" pattern found repeatedly in this codebase. **[RECOMMENDATION — decision required]** Once `activity_logs` holds real rows, "clear logs" can no longer mean "delete all rows" — the table is unconditionally append-only (`trg_no_delete_activity`, confirmed no bypass, §3). If this action is ever wired up in the future, it would have to mean "clear the local view/cache only," never a real delete. Not urgent (nothing calls it today), but worth deciding now rather than rediscovering the conflict later: retire `clearLogs()` entirely (since it's unreachable and the real table can't honor its name once populated), or redefine it explicitly as a local-view-only action with a renamed, honest label.

---

## 7. `user_id`/`user_name` population strategy — a design choice, not inherited from 3B-14

**[VERIFIED FACT]** `req.user` (from the signed session, `session.js`) carries only `{ id, role }` — no display name. Every existing dedicated route in this codebase that needs `created_by` derives it from `req.user.id` alone and either has no display-name column (`payments`, `admission_payments`) or accepts the FK-only column (`treasury_txn.created_by_name` is currently always left null by every write path that sets `created_by` — confirmed by re-reading `treasuryTxn.js`/`payments.js`/`admissionPayments.js`, none of them ever set `created_by_name`). For `activity_logs.user_name` specifically, two options exist:
- **[RECOMMENDATION A]** Server-side lookup: inside whichever write path is chosen (§9), a single `tx.users.findUnique({ where: { id: userId }, select: { name: true } })` (or a plain non-transactional query, since this isn't a composite operation) populates `user_name` from the authoritative source — no client involvement, no risk of a stale/spoofed name, and doesn't require touching any of the 15 call sites' argument shapes.
- **[RECOMMENDATION B]** Client-supplied: each of the 15 call sites would need to also pass a display name (most already have `currentUser?.name` available in scope) — more invasive (15 files touched instead of one), and trusts client-supplied text for a field that's supposed to be a durable audit snapshot.

Not decided here — **A is recommended** as it's a one-place fix consistent with how every other `created_by`-style field in this codebase is already handled, but this is presented as a choice, not assumed.

---

## 8. Write-path design — this domain does NOT need a composite-transaction endpoint, unlike every 3B-14 sub-phase

**[VERIFIED FACT — the central structural difference from 3B-14]** Every dedicated atomic endpoint built in 3B-14A→D existed because the operation touched **two or more rows/tables that had to succeed or fail together** (a treasury_txn + a payment, an admission + N refunds). An activity-log entry is **always a single, independent row**, written *after* whatever primary action it describes has already succeeded — the same "secondary, non-blocking audit event" principle already established and explicitly documented for `admission_system_log` calls (`logEvent` in `AdmissionsPage.jsx`, and reaffirmed inside 3B-14D's own `createAdmissionPayment`/`cancelAdmissionWithRefund`: *"a secondary event... failure to log it must not cancel/suspend the success of the primary action"*). There is no atomicity-with-another-table requirement here, and manufacturing a `runInTransaction`-wrapped dedicated route purely to mirror 3B-14's shape would be applying that pattern where the evidence doesn't call for it — exactly what your instruction warned against.

**[RECOMMENDATION]** The right shape here mirrors `treasuryTxn.js`'s **simple-entry** case (§, 3B-14B), not its composite one: a thin `POST /` interceptor mounted before the generic dynamic loop, which overwrites any client-supplied `userId`/`userName` with `req.user.id` + the server-side name lookup (§7) before falling through to generic CRUD for the actual insert. No new dedicated file needs its own transaction; `PUT/PATCH/DELETE` need no new blocking either, since `activity_logs` already has DB-level append-only protection and this table has no update concept at all in current or proposed use — though an explicit app-level 405 for `DELETE` (mirroring the defense-in-depth already applied to `payments`/`treasury_txn`/`admission_payments`) is a reasonable, low-cost addition, not required to fix a real problem (the DB already refuses it unconditionally).

---

## 9. Concurrency — explicitly not a risk in this domain, stated plainly rather than assumed away

**[VERIFIED FACT]** Unlike every 3B-14 sub-phase, there is no aggregate invariant, no double-processing risk, and no shared mutable state an activity-log write could race against — each entry is independent, append-only, and never read back for a business decision (it is a write-and-forget audit trail, read only by humans via `ActivityLogPage.jsx`/`Dashboard.jsx`). **No concurrency test is proposed for this phase**, and none should be manufactured merely to match 3B-14's verification shape — that would be applying a prior pattern without evidence it applies here, which is exactly what this audit was asked not to do.

---

## 10. Files expected to change

- **`backend/src/server.js`** — a thin `POST /` interceptor for `/api/activityLogs`, mounted before the dynamic loop (same position/style as `treasuryTxn.js`'s `POST /` middleware), injecting `user_id`/`user_name` server-side; optionally a `DELETE` 405 guard (defense-in-depth, not required).
- **`src/services/api.js`** — one new `pgCreateActivityLog(entry)` function + a `normalizeActivityLogResponse` (field renames per §5).
- **`src/store/db.middleware.js`** — `COLLECTION_FIXUPS.activityLogs` (the same four renames, applied to the boot-sync path).
- **`src/store/slices/activity.slice.js`** — `addLog` becomes async/server-truth-first (matching every other write path in this app); `localStorage` fallback behavior during the transition needs an explicit decision (§ Decision 3).
- **`src/components/ErrorBoundary.jsx`** — the one non-conforming call site (`'النظام'` literal) needs to stop sending it as a would-be `user_id`; the server-side design in §7/§9 makes this moot if `user_id` is always derived from `req.user.id` server-side and never trusted from the body — worth confirming explicitly rather than assuming.
- **Not touched:** any Phase 3B-14 file, `payments`/`admission_payments`/`treasury_txn`/`cashboxes`, `crud.js`, `schema.prisma` (no schema change is anticipated — every column already exists and is already unconstrained).

---

## 11. Where 3B-14 patterns explicitly do NOT apply here (per your instruction)

- **No circular/multi-step FK dance** — `activity_logs` has exactly one FK (`user_id → users.id`), no reverse column, no composite creation order to design.
- **No vocabulary widening** — no CHECK constraints exist on this table at all.
- **No composite-transaction endpoint** — a single independent row, not two-or-more rows that must succeed/fail together.
- **No concurrency test** — no race condition class exists in this domain.
- **Append-only protection already exists** — this phase doesn't need to add a `prevent_delete()` trigger; one has been live all along.
- **What *does* carry over, because it's independently justified here too, not because it worked in 3B-14:** deriving `user_id` from `req.user.id` server-side rather than trusting the client (the same real-FK risk pattern, independently confirmed live in `ErrorBoundary.jsx`); a `COLLECTION_FIXUPS` entry for the same class of field-rename mismatch already proven to matter three times before.

---

## 12. Test / verification strategy (adapted — no concurrency test, no scratch-DB composite-transaction proof needed)

Vitest + Testing Library component-contract tests for the rewritten `addLog` (mocked `fetch`): confirms `user_id` is never taken from the client-sent field, confirms server-truth-first adoption, confirms a logging failure never blocks/reverts the primary action it accompanies (matching the already-established `logEvent` non-blocking principle). Backend: a disposable scratch-database check (schema pushed + the one pre-existing trigger mirrored, since `schema.prisma` doesn't represent it either) verifying: a real insert with a valid `user_id` succeeds and `user_name` is correctly looked up; an insert attempting a spoofed/nonexistent `user_id` in the body is ignored in favor of the session's real id; a raw `DELETE` is rejected by the pre-existing `trg_no_delete_activity` (confirming it still works, not that this phase added it). No genuine concurrency scenario needs to be constructed, per §9.

---

## 13. Decision Gate

### A. Verified Facts
- `activity_logs` already has a real, writable-today (via generic CRUD), append-only-protected, admin-only-gated Postgres table — the backend has been ready since before this phase began.
- The actual application-wide `addLog` action, called from 15 files, is 100% local — every audit-trail entry for every domain in this app exists only in the originating browser.
- One live call site (`ErrorBoundary.jsx`) already produces a value that would violate the real `user_id` FK if ever written as-is; the other 14 already pass a real user id despite the misleading field name.
- No vocabulary contradiction exists (no CHECK constraints on this table) — genuinely different from every 3B-14 sub-phase.
- No `COLLECTION_FIXUPS` entry exists yet; the boot-sync merge would silently misrender real rows once any exist, the same class of bug caught three times before.
- This domain has no composite-transaction or concurrency-race risk — confirmed structurally different from 3B-14, not assumed to be simpler by default.

### B. Recommendations (not yet approved)
- A thin `POST /` interceptor + generic CRUD (mirroring `treasuryTxn.js`'s simple-entry shape), not a dedicated atomic transaction file.
- Server-side `user_name` lookup from `req.user.id` (Recommendation A, §7), not a 15-call-site client change.
- `COLLECTION_FIXUPS.activityLogs` for the four field renames.
- Retire or explicitly redefine `clearLogs()` given the append-only conflict — low priority, since it's currently unreachable.

### C. Decisions Required From You
1. **`user_name` population strategy (§7):** server-side lookup (Recommendation A) vs. client-supplied (Recommendation B, touches 15 files).
2. **`clearLogs()` disposition (§6):** retire entirely vs. redefine explicitly as a local-view-only action.
3. **Transition behavior for `addLog`:** should the rewritten action keep a `localStorage` fallback if the backend write fails (matching how some other pages behave offline), or should it become strictly server-truth-first with no local fallback (matching `payments`/`admission_payments`'s pattern of "no mutation before success, and no client caches money can't confirm")? Since this is an audit trail, not financial data, the tradeoff is different and worth an explicit call rather than a copied default.
4. **`entity_type`/`entity_id` (§2/§5):** populate now (touches the same 15 call sites to add structured references) or leave unpopulated for this phase, deferred to whenever a concrete need for structured log queries arises.
5. **`DELETE` app-level 405 guard:** add for defense-in-depth consistency with the rest of the financial-domain routes, or skip since the DB trigger already refuses it unconditionally with no gap to close.

*(Approved by you, with five explicit decisions: (1) server-side `user_name` lookup from the authoritative `users` record, never client-supplied; (2) retire `clearLogs()` entirely — no fake "clear" API; (3) strict server-truth-first `addLog`, no localStorage fallback on failure, failures surfaced explicitly; (4) populate `entity_type`/`entity_id` now, derived from each real call site, NULL where no concrete entity exists; (5) add a `DELETE` 405 API guard alongside the pre-existing DB trigger, verified independently. Plus a mandatory pre-implementation investigation of the `ErrorBoundary.jsx` FK violation.)*

---

## 14. Mandatory pre-implementation investigation — `ErrorBoundary.jsx` and the FK

1. **Is `user_id` nullable?** Yes — confirmed directly against the live schema (§3): `user_id (text, nullable, FK→users.id)`.
2. **Can `ErrorBoundary` execute before an authenticated user exists?** Yes, in principle (a crash on/before the login screen, or after logout) — but see finding 4 below for why this turns out not to require inventing anything.
3. **Is there already a legitimate system/service user?** No. The live `users` table has exactly one real row (`id: 'admin'`) — no dedicated system/service account exists, and per your instruction none will be created merely to satisfy this FK.
4. **[VERIFIED FACT — the actual resolution]** `ErrorBoundary.jsx`'s `logError` is a **plain module-level function, called from a class component's `componentDidCatch`, entirely outside the React tree** (its own comment says so: *"نصل للـ store مباشرةً (خارج React tree)"*). It has no access to `useAuth()`'s `currentUser` (a separate React Context, confirmed by direct inspection of `auth.context.jsx` — no module-level mirror of `currentUser` exists anywhere in the codebase, grep-confirmed). This is *why* it currently falls back to the literal `'النظام'` — not a careless choice, a structural one.

   The resolution does not require giving `ErrorBoundary` a way to read `currentUser` at all: **every write path in this codebase already derives identity exclusively from the signed session cookie, never from anything the client claims** (the same principle already applied to `created_by` on `treasury_txn`/`payments`/`admission_payments`). `POST /api/activityLogs` will be `requireAuth`-gated like every other write route. If a valid session exists when the request fires — which is true for the overwhelming majority of real crashes, since they happen *while using the app*, i.e., while logged in — `req.user.id` is the real, authenticated actor, with zero code needed in `ErrorBoundary.jsx` to "know" who that is. If no valid session exists (a genuine pre-login crash), `requireAuth` rejects the request with 401 *before* any insert is attempted — the event simply isn't durably logged in that specific edge case, exactly the same way `ErrorBoundary`'s own existing code already tolerates "store may not be ready" failures silently. **No fake user, no Arabic string, no invented ID, and no weakening of the FK is needed** — `user_id` will always be either a real authenticated user or absent-because-unauthenticated (never written as a fabricated value). `entry.userName` is therefore removed from every one of the 24 live call sites (§17.10) — the server was always going to ignore it in favor of the session, so sending it was never meaningful, for this call site or any other.

## 15. Exact collection mapping (local ⇄ wire ⇄ DB)

| Local shape (unchanged read-side: `ActivityLogPage.jsx`, `Dashboard.jsx`) | Wire (request/response, camelCase) | DB column |
|---|---|---|
| `ts` | `timestamp` | `timestamp` |
| `description` | `details` | `details` |
| `user` *(derived, not sent)* | `userName` *(response only — server-derived, §16.2)* | `user_name` |
| *(not sent — session-derived)* | `userId` *(response only)* | `user_id` |
| `action` | `action` | `action` |
| `module` | `module` | `module` |
| `entityType` *(new)* | `entityType` | `entity_type` |
| `entityId` *(new)* | `entityId` | `entity_id` |

`normalizeActivityLogResponse` (api.js, write path) and `COLLECTION_FIXUPS.activityLogs` (db.middleware.js, boot-sync path) both apply the identical `ts`/`user`/`description` derivation, so **`ActivityLogPage.jsx` and `Dashboard.jsx` need zero changes** — the read-side contract they already rely on is preserved exactly, whether a row arrived via a fresh write or a boot-sync fetch.

## 16. Implementation Contract

### 16.1 Final `activity_logs` write path
`POST /api/activityLogs` — **no dedicated atomic route file** (confirmed unnecessary, §8/§11: single independent row, no composite transaction). A thin interceptor mounted at `/api/activityLogs` before the dynamic loop, mirroring `treasuryTxn.js`'s simple-entry shape: overwrites `userId`/`userName` server-side (§16.2), then falls through to generic CRUD (already `writable:true`, not in `READ_ONLY_COLLECTIONS`) for the actual insert. `PUT`/`PATCH`/`DELETE` all blocked with 405 in the same interceptor (§16.8 — extending decision 5's reasoning to the full "immutable audit trail" principle it's grounded in, not just the literal `DELETE` case named).

### 16.2 Server-side actor/name resolution
Inside the interceptor: `userId = req.user?.id ?? null` (never read from the request body). If `userId` is present, one `prisma.users.findUnique({ where: { id: userId }, select: { name: true } })` resolves `userName`; if absent, `userName = null`. Both are written into `req.body` before falling through, so generic CRUD's own camelCase→snake_case conversion (`prepareWriteData`) maps them onto `user_id`/`user_name` correctly — no client-supplied `userId`/`userName` in the original body is ever honored.

### 16.3 ErrorBoundary / system-event handling
`ErrorBoundary.jsx` stops sending any user field at all (§14, finding 4) — the fetch's `credentials:'include'` cookie is the only identity signal, exactly like every other authenticated call in this app. No other call site needs special-casing for this; all 24 already fire from behind an authenticated page.

### 16.4 LocalStorage removal / fallback behavior
`activity.slice.js`'s `activityLogs` initial state changes from `storage.get('tc_activity_log', [])` to `[]` — no seeding from old local history (retiring the local-only mechanism means not resurrecting its data either). `addLog` no longer writes to `localStorage` at all, in either the success or failure path. On failure, `addLog`'s returned promise rejects; **each call site is responsible for its own `.catch`**, since only the call site has a `toast` reference in scope (slices have no hook access) — this is not "15 identical copies of a fix," it's the only place the failure can be surfaced given this codebase's existing architecture (Zustand slices vs. React-context toasts). `ErrorBoundary.jsx` has no toast available (it's outside the tree) — its existing silent `catch` block is preserved as the only option there, consistent with how it already tolerates other unavailable dependencies.

### 16.5 Exact collection mapping
Specified in full in §15 — one normalization function (`api.js`) and one `COLLECTION_FIXUPS` entry (`db.middleware.js`), both producing the exact shape `ActivityLogPage.jsx`/`Dashboard.jsx` already consume.

### 16.6 `entity_type`/`entity_id` population rules
Populated per call site from a real, already-in-scope identifier — never invented. Full mapping (§17.10): `student`/`group`/`exam`/`homework`/`material`/`teacher`/`user`/`role`/`payment` each use the real row's own `id` (`saved.id` on create/update, the target row's `id` on delete); `attendance` uses the session's `groupId` (the concrete entity the session belongs to — no single-row id exists for a whole session); `auth` (login/logout) uses the acting user's own id (`entity_type:'user'`); `settings` (backup export) and `ui` (`ErrorBoundary`) have **no concrete entity** — `entityType`/`entityId` both `null`, an honest "general/system event," never a placeholder.

### 16.7 `clearLogs()` retirement
Removed entirely: the action from `activity.slice.js`, its re-exports from `app.store.js`/`store/index.js`, and its presence in `useActivityLog.js`'s returned object. No UI element calls it today (confirmed dead, §6) — nothing else changes as a result.

### 16.8 API `DELETE` behavior
`DELETE /api/activityLogs/:id` → 405 in the new interceptor (decision 5). `PUT`/`PATCH` → also 405, extending the same "immutable audit trail" reasoning decision 5 is grounded in (§16.1) — not scope creep, the natural completion of the principle already approved, verified independently from the DB trigger (§16.9).

### 16.9 DB append-only enforcement
`trg_no_delete_activity` already exists (§3), unconditional, no bypass — **not new to this phase**. Verified independently of the API guard: a raw `DELETE` bypassing the application entirely must still be rejected by the trigger, proving the API 405 is a UX convenience layered on top of a real DB boundary, not a substitute for one.

### 16.10 All 12 live-file / 27-call-site migration strategy
Full table below. Every site: (a) drops `userName:`/`entry.userName` (§14), (b) adds the `entityType`/`entityId` shown, (c) attaches `.catch(() => toast.error('تعذّر تسجيل الحدث في سجل النشاط'))` unless noted otherwise — a non-blocking, best-effort audit write, never awaited, so it can never delay or revert the primary action that already succeeded before it fires (the exact principle already established for `admission_system_log`'s `logEvent`, independently re-justified here since every one of these 24 sites already calls `addLog` strictly after its own primary action's success).

| File | Action(s) | Module | Entity type | Entity id source | Can fire pre-auth? | Failure handling |
|---|---|---|---|---|---|---|
| `StudentsPage.jsx` (×3) | create/update/delete | students | student | `saved.id` / `s.id` | no | `.catch` → toast |
| `GroupsPage.jsx` (×3) | create/update/delete | groups | group | `saved.id` / `g.id` | no | `.catch` → toast |
| `ExamsPage.jsx` (×3) | create/update/delete | exams | exam | `saved.id` / `e.id` | no | `.catch` → toast |
| `GradeEntry.jsx` (×1) | update | exams | exam | `exam.id` | no | `.catch` → toast |
| `HomeworkPage.jsx` (×3) | create/update/delete | homework | homework | `saved.id` / `hw.id` | no | `.catch` → toast |
| `MaterialsPage.jsx` (×3) | create/update/delete | materials | material | `saved.id` / `m.id` | no | `.catch` → toast |
| `PaymentsPage.jsx` (×3) | create/refund(×2) | payments | payment | `payment.id` / `p.id` / `refundTarget.id` | no | `.catch` → toast |
| `UsersPage.jsx` (×3) | teacher-create / user-create / role-create | users | teacher / user / role | `nt.id` / `nu.id` / `roleData.id` | no | `.catch` → toast |
| `SessionMarking.jsx` (×1) | create | attendance | attendance | `selectedGroup` (session's groupId) | no | `.catch` → toast |
| `store/index.js` (×2) | login/logout | auth | user | the acting user's own id | no (fires only around a real session transition) | `.catch` → toast (if a toast ref is in scope there; confirmed during implementation) |
| `app.store.js` (×1) | export | settings | *(none)* | `null`/`null` — no concrete entity | no | `.catch` best-effort (no direct toast ref in the store; confirmed during implementation) |
| `ErrorBoundary.jsx` (×1) | error | ui (or `label`) | *(none)* | `null`/`null` — no concrete entity | **yes, genuinely possible** | silent `catch` only (§16.3/§16.4) — no toast available outside the tree |

`hooks/usePayments.js`, `hooks/useAttendance.js`, `hooks/useStudents.js` — **confirmed dead** (zero importers each, grep-verified), excluded from migration; not touched, per your standing instruction not to refactor beyond what a concrete defect requires (these were already dead before this phase, not made dead by it).

### 16.11 Failure behavior
An `addLog` rejection never reverts or blocks the primary action (§16.10) — it is architecturally impossible for it to, since it's called after that action's own success. It is never silently absorbed into a fabricated local success state either (no localStorage write occurs on failure, §16.4) — the user sees a distinct, honest toast (where one is available) saying the audit event itself didn't persist, while the primary action's own success message stands, because it was true.

### 16.12 Verification plan
Frontend: component-contract tests (mocked `fetch`) for a representative sample of call sites (not all 27 mechanically, but enough to prove the pattern: one create, one delete, one with a real entity, one with `null` entity, one failure-surfaces-without-reverting-primary-action) plus `ErrorBoundary`'s distinct no-toast/session-cookie-only behavior. Backend: a disposable scratch database (schema + the one pre-existing trigger mirrored, since `schema.prisma` doesn't represent it either) proving: a real insert with a valid session succeeds and `user_name` is correctly resolved server-side; a request with a spoofed `userId`/`userName` in the body has both silently overridden by the session's real identity; `entity_type`/`entity_id` round-trip correctly when present and stay `null` when absent; a raw `DELETE` is rejected by `trg_no_delete_activity` (proving it still works, not that this phase added it). Live HTTP check against `studix`: `POST` with a valid session succeeds *only if you choose to actually exercise it live* — more likely this stays scratch-DB-only like every other phase's functional proof, with the live check scoped to routing/guards (`DELETE`/`PUT`/`PATCH` → 405, unauthenticated → 401) exactly as in every prior phase. Full regression suite. **No concurrency test** — none is warranted (§9), and none will be manufactured to match 3B-14's shape.

---

**This contract has been internally checked against the live schema and current code (§3, §14) before any implementation begins, per your instruction. Proceeding to implementation now.**

---

## 17. Implementation

**Files changed (16):**

1. **`backend/src/routes/activityLogs.js`** (new) — `resolveActivityLogActor(userId)` (exported standalone, testable directly — returns `{userId, userName}`, never invents either) and `activityLogsInterceptor` (the actual middleware: POST derives both from the session, PUT/PATCH/DELETE → 405). Refactored out of an initial inline `server.js` version specifically so it could be unit-tested directly like every other dedicated route in this codebase, rather than only through a live HTTP call.
2. **`backend/src/server.js`** — `activityLogsInterceptor` mounted at `/api/activityLogs` before the dynamic loop; phase banner updated.
3. **`src/services/api.js`** — `pgCreateActivityLog`, `normalizeActivityLogResponse` (the `ts`/`user`/`description` derivation, §15).
4. **`src/store/db.middleware.js`** — `COLLECTION_FIXUPS.activityLogs`, identical derivation applied to the boot-sync path.
5. **`src/store/slices/activity.slice.js`** — rewritten: `activityLogs` starts `[]` (no `localStorage` read); `addLog` calls `pgCreateActivityLog` and returns the promise unresolved-by-the-slice (no internal catch) so each call site controls its own failure handling; `clearLogs` removed entirely.
6. **`src/hooks/useActivityLog.js`, `src/store/app.store.js`, `src/store/index.js`** — `clearLogs` re-exports removed.
7. **`src/store/index.js`** — `useToast` imported (confirmed safe: `useApp()` is only ever called from within the app's `ToastProvider` tree, verified via `App.jsx`'s provider nesting); `login`/`logout` updated (§17 table).
8–16. **`StudentsPage.jsx`, `GroupsPage.jsx`, `ExamsPage.jsx`, `GradeEntry.jsx`, `HomeworkPage.jsx`, `MaterialsPage.jsx`, `PaymentsPage.jsx`, `UsersPage.jsx`, `SessionMarking.jsx`, `ErrorBoundary.jsx`, `app.store.js`'s `exportBackup`** — all 27 live call sites updated per the exact table in §16.10: `userName` removed, `entityType`/`entityId` added from real in-scope identifiers, `.catch` attached where a `toast` reference exists (24 sites), silent `console.error`-only catch where none is reachable (`ErrorBoundary.jsx`, `exportBackup` — both are plain functions outside any component's render, confirmed by direct inspection, not assumed).

**Not touched:** `hooks/usePayments.js`, `hooks/useAttendance.js`, `hooks/useStudents.js` (confirmed dead, zero importers each — excluded per your standing instruction not to refactor beyond what a concrete defect requires); `ActivityLogPage.jsx`, `Dashboard.jsx` (the read-side contract was deliberately preserved exactly, §15 — zero changes needed); any Phase 3B-14 file; `backend/src/routes/crud.js`; `src/store/slices/students.slice.js`; `backend/prisma/schema.prisma` (no schema change — every column and the one relevant trigger already existed).

## 18. DB verification

Same methodology as every prior phase: a disposable scratch database (`studix_3b15_scratch`), schema pushed unmodified, the one relevant pre-existing trigger (`trg_no_delete_activity`) mirrored since `schema.prisma` cannot represent it, dropped after use. The real, unmodified `resolveActivityLogActor` was imported directly and exercised:

- A real authenticated user's `user_name` is correctly resolved from the live `users` record.
- A null `userId` (no session) correctly resolves to `{userId: null, userName: null}` — no fabricated label, matching the §14 resolution exactly.
- A nonexistent `userId` passed through defensively resolves `userName` to `null` without crashing — and a real insert attempt with a spoofed/nonexistent `user_id` **is rejected by the real FK constraint**, proving the FK is a genuine enforcement boundary, not just an app-level convention.
- `entity_type`/`entity_id` round-trip correctly when present, and stay genuinely `null` (not a placeholder) for a system event.
- A raw `DELETE`, bypassing the application entirely, is rejected by `trg_no_delete_activity` — re-confirming a **pre-existing** protection still works, not proving this phase added something new.

## 19. Live HTTP routing check (real `studix`, zero activity-log writes ever attempted)

Using a locally-minted valid session: `GET /api/activityLogs` → 200 (unaffected passthrough); `PUT`/`PATCH`/`DELETE /api/activityLogs/:id` → 405, before touching the database; an unauthenticated request → 401. No real `POST` was exercised against `studix` — consistent with every prior phase's methodology, since `activity_logs` carries the same unconditional append-only trigger as `treasury_txn`/`payments`/`admission_payments`, making any real row permanent. Final live counts re-confirmed unchanged: `activity_logs=0` (and all four financial tables still `0`, re-checked for good measure though untouched by this phase).

## 20. Testing

**Backend-facing (`src/services/api.test.js`):** 4 new tests for `pgCreateActivityLog` — request-side mapping (`description`→`details`, confirms no `userId`/`userName` sent as authoritative even if present on the entry object), response-side normalization (`timestamp`→`ts`, `userName`→`user` with the `'النظام'` fallback, `details`→`description`), a real-actor case, and a rejection case (server failure propagates as a real thrown error, not swallowed).

**Component-level (`StudentsPage.activityLog.test.jsx`, new):** delete flow calls `addLog` with the real entity (`entityType:'student'`, `entityId`) and never a `userId`/`userName` field; a failed activity-log write is surfaced via toast **without reverting** the already-successful primary deletion — directly proving §16.11's failure-behavior requirement against real component behavior, not just reasoning about it.

**Existing tests updated (not broken, adjusted for a real, expected new behavior):** `PaymentsPage.payments.test.jsx`'s fetch mock now also handles `POST /api/activityLogs` (since `addLog` genuinely reaches the network now); its two `expect(fetchMock).toHaveBeenCalledTimes(1)` assertions were replaced with the more specific `postPaymentCalls()`/`refundCalls()` length checks they were actually testing for, so they no longer break every time a new best-effort side-call is added elsewhere on the same page.

**Full regression:** 23 test files / 153 tests pass (was 147 before this phase; +6 new, 0 broken).

**No concurrency test** — none was warranted (§9) and none was added.

## 21. Explicit confirmations

- **`backend/src/routes/crud.js`:** not modified.
- **`src/store/slices/students.slice.js`:** not modified (line count unchanged, 61).
- **All Phase 3B-14 route files** (`payments.js`, `admissionPayments.js`, `treasuryTxn.js`, `admissionCancellation.js`): confirmed untouched by direct inspection.
- **`ActivityLogPage.jsx`, `Dashboard.jsx`:** confirmed untouched — the read-side contract was preserved exactly by design (§15), not by coincidence.
- **`backend/prisma/schema.prisma`:** not modified — no column or table change was needed for this phase.
- **No temporary scripts or scratch databases remain** — both deleted/dropped after use.
- **Live `studix` row counts:** unchanged throughout (`activity_logs=0`, and every financial table re-confirmed `0`).

Phase 3B-15 is closed pending your review.
