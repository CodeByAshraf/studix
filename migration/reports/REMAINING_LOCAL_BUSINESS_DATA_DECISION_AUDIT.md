# Remaining Local Business-Data — Decision Audit

**Status: READ-ONLY.** No code, schema, database, or localStorage was modified to produce this report. Every claim below was re-derived this session by direct file reads, greps, and one read-only Prisma `count()`/`findMany()` query against the live `studix` database (no writes). Nothing here is authorized or implemented. Phase 3B-16 has not started. Teachers is not touched.

Scope: only the five areas requested — `materials`, `parentExtras`, `MOCK_GROUPS`, `tc_center_profile`, `studix_autobackup`. `matDist` and `treasuryMeta` are explicitly out of scope for this report (already scoped elsewhere / already dead per the baseline audit) and are not re-analyzed here.

**Headline correction to the baseline audit:** `FINAL_LOCAL_PERSISTENCE_AUDIT.md` states `materials` has "**zero** Postgres backing of any kind" and "never touches the network at all." That is no longer accurate. Direct tracing this session found `MaterialsPage.jsx` already calls `pgCreateMaterial`/`pgUpdateMaterial`/`pgDeleteMaterial` (`src/services/api.js:837-887`), which write to the real `POST/PUT/DELETE /api/invMaterials` route — the same backend route and the same `inv_materials` Postgres table used by the Inventory module. The code carries explicit "Phase 3B-11" comments documenting this wiring as already done. This is a materially different (and more complicated) situation than "no backend exists" — see §A below.

---

## A) MATERIALS

### Current State

There are **two separate local Zustand keys** that both ultimately write to **one shared Postgres table** (`inv_materials`), through **one shared backend route** (`/api/invMaterials`), but the two frontend modules disagree on what fields that entity has, and only one of the two keys is ever refreshed from the server.

| | `materials` (Study-Materials module) | `invMaterials` (Inventory module) |
|---|---|---|
| Slice | `src/store/slices/materials.slice.js` | `src/store/slices/inventory.slice.js` |
| Local shape (`materialService.js` / `inventoryService.js`) | `id, name, subject, teacher, grade, price, description, addedAt, createdAt` | `id, code, name, subject, grade, academicYear, edition, sellingPrice, printingCost, minStock, status, barcode, notes, createdAt, updatedAt` |
| Write path | `pgCreateMaterial`/`pgUpdateMaterial`/`pgDeleteMaterial` → `POST/PUT/DELETE /api/invMaterials` (`MaterialsPage.jsx:99,107,128`) | Same route, via `InventoryPage.jsx` (not re-traced here; already CACHE_ONLY per baseline audit) |
| Boot-synced from Postgres on load? | **No** — `materials` is absent from `db.middleware.js`'s `PG_COLLECTIONS` array (`db.middleware.js:21-27` lists `invMaterials`, not `materials`) | **Yes** — `invMaterials` is in `PG_COLLECTIONS` |
| Consumers | `MaterialsPage.jsx`, `MaterialReports.jsx`, `PaymentForm.jsx`, `StudentReportPage.jsx`, `AdmissionsPage.jsx` (`realMaterials = s.materials`) — confirmed by grep, all five read `s.materials` | `InventoryPage.jsx` only, reads `s.invMaterials` |

### Evidence

