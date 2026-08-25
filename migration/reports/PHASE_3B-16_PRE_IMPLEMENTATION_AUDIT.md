# Phase 3B-16 — Pre-Implementation Audit

**Status: READ-ONLY.** No code, schema, database, localStorage, or configuration was modified to produce this report. Live database checks used only `SELECT`/`information_schema` queries. Nothing here is authorized or implemented. Materials is CLOSED and was not touched.

---

## Headline finding — Phase 3B-16 has no pre-existing defined scope anywhere in this project

Before proposing anything, this audit searched exhaustively for an existing "Phase 3B-16" specification: every `.md`/`.js`/`.jsx` file under `migration/`, `src/`, and `backend/` was grepped for `3B-16`/`3B16`. Every match is a **boundary marker** — a statement that Materials work "has not started/touched Phase 3B-16" — never a scope definition. There is no ticket, no section, no comment anywhere that says what Phase 3B-16 is supposed to contain.

This is not an oversight to route around — it turns out to be **how every phase in this series has worked**. `PHASE_3B-15_ACTIVITY_LOG_AUDIT.md` §0 says so explicitly about itself: *"No `PHASE_3B-15_*` (or later) report existed before this one, and no migration-plan document names an explicit 'next phase'... I determined the next candidate by checking which of the 27 tables still has zero real write path in practice despite the backend already being capable."* Each phase number, historically, was assigned **after** an audit identified a candidate — not assigned to a pre-written spec. `POST_STABILIZATION_VERIFICATION_AUDIT.md` §D independently confirms this: it lists four concrete, named priorities and then, as a fifth and explicitly lowest-priority item, "*any new migration phase (3B-16 or otherwise)*" — using the term as a generic placeholder for "whatever comes next," not as a name for a specific body of work.

**Per this audit's own instruction #5 ("do not infer or invent missing requirements") and #6 ("identify all ambiguities as DECISION NEEDED"), this audit does not assign Phase 3B-16 to any candidate on its own authority.** Instead, following the exact methodology `PHASE_3B-15_ACTIVITY_LOG_AUDIT.md` itself used, this audit surveys the current system for candidates matching that same identification criterion — "a domain where the backend is genuinely ready (a real model, a writable route, ideally already boot-synced) but the frontend still writes only to local state" — cross-referenced against every deferred item already named in prior reports, and presents a ranked, evidence-backed recommendation. **This is a proposal requiring your explicit confirmation, not a scope this audit is entitled to decide.**

---

## 1. Candidate survey (applying Phase 3B-15's own identification method, fresh this session)

Every item below was independently re-verified this session (live query or fresh grep), not carried forward from older reports on trust.

