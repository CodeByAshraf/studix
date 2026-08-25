# Materials Field Ownership Decision — `teacher` / `description` / `addedAt`

**Status: READ-ONLY.** No code, schema, database, or localStorage was modified to produce this report. Nothing here is authorized or implemented. Builds directly on the accepted `MATERIALS_DOMAIN_DECISION_AUDIT.md` baseline — this report does not re-litigate the "one domain, two half-migrated views" conclusion, it resolves the one open sub-question that audit deferred: what should actually happen to these three fields.

---

## teacher

### 1. Every reader and writer

**Writers:** `MaterialForm.jsx:94` (free-text input, label "المدرس / المدرسة" — "Teacher / School"), folded into the object built by `createMaterial`/`updateMaterial` (`materialService.js:45,60`). **Never sent to the server** — `buildMaterialRequestBody` (`api.js:805-814`) omits it; confirmed by the passing test `MaterialsPage.materials.test.jsx:120` (`expect(sentBody.teacher).toBeUndefined()`). Because the server response (which has no `teacher` column) is what gets adopted into local state on every save, the value is lost the moment a save succeeds (established in `MATERIALS_DOMAIN_DECISION_AUDIT.md` §1).

**Readers:** `MaterialsPage.jsx:237` (table column), `MaterialReports.jsx:182` (list subtitle: `{mat.subject} · {mat.grade} · {mat.teacher || '—'}`), `MaterialDistribution.jsx:232` (`{material.teacher && <span>👤 {material.teacher}</span>}`). No other file reads it. No filter, sort, aggregation, or cross-module lookup uses it anywhere (confirmed by grep across `src/modules`).

### 2. Business meaning

A free-text label identifying which teacher/subject-instructor a given booklet/study material belongs to or was prepared by — informational catalog metadata entered by admin/reception staff when cataloguing a booklet, not a reference to a scheduling or academic relationship.

### 3. Required for any currently live workflow?

No. It is optional in both `MaterialForm.jsx` (no `required` marker) and `materialSchema`/`validateMaterial`. It is display-only in all three consumer sites; nothing filters, groups, or computes by it.

### 4. Existing equivalent Postgres column/table elsewhere?

**Yes — twice, and both are directly relevant precedent:**
- `groups.teacher_name String?` (`backend/prisma/schema.prisma:264`) — a free-text teacher label, already shipped and working (Phase 3B-3): `GroupForm.jsx`'s local `teacher` field is explicitly renamed to `teacherName` on write (`api.js:107-114,128`, comment: *"الحقل المحلي 'teacher' (اسم حر) يُرسَل كـ 'teacherName' — يطابق عمود teacher_name"*). `groups` also has a sibling `teacher_id BigInt? → teachers.id` FK (`schema.prisma:263,276`) that is **not populated by any current frontend code** (confirmed by grep — no writer sets `teacherId`/`teacher_id` anywhere).
- `exams.teacher String?` (`backend/prisma/schema.prisma:236`) — an even more direct precedent: a **bare free-text column with no FK at all**, sitting on a live, migrated table right next to its own `date`/`created_at` pair.

Neither of these tables is the same entity as `inv_materials`, so neither is a place to *redirect* the materials `teacher` field to — but both prove the schema already has an established, shipped convention for exactly this shape of field: "teacher" as a plain nullable string, with or without an unused FK sibling for later.

### 5. Should it belong on `inv_materials` itself, or be derived/removed?

It should belong on `inv_materials` itself, as a plain nullable string column, if kept — there is no other table that already models "which teacher this specific booklet belongs to," and it is not derivable from any other column (materials aren't tied to a specific group or class session, so there's no indirect path to a teacher via an FK chain).

### 6. Historical migration decisions and existing tests

`MIGRATION_PLAN.md` does not mention this field. `fieldMaps.js`'s `invMaterials` entry simply never included it (an omission, not a decision — see `MATERIALS_DOMAIN_DECISION_AUDIT.md` §5). `PHASE_3B-11_AUDIT.md` does not discuss it. The one concrete artifact is `MaterialsPage.materials.test.jsx:106-127`, which asserts `sentBody.teacher` is `undefined` — this certifies *current mechanical behavior* (the field isn't sent), not a reasoned decision that it shouldn't be. This audit does not treat that test as evidence of intent, only of implementation.

### 7. Necessary to preserve current legitimate behavior?

