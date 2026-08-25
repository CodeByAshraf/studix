# Materials Domain — Decision Audit

**Status: READ-ONLY.** No code, schema, database, or localStorage was modified to produce this report. One read-only Prisma `count()`/`findMany()` query was run against the live `studix` database (no writes). Nothing here is authorized or implemented. Phase 3B-16 has not started. Teachers is not touched. This report supersedes and deepens §A of `REMAINING_LOCAL_BUSINESS_DATA_DECISION_AUDIT.md` — that section's `INVESTIGATE` framing is confirmed, but the reasoning below is materially more complete and contains a finding that report did not surface.

---

## Headline finding (read this first)

Every prior report — including this session's own `REMAINING_LOCAL_BUSINESS_DATA_DECISION_AUDIT.md` and `PHASE_3B-11_AUDIT.md`'s "retrospective CLEAN" verdict — treated `invMaterials`/Inventory as "the already-migrated side" and `materials`/MaterialsPage as "the side with the gap." Direct tracing of **every write call site** in the entire frontend this session shows that framing is wrong in one crucial respect:

- **`pgCreateMaterial`/`pgUpdateMaterial`/`pgDeleteMaterial`** (`src/services/api.js`) — the only functions that actually write `inv_materials` rows to Postgres — are called **exclusively from `MaterialsPage.jsx`** (confirmed by a full-tree grep of every call site: `MaterialsPage.jsx:99,107,128` and nowhere else).
- **`InventoryPage.jsx`'s own "add material / edit material / delete material" UI** (`MaterialFormModal.jsx`, wired via `handleSaveMaterial`/`handleDeleteMaterial`, `InventoryPage.jsx:73-97`) calls `addInvMaterial`/`updateInvMaterial`/`removeInvMaterial` — **pure local Zustand actions** (`inventory.slice.js:21-33`, plain `set()` calls, no `fetch`, no import from `api.js`). **Nothing this UI does ever reaches Postgres.**
- **`InventoryPage.jsx`'s own "record a stock transaction / count adjustment" UI** calls `addInventoryTxn` — also a pure local action (`inventory.slice.js:36-37`). A full-tree grep for any write function touching `inventoryTxn` in `api.js` returns **zero results** — no `pgCreateInventoryTxn` or equivalent exists anywhere.
- The **only** place that ever writes a real `inventory_txn` row to Postgres is `pgSaveMaterialDistribution` (`api.js:895-...`, `PUT /api/material-distributions/:materialId`), called exclusively from `MaterialDistribution.jsx` — which is part of the **Materials/study-catalog module**, not Inventory.

So the accurate picture is not "Inventory is migrated, Materials is local-only." It is: **the Materials module's create/update/delete is server-synced but never re-reads from the server; the Inventory module reads correctly from the server but its own create/update/delete/transaction UI is entirely local and never reaches the server at all.** Both modules are half-migrated, in complementary and non-overlapping halves, against the same table. `PHASE_3B-11_AUDIT.md`'s "CLEAN" verdict for `inv_materials` was scoped to what `MaterialsPage.jsx` does (which is genuinely clean) and did not audit `InventoryPage.jsx`'s own write actions at all — its own §3 "unrelated observation" flagged the two-slice duplication but did not notice that one side's writes are fake.

**Concrete consequence, traced through the backend:** `backend/src/routes/materialDistribution.js:147-148` requires the material to already exist as a real `inv_materials` row (`if (!material) throw badRequest('المادة غير موجودة')`) before any distribution record can be saved. A material added through **Inventory's own "+ مادة" button** never gets a real row — so **that material can never be distributed to students via `MaterialDistribution.jsx`**; the save would fail with "material not found." This is a live, reproducible functional break caused directly by the two-slice split, not a hypothetical risk.

---

## 1. MaterialsPage.jsx — exhaustive trace

### Every field stored locally (`materials` Zustand key)

Built by `createMaterial`/`updateMaterial` (`src/services/materialService.js:37-64`):

