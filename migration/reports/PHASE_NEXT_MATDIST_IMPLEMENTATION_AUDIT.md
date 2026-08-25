# `matDist` Read-Path Migration — Implementation & Post-Implementation Audit

Implements `PHASE_NEXT_MATDIST_IMPLEMENTATION_PLAN.md` exactly, with both decisions resolved as approved: Decision 1 = pure client-side derived view over `inventoryTxn`, `matDist` removed as independent state entirely; Decision 2 = plain re-fetch-and-merge after save, zero backend change. No schema change, no backend route change, no change to the write/reconciliation logic — confirmed below, not just asserted.

Before implementation, the plan was re-read in full to confirm §9's two items were the only unresolved architectural decisions in it — confirmed: no other `DECISION NEEDED` marker exists anywhere else in the plan (§10–19 are mapping/impact/test/risk/rollback/sequence/scope sections with no further open questions).

---

## 1. What changed

| File | Change |
|---|---|
| `src/services/materialService.js` | Added `deriveMatDist(inventoryTxn)` — a pure function mirroring `backend/src/routes/materialDistribution.js`'s own read-only selection rule exactly: filters to `RELEVANT_TYPES` (`studentDelivery`/`reservation`/`reservationRelease`/`return`), excludes `status === 'cancelled'` (the client-side equivalent of Phase 3B-12 Finding #1), picks the most recent transaction per `(materialId, studentId)` pair by `createdAt`, and maps it to the exact `{id, matId, studentId, received, receivedAt, payStatus, paidAmount}` shape every existing reader already expects. `getMatStats`/`getTotalRevenue` are unchanged — they already only needed an array in this shape. |
| `src/modules/materials/MaterialsPage.jsx`, `MaterialReports.jsx`, `src/modules/student-report/StudentReportPage.jsx` | Replaced `useAppStore((s) => s.matDist)` with `useMemo(() => deriveMatDist(inventoryTxn), [inventoryTxn])`. No other logic in any of these three files changed — every downstream filter/aggregation (`getMatStats`, `.filter(d => d.matId===...)`, etc.) is untouched. `MaterialsPage.jsx`'s `handleDelete` also dropped its now-impossible `setMatDist(prev => prev.filter(...))` call (matDist has no independent state to clean up any more; the server already rejects deleting a material with real `inventory_txn` history). |
| `src/modules/materials/MaterialDistribution.jsx` | Same selector change. `handleSave`'s write call to `pgSaveMaterialDistribution` is **byte-identical** — same arguments, same await, same error handling. Only what happens *after* success changed: instead of `setMatDist(...)` adopting the save response directly, it now calls `pgGetCollection('inventoryTxn')` and merges the result into `state.inventoryTxn` via the already-existing `mergeById`/`normalizeCollectionForMerge` (the exact same functions `db.middleware.js`'s boot-sync already uses) — not a naive replace, so any locally-only `inventory_txn` row from Inventory's own separately-deferred direct-transaction entry is preserved, not clobbered. |
| `src/store/slices/inventory.slice.js` | Added `setInventoryTxn`, mirroring the existing `setInvMaterials` pattern exactly. `addInventoryTxn` (Inventory's own local-only direct-transaction writer, out of scope) is untouched. |
| `src/store/slices/materials.slice.js` | Removed `matDist`/`setMatDist`/`addMatDist`/`updateMatDist` entirely — not left inert, per the explicit instruction to remove rather than duplicate. `materials`/`setMaterials`/etc. (the already-dead, already-inert Materials-phase leftovers) are untouched, as instructed. |
| `src/store/app.store.js` | Removed `matDist` from `partialize` and the now-dead `useMatDist`/`setMatDist` exports. |

**No backend file was touched.** No schema change. No new table, no new column, no migration.

## 2. Tests

- **New**: `src/services/materialService.deriveMatDist.test.js` — 11 pure-function tests (mirroring `reportData.bookletDeliveries.test.js`'s established pattern): correct `received`/`payStatus`/`paidAmount`/`receivedAt` mapping, the cancelled-exclusion (the direct client-side equivalent of Finding #1), most-recent-wins regardless of array order, reservation→release and delivery→return both correctly resolve to not-received, missing `legacyMetadata` defaults correctly, an untouched student produces no entry at all, irrelevant transaction types are ignored, and multiple students/materials each produce independent entries.
- **Rewritten**: `src/modules/materials/MaterialDistribution.inventoryTxn.test.jsx` — all 4 tests updated to mock `pgGetCollection` alongside `pgSaveMaterialDistribution` and assert on `state.inventoryTxn` instead of the no-longer-existing `state.matDist`. The write-path assertions themselves (single bulk call, no per-student calls, no invented `paymentId`/`admissionId`, no premature local mutation, real error surfaced on failure) are preserved verbatim — only the post-save state-shape assertions changed, exactly as the plan anticipated.
- **One additional necessary fix found during implementation, not anticipated verbatim in the plan**: `MaterialsPage.materials.test.jsx`'s existing delete test (from the already-closed Materials phase) also asserted `state.matDist` was cleaned up after a material delete — a direct, mechanical consequence of removing the `setMatDist` cleanup call from `MaterialsPage.jsx`'s own `handleDelete`. This is not a reopening of Materials' own domain logic (`pgCreateMaterial`/`pgUpdateMaterial`/`pgDeleteMaterial` and the `invMaterials` wiring are untouched) — it is the same class of "test asserts on data this exact phase removed" fix the plan already flagged for `MaterialDistribution.inventoryTxn.test.jsx`, just in one additional pre-existing file. Rewritten to seed/assert `inventoryTxn` instead, and to correctly reflect that material deletion no longer touches `inventoryTxn` at all (real `inventory_txn` rows can't be cascade-affected by a material delete — the server already rejects that case with a 409).

## 3. Test suite and build results

```
npx vitest run src/modules/materials src/modules/student-report src/services/materialService.deriveMatDist.test.js
  → 5 files, 33 tests, all passed

npx vitest run          →  26 files, 177 tests, all passed (172 prior + 11 new − 6 replaced-in-place)
npm run build             →  ✓ built in 4.50s, no errors
```

## 4. Fresh, independent post-implementation audit

Everything below was re-derived this pass by direct grep/read and live read-only queries — not carried forward from §1–3 on trust.

### 5. No independent `matDist` business-data persistence remains

```
grep -rn "state\.matDist|s\.matDist\b|setMatDist|addMatDist|updateMatDist" src --include=*.js --include=*.jsx
```
Returns matches only inside `src/store/index.js` — the already-confirmed-dead, zero-importer Phase-2→3 compatibility shim (re-confirmed in every prior phase's own audit this session: `MATERIALS_UNIFICATION_CLOSURE_AUDIT.md` §1, `PHASE_3B-16_...AUDIT.md` §1, both found the same file with the same "zero importers anywhere" property). Its two stale references (`matDist: s.matDist`, `setMatDist: store.setMatDist`) now resolve to `undefined` at runtime if that file were ever imported — it is not, confirmed again this session, and the production build completed with zero errors despite this, confirming it is inert. `matDist` no longer appears in `app.store.js`'s `partialize` or in `materials.slice.js`'s state definition at all — re-confirmed by direct read.

### 6. The existing backend write/reconciliation path is unchanged

```
find backend -newer <plan file> -type f
```
Returns **zero results** — no backend file was touched this phase. Direct re-read of `backend/src/routes/materialDistribution.js` confirms the transaction wrapper (`runInTransaction`), the `RELEVANT_TYPES` list, and the `status: { not: 'cancelled' }` Finding #1 filter are byte-identical to the version this plan was built against.

### 7. Materials, Teachers, `parentExtras`, and other deferred domains remain untouched

The complete file-modification list for this phase is exactly 11 files: `materialService.js` + its new test, `MaterialsPage.jsx` + its existing test (one necessary assertion fix, §2), `MaterialDistribution.jsx` + its rewritten test, `MaterialReports.jsx`, `StudentReportPage.jsx`, `inventory.slice.js`, `materials.slice.js`, `app.store.js` — confirmed by a fresh file-modification-time scan, no unexpected file appears. A grep for `teacher_id`/`parentExtras`/`admissionSystemLog`/`waReportLog` across every one of these 11 files finds matches only in `app.store.js`, and inspecting them directly shows they are pre-existing, unrelated `partialize` entries/imports for other domains (`waReportLog`, `admissionSystemLog`) that this phase's single-line `matDist` removal did not touch. `Materials`' own write path (`pgCreateMaterial`/`pgUpdateMaterial`/`pgDeleteMaterial`, the `invMaterials` collection itself) is not referenced by any of this phase's logic changes — only its already-established selector (`s.invMaterials`) is read, unchanged, by the same files as before.

**Live, read-only database re-check this session** (zero writes performed by this phase or this audit): `inv_materials` = 1, `inventory_txn` = 4, `parents` = 0, `teachers` = 0 — identical to every prior checkpoint recorded across this entire session, confirming no schema or data change occurred. `inventory_txn`'s pre-existing `trg_no_delete_inventory` append-only trigger is intact and unaffected.

---

## Final determination

Every claim in this report is independently reproduced by direct code inspection, fresh greps, and live read-only database queries. `matDist` is now a pure derived view over the already-PostgreSQL-backed, already-boot-synced `inventoryTxn`; no independent business-data persistence for it remains anywhere, local or cached. The write/reconciliation path in `backend/src/routes/materialDistribution.js` is confirmed byte-identical to before this phase began. Materials, Teachers, `parentExtras`, and `admissionSystemLog`/`wa_report_log` hardening are all confirmed untouched.

---

**No code was written beyond what this report describes. No schema, database, or localStorage change was made or was necessary — the plan's evidence never required one, so nothing was stopped or escalated.**
