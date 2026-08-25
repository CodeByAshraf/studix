# Phase 3B-11 — Audit, Fix & Closure Report

**Module:** `inv_materials` (`inv_materials` table) — the materials/booklet catalog.
**Original audit classification: MIXED.**
- `inv_materials` retrospective result: **CLEAN** — already shipped, correct, fully tested.
- Adjacent finding discovered during audit (not part of `inv_materials` itself): a live, unfixed instance of the Phase 3B-10 singleton-corruption bug class, on `inventory_settings`. Approved for a fix within this phase.

---

## 1. `inv_materials` — retrospective result: CLEAN

Full CRUD (`pgCreateMaterial`/`pgUpdateMaterial`/`pgDeleteMaterial`) via generic CRUD, correctly using `inv_materials.id`'s `BigInt` type (correctly special-cased by `crud.js`'s `parseIdParam`, unlike `center_profile`'s `Int` id which forced a dedicated route in 3B-10). Server-truth-first write pattern confirmed via `MaterialsPage.jsx`. Decimal fields (`price`/`cost`/`minStock`) correctly normalized both on write responses (`api.js`'s `normalizeMaterialResponse`) and on the read/merge path (`db.middleware.js`'s existing `COLLECTION_FIXUPS.invMaterials`). Code-conflict retry (`computeNextCode`) correctly recomputes from a fresh server fetch, not stale local state. No implementation gap found. Not modified in this phase.

## 2. The newly discovered `inventorySettings` bug

**Root cause:** identical mechanism to the Phase 3B-10 `centerProfile` bug. `inventorySettings` is a second entry in `PG_COLLECTIONS` (`db.middleware.js`) whose local store shape (`inventory.slice.js`, `INITIAL_INVENTORY_SETTINGS = { defaultMinStock, allowNegativeStock, reservationExpiryDays }`) is a **plain singleton object**, not an array. Before this fix, `loadFromPostgres`'s merge loop special-cased only `centerProfile`; every other name — including `inventorySettings` — still fell through to `mergeById(state[name], fetched[name])`. `mergeById` treats a non-array `localArr` as `[]`, so the server's one-row array response for `inventory_settings` (confirmed live: exactly 1 row, `id=1`) was written back as `[{...}]`, corrupting the singleton shape.

**Why it was missed in Phase 3B-10:** 3B-10's approved scope was explicitly `centerProfile` only — the audit that produced it did not enumerate every other `PG_COLLECTIONS` entry for the same shape mismatch. This phase's audit (3B-11) was explicitly instructed to re-check the middleware/synchronization section as high priority specifically because of the 3B-10 precedent, which is what surfaced it.

**Trigger conditions:** broader than `centerProfile`'s — `inventorySettings` is **not** in `ADMIN_ONLY_COLLECTIONS`, so the corrupting `GET /api/inventorySettings` fires for **any** authenticated role on every app boot/reload where the backend is reachable (the row already exists).

**Blast radius:** `InventoryPage.jsx:104` (`settings.allowNegativeStock`, feeds stock-availability logic) and `:258` (`settings.defaultMinStock`, passed as a prop) — both read `undefined` after corruption.

**Severity: Medium.** Real and live, but **not destructive** — no write function for `inventorySettings` exists anywhere in `api.js`, so unlike `centerProfile` there was no "corrupt then Save nulls back to the server" risk. This is read-corruption only (wrong/blank values displayed and fed into stock logic), not data loss.

**Why worth fixing now:** same root cause and same file already being touched for a related reason; leaving a second known singleton unfixed after explicitly identifying the pattern would have left the middleware in an inconsistent, half-fixed state.

## 3. The fix

### Singleton-shape fix
Added `mergeInventorySettingsSingleton(_localValue, pgArr)` in `src/store/db.middleware.js`, structurally parallel to (but not sharing an implementation with) `mergeCenterProfileSingleton`. Unlike `centerProfile`, `inventorySettings` has no local-only field to preserve, so it fully replaces the singleton from the server row rather than merging with local state. `id` is deliberately **excluded** from the result — the established local shape (`INITIAL_INVENTORY_SETTINGS`) never included it and no consumer (`InventoryPage.jsx`) reads it; including it would have invented a new field rather than preserving the established contract.

### Decimal normalization fix
`default_min_stock` (`Decimal(12,2)` in Postgres) arrives as a string over the generic GET response, same class as `inv_materials.price`/`exams.total`. `mergeInventorySettingsSingleton` passes it through the existing `toNum()` helper (already used by `COLLECTION_FIXUPS.invMaterials`/`.inventoryTxn`) — `"10"` → `10`. `allowNegativeStock` (`Boolean`) and `reservationExpiryDays` (`SmallInt`) arrive with their correct native JS types already — no coercion was added for them, per the instruction not to introduce unnecessary coercion.

### Dispatch mechanism — explicit, not a shared merge implementation
Added a `SINGLETON_MERGERS` lookup table (`{ centerProfile: mergeCenterProfileSingleton, inventorySettings: mergeInventorySettingsSingleton }`) and changed the merge loop to `const singletonMerge = SINGLETON_MERGERS[name]; next[name] = singletonMerge ? singletonMerge(state[name], fetched[name]) : mergeById(...)`. This was chosen over a single generic parameterized helper because the two collections' contracts genuinely differ (local-field preservation + full passthrough vs. no local field + a narrow 3-field allowlist + one numeric coercion) — forcing them through one shared function would have added configuration complexity to already-tested code for no real benefit. The dispatch table instead makes "which `PG_COLLECTIONS` entries are singletons" explicit and centrally discoverable in one place, directly addressing the requirement that no future singleton be silently sent through `mergeById` — the existing, already-tested `mergeCenterProfileSingleton` function itself was **not modified**.

### Unrelated observation (not touched, out of scope)
While inspecting `inventory.slice.js` as required, found that `InventoryPage.jsx` reads a different store key (`invMaterials`, owned by `inventory.slice.js`) than `MaterialsPage.jsx` does (`materials`, owned by a separate `materials.slice.js`) — two parallel, seemingly overlapping local state slices for materials. This is pre-existing architectural duplication, unrelated to the `inventorySettings` fix (which only touches the `inventorySettings` merge branch) and was not investigated further or modified.

## 4. Exact files modified

- **`src/store/db.middleware.js`** — added `mergeInventorySettingsSingleton`, added the `SINGLETON_MERGERS` dispatch table, changed the merge loop to consult it. `mergeCenterProfileSingleton`, `mergeById`, `COLLECTION_FIXUPS`, `normalizeCollectionForMerge`, and `PG_COLLECTIONS` were **not modified**.
- **`src/store/db.middleware.test.js`** — added a new `describe('loadFromPostgres — inventorySettings singleton (Phase 3B-11 regression)', ...)` block with 8 tests: the 5 requested (singleton-remains-object, field mapping, Decimal normalization, no-array-corruption, default-settings-still-valid) plus 3 extra (no invented `id` field, untouched-when-no-row, and an explicit dual-singleton integration test proving `centerProfile` and `inventorySettings` are both handled correctly in the same `loadFromPostgres` call without interference). The existing `centerProfile` describe block (6 tests) was **not modified** — same as before.

No other files were touched.

## 5. Test results (all commands run this session)

```
npx vitest run src/store/db.middleware.test.js
✓ 31/31 passed (23 existing + 8 new)

npx vitest run src/store/db.middleware.test.js src/modules/settings/SettingsPage.centerProfile.test.jsx src/modules/materials/MaterialsPage.materials.test.jsx
✓ 41/41 passed

npx vitest run   (full suite)
✓ 15/15 test files, 103/103 tests passed (previous baseline: 95/95; +8 new, 0 regressions)
```

## 6. Confirmations

- `centerProfile` remains a plain object after sync — verified by the existing 6 Phase 3B-10 tests (unchanged, still passing) plus the new dual-singleton integration test.
- `inventorySettings` is a plain object after sync — verified by 8 new tests.
- `defaultMinStock` is a number (`typeof === 'number'`) after sync — verified explicitly.
- `centerProfile.slogan` still survives synchronization — verified by both the original Test 3 and the new dual-singleton test.
- All existing array collections still use `mergeById` unchanged — confirmed by code (the dispatch table only intercepts names present in `SINGLETON_MERGERS`; every other `PG_COLLECTIONS` entry falls through to the exact same `mergeById(state[name], fetched[name])` call as before) and by the full suite's zero regressions across every other collection's tests.
- No schema, API, or write-path changes were made: `backend/prisma/schema.prisma`, `backend/src/routes/*`, `src/services/api.js`, `src/modules/inventory/InventoryPage.jsx`, `src/store/slices/inventory.slice.js`, `src/data/initialData.js` were not touched.
- No database data was modified — re-verified live after implementation: `inventory_settings: 1`, `inv_materials: 1`, `inventory_txn: 4`, `center_profile: 1` — identical to the pre-implementation baseline. The Phase 3B-12 verification residue was not cleaned.
- File-scope check (files modified more recently than the prior report): exactly `src/store/db.middleware.js` and `src/store/db.middleware.test.js` — nothing else.

## 7. Deferred items (per approved scope)

- **Stale `pgDeleteMaterial` comment** (`api.js:681-684`, claims inventory_txn is empty and delete always succeeds — no longer accurate given the 4 Phase 3B-12 verification rows) — deferred. Documentation drift only; the actual delete-failure behavior is already correct and already tested.
- **Generic `PUT/PATCH /api/inventoryTxn/:id` surface** — reachable via generic CRUD fallthrough, bypasses the atomic `material-distributions` settlement transaction, but nothing in the frontend calls it today — deferred as documented technical debt, out of scope. `crud.js` and inventory transaction routes were not touched.

## Final Phase 3B-11 status

**CLOSED.**

```
inv_materials      → migrated, verified, tested (retrospective CLEAN)
inventorySettings  → bug fixed, regression-tested (8 new tests, 31/31 in db.middleware.test.js)
validation         → no new hardening performed
stale comment      → deferred
inventory_txn CRUD → deferred
```

Full suite: 103/103 passing (up from the 95/95 baseline, 0 regressions). No schema, API, write-path, or database changes were made.