- Backend model `inv_materials` (`backend/prisma/schema.prisma:316-331`) has exactly: `id, code, name, subject, grade, price, cost, min_stock, status, barcode, created_at`. No `teacher`, `description`, `addedAt`/`assignedDate`, `academicYear`, `edition`, or `updated_at` column exists.
- `src/services/api.js:797-813` (`buildMaterialRequestBody`) sends **only** `name, subject, grade, price[, code]` to the server. The comment there is explicit and predates this audit: *"teacher/description/addedAt لا عمود لها إطلاقاً (تأكّدنا من migration/mapping/fieldMaps.js أن هذا استبعاد مقصود في تصميم الهجرة الأصلي، لا نقصاً يُصلَح)"* — "teacher/description/addedAt have no column at all; we confirmed via `migration/mapping/fieldMaps.js` this is a **deliberate exclusion in the original migration design, not a gap to fix**." So `teacher`, `description`, and the user-entered `addedAt` are, by an already-made decision, permanently local-only unless that decision is revisited.
- Live, read-only query this session (`backend`, Prisma `count()`): `inv_materials` has **1 row** today (`code: "V3B12-VERIFY"`, `name: "Verify Material"`, created 2026-08-19) — a leftover verification artifact from the Phase 3B-12 work, not real usage, structurally identical to the two "Verify Student" rows the baseline audit found in `students`.
- Both modules independently compute the next `MAT-XXXXXX` code from their own local array: `MaterialsPage.jsx:19-27` (`nextMatCode`) vs. `inventoryService.js:26-28` (`nextMaterialCode`) using the same prefix (`MATERIAL_CODE_PREFIX = 'MAT'`, `inventory/constants.js:59`) and same 6-digit pad (`NUMBER_PAD = 6`, `inventory/constants.js:61`) against the same unique `code` column. `MaterialsPage.jsx:107-115` already has a defensive one-shot retry on a 409 code conflict that re-fetches `pgGetCollection('invMaterials')` to compute a fresh code — evidence the collision risk between the two modules writing to the same table was anticipated, at least for this one failure mode.
- Because `materials` is never boot-synced (unlike `invMaterials`), a material created through the **Inventory** module (or through Materials on a different browser) is invisible to the Materials module until a user creates/edits something there in that same browser session — the Materials catalog view has no read-refresh mechanism at all, a gap none of the other 23 "correct cache" domains in the baseline audit share.

### Business Impact

`materials` (the catalog UI) is a real, actively used domain: naming, pricing, and distribution-tracking of study booklets sold to students, feeding `MaterialDistribution.jsx`, `MaterialReports.jsx`, revenue KPIs, admissions intake, payment forms, and student reports. It is not vestigial or demo data.

### Data Integrity Risk

**High**, but different in kind from what the baseline audit described:
- Not "no server copy exists" — a server copy exists but is a **narrower slice of the same row** than what the local UI displays (missing `teacher`/`description`/user-entered `addedAt`).
- Two UIs write to and read from one table with incompatible mental models (a study-materials catalog vs. a stock/inventory item), with no boot-sync on one side. A fresh browser (or a cleared `studix-v1`) sees Postgres's `invMaterials` correctly in the Inventory tab but sees an **empty** Materials catalog even if rows already exist in `inv_materials` server-side.
- If a material is edited from the Inventory module (e.g. price changed there), the Materials-module local cache would not know until a local materials-list mutation happens to trigger a network round trip that includes that row — silent staleness, not data loss.

### Dependencies

`MaterialDistribution.jsx`/`matDist` (out of scope here, already flagged in the baseline audit as a separate "write-real/read-stale" issue) is layered on top of whichever `materials` array the Materials module currently holds locally — so any fix to `materials` boot-sync also changes what `matDist`'s stats compute against.

### Recommended Direction: **INVESTIGATE**

This is not a "build the missing backend" task — the backend, route, and partial schema already exist and are already wired (Phase 3B-11). What is missing is a **product/architecture decision**, not a mechanical migration:
1. Are "study-materials catalog" and "inventory stock item" the *same* entity going forward (one shared table, reconcile the field sets, add `teacher`/`description`/`addedAt` columns to `inv_materials`, give Materials module the same boot-sync treatment as Inventory)? — or
2. Are they *deliberately distinct* concepts that happen to share a table today by convenience, and should be split into two real tables?

Only after that decision is made does it become a normal "add columns / wire boot-sync" implementation task. Building a new schema now, before that decision, risks building the wrong one.

### Confidence: High (direct code + schema + live-row tracing; the only uncertainty is the product intent behind Phase 3B-11's field split, which this audit cannot resolve from code alone)

---

## B) PARENT EXTRAS

### Current State

`parentExtras` is a local `{ [key]: { altPhone, notes, preferredMethod, preferredTime, studentIds, admissionIds } }` map (`communication.slice.js:18,51-54`), where `key` is **not** a real parent ID — it's `parentKey(record) = record.phone?.trim() || record.parentName?.trim()` (`parentService.js:11-13`), computed per-`communications`-record. `CommunicationPage.jsx` never queries a `parents` collection at all; it derives a synthetic parent list from `communications` (`deriveParents`, `parentService.js:18-55`) and layers `parentExtras` on top by that synthetic key.

