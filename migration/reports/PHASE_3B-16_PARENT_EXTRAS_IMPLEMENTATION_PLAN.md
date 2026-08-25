# Phase 3B-16 — `parentExtras` → Real `parents` — Implementation Plan

**Status: READ-ONLY.** No code, schema, database, localStorage, or configuration was modified to produce this report. Nothing here is authorized or implemented. Materials remains CLOSED and untouched. Teachers, `matDist`, `MOCK_GROUPS`, `admissionSystemLog`/`wa_report_log`, and session-invalidation were not touched and are not implicated by anything below.

---

## 1. Every reader and writer of `parentExtras` — exhaustive, fresh trace

| Site | Role |
|---|---|
| `src/store/slices/communication.slice.js:18` | State definition: `parentExtras: {}` |
| `src/store/slices/communication.slice.js:51-54` | Sole writer: `updateParentExtra(key, updates)` — `set(s => ({ parentExtras: { ...s.parentExtras, [key]: { ...(s.parentExtras[key]||{}), ...updates } } }))` |
| `src/modules/communication/CommunicationPage.jsx:36` | Reads `s.parentExtras` |
| `src/modules/communication/CommunicationPage.jsx:39` | Reads `s.updateParentExtra` |
| `src/modules/communication/CommunicationPage.jsx:49` | `deriveParents(records, parentExtras)` — only place the two are combined |
| `src/modules/communication/CommunicationPage.jsx:144-148` | `handleSaveParent(data) { updateParentExtra(selectedParentKey, data); ... }` — the **only** writer call site in the entire app |
| `src/modules/communication/parentService.js:18,42` | `deriveParents(records, parentExtras)` reads `parentExtras[p.key]` to merge `altPhone/notes/preferredMethod/preferredTime/studentIds/admissionIds` onto each derived parent |
| `src/store/app.store.js:105` | `partialize`: `parentExtras: state.parentExtras` (persisted to `localStorage['studix-v1']`) |
| `src/modules/communication/CommunicationPage.test.jsx:32` | Seeds `parentExtras: {}` in `useAppStore.setState` (no assertions exercise it — no existing test covers the save flow at all) |

**No other file in the entire project references `parentExtras` or `updateParentExtra`** (confirmed by a project-wide grep this session). This is a small, fully self-contained surface — 5 source files, 1 test file.

---

## 2. Exact existing PostgreSQL `parents` route/service and schema — fresh trace

**Schema** (`backend/prisma/schema.prisma:371-384`):
```prisma
model parents {
  id               BigInt   @id @default(autoincrement())
  full_name        String?
  phone            String?  @unique
  alt_phone        String?
  preferred_method String?
  preferred_time   String?
  notes            String?
  created_at       DateTime @default(now()) @db.Timestamptz(6)
  updated_at       DateTime @default(now()) @db.Timestamptz(6)
  admissions       admissions[]
  communications   communications[]
  students         students[]
}
```
No `Decimal` or `@db.Date` fields — unlike the Materials work, **no response normalization is needed anywhere** for this domain.

**Route**: generic CRUD (`backend/src/routes/crud.js`) mounted at `/api/parents`. Confirmed fresh: `parents` is in `COLLECTION_MODELS` (`collections.js:15`), is **not** in `READ_ONLY_COLLECTIONS = new Set(['payments','admissionPayments'])`, so full `GET/POST/PUT/PATCH/DELETE` are live. Gated by `requirePermission('students')` (`server.js:62-65,79` — a deliberate, pre-existing, already-approved mapping: *"parents لا صفحة مخصّصة لها — تُربَط بصلاحية 'students'"*). `parents` is **not** in `PRESERVE_CLIENT_ID_COLLECTIONS` (`server.js:101`), so the server always assigns its own `BigInt` id on create — the frontend can never set one.

