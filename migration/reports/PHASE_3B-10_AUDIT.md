# Phase 3B-10 — Audit, Fix & Closure Report

**Module:** `centerProfile` (`center_profile` table)
**Original audit classification: MIXED.** The dedicated write path (`PUT /api/centerProfile`) was already shipped, correct, and tested. The read/merge path (`db.middleware.js`) had a confirmed, live, untested bug. This report covers both the audit and the approved fix.

---

## 1. Confirmed §12 bug — root cause

`centerProfile` is the only entry in `PG_COLLECTIONS` (`db.middleware.js`) whose local store shape is a **plain singleton object** (`{name, slogan, address, phone1, phone2, logoUrl}`, per `centerProfile.slice.js`) rather than an array. Every other entry in `PG_COLLECTIONS` is array-shaped.

`loadFromPostgres`'s merge loop applied `mergeById(state[name], fetched[name])` unconditionally to every fetched collection. `mergeById`'s first line, `Array.isArray(localArr) ? localArr : []`, treated the non-array `state.centerProfile` as `[]`. Since `pgGetCollection('centerProfile')` (a plain `GET /api/centerProfile`, served by the generic CRUD router's `findMany()` — the dedicated route only defines `PUT`) returns an array (confirmed live: exactly 1 row, `id=1`, all fields null at audit time), `mergeById` returned `[...[], ...pgArray]` — a **one-element array** — which was written back into `state.centerProfile`.

## 2. Why this was destructive

8 real consumers (`SettingsPage.jsx`, `StudentReportPage.jsx`, `PrintHeader.jsx`, `AdmissionsPage.jsx`, `AttendanceReports.jsx`, `ExamReports.jsx`, `PaymentReceipt.jsx`, `PaymentReports.jsx`) read `centerProfile.name`/`.address`/`.phone1`/`.phone2`/`.logoUrl` as a plain object. After corruption: `SettingsPage.jsx`'s `useState({ ...centerProfile })` spreads an array into `{0: {...}}` — every field reads `undefined`, the Settings form goes blank, and every printed report header silently loses the center's name/address/logo. Worse: if an admin then hit Save on the now-blank form, `buildCenterProfileRequestBody` would send `name/address/phone1/phone2/logoUrl` as all `null`, **destructively overwriting real server data with nulls**.

Trigger conditions were not rare: the corrupting `GET /api/centerProfile` requires only an authenticated **admin** session (it is in `ADMIN_ONLY_COLLECTIONS`, same guard as the write path) and fires on every ordinary app reload via `DBInit`'s `useDB()` effect — a mainline scenario for exactly the users who use this feature. `db.middleware.test.js` (17 tests, all passing) contained zero references to `centerProfile` before this fix — the bug was completely unguarded.

## 3. Approved decision

**Fix now, using Option (a):** add a narrowly scoped `centerProfile` special case inside `loadFromPostgres`'s merge loop in `src/store/db.middleware.js`. `mergeById` itself was left untouched. No schema, API, or write-path changes.

## 4. Exact files modified

- **`src/store/db.middleware.js`**
  - Added `mergeCenterProfileSingleton(localValue, pgArr)`: defensively coerces a non-object/array `localValue` to `{}`, takes `pgArr[0]` as the server row (already camelCase — `crud.js`'s GET already runs `snakeToCamel`), and returns `{ ...serverRow, slogan: localObj.slogan ?? '' }`. Placed immediately after `mergeById`, not inside it.
  - In `loadFromPostgres`'s merge loop, branched on `name === 'centerProfile'` to call the new function instead of `mergeById`; every other of the 20 remaining `PG_COLLECTIONS` entries is unaffected — same `mergeById(state[name], fetched[name])` call as before, byte-for-byte.
  - `PG_COLLECTIONS`, `COLLECTION_FIXUPS`, `normalizeCollectionForMerge`, and the fetch/empty/failed bookkeeping above the merge loop were **not touched**.

- **`src/store/db.middleware.test.js`**
  - Added `vi.mock('../services/api', ...)` for `pgCheckHealth`/`pgGetCollection` and a `runLoadFromPostgres(initialState)` test harness that simulates the real `set((state) => next)` updater call used by `useDB.jsx`, without touching the real Zustand store.
  - Added a new `describe('loadFromPostgres — centerProfile singleton (Phase 3B-10 regression)', ...)` block with 6 tests (the 5 requested plus one extra covering the "no row yet" case):
    1. Unwraps the single-row array into a plain object, never an array.
    2. Server fields (`logoUrl`/`teacherName`/`academicYear`/`updatedAt`) populate correctly.
    3. Local-only `slogan` survives and is never overwritten by the server.
    4. Explicit regression guard: `state.centerProfile` never equals `[serverRow]` and is never an array.
    5. Starting from the default local profile still yields a valid singleton object after sync.
    6. (extra) When PostgreSQL has no row yet (empty array), `centerProfile` is left completely untouched (same object reference) — covers the "no row" edge case from the fix spec.

## 5. Test results (all commands run this session)

```
npx vitest run src/store/db.middleware.test.js
✓ 23/23 passed (17 original + 6 new)

npx vitest run src/modules/settings/SettingsPage.centerProfile.test.jsx src/store/db.middleware.test.js
✓ 26/26 passed

npx vitest run   (full suite)
✓ 15/15 test files, 95/95 tests passed — no regressions anywhere
```

## 6. Confirmations

- No schema changes: `backend/prisma/schema.prisma` not touched.
- No API changes: `backend/src/routes/centerProfile.js`, `backend/src/routes/crud.js` not touched.
- No write-path changes: `src/services/api.js` (`pgUpdateCenterProfile`), `src/modules/settings/SettingsPage.jsx` not touched. The `PUT /api/centerProfile` behavior and the local-only reset behavior are unchanged.
- No database writes: `center_profile` row count re-verified after the fix — still **1** row, unchanged.
- File-scope check (files modified more recently than the prior report): exactly `src/store/db.middleware.js` and `src/store/db.middleware.test.js` — nothing else.
- `state.centerProfile` is now confirmed always a plain object after PostgreSQL boot synchronization (Tests 1, 4, 5, and the extra empty-row test).
- The local `slogan` is confirmed to survive synchronization (Test 3).

## 7. Deferred items (not addressed in this phase, per approved scope)

- **§13 validation/logo hardening** — deferred. No format/length validation was added for `logoUrl`/phone fields; no change to the 500KB client-side pre-encoding check.
- **Generic `/api/centerProfile/:id` surface** (`PUT|PATCH|DELETE` with an `:id` segment, reachable-but-broken via the same Int/String mismatch the dedicated route was built to avoid) — deferred. `crud.js` and generic CRUD infrastructure were not modified.

## Final Phase 3B-10 status

**CLOSED.** The confirmed regression in the `centerProfile` read/merge path has been fixed with a narrowly scoped change, verified with 6 new regression tests plus the full existing suite (95/95 passing), and confirmed to make no schema, API, or write-path changes and no database writes. §13 and the generic `:id` surface remain explicitly deferred, not part of this phase's scope.
