# Post-Phase-3B-16 Remaining Gaps Audit

**Status: READ-ONLY.** No code, schema, database, localStorage, configuration, or test was modified to produce this report. All live database checks used only `SELECT`/`information_schema`/`count()` queries. Nothing here is authorized or implemented.

---

## Executive Summary

Since the last full persistence sweep (`FINAL_LOCAL_PERSISTENCE_AUDIT.md`), two real gaps have closed: **Materials** (`materials`/`invMaterials` unified onto `inv_materials`, both write paths real) and **`parentExtras`** (replaced by the real `parents` table, Phase 3B-16). Identity/Auth stabilization was already closed before either. This audit re-scanned the entire project and live database from scratch and found:

- **No new local-only business-data domain has appeared.** Everything still open was already named in a prior report.
- **Exactly one domain is a textbook match for the same identification criterion used to pick every prior phase** ("real backend readiness, zero real write path"): **Teachers**. It is excluded from candidacy here only because it is under a direct, repeated, standing deferral decision spanning this entire engagement, reconfirmed by your own instruction this turn.
- With Teachers excluded, **`matDist`'s stale read-path is the strongest remaining, evidence-backed candidate** — its write side is already real and well-tested (Phase 3B-12), the read side needs to derive from data that is already boot-synced (`inventoryTxn`), it has no dependency on anything deferred, and Materials being closed this session removes the one piece of surrounding context that made it awkward to isolate before.
- Everything else remaining (`MOCK_GROUPS`, the `cashboxes` local-seed question, `admissionSystemLog`/`wa_report_log` write-hardening, frontend session-invalidation, `tc_center_profile`/`studix_autobackup`) is either blocked on a precondition this audit cannot resolve, a different category of work entirely (hardening/UX, not a persistence migration), or genuinely low-value cleanup — none of them compete with `matDist` as a "next migration phase" in the sense the 3B-N series has used the term.

---

## Complete Remaining Persistence Matrix

Legend matches the requested classification exactly: **CLOSED**, **DEFERRED BY EXPLICIT DECISION**, **READY FOR NEXT MIGRATION PHASE**, **INVESTIGATE**, **OUT OF SCOPE**.

