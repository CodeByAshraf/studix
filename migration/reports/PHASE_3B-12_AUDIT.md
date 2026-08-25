# Phase 3B-12 — Audit, Fix & Closure Report

**Module:** material distribution settlement (`inventory_txn` ledger writes via `PUT /api/material-distributions/:materialId`), plus one adjacent cross-phase consumer (`reportData.js`).
**Original audit classification: MIXED.**

---

## Audit Result

**MIXED.** The dedicated settlement endpoint itself (atomicity, idempotency, server-truth write contract, auth, ID strategy, the `inventoryTxn` read/merge path) was confirmed **clean and already shipped**. Three findings were surfaced: two fixed in this closure pass, one explicitly deferred.

---

## Finding #1 — Cancelled inventory transactions included in reconciliation

**Root cause:** `attemptReconciliation`'s `existing` query (`backend/src/routes/materialDistribution.js`) selected candidate rows by `material_id` + `type IN RELEVANT_TYPES` only — it never filtered on `status`. A `status: 'cancelled'` row was therefore still eligible to be picked as `latestByStudent`, and the reconciliation decision (`resolveNewEventType`, `currentReceived`) was made as if a voided transaction were still the true current state.

**Exact reconciliation path:**
```
inventory_txn (all statuses, incl. cancelled)
→ tx.inventory_txn.findMany({ material_id, type IN RELEVANT_TYPES })   ← bug: no status filter
→ latestByStudent (picked the most recent row regardless of status)
→ resolveNewEventType / metadataChanged
→ settlement decision returned to the client
```

**Why cancelled transactions were incorrectly included:** the query predicate simply never accounted for `status` at all — not a logic error in the decision functions themselves, purely a missing filter at the data-selection stage.

**Severity: High.** This is a live correctness bug in the core settlement/reconciliation engine of an inventory/financial-adjacent feature. Demonstrated directly by real data: all 4 pre-existing `inventory_txn` rows for material `id=6` (Phase 3B-12's own prior manual verification residue) are `status='cancelled'` — before this fix, any future reconciliation attempt for that material/those students would have based its decision on that voided history.

**Fix applied:** added `status: { not: 'cancelled' }` to the `existing` query's `where` clause — the smallest correct predicate change at the exact point where the bug lived. Nothing else in the file was touched: type resolution, quantity, idempotency, the retry-on-`number`-collision logic, transaction atomicity, and `computeNextSeq` (which must continue to see cancelled rows' `number` values, since numbers are permanent historical identifiers, not reconciliation state) are all unchanged.

**Verification performed:** there is no backend automated test runner in this project (confirmed, unchanged from the audit — not built as part of this phase, per your explicit instruction). Verification was performed via a one-off, deterministic, guaranteed-rollback script run directly against the real dev database, then deleted:
- **Case B (real data, read-only, zero writes):** queried the fixed predicate against the actual 4 permanent `inventory_txn` rows for material `id=6` (all `status='cancelled'`) — confirmed **0 rows returned**, proving cancelled history is now fully excluded.
- **Case A (isolated, rolled back):** inside a `prisma.$transaction` that always throws at the end, created one temporary `status='active'` row for the existing student `v3b12-s1` on the existing material `id=6` — confirmed the fixed query selects it as `latest`.
- **Case C (isolated, rolled back, same transaction):** added a second temporary `status='cancelled'` row for the same student, created *after* the active one (so it would win an unfiltered `ORDER BY created_at DESC` comparison) — confirmed the cancelled row never entered the candidate set at all, and the active row remained `latest`.
- **Rollback confirmed:** post-transaction, both temporary row IDs were queried and found not to exist — zero persisted writes.
- **Database re-verified immediately after:** `inventory_txn` count and the 4 real row IDs/statuses are byte-identical to the pre-verification baseline.

No new automated backend test infrastructure was created, per your instruction. This was a manual-but-deterministic verification against controlled inputs, explicitly documented as such — not automated backend coverage.