### Evidence

- Real Postgres `parents` table (`backend/prisma/schema.prisma:371-384`) already has exactly the four fields in question — `alt_phone`, `preferred_method`, `preferred_time`, `notes` — plus `id (BigInt, autoincrement)`, `full_name`, `phone (String, @unique)`, `created_at`, `updated_at`, and real FK relations to `admissions`, `communications`, and `students`.
- `parents` **is already in `COLLECTION_MODELS`** (`backend/src/routes/collections.js:15`) and **is already fully writable**: `backend/src/server.js:54` defines `READ_ONLY_COLLECTIONS = new Set(['payments', 'admissionPayments'])` — `parents` is not in it, so the generic CRUD router (`crud.js`) serves full `GET/POST/PUT/PATCH/DELETE /api/parents[/:id]`, gated by `requirePermission('students')` (`server.js:62-65`, explicitly noted as an intentional exception — parents has no dedicated page/permission of its own, mapped onto the Students permission by an already-made decision).
- `parents` **is already in `PG_COLLECTIONS`** (`db.middleware.js:22`), meaning it is already boot-synced (merged) into the Zustand runtime state on every app load whenever the server returns at least one row — but:
  - `parents` is **absent from `app.store.js`'s `partialize`** (`app.store.js:89-120`) — the boot-synced value never survives a page refresh via `studix-v1`; each reload starts the runtime `state.parents` fresh from whatever Postgres returns (or from nothing, if Postgres has 0 rows or the merge never ran).
  - **Zero consumers anywhere.** Full-tree grep for `state.parents`/`s.parents`/`.parents` (excluding `parentExtras`/`parentService`/unrelated matches) returned no results. The `parents` collection is fetched, merged into runtime state, and then read by nothing in the entire frontend.
- Live, read-only query this session: `parents` table currently has **0 rows**. `communications` has **1 row**, a `__test__` verification artifact (`parent_id: null`) — meaning `communications.parent_id`, a real FK column, has never been populated by the app either.
- `CommunicationPage.jsx:36,39,49,145` — `parentExtras`, `updateParentExtra`, and `deriveParents(records, parentExtras)` are the entire read/write surface; `ParentEditModal.jsx:11-16` is the only editor, editing exactly `altPhone/preferredMethod/preferredTime/notes` and nothing else (no `full_name`, no real parent id).

### Business Impact

Medium — a genuine, actively-edited feature (parent contact preferences/notes in the Communication module), but small in surface area (four fields, one modal) and non-financial.

### Data Integrity Risk

Medium-High, unchanged from the baseline audit's characterization, but now more precisely bounded: the local data isn't just "unreconciled with an empty table" — it's unreconciled with a table that **already has a route ready to receive it**, so every day this stays local is a day of avoidable divergence once real parent data starts flowing in from Admissions/Students, which do already write to `parents`-adjacent tables (`admissions`, `students`) that FK to `parents`.

### Dependencies

The `deriveParents` synthetic-key scheme is the actual blocker for a clean 1:1 migration, not the schema:
- Real `parents.phone` is `@unique` — a phone-keyed local record maps cleanly to a real row by `phone` (find-or-create).
- But `parentKey()` falls back to `parentName` when a communication record has no phone — a name is not unique in `parents`, so a name-only-keyed local "parent" has **no safe deterministic match** against the real table. Any migration path has to decide what happens to these (skip them, prompt for a phone, or accept ambiguous matching).

### Recommended Direction: **REPLACE_WITH_EXISTING_POSTGRES**

The Postgres target is not just "exists" but already fully writable with permissions wired — this is the cleanest of the five areas. The smallest safe path, as evidence, not as an implementation instruction: for each derived parent with a `phone`, find-or-create the matching `parents` row via the existing `/api/parents` route, read/write `alt_phone/preferred_method/preferred_time/notes` there instead of in `parentExtras`, and decide explicitly (a product call, not a technical one) what happens to name-only-keyed parents that have no phone to match on.

### Confidence: High

