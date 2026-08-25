# Post-`matDist` Final Remaining Gaps Audit

**Status: READ-ONLY.** No application code, database, schema, localStorage, Zustand state, configuration, or test was modified to produce this report. All live database checks used only `SELECT`/`count()`/`information_schema` queries. Nothing here is authorized or implemented.

---

## Executive Summary

With `matDist` now closed, four domains have been fully migrated this engagement: Identity/Auth, Materials, `parentExtras`, and `matDist`. This audit re-scanned the entire project and live database from scratch and found **no new gap, no regression in any closed domain, and no change to any previously-identified candidate's status** — with one exception worth stating precisely: this audit specifically investigated whether closing `matDist` created a *new* dependency or risk via the one already-known, already-deferred local-only write path in the same file family (Inventory's own direct stock-transaction entry), traced it concretely, and found it does **not** — a real, evidence-based check, not an assumption.

**The central, honest conclusion of this audit: there is no remaining candidate that meets the bar every prior phase in this series was held to** ("real backend readiness, zero or split local-only write path, not blocked by an external precondition, not a different category of work"). Every item still open is one of: explicitly deferred by a standing decision (Teachers; Inventory's own direct transaction entry), blocked by a precondition this audit cannot resolve (real `groups`/`cashboxes` data), a different category of work entirely (`admissionSystemLog`/`wa_report_log` hardening; frontend session-invalidation), or low-value cleanup with no real migration substance (`tc_center_profile`/`studix_autobackup`, dead code). **This audit does not invent a Phase 3B-17 candidate, per instruction — it reports that none currently exists that is both real and actionable without a decision only you can make.**

---

## Complete Persistence Matrix

| Item | Mechanism | PostgreSQL equivalent | Local writer | Local reader | Local-only write path? | PG write support exists? | Schema sufficient? | Classification |
|---|---|---|---|---|---|---|---|---|
| `users`/`roles` | N/A — real PG only | `users`/`roles`, real | `pgCreateUser`/`pgUpdateUser`/`pgCreateRole`/etc. | Everywhere auth-gated | No | Yes | Yes | **CLOSED** |
| `materials`/`invMaterials` | `state.invMaterials` (cache) | `inv_materials`, real | `pgCreateMaterial`/`pgUpdateMaterial`/`pgDeleteMaterial` (both `MaterialsPage.jsx` and `InventoryPage.jsx`) | 5 files, unified | No | Yes | Yes (incl. `teacher`/`description`/`added_at`) | **CLOSED** |
| `parentExtras`/`parents` | `state.parents` (cache) | `parents`, real | `pgCreateParent`/`pgUpdateParent` | `CommunicationPage.jsx` | No | Yes | Yes | **CLOSED** |
| `matDist` | none — pure derived view | `inventory_txn` (already real) | N/A — write path is `pgSaveMaterialDistribution`, unchanged since Phase 3B-12 | 4 files, all via `deriveMatDist(inventoryTxn)` | No | Yes (already was) | Yes (already was) | **CLOSED** |
| **`teachers`** | `localStorage['studix-auth-teachers']` (live, actively used) | `teachers`, real, boot-synced, **0 rows live** | None to PG at all — `auth.context.jsx`'s own local state only | `UsersPage.jsx` Teachers tab | **Yes — total, zero PG connection** | No (`pgCreateTeacher`/etc. do not exist, re-confirmed this session) | N/A | **DEFERRED BY EXPLICIT DECISION** — reaffirmed again this turn |
| **`MOCK_GROUPS`** | Hardcoded array (`mockData.js`) | `groups`, real, boot-synced, writable, **0 rows live** (re-confirmed) | N/A — intake dropdown only | `AdmissionsPage.jsx` intake form | Effectively no (the *real* group link, `confirmedGroupId`, is already correctly wired via `realGroups`) | Yes | Yes | **DEFERRED BY EXPLICIT DECISION** — blocked on real `groups` data, not code |
| **`cashboxes` local seed (`cb_main`)** | Mechanism already real; `cashboxes.count()` = 0 live (re-confirmed) | `cashboxes`, real, writable | `pgCreateCashbox`/`pgUpdateCashbox`, already correct | `TreasuryPage.jsx` | No (mechanism correct) | Yes | Yes | **INVESTIGATE** — needs a real-browser export this audit cannot obtain |
| **Inventory's own direct stock-transaction entry** | `addInventoryTxn` (local `set()` only) | `inventory_txn`, real, writable | None — `TxnFormModal.jsx`/`CountModal.jsx` never call any `pg*` function | `InventoryPage.jsx`'s own ledger view | **Yes** | No (`pgCreateInventoryTxn` does not exist, re-confirmed) | Yes | **DEFERRED BY EXPLICIT DECISION** — Materials Phase's own decision #f, reaffirmed at Materials closure |
| **`admissionSystemLog`/`wa_report_log` hardening** | Already real, already write correctly | Same tables, already real | Already real (`pgCreateAdmissionSystemLog`/`pgCreateWaReportLog`) | Already correct | No (this is a protection gap, not a persistence gap) | N/A — already writable | N/A | **DEFERRED BY EXPLICIT DECISION** — Decision 5, explicitly named as not-to-touch this turn |
| **Frontend session-invalidation (401 handling)** | N/A | N/A | N/A | N/A | No | N/A | N/A | **OUT OF SCOPE** — not a persistence/business-data question |
| **`inventorySettings`** | Boot-synced, singleton-merge-fixed | Real | **None anywhere** — no UI to edit it exists | `InventoryPage.jsx` (read-only) | No (nothing writes it, locally or remotely) | N/A (would use generic CRUD if built) | Yes | **OUT OF SCOPE** — unbuilt feature, not a bypassed-Postgres problem |
| **`tc_center_profile`** | Standalone `localStorage` key, always in sync with `studix-v1`'s own copy (single writer) | `center_profile`, real, already the actual write target | `setCenterProfile` (writes both together) | Its own initializer only | No (provably cannot diverge) | Yes | Yes | Low-value cleanup, previously `REMOVE_LEGACY`, unactioned |
| **`studix_autobackup`** | Write-only diagnostic snapshot | N/A | `saveAutoBackup` | None, zero consumers | No | N/A | N/A | Low-value cleanup, previously `REMOVE_LEGACY`, unactioned |
| `tc_theme`, `tc_error_log`, `tc_session`, `tc_login_attempts` | Correctly local by design | N/A | N/A | N/A | No | N/A | N/A | **OUT OF SCOPE** — not business data |
| `treasuryMeta`, `removeCashbox` (dead code) | N/A | N/A | Zero consumers/callers | Zero | No | N/A | N/A | **CLOSED** (dead, harmless) |

---

## sessionStorage — infrastructure, not business data

`sessionStorage['tc_session']` (`auth.context.jsx`) mirrors the logged-in user's identity for UI convenience only; the real authorization check is always re-verified server-side on every request. This is authentication *infrastructure*, explicitly and correctly excluded from every persistence audit in this engagement as not being business data — re-confirmed unchanged this session (same key, same mirror-only role, no new sessionStorage key found anywhere in a fresh project-wide grep).

---

## Closed Items (not reopened — no regression found)

- **Identity/Auth stabilization** — `studix-auth-users`/`studix-auth-roles` remain cleanup-only in `SettingsPage.jsx`'s `handleClearAll`, re-confirmed present only there this session; no other reference anywhere.
- **Materials** — both write paths (`MaterialsPage.jsx`, `InventoryPage.jsx`) still call the real `pgCreateMaterial`/`pgUpdateMaterial`/`pgDeleteMaterial`; `inv_materials` still has its 3 unified columns and its original 11; live count still 1 (the same pre-existing verification row every prior audit this session has found).
- **`parentExtras`** — a fresh grep finds zero references anywhere outside one test's `describe(...)` label string; `parents` still 0 rows live, schema unchanged.
- **`matDist`** — zero independent state remains (confirmed by fresh grep — only the already-dead `store/index.js` shim retains a stale reference, unreachable from the app); the backend reconciliation logic in `materialDistribution.js` is byte-identical to the version this session traced repeatedly.

No fresh evidence in this pass contradicts any of the four post-implementation audits already on file for these domains.

## Fresh Finding: did closing `matDist` change any remaining candidate's risk or ranking?

**Investigated specifically, not assumed.** The one plausible interaction is Inventory's own direct stock-transaction entry (`TxnFormModal.jsx`) — since it can select the exact transaction types (`studentDelivery`, `reservation`, `reservationRelease`, `return`) that `deriveMatDist` now reads. Traced precisely: `TxnFormModal.jsx` attributes a delivery-type entry to a free-text `recipient` field (`"اسم الطالب/المستلِم"`), **never a real `studentId`** — confirmed by direct code read. Because `deriveMatDist` keys strictly by `studentId`, any such locally-only-entered transaction produces an orphaned key that cannot match any real student's derived record. **Conclusion: closing `matDist` did not newly expose Inventory's already-known, already-deferred local-only gap to any additional risk** — the two remain cleanly isolated by construction. This is a genuine, evidence-based non-finding, not an assumption.

No other remaining candidate has any file-level or data-level relationship to `matDist`, `parentExtras`, or Materials — confirmed by grep across every item in the matrix above.

---

## Ranking (of what remains — none qualifies as a clean "next phase" without a decision)

1. **Teachers** — still the single strongest evidence match for "real backend readiness, zero real write path" of anything in the codebase (a real `teachers` table, boot-synced, but literally zero `pgCreate/Update/DeleteTeacher` functions, with the actually-used data fully isolated in `localStorage`). **Excluded from candidacy by your own standing, repeated, explicitly-reaffirmed deferral.**
2. **Inventory's own direct stock-transaction entry** — a real, still-open local-only write path with real PG readiness (`inventory_txn` is writable, the pattern for wiring it is already proven twice over — `pgCreateMaterial`, `pgSaveMaterialDistribution`). **Excluded by the Materials phase's own explicit decision #f, reaffirmed at Materials closure**, and not named as reopened by anything in this turn's instructions.
3. **`MOCK_GROUPS` → real `groups`** — code-trivial (the real link, `confirmedGroupId`/`realGroups`, already exists in the same file) but has **zero value to implement while `groups` has 0 real rows** — blocked on data this audit cannot manufacture, not on readiness.
4. **`cashboxes` local seed** — mechanism already correct; the only open question (does any real payment history depend on the local-only `cb_main` seed in some browser) is unanswerable from this machine.
5. **`admissionSystemLog`/`wa_report_log` hardening** — real and open, but a different category of work (protecting an already-real write path) than "migrate a domain off local-only persistence," and explicitly named as not-to-touch this turn.
6. Everything else (session-invalidation, `inventorySettings`, `tc_center_profile`/`studix_autobackup`, dead code) — either out of scope for a persistence audit or low-value cleanup, not migration candidates.

## Recommended Next Phase

**None. This audit does not recommend starting a new migration phase, because no remaining item meets the evidence bar every prior phase was held to without first requiring a decision that is explicitly yours to make, not something this audit is entitled to infer:**

- If Teachers' deferral is lifted → it immediately becomes the strongest, best-evidenced candidate of everything surveyed, by a wide margin.
- If Inventory's own direct-transaction-entry deferral is lifted → it becomes the second-strongest candidate, and is the smallest, most isolated piece of remaining work of any item in this matrix (a single form, a pattern already proven twice, zero schema change).
- If real `groups` data is ever entered → `MOCK_GROUPS` becomes a trivial, low-risk, same-file fix.
- If the scope is deliberately widened to include hardening (not persistence migration) → `wa_report_log`'s complete lack of any protective trigger is the most concrete, evidenced, live gap of that different category.

**No decision is made here.** This report's purpose is to state plainly that the "migrate a local-only collection onto PostgreSQL" arc that ran through Materials, `parentExtras`, and `matDist` has reached a genuine stopping point — not because the codebase is now perfect, but because everything real that remains is gated behind a decision, not a readiness gap this audit can resolve on its own.

## Dependencies / Blockers

- Teachers: your explicit decision to lift the deferral (nothing else blocks it technically).
- Inventory's direct transaction entry: your explicit decision to reopen the Materials-adjacent inventory-transaction scope (nothing else blocks it technically; the derivation-safety finding above removes the one concrete risk this audit could identify).
- `MOCK_GROUPS`: real `groups` data existing (external, not a decision).
- `cashboxes`: a real-browser data export (external, not resolvable here).
- `admissionSystemLog`/`wa_report_log`: your explicit decision to scope in hardening work, a different kind of phase than the ones completed so far.

## Decisions That Must Be Made Before Any Further Implementation

1. Does Teachers' deferral remain in force? (Default: yes, per every standing instruction including this turn's.)
2. Does Inventory's own direct-transaction-entry deferral remain in force? (Default: yes, per the Materials phase's own explicit decision, not reopened by this turn's instructions.)
3. Is there any appetite to widen scope beyond "collection migration" into hardening (`admissionSystemLog`/`wa_report_log`) or UX (session-invalidation) work? (Default: no, explicitly excluded this turn.)
4. Is there a real-browser data source available to resolve the `cashboxes` `cb_main` question? (If not, it remains permanently INVESTIGATE, not actionable.)

---

**No code, schema, database, or localStorage was modified to produce this report. Stopping here — no Phase 3B-17 was started or assumed. Waiting for your review.**