**Regression coverage:** none of the existing frontend contract tests exercise this reconciliation predicate (they mock `pgSaveMaterialDistribution` entirely), so this fix has no frontend-visible regression surface to test — confirmed by re-running `MaterialDistribution.inventoryTxn.test.jsx` (4/4 still passing, unchanged).

---

## Finding #2 — matDist has no boot-time synchronization from inventory_txn

**Status: DEFERRED — ARCHITECTURAL DECISION REQUIRED. Not fixed in this phase.**

**Current behavior:** `state.matDist` (`materials.slice.js`) is populated only by (a) whatever was persisted to localStorage from earlier sessions, and (b) the direct response of a `pgSaveMaterialDistribution` call. It is not in `PG_COLLECTIONS` and is never derived from `state.inventoryTxn`, even though `inventoryTxn` itself is correctly fetched and merged from PostgreSQL on every boot.

**Why it is potentially stale:** on any fresh session (new browser, cleared storage, a second device, or another user), `matDist` starts empty or outdated and stays that way for any material until someone explicitly reopens that specific material's distribution roster and saves it again — even though the real ledger (`inventory_txn`) already has the correct, complete history on the server.

**Why it was not fixed in this phase:** per your explicit instruction, this requires a genuine architectural decision, not a narrow predicate fix like Finding #1. The right design is not obvious and was deliberately left undecided:
- **Option A — derived view:** compute `matDist`-shaped records from `state.inventoryTxn` on every read (a pure selector), never stored independently.
- **Option B — synchronized read model:** add a boot-time reconciliation step (client-side reimplementation of `materialDistribution.js`'s logic, or a new read endpoint) that rebuilds `matDist` from `inventoryTxn` after every PG sync.
- **Option C — intentionally separate local operational state:** accept that `matDist` is a session-scoped working view, not meant to survive across devices/sessions, and document that explicitly instead of "fixing" it.

Each option has different implications for consistency, performance, and how much of `materialDistribution.js`'s reconciliation logic would need to exist twice (once server-side, once client-side, if Option B is chosen) — a decision requiring your input, not an implementation default.

**No implementation was performed for this finding.** `matDist`'s boot synchronization, the inventory store architecture, `db.middleware.js`'s general design, and the `inventoryTxn → matDist` relationship were not touched.

---

## Finding #3 — reportData.js bookletDeliveries used legacy recipient instead of student_id

**Affected report path:** `reportData.js`'s `gatherStudentData` → `bookletDeliveries` → consumed by `buildStudentReport.js` (printed/on-screen student report: booklets table, snapshot page counts, info card) and `studentWhatsappService.js`'s `buildBookletMessage` (the WhatsApp report message audited and closed in Phase 3B-9).

**Root cause:** the filter matched only `t.recipient && t.recipient.includes(student.name)` — a legacy free-text name match. The Phase 3B-12 settlement endpoint (`materialDistribution.js`) always sets the real `student_id` FK on every new `studentDelivery` row and never sets `recipient`. So every delivery recorded through the (correct, already-shipped) Phase 3B-12 flow was silently invisible to this report path.

**Severity: Medium-High** for the two features that consume it (student reports, WhatsApp parent messages); zero severity for the settlement endpoint itself, which was never at fault.

**Fix applied — narrow, backward-compatible:**
```js
const bookletDeliveries = (store.inventoryTxn || []).filter((t) => {
  if (t.type !== 'studentDelivery') return false;
  if (t.studentId === studentId) return true;
  return !!(t.recipient && student.name && t.recipient.includes(student.name));
});
```
`student_id` (the real, migrated FK — using the project's actual camelCase field mapping, `studentId`) is checked first; the legacy `recipient` match is preserved unchanged as a fallback for pre-migration rows that have no `studentId`. No other report data source, and no other part of the report engine, was touched.

**Verification performed:** new test file `src/modules/student-report/reportData.bookletDeliveries.test.js` (8 tests, pure-function, no React/network needed since `gatherStudentData` is a plain function):
1. A migrated delivery (`studentId` set, `recipient` null) is correctly recognized.
2. A legacy delivery (`recipient` set, `studentId` null) is still correctly recognized.
3. A migrated delivery is not lost merely because `recipient` is absent/undefined (the exact regression).
4. A delivery belonging to a *different* student (`studentId` mismatch, no `recipient`) is correctly excluded.
5. Non-`studentDelivery` transaction types are ignored regardless of `studentId`/`recipient`.
6. A row matched by both `studentId` and `recipient` is not double-counted.
7. Mixed history (one legacy + one migrated row for the same student) — both are included, none lost.
8. No `inventoryTxn` at all — empty, non-throwing result (existing behavior intact).

All 8 passed on first run.

---

## Test Results

```
npx vitest run src/store/db.middleware.test.js src/modules/settings/SettingsPage.centerProfile.test.jsx
  src/modules/materials/MaterialsPage.materials.test.jsx src/modules/materials/MaterialDistribution.inventoryTxn.test.jsx
  src/modules/student-report/reportData.bookletDeliveries.test.js src/modules/student-report/StudentReportPage.waReportLog.test.jsx
✓ 56/56 passed
  - db.middleware.test.js: 31/31 (23 pre-3B-11 + 8 from the 3B-11 inventorySettings fix)
  - SettingsPage.centerProfile.test.jsx: 3/3
  - MaterialsPage.materials.test.jsx: 7/7
  - MaterialDistribution.inventoryTxn.test.jsx: 4/4
  - reportData.bookletDeliveries.test.js: 8/8 (new)
  - StudentReportPage.waReportLog.test.jsx: 3/3

npx vitest run   (full suite)
✓ 16/16 test files, 111/111 tests passed (previous baseline: 103/103; +8 new from Finding #3, 0 regressions)
```

## Database Verification

- **No schema changes** — `backend/prisma/schema.prisma` was not touched.
- **No unintended data changes** — the Finding #1 verification script ran entirely inside a transaction that always rolled back; post-verification, the database was re-queried and matched the pre-verification baseline exactly (same 4 `inventory_txn` row IDs, same statuses).
- **No residue cleanup** — the 4 pre-existing cancelled `inventory_txn` rows, the `V3B12-VERIFY` material, and the `v3b12-s1`/`v3b12-s2` students were left exactly as they were; nothing was deleted or modified.
- **Known baseline preserved, re-confirmed after implementation:**
  ```
  inv_materials:      1
  inventory_txn:      4
  inventory_settings: 1
  center_profile:     1
  ```

## Files Modified

- `backend/src/routes/materialDistribution.js` — Finding #1 fix (one `where`-clause predicate added, plus an explanatory comment).
- `src/modules/student-report/reportData.js` — Finding #3 fix (`bookletDeliveries` filter now checks `studentId` first, falls back to legacy `recipient`).
- `src/modules/student-report/reportData.bookletDeliveries.test.js` — new, 8 tests, Finding #3 regression coverage.

No other files were modified. `matDist`, `db.middleware.js`, generic CRUD infrastructure, authentication, the Prisma schema, and all files explicitly listed as off-limits in the implementation instructions were not touched.

## Final Status

**Phase 3B-12 = CLOSED WITH DEFERRED ARCHITECTURAL FINDING.**

```
Finding #1 (cancelled transactions in reconciliation)  → FIXED, verified (isolated, guaranteed-rollback)
Finding #2 (matDist boot synchronization)               → DEFERRED — architectural decision required, not implemented
Finding #3 (bookletDeliveries legacy recipient)          → FIXED, verified (8 new passing tests)
```

Full suite: 111/111 passing (up from the 103/103 baseline, 0 regressions). No schema, generic-infrastructure, authentication, or database changes were made. Finding #2 remains open and is not described as resolved.
