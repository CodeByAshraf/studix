# Phase 3B-16 — `parentExtras` → Real `parents` — Implementation & Post-Implementation Audit

Implements `PHASE_3B-16_PARENT_EXTRAS_IMPLEMENTATION_PLAN.md` exactly, with both decisions as resolved in your approval: Decision #1 = disable Save when no valid/normalizable phone exists (no name-based matching, no duplicate storage); Decision #2 = `parents` added to `partialize` as a PostgreSQL-backed cache. No schema change was needed — `parents.alt_phone/preferred_method/preferred_time/notes` already existed and were already fully writable.

---

## 1. What changed

| File | Change |
|---|---|
| `src/modules/communication/parentService.js` | Added `normalizeParentPhone()` (duplicating the already-twice-proven algorithm from `migration/mapping/normalizePhone.js`/`studentWhatsappService.js`). Rewrote `deriveParents(records, realParents)`: matches each derived (synthetic, communications-based) parent to a real `parents` row by normalized phone, exposing `id`, `normalizedPhone`, `altPhone`, `preferredMethod`, `preferredTime`, `notes` from the match (or `null`/defaults when unmatched). `studentIds`/`admissionIds` kept as always-`[]` (confirmed dead, never read anywhere — left unchanged rather than removed, out of scope). |
| `src/services/api.js` | Added `pgCreateParent`/`pgUpdateParent` (new — none existed before), mirroring `pgCreateMaterial`/`pgUpdateMaterial`'s exact shape. `phone`/`fullName` are sent only when provided (conditional inclusion, same reasoning as Materials' `code`/`teacher` fields — never sent on update, since the modal never edits them). On a 409 with `field` including `phone`, `pgCreateParent` returns `{ conflict: true, existingId }` via the caller-supplied `onPhoneConflict()` resolver rather than retrying internally — a deliberate, small departure from `pgCreateMaterial`'s pattern, because a phone conflict means the row already exists and the correct next action is a PUT, not a second POST with different data. |
| `src/store/slices/communication.slice.js` | Removed `parentExtras: {}` state and `updateParentExtra` action entirely (not deprecated-in-place). Added `parents: []` state and `setParents` bulk setter, mirroring `materials.slice.js`'s `setMaterials`. |
| `src/store/app.store.js` | `partialize`: removed `parentExtras`, added `parents` (Decision #2). |
| `src/modules/communication/CommunicationPage.jsx` | Reads `s.parents` (as `realParents`) instead of `s.parentExtras`. `handleSaveParent` rewritten as async, server-truth-first: updates by real id when already matched; otherwise finds-or-creates by normalized phone with the 409-retry; merges the server response into `state.parents` on success; toasts the real error and leaves state untouched on failure. A `savingParent` loading flag is passed to the modal. |
| `src/modules/communication/components/ParentEditModal.jsx` | Added a `loading` prop (disables both buttons, shows "جارٍ الحفظ..." while saving). Added `canSave = !!(parent.id || parent.normalizedPhone)` — when `false`, all fields are disabled, Save is disabled, and an inline red notice explains why (Decision #1). |
| `src/modules/communication/CommunicationPage.test.jsx` | Seed key `parentExtras: {}` → `parents: []` (mechanical; no assertion in this file exercises the parent-save flow). |
| `src/modules/communication/CommunicationPage.parentExtras.test.jsx` (new) | 5 tests: create (no existing match), update (existing match, only the 4 fields sent), 409-phone-conflict retry, create failure, and the no-valid-phone case (Save disabled, zero network calls). |

**No backend file was touched.** No schema change. No new table. No new column.

## 2. One test-writing correction made during implementation (not a product bug)

The create test initially expected `preferredMethod`/`notes` to be sent as `null` when untouched. The actual, correct behavior sends `''` (empty string) for untouched text/select fields — consistent with how every other form in this app (including `materialService.js`'s `description`) already treats an untouched text field, and consistent with `buildParentRequestBody`'s `?? null` only ever converting `undefined`/`null`, never `''`. This was a wrong test expectation, corrected in the test file; **no application code was changed because of it.**

## 3. Tests and build

```
npx vitest run src/modules/communication   →  2 files, 11 tests, all passed
npx vitest run                              →  25 files, 166 tests, all passed (161 + 5 new)
npm run build                                →  ✓ built in 4.76s, no errors
```

## 4. Fresh, independent post-implementation audit

**No unexpected findings.** Everything below was re-derived this pass by direct grep/read and one live read-only query — not carried forward from §1-3 on trust.

- **`parentExtras` fully eliminated:** a project-wide grep for `parentExtras` finds it only inside one test's `describe(...)` label text (a human-readable string, not a code reference) — zero remaining state, writer, or reader anywhere.
- **Real `parents` wiring confirmed:** `s.parents`/`s.setParents`/`pgCreateParent`/`pgUpdateParent` are used only in the expected 2 files (`CommunicationPage.jsx`, `communication.slice.js`), plus their own definitions in `api.js`.
- **Zero backend files modified this phase** (confirmed by a file-modification-time scan against the approved plan's timestamp).
- **Schema live-reconfirmed unchanged:** `parents` still has exactly its original 9 columns (`id, full_name, phone, alt_phone, preferred_method, preferred_time, notes, created_at, updated_at`); `parents.count()` → `0` (unchanged); total public tables → `27` (unchanged). One pre-existing trigger, `trg_parents_updated` (bumps `updated_at` on UPDATE) — unrelated to and unaffected by this work.
- **Materials confirmed untouched:** `inv_materials.count()` → `1`, same pre-existing verification row as every prior check this session.
- **Teachers/`matDist`/`admissionSystemLog`/`wa_report_log` confirmed untouched:** every grep for these terms inside the 8 files this phase modified resolves only to pre-existing, unrelated content already present in `api.js` (other collections' functions) and `app.store.js` (other collections' `partialize` entries/imports) — nothing added or changed in those unrelated sections.
- **Permission/auth behavior unchanged:** `/api/parents` still gated by `requirePermission('students')`, already satisfied by every user who can reach the Communication page (unchanged from the plan's own finding — no server file was touched to verify this against).

## 5. Decision resolutions as implemented

- **Decision #1** (no phone → no save, no name matching, no duplicate storage): implemented in `ParentEditModal.jsx`'s `canSave` gate and re-checked defensively in `CommunicationPage.jsx`'s `handleSaveParent`. Verified by test (`no valid phone... Save is disabled, no network call is ever made`).
- **Decision #2** (`parents` in `partialize` as a PG-backed cache): implemented exactly as proposed — `parents` now caches locally like every other PG-backed collection, with `mergeById` (the existing, unmodified generic array-merge in `db.middleware.js`) as the merge strategy on next boot, server always winning on id collision. PostgreSQL remains the sole source of truth; the local copy is purely a cache, never a fallback write target.

## 6. Explicitly out of scope, confirmed not touched

Old `localStorage['studix-v1']` `parentExtras` data — disposable, not migrated, simply stops being read. `students.parent_id`/`admissions.parent_id`/`communications.parent_id` FK population — not required for this scope and not touched. Teachers, Materials, `matDist`, `admissionSystemLog`/`wa_report_log` hardening, `MOCK_GROUPS`, session-invalidation — none referenced or modified by any file in this phase.

---

**No unexpected finding requiring scope expansion.** Phase 3B-16 (`parentExtras` → real `parents`) is implemented, tested, built, and independently re-verified.
