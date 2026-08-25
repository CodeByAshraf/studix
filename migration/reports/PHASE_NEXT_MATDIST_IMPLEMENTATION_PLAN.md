# `matDist` Read-Path Migration — Implementation Plan

**Status: READ-ONLY.** No code, schema, database, localStorage, or configuration was modified to produce this report. Nothing here is authorized or implemented. Teachers, Materials, `parentExtras`, and `admissionSystemLog`/`wa_report_log` hardening are not touched and not implicated by anything below.

This plan resolves the exact deferred question Phase 3B-12 itself left open: `PHASE_3B-12_AUDIT.md` Finding #2, *"matDist has no boot-time synchronization from inventory_txn... DEFERRED — ARCHITECTURAL DECISION REQUIRED,"* which named three options (A: derived view, B: synchronized read model, C: intentionally separate local state) without picking one. Everything below is built directly on top of that finding, not a fresh restart.

---

## 1. Current Architecture

**Write side (already real, already tested, Phase 3B-12 — not being changed):** `MaterialDistribution.jsx` collects a full roster for one material and calls `pgSaveMaterialDistribution(materialId, records)` → `PUT /api/material-distributions/:materialId` → `backend/src/routes/materialDistribution.js`'s `saveMaterialDistribution`/`attemptReconciliation`, which runs inside a single Prisma transaction (`runInTransaction`) and, per student, either creates one new `inventory_txn` row (`studentDelivery`/`reservation`/`reservationRelease`/`return`, `quantity` always `1`) or updates only the `legacy_metadata` JSONB of the most recent one — never deleting or reassigning `type`/`quantity`/`student_id`/`material_id`/`created_at`. A P2002 conflict on the human-readable `number` retries once, server-side only. **Phase 3B-12's Finding #1 fix is live**: the query that selects "the latest real transaction per student" already excludes `status: 'cancelled'` rows (`materialDistribution.js:155-156`) — confirmed by re-reading the current file this session, unchanged since that closure.

**Read side (the actual gap):** `state.matDist` (`src/store/slices/materials.slice.js`) is a plain local array, populated only by (a) whatever `localStorage['studix-v1']` had from a previous session, and (b) directly adopting the `records` array from a successful `pgSaveMaterialDistribution` response. It is **not** in `db.middleware.js`'s `PG_COLLECTIONS` — confirmed absent, re-checked this session — so on any fresh browser, second device, or cleared storage, `matDist` starts empty and only "catches up" for a specific material once someone happens to reopen and save that exact material's roster again, even though the real ledger (`inventory_txn`) already has the correct, complete history server-side.

## 2. Exhaustive Reader Trace (fresh grep this session)

| File | Usage |
|---|---|
| `src/modules/materials/MaterialsPage.jsx:47,72-76,225,308` | `matDist` used for the KPI row (`getTotalRevenue`, received/unpaid counts) and per-material stats (`getMatStats(mat.id, matDist, students)`) in both the list and tracking-picker views |
| `src/modules/materials/MaterialDistribution.jsx:135,162` | Per-student initial state: `matDist.find(d => d.matId === material.id && d.studentId === s.id)`, defaulting to `{received:false, receivedAt:null, payStatus:'unpaid', paidAmount:0}` when no record exists |
| `src/modules/materials/MaterialReports.jsx:60,79,84,97,105,113,170` | Filters `matDist` by `matId` for reporting tabs, defaults missing per-student rows the same way `MaterialDistribution.jsx` does |
| `src/modules/student-report/StudentReportPage.jsx:159,270-276,305` | Filters `matDist` by `studentId`, joins against `materials` (now `invMaterials`, confirmed §5) to build the student report's booklet section |

**Confirmed by direct code reading:** every reader already treats a *missing* `matDist` entry for a given `(matId, studentId)` pair as "untouched/no history" and supplies the same default (`received:false, payStatus:'unpaid', paidAmount:0`) locally — none of them assume every eligible student has a row. This matches the backend's own behavior exactly: `isUntouchedDefault` (`materialDistribution.js:53-58`) deliberately creates **no** `inventory_txn` row for a student who was never touched. **This means a derived array that simply omits untouched students is already fully compatible with every existing reader, with no reader-side logic change beyond swapping the data source.**