| Field | Set by | Type | Required (UI) |
|---|---|---|---|
| `id` | `mat${Date.now()}` client-side on create, **overwritten by server's real BigInt-as-string id** on save (server is not in `PRESERVE_CLIENT_ID_COLLECTIONS`, confirmed by `api.js:835-836`'s comment) | string | n/a |
| `name` | user input | string | yes |
| `subject` | user input (`SUBJECTS` list) | string | yes |
| `teacher` | user input, free text | string | no |
| `grade` | user input (`GRADES` list, materials-module-local list, distinct from `admissions`' `GRADES`) | string | yes |
| `price` | user input, number | number | yes (via `materialSchema`, not `validateMaterial`) |
| `description` | user input, free text | string | no |
| `addedAt` | user-editable date input, defaults to today | date string `YYYY-MM-DD` | **yes** (`validateMaterial`, `materialService.js:30`) |
| `createdAt` | `new Date().toISOString()`, set on create only | ISO datetime | n/a |
| `updatedAt` | `new Date().toISOString()`, set by `updateMaterial()` only | ISO datetime | n/a |
| `code` | computed client-side (`nextMatCode`, `MaterialsPage.jsx:19-27`), sent only on create | string `MAT-XXXXXX` | n/a |

### Every field read

`MaterialsPage.jsx` reads: `id, name, subject, teacher, grade, price, description, addedAt, code` (table columns, sort key, KPI aggregation via `getMatStats`/`getTotalRevenue`). `MaterialReports.jsx` reads `subject, grade, teacher, name` for display and grouping. `MaterialDistribution.jsx` reads `name, price, grade, id` (price drives the "expected revenue" calc and the paid/partial/unpaid default amounts; grade filters eligible students). `PaymentForm.jsx` reads `grade` (filter) and, implicitly, `id/name/price` for the picker. `StudentReportPage.jsx` reads materials indirectly through `matDist`/`materials` for the student's report (booklet history). `AdmissionsPage.jsx` reads `realMaterials = s.materials` for booklet-purchase entries during the admissions payment flow.

### Every writer

Exactly one code path: `MaterialsPage.jsx`'s `handleSave` (create/edit, lines 95-123) and `handleDelete` (lines 125-136). No other file calls `setMaterials`/`addMaterial`/`updateMaterial`(store action)/`removeMaterial` outside this file and its own test file.

### Every reader (Zustand `s.materials` consumers, confirmed by grep)

`MaterialsPage.jsx`, `MaterialReports.jsx`, `MaterialDistribution.jsx` (via `material` prop passed down from `MaterialsPage.jsx`, not a direct store read), `PaymentForm.jsx`, `StudentReportPage.jsx`, `AdmissionsPage.jsx`. **`InventoryPage.jsx` is not in this list** — it reads the separate `invMaterials` key exclusively.

### Exact API calls

- `POST /api/invMaterials` (`pgCreateMaterial`, `api.js:837-860`) — create.
- `PUT /api/invMaterials/:id` (`pgUpdateMaterial`, `api.js:863-873`) — update.
- `DELETE /api/invMaterials/:id` (`pgDeleteMaterial`, `api.js:879-887`) — delete; server rejects (409) if `inventory_txn` rows reference the material (FK, `NO ACTION`).
- `GET /api/invMaterials` (`pgGetCollection('invMaterials')`) — used **only** as a one-shot fallback inside the 409-code-conflict retry (`MaterialsPage.jsx:111-114`), to compute a fresh next code. This is the only read MaterialsPage.jsx ever performs against the server — it is not a general refresh/boot-sync.

### Exact transformation between local object and API object

`buildMaterialRequestBody` (`api.js:805-814`) sends **only** `{ name, subject, grade, price, code? }`. `teacher`, `description`, `addedAt`, `createdAt`, `updatedAt`, `id` are **never sent**, confirmed both by reading the function and by the passing, asserted test `MaterialsPage.materials.test.jsx:106-127` (`expect(sentBody.teacher).toBeUndefined()` etc., explicitly listed one by one). `normalizeMaterialResponse` (`api.js:820-827`) converts `price/cost/minStock` from Decimal-as-string to real numbers on the way back.

**Confirmed data-loss behavior, not hypothetical:** on both create and update, the value stored into local state afterward is `saved` — the server response — used as-is (`setMaterials(prev => [saved, ...prev])` on create, `setMaterials(prev => prev.map(m => m.id===modal.mat.id ? saved : m))` on update). The server response never contains `teacher`/`description`/`addedAt` (they have no column). **This means every successful save — including editing only the `name` of an existing material — silently erases that material's `teacher`, `description`, and `addedAt` from local state.** This is proven by the passing test itself: `MaterialsPage.materials.test.jsx:186-212` seeds an `existing` record with `teacher:''`, `description:''`, `addedAt:'2026-01-01'`, performs an edit, and asserts the resulting stored record `toEqual([{ ...saved, price:100, cost:0, minStock:0 }])` — an object that structurally has no `teacher`/`description`/`addedAt` keys at all. The test file's own header comment (`materials.test.jsx:1-6`) frames this as intentional, correct behavior ("نتبنّى استجابة الخادم كما هي" — "we adopt the server response as-is"), not as a known gap.

Practical implication: on a database that already has real rows (any material created since this wiring shipped), the `teacher`/`description` inputs and the `addedAt` date-picker on the Add/Edit form are fully interactive, validated (in `addedAt`'s case, required), and then **discarded immediately upon successful save** — they currently persist nowhere beyond the render that created them, unless the browser's `studix-v1` happens to still hold a value from before this Phase 3B-11 wiring existed (impossible on a fresh install — `INITIAL_MATERIALS` is `[]`) and that record is never edited again.

---

## 2. invMaterials / Inventory domain — exhaustive trace

### Prisma model (`backend/prisma/schema.prisma:316-331`)

```
model inv_materials {
  id                 BigInt   @id @default(autoincrement())
  code               String   @unique
  name               String
  subject            String?
  grade              String?
  price              Decimal  @default(0) @db.Decimal(12, 2)
  cost               Decimal  @default(0) @db.Decimal(12, 2)
  min_stock          Decimal  @default(0) @db.Decimal(12, 2)
  status             String   @default("active")
  barcode            String?
  created_at         DateTime @default(now()) @db.Timestamptz(6)
  admission_payments admission_payments[]
  inventory_txn      inventory_txn[]
  payments           payments[]
}
```

No `updated_at`, no `teacher`, no `description`, no `academicYear`, no `edition`, no `notes`. Real FK relations exist to `admission_payments`, `inventory_txn`, and `payments` — this table is a genuine relational anchor for three other financial/operational domains, not a leaf table.

### API route

Generic CRUD (`backend/src/routes/crud.js`) mounted at `/api/invMaterials` via `makeCrudRouter('inv_materials', { writable: true })` (`server.js`; confirmed writable — `inv_materials`/`invMaterials` is not in `READ_ONLY_COLLECTIONS = new Set(['payments','admissionPayments'])`). No dedicated controller file exists for `invMaterials` itself — full `GET/POST/PUT/PATCH/DELETE` all go through the same generic model-driven router used for every writable collection. Unknown fields in the request body are silently dropped (`crud.js:52-59`, `prepareWriteData`: `if (!field) continue`) — this is the general mechanism, not something special-cased for materials.

The one **dedicated** route touching this domain is `backend/src/routes/materialDistribution.js` (`PUT /api/material-distributions/:materialId`) — a hand-written, atomic, idempotent roster-reconciliation endpoint (Phase 3B-12) that writes `inventory_txn` rows (types `studentDelivery`/`reservation`/`reservationRelease`/`return`, `quantity` always `1`, `legacy_metadata` JSONB carrying `receivedAt/payStatus/paidAmount`) keyed off a real `inv_materials.id`. It explicitly requires the material to already exist server-side (`materialDistribution.js:147-148`).

### Frontend consumers

`InventoryPage.jsx` is the only consumer of `s.invMaterials`. It renders a material list/search/detail panel, a stock ledger (from `inventoryTxn`), KPIs (`getInventoryKpis`), and hosts `MaterialFormModal.jsx` (add/edit) plus transaction/count-adjustment forms.

### Zustand slice (`src/store/slices/inventory.slice.js`)

```js
invMaterials: INITIAL_INV_MATERIALS,   // []
inventoryTxn: INITIAL_INVENTORY_TXN,   // []
inventorySettings: INITIAL_INVENTORY_SETTINGS,

addInvMaterial:    (material) => set(s => ({ invMaterials: [material, ...s.invMaterials] })),        // local only
updateInvMaterial: (id, upd)  => set(s => ({ invMaterials: s.invMaterials.map(...) })),                // local only
removeInvMaterial: (id)       => set(s => ({ invMaterials: s.invMaterials.filter(...) })),             // local only
addInventoryTxn:   (txn)      => set(s => ({ inventoryTxn: [txn, ...s.inventoryTxn] })),               // local only
updateInventorySettings: (upd) => set(s => ({ inventorySettings: {...s.inventorySettings, ...upd} })), // local only
```

None of these five actions call `fetch` or import anything from `api.js`. All are plain, synchronous local-state mutations.

### Boot-sync behavior

`invMaterials`, `inventoryTxn`, and `inventorySettings` are all in `PG_COLLECTIONS` (`db.middleware.js:21-27`) — on every app load (backend reachable), each is fetched and merged by id (`mergeById`, server wins on id collision, local-only ids are kept, never deleted) into the corresponding Zustand key. `invMaterials` additionally has a `COLLECTION_FIXUPS` entry (`db.middleware.js:128-133`) normalizing `price/cost/minStock` from Decimal-as-string. This read path is correct and genuinely CACHE_ONLY, matching prior audits.

### Create/update/delete behavior — the actual gap

- **Create/Update/Delete via `InventoryPage.jsx`'s own UI**: 100% local (see Headline Finding above). A material added this way gets a client-generated id `mat_${Date.now()}` (`inventoryService.js:41`, note the underscore — a different local-id convention from `materialService.js`'s `mat${Date.now()}`, one more small inconsistency between the two modules) and **never becomes a real Postgres row**. It survives local refresh (persisted in `studix-v1`'s `invMaterials`), is never overwritten by boot-sync (its id never collides with anything server-side), and will persist indefinitely as a local-only "ghost" record — visually indistinguishable in the UI from a real, server-confirmed row.
- **Delete via `InventoryPage.jsx`**: same local-only pattern (`removeInvMaterial`) — no `DELETE /api/invMaterials/:id` call, so a real server-side row can never actually be deleted from this UI; only client-generated local rows are ever removed by it (any attempt to "delete" a real row here only hides it locally — it reappears from Postgres on next boot-sync merge).
- **Stock transactions (in/out/damaged/reservation/count-adjustment) via `InventoryPage.jsx`**: same local-only pattern (`addInventoryTxn`) — none of this ever reaches `inventory_txn` server-side. Only deliveries recorded through the *other* module's `MaterialDistribution.jsx` (Phase 3B-12) actually persist to `inventory_txn`.

### Exact fields and semantics (Inventory's own local model, `inventoryService.js:39-57` `buildMaterial`)

`id, code, name, subject, grade, academicYear, edition, sellingPrice, printingCost, minStock, status, barcode, notes, createdAt, updatedAt`. Compare to the real `inv_materials` schema above: **`academicYear`, `edition`, `printingCost` (schema has `cost`, a different name and, per `MaterialFormModal.jsx`, a different intended meaning — "printing cost" vs. an unlabeled `cost`), `notes`, and `updatedAt` also have no backing column.** This is the same shape of problem as `materials`' `teacher`/`description`/`addedAt` — but because Inventory's writes never reach the server at all, this mismatch has never actually been exercised through the generic CRUD's field-dropping path the way Materials' has; it would surface immediately if Inventory's create/update were ever wired to `pgCreateMaterial`-equivalents unchanged.

---

## 3. Field-by-field comparison

| Concept/Field | Local `materials` | `invMaterials`/Postgres (`inv_materials`) | Same meaning? | Loss/conversion? | Notes |
|---|---|---|---|---|---|
| `id` | Client `mat${Date.now()}` on create; replaced by server BigInt-string after save | `BigInt @id @default(autoincrement())` | Same identity concept | None once synced (MaterialsPage path); **Inventory-local ids never convert — permanent client string, never becomes a real id** | `preserveClientId` is not enabled for this collection — the server's id always wins |
| `code` | Computed locally (`nextMatCode`), format `MAT-XXXXXX` | `String @unique` | Same | None (round-trips correctly) | Both modules compute "next code" independently from their own (differently-synced) local arrays — collision is possible in theory, defended against with a one-shot retry only on the MaterialsPage side |
| `name` | Free text | `String` (required) | Same | None | Fully wired both directions |
| `subject` | From `materialService.js`'s `SUBJECTS` list | `String?` | Same concept, **different value domains** — MaterialsPage's `SUBJECTS`/`GRADES` lists (`materialService.js:4-16`) are separate constants from Inventory's `INV_SUBJECTS`/`INV_GRADES` (`inventory/displayMeta.js`, not re-derived here) and from Admissions' own `GRADES` (`mockData.js:72`) | None at the DB-string level (both just write a string) | No shared enum/lookup table anywhere in the codebase — three separate hardcoded lists for what should be one taxonomy |
| `grade` | From materials-module `GRADES` list | `String?` | Same concept, different value domain (see above) | None at DB level | Cross-module `grade` matching (e.g. `PaymentForm.jsx`'s `materials.filter(m => m.grade === selectedStudent.grade)`) is fragile if the lists ever diverge in wording |
| `price` | User input, number | `price Decimal(12,2)` | Same | None (normalized both ways) | — |
| `cost` | Not present in `materials`/`materialService.js` at all | `cost Decimal(12,2)` | N/A locally | N/A | MaterialsPage never sets or displays this column; it silently sits at its DB default (`0`) for every row MaterialsPage creates |
| `minStock` | Not present in `materials` | `min_stock Decimal(12,2)` | N/A locally | N/A | Same as `cost` — MaterialsPage-created rows get the DB default |
| `status` | Not present in `materials` | `status String @default("active")` | N/A locally | N/A | Same — no local field, no UI in MaterialsPage to change it |
| `barcode` | Not present in `materials` | `barcode String?` | N/A locally | N/A | Same |
| `teacher` | Free text, displayed in 3 places | **No column** | N/A on server | **Lost on every save** (confirmed by test) | See §1 — currently non-functional beyond the current render |
| `description` | Free text, displayed in 1 place (MaterialsPage table row) | **No column** | N/A on server | **Lost on every save** | Same |
| `addedAt` | Required date field, drives list sort order | **No column** | N/A on server | **Lost on every save** | The one field that's both *required by the UI* and *guaranteed to never persist* — the sharpest instance of this problem |
| `createdAt`/`created_at` | Client `new Date().toISOString()` on create | `created_at DateTime @default(now())` | Same concept | Local value discarded, server's own timestamp wins on the response that gets stored | Not a loss — the server's `created_at` is arguably more correct than a client clock value |
| `updatedAt` | Client-set by `updateMaterial()`, sent nowhere | **No column on `inv_materials`** (unlike `inv_materials`'s Inventory-side local shape, which also has an `updatedAt` with no column) | N/A | Lost | Neither module's `updatedAt` concept has a home |
| `academicYear`, `edition`, `printingCost`, `notes` (Inventory-only local fields) | Not present in `materials` at all | **No column** | N/A | Would be lost the moment Inventory's writes were ever wired to the server unchanged | Confirms the field-loss pattern is not unique to MaterialsPage — Inventory's own local model has the identical class of problem, just never yet exercised because its writes never reach the server |
| Stock/quantity | Not tracked in `materials`/`matDist` directly | **Not a column at all** — `inv_materials` deliberately has no quantity field; stock is *computed* from summing `inventory_txn` (`getCurrentStock`, `inventoryService.js:109-118`) | N/A — by design, on both sides, quantity is derived, never stored | N/A | Genuinely correct, shared design principle — the one place the two modules already agree architecturally |
| Category/type | `subject`+`grade` double as an informal category | Same two fields | Same | None | No separate `category`/`type` field exists anywhere |

---

## 4. Business workflows — traced

**Creating a material (MaterialsPage.jsx):** user fills name/subject/teacher/grade/price/addedAt/description → `handleSave` → `createMaterial(formData)` builds the full local object (incl. `teacher`/`description`/`addedAt`) → `pgCreateMaterial` strips it down to `{name,subject,grade,price,code}` and POSTs → server creates the row, returns the truncated real row → local state adopts that truncated row verbatim. **Net effect: the material exists in Postgres; `teacher`/`description`/`addedAt` the user just typed do not exist anywhere after this completes.**

**Creating a material (InventoryPage.jsx):** user fills the `MaterialFormModal` (code/name/subject/grade/academicYear/edition/sellingPrice/printingCost/minStock/status/barcode/notes) → `handleSaveMaterial` → `buildMaterial` → `addInvMaterial` (local `set()` only). **Net effect: the material exists only in this browser's `localStorage`, forever, with no server row at all** — and, per the Headline Finding, can never be selected in `MaterialDistribution.jsx`'s roster-save workflow because the backend requires a real `inv_materials.id`.

**Editing a material (MaterialsPage.jsx):** same round trip as create; **destructively drops `teacher`/`description`/`addedAt`** from local state even if the user only changed `name` (confirmed by the passing test, §1).

**Editing a material (InventoryPage.jsx):** local-only, same as create — no server involvement, no destructive-drop problem (because nothing is ever sent, there's nothing to lose to the network), but also never persists past a `localStorage` clear and never appears to any other browser.

**Deleting a material:** MaterialsPage → real `DELETE /api/invMaterials/:id`, server enforces the `inventory_txn` FK (409 if referenced) — correct and safe. InventoryPage → local-only removal; can only ever "delete" its own local-only ghost rows; a real server row deleted this way simply reappears on next boot-sync.

**Selecting a material elsewhere:**
- `PaymentForm.jsx` — filters `s.materials` (MaterialsPage's key) by `grade` to offer booklet purchase during payment collection. Only ever sees materials created via MaterialsPage in *this* browser (no boot-sync) — never sees materials added via InventoryPage, and never sees materials another browser created via MaterialsPage either, until this browser's own MaterialsPage happens to create/edit something that triggers a state update covering that id.
- `AdmissionsPage.jsx` — same, reads `s.materials` (misleadingly named `realMaterials` locally in that file) for booklet line items during admission payment entry.
- `StudentReportPage.jsx` — reads `s.materials` to resolve names/prices for a student's booklet history (driven by `matDist`).

**Inventory transactions:** `InventoryPage.jsx`'s own stock-in/out/damage/reservation/count-adjustment recording is entirely local-only (§2). The only inventory transactions that are ever real are `studentDelivery`/`reservation`/`reservationRelease`/`return` rows created transactionally by `PUT /api/material-distributions/:materialId` when `MaterialDistribution.jsx` saves a roster. `InventoryPage.jsx`'s own stock KPIs (`getInventoryKpis`, `getCurrentStock`) sum `s.inventoryTxn`, which **is** boot-synced — so real deliveries recorded via the *other* module correctly feed Inventory's stock numbers on next load, but any stock-in/adjustment recorded directly in Inventory itself does not survive a refresh from a clean boot-sync-driven state and would never be visible to another browser.

**Reports:** `MaterialReports.jsx` reads `s.materials` + `s.matDist`, entirely within the Materials module's own local, non-boot-synced data — never touches `s.invMaterials`.

**Material distributions:** `MaterialDistribution.jsx` → `pgSaveMaterialDistribution` → atomic, idempotent, transactional backend reconciliation against real `inventory_txn` rows, gated on the material already being a real `inv_materials` row. This is the single most robust, correctly-engineered piece of the entire domain (Phase 3B-12) — but its correctness is conditional on the material having come from MaterialsPage's real write path, not Inventory's local-only one.

**Academic/teacher workflow using materials:** none found. `teacher` on a material is a free-text label typed by the admin/staff user creating the catalog entry (which teacher's material this is), not a reference to the real `teachers` table/domain and not consumed by any teacher-facing feature. No file under `src/modules` that deals with teachers reads `materials`/`invMaterials`, and no file here reads the `teachers` collection. This confirms the "Do not touch Teachers" boundary is naturally respected — there is no real coupling to disturb.

---

## 5. Historical migration decisions — origin and implications

Three documents bear directly on why `teacher`/`description`/`addedAt` are excluded from `inv_materials`, and none of them amount to a considered decision that these fields are unnecessary.

**`migration/MIGRATION_PLAN.md:44-45`** (the original, higher-level migration plan, predates the Phase 3B-* incremental rollout): *"الدمج materials/matDist → inv_materials/inventory_txn — `materials` القديم → `inv_materials` (إن لم يكن مُرحّلاً عبر invMaterials)."* ("Merging materials/matDist → inv_materials/inventory_txn — the old `materials` → `inv_materials`, if not already migrated via invMaterials.") **This is the actual origin of the "one domain" intent**: the plan's own author treated `materials` and `invMaterials` as the same target table from the start — not two domains to keep separate. It says nothing at all about `teacher`/`description`/`addedAt` specifically; it does not decide to drop them, it simply doesn't address field-level granularity at that level of planning.

**`migration/mapping/fieldMaps.js:174-182`** — the field-mapping table used by the (separate, batch) `import-postgres.js` script — has an `invMaterials` entry with exactly the 10 real columns and **no separate `materials` entry at all**. `fieldMaps.js`'s own comment block (`:292-296`) enumerates tables built by "special logic" (`parents`, `matDist`, `admissionChildren`, `auth`) and does not list `materials` as one of them either — meaning the old local `materials` slice's extra fields were simply never given a mapping in this file, one way or the other. This is the file `api.js:797-801`'s comment cites as having "confirmed... this is a deliberate exclusion in the original migration design" — but reading it directly shows it is **silence, not a deliberate exclusion**. There is no line anywhere in `fieldMaps.js` that says "teacher/description/addedAt should not be migrated."

**`migration/reports/PHASE_3B-11_AUDIT.md`** — the report that actually shipped the live `pgCreateMaterial`/`pgUpdateMaterial`/`pgDeleteMaterial` wiring — gives `inv_materials` a "retrospective CLEAN" verdict (§1) on the grounds that the CRUD is correctly server-truth-first and Decimal-normalized. It does **not** discuss the `teacher`/`description`/`addedAt` field loss at all (no mention of these three field names anywhere in the report). Its own §3 "unrelated observation" *does* flag the two-slice duplication (`materials` vs `invMaterials`) as "pre-existing architectural duplication... not investigated further or modified" — an explicit statement that this was seen and consciously deferred, not resolved.

**Implication:** the current state (`teacher`/`description`/`addedAt` silently dropped on every save) is not the result of anyone concluding "these are legacy UI metadata, safe to drop." It is the mechanical consequence of (a) an original plan that assumed one merged table without specifying field-level handling, (b) a field-mapping file that only ever enumerated the columns that already existed, and (c) an implementation phase that wired the CRUD correctly for the columns that do exist and, per `crud.js`'s generic "unknown field → silently ignored" behavior, never had to make an explicit decision about the rest — it happened by omission. **This audit does not treat that omission as a validated decision**, per the instruction not to assume prior decisions are still correct.

---

## 6. Can local `materials` data safely disappear once Postgres is authoritative?

**Can MaterialsPage directly use `invMaterials`?**
Mechanically, yes, with two prerequisites: (1) add `materials`... or rather, retarget `MaterialsPage.jsx` to read `s.invMaterials` instead of `s.materials`, which would immediately fix the "never boot-synced" gap (since `invMaterials` already is), and (2) either accept the loss of `teacher`/`description`/`addedAt` as permanent and remove those inputs from `MaterialForm.jsx` (they already don't persist), or add the missing columns first. Doing (1) without deciding (2) just makes the existing, already-live field-loss more visible and consistent (it would no longer depend on which of the two views you happen to look at).

**Would any legitimate functionality be lost?**
Not from *removing the local-only `materials` key* itself — its only genuinely persistent content today is exactly what already round-trips to `invMaterials` anyway (`name/subject/grade/price/code`). What *would* be lost, permanently and irreversibly, is any `teacher`/`description`/`addedAt` value a user has typed since the last time that specific record was saved (i.e., data that is already effectively unsaved from the server's perspective the moment the save button is clicked) — this is not new loss caused by unifying the views, it is loss that is already happening today, just currently invisible because the two local caches disagree.

**Are `teacher`/`description`/`addedAt` actual business requirements or merely legacy UI metadata?**
Genuinely mixed, based on how they're actually used (§1, §4): `teacher` and `description` are pure display metadata — read in at most three places, never filtered/computed/cross-referenced by anything. `addedAt` is different in kind: it's the sort key for the entire materials list (`MaterialsPage.jsx:85`) and is marked *required* by the UI's own validation — treating it as disposable "legacy metadata" is hard to square with it being a required field that determines list ordering. None of the three are wired into any cross-domain business rule (no FK-like reference, no report computation depends on them), which is why "merely legacy" is defensible for `teacher`/`description` but not a clean fit for `addedAt`.

**Does any existing Postgres table already have a proper place for them?**
No. `inv_materials` is the only plausible table and it lacks all three columns. No other table (`admission_payments`, `payments`, `communications`, etc.) has an obvious home for a booklet's teacher/description/added-date either.

**Would adding fields to `inv_materials` be necessary?**
Only if the product decision is "these are real content, keep them" — in which case yes, three columns (`teacher String?`, `description String?`, `added_at Date` or reuse `created_at` if "added" and "created" are meant to be the same moment, which they currently are not — `addedAt` is user-editable, `createdAt` is not) would need to be added, plus `crud.js`'s `buildMaterialRequestBody`-equivalent (`api.js:805-814`) would need to include them, plus the local state should stop being overwritten wholesale by the server response for round-tripped fields it doesn't know about (or those fields need to actually reach the server, at which point this stops being an issue).

**Would a separate table actually be justified?**
Only under interpretation (C) — that a study-materials catalog (sold to students, tracked for distribution/revenue) is a genuinely distinct business concept from an inventory/stock-management catalog (tracked for physical stock levels, printing costs, damage/loss). The evidence leans against this: both already share `code`/`name`/`subject`/`grade`/`price`, both are keyed by the same `MAT-XXXXXX` numbering scheme, and the original migration plan (`MIGRATION_PLAN.md`) explicitly intended one merged table from the start. A separate table would mean re-deciding how `inventory_txn` (which FKs to `inv_materials.id`) and `payments`/`admission_payments` (which also FK to `inv_materials.id`) relate to whichever table holds the "real" catalog — a much larger blast radius than extending columns.

---

## 7. Decision matrix

| Option | Description | Schema change | Data migration | Code impact | Risk | Recommendation |
|---|---|---|---|---|---|---|
| **A. Unify MaterialsPage with invMaterials, no schema change** | Retarget `MaterialsPage.jsx` to read/write `s.invMaterials` via the existing `pgCreateMaterial`/etc.; remove `teacher`/`description`/`addedAt` inputs from `MaterialForm.jsx` (since they can never persist); also wire `InventoryPage.jsx`'s own create/update/delete/transaction actions onto the same real `pgCreateMaterial`/etc. functions instead of local-only Zustand actions | None | None (both already write the same table) | Medium — touches both modules' write paths, removes 3 form fields, changes one Zustand key everywhere it's read (6+ files) | Low technical risk, but a real, visible product change (loses 2 cosmetic fields; `addedAt` sort-order needs a replacement, e.g. `createdAt`) | **Candidate, if `teacher`/`description`/`addedAt` are judged non-essential** |
| **B. Extend `inv_materials` with the missing fields** | Add `teacher String?`, `description String?`, `added_at`/reuse `created_at` (decide semantics) to the Prisma schema/migration; extend `buildMaterialRequestBody`/`prepareWriteData` field allowlist; then proceed as in A | Yes — 2-3 new nullable columns, low-risk additive migration | None required beyond the schema change itself | Medium — same unification work as A, plus a migration file and updating the two request-body builders | Low (additive, nullable columns; no existing data to backfill since nothing has ever stored these server-side) | **Preferred, if `teacher`/`description` are judged worth keeping as real content, and especially if `addedAt` is judged worth keeping as a real, user-set date distinct from `created_at`** |
| **C. Create a separate materials domain/table** | Split `inv_materials` into two tables: a lean inventory/stock table and a richer study-catalog table, redefine the FK targets on `inventory_txn`/`payments`/`admission_payments` | Yes — new table + FK redirection on 3 existing tables | Yes — real, since `inv_materials` already has at least one live row and 3 tables reference it by id | High — touches the backend schema, 3 FK relations, both frontend modules, and the material-distributions transactional endpoint | High — the FK redirection is the risky part; not obviously justified by the evidence (§6) | **Not recommended** given current evidence — no discovered requirement actually needs two separate identities for the same booklet/material |
| **D. Keep local `materials` permanently (as-is)** | Do nothing; leave the current split | None | None | None | High and ongoing — the confirmed field-loss-on-save keeps happening silently, the boot-sync gap keeps producing empty-catalog-on-fresh-browser symptoms, and Inventory-created materials keep being undistributable | **Not recommended** — this is the status quo the audit was commissioned to evaluate, and it has a live, reproducible defect (§1, Headline Finding), not just architectural untidiness |
| **E. Fix Inventory's write path only, leave MaterialsPage/field-loss as-is** | Wire `InventoryPage.jsx`'s create/update/delete/transaction actions onto real server calls (closing the "Inventory writes are fake" half of the Headline Finding), without touching MaterialsPage's field-loss problem or the boot-sync gap | None | None | Medium — only touches `InventoryPage.jsx`'s handlers + adds `pgCreateInventoryTxn`-equivalent functions | Medium — closes the more severe of the two halves (materials that literally cannot be distributed) but leaves the field-loss and boot-sync issues open | **Reasonable minimum first step if a full unification (A/B) is not approved yet** — it removes the functional break (undistributable Inventory-created materials) without requiring the harder product decision about `teacher`/`description`/`addedAt` |

---

## 8. Final conclusion

**Are "materials" and "invMaterials" one business domain represented by two frontend views, or two genuinely distinct domains?**
**One domain, split across two half-migrated views (Option A/B territory, not C).** The original migration plan explicitly intended one merged table (`MIGRATION_PLAN.md:44-45`); both frontend models share `code`/`name`/`subject`/`grade`/`price` and the same `MAT-XXXXXX` numbering; and the backend already treats them as one table with real FK relationships from `inventory_txn`/`payments`/`admission_payments`. The apparent "distinctness" is an artifact of two separately-built UIs (a study-catalog view built for Materials, a stock-management view built for Inventory) that were never reconciled, not evidence of two real underlying business concepts.

**Are materials still a real local source of truth?**
Only for `teacher`/`description`/`addedAt`, and only transiently — as shown in §1, these values do not actually survive a save today. For every other field, Postgres (via `inv_materials`) is already the real source of truth for anything created through MaterialsPage; it is simply not being *read back* by MaterialsPage (no boot-sync), which is a caching bug, not a source-of-truth question. For anything created through Inventory's own UI, the local browser genuinely is the only copy that exists — but this is a defect (§2, Headline Finding), not a legitimate permanent state.

**Is `inv_materials` already the correct PostgreSQL source?**
For the fields it already has (`code/name/subject/grade/price/cost/min_stock/status/barcode`) — yes, structurally correct and already load-bearing for real FK relationships. It is **not yet fully authoritative in practice** because half of the app's own write surface (Inventory's UI) doesn't route through it at all.

**Is a schema change actually necessary?**
Not to fix the more severe problem (Inventory's fake writes, the undistributable-material bug) — that's purely a frontend wiring fix (Option E), zero schema change. A schema change (Option B) is only necessary if the product decision is that `teacher`/`description`/`addedAt` are worth preserving as real, permanent content rather than accepting their current (already-live) loss.

**What is the smallest safe implementation?**
Not proposed for execution here (this is a decision audit only), but the evidence points at **Option E first** (wire Inventory's own create/update/delete/transactions onto the existing, already-tested `pgCreateMaterial`/`pgUpdateMaterial`/`pgDeleteMaterial` pattern, plus a new inventory-transaction write function following the same server-truth-first pattern already proven by `MaterialDistribution.jsx`) as the lowest-risk step that removes the one confirmed *functional* break, followed by a **separate, explicit product decision** on `teacher`/`description`/`addedAt` (Option A if disposable, Option B if not) before touching `MaterialsPage.jsx`'s boot-sync gap.

**What should NOT be changed?**
- `MaterialDistribution.jsx` / `backend/src/routes/materialDistribution.js` (Phase 3B-12) — already correct, atomic, idempotent, well-tested; nothing in this audit's findings implicates it.
- The generic CRUD mechanism (`crud.js`) itself, or its "unknown field → silently ignored" behavior — that behavior is correct and shared by every other collection; the problem is which fields are or aren't in the allowlist for this one collection, not the mechanism.
- `matDist`'s `legacy_metadata` JSONB approach for `payStatus`/`paidAmount`/`receivedAt` — already a deliberate, documented, working design (Phase 3B-12), unrelated to the `teacher`/`description`/`addedAt` question.
- Teachers domain, per instruction — confirmed in §4 that there is no real coupling between "materials" and the `teachers` table to begin with; `teacher` is a free-text label, not a foreign key.

---

**No code, schema, database, or localStorage was modified to produce this report. Stopping here — nothing above has been implemented.**