**Permission consistency check (new this audit):** `CommunicationPage.jsx` already calls `pgCreateCommunication`/`pgCreateCommTask`, and `communications`/`commTasks` are **also** gated by `'students'` (`server.js:86-87`), not a `'communication'`-named permission. Any user who can already use the Communication page today already has `'students'`. **No new permission gap is introduced by gating parent-writes the same way.**

**No filtering support on `GET /api/parents`** — `crud.js`'s `GET /` handler (`model.findMany({ take, skip })`) has no `where` clause at all. There is no server-side "find by phone" endpoint. See §5 for how this is handled without a backend change.

**Boot-sync**: `parents` is already in `db.middleware.js`'s `PG_COLLECTIONS` (line 22) — fetched and merged into `state.parents` on every load whenever the backend returns at least one row. It is **currently absent from `app.store.js`'s `partialize`**, so it is never persisted locally and currently has **zero consumers anywhere** (re-confirmed by grep this session — no file reads `state.parents`).

**Live re-verification this session:** `parents.count()` → `0`. `communications.count()` → `1` (the pre-existing `__test__` verification row, `parent_id: null`). Nothing has changed since the prior audits.

---

## 3. Exact frontend files that must change

| File | Change |
|---|---|
| `src/services/api.js` | Add `pgCreateParent`/`pgUpdateParent` (new — none of the parent-write functions exist yet) |
| `src/modules/communication/parentService.js` | Add phone normalization; rewrite `deriveParents`'s second parameter from the `parentExtras` map to the real `parents` array, matched by normalized phone |
| `src/modules/communication/CommunicationPage.jsx` | Read `s.parents` instead of `s.parentExtras`; remove `updateParentExtra` usage; rewrite `handleSaveParent` as an async, server-truth-first find-or-create-or-update |
| `src/store/slices/communication.slice.js` | Remove `parentExtras` state and `updateParentExtra` action entirely (not deprecated-in-place — see §7) |
| `src/store/app.store.js` | Remove `parentExtras` from `partialize`; add `parents` (see §7, flagged as a proposed addition) |
| `src/modules/communication/components/ParentEditModal.jsx` | Add a `loading` prop to disable the Save button during the new async round trip (small, precedented UX addition — every other async-ified save modal in this app already does this) |
| `src/modules/communication/CommunicationPage.test.jsx` | Seed key `parentExtras: {}` → `parents: []` |
| New: `src/modules/communication/CommunicationPage.parentExtras.test.jsx` | New test file — no existing test exercises this save flow at all today |

**No backend file needs to change.** No schema change. No new table. No new column.

---

## 4. Field mapping

| Local (`ParentEditModal.jsx` form / derived parent) | Real `parents` column | Notes |
|---|---|---|
| `altPhone` | `alt_phone` → `altPhone` (standard camelCase conversion) | 1:1, no rename needed anywhere in the frontend |
| `preferredMethod` | `preferred_method` → `preferredMethod` | 1:1 |
| `preferredTime` | `preferred_time` → `preferredTime` | 1:1 |
| `notes` | `notes` | 1:1 |
| `parentName` (derived, read-only in the modal) | `full_name` → `fullName` | Only ever set on **create** (find-or-create), from the already-derived synthetic name — the modal never lets a user edit this |
| `phone` (derived, read-only in the modal) | `phone` (unique) | Only ever set on **create**, from the normalized phone — the modal never lets a user edit this |
| `studentIds`/`admissionIds` (derived, always `[]` today) | *(no column)* | Confirmed by grep: set but **never read** anywhere in the app. Kept as always-`[]` pass-through — removing them would be an unrequested cleanup beyond this phase's scope |

This mapping is unusually clean: **the local field names already match the real column names 1:1** (via standard camelCase conversion) — unlike Materials, no `sellingPrice`-style rename is needed anywhere.

---

## 5. The one real design problem: matching a derived parent to a real `parents` row