| Candidate | Backend readiness | Frontend write path today | Shape of gap | Prior report |
|---|---|---|---|---|
| **`parentExtras` → real `parents`** | `parents` table real, boot-synced (`PG_COLLECTIONS`), fully writable (`/api/parents`, not in `READ_ONLY_COLLECTIONS`), has the exact 4 columns needed (`alt_phone`/`preferred_method`/`preferred_time`/`notes`) | **Zero** — `grep` for `pgCreateParent`/`pgUpdateParent` in `api.js` returns nothing; `CommunicationPage.jsx` still only reads/writes the local `parentExtras` map | Exact match to 3B-15's own criterion: ready backend, zero real write path | `REMAINING_LOCAL_BUSINESS_DATA_DECISION_AUDIT.md` §B |
| **`matDist` stale-read fix** | `inventory_txn` real, writable via the dedicated `PUT /api/material-distributions/:materialId` (Phase 3B-12) — a real write path **already exists** | Write is real; only the **read** side (`MaterialsPage.jsx`/`MaterialDistribution.jsx`/`MaterialReports.jsx`/`StudentReportPage.jsx` all still read the local, never-boot-synced `matDist` array) is stale | Different shape — not "zero write path," a read-derivation gap on an already-real write | `FINAL_LOCAL_PERSISTENCE_AUDIT.md` §6; re-confirmed fresh this session (`matDist`/`setMatDist` unchanged, still absent from `PG_COLLECTIONS`) |
| **Teachers domain** | `teachers` table real, boot-synced, but **0 rows live** (re-confirmed this session); no CRUD route wired to any frontend teacher-management UI | `auth.context.jsx`'s own separate `studix-auth-teachers` `localStorage` state is what `UsersPage.jsx`'s Teachers tab actually uses — zero connection to the real `teachers` table | Matches the "zero write path" criterion in shape, but is explicitly, repeatedly deferred | `POST_STABILIZATION_VERIFICATION_AUDIT.md` §D.3 ("still the largest remaining gap"); explicitly out-of-scope by direct user instruction throughout the Materials work and this session generally |
| **`admissionSystemLog`/`wa_report_log` write-hardening** | Both already write to Postgres in practice — this is about tightening an *existing* writable path, not building one | Already real (this is Decision 5's deferred security-hardening item, not a migration) | Different shape entirely — hardening, not migration | `POST_STABILIZATION_VERIFICATION_AUDIT.md` §B/§D.2; DB triggers re-confirmed live this session: `admission_system_log` has `trg_no_delete_admlog` (DELETE only); `wa_report_log` has **zero** triggers at all |
| **Frontend session-invalidation (401 handling)** | N/A — this is a frontend auth-flow gap, not a data-migration item | `auth.context.jsx` has no global 401 handler; re-confirmed this session (no `401`-handling code, no `auth_version` check on the frontend at all) | Different shape entirely — UX/auth-flow fix, doesn't match the 3B-N "migrate a collection" pattern | `POST_STABILIZATION_VERIFICATION_AUDIT.md` §B/§E |
| **`MOCK_GROUPS` → real `groups`** | `groups` table real, boot-synced, writable — but **0 rows live** (re-confirmed this session) | `realGroups` is already correctly wired in `AdmissionsPage.jsx` for the confirmation step; only the intake-stage dropdown still uses `MOCK_GROUPS` | Blocked on data existing, not on code readiness — already explicitly deferred twice | `MATERIALS_DOMAIN_DECISION_AUDIT.md`/`REMAINING_LOCAL_BUSINESS_DATA_DECISION_AUDIT.md` §C |
| **`tc_center_profile`/`studix_autobackup` cleanup** | N/A | N/A — these are dead/redundant local keys, not a migration target | Cleanup, not migration; doesn't match the 3B-N pattern | `REMAINING_LOCAL_BUSINESS_DATA_DECISION_AUDIT.md` §D/§E |
| **`cashboxes` real-vs-seed question** | Mechanism correct, but Postgres has 0 cashboxes while the local seed `cb_main` may be the only copy anywhere | N/A — this needs a real-browser export to resolve, not a code change | Cannot be resolved by any implementation on this machine | `FINAL_LOCAL_PERSISTENCE_AUDIT.md` §7 |

## 2. Recommendation (proposed, not decided)

**`parentExtras` → wiring `CommunicationPage.jsx` onto the real `parents` collection is the strongest candidate**, on the same grounds `activity_logs` was chosen for 3B-15: a fully backend-ready, boot-synced, writable collection with a genuine zero-write-path gap on the frontend, and no dependency on anything currently deferred (Teachers, `matDist`, financial hardening). It is also the #2 item (directly after the now-closed `materials`) in `REMAINING_LOCAL_BUSINESS_DATA_DECISION_AUDIT.md`'s own recommended cleanup order.

This is a **recommendation for your confirmation**, not a scope this audit has decided on its own. See §7 (DECISION NEEDED) before anything proceeds.

---

## 3. If `parentExtras` is confirmed as Phase 3B-16's scope — readiness detail

### 3.1 Affected tables, routes, services, frontend modules, persistence paths

| Layer | Item | Current state |
|---|---|---|
| Table | `parents` (`backend/prisma/schema.prisma:371-384`) | `id BigInt`, `full_name String?`, `phone String? @unique`, `alt_phone String?`, `preferred_method String?`, `preferred_time String?`, `notes String?`, `created_at`, `updated_at`; real FK relations from `admissions`, `communications` (`communications.parent_id`, currently unpopulated), `students` |
| Route | `/api/parents` (generic CRUD, `backend/src/routes/crud.js` via `makeCrudRouter('parents', { writable: true })`) | Already `GET/POST/PUT/PATCH/DELETE`, gated by `requirePermission('students')` (`server.js:62-65,79`) — no route code change needed |
| Frontend service | `src/services/api.js` | **No `pgCreateParent`/`pgUpdateParent` exists yet** — would need adding, following the exact pattern already used for every other collection (`pgCreateMaterial` etc.) |
| Frontend service | `src/modules/communication/parentService.js` | `deriveParents(records, parentExtras)` builds synthetic parent rows keyed by `parentKey(record) = phone \|\| parentName`, not a real `parents.id` — this identity mismatch is the actual implementation difficulty, not the schema or the route |
| Store | `src/store/slices/communication.slice.js` | `parentExtras: {}`, `updateParentExtra` — local-only map, keyed by the same synthetic key |
| Store | `src/store/db.middleware.js` | `parents` is already in `PG_COLLECTIONS` (boot-synced) but **absent from `app.store.js`'s `partialize`**, and has **zero consumers anywhere** — the boot-synced collection is currently fetched and thrown away every load |
| Frontend UI | `src/modules/communication/CommunicationPage.jsx`, `src/modules/communication/components/ParentEditModal.jsx` | Both operate entirely on `deriveParents`/`parentExtras`, never on `state.parents` |

### 3.2 Dependency on the now-closed Materials work

**None, functionally.** `parentExtras`/`CommunicationPage.jsx`/`parentService.js` were not touched by the Materials work and do not import anything from the materials domain. The two efforts are fully independent.

### 3.3 Teachers dependency

**None.** `parents` has no relation to `teachers` anywhere in the schema.

### 3.4 The one genuine implementation difficulty (already identified, not new)

`parentKey()` falls back to `record.parentName` when a communication record has no phone. Real `parents.phone` is `@unique`, so phone-keyed synthetic parents can find-or-create cleanly against it; **name-only-keyed synthetic parents have no safe, deterministic match** against the real table (a name is not unique). Any implementation must decide what happens to these — this is a product decision, not a technical one, and is the central open question for this candidate specifically (separate from the broader "is this even the right Phase 3B-16 scope" question).

### 3.5 Existing partial implementation check

None found. `pgCreateParent`/`pgUpdateParent` do not exist. `state.parents` has no consumer. `parentExtras` has not been touched by any change this session.

---

## 4. Confirmation: Teachers remains out of scope

Per instruction #4: Teachers is **not** treated as Phase 3B-16's scope by this audit. It appears in §1's candidate table only because `POST_STABILIZATION_VERIFICATION_AUDIT.md` names it as "the largest remaining gap" — but every report that mentions it, across this entire session and the prior stabilization work, treats it as deliberately deferred, and the user has independently reiterated "Teachers remains completely OUT OF SCOPE" as recently as the Materials decision list. **This audit recommends Teachers not be selected as Phase 3B-16 unless you explicitly say otherwise.**

---

## 5. Materials-domain dependency check (all candidates)

Only one candidate has any file-level adjacency to the just-closed Materials work: **`matDist`**, because its read path lives in the same files (`MaterialsPage.jsx`, `MaterialDistribution.jsx`, `MaterialReports.jsx`) that Materials unification touched for the *catalog* (`invMaterials`) side. There is **no functional coupling** — `matDist`'s own slice, `pgSaveMaterialDistribution`, and `backend/src/routes/materialDistribution.js` were explicitly untouched and independently re-confirmed unchanged in `MATERIALS_UNIFICATION_CLOSURE_AUDIT.md` §6. If `matDist` is ever selected as a future phase, the only relevant consequence of Materials being closed is that `MaterialsPage.jsx`'s `materials` variable is now the correctly-boot-synced `invMaterials` rather than the previously-stale `materials` — a strictly positive side effect, not a new dependency to design around.

No other candidate (`parentExtras`, Teachers, log-hardening, session-invalidation, `MOCK_GROUPS`, cleanup items) has any dependency on Materials, confirmed by grep — none of their files reference `materials`/`invMaterials`/`matDist`/`inv_materials` at all.

---

## 6. Requirement 8 — why a "complete implementation plan" is not produced here

Requirement 8 asks for exact files, schema/data changes, route/auth impact, migration impact, tests, and rollback considerations. **Producing that at full commitment-grade detail for a scope that has not been confirmed would itself be inventing a requirement** (instruction #5) — it would mean choosing among the candidates in §1 unilaterally. §3 above gives the deepest currently-available readiness detail for the leading candidate (`parentExtras`) so that, if confirmed, the next turn can move straight to a concrete plan without re-auditing from zero. A symmetrical readiness pass for any other candidate you select can be produced on request before implementation begins.

---

## 7. DECISION NEEDED

1. **Phase 3B-16's scope is undefined anywhere in the project.** Please confirm which candidate from §1 (or a different scope entirely) Phase 3B-16 should be — this audit recommends `parentExtras`, following the same identification method Phase 3B-15 used on itself, but does not decide this.
2. **If `parentExtras` is confirmed:** what should happen to communication records whose only identity is a `parentName` (no phone) — skip them, prompt for a phone before allowing edits, or accept ambiguous name-based matching? (§3.4)
3. **If Teachers is instead intended:** this contradicts the pattern of explicit deferral throughout this entire engagement and would need to be stated explicitly, given §4's recommendation against it by default.
4. **If a non-collection-migration item is intended** (session-invalidation, log-hardening, `MOCK_GROUPS`, cleanup) — these don't match the 3B-N "migrate a collection" pattern historically used for this numbering series; worth confirming whether "Phase 3B-16" is meant to continue that specific pattern or become a more general "next work item" label.

---

## 8. Confirmations required by instructions 9/10

No code, schema, database, localStorage, or configuration was modified to produce this report — only `SELECT`/`information_schema` read-only queries and file reads/greps were performed. Written to `migration/reports/PHASE_3B-16_PRE_IMPLEMENTATION_AUDIT.md` as instructed.

---

**Stopping here. Waiting for your explicit approval and scope confirmation before any implementation begins.**