---

## C) MOCK_GROUPS

### Current State

`MOCK_GROUPS = ['مجموعة السبت والثلاثاء', 'مجموعة الأحد والأربعاء', 'مجموعة الجمعة']` (`src/modules/admissions/mockData.js:73`) — three hardcoded Arabic strings, used only as the **intake-stage** free-text `group` field: the default value for a new lead (`AdmissionsPage.jsx:564`) and the `<select>` options at intake (`AdmissionsPage.jsx:399,600`). It is filterable (`AdmissionsPage.jsx:128`) and displayed read-only later (`:630,845,917`).

### Evidence

- The **real** group-linking flow already exists, independently, in the same file, and is already correctly wired to live Postgres data: `realGroups = useAppStore((s) => s.groups)` (`AdmissionsPage.jsx:94`) is passed into a group-confirmation UI (`groups={realGroups}` at `:435`; `ConfirmGroupModal`-style component `:1081-1136`), and confirming a reservation sets `confirmedGroupId: groupId` (`:176`) by looking up `realGroups.find(g => g.id === groupId)` (`:171,204`). This is the field that actually drives the "طالب نشط" (active student) transition (`:215-216`, sets `grade`/`groupId` from the real group).
- `groups` is in `PG_COLLECTIONS` (boot-synced), in `COLLECTION_MODELS`, and writable (not in `READ_ONLY_COLLECTIONS`) — already CACHE_ONLY per the baseline audit, reconfirmed here, not re-derived from scratch.
- Live, read-only query this session: `groups` has **0 rows** today — unchanged from the baseline audit.

### Business Impact

Low. `MOCK_GROUPS` only labels an informal "which schedule slot is this lead interested in" note captured at first contact — it does not gate enrollment, billing, or attendance. It never affects any real business operation; the real group linkage (which does) is the separate, already-correct `confirmedGroupId`/`realGroups` path.

### Data Integrity Risk

Low. Because it's free text disconnected from `groups.id`, there's no FK integrity to violate. The only "risk" is cosmetic mismatch between the intake note and the eventually-confirmed real group — which is presumably normal (a lead's stated interest can differ from what they're actually placed into).

### Dependencies

None beyond `groups` itself having real rows — this is a data-availability blocker, not a code blocker.

### Recommended Direction: **DEFER**

Mechanically, swapping `MOCK_GROUPS` for `realGroups.map(g => g.name)` (or similar) is a same-file, low-risk change — `realGroups` is already in scope in this exact component. It is not done today because `groups` has zero real rows, so the swap would currently just produce an empty dropdown; this is precisely the pre-existing call already recorded in the baseline audit (§12) — reconfirmed, not new. The safe target (`REPLACE_WITH_EXISTING_POSTGRES`) is clear whenever `groups` has real usage; until then, deferring is the correct action, not a gap.

### Confidence: High

---

## D) tc_center_profile

### Current State

`tc_center_profile` and `studix-v1`'s own `centerProfile` field are **always written together, from a single code path** — not two independent writers as "dual persistence" might suggest.

### Evidence