| Item | Backend readiness | Frontend write path | Classification | Evidence source |
|---|---|---|---|---|
| `materials`/`invMaterials` | `inv_materials` real, writable, boot-synced | Both `MaterialsPage.jsx` and `InventoryPage.jsx` write through `pgCreateMaterial`/`pgUpdateMaterial`/`pgDeleteMaterial` | **CLOSED** | `MATERIALS_UNIFICATION_CLOSURE_AUDIT.md` — re-confirmed live this session: `inv_materials.count()` = 1 (unchanged baseline artifact) |
| `parentExtras`/`parents` | `parents` real, writable, boot-synced | `CommunicationPage.jsx` writes through `pgCreateParent`/`pgUpdateParent` | **CLOSED** | `PHASE_3B-16_PARENT_EXTRAS_IMPLEMENTATION_AUDIT.md` — re-confirmed this session: zero `parentExtras` references anywhere outside one test label string |
| Identity/Auth (`users`/`roles`) | Real, writable | `pgCreateUser`/`pgUpdateUser`/`pgDeleteUser`, `pgCreateRole`/etc. | **CLOSED** | `POST_STABILIZATION_VERIFICATION_AUDIT.md` — re-confirmed this session: `studix-auth-users`/`studix-auth-roles` remain cleanup-only in `SettingsPage.jsx`'s `handleClearAll`, no other reference anywhere |
| 23 other `PG_COLLECTIONS` domains (students, groups-the-mechanism, exams, grades, homeworks, hwSubmissions, attendance, absenceFollowup, communications, commTasks, cashboxes-the-mechanism, treasuryTxn, admissions, admissionFollowups, admissionPayments, activityLogs, waReportLog, centerProfile) | Real, writable | Each has a real `pgCreate*`/`pgUpdate*`/`pgSave*` function, spot-checked this session against the full `api.js` export list | **CLOSED** (as caching mechanisms — some have 0 live rows, see risk note in §"cashboxes" below) | `FINAL_LOCAL_PERSISTENCE_AUDIT.md` §3, unchanged |
| **`teachers`** | Real table, boot-synced (`PG_COLLECTIONS`), **0 rows live** | **Zero** — no `pgCreateTeacher`/`pgUpdateTeacher`/`pgDeleteTeacher` exists anywhere in `api.js` (confirmed by grep this session). The live, actually-used teacher data is `auth.context.jsx`'s own separate `localStorage['studix-auth-teachers']`, fully disconnected from the real table | **DEFERRED BY EXPLICIT DECISION** | Deferred explicitly and repeatedly: Materials decisions, Phase 3B-16 decisions, `POST_STABILIZATION_VERIFICATION_AUDIT.md` §D.3, and this turn's own instruction ("Teachers remains deferred/out of scope unless there is an explicit existing decision saying otherwise" — no such decision exists) |
| **`matDist`** | `inventory_txn` real, writable via the dedicated `PUT /api/material-distributions/:materialId` (Phase 3B-12) — **write path already real** | `MaterialsPage.jsx`/`MaterialDistribution.jsx`/`MaterialReports.jsx`/`StudentReportPage.jsx` all still read the local `matDist` array (confirmed still absent from `PG_COLLECTIONS` this session) — write-real, read-stale | **READY FOR NEXT MIGRATION PHASE** (see §"Recommended Next Phase Candidate") | `FINAL_LOCAL_PERSISTENCE_AUDIT.md` §6; fresh evidence in this audit changes its status from "deferred, smallest, can be done anytime" to "the strongest available candidate" now that Teachers is off the table and Materials' surrounding files are already clean |
| **`MOCK_GROUPS`** | `groups` real, writable, boot-synced, **0 rows live** (re-confirmed this session) | `realGroups`/`confirmedGroupId` already correctly wired in `AdmissionsPage.jsx` for the confirmation step; only the intake-stage dropdown still uses the hardcoded array | **DEFERRED BY EXPLICIT DECISION** (blocked on `groups` having real data, not on any code gap) | `MATERIALS_DOMAIN_DECISION_AUDIT.md`/`REMAINING_LOCAL_BUSINESS_DATA_DECISION_AUDIT.md`; live-reconfirmed `groups.count()` = 0 this session |
| **`cashboxes` local seed (`cb_main`)** | Mechanism fully real and correctly wired (`pgCreateCashbox`/`pgUpdateCashbox`, confirmed server-truth-first in `TreasuryPage.jsx`) — `cashboxes.count()` = 0 live | N/A — nothing to migrate in code; the open question is whether any real payment history in some browser depends on the local-only seed `cb_main`, which cannot be determined from this machine | **INVESTIGATE** (unresolvable by code inspection; needs a real-browser export) | `FINAL_LOCAL_PERSISTENCE_AUDIT.md` §7, unchanged |
| **`admissionSystemLog`/`wa_report_log` write-hardening** | Both already write to Postgres correctly. `admission_system_log` has `trg_no_delete_admlog` (DELETE-only protection). `wa_report_log` has **zero triggers at all** (re-confirmed live this session) | N/A — this is about tightening an *already-real* writable path against tampering (add UPDATE protection / any protection), not building a missing one | **DEFERRED BY EXPLICIT DECISION** (Decision 5, explicitly named as its own pending audit in multiple reports; this turn's instruction also names it as not-to-be-touched) | `POST_STABILIZATION_VERIFICATION_AUDIT.md` §B/§D.2 |
| **Frontend session-invalidation (401 handling)** | N/A — pure frontend auth-UX gap, not a persistence/business-data question | `auth.context.jsx` still has no global 401 handler (re-confirmed: no `401`-handling code, no `auth_version` check anywhere in the frontend) | **OUT OF SCOPE** for this audit (not a "local business-data persistence" or "PostgreSQL migration" matter — a UX gap in an already-closed domain) | `POST_STABILIZATION_VERIFICATION_AUDIT.md` §B/§E |
| **`inventorySettings`** | Real, boot-synced, singleton-merge-fixed (Phase 3B-11) | **No writer anywhere** — `InventoryPage.jsx` only reads it; there is no UI to edit it at all | **OUT OF SCOPE** (not a persistence gap — nothing writes it locally *or* remotely; this is an unbuilt feature, not data bypassing Postgres) | Confirmed fresh this session by grep |
| **`tc_center_profile`** (standalone key) | `center_profile` real, already the actual write target via `SettingsPage.jsx` | Both `tc_center_profile` and `studix-v1`'s own `centerProfile` are written by a single shared action (`setCenterProfile`) — provably cannot diverge | **DEFERRED BY EXPLICIT DECISION** in spirit — previously classified `REMOVE_LEGACY` (safe to retire, not required), never actioned since no one has approved the small code change to stop the dual-write | `REMAINING_LOCAL_BUSINESS_DATA_DECISION_AUDIT.md` §D; unchanged this session |
| **`studix_autobackup`** | N/A — write-only diagnostic snapshot | Confirmed still write-only, zero consumers, re-confirmed this session | **DEFERRED BY EXPLICIT DECISION** in spirit — previously classified `REMOVE_LEGACY`, same status as above | `REMAINING_LOCAL_BUSINESS_DATA_DECISION_AUDIT.md` §D; unchanged this session |
| `tc_theme`, `tc_error_log`, `tc_session`, `tc_login_attempts` | N/A | Correctly local by design (UI preference, diagnostics, session mirror, cosmetic lockout counter) | **OUT OF SCOPE** — not business data, not candidates for any migration phase | `FINAL_LOCAL_PERSISTENCE_AUDIT.md` §1, unchanged |
| `treasuryMeta` | N/A | Zero consumers anywhere (re-confirmed this session) | **CLOSED** (dead, harmless, no action needed) | `FINAL_LOCAL_PERSISTENCE_AUDIT.md` §8, unchanged |
| `removeCashbox` action | Real backend has no `pgDeleteCashbox` at all | Destructured in `TreasuryPage.jsx` but **never actually invoked anywhere** — no delete-cashbox UI exists | **OUT OF SCOPE** (dead code, not a persistence problem — nothing writes locally that should be writing to Postgres, because nothing writes at all) | Confirmed fresh this session; noted per instruction not to propose cleanup for dead code alone |
| Inventory's own direct stock-transaction entry (`addInventoryTxn`, `TxnFormModal.jsx`/`CountModal.jsx`) | `inventory_txn` real, writable via generic CRUD (untouched) | Still local-only — confirmed unchanged this session (`addInventoryTxn` still a plain `set()` call, no `pgCreateInventoryTxn` exists) | **DEFERRED BY EXPLICIT DECISION** (explicitly, recently reaffirmed out of scope in the Materials work: *"existing inventory transaction behavior is unchanged"*) | `MATERIALS_UNIFICATION_IMPLEMENTATION.md` §5, `MATERIALS_UNIFICATION_CLOSURE_AUDIT.md` §6 |

---

## Already-closed items explicitly excluded from candidacy

Per your instruction, these are not reopened or re-litigated here, only cited for completeness of the matrix above: **Materials** (all of it — the `inv_materials` schema, both write paths, the `teacher`/`description`/`addedAt` fields), **Phase 3B-16 `parentExtras`** (all of it — the real `parents` wiring, the phone-normalization matching, the disabled-Save-on-no-phone behavior), and **Identity/Auth stabilization** (users/roles/session-invalidation-mechanism, permission enforcement). Nothing in this audit's findings implicates or requires touching any of these.

## Deferred / out-of-scope items (not proposed as next-phase candidates, why)

- **Teachers** — the single strongest evidence-based match for "real backend readiness, zero real write path" of anything found in this audit, but under a direct, repeated, standing deferral you have reaffirmed this turn. Not proposed.
- **`MOCK_GROUPS`** — blocked on `groups` having real data (0 rows, live-confirmed), not on any code readiness gap. Nothing to migrate until that precondition changes.
- **`cashboxes` local seed** — mechanism already correct; the only open question needs a real-browser export this audit cannot obtain.
- **`admissionSystemLog`/`wa_report_log` hardening** — a real, still-open gap, but a different category of work (protecting an already-real write path) than "migrate a domain off local-only persistence." Explicitly named as not-to-be-touched this turn.
- **Session invalidation** — an auth-UX gap in an already-closed domain, not a business-data persistence question.
- **`tc_center_profile`/`studix_autobackup`** — low-value cleanup with zero data-integrity stakes (both provably safe to remove, per the cited reports), not something requiring a "migration phase."
- **Inventory's own direct stock-transaction entry** — explicitly, recently reaffirmed out of scope during the Materials work itself.

---

## Recommended Next Phase Candidate: `matDist` (write-real / read-stale)

### Why it is the strongest candidate given the constraints

Applying the same criterion used to select every prior phase (a domain with real backend readiness but a genuine local-only or split write path) to everything found in this audit: **Teachers is the only stronger match, and it is explicitly excluded.** Among everything else, `matDist` is the only item that is (a) a genuine split-brain/local-only persistence gap in the collection-migration sense the 3B-N series targets, (b) not blocked by an external precondition this audit cannot resolve (unlike `MOCK_GROUPS` and the `cashboxes` seed question), (c) not a different category of work like hardening or UX (unlike `admissionSystemLog`/session-invalidation), and (d) not explicitly deferred by standing decision (unlike Teachers and inventory's own direct transactions).

Two additional, fresh points specific to this audit:
- **The write side is already real, already atomic, already tested** (`backend/src/routes/materialDistribution.js`, Phase 3B-12) — this phase would only need to fix the *read* side, a materially smaller lift than either Materials or `parentExtras` required (both of which needed new write functions built from scratch).
- **Materials being closed this session directly improves this candidate's context**: `MaterialsPage.jsx`, `MaterialDistribution.jsx`, and `MaterialReports.jsx` — the three files that would need to change their `matDist` read logic — now correctly read the boot-synced `invMaterials` instead of the previously-stale `materials`. One less moving part than existed when `matDist` was first flagged.

### Dependencies / blockers

None on Teachers, Materials, `parentExtras`, or any deferred item. The one real dependency is conceptual, not blocking: the fix must correctly *derive* per-student `received`/`payStatus`/`paidAmount` from `inventory_txn`'s history (types `studentDelivery`/`reservation`/`reservationRelease`/`return`, plus `legacy_metadata` for `payStatus`/`paidAmount`/`receivedAt`) — the same reconciliation logic `backend/src/routes/materialDistribution.js` already implements server-side for writes. A correct read-side derivation needs to mirror that logic's *meaning* (not necessarily its code), which is the one piece of real design work this candidate requires — smaller than either of the last two phases, but not zero.

### Exact affected domain/files (high level only — no implementation plan is proposed here)

- Read side: `src/modules/materials/MaterialsPage.jsx`, `MaterialDistribution.jsx`, `MaterialReports.jsx`, `src/modules/student-report/StudentReportPage.jsx` — all currently read `s.matDist`.
- Store: `src/store/slices/materials.slice.js` (`matDist`/`setMatDist`/`addMatDist`/`updateMatDist`) and `app.store.js`'s `partialize` entry for `matDist`.
- Boot-sync: `src/store/db.middleware.js`'s `PG_COLLECTIONS` (currently omits `matDist`; `inventoryTxn` is already present and already correctly boot-synced).
- Backend: `backend/src/routes/materialDistribution.js` — likely read-only reference for the write-side's exact reconciliation semantics; not expected to need changes, but that determination belongs to a dedicated audit, not this one.

### Risks

- Getting the read-side derivation subtly wrong (e.g., mishandling `legacy_metadata`-only updates vs. real type-changing events) could show incorrect payment/received status on the Materials/Distribution/Student-Report UI — a real, user-visible correctness risk, not just a cosmetic one, given this touches money-adjacent display (`paidAmount`/`payStatus`).
- Any fix here should explicitly re-verify it does not disturb `MaterialDistribution.jsx`'s own write path (`pgSaveMaterialDistribution`), which is already correct and already tested — the same "don't touch what already works" discipline every prior phase in this session has maintained.

### Recommended implementation order (if this candidate is approved)

1. A dedicated, focused, read-only implementation audit for `matDist` specifically — tracing every reader, the exact `inventory_txn` shape/semantics needed, and producing a concrete plan — mirroring exactly how `PHASE_3B-16_PARENT_EXTRAS_IMPLEMENTATION_PLAN.md` was produced before any code was written. Not performed here, since this audit's scope was the broader gap survey, not a single-domain implementation plan.
2. Only after that plan is reviewed and approved: implementation, tests, build, and a fresh post-implementation audit — the same four-step pattern used for both Materials and Phase 3B-16.

---

**This is audit only. No code, schema, database, or localStorage was modified. Phase 3B-17 (or whatever number/name this becomes) has not started. Waiting for your review.**
