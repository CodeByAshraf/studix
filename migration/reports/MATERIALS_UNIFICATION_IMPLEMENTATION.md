# Materials Domain Unification — Implementation Report

Implements the 11 decisions locked in the approved plan (`MATERIALS_DOMAIN_DECISION_AUDIT.md`, `MATERIALS_FIELD_OWNERSHIP_DECISION.md`, and the user's explicit approval). Scope: unify `materials`/`invMaterials` onto the single real `inv_materials` table, add exactly 3 nullable columns, wire InventoryPage's material CRUD onto the real Postgres functions, fix MaterialsPage's edit-erasure bug. Teachers, `matDist`'s own logic, `inventoryTxn`'s write path, and Phase 3B-16 were explicitly out of scope and are confirmed untouched below.

---

## 1. Schema change

**Executed SQL** (via a throwaway Node script using `prisma.$executeRawUnsafe`, run once, deleted immediately after — this project has no `prisma migrate` workflow; `schema.prisma` is introspected from the live database via `npm run db:pull`, not hand-authored):
```sql
ALTER TABLE inv_materials
  ADD COLUMN IF NOT EXISTS teacher     TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS added_at    DATE;
```
Confirmed live via `information_schema.columns` immediately after: all three nullable (`is_nullable: YES`), correct types (`text`, `text`, `date`).

Then `cd backend && npm run db:pull && npm run db:generate`. The resulting `schema.prisma` diff is exactly 3 new lines inside the `inv_materials` model:
```prisma
model inv_materials {
  ...
  created_at         DateTime             @default(now()) @db.Timestamptz(6)
  teacher            String?
  description        String?
  added_at           DateTime?            @db.Date
  admission_payments admission_payments[]
  ...
}
```
No other model in `schema.prisma` changed. No backend route file changed — `backend/src/routes/crud.js`'s `prepareWriteData`/`getModelFields` already derive themselves from `Prisma.dmmf`, and `/api/invMaterials` was already `writable: true`, so the generic CRUD route automatically began accepting the 3 fields with zero code change there.

## 2. Frontend request/response mapping

**`src/services/api.js`** — `buildMaterialRequestBody`: added `teacher`/`description`/`addedAt`, but **conditionally** (`if (data.field !== undefined) body.field = data.field`), matching the existing pattern already used for `code`, **not** the unconditional `?? null` pattern used for `subject`/`grade`/`price`.

This distinction was not in the original plan text verbatim and was discovered during implementation (see §5, Finding 1) — it matters because `subject`/`grade`/`price` are always provided by both MaterialsPage and InventoryPage's forms, but `teacher`/`description`/`addedAt` are only ever provided by MaterialsPage's form. Sending them unconditionally would mean every InventoryPage save includes `teacher: null` etc., and Prisma's partial-update semantics treat an explicit `null` as "clear this column" — silently wiping any value MaterialsPage had set on that same row. Conditional inclusion means InventoryPage's saves simply omit these three keys, leaving the column untouched server-side, exactly like `code` already does on update.

`normalizeMaterialResponse`: added `addedAt: data.addedAt ? String(data.addedAt).slice(0, 10) : data.addedAt` — same truncation pattern as `normalizeExamResponse`'s handling of `exams.date`. Verified live (see §4) that Postgres genuinely returns `added_at` as a full ISO timestamp (`"2026-01-15T00:00:00.000Z"`) over JSON, not a plain date string, so this truncation is load-bearing, not defensive.

**`src/store/db.middleware.js`** — `COLLECTION_FIXUPS.invMaterials`: added `addedAt: normalizeDateOnly(r.addedAt)`, mirroring `COLLECTION_FIXUPS.attendance`/`.exams`'s existing handling of their own `@db.Date` columns exactly. No change needed for `teacher`/`description` — plain nullable strings pass through unchanged, same as `barcode` already does.

## 3. Fixed MaterialsPage's edit-erasure bug

**`src/services/materialService.js`** — two bugs found and fixed in `createMaterial()`/`updateMaterial()`, both upstream of the network layer entirely:
- `createMaterial()` previously **ignored** the user's chosen `addedAt` and hardcoded `new Date().toISOString().split('T')[0]` (today) regardless of what the date picker held. Now: `addedAt: clean.addedAt || new Date().toISOString().split('T')[0]`.
- `updateMaterial()` previously **omitted `addedAt` entirely** from its returned object — not even carried forward from the existing value. Now: `addedAt: clean.addedAt || data.addedAt`.
- Both functions' `sanitizeFormData(data, ['name','description'])` calls now include `'teacher'` too, matching the same defensive-coding rationale `description` already had (a value that will actually be persisted and re-displayed in three UI locations should be sanitized, same as `description` always was).

With these fixes plus the schema/API changes above, `MaterialsPage.jsx`'s own `handleSave`/`handleDelete` needed **zero changes** — they already adopt the server response verbatim; the bug lived entirely in the two files above.

## 4. Converged both modules onto `invMaterials`

Per Decision #1/#7/#9: `MaterialsPage.jsx`'s own selectors changed from `s.materials`/`s.setMaterials` to `s.invMaterials`/`s.setInvMaterials` (the new action, see §5). Four read-only consumers changed their selector from `s.materials` to `s.invMaterials` with no other code changes (verified field-by-field that `invMaterials` rows now carry everything these files already read):

| File | Change |
|---|---|
| `src/modules/materials/MaterialsPage.jsx` | `s.materials`→`s.invMaterials`, `s.setMaterials`→`s.setInvMaterials` |
| `src/modules/materials/MaterialReports.jsx` | `s.materials`→`s.invMaterials` |
| `src/modules/payments/PaymentForm.jsx` | `s.materials`→`s.invMaterials` |
| `src/modules/student-report/StudentReportPage.jsx` | `s.materials`→`s.invMaterials` |
| `src/modules/admissions/AdmissionsPage.jsx` | `s.materials`→`s.invMaterials` (local var name `realMaterials` kept) |

`MaterialDistribution.jsx` needed no change — it only ever receives `material` as a prop.

**Deliberately left untouched** (Decision #10/#11 — a rewiring change, not a cleanup pass): `src/store/slices/materials.slice.js` (now fully inert — nothing reads or writes `s.materials` anymore), `app.store.js`'s `partialize` entry for `materials` and its already-unused `useMaterials`/`setMaterials` exports, and `src/store/index.js` (confirmed zero importers anywhere in `src/` — a dead Phase-2→3 compatibility shim).

## 5. Wired InventoryPage's material CRUD to real Postgres

**`src/store/slices/inventory.slice.js`** — added `setInvMaterials`, mirroring `materials.slice.js`'s `setMaterials` exactly. `addInvMaterial`/`updateInvMaterial`/`removeInvMaterial` left in place, unmodified, now unused (confirmed by grep — zero remaining callers anywhere).

**`src/modules/inventory/InventoryPage.jsx`** — `handleSaveMaterial`/`handleDeleteMaterial` rewritten as `async`, server-truth-first (no local mutation before the server resolves), calling the same `pgCreateMaterial`/`pgUpdateMaterial`/`pgDeleteMaterial`/`pgGetCollection` functions `MaterialsPage.jsx` already used — including the same 409-code-conflict retry pattern. Only `name`/`subject`/`grade`/`price` are sent (mapped from this page's own `sellingPrice` field); `academicYear`/`edition`/`printingCost`/`notes` (no backing columns) and `minStock`/`status`/`barcode` (real columns, but not managed by any UI today — a pre-existing Phase 3B-11 boundary, not reopened here) continue exactly as before: captured locally in the form, not sent, not persisted server-side. This is a real, visible boundary of this change, not silently decided — see the approved plan's explicit callout.

**Two additional bugs found and fixed during implementation** (both squarely inside the approved scope, surfaced by writing and running the new test suite — see §7):

1. **`price` type.** `data.sellingPrice` is a string (`<input type="number">`'s `e.target.value`). The initial implementation passed it straight through to `pgCreateMaterial`/`pgUpdateMaterial`; the real backend column is `Decimal`, and the test caught the string `"50"` reaching the wire instead of the number `50`. Fixed: `price: Number(data.sellingPrice) || 0` at both call sites, matching how `materialService.js` already does `Number(clean.price)`.
2. **`MaterialFormModal.jsx`'s edit-prefill bug.** Its initial form state read `material?.sellingPrice ?? ''` — but every row now sourced from `invMaterials` (whether created via MaterialsPage or InventoryPage) only ever has the real column name `price`, never `sellingPrice`. Before this change this bug already existed for any Postgres-boot-synced material; after this change it would affect *every* material edited through InventoryPage, since local-only-created rows with a working `sellingPrice` no longer exist. Fixed: `sellingPrice: material?.sellingPrice ?? material?.price ?? ''`.

## 6. Live end-to-end verification (real database, not just mocked tests)

Beyond the schema check in §1, two live, self-cleaning Prisma-level checks were run (create → verify → delete, confirmed row count returns to the pre-existing baseline of 1 afterward each time):

- Created a row using **exactly** the field set `pgCreateMaterial` now sends from InventoryPage (`code`, `name`, `subject`, `grade`, `price` — no `teacher`/`description`/`added_at` keys at all). Result: `teacher`/`description`/`added_at` correctly default to `NULL`, a real BigInt `id` is assigned, and `materialDistribution.js`'s exact dependency check (`tx.inv_materials.findUnique({ where: { id }, select: { id: true } })`) **passes** — directly proving requirement (d): a material created through InventoryPage's write path can be used by material-distributions.
- Created a row with `added_at: new Date('2026-01-15')` and inspected the raw value Prisma/Express would serialize: confirmed it comes back as a JS `Date` object that `JSON.stringify`s to `"2026-01-15T00:00:00.000Z"` — a full ISO timestamp, not a plain date string — confirming the `normalizeMaterialResponse`/`COLLECTION_FIXUPS` truncation added in §2 is load-bearing, not precautionary.

Both verification rows were deleted immediately after inspection; a final `count()` confirmed `inv_materials` holds exactly 1 row (the pre-existing Phase 3B-12 verification artifact, unchanged) both before and after.

## 7. Test changes

- **`src/modules/materials/MaterialsPage.materials.test.jsx`** — rewritten. `seedStore()` now seeds `invMaterials`. The create/update tests now fill and assert `teacher`/`description`/`addedAt` are sent and round-trip correctly (previously they asserted the *opposite* — that these fields were never sent — which was the erasure bug encoded as a passing test). All other assertions (server-truth-first, code-conflict retry, delete FK handling) unchanged in substance, only the state key renamed.
- **`src/modules/inventory/InventoryPage.materials.test.jsx`** — new file, 8 tests, mirroring the same pattern: create/create-failure/duplicate-code-retry/update/update-failure/delete/delete-failure, plus one test specific to this page (the local `canDeleteMaterial` pre-check blocking a delete with no network call). The update test explicitly asserts `teacher`/`description`/`addedAt` are **absent** from InventoryPage's PUT payload — proving the Finding-1 fix (§5) is in place and a material's fields set via MaterialsPage cannot be silently wiped by an edit made through InventoryPage.
- **4 existing test files** had a `materials: [...]` seed key mechanically renamed to `invMaterials: [...]` (same value, matching the components' new selector): `AdmissionsPage.activation.test.jsx`, `AdmissionsPage.core.test.jsx`, `AdmissionsPage.payments.test.jsx`, `StudentReportPage.waReportLog.test.jsx`.
- **`src/modules/materials/MaterialDistribution.inventoryTxn.test.jsx`** — inspected, confirmed unaffected: it renders `MaterialDistribution` with a material passed directly as a prop, never touching the store's materials key at all.
- **`src/store/db.middleware.test.js`** — inspected, confirmed no `invMaterials`-specific test block existed to break; not modified.

## 8. Test suite and build results

```
npx vitest run
✓ 24 test files passed (24)
✓ 161 tests passed (161)
```
No regressions. All pre-existing `act()`/esbuild-duplicate-attribute warnings in the output (`ExamsPage.jsx`, `StudentForm.jsx`, `HomeworkPage.jsx`) are pre-existing and unrelated to this change — not introduced by it, not touched by it.

```
npm run build
✓ built in 5.87s
```
No type/import errors. `MaterialsPage-*.js` and `InventoryPage-*.js` chunks both built successfully.

## 9. Explicit checks against the 7 lettered requirements

- **(a) MaterialsPage create/edit/delete persist to Postgres** — confirmed by the rewritten test file's request/response assertions, and live-verified in §6.
- **(b) InventoryPage create/edit/delete persist to the same `inv_materials` rows** — confirmed by the new test file, and live-verified in §6.
- **(c) `teacher`/`description`/`addedAt` survive create and edit** — confirmed by both test files (MaterialsPage's own fields round-trip; InventoryPage's edits leave pre-existing values on the row untouched rather than nulling them).
- **(d) A material created from InventoryPage can be used by material-distributions** — confirmed live in §6 against the real database and the real dependency check `materialDistribution.js` performs; not just a mocked assertion.
- **(e) No write path remains local-only** — confirmed: `grep` for `pgCreateMaterial|pgUpdateMaterial|pgDeleteMaterial` now shows both `MaterialsPage.jsx` and `InventoryPage.jsx` as callers; `grep` for `addInvMaterial(|updateInvMaterial(|removeInvMaterial(` now shows zero call sites anywhere (only the still-present, now-unused definitions in `inventory.slice.js`).
- **(f) Inventory transaction behavior unchanged** — confirmed by direct re-inspection of `InventoryPage.jsx`'s `handleSaveTxn`/`handleSaveCount` (byte-for-byte identical to before: still call the local-only `addTxn`/`addInventoryTxn`, still use `buildInventoryTxn`/`buildCountAdjustment` from `inventoryService.js`, unmodified); `TxnFormModal.jsx`/`CountModal.jsx` not touched at all.
- **(g) No Teachers-domain functionality introduced** — confirmed: `teacher` is a bare `TEXT` column with no FK (verified via `information_schema` in §1); a grep for `teacher_id`/`teachers` across every changed file found exactly one match, the pre-existing (unmodified) `'teachers'` entry in `db.middleware.js`'s `PG_COLLECTIONS` array, unrelated to this change.

## 10. Complete file list

**Database:** `inv_materials` table — 3 columns added (`teacher`, `description`, `added_at`), no other change.

**Backend:** `backend/prisma/schema.prisma` (regenerated via `db:pull`, 3-line diff only). No route/server files changed.

**Frontend, functional changes:**
`src/services/api.js`, `src/store/db.middleware.js`, `src/services/materialService.js`, `src/store/slices/inventory.slice.js`, `src/modules/inventory/InventoryPage.jsx`, `src/modules/inventory/components/MaterialFormModal.jsx`, `src/modules/materials/MaterialsPage.jsx`, `src/modules/materials/MaterialReports.jsx`, `src/modules/payments/PaymentForm.jsx`, `src/modules/student-report/StudentReportPage.jsx`, `src/modules/admissions/AdmissionsPage.jsx`.

**Frontend, tests:**
`src/modules/materials/MaterialsPage.materials.test.jsx` (rewritten), `src/modules/inventory/InventoryPage.materials.test.jsx` (new), `src/modules/admissions/AdmissionsPage.activation.test.jsx`, `src/modules/admissions/AdmissionsPage.core.test.jsx`, `src/modules/admissions/AdmissionsPage.payments.test.jsx`, `src/modules/student-report/StudentReportPage.waReportLog.test.jsx`.

**Explicitly not touched:** `src/store/slices/materials.slice.js`, `src/store/app.store.js`, `src/store/index.js`, `backend/src/routes/crud.js`, `backend/src/server.js`, `backend/src/routes/materialDistribution.js`, `src/modules/materials/MaterialDistribution.jsx`, anything under Teachers, `matDist`'s own logic beyond the selector it already shared, `inventoryTxn`'s write path, Phase 3B-16.

---

A separate, read-only post-implementation audit (`MATERIALS_UNIFICATION_POST_IMPLEMENTATION_AUDIT.md`) re-verifies all of the above independently.