The *display* behavior (show a teacher label in three places) is legitimate and actively used by staff typing values into the form — but per §1, that data currently never survives past the render that created it for any material created since Phase 3B-11 shipped. "Preserving current behavior" therefore means preserving the *intent* the UI still visibly promises, not literally preserving something that already works end-to-end.

### 8. Data loss from dropping it: real loss, or only legacy UI metadata?

Mixed. It is real, user-entered content (not placeholder/demo text), but it functions today purely as cosmetic display metadata with no downstream logic depending on it, and — critically — it is **already being lost today** on every save. Removing the input field causes no *new* loss beyond what's already happening; keeping the input without backing it with a column continues an already-live, silently deceptive UX (a control that visibly accepts and appears to save a value it actually discards).

### `teacher`-specific answers

- **Does it represent a teacher relationship?** In spirit, informally — it identifies whose material this is — but it is implemented, and precedented elsewhere in this schema, as a bare label, not a relation.
- **Is there an existing `teachers` table/FK that should be used?** The `teachers` table exists, and `groups.teacher_id` shows the FK pattern, but that FK is itself unpopulated by any current frontend code — using a real FK for materials would require building a "pick a real teacher" UI that doesn't exist anywhere in the app today, for either `groups` or `materials`.
- **Does the deferred Teachers domain affect this field?** Only if the goal is a *real relational* link (a `teacher_id` FK). It does **not** block a plain free-text column — `groups.teacher_name` and `exams.teacher` both already prove free-text ships and works independently of the FK/relation being wired up, which is exactly the deferred part of Teachers.
- **Is it merely legacy display metadata?** Partly — it functions as display metadata today, but the schema-wide precedent (`exams.teacher`) shows "teacher as a permanent free-text column" is an accepted, permanent design choice in this system, not merely a placeholder awaiting a future relation.

---

## description

### 1. Every reader and writer

**Writer:** `MaterialForm.jsx:108-112` (optional textarea, "وصف المذكرة (اختياري)" — "Material description (optional)"), folded into `createMaterial`/`updateMaterial`'s return object (`materialService.js:48,61`). Never sent to the server (same `buildMaterialRequestBody` omission; same test assertion, `MaterialsPage.materials.test.jsx:121`). Lost on every save, identically to `teacher`.

**Reader:** exactly one site — `MaterialsPage.jsx:234` (`{mat.description && <div ...>{mat.description}</div>}`, a small subtitle under the material name in the list table). Confirmed by grep across the entire `materials`/`payments`/`admissions`/`student-report` modules — no other consumer exists anywhere.

### 2. Business meaning

A short, optional free-text note describing the booklet's content (e.g., "الترم الأول — الفصول 1-5"). Purely supplementary catalog content, not a status, category, or identifier.

### 3. Required for any currently live workflow?

No. Optional in the UI, optional in validation, single display site, no computation or filter depends on it.

### 4. Existing equivalent Postgres column/table elsewhere?

No column already represents this specific concept. There is, however, a recurring schema-wide convention worth noting: `groups.notes String?`, `parents.notes String?`, `cashboxes.notes String?` all show that a plain nullable free-text notes/description column is a normal, low-risk, already-repeated pattern in this database — not a novel addition. Separately, Inventory's *own*, independently-built local model (`inventoryService.js:53`, `buildMaterial`) also carries a `notes` field with no backing column — two independently-built UIs converging on wanting the same kind of field is mild but real corroborating evidence of genuine (if minor) demand, not just one form's leftover field.

### 5. Should it belong on `inv_materials` itself, or be derived/removed?

If kept, it belongs on `inv_materials` itself as a plain nullable text column — nothing else represents it and nothing derives it. Of the three fields audited here, this is the one where "simply remove it" is most defensible, given its narrow (single-site) usage and optional status.

### 6. Historical migration decisions and existing tests

Same story as `teacher`: no mention in `MIGRATION_PLAN.md`, omitted (not excluded-by-decision) from `fieldMaps.js`, not discussed in `PHASE_3B-11_AUDIT.md`, and covered only by the same mechanical "not sent" test assertion.

### 7. Necessary to preserve current legitimate behavior?

Low necessity relative to the other two fields — it is the narrowest-used and lowest-stakes: one optional field, one display site, no ordering/gating role.

### 8. Data loss from dropping it: real loss, or only legacy UI metadata?

