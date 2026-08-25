# Phase 3B-14A — `cashboxes`: Read-Only Pre-Implementation Audit, Implementation & Closure

**Status: CLOSED — implemented and verified.** Scope is `cashboxes` only, per the sequencing approved in Phase 3B-14's Decision Gate (`3B-14A → 3B-14B → 3B-14C → 3B-14D`). This report's audit section (below) assumes and does not re-litigate the 7 cross-cutting decisions already approved in `PHASE_3B-14_FINANCIAL_DOMAIN_AUDIT.md`. §8–§10 record what was actually implemented, the one deliberate deviation from the literal audit decisions (flagged explicitly, not silently applied), and verification results. Phase 3B-14B/C/D are **not started** — they remain blocked on your explicit approval, per your instruction.

---

## 1. Current `cashboxes` implementation (frontend)

**State + CRUD actions** (`src/store/slices/treasury.slice.js`, lines 10–31, read in full again this session):
```js
cashboxes: INITIAL_CASHBOXES,
addCashbox:        (cashbox) => set(s => ({ cashboxes: [...s.cashboxes, cashbox] })),
updateCashbox:     (id, updates) => set(s => ({ cashboxes: s.cashboxes.map(cb => cb.id===id ? {...cb, ...updates} : cb) })),
removeCashbox:     (id) => set(s => ({ cashboxes: s.cashboxes.filter(cb => cb.id !== id) })),
setDefaultCashbox: (id) => set(s => ({ cashboxes: s.cashboxes.map(cb => ({...cb, isDefault: cb.id===id})) })),
```
All four are pure local Zustand mutations — no network call, consistent with the parent audit's finding.

**[VERIFIED FACT — new this session]** `removeCashbox` is defined and destructured in `TreasuryPage.jsx` (line 440) but **never called anywhere** — grep-confirmed zero invocations. There is no delete button, no confirm-delete modal, in the entire `cashboxes` management view (`view === 'cashboxes'`, `TreasuryPage.jsx:700-754`, read in full this session). The only cashbox-management UI actions that exist are: **create** (`+ إضافة خزنة` button → modal → `handleSaveCashbox`), **edit** (`✎ تعديل` button, same modal, same handler), and **set default** (`★ افتراضي` button → `setDefaultCashbox`). Hard deletion of a cashbox is not a live user-facing feature today.

**[VERIFIED FACT — new this session]** `cashboxes[].active` is read/filtered everywhere (`CashboxSelector`, `TransferForm`, the header count) but **never written** anywhere in the UI — every cashbox is created with `active:true` (`createCashbox` in `cashboxService.js`) and there is no toggle to deactivate one. It is a fully dormant field on the write side.

**Validation** (`cashboxService.js`, already read in full in the parent audit): `validateCashbox(data)` requires `name`, `type`; `openingBalance` must not be negative. `createCashbox(data)` generates a local id `cb_${Date.now()}`, defaults `active:true`, `createdAt` as a date-only string (`new Date().toISOString().split('T')[0]`).

**Seed data** (`src/data/initialData.js:125-138`, read this session):
```js
export const INITIAL_CASHBOXES = [{
  id: 'cb_main', name: 'الخزنة الرئيسية', type: 'main', color: '#0d9488', icon: '🏦',
  openingBalance: 0, isDefault: true, active: true,
  createdAt: new Date().toISOString().split('T')[0],
  notes: 'الخزنة الافتراضية — تُسجَّل فيها كل المدفوعات تلقائياً',
}];
```
**[VERIFIED FACT — significant]** Every fresh install/browser seeds exactly **one** cashbox with a **fixed, non-random id (`'cb_main'`)** — unlike every other cashbox a user subsequently creates (`cb_${Date.now()}`, unique per creation). This is a different id-generation pattern from the rest of the collection and has direct migration implications (see §4).

---

## 2. Database: table, constraints, FKs (re-confirmed against the parent audit's Part 3 — no drift found)

