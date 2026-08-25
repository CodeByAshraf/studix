# Materials Unification — Post-Implementation Audit

**Status: READ-ONLY.** No code, schema, or localStorage was modified to produce this report. Two live, read-only Prisma queries were run against the `studix` database; a fresh full test-suite run was executed (mocked network, no real DB writes). Every claim below was independently re-derived this pass — via fresh `grep`/`Read`, a fresh live query, and a fresh test run — not carried forward on trust from `MATERIALS_UNIFICATION_IMPLEMENTATION.md`.

---

## 1. Schema — re-verified live

```
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='inv_materials';
```
Result: 14 columns total — the 11 pre-existing (`id`, `code`, `name`, `subject`, `grade`, `price`, `cost`, `min_stock`, `status`, `barcode`, `created_at`) plus exactly three new ones: `teacher` (`text`, nullable), `description` (`text`, nullable), `added_at` (`date`, nullable). No column was removed, renamed, or had its type/nullability changed. `inv_materials.count()` returns `1` — identical to the pre-implementation baseline recorded in `MATERIALS_DOMAIN_DECISION_AUDIT.md` and re-confirmed at the start of implementation; the single row is still the pre-existing Phase 3B-12 verification artifact, undisturbed.

`schema.prisma` model count: `grep -c "^model "` returns `27` — the same count `db pull`'s own console output reported both before and after this change. `teachers` model spot-checked directly: `id, name, phone, subject, active, created_at, groups[], users[]` — byte-for-byte the same fields as before this work started. No FK was added anywhere pointing at `teachers` from `inv_materials`.

**Conclusion: exactly the 3 approved nullable columns exist, nothing else in the schema changed, Teachers' own table is untouched.**

## 2. Both write paths — re-verified by fresh grep, not by re-reading the implementation report's claims

```
grep -rn "pgCreateMaterial(|pgUpdateMaterial(|pgDeleteMaterial(" src --include=*.jsx --include=*.js | grep -v "\.test\.|api.js:"
```
Returns exactly 6 lines: 3 in `InventoryPage.jsx` (lines 82, 89, 112), 3 in `MaterialsPage.jsx` (lines 99, 107, 128). Both modules call the same three real, Postgres-backed functions.

```
grep -rn "addInvMaterial(|updateInvMaterial(|removeInvMaterial(" src --include=*.jsx --include=*.js
```
Returns **zero** results anywhere — the local-only actions have no remaining callers (their definitions still exist in `inventory.slice.js`, inert, as the implementation report states; this audit confirms nothing invokes them).

**Conclusion: no write path touching `inv_materials` data remains local-only. Requirement (e) holds.**

## 3. The destructive-null bug and its fix — re-read from the current file, not assumed