Low-Medium. It is real user-entered content when filled in, but of the three fields it is the closest to "legacy UI metadata" in practical terms — narrow usage, optional, and (like the other two) already not surviving saves today, so removing the input formalizes existing loss rather than causing new loss.

---

## addedAt

### 1. Every reader and writer

**Writer:** `MaterialForm.jsx:101-104` (`<input type="date">`, no `min`/`max` — fully backdatable), defaulted to today's date only as an initial value, not a constraint. It is the one field of the three marked **required**: `validateMaterial` (`materialService.js:30`) — `if (!data.addedAt) errors.addedAt = 'تاريخ الإضافة مطلوب'` ("date added is required"). `createMaterial`/`updateMaterial` both include it. Never sent to the server (same omission pattern; same test coverage would apply, though the test file does not explicitly assert `addedAt`'s absence for the *update* case the way it does for `teacher`/`description` on create — it is however confirmed absent structurally in every `saved`-adoption assertion, e.g. `materials.test.jsx:211`).

**Reader:** `MaterialsPage.jsx:85` — **it is the default sort key for the entire materials list** (`filtered.sort((a,b) => b.addedAt.localeCompare(a.addedAt))`, newest-first). Also displayed as a formatted date column (`MaterialsPage.jsx:240`). Not read by `MaterialReports.jsx` or `MaterialDistribution.jsx` (confirmed by grep — neither file references `addedAt`).

### 2. Business meaning

A user-controlled, potentially-backdated business date representing when a booklet/material was actually added to the catalog or first stocked — distinct in kind from a technical row-insertion timestamp. The date-only input (no time component) and the absence of any `min`/`max` constraint both support a "historical/business date" reading rather than "moment of data entry."

### 3. Required for any currently live workflow?

Yes, more so than the other two fields, in two concrete ways: (a) the UI form **requires** it before a material can be saved at all — an already-live gate on the create/edit workflow, even though the value is then discarded; (b) it is the **sort order** for the entire Materials list — the single most basic "which material do I see first" behavior of the whole page.

### 4. Existing equivalent Postgres column/table elsewhere?

`inv_materials.created_at DateTime @default(now())` exists, but **is not semantically equivalent**. This distinction — a server-assigned technical `created_at` timestamp kept separate from a user-editable business date — is an established, repeated pattern elsewhere in this exact schema: `payments.date DateTime @db.Date` (distinct from `payments.created_at`), `attendance.date DateTime @db.Date` (distinct from `attendance.created_at`), and `exams.date DateTime @db.Date` (distinct from `exams.created_at`) all keep the two concepts as separate columns. Collapsing `addedAt` into `created_at` would break with this established convention and would concretely lose: (a) the ability to backdate an entry (e.g., cataloguing a booklet that was actually added weeks earlier), and (b) date stability across any future data re-import or re-sync, since `created_at` reflects *when the database row was technically inserted*, which is not necessarily the same event as *when the material was actually added* — a real, non-hypothetical concern given this application has already been through one full migration where row-insertion time and real-world event time diverged for other domains.

### 5. Should it belong on `inv_materials` itself, or be derived/removed?

If the business-date meaning is to be kept, it belongs on `inv_materials` itself as a genuinely new column (e.g. `added_at DATE`), not derived from `created_at`, following the same precedent as `payments.date`/`attendance.date`/`exams.date`. If the business decides the backdating/business-date distinction doesn't actually matter in practice, `created_at` can serve as a substitute **for sort-ordering purposes only** — that is a real, deliberate product trade-off, not a free technical equivalence.

### 6. Historical migration decisions and existing tests