**No mock/fallback business data found in any reader** — all four files read the live store value only; no hardcoded arrays, no `INITIAL_MAT_DIST`-shaped fallback content (`INITIAL_MAT_DIST` itself is confirmed `[]` in `initialData.js`, unchanged from every prior audit).

## 3. Authoritative PostgreSQL Source for the Read Side

**`inventory_txn`, already boot-synced.** Confirmed live this session: `inventory_txn` has a real Prisma model, is in `COLLECTION_MODELS`, is boot-synced via `PG_COLLECTIONS` (`db.middleware.js:21-27`, unchanged), and is already normalized on read (`COLLECTION_FIXUPS.inventoryTxn: quantity/unitCost → toNum`, unchanged). Everything a `matDist` row needs is already present on each `inventory_txn` row once fetched: `materialId` (→ `matId`), `studentId`, `type` (→ derives `received`), and `legacyMetadata.{payStatus, paidAmount, receivedAt}` (deep-camelCased automatically by `caseMapper.js`'s recursive `snakeToCamel` — confirmed this session that its keys, already camelCase as written by `buildMetadata()` server-side, pass through unchanged, not corrupted by the recursive conversion).

**Confirmed live, read-only, this session:** all 4 existing `inventory_txn` rows carry `legacy_metadata` in exactly this shape (e.g. `{"payStatus":"unpaid","paidAmount":0,"receivedAt":"2026-08-19"}`) — all 4 rows are `status: 'cancelled'` (the pre-existing Phase 3B-12 verification residue), so a correct derivation would currently show **zero** live distribution history, which is factually accurate (nothing real has happened yet) — not a bug in the derivation.

**No new table or column is needed.** Every field required already exists on `inventory_txn`; nothing is missing.

## 4. Table Relationships (verified this session)

`inv_materials.id (BigInt) ← inventory_txn.material_id`, `students.id (String) ← inventory_txn.student_id` (both nullable-but-populated FKs, confirmed in `schema.prisma`). No `groups`/`classes` relationship exists on `inventory_txn` at all — eligibility for a distribution roster is determined entirely by `student.grade === material.grade` (confirmed unchanged in `MaterialDistribution.jsx`'s `eligibleStudents` computation, not touched by this plan) and has no group/class dimension to account for.

## 5. Materials-Unification Impact on `matDist` (fresh check)

**No identifier or field-name change affects `matDist`.** `pgSaveMaterialDistribution(material.id, records)` has always used a real, server-issued `inv_materials.id` — true before and after Materials unification (the server has never accepted a client-supplied id for this collection). The one real effect of Materials unification: `MaterialsPage.jsx`/`MaterialDistribution.jsx`/`MaterialReports.jsx` now read `s.invMaterials` (boot-synced, complete) instead of the previously-stale `s.materials` — so the **set of materials these pages can even show** is now accurate on a fresh session, which was not true before. This makes a `matDist` read-side fix strictly more valuable now than when Finding #2 was first deferred, since previously even a fixed `matDist` would have been paired with an incomplete materials list.

## 6. Validation, Transaction, Locking, Concurrency (re-verified, not proposed to change)

Re-read `materialDistribution.js` in full this session: single-transaction reconciliation (`runInTransaction`), idempotent (re-saving the identical roster produces zero new writes — confirmed by the code path, not just documentation), the `number` P2002 retry is server-only, `legacy_metadata`-only updates are the sole intentional exception to "never mutate an existing row's identity fields," and Finding #1's `status: { not: 'cancelled' }` filter is live. **This plan does not propose changing any of this.** The read-side fix is additive-only: a new way to *view* the ledger, never a new way to *write* it.

## 7. Prior Reports Searched (cross-referenced explicitly)

- `PHASE_3B-12_AUDIT.md` — the origin of this exact deferred question (Finding #2); its three named options are the direct basis for §9's decision below.
- `PHASE_3B-11_AUDIT.md` — confirms `inv_materials`/`inventory_txn` CRUD and the `inventorySettings` singleton fix; no `matDist`-relevant content beyond confirming the boot-sync mechanism (`mergeById`) is the same one this plan would piggyback on for `inventoryTxn`.
- `MATERIALS_DOMAIN_DECISION_AUDIT.md`, `MATERIALS_FIELD_OWNERSHIP_DECISION.md`, `MATERIALS_UNIFICATION_IMPLEMENTATION.md`, `MATERIALS_UNIFICATION_POST_IMPLEMENTATION_AUDIT.md`, `MATERIALS_UNIFICATION_CLOSURE_AUDIT.md` — all explicitly scoped `matDist`/`inventoryTxn`'s *write* path out of the Materials work ("existing inventory transaction behavior is unchanged"); none of them touched anything this plan needs to build on, and none contain a `matDist` read-side decision.
- `POST_PHASE_3B-16_REMAINING_GAPS_AUDIT.md` — the report that selected `matDist` as the next candidate; its evidence is re-derived fresh here, not assumed.
- `REMAINING_LOCAL_BUSINESS_DATA_DECISION_AUDIT.md`/`FINAL_LOCAL_PERSISTENCE_AUDIT.md` — both classify `matDist` as "write-real/read-stale," consistent with everything above.

No report anywhere contains a resolved decision on Finding #2 — it genuinely remains open, exactly as this plan treats it.

## 8. Live PostgreSQL State (read-only queries only, this session)

`inv_materials`: 1 row (pre-existing verification artifact). `inventory_txn`: 4 rows, all `status='cancelled'`. `students`: 2 rows (pre-existing verification artifacts). No `INSERT`/`UPDATE`/`DELETE` was issued.

---

## 9. Proposed Target Architecture — DECISION NEEDED

### The core decision (Finding #2's three named options, resolved with fresh evidence)

**Recommended: Option A — pure derived selector, computed client-side from the already-boot-synced `inventoryTxn`, with `matDist` removed as independent state entirely.**

Evidence for this recommendation, not asserted without basis:
- The **read-only** portion of `materialDistribution.js`'s own reconciliation logic — select non-cancelled rows for a material, group by student, take the most recent per student, read `type` for `received` and `legacy_metadata` for the rest — is simple, small, and already conceptually duplicated once in this codebase in exactly this style: `reportData.js`'s `bookletDeliveries` (Phase 3B-12 Finding #3, already shipped and tested) derives business meaning from `store.inventoryTxn` the same way, filtering by `type === 'studentDelivery'` and matching `studentId`. This plan's derivation is the same shape of work, not a novel pattern.
- `inventoryTxn` is already boot-synced and already in `partialize` — no new caching layer, no new table, no schema change, no new backend route is *required* for the core mechanism.
- Every existing reader already tolerates a missing per-student row (§2) — the derived array's shape is a drop-in replacement for what `state.matDist` already provided, so downstream code (`getMatStats`, `.filter(d => d.matId===...)`, etc.) needs no logic change, only a different data source.
- This directly satisfies "PostgreSQL remains the sole source of truth" and "do not create duplicate storage" more completely than any alternative — a pure derived value cannot itself go stale or diverge, because it is recomputed from the authoritative ledger on every read.

**Not recommended, named for completeness:** Option B (a dedicated backend read endpoint) is technically feasible — the read-only portion of `attemptReconciliation` could be factored out and exposed — but is unnecessary extra surface given `inventoryTxn` is already fetched in full on boot; it would only be justified if the derivation needed data not already client-side, which it does not. Option C (declare `matDist` an intentionally session-local, non-authoritative view) is not recommended because it does not resolve the actual problem this phase exists to close, and conflicts with "PostgreSQL remains the sole source of truth."

**If you approve Option A, one more decision is required — how the UI stays consistent immediately after a save:**

Because `pgSaveMaterialDistribution`'s response is `matDist`-shaped (`{id, matId, studentId, received, receivedAt, payStatus, paidAmount}`), not `inventoryTxn`-shaped, and `state.matDist` would no longer exist to absorb that response directly, `MaterialDistribution.jsx` needs a way to reflect a just-completed save without a full page reload. Two options:

- **Recommended: re-fetch.** After a successful save, call `pgGetCollection('inventoryTxn')` (already-existing, generic, already used elsewhere for exactly this kind of "get fresh truth" purpose — e.g. Materials' own 409-retry pattern) and merge the fresh rows into `state.inventoryTxn` via the existing `mergeById`-style pattern. **Zero backend change, zero duplication of any reconciliation/type-decision logic client-side** — directly satisfies "do not propose changes to financial or inventory transaction logic unless absolutely required," since nothing about the transaction logic is touched at all, only an additional read call after the write already succeeded.
- **Alternative, not recommended by default:** extend `materialDistribution.js`'s response to also return the raw `inventory_txn` rows it touched (`created`/`updated`, already held in-memory inside `attemptReconciliation` — an additive response-shape change, not a logic change) so the frontend can merge them directly with no extra round trip. Viable if the extra network call's latency is judged unacceptable, but not the default recommendation, since it touches a backend file this plan would otherwise leave completely alone.

**This report does not implement either sub-option — it is flagged here specifically because Finding #2 named "how consistency is achieved" as part of the same open architectural question, and choosing wrong would either reintroduce staleness (skipping the refresh) or require touching already-correct backend code unnecessarily (the alternative).**

---

## 10. Exact Field/Data Mapping

| `matDist` row field (existing reader contract) | Derived from `inventoryTxn` row | Notes |
|---|---|---|
| `matId` | `materialId` | Direct |
| `studentId` | `studentId` | Direct |
| `received` | `type === 'studentDelivery'` | Matches `currentReceived` computation in `materialDistribution.js:169` exactly |
| `receivedAt` | `legacyMetadata.receivedAt` | Already a plain `YYYY-MM-DD` string inside the JSONB blob (not a typed DB column) — no date normalization needed |
| `payStatus` | `legacyMetadata.payStatus` | Default `'unpaid'` if absent, matching `buildMetadata`'s own default |
| `paidAmount` | `legacyMetadata.paidAmount` | Default `0` if absent |
| `id` | the underlying `inventory_txn.id` | For students with real history. For an untouched student who still needs a row for React-key purposes in some readers, no row should be synthesized — every reader already tolerates a missing entry (§2) |
| Selection rule | `type in ['studentDelivery','reservation','reservationRelease','return']`, `status !== 'cancelled'`, most recent `createdAt` per `(materialId, studentId)` pair | **Must exactly mirror `materialDistribution.js:155-161`'s existing filter, including the Finding #1 cancelled-exclusion** — getting this wrong reproduces that exact bug on the client |

No field requires a schema-level rename or new column — this is a pure read-side transformation of already-correct, already-synced data.

## 11. Backend Impact

**None required** for the recommended architecture (Option A + re-fetch). The optional alternative (enriched save response) would touch `backend/src/routes/materialDistribution.js` additively only (return already-in-memory rows alongside the existing response) — no change to `attemptReconciliation`'s decision logic, validation, transaction boundaries, or idempotency guarantees.

## 12. Frontend Impact

- `src/modules/materials/materialService.js` — add a new derivation function (e.g. `deriveMatDist(inventoryTxn, materialId?)`), exported alongside the existing `getMatStats`/`getTotalRevenue`, which those functions continue to consume unchanged.
- `src/modules/materials/MaterialsPage.jsx`, `MaterialDistribution.jsx`, `MaterialReports.jsx`, `src/modules/student-report/StudentReportPage.jsx` — replace `useAppStore((s) => s.matDist)` with a `useMemo`-wrapped call to the new derivation function over `state.inventoryTxn` (and, for `MaterialDistribution.jsx`, the post-save refresh call per §9's second decision). No change to any downstream filtering/aggregation logic in any of these files.
- `src/store/slices/materials.slice.js` — remove `matDist`/`setMatDist`/`addMatDist`/`updateMatDist` (per the "do not create duplicate storage" instruction, matching the `parentExtras` precedent of full removal rather than leave-inert).
- `src/store/app.store.js` — remove `matDist` from `partialize`, and the now-fully-unused `useMatDist`/`setMatDist` exports.

## 13. Schema Impact

**None.** No new table, no new column, no migration. §3/§10 establish the existing `inventory_txn` schema is sufficient.

## 14. localStorage/Zustand Impact

`matDist` is removed as a persisted key entirely (not converted to a PG-backed cache, because it needs no cache — it is a pure computed view over `inventoryTxn`, which is already the PG-backed cache). Existing local `matDist` data in any browser's `localStorage['studix-v1']` is not migrated or recovered, per instruction — it simply stops being read once this ships.

## 15. Test Plan

**Existing coverage that will need updating, not just left alone:** `src/modules/materials/MaterialDistribution.inventoryTxn.test.jsx`'s first test (`"save: sends the complete roster... then adopts the server response verbatim"`) currently asserts `useAppStore.getState().matDist` before and after save (lines 75, 84) — these assertions target a state key that would no longer exist under this plan and must be rewritten to assert whatever §9's chosen post-save mechanism actually produces (e.g., `state.inventoryTxn` reflecting the re-fetched rows). The second test (`"save failure: leaves local matDist untouched"`) has the same dependency. The third and fourth tests' setup also seeds `matDist` and will need the same treatment.

**Minimum new tests required:**
1. A new, pure-function test file for the derivation logic (mirroring `reportData.bookletDeliveries.test.js`'s already-proven pattern exactly — no React/network needed): a `studentDelivery` row correctly produces `received: true`; a `cancelled` row is excluded entirely (the direct regression-equivalent of Finding #1, on the client side this time); the most recent of two rows for the same student wins; `legacyMetadata` absence defaults correctly; a `reservationRelease` after a `reservation` correctly resolves to not-received; an untouched student produces no entry at all (not a default-filled one).
2. Updated `MaterialDistribution.inventoryTxn.test.jsx` assertions per the paragraph above, once §9's second decision is made.
3. A light check that `MaterialsPage.jsx`/`MaterialReports.jsx`/`StudentReportPage.jsx`'s existing test coverage (if any touches this area — confirmed this session that none of their current tests seed or assert `matDist` directly) still passes unchanged; if none currently cover this path, no new page-level test is strictly required beyond the derivation-function tests, since the pages' own logic is not changing, only their data source.

## 16. Regression Risks

- **Getting the cancelled-exclusion or "most recent per student" rule subtly wrong** would show incorrect payment/received status on money-adjacent UI (Materials list KPIs, the Distribution roster, the printed Student Report) — the single highest-severity risk in this plan, directly mitigated by mirroring the backend's exact, already-tested filter (§10) and the dedicated derivation test (§15.1).
- **Post-save staleness reappearing in a new form** if the re-fetch (or enriched response) is missed or fails silently — must surface a real error to the user rather than fail quietly, matching every other write path's established pattern in this app.
- **Performance**: deriving over the full `inventoryTxn` array on every relevant render is a `useMemo`, same cost class as `getInventoryKpis`/`getMaterialStats` already computed today over the same collection elsewhere in the app — not expected to be a new concern at current data volumes (4 rows live), but worth a brief note if `inventoryTxn` ever grows very large.

## 17. Rollback Strategy

Fully reversible at the code level — no schema or data change to undo. Reverting the listed files restores `matDist` as independent local state exactly as it exists today. Because old local `matDist` data is treated as disposable per instruction, there is nothing to migrate back either direction.

## 18. Exact Implementation Sequence (once approved)

1. Resolve the two DECISION NEEDED points in §9.
2. Add the derivation function to `materialService.js` and its dedicated test file (§15.1) — pure logic, no UI change yet, can be verified in complete isolation first.
3. Wire the four reader files to the new derivation, one at a time, verifying each against its own existing behavior.
4. Implement §9's chosen post-save mechanism in `MaterialDistribution.jsx`.
5. Remove `matDist` from `materials.slice.js`/`app.store.js`.
6. Update `MaterialDistribution.inventoryTxn.test.jsx`'s assertions.
7. Full test suite, build, live read-only post-implementation audit — matching the four-step pattern already used for both Materials and Phase 3B-16.

## 19. Explicit Scope Boundaries

Not touched, not implicated: Teachers, Materials' own schema/write-path (already CLOSED), `parentExtras`/`parents` (already CLOSED), `admissionSystemLog`/`wa_report_log` hardening, `MOCK_GROUPS`, `cashboxes`, session-invalidation, `inventorySettings`, and inventory's own direct stock-transaction entry (`addInventoryTxn`, `TxnFormModal.jsx`/`CountModal.jsx`) — none of these are read or modified by this plan. The one Materials-adjacent touch this plan makes is limited to `MaterialsPage.jsx`/`MaterialDistribution.jsx`/`MaterialReports.jsx` consuming the already-unified `invMaterials`/`inventoryTxn` collections for their `matDist`-related logic only — not reopening any part of the Materials domain's own closed schema or write path.

---

**Stopping here. Waiting for your resolution of §9's two decisions and explicit approval before any implementation begins.**