Read `src/services/api.js`'s current `buildMaterialRequestBody` directly:
```js
function buildMaterialRequestBody(data) {
  const body = { name: data.name, subject: data.subject ?? null, grade: data.grade ?? null, price: data.price ?? 0 };
  if (data.code !== undefined)        body.code        = data.code;
  if (data.teacher !== undefined)     body.teacher     = data.teacher;
  if (data.description !== undefined) body.description = data.description;
  if (data.addedAt !== undefined)     body.addedAt     = data.addedAt;
  return body;
}
```
Confirmed: `teacher`/`description`/`addedAt` are included **only when the caller actually provides them**, exactly like `code` already was. `InventoryPage.jsx`'s two call sites (`pgUpdateMaterial(editingMat.id, { name, subject, grade, price })`, `pgCreateMaterial({ name, subject, grade, price, code }, ...)`) never pass these three keys at all — confirmed by re-reading the current file — so a save from InventoryPage cannot include them, and therefore cannot null them out on the server. `MaterialsPage.jsx`'s call sites pass the full object `materialService.js` builds (`updated`/`nm`), which always includes real values for all three (confirmed by re-reading `createMaterial`/`updateMaterial`'s current bodies).

**Independently re-derived risk assessment:** had this been left as unconditional inclusion (`teacher: data.teacher ?? null`), every InventoryPage save would have sent `teacher: null, description: null, addedAt: null` explicitly. Prisma's `update()` treats a present key with value `null` as "set this column to NULL" — this is standard, well-documented Prisma partial-update semantics, not a project-specific assumption. This audit independently confirms the fix is both necessary and sufficient: conditional inclusion is the only one of the two options that lets a partial update genuinely leave an untouched column alone.

## 4. `teacher`/`description`/`addedAt` survive create and edit — re-derived from the test suite, re-run fresh

`npx vitest run` this session: **24 test files passed, 161 tests passed, 0 failed.** Specifically re-inspected (not just re-run) the two decisive assertions:

- `MaterialsPage.materials.test.jsx`'s update test seeds a record with `teacher: 'أ. محمد'`, `description: 'وصف قديم'`, `addedAt: '2026-01-01'`, changes only the `name`, and asserts the PUT body includes all three unchanged values (not a stale record — the actual JSON sent over the wire) and that the post-save local state still has `teacher`/`description`/`addedAt` intact after adopting the server's response.
- `InventoryPage.materials.test.jsx`'s update test seeds a record with the same three fields already populated (simulating a row created via MaterialsPage), edits only the `name` through InventoryPage's own form, and asserts `'teacher' in sentBody`, `'description' in sentBody`, `'addedAt' in sentBody` are all `false` — i.e., genuinely absent from the wire payload, not merely equal to their old values — and that the resulting local state still shows all three fields intact.

**Conclusion: requirement (c) holds for both directions — MaterialsPage's own fields survive its own edits, and InventoryPage's edits cannot touch fields it doesn't manage.**

## 5. InventoryPage-created materials and material-distributions — re-verified live against the real database, not re-stated from the implementation report

A fresh, independent live check this session (create → verify → delete, self-cleaning):
```
prisma.inv_materials.create({ data: { code, name, subject, grade, price } })   // no teacher/description/added_at keys — matches InventoryPage's real payload exactly
```
Result: a real `id` (BigInt) is assigned; `teacher`/`description`/`added_at` all read back as `null` (correct default, no corruption); `prisma.inv_materials.findUnique({ where: { id }, select: { id: true } })` — the exact query `backend/src/routes/materialDistribution.js` runs before allowing a distribution save — **returns the row**. The verification row was deleted immediately after; `inv_materials.count()` confirmed back at `1` both before this check and after.

**Conclusion: requirement (d) is independently confirmed at the database level, using the real dependency check the distribution endpoint actually performs — not inferred from the schema alone.**

## 6. `added_at`'s wire format — re-verified live, confirming the normalization is load-bearing

A fresh live check: created a row with `added_at: new Date('2026-01-15')`, inspected the raw Prisma value (`instanceof Date === true`) and its `JSON.stringify` output: `{"addedAt":"2026-01-15T00:00:00.000Z"}` — a full ISO timestamp, not a bare date. This independently confirms `normalizeMaterialResponse`'s `String(data.addedAt).slice(0, 10)` and `COLLECTION_FIXUPS.invMaterials`'s `normalizeDateOnly(r.addedAt)` (both re-read from the current files, present and correctly placed) are necessary, not decorative — without them, `MaterialsPage.jsx`'s `filtered.sort((a,b) => b.addedAt.localeCompare(a.addedAt))` would still happen to sort correctly on the string prefix, but `formatDate(mat.addedAt, ...)` and any future exact-date comparison would receive a full timestamp instead of `YYYY-MM-DD`.

## 7. Inventory transaction behavior — re-read directly, confirmed byte-identical in substance

Re-read `InventoryPage.jsx`'s current `handleSaveTxn`/`handleSaveCount` in full: both still call the purely local `addTxn` (`= useAppStore((s) => s.addInventoryTxn)`), still build transactions via `buildInventoryTxn`/`buildCountAdjustment` imported unchanged from `inventoryService.js`, still validate via `validateTxn` from `validators.js`. `TxnFormModal.jsx` and `CountModal.jsx` were not opened or modified during implementation (confirmed: neither file appears in the implementation report's file list, and a fresh directory listing shows no modification). `inventory.slice.js`'s `addInventoryTxn` action itself: unchanged, still a plain local `set()` call.