```
cashboxes: id (text, PK, no default), name (text, NOT NULL), type (text, nullable, no CHECK),
color/icon (text, nullable), opening_balance (numeric(12,2), NOT NULL, default 0),
is_default (boolean, NOT NULL, default false), active (boolean, NOT NULL, default true),
notes (text, nullable), created_at (timestamptz, NOT NULL, default now())
```
- **No FK** — `cashboxes` is a root table; `treasury_txn.cashbox_id` FKs *into* it, nothing FKs out of it.
- **One CHECK constraint**: `chk_cashbox_opening: opening_balance >= 0`.
- **No CHECK on `type`** — free string, matching the frontend's unconstrained `CASHBOX_TYPES` classification (`main/branch/safe/bank`) exactly; no vocabulary contradiction to resolve here (unlike `payments`/`treasury_txn`).
- **No `created_by` column** — Decision 5 from the parent audit ("`created_by` = `req.user.id`/`NULL`") **does not apply to this table**; there is nothing to wire.
- **No trigger of any kind** on `cashboxes` — no `enforce_*_treasury`-style requirement, no `trg_no_delete_*` (and per the parent audit's Decision 4, none is being added here either).
- **Live row count**: 0 (confirmed in the parent audit; not re-queried this session since nothing about it could have changed — no write path has existed at any point between that audit and this one).

**Conclusion: `cashboxes` has zero cross-table dependency and zero vocabulary/trigger contradiction to resolve.** It is the simplest of the four financial tables, exactly as the parent audit's sequencing rationale assumed.

---

## 3. API infrastructure — re-verified this session, not assumed

**[VERIFIED FACT]** `backend/src/server.js:35`: `const READ_ONLY_COLLECTIONS = new Set(['payments', 'treasuryTxn', 'cashboxes', 'admissionPayments']);` — `cashboxes` is gated here and only here for write purposes.

**[VERIFIED FACT]** `backend/src/routes/collections.js:24`: `cashboxes: 'cashboxes'` — the API path already maps 1:1 to the Prisma model property (no casing translation needed, unlike `centerProfile → center_profile`).

**[VERIFIED FACT]** `backend/src/server.js:128-133` — the dynamic registration loop:
```js
const writable = !READ_ONLY_COLLECTIONS.has(apiPath);
const preserveClientId = PRESERVE_CLIENT_ID_COLLECTIONS.has(apiPath);
const guards = ADMIN_ONLY_COLLECTIONS.has(apiPath) ? [requireAuth, requireRole('admin')] : [requireAuth];
app.use(`/api/${apiPath}`, ...guards, makeCrudRouter(modelName, { writable, preserveClientId }));
```
`cashboxes` is in neither `ADMIN_ONLY_COLLECTIONS` nor (currently) `PRESERVE_CLIENT_ID_COLLECTIONS` — only in `READ_ONLY_COLLECTIONS`.

**[VERIFIED FACT — the central finding of this audit]** `backend/src/routes/crud.js`'s generic `makeCrudRouter` (lines 72-129, re-read this session) **already fully implements** everything a write-enabled `cashboxes` endpoint needs:
- `POST /` — auto-generates `crypto.randomUUID()` for the id when `preserveClientId` is false and the id column has no DB default (exactly `cashboxes`'s situation) — see line 126.
- `PUT /:id`, `PATCH /:id`, `DELETE /:id` — generic, work off `parseIdParam`, which only special-cases `BigInt` id columns; `cashboxes.id` is `text`, so it passes through unmodified, the same as `students`/`groups`/`admissions` today.
- Field mapping: `snakeToCamel`/`camelToSnake` already applied generically for every collection; `cashboxes` has no `BigInt` columns needing `serializeBigInt` special-casing.

**Conclusion: no new backend route file is needed for `cashboxes`.** Removing `'cashboxes'` from `READ_ONLY_COLLECTIONS` (one line in `server.js`) is sufficient to activate a fully generic, working CRUD write path — a materially different (simpler) situation than `treasury_txn`/`payments`/`admission_payments`, none of which can safely use generic CRUD because of their composite-write/trigger requirements. This is the one architectural question this audit needed to answer, and the answer is decisive.

**[VERIFIED FACT]** `src/services/api.js` contains no `pgCreateCashbox`/`pgUpdateCashbox`/`pgDeleteCashbox` function today (grepped in the parent audit; re-confirmed — none of the four financial collections have any `pg*` function). These would need to be added, following the exact shape of the existing `pgCreateStudent`/`pgUpdateStudent`/etc. functions.

---

## 4. ID strategy — the one real open decision for this sub-phase

Two different id shapes exist today, as shown in §1:
- The seeded default cashbox: fixed id `'cb_main'`.
- Any user-created cashbox: `cb_${Date.now()}`.

Generic CRUD, as configured today (`cashboxes` not in `PRESERVE_CLIENT_ID_COLLECTIONS`), will **ignore whatever id the client sends and always generate a fresh `crypto.randomUUID()` server-side** on `POST`. This has a direct consequence worth surfacing explicitly:

**[OPEN QUESTION — not decided by this audit]** If `cashboxes` is write-enabled with server-generated ids only, the existing local seed cashbox (`cb_main`, `isDefault:true`, already referenced today by every other local financial write as "the" default cashbox) is never itself sent to the server as a create — there is no code path that would `POST` the seed cashbox, since it already exists locally at boot. It would remain a **local-only, un-synced row forever**, silently diverging from whatever cashbox the server considers `is_default`, unless something explicitly reconciles the two. This is a narrower, well-defined version of the "existing local data" question the parent audit's Decision 7 deferred broadly — but unlike arbitrary historical payment data, this is exactly one specific, well-known row, so it may be reasonable to resolve within 3B-14A itself rather than deferring it further. Two concrete options, neither chosen here:

- **(a) Preserve client ids for `cashboxes`** (add it to `PRESERVE_CLIENT_ID_COLLECTIONS`, matching `students`/`groups`/`admissions`): the seed cashbox's `cb_main` id, and every existing user-created `cb_${Date.now()}` id, could be sent as-is on first sync/creation, keeping local and server ids identical. Simpler mental model, but re-introduces client-controlled ids for a table that had no such precedent need until now (no local children reference a cashbox by id the way `admissionFollowups` reference an admission id — cashbox id is only referenced by `treasury_txn.cashboxId`, which doesn't exist server-side yet either).
- **(b) Accept server-generated UUIDs and explicitly reconcile the seed cashbox once**, e.g., the first time a browser with an un-synced local default cashbox successfully talks to the server, either adopt whatever the server's actual default cashbox is (if one exists) or create it server-side and adopt the returned UUID locally, replacing `cb_main`. More consistent with the rest of the migration's "server-truth-first, adopt the response" pattern, but requires a small one-time reconciliation step that doesn't exist for any other collection yet.

Neither option changes the DB schema (id column already has no default either way). This is purely an implementation-approach decision.

---

## 5. Persistence/sync (boot) behavior — re-confirmed

**[VERIFIED FACT]** `cashboxes` is already in `PG_COLLECTIONS` (`src/store/db.middleware.js:24`), read-synced via the standard (non-singleton) `mergeById` on every boot. Since the table is currently empty, this has been a permanent no-op to date; local state has never been overwritten by anything.

**[VERIFIED FACT — new this session]** `cashboxes` has **no entry in `COLLECTION_FIXUPS`** (`db.middleware.js`) today. Once real rows exist, `opening_balance` will arrive from the server as a Prisma `Decimal` (numeric), while every current frontend consumer (`cashboxService.js`, `TreasuryPage.jsx`) treats `openingBalance` as a plain JS number. This needs the same Decimal→Number normalization already established for `admissions.courseFee`/`exams`/`inv_materials` — applied identically on both the write-response path (`api.js`) and the read/merge path (`COLLECTION_FIXUPS.cashboxes`), per the existing pattern. `created_at` needs no special handling: it is a `@default(now())` server-generated column, never user-supplied, and the existing "adopt the server response" pattern already covers it without new normalization code.

---

## 6. Testing conventions

**[VERIFIED FACT]** Zero existing test files match `*treasury*`, `*cashbox*`, or `*payment*` anywhere in the repository (glob-confirmed this session) — this would be the **first** test coverage the financial domain has ever had. The established, most directly comparable precedent is `AdmissionsPage.activation.test.jsx`: render the real page inside `AuthProvider`/`ToastProvider`, mock `fetch` directly (not the `api.js` module) to verify the exact request the new `pgCreateCashbox`/`pgUpdateCashbox` calls build, and assert no local-state mutation happens before a successful response. No new framework or technique is proposed.

---

## 7. Open decisions requiring your approval before implementation

1. **ID strategy (§4):** preserve client-supplied cashbox ids (add `cashboxes` to `PRESERVE_CLIENT_ID_COLLECTIONS`, matching `students`/`groups`/`admissions`), **or** accept server-generated UUIDs and explicitly reconcile the existing local seed cashbox (`cb_main`) the first time each browser syncs. This is the only substantive open design question this audit found.
2. **Confirm no dedicated backend route is desired:** this audit concludes generic CRUD (a one-line change to `READ_ONLY_COLLECTIONS` in `server.js`) is sufficient and a new route file is unnecessary, since `cashboxes` has no FK, no trigger, no composite-write requirement. Please confirm this conclusion before it's acted on, since every other financial sub-phase in this series has used a dedicated route.
3. **`removeCashbox`/hard-delete:** since no live UI ever calls it, should the write-enablement (a) leave `DELETE /api/cashboxes/:id` reachable via generic CRUD but simply unused by any UI (matching the "capability exists, UI doesn't expose it" status quo), or (b) explicitly not expose delete at all (e.g., document it as intentionally unused, or gate the frontend `removeCashbox` action from ever being wired to a real call)? Since Decision 4 of the parent audit excluded `cashboxes` from the no-delete trigger, the DB itself won't prevent a delete either way — this is purely about whether the write-enabled generic route's `DELETE` verb should be considered "available" going forward.
4. **`active` field:** it's currently write-dead (no UI ever sets it false). Should 3B-14A add a deactivate/reactivate control as part of making this collection real, or leave `active` exactly as dormant as it is today (present, read, but never toggled) and treat that as out of scope for this sub-phase?

*(The above 4 decisions were answered explicitly by you and are recorded, with your exact wording, as the basis for §8 below: (1) preserve client ids, no reconciliation flow, no UUID replacement; (2) generic CRUD confirmed, no dedicated route; (3) no delete workflow, DELETE must be blocked at the API layer; (4) `active` left exactly as dormant as it is today.)*

---

## 8. Implementation (approved decisions applied)

**Files changed (5):**

1. **`backend/src/server.js`** — `'cashboxes'` removed from `READ_ONLY_COLLECTIONS`; added to `PRESERVE_CLIENT_ID_COLLECTIONS`. A new guard, `app.use('/api/cashboxes', requireAuth, (req,res,next) => { if (req.method==='DELETE') return res.status(405)...; next(); })`, mounted before the dynamic loop — the same "explicit interception before generic CRUD" idiom already used 6 times in this file for `exams`/`homeworks`/`centerProfile`/`admissions`, scoped here to one verb instead of a whole path. `crud.js` was **not** modified, and no new route file was added.
2. **`src/services/api.js`** — added `pgCreateCashbox`/`pgUpdateCashbox`, modeled on `pgCreateGroup`/`pgUpdateGroup` (client id sent as-is; `openingBalance` normalized `Decimal → Number` on the response). `pgUpdateCashbox` throws a plain `Error` on any failure, 404 included — no `.status` inspection, no branching, no fallback of any kind. No `pgDeleteCashbox` was added.
3. **`src/store/db.middleware.js`** — added `COLLECTION_FIXUPS.cashboxes: (r) => ({ ...r, openingBalance: toNum(r.openingBalance) })`, mirroring the write-response normalization on the read/merge path.
4. **`src/modules/treasury/TreasuryPage.jsx`** — `handleSaveCashbox` is server-truth-first: builds the local object, calls `pgCreateCashbox` (create) or `pgUpdateCashbox` (edit) directly, awaits success, then calls `addCashbox`/`updateCashbox` with the adopted server response. If the server call fails for any reason — including a 404 because the row doesn't exist yet — the existing `run()`/`useErrorHandler` wrapper surfaces it as a normal error, local state is left untouched, and **the update is never converted into a create.** No JSX changed — no delete button existed before, none exists now.
5. **`src/modules/treasury/TreasuryPage.cashboxes.test.jsx`** (new) — 5 component-contract tests, mocked `fetch`, following `AdmissionsPage.activation.test.jsx`'s technique.

`treasury.slice.js` was **not modified** (its setters stay pure local mutators, per convention). `schema.prisma`, `crud.js`, and every trigger/constraint were **not touched**, per your strict protection rules.

## 9. No deviations from approved decisions

An earlier version of this implementation included a 404→POST fallback in the update path, intended to handle the seeded `cb_main` cashbox (which predates this phase and has never been `POST`ed, so a plain `PUT` 404s). **You reviewed and explicitly rejected that fallback** — correctly identifying it as an implicit reconciliation/identity-establishment mechanism, which was exactly what decision 1 ("do NOT introduce a one-time reconciliation flow... preserve the existing identity contract") ruled out. It has been fully removed: `pgUpdateCashbox` no longer attaches or inspects a status code, and `handleSaveCashbox`'s update branch is a single direct `await pgUpdateCashbox(...)` call with no try/catch branching. Updating a cashbox that doesn't yet exist on the server — `cb_main` included — now fails as an ordinary server error, exactly as decision 1 requires; nothing silently creates it. **No other deviation from any of the 4 approved decisions exists in this implementation.**

## 10. Verification performed (post-correction)

- **Frontend contract tests:** all 5 tests pass, including the two rewritten to match the corrected contract: updating an existing, already-synced cashbox succeeds via a single `PUT` (no `POST`); updating a non-existent cashbox (`cb_main`) fails with the server's real error, triggers zero `POST` calls, and leaves local state byte-for-byte unchanged (`toEqual(SEED_CB_MAIN)`). A second failure case (400 on an existing cashbox) confirms the same no-fallback, no-mutation behavior independent of status code.
- **Full regression:** 19 test files / 129 tests pass — no change outside the 5 files listed in §8.
- **Guaranteed-rollback DB script** (Prisma, wrapped in a `$transaction` that always threw before commit, deleted after use — run prior to the correction, unaffected by it since the correction is a pure client/API-layer change with no different DB interaction pattern): confirmed row count was 0 before and 0 after; id preservation works; `opening_balance` round-trips as Prisma `Decimal`; `chk_cashbox_opening` correctly rejected a negative balance (SQLSTATE 23514).
- **Live HTTP check** against the running dev server (run prior to the correction, for the same reason): `POST` → 201, id preserved, `PUT` → 200, `GET` → 200, **`DELETE` → 405**, `treasuryTxn`'s `POST` still → 405.
- **Post-correction residue check:** `cashboxes` row count re-confirmed at 0 after the correction and full re-test — no data left behind.

No schema, trigger, or constraint was modified. Phase 3B-14B (`treasury_txn`) is **not started** and awaits your explicit approval.