Same omission pattern as the other two fields — no explicit historical decision either way. No test in the codebase asserts anything about the *meaning* of `addedAt` versus `created_at`; the only test coverage is mechanical (it's not part of the outgoing request body).

### 7. Necessary to preserve current legitimate behavior?

Yes, at minimum for the sort-order role — removing the field without a substitute changes the default ordering behavior of the Materials list. The *required-field* behavior (blocking save without a date) is also currently live UI behavior, though arguably a behavior worth reconsidering regardless of the schema question, given it currently gates a save on a value that is then thrown away.

### 8. Data loss from dropping it: real loss, or only legacy UI metadata?

The highest risk of the three. It is required, user-entered, and carries genuine business meaning (a real, potentially-backdated "when was this added" fact) that has no recoverable substitute once discarded — unlike `teacher`/`description`, there is no equally-good fallback value sitting on the row (`created_at` is a lossy, non-equivalent substitute, not a safe stand-in, per §4).

### `addedAt`-specific answers

- **Is it equivalent to `created_at`?** No — different semantics (user-editable, backdatable business date vs. server-assigned technical insertion timestamp), and this exact distinction is already established convention elsewhere in the same schema (`payments`/`attendance`/`exams`).
- **Can it safely map to the existing `created_at` field?** Only as a lossy fallback for *sort ordering*, not as a faithful preservation of its business meaning. Safe for "the list still has *some* sensible default order," not safe for "we still know when this was really added."
- **Would a new column genuinely be required?** Yes, if the business-date/backdating meaning is to be preserved — a small, additive `added_at DATE` column, directly precedented by three existing tables in the same schema.

---

## Field ownership table

| Field | Current Local Meaning | Current PG Representation | Existing Target? | Data Loss Risk | Required? | Recommended Storage |
|---|---|---|---|---|---|---|
| `teacher` | Free-text label: which teacher/instructor this booklet is associated with | None — dropped on every save | No exact target on `inv_materials`, but a directly precedented **pattern** exists (`groups.teacher_name`, `exams.teacher` — both plain nullable strings) | Medium — real content, cosmetic use only, already being lost today | No (display-only, optional) | New nullable `teacher` (plain string, no FK) on `inv_materials`, mirroring `exams.teacher` |
| `description` | Optional free-text note about the booklet's content | None — dropped on every save | No exact target; precedent for free-text notes columns exists elsewhere (`groups.notes`, `parents.notes`, `cashboxes.notes`) but nothing material-specific | Low-Medium — narrowest usage (one display site), optional, already being lost today | No (display-only, optional) | New nullable `description`/`notes` (plain string) on `inv_materials` — or defensible to drop entirely |
| `addedAt` | User-editable, potentially-backdated business date: when the material was actually added to the catalog; drives default list sort order | None — dropped on every save | `created_at` exists but is **not** semantically equivalent (technical timestamp, not business date) — same distinction already upheld for `payments.date`/`attendance.date`/`exams.date` | High — required field, drives ordering, backdating capability is unrecoverable once dropped without a real substitute | Yes (form-required today; also the list's sort key) | New `added_at DATE` column on `inv_materials`, precedented by `payments`/`attendance`/`exams`' separate date columns |

---

## Implementation options

### A. Map fields to existing PostgreSQL columns/relationships with no schema change

Only partially viable — there is no existing column `teacher` or `description` could honestly map onto (no false-equivalence available); `addedAt` could map onto `created_at`, but only as a lossy compromise.

- **Schema impact:** none.
- **Code impact:** Low — retarget `MaterialsPage.jsx` to `s.invMaterials`, remove `teacher`/`description` inputs from `MaterialForm.jsx`, change the sort key from `addedAt` to `createdAt`.
- **Data preservation:** Poor — `teacher`/`description` become permanently unrecoverable as user input (the fields disappear from the form entirely); `addedAt`'s business-date/backdating meaning is permanently lost, retaining only a rough sort order via `created_at`.
- **Migration risk:** Low (no schema or data migration needed).
- **Effect on existing workflows:** Removes two form fields outright; list ordering keeps working via `created_at` but drifts from "when was this really added" to "when was this row technically inserted," which will visibly change ordering the moment any bulk import or re-sync ever happens.

### B. Add only the minimum necessary columns to `inv_materials`

- **Schema impact:** Small and additive — three new nullable columns (`teacher String?`, `description`/`notes String?`, `added_at Date?`), no FK, no relation, no backfill required (the one existing live row, a verification artifact, can simply stay null on the new columns).
- **Code impact:** Medium — extend `buildMaterialRequestBody`/the update path to include the three fields, extend `normalizeMaterialResponse`/the read-merge fixup to pass them through, add a Prisma migration. No changes required to `MaterialDistribution.jsx`, `inventory_txn`, or any FK relation.
- **Data preservation:** Full — all three fields become genuinely persistent for the first time, matching what the UI has visually promised all along.
- **Migration risk:** Low — additive nullable columns are the lowest-risk class of schema change available; nothing existing depends on their absence.
- **Effect on existing workflows:** Fixes the confirmed silent-data-loss bug (`MATERIALS_DOMAIN_DECISION_AUDIT.md` §1) without disrupting `MaterialDistribution.jsx`, inventory transactions, or any other already-working piece of the domain.

### C. Remove the fields as legacy metadata

- **Schema impact:** none.
- **Code impact:** Low-Medium — remove three inputs from `MaterialForm.jsx`, remove the corresponding display code in `MaterialsPage.jsx`/`MaterialReports.jsx`/`MaterialDistribution.jsx`, switch the sort key to `createdAt`.
- **Data preservation:** None going forward — this is the option that formally accepts and completes the loss that is already happening silently today.
- **Migration risk:** None.
- **Effect on existing workflows:** A visible feature removal, not a neutral cleanup — staff currently interact with these three inputs (typing a teacher name, a description, picking/backdating a date) even though the values don't persist; removing them makes the app more honest but is a real, user-facing behavior change, most consequential for `addedAt` (loses the required-date gate and the backdating capability entirely).

### D. Defer the fields because they depend on Teachers or another future domain

- **Schema impact:** none now; a future `teacher_id` FK (mirroring `groups.teacher_id`) could be layered on once/if the Teachers domain is built out, without conflicting with a plain `teacher` string column added under Option B.
- **Code impact:** none now.
- **Data preservation:** Continues the current loss indefinitely, with no fix date.
- **Migration risk:** none directly, but this option prolongs two already-identified live defects: the silent field loss here, and the Inventory-created-material distribution-blocking bug from `MATERIALS_DOMAIN_DECISION_AUDIT.md`'s Headline Finding (unrelated to Teachers, but likely to get bundled into "wait for the bigger materials rework").
- **Effect on existing workflows:** None — status quo continues.
- **Applicability check:** this option is not well-supported by the evidence for `teacher` as a plain field — `groups.teacher_name` and `exams.teacher` both prove a free-text teacher field ships and works independently of the Teachers domain being built out; only a *real relational* `teacher_id` FK would genuinely need to wait. It has no applicability at all to `description` or `addedAt`, neither of which has any relationship to Teachers.

---

## Final conclusion

**1. Which fields must be preserved?**
`addedAt` most urgently — it is a required field that already gates the save workflow, it drives the list's default sort order, and its business-date/backdating meaning has no safe substitute once dropped. `teacher` should also be preserved — real, actively-typed user content with a directly precedented, low-risk storage pattern already proven twice elsewhere in this schema (`groups.teacher_name`, `exams.teacher`). `description` is the one field where preservation is a "preserve if cheap" call rather than a "must preserve" one — narrowest usage, optional, lowest stakes.

**2. Which can map to existing columns?**
None cleanly. `addedAt` can be *approximated* by `created_at` for sort-ordering purposes only, but that is a lossy product trade-off (loses backdating and real-world-event accuracy), not a genuine, safe mapping — the schema's own precedent (`payments`/`attendance`/`exams` all keeping a separate `date` from `created_at`) argues directly against treating them as equivalent. `teacher` and `description` have no existing column to map to at all.

**3. Which, if any, actually require schema changes?**
All three, if their business content is meant to survive — each needs one small, nullable, additive column on `inv_materials` (`teacher`, `description`/`notes`, `added_at`). None requires a new table, an FK, or any dependency on the Teachers domain.

**4. Can InventoryPage and MaterialsPage safely converge on `inv_materials`?**
Yes — reaffirming `MATERIALS_DOMAIN_DECISION_AUDIT.md`'s conclusion. The one refinement this audit adds: convergence should happen *together with* (or after) Option B's small schema addition, not before it — converging the two modules onto the current, field-truncated `inv_materials` shape without first deciding on `teacher`/`description`/`addedAt` would spread the existing MaterialsPage-only data-loss bug onto InventoryPage's create/edit path as well, rather than fixing it.

**5. What is the smallest safe implementation?**
Option B (three additive, nullable columns: `teacher`, `description`/`notes`, `added_at`, extending the two request-body/response-normalization functions in `api.js` to carry them both ways) combined with the previously-identified Inventory-write-path fix (wiring `InventoryPage.jsx`'s local-only create/update/delete/transaction actions onto the real, already-proven `pgCreateMaterial`/`pgUpdateMaterial`/`pgDeleteMaterial` pattern). Together, these close the confirmed silent field-loss bug and the confirmed distribution-blocking bug, with no destructive schema change, no FK, and no dependency on the deferred Teachers domain.

---

**No code, schema, database, or localStorage was modified to produce this report. Stopping here — nothing above has been implemented.**