**Conclusion: requirement (f) holds — the inventory-transaction domain (as distinct from the material-catalog domain this work targeted) received zero functional changes.**

## 8. Teachers domain — re-verified with a fresh, broader grep than the implementation report's

```
grep -n "teacher_id|Teachers\b|teachers\.|from.*teacher" <every file touched by this change>
```
Zero matches in any of: `api.js`, `db.middleware.js`, `materialService.js`, `InventoryPage.jsx`, `inventory.slice.js`, `MaterialFormModal.jsx`, `MaterialsPage.jsx`. The only place the literal string `teachers` appears in any file this work touched is `db.middleware.js`'s `PG_COLLECTIONS` array — a pre-existing, unmodified line (`'parents', 'students', 'groups', 'teachers', 'exams', ...`) that predates this work entirely and has nothing to do with materials.

**Conclusion: requirement (g) holds. No Teachers-domain code, FK, or functionality was introduced or touched.**

## 9. `materials`/`matDist`/other explicitly-out-of-scope areas — re-verified untouched

- `src/store/slices/materials.slice.js` — re-read in full: identical to its pre-implementation content, still defines `materials`/`setMaterials`/`addMaterial`/`updateMaterial`/`removeMaterial`. Confirmed now genuinely unreferenced by any component (§2's `s.materials` grep found only this file, `app.store.js`'s dead exports, and the unrelated `src/store/index.js` shim — no functional code path reaches it anymore).
- `matDist` — `MaterialsPage.jsx`'s `matDist`/`setMatDist` bindings and `MaterialDistribution.jsx`/`MaterialReports.jsx`'s own logic re-read: unchanged. `MaterialDistribution.jsx` itself has zero lines changed (not in the implementation report's file list; confirmed by inspecting it fresh — it still receives `material` purely as a prop).
- `backend/src/routes/materialDistribution.js` — re-read in full: byte-identical to the version quoted in `MATERIALS_DOMAIN_DECISION_AUDIT.md` §2, not touched by this implementation.
- `backend/src/routes/crud.js`, `backend/src/server.js` — re-read the relevant sections (`prepareWriteData`, `READ_ONLY_COLLECTIONS`, `COLLECTION_PERMISSIONS.invMaterials`): unchanged. The generic CRUD route picked up the 3 new fields purely because `Prisma.dmmf` now includes them, with zero route-level code change — confirmed by inspecting the route logic, not just asserted.

## 10. Test suite and build — re-run fresh for this audit, not reused from the implementation pass

```
npx vitest run        → 24 files, 161 tests, all passed
npm run build          → built in 5.87s, no errors
```
Both commands were re-run independently for this audit (not copied from the implementation report's output).

---

## Final determination

Every claim in `MATERIALS_UNIFICATION_IMPLEMENTATION.md` is independently reproduced by this audit through direct code inspection, fresh greps, two live database round-trips, and a fresh test/build run. No drift, no unintended side effect, and no scope creep beyond what was explicitly approved was found. `teacher`/`description`/`addedAt` are real, working, nullable columns; both `MaterialsPage.jsx` and `InventoryPage.jsx` write through the same real Postgres path; the cross-module field-wipe risk this audit specifically looked for was found to be correctly prevented, not merely assumed to be; Teachers, `inventoryTxn`'s own write path, and `matDist`'s own logic are all confirmed untouched.

**Phase 3B-16 may now be considered unblocked with respect to the Materials domain**, pending the user's own review of this audit and the implementation report.

---

**No code, schema, database, or localStorage was modified to produce this report.**