`parentKey(record) = record.phone || record.parentName` (`parentService.js:11-13`) — the local grouping key is either a **raw** phone (e.g. `01012345678`) or, if no phone exists, a bare name. The real `parents.phone` column, per the project's own established convention (`migration/mapping/normalizePhone.js`, and an identical, independently-duplicated implementation already inside `src/modules/student-report/studentWhatsappService.js:49-60` — the same 12-line algorithm exists twice already in this codebase, confirming it as a stable, correct, precedented pattern, not something to invent), expects the **normalized international format** `201xxxxxxxxx`. Matching or creating a real row therefore requires normalizing the phone first.

**Two sub-cases, both real and both require a decision (§8):**
1. **A derived parent has a phone that normalizes successfully.** Look it up in the already-boot-synced `state.parents` array (client-side, by normalized phone — no backend filter needed). If found, its `id` is used for `pgUpdateParent`. If not found, `pgCreateParent({ phone: normalized, fullName: parentName, ...4 fields })` is called. Because two browsers could both attempt to create the same phone at nearly the same time, and `phone` is `@unique`, a `409` is possible — handled by the same retry-once pattern already established and tested for `communications.number`/`inv_materials.code` (`pgCreateCommunication`/`pgCreateMaterial`'s `computeNext*` callback): on a 409 whose `field` includes `phone`, re-fetch `pgGetCollection('parents')`, find the row that now has this phone, and retry as a **PUT** instead of a second POST.
2. **A derived parent has no phone at all (name-only key), or the phone doesn't normalize** (any format `normalizePhone` rejects — same rule the original migration script already uses: *"رقم غير صالح → null (لا نبني parent وهمي)"*, "invalid number → null, don't build a fake parent"). There is **no safe, deterministic way to create or match a real `parents` row** for this case — a name is not unique, and an unnormalizable phone isn't a real identifier either. **This is a genuine gap this plan cannot silently resolve — see Decision Needed #1.**

---

## 6. Confirmed: the existing `parents` API already supports everything required

Full CRUD, all 4 target columns real and writable, permission-consistent with the page that already uses it, no schema gap. The **only** thing "missing" is a server-side phone-filter query — and §5 shows this is fully solvable client-side using data the app already boot-syncs, with a conflict-retry safety net matching an already-proven pattern elsewhere in the codebase. **No backend change of any kind is required.**

---

## 7. Ambiguities — confirmed resolutions and one open Decision Needed

Per your approval message, most of the ambiguities flagged in the pre-implementation audit are now resolved by your explicit instructions:
- *"Do NOT create duplicate parentExtras storage"* → resolved: `parentExtras`/`updateParentExtra` are **removed**, not left inert (unlike Materials' `addInvMaterial` etc., which were kept-but-unused; here your wording is more direct about eliminating the duplicate, so this plan proposes deletion).
- *"PostgreSQL remains the sole source of truth"* + *"Use the existing backend parents route/service where possible"* → resolved: no new backend code.
- *"Do NOT migrate/recover old localStorage data"* → resolved: whatever is in any browser's existing `parentExtras` is left exactly where it is, untouched, and simply stops being read once this ships. Nothing reaches into `localStorage` to move it anywhere.

**One new, small, flagged (not silently decided) proposal:** adding `parents: state.parents` to `app.store.js`'s `partialize`. This is not explicitly requested, but it is the same caching pattern every other PG-backed collection in this app already uses (boot-sync + local cache + `mergeById` on next load), and without it, `state.parents` would be re-fetched from an empty local array on every page load with no offline-resilience — inconsistent with how every other domain behaves. Flagged here for your explicit yes/no rather than assumed.

**Decision Needed #1 (the one real open question):** what should happen when a user opens "Edit Parent" for a derived parent with no phone, or a phone that fails normalization? Three options, presented without a default assumed:
- (a) Disable the Save button in `ParentEditModal.jsx` with an inline message explaining a valid phone is required to persist these fields to Postgres.
- (b) Allow editing but keep it purely local/ephemeral for this one case (would partially reintroduce the "duplicate storage" pattern you asked to eliminate — likely not desired, named only for completeness).
- (c) Something else you specify.

This plan's implementation section below assumes **(a)** as the most consistent option with "PostgreSQL remains the sole source of truth" and "do NOT create duplicate storage," but does **not** implement it without your confirmation.

**Explicitly out of scope, not touched by this plan, named so it isn't silently assumed either way:** populating `students.parent_id`/`admissions.parent_id`/`communications.parent_id` (all real, pre-existing nullable FKs to `parents.id`, currently unpopulated everywhere). Wiring these would mean reconciling phone-matching across three additional tables — a materially larger, separate migration, not required to persist the 4 target fields (matching happens purely by `phone`, independent of these FKs). No proven dependency makes this unavoidable for the stated scope.

---

## 8. Implementation plan (pending your approval)

### `src/modules/communication/parentService.js`
Add (duplicating the already-twice-proven algorithm, consistent with how it already exists independently in `studentWhatsappService.js` rather than as a shared util):
```js
function normalizeParentPhone(phone) {
  if (!phone) return null;
  let p = String(phone).replace(/[\s\-()]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('00')) p = p.slice(2);
  if (/^01[0-9]{9}$/.test(p)) return '20' + p.slice(1);
  if (/^201[0-9]{9}$/.test(p)) return p;
  return null;
}
export { normalizeParentPhone };
```
Rewrite `deriveParents(records, realParents = [])`: build the synthetic list exactly as today (unchanged), then for each derived parent compute `normalizeParentPhone(p.phone)` and look it up in a `Map` built once from `realParents` (keyed by `normalizeParentPhone(rp.phone)`). Expose `id: match?.id ?? null`, `altPhone: match?.altPhone || ''`, `notes: match?.notes || ''`, `preferredMethod: match?.preferredMethod || null`, `preferredTime: match?.preferredTime || ''`, plus the unchanged always-`[]` `studentIds`/`admissionIds`.

### `src/services/api.js`
Add, mirroring `pgCreateMaterial`/`pgUpdateMaterial`'s exact shape (server-truth-first, conflict-retry-via-callback):
```js
function buildParentRequestBody(data) {
  const body = { altPhone: data.altPhone ?? null, preferredMethod: data.preferredMethod ?? null, preferredTime: data.preferredTime ?? null, notes: data.notes ?? null };
  if (data.phone !== undefined)    body.phone    = data.phone;
  if (data.fullName !== undefined) body.fullName = data.fullName;
  return body;
}
export async function pgCreateParent(data, { onPhoneConflict } = {}) { /* POST /api/parents, retry-once on 409 field=phone via onPhoneConflict() */ }
export async function pgUpdateParent(id, data) { /* PUT /api/parents/:id */ }
```
(`phone`/`fullName` conditionally included, same reasoning as Materials' `code`/`teacher`/`description`/`addedAt` — only sent on create, never on update, matching that `ParentEditModal.jsx` never edits them.)

### `src/modules/communication/CommunicationPage.jsx`
- `const parents = useAppStore((s) => s.parents)` (real collection) replaces the `parentExtras` selector.
- `useMemo(() => deriveParents(records, parents), [records, parents])`.
- Remove `updateParentExtra` import/usage.
- Rewrite `handleSaveParent` as `async (data) => { ... }`:
  - If `selectedParent.id` is set → `pgUpdateParent(selectedParent.id, data)`, then merge the response into `state.parents` (needs a `setParents`-style action — see below).
  - Else, normalize `selectedParent.phone`; if normalization fails → per Decision Needed #1(a), this path should be unreachable (Save disabled in the modal) — treated as a defensive error toast if somehow reached, not a silent no-op.
  - Else → `pgCreateParent({ phone: normalized, fullName: selectedParent.parentName || null, ...data }, { onPhoneConflict: async () => { const fresh = await pgGetCollection('parents'); return fresh.find(r => normalizeParentPhone(r.phone) === normalized)?.id; } })`, then either adopt the created row or, on conflict, `pgUpdateParent` with the resolved id.
  - On success: merge the server response into `state.parents` (new row appended, or existing row replaced by id — same `setX(prev => ...)` pattern used everywhere else), toast success, close the modal.
  - On failure: toast the real server error, leave state untouched — same pattern as every other write in this app.

### `src/store/slices/communication.slice.js`
Remove the `parentExtras: {}` state line and the `updateParentExtra` action entirely. Add a `setParents` bulk setter (mirroring `materials.slice.js`'s `setMaterials`/`inventory.slice.js`'s new `setInvMaterials` exactly) — needs a home; since `parents` isn't owned by any existing slice today (it's boot-sync-only, never given its own slice), the smallest-footprint option is adding `parents: [] , setParents: (v) => set(s => ({ parents: typeof v === 'function' ? v(s.parents) : v }))` to this same `communication.slice.js`, since it's the module that now owns the parent-editing feature. (Flagged for your awareness — an alternative would be a new dedicated `parents.slice.js`; this plan proposes reusing `communication.slice.js` as the smaller change, consistent with how `inv_materials` reused an existing slice rather than gaining a new one.)

### `src/store/app.store.js`
Remove `parentExtras: state.parentExtras` from `partialize`. Add `parents: state.parents` (per §7's flagged proposal, pending your confirmation).

### `src/modules/communication/components/ParentEditModal.jsx`
Add a `loading` prop (passed from `CommunicationPage.jsx`'s new async `handleSaveParent`'s in-flight state), disabling the Save button while a request is in flight — mirrors every other async save modal already in this app. Per Decision Needed #1(a): if the parent being edited has no matchable phone, disable Save and show an inline explanatory message instead of the normal form controls.

### Tests
- `CommunicationPage.test.jsx`: `parentExtras: {}` → `parents: []` in the shared seed (mechanical).
- New `CommunicationPage.parentExtras.test.jsx`, mirroring `InventoryPage.materials.test.jsx`'s structure exactly: (1) create path — derived parent has a phone, no matching real row exists, POST is sent with the normalized phone + 4 fields, local state adopts the server response; (2) update path — a real row already exists (seeded in `state.parents`), PUT is sent to the existing id, only the 4 fields change; (3) 409-phone-conflict retry — POST conflicts, a fresh GET resolves the existing id, retried as PUT; (4) failure path — server error surfaces via toast, state untouched; (5) the no-valid-phone case per whichever Decision Needed #1 option is confirmed.

---

## 9. Route/auth impact

None. No backend route changes. `requirePermission('students')` already gates `/api/parents` and is already satisfied by every user who can reach the Communication page today (§2).

## 10. Migration impact

None — no schema change, no data migration, no backfill. `parents` already exists with 0 rows; this phase only adds a real write path to it.

## 11. Rollback / safety considerations

- Fully reversible at the code level: reverting the listed files restores the exact `parentExtras`-only behavior (no schema/data changes to undo).
- No destructive action anywhere: `pgCreateParent`/`pgUpdateParent` never delete anything; the 409-retry path only ever resolves to an update, never a duplicate or a loss.
- Because old `localStorage['studix-v1']` data for `parentExtras` is explicitly disposable (per your instruction) and this plan removes the key from `partialize`, any existing local data for it simply stops being read — no explicit cleanup/migration step is needed or proposed.
- The one behavior change with real user-facing consequence is Decision Needed #1 — until resolved, this plan does not assume which browsers' currently-editable "name-only" parent records become read-only/blocked.

---

**Stopping here. Waiting for your explicit approval — and resolution of Decision Needed #1 and the `partialize` proposal in §7 — before any implementation begins.**