- `centerProfile.slice.js:19-29` — the **only** action that ever changes center-profile data, `setCenterProfile`, does two things atomically in one call: `storage.set('tc_center_profile', next)` **and** `return { centerProfile: next }` (which Zustand's `persist` middleware then writes into `studix-v1` via `partialize`, `app.store.js:112`).
- The slice's **initial** value is read from `tc_center_profile` directly (`storage.get(STORAGE_KEY, DEFAULT_PROFILE)`, `centerProfile.slice.js:20`) — i.e., on first module evaluation, before Zustand's own `persist` rehydration of `studix-v1` has necessarily applied. Because both keys are always kept equal by the single writer above, this ordering has not been observed to produce a visible mismatch, but it means `tc_center_profile` is structurally the *first* value read, not a redundant afterthought.
- Grep of every reader in the codebase (`PrintHeader.jsx:9`, `AdmissionsPage.jsx:102`, `AttendanceReports.jsx:372`, `ExamReports.jsx:280`, `PaymentReceipt.jsx:16`, `PaymentReports.jsx:66`, `StudentReportPage.jsx:160`, `SettingsPage.jsx:56`) — **every single reader reads `state.centerProfile` (the Zustand/`studix-v1` copy), never `tc_center_profile` directly.** The standalone key has exactly one writer and effectively one reader (the slice's own initializer) in the entire codebase.
- `SettingsPage.jsx:120` — the only place a user actually edits this data — calls `setCenterProfile({ ...saved, slogan: draft.slogan })` after a successful `pgUpdateCenterProfile` (PUT `/api/centerProfile`), confirming Postgres is already the write target for every field except `slogan` (by an already-documented, deliberate design: `slogan` has no DB column, `mergeCenterProfileSingleton`, `db.middleware.js:200-213`, always preserves the local value).

### Business Impact

Low. Print-header/report cosmetic data only (center name, address, phones, logo, slogan).

### Data Integrity Risk

Low-Medium, unchanged conclusion from the baseline audit, but now backed by a concrete mechanism: the two copies cannot currently diverge because they share one writer. The only residual risk is the read-before-rehydration ordering noted above, which has no observed failure mode.

### Dependencies

None beyond a small code change to `centerProfile.slice.js` (removing the `storage.get`/`storage.set` calls) — not proposed or made here.

### Recommended Direction: **REMOVE_LEGACY**

The standalone key has no reader other than its own initializer and is provably always in sync with `studix-v1`'s copy by construction. It is safe to retire once `centerProfile.slice.js`'s initializer is changed to no longer depend on it being present on first load (a small, separate code change — not made in this audit).

### Confidence: High

---

## E) studix_autobackup

### Current State

Confirmed write-only, exactly as the baseline audit found, with additional supporting evidence this session.

### Evidence

- Single writer: `app.store.js:69-84` (`saveAutoBackup`), triggered exactly once per app load from `data.context.jsx:12-15` (`useEffect` with `[]` deps on `DataProvider` mount) — captures `{students, groups, payments, attendance, exams, grades}` from whatever the current in-memory state is at that moment and overwrites `studix_autobackup` unconditionally.
- Full-tree grep for `studix_autobackup` (case-sensitive) and `autobackup`/`autoBackup`/`restoreBackup`/`importBackup` (case-insensitive) found **zero** readers anywhere in `src/`.
- A second, distinct, and equally dead naming attempt for what looks like the same intended feature exists: `src/config/app.config.js:58` defines `STORAGE_KEYS.AUTOBACKUP = 'tc_autobackup_v2'` — a different key name, imported nowhere, referenced nowhere else. This confirms an auto-backup/restore feature was iterated on at least twice (`studix_autobackup`, then a `_v2` naming attempt) but a **restore/import consumer was never built for either version** — this is not a recent oversight, it's a feature that was scaffolded twice and completed neither time.

### Business Impact

None currently — it has never been read by anything, so it provides no operational value today, only a manual-DevTools-recovery possibility that has apparently never been exercised (no code depends on it).

### Data Integrity Risk

None. Removing the write would not lose any functionality that currently exists, since nothing consumes the data.

### Dependencies

None.

### Recommended Direction: **REMOVE_LEGACY**

Genuinely inert: write-only, zero consumers, and the existence of an abandoned `_v2` naming attempt reinforces that this was never wired to a restore path, not that a restore path is imminent.

### Confidence: High

---

## Decision Table

| Area | Is it business data? | PG target exists? | Current source of truth | Risk | Recommended action | Blocking? |
|---|---|---|---|---|---|---|
| `materials` | Yes | Partially — `inv_materials` exists and is already wired for `name/subject/grade/price`, but has no column for `teacher/description/addedAt` (deliberately excluded by prior design) | Split — Postgres for the 4 shared fields, local-only for 3 fields, and local-only entirely for boot-sync (no read-refresh) | High | INVESTIGATE | **Yes** — an architecture decision (same entity as Inventory, or genuinely distinct?) blocks any correct implementation |
| `parentExtras` | Yes | Yes — `parents.alt_phone/preferred_method/preferred_time/notes`, fully writable, already boot-synced (unused) | Local (`parentExtras` map, keyed by phone/name, not by a real parent id) | Medium-High | REPLACE_WITH_EXISTING_POSTGRES | Soft — a parent-identity-matching decision (phone-keyed find-or-create; name-only fallback has no clean match) should precede implementation, but no schema work is needed |
| `MOCK_GROUPS` | No (UI label data only — the real linkage is `confirmedGroupId`/`realGroups`, already correct) | Yes — `groups` table, already boot-synced, writable, already used elsewhere in the same component | Hardcoded array | Low | DEFER | No — already a made call, blocked only by `groups` having 0 real rows, not by anything technical |
| `tc_center_profile` | No (config/print data, not business records) | Yes — `center_profile` singleton, already the write target via `SettingsPage.jsx` | `studix-v1`'s `centerProfile` (the two keys cannot currently diverge — single writer) | Low | REMOVE_LEGACY | No |
| `studix_autobackup` | No (dead diagnostic snapshot) | N/A | N/A — write-only, zero consumers | None | REMOVE_LEGACY | No |

---

## Answers

**1. What is the actual remaining business-data migration scope?**
Two genuine business-data items, not five: `materials` (needs an architecture decision before any schema/wiring work, since it turns out to already be partially migrated and table-sharing with Inventory — the prior audit's premise that this was a from-scratch migration is now known to be wrong) and `parentExtras` (needs frontend wiring plus a parent-identity-matching decision; no schema work). `MOCK_GROUPS`, `tc_center_profile`, and `studix_autobackup` are not business-data migration items at all — they are UI-label cleanup, a redundant-but-safe local key, and dead diagnostic code, respectively.

**2. What can be cleaned up without a database migration?**
`studix_autobackup`'s write call (zero consumers, confirmed twice-abandoned as a feature), `tc_center_profile`'s duplicate persistence path (provably always in sync with `studix-v1`, single writer), and, as a minor bonus finding, the dead `STORAGE_KEYS.AUTOBACKUP = 'tc_autobackup_v2'` constant in `app.config.js` (imported nowhere).

**3. What requires existing PostgreSQL wiring only (no schema changes)?**
`parentExtras` — the real `/api/parents` route already exists, is already writable, and already has the exact four columns needed; only `CommunicationPage.jsx`'s read/write path and a parent-matching strategy are missing. `MOCK_GROUPS` — `realGroups` is already fetched and writable in the very same file; only a data-source swap is needed, deferred solely on real `groups` data existing. `materials`'s four shared fields (`name/subject/grade/price`) are already wired (Phase 3B-11) — only the boot-sync/read-refresh gap remains wiring-only.

**4. What genuinely requires a schema decision?**
Only one thing in this whole audit: `materials`'s `teacher`, `description`, and user-entered `addedAt` fields. A previous, documented decision deliberately excluded them from `inv_materials`. Whether that decision still holds, or whether these fields should be added to the schema (or the two modules split into genuinely separate tables), is a real, unresolved product/architecture question — not an implementation task.

**5. What should remain deferred?**
`MOCK_GROUPS` → real-`groups` swap, exactly as the baseline audit already concluded (§12), reconfirmed unchanged: blocked on `groups` having real rows, not on anything technical. Teachers remains untouched and out of scope, per instruction.

**6. After resolving these items, what percentage of the business-data layer would genuinely be PostgreSQL-authoritative?**
Using the baseline audit's own frame (23 of 27 `studix-v1` keys already CACHE_ONLY, i.e. ~85%): fully resolving `parentExtras` (wiring-only, no schema blocker) would bring that to 24/27 (~89%). `materials` cannot be counted as "resolved" until the architecture question in §A is answered — but if the answer confirms the already-documented Phase 3B-11 design (shared table, `teacher/description/addedAt` permanently local-only by choice) and only the boot-sync gap is fixed, `materials` could reasonably join the "correctly cache-backed" set too, reaching 25/27 (~93%). That 93% ceiling excludes `matDist` and `treasuryMeta`, which are outside this report's scope and remain open per the baseline audit. `MOCK_GROUPS`, `tc_center_profile`, and `studix_autobackup` sit outside the 27-key `studix-v1` count entirely and do not move this percentage regardless of how they're resolved.

---

**No code, schema, database, or localStorage was modified to produce this report. Stopping here per instruction — nothing above has been implemented.**
