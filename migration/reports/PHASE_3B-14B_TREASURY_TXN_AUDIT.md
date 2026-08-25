# Phase 3B-14B — `treasury_txn`: Read-Only Pre-Implementation Audit, Implementation & Closure

**Status: CLOSED — implemented and verified, pending your final sign-off on §17.** Scope is `treasury_txn` manual entries only (not yet linked to `payments`/`admission_payments` — that's 3B-14C/D), per the approved sequencing. §§1–10 (below) are the original read-only audit, re-verifying the live code and live DB fresh rather than trusting the parent `PHASE_3B-14_FINANCIAL_DOMAIN_AUDIT.md` or the 3B-14A report. §§11–15 record what was actually implemented after your Decision Gate approval, including one significant bug this session's own DB verification caught and fixed before anything was ever written to the live database, and one structural constraint (`treasury_txn`'s unconditional append-only protection) that changed how "zero residue" verification had to be done for this table specifically. **§17 (added during your closure review) corrects a wrong claim in §15:** the original "concurrency verified logically" conclusion was untested and turned out to be false — a deterministic scratch-database test found a real double-reversal race, which is now fixed in `treasuryTxn.js` and re-verified safe. Read §17 before treating this report as final.

---

## 1. Current architecture inventory (re-verified this session)

**State + actions** (`src/store/slices/treasury.slice.js`, re-read in full): `addTreasuryTxn` (enforces `cashboxId` client-side, throws if missing), `updateTreasuryTxn`, `reverseTreasuryTxn` (creates a linked opposite-type reversal row + marks the original `status:'reversed'`), `transferBetweenCashboxes` (creates a linked `outTxn`/`inTxn` pair sharing a `transferId`), `addLinkedTxn` (payments-domain, out of scope), plus legacy-compat `approveTreasuryTxn`/`rejectTreasuryTxn`/`reverseLinkedTxn`.

**[VERIFIED FACT — re-confirmed]** `updateTreasuryTxn`, `approveTreasuryTxn`, `rejectTreasuryTxn` are defined but **never called anywhere** in the app (grep-confirmed zero call sites in `src/`). Only `reverseTreasuryTxn` (via `TreasuryPage.jsx`'s reverse button, and via `PaymentsPage.jsx`'s `reverseLinkedTxn` on payment delete — a 3B-14C-scope call site that already exists today, out of scope to change but worth knowing this endpoint will be reused later) is actually exercised.

**Builders** (`src/services/cashboxService.js`, re-read in full): `buildCashboxTxn` (single manual entry, `createdBy='system'` default), `buildTransfer` (the linked pair), `getCashboxBalance`/`getRunningBalance` (derived balance, filtering `status !== 'reversed' && status !== 'rejected'`), `validateTxn`/`validateTransfer` (client-side; `validateTransfer` includes a client-computed sufficient-balance check).

**UI write paths — all three live in `TreasuryPage.jsx` itself, re-read in full:**
- `handleSaveTxn` (manual income/expense entry): `buildCashboxTxn(formData, currentUser?.id)` → `addTreasuryTxn(txn)` → **one row**.
- `handleTransfer`: `buildTransfer({...}, currentUser?.id)` → `addTreasuryTxn(outTxn)` + `addTreasuryTxn(inTxn)` → **two linked rows**, one JS `set()` call each (not one atomic operation today — two separate local mutations in sequence).
- `handleReverse`: `reverseTreasuryTxn(txn.id, 'عكس يدوي', currentUser?.id)` → **one new row + one row updated**, reason is a **hardcoded literal string** (`'عكس يدوي'`, "manual reversal") — there is no UI input for a custom reversal reason on this path (contrast with `PaymentsPage.jsx`'s `RefundView`, which does have a reason textarea — a 3B-14C concern, not 3B-14B).

**[VERIFIED FACT]** All three of `TreasuryPage.jsx`'s own write call sites pass `createdBy: currentUser?.id` — never the literal `'system'` string the parent audit flagged as a risk elsewhere (that risk is specifically in `AdmissionsPage.jsx`'s `'admissions'` literal and `buildCashboxTxn`'s own default parameter, neither of which this page's call sites trigger under normal operation). Residual edge case: if `currentUser` were ever `null` at call time, `currentUser?.id` evaluates to `undefined`, which **does** trigger `buildCashboxTxn`'s `createdBy='system'` default (JS default-parameter semantics activate on `undefined`, not just on omission) — a low-probability path (the route is `requireAuth`-guarded server-side regardless) but worth naming.

## 2. Newly-verified findings not present in the parent Financial Domain audit

**[NEW CONTRADICTION — dead, shadowed component files]** `src/modules/treasury/components/TxnForm.jsx` and `src/modules/treasury/components/LedgerTable.jsx` are **100% dead code** — grep-confirmed zero imports anywhere in `src/`. `TreasuryPage.jsx` defines its **own, same-named, differently-shaped** `function TxnForm(...)` (line 131) and `function LedgerTable({ txns, onReverse })` (line 319) locally, and uses those instead. The standalone `components/LedgerTable.jsx` even has a different prop contract (`{ transactions, onEdit, onDelete }` vs the real one's `{ txns, onReverse }`) — passing it live props from `TreasuryPage.jsx` as currently written would crash. This is a third instance of the "superseded implementation left in the tree" pattern already found in the parent audit (`treasuryService.js`'s dead functions, `transactionEngine.js`, `hooks/usePayments.js`). Anyone reading `components/TxnForm.jsx`/`components/LedgerTable.jsx` to understand "how does the treasury UI work" would be looking at the wrong code.

**[NEW FACT]** The real, live `LedgerTable`'s reverse button is conditioned on `tx.status==='active' && !tx.refType && onReverse` (line 414) — **transactions with any `refType` set (payment-linked, admission-linked, and transfer legs themselves) cannot be reversed through this UI at all.** Only pure manual entries (no `refType`) are reversible. This is a clean, favorable alignment with 3B-14B's scope (manual entries only) — the reversal feature this sub-phase needs to make real is exactly the one the UI already restricts to manual entries; transfer-leg and payment-linked reversal (if ever needed) is implicitly out of scope here.

**[NEW FACT]** `src/types/index.ts:129` declares `export type TxnStatus = 'active' | 'reversed' | 'pending' | 'rejected'` — a TypeScript type never imported by any `.jsx` file in this app (grep-confirmed). Dead documentation, consistent with `transactionEngine.js` being the origin of this 4-value vocabulary; not load-bearing, low-priority cleanup candidate per the already-approved Decision 5.

**[NEW FACT]** `src/modules/inventory/inventoryService.js:98` also filters on `t.status !== 'reversed'` — this is an **entirely separate, unrelated table** (inventory transactions, not `treasury_txn`). Noting explicitly so it is never mistaken for treasury scope in a future grep-driven change.

## 3. Live PostgreSQL schema — fresh re-query this session (identical to the parent audit; no drift, confirming nothing changed since no DB write has occurred)

```
treasury_txn: id (text, PK, no default), cashbox_id (text, NOT NULL, FK→cashboxes.id),
date (date, NOT NULL), type (text, NOT NULL), category (text, NOT NULL, no CHECK),
amount (numeric(12,2), NOT NULL), method (text, NOT NULL, default 'cash'),
party/notes (text, nullable), status (text, NOT NULL, default 'active'),
ref_type/ref_id (text, nullable), payment_id (text, nullable, FK→payments.id),
admission_id (text, nullable, FK→admissions.id), source_module/source_doc_no (text, nullable),
created_by (text, nullable, FK→users.id), created_by_name (text, nullable, no FK),
created_at (timestamptz, NOT NULL, default now())
```
- **Checks (re-confirmed, unchanged):** `chk_treasury_type: type IN ('income','expense')`; `chk_treasury_method: method IN ('cash','transfer','instapay','check')`; `chk_treasury_status: status IN ('active','cancelled')`; `chk_treasury_amount: amount > 0`. **No CHECK on `category`** — free string, confirmed no vocabulary risk regardless of what `INCOME_CATEGORIES`/`EXPENSE_CATEGORIES` (`treasuryService.js`) contain.
- **Only trigger:** `trg_no_delete_treasury` (BEFORE DELETE → `prevent_delete()`) — **DB-level append-only protection already exists for this table.** Unlike `cashboxes`, no app-level DELETE guard is structurally required to prevent hard delete — the database itself refuses it unconditionally, for every caller, with no escape hatch. (Whether to *also* add a clean app-level 405 for a better error than the DB's raw exception is a UX question, not a safety one — see §6.)
- **`cashbox_id` is NOT NULL with a real FK, no default.** Live row counts this session: `cashboxes = 0`, `treasury_txn = 0`, `users = 1`. **Operational consequence, not a design flaw:** no `treasury_txn` row can be inserted until at least one real `cashboxes` row exists in PostgreSQL — and none does yet, because 3B-14A enabled the write path but no user has created one through it yet. 3B-14B's own testing/rollout will need at least one real cashbox to exist first.
- **`created_by` FK is real** (re-confirmed) — exactly one real user row exists in the live DB today (`users` count = 1), which is the only valid non-null value the FK will currently accept.

## 4. Method/category vocabulary — clean, no contradiction for this table specifically

**[VERIFIED FACT]** `TxnForm`'s method `<select>` (the real, live one inside `TreasuryPage.jsx`) sources its options from `treasuryService.js`'s `PAYMENT_METHODS` — `{cash, transfer, check}`, 3 values, all of which are valid `chk_treasury_method` values. This is a **proper subset** of the DB's 4 allowed values (`cash, transfer, instapay, check`) — the form can never produce a value the DB rejects. Unlike `payments.pay_type`/`payments.method` (Contradiction 2/3 in the parent audit), **there is no method-vocabulary contradiction for `treasury_txn` specifically** — that risk lives entirely in the `payments` table, out of this sub-phase's scope. `category` has no DB constraint at all, so `INCOME_CATEGORIES`/`EXPENSE_CATEGORIES`'s 14 combined keys are all safe regardless of content.

## 5. Status vocabulary — Decision 1 (already approved) applied to the real code

Your approved Decision 1 (collapse to the DB's `active`/`cancelled`, remap `reversed`→`cancelled`, retire `pending`/`rejected`) requires touching every literal reference found by fresh grep this session:

| Site | Current | Required change |
|---|---|---|
| `treasury.slice.js:73` (`reverseTreasuryTxn`) | sets `status:'reversed'` | → `status:'cancelled'` |
| `cashboxService.js:45-46,57` (`getCashboxBalance`/`getRunningBalance`) | filters out `status==='reversed' \|\| status==='rejected'` | → filter out `status==='cancelled'` only |
| `TreasuryPage.jsx:378` (`LedgerTable`) | `isReversed = tx.status==='reversed'` | → `tx.status==='cancelled'` |
| `TreasuryPage.jsx:407-411` (status badge) | maps all 4 of `{active,reversed,pending,rejected}` to colors/labels | → map only `{active,cancelled}` |
| `treasury.slice.js:124-135` (`approveTreasuryTxn`/`rejectTreasuryTxn`) | dead, sets `status:'active'`/`'rejected'` | retire per Decision 5 (already approved, low priority) — not required for 3B-14B to function, since nothing calls them |

No other literal `'reversed'`/`'pending'`/`'rejected'` reference touches `treasury_txn` (the only other hits, `transactionEngine.js` and `inventoryService.js`, are dead code and an unrelated table respectively — §2).

## 6. Write-path architecture — the one substantive open decision

Three distinct write shapes exist, with different atomicity needs:

1. **Manual single entry** (`handleSaveTxn`) — **one row**, no composite write. A single `INSERT` is atomic by itself; no transaction wrapper is structurally required.
2. **Reversal** (`handleReverse`) — **one new row + one existing row updated**, in one logical operation. Needs a transaction (same class of problem 3B-13B Stage ii solved for admission activation): a naive two-separate-request implementation could leave a reversal row created but the original never marked `cancelled` (or vice versa) if the second call fails.
3. **Transfer** (`handleTransfer`) — **two new rows** sharing a `transferId`, in one logical operation. Same atomicity need.

This gives two legitimate architectural options, both with real precedent already in this codebase, and I have not chosen between them:

- **Option A — generic CRUD for the simple case, one dedicated atomic endpoint for reversal+transfer.** Mirrors the `admissions` pattern exactly: `admissions` itself is writable through generic CRUD for ordinary field updates, but activation (`PUT /api/admissions/:id/activate`) is a separate, dedicated, transaction-wrapped route mounted before the generic loop. Applied here: enable generic CRUD for `treasury_txn` (single-entry creates), and add one dedicated route (e.g. `POST /api/treasuryTxn/:id/reverse`, `POST /api/treasuryTxn/transfer`) for the two composite operations. Consistent with the most recent, most load-bearing precedent in this exact migration series.
- **Option B — one dedicated route family for all three operations**, none through generic CRUD at all (`treasury_txn` stays in `READ_ONLY_COLLECTIONS` for the generic router; a new `treasuryTxn.js` route file handles create/reverse/transfer together). Mirrors `materialDistribution.js`'s pattern (a single dedicated file owning every write shape for its collection, generic CRUD never touches it). Advantage: one place owns all `treasury_txn` write validation/normalization/id-generation, so simple entries and composite entries can't drift into two different conventions (e.g., two different `created_by`-handling rules, or two different id-generation strategies) the way `cashboxes` (generic CRUD, client id preserved) and `admissions` (generic CRUD + dedicated activate, still client id preserved for both) currently don't have to worry about, but `treasury_txn` — spanning both a simple and two composite shapes — could.

Both are legitimate; I'm not recommending one over the other without your input, since 3B-14A specifically demonstrated your preference for the narrowest, most literal reading of each decision rather than the most "consistent-looking" one. A closely related sub-question either way: **should `treasury_txn` ids be client-preserved** (matching 3B-14A's `cashboxes` precedent exactly, adding it to `PRESERVE_CLIENT_ID_COLLECTIONS`) **or server-generated** (matching `materialDistribution.js`/`admissionActivation.js`'s dedicated-endpoint precedent, `crypto.randomUUID()` inside the transaction)? Under Option A this could legitimately be answered differently for the simple case (generic CRUD → client id, matching `cashboxes`) versus the composite case (dedicated endpoint → server id, matching the other precedents) — which is itself worth flagging as a choice, not a foregone conclusion.

## 7. `created_by` — same FK risk pattern as `cashboxes`' PRESERVE_CLIENT_ID decision, cheaper here

Unlike `cashboxes` (no `created_by` column at all), `treasury_txn.created_by` is a real, live FK to `users.id`. §1 already confirms every current `TreasuryPage.jsx` call site correctly passes `currentUser?.id`, never a literal string, under normal operation. Whatever write path is chosen (§6), it must reject/ignore a client-supplied `created_by` and derive it exclusively from `req.user.id` server-side (never trust the request body for this field) — the same principle already applied throughout this migration (`admissions.created_by`, `materialDistribution.js`, `admissionActivation.js`'s `userId: req.user?.id ?? null`).

## 8. Client-side sufficient-balance / cashbox-selection checks

`validateTransfer` (client) checks the source cashbox has enough balance before allowing a transfer; `TxnForm`'s expense path does the same. Per the parent audit's already-approved item 14, these remain UX conveniences only — the authoritative check (if any is added at all) must be a live server-side recomputation from real `treasury_txn` rows at write time, never trust to the client's snapshot. No new decision needed here; restating for completeness since this sub-phase is where it first becomes concretely actionable.

## 9. Testing / verification approach (no new framework, matching established convention)

Same as 3B-14A: Vitest + Testing Library component-contract tests for `TreasuryPage.jsx`'s three write flows (mocked `fetch`), a guaranteed-rollback Prisma script for real-schema DB verification (this time needing at least one real cashbox row created inside the same wrapped-and-rolled-back transaction, since the FK requires it), and a live HTTP check against the running dev server — this time using the one real `users` row's actual id for `created_by`, not an arbitrary string, since the FK is real here.

---

## 10. Decision Gate

### A. Verified Facts (this session, fresh)
- `treasury_txn` DB schema, checks, triggers, FKs are unchanged from the parent audit (re-queried, identical) — `chk_treasury_status` still exactly `active`/`cancelled`; only trigger is the DB-level append-only `trg_no_delete_treasury`; `cashbox_id`/`created_by` FKs confirmed real; `category` confirmed unconstrained.
- `cashboxes` and `treasury_txn` are both still empty in PostgreSQL (0 rows); exactly one real `users` row exists.
- Three distinct write shapes exist in the live code (single entry, reversal, transfer), two of which are inherently composite/multi-row and need transactional atomicity; only the reversal/transfer shapes require a dedicated endpoint on atomicity grounds alone.
- `src/modules/treasury/components/TxnForm.jsx` and `LedgerTable.jsx` are dead, shadowed by different-shaped inline components of the same name inside `TreasuryPage.jsx` — newly found this session, not in the parent audit.
- The live reverse button is already scoped to manual (no-`refType`) entries only — a clean, pre-existing alignment with this sub-phase's scope.
- Every current `TreasuryPage.jsx` call site already passes the real `currentUser?.id` as `createdBy`, satisfying the FK under normal operation.

### B. Open Decisions Requiring Your Approval
1. **Write-path architecture (§6):** Option A (generic CRUD for simple entries + one dedicated endpoint for reverse/transfer, mirroring `admissions`) vs. Option B (one dedicated route family owning all three write shapes, mirroring `materialDistribution.js`, generic CRUD never touches `treasury_txn`).
2. **ID strategy, tied to decision 1:** client-preserved ids (matching `cashboxes`' 3B-14A precedent) vs. server-generated `crypto.randomUUID()` (matching `materialDistribution.js`/`admissionActivation.js`) — and whether this may legitimately differ between the simple and composite write shapes if Option A is chosen, or must be uniform if Option B is chosen.
3. **Status-vocabulary code changes (§5):** confirm the 4 required edits (all mechanical, already dictated by the previously-approved Decision 1 — listed for explicit sign-off since they touch 3 live files).
4. **Dead component files (`components/TxnForm.jsx`, `components/LedgerTable.jsx`):** remove now (this sub-phase touches this exact area) or leave for a later, separate cleanup pass per Decision 5's "low priority, only when naturally touched" framing — this sub-phase does naturally touch this area, so it's worth an explicit call now rather than assuming.
5. **DELETE handling:** the DB already blocks it unconditionally via `trg_no_delete_treasury` with no escape hatch (unlike `cashboxes`, which had zero DB-level protection and needed an app-level guard). Do you want a matching clean app-level 405 added anyway (better error message than the DB's raw exception surfacing as a generic 500), or is relying on the existing DB trigger alone acceptable for this sub-phase, deferring the nicer-error question?
6. **Reversal reason:** currently hardcoded to a fixed string with no UI input. In scope for 3B-14B to add a reason field to the reverse-confirmation modal, or explicitly out of scope (kept exactly as-is) for this sub-phase?

*(Decisions 1–6 above were answered explicitly by you: (1) hybrid — generic CRUD for the simple entry, dedicated atomic endpoints for reverse/transfer, no new route family, no `crud.js` changes; (2) server-generated UUIDs, no client-id preservation, no reconciliation; (3) apply Decision 1 exactly, remove pending/rejected rather than merely stop using them; (4) remove the two dead component files now, after re-verifying zero usages; (5) keep the DB trigger as authoritative AND add an explicit app-level DELETE guard; (6) fix the hardcoded reason now, scoped strictly to preserving the user's actual input.)*

---

## 11. Implementation

**Files changed (9) + 2 deleted:**

1. **`backend/src/routes/treasuryTxn.js`** (new) — exports `reverseTreasuryTxn({id,reason}, {userId})` and `transferBetweenCashboxes({...}, {userId})`, both atomic via `runInTransaction`, both re-fetching the decisive state (`tx.treasury_txn.findUnique` / `tx.cashboxes.findUnique`) inside the transaction, exactly mirroring `admissionActivation.js`'s structure. A thin router: `PUT /:id/reverse`, `POST /transfer`, a `POST /` middleware that overwrites `req.body.createdBy` with `req.user.id` before falling through to generic CRUD, and explicit 405 guards on `PUT/PATCH/DELETE /:id`.
2. **`backend/src/server.js`** — `treasuryTxn` removed from `READ_ONLY_COLLECTIONS`; **not** added to `PRESERVE_CLIENT_ID_COLLECTIONS` (server-generated ids only, per Decision 2); `treasuryTxnRouter` mounted before the dynamic loop, same position/pattern as the `cashboxes` DELETE guard from 3B-14A.
3. **`src/services/api.js`** — `pgCreateTreasuryTxn`, `pgReverseTreasuryTxn`, `pgTransferBetweenCashboxes`, plus `normalizeTreasuryTxnResponse` (Decimal→Number, ISO date→date-only, and the `notes`↔`description` aliasing described in §12). No `pgUpdateTreasuryTxn`/`pgDeleteTreasuryTxn`.
4. **`src/store/db.middleware.js`** — `COLLECTION_FIXUPS.treasuryTxn` added, mirroring the same normalization on the boot-sync path.
5. **`src/store/slices/treasury.slice.js`** — `approveTreasuryTxn`/`rejectTreasuryTxn` **removed** (the pending/rejected workflow itself, not merely stopped-using — confirmed zero call sites before removal). `reverseTreasuryTxn`/`reverseLinkedTxn` **left untouched**, since `PaymentsPage.jsx`'s payment-delete cascade still depends on them and payments is explicitly out of scope for this sub-phase.
6. **`src/store/app.store.js`**, **`src/store/index.js`** — dangling re-exports of the two removed actions cleaned up (found via grep after the slice removal, not anticipated in the original plan).
7. **`src/services/cashboxService.js`** — `getCashboxBalance`/`getRunningBalance` filters changed from `status!=='reversed' && status!=='rejected'` to `status!=='cancelled'`.
8. **`src/modules/treasury/TreasuryPage.jsx`** — `handleSaveTxn`/`handleTransfer`/`handleReverse` rewritten server-truth-first (no local mutation before a successful response); the reverse-confirmation `ConfirmModal` replaced with a plain `Modal` (locally, not touching the shared `Modal.jsx`) adding a required reason `<textarea>`; the ledger's status badge/strike-through logic updated to the 2-value vocabulary.
9. **`src/modules/treasury/TreasuryPage.treasuryTxn.test.jsx`** (new) — 7 component-contract tests.

**Deleted** (Decision 4, zero usages re-verified immediately before deletion): `src/modules/treasury/components/TxnForm.jsx`, `src/modules/treasury/components/LedgerTable.jsx`.

`schema.prisma`, `backend/src/routes/crud.js`, `payments`, `admission_payments` — **not touched**, confirmed in §15.

## 12. A bug this session's own DB verification caught before any write occurred

Both the original audit (§3) and the parent Financial Domain audit listed `treasury_txn`'s columns correctly — **no `description` column ever appeared in either report.** Despite that, when I implemented `treasuryTxn.js` and `api.js`, I wrote `description: ...` into several `treasury_txn.create()` calls anyway, unconsciously matching the *frontend's* local shape (which does have `description`) rather than the schema I had myself already documented correctly. This is exactly the class of error the guaranteed-rollback DB verification step exists to catch, and it did: the very first `prisma.treasury_txn.create()` call in the verification script failed immediately with `Unknown argument \`description\``.

**Why this mattered:** had this shipped, the bug would have been **silent data loss**, not a visible error. Generic CRUD's `prepareWriteData` (`crud.js`) silently drops any field with no matching DB column — it does not error. Every manual entry's required `description` text would have been discarded on write, with only whatever (optional, often empty) text the user typed into the separate "ملاحظات" field surviving. No frontend contract test could have caught this, because those tests mock `fetch` and simply echo back whatever was sent — they never touch a real schema. This is the concrete justification for why DB verification against the real schema is a mandatory step in this migration's workflow, not a formality.

**The fix:** `treasury_txn` has exactly one free-text column beyond `category`/`party`: `notes`. `pgCreateTreasuryTxn` (api.js) now merges the frontend's required `description` and optional `notes` into that single column before sending (`notes ? \`${description} — ${notes}\` : description`); `normalizeTreasuryTxnResponse` aliases the server's `notes` back to `description` on every response (create, reverse's `original`/`reversal`, transfer's `outTxn`/`inTxn`), and sets local `notes: null` so the ledger doesn't display the same text twice. `reverseTreasuryTxn`/`transferBetweenCashboxes` (backend) were corrected the same way — the reversal's reason goes directly into `notes` (no `description` field attempted at all), and transfer's descriptive text goes into `notes` (the counterpart cashbox name already lives in `party`, so nothing is duplicated).

**Consequence for a future edit flow:** since there's no live edit UI today (confirmed dead), this doesn't affect anything currently reachable — but if `treasury_txn` ever gets an edit flow, whoever builds it should know the description/notes split doesn't round-trip losslessly through the current mapping (both collapse into one server column). Flagging this now so it isn't rediscovered the hard way later.

## 13. Two guard additions beyond the literal decision list — flagged for your review

1. **`PUT`/`PATCH /:id` blocked (405), not just `DELETE`.** Decision 5 asked specifically about `DELETE`. Since generic CRUD's `writable` flag is all-or-nothing (confirmed in the original audit — enabling it activates POST/PUT/PATCH/DELETE together with no per-verb switch), and `updateTreasuryTxn` has zero live callers, I judged that leaving `PUT`/`PATCH` open would let a client silently rewrite any field of any ledger row outside the reversal flow — a bigger integrity gap than the DELETE question was about. I blocked them the same way. If you'd rather `PUT`/`PATCH` stay open (e.g., anticipating a future edit UI), this is a one-line removal in `treasuryTxn.js`.
2. **Reversal rejects any row with a `ref_type` set** (`reverseTreasuryTxn` in `treasuryTxn.js`), not just already-cancelled rows. This mirrors the live UI's own existing restriction (`LedgerTable`'s reverse button is already hidden for `!!tx.refType`) — I enforced it server-side too, since this endpoint will later be reachable from 3B-14C's payment-domain work, and I didn't want it to accidentally accept reversing a transfer leg before that phase has been designed. Not asked for explicitly; flagging it as a defensive addition, not a scope expansion.

## 14. Testing

7 component-contract tests (`TreasuryPage.treasuryTxn.test.jsx`), mocked `fetch`, mirroring `AdmissionsPage.activation.test.jsx`'s technique:
- Manual entry: exact `POST /api/treasuryTxn` body (confirms `description` is *not* sent, `notes` carries it — the corrected contract), no premature mutation, server-response adoption.
- Manual entry failure: no mutation.
- Reversal requires a reason: zero fetch calls without one, inline error shown.
- Reversal: exact `PUT .../reverse` body with the real typed reason; no premature mutation; adopts **both** the updated original (`status:'cancelled'`, amount/description unchanged) and the new compensating transaction; confirms the reversal's `description` (aliased from `notes`) holds the actual reason typed, not a fixed string.
- Reversal failure: state completely untouched.
- Transfer: exact `POST /transfer` body; no premature mutation; adopts **both** sides of the pair together, sharing `refId`, never one side alone.
- Transfer failure: neither side ever adopted.

DELETE-rejection and the concurrent/duplicate-reversal guarantee are verified at the backend/DB level instead (§15) — no frontend UI ever calls DELETE, and genuine concurrency isn't meaningfully exercisable through a mocked-fetch component test.

**Full regression:** 20 test files / 136 tests pass (was 129 at the end of 3B-14A; +7 new, 0 broken — including confirmation that deleting the two dead component files broke nothing).

## 15. DB verification, and a structural constraint that changed the methodology

**Discovered constraint:** `treasury_txn`'s `trg_no_delete_treasury` has **no bypass of any kind** (unlike `enforce_payment_treasury`/`enforce_admpay_treasury`, which honor `studix.migration_mode`) — confirmed by re-reading the trigger function source. This means any row committed to this table by *any* means (the real exported functions, a live HTTP call, even a superuser Prisma script) can **never be deleted**, by design — this is the append-only ledger guarantee working exactly as intended. Practically, it means the "commit real rows via the real functions, verify, then delete" pattern used successfully for `cashboxes` in 3B-14A is **structurally impossible** here without leaving permanent residue, which conflicts with your explicit requirement to confirm zero residue.

**How I resolved it, without leaving residue and without asking mid-task:** I split verification into what's genuinely safe to do live and what isn't:
- **Guaranteed-rollback, zero-residue schema verification** (Prisma script, wrapped in `$transaction` calls that always threw a sentinel before commit, deleted after use): mirrors the *exact same SQL shapes* the real functions produce (rather than calling the functions themselves, which each open their own top-level transaction and can't be nested inside a rollback boundary) — confirmed: id preservation is irrelevant here since ids are always server-generated; `amount` round-trips as Decimal; `created_by` accepts the one real `users` row's id; `chk_treasury_status` correctly **rejects** `'reversed'` (proving the DB only ever accepts the approved `active`/`cancelled` vocabulary); the `cashbox_id` FK correctly rejects a nonexistent cashbox. Row counts confirmed identical before/after (0/0).
- **Live HTTP check against the running dev server, scoped to routing/guards only** — deliberately **never** a real create/reverse/transfer, precisely because those would leave permanent rows. Confirmed live: `DELETE`/`PUT`/`PATCH /api/treasuryTxn/:id` → 405 (all three reject *before* touching the database, so this is genuinely zero-risk); `PUT .../reverse` and `POST /transfer` against nonexistent ids/cashboxes → correct `400` business errors (proving real routing reaches the real handlers, and confirming via a final `GET` that the row count stayed at 0 throughout); `payments` remains untouched (405, unaffected by this sub-phase).
- **Duplicate/concurrent-reversal guarantee — ⚠️ this claim was WRONG, corrected in §17.** This paragraph originally asserted the race was "verified logically" via code review alone, reasoning that the `findUnique`-then-write shape (the same pattern used in `admissionActivation.js`'s double-activation guard) was sufficient. It is not, for this specific case — see §17 for the actual deterministic test that disproved this, the real bug it found, and the fix applied. Left here unmodified as an honest record of what this session originally (incorrectly) concluded before your closure review caught it.

**Final baseline:** `cashboxes = 0`, `treasury_txn = 0`, `payments = 0`, `admission_payments = 0` — identical to the counts before this sub-phase began. All temporary verification scripts deleted; the dev server started for the live check was stopped afterward.

## 16. Explicit confirmations

- **`payments`, `admission_payments`:** not read for modification, not written to, not referenced by any new code in this sub-phase (their row counts are unchanged and were only queried alongside the others as a baseline sanity check).
- **`backend/prisma/schema.prisma`:** not modified — the `description` bug in §12 was resolved entirely in application code, using existing columns, exactly as instructed ("no schema changes unless evidence proves an existing constraint cannot support the approved behavior" — it could, once mapped to `notes` correctly).
- **`backend/src/routes/crud.js`:** not modified — the `created_by` injection and all guard behavior live in the new `treasuryTxn.js` file and `server.js`'s mount order, per the established pattern.

## 17. Closure review addendum — your three explicit sign-off items

Your closure review required three things resolved before final approval. All three are now resolved:

### 17.1 PUT/PATCH guards — approved as intentional architecture, confirmed live in code

Re-read `backend/src/routes/treasuryTxn.js` fresh this session to confirm the implementation matches the decision, not just the report:
- `POST /` → falls through to generic CRUD, with `createdBy` overwritten from `req.user.id` first.
- `PUT /:id/reverse` → dedicated atomic route.
- `POST /transfer` → dedicated atomic route.
- `PUT /:id`, `PATCH /:id`, `DELETE /:id` → all three explicitly `blocked()` with a 405 and a clear Arabic message, confirmed present verbatim in the router.

This is documented in the file's own header comment (§13, item 1 of the original report) as a deliberate integrity decision — no live edit flow exists for ledger rows, and the append-only model requires that any state change happen only through an explicit, auditable operation (reverse), never a generic field-level write. Confirmed intentional, not accidental. No code change needed for this item.

### 17.2 Server-side rejection of `ref_type` reversal — approved, confirmed live in code

`reverseTreasuryTxn()` rejects any row with `original.ref_type` set, before doing anything else:
```js
if (original.ref_type) {
  throw badRequest('لا يمكن عكس حركة مرتبطة بمستند آخر مباشرةً.');
}
```
Confirmed scope, re-stated explicitly per your request:
- Manual, standalone `treasury_txn` rows (`ref_type: null`) — reversible via this endpoint. This is the only case this endpoint accepts.
- Linked financial transactions (any row with `ref_type` set — transfer legs today, and payment-/admission-linked rows once 3B-14C exists) — this endpoint refuses them unconditionally. Reversing those, if ever needed, is the responsibility of an atomic operation owned by that row's own domain (e.g. a future `payments`-domain reversal), never this generic treasury endpoint.
- `payments` / `admission_payments` — not read, not written, not referenced by any code in this sub-phase. Confirmed again in §17.4's final counts below. Fully out of scope for 3B-14B.

### 17.3 Concurrency verification — the original claim was wrong; a real bug was found, fixed, and re-verified

**What was wrong:** §15's original concurrency paragraph claimed this was "verified logically." It was not actually tested, and the reasoning was incorrect: it assumed the `findUnique`-then-write shape was race-safe by analogy to `admissionActivation.js`, without checking whether the *write* itself carried a matching conditional guard. It did not.

**What I did instead, per your instruction not to create permanent treasury rows:** built a genuinely separate, disposable Postgres database (`studix_concurrency_scratch`), created only for this test:
1. `CREATE DATABASE studix_concurrency_scratch` on the same local Postgres server (explicit permission requested and granted for this step, since it's a server-level action).
2. `prisma db push` against it using the real, **unmodified** `schema.prisma` (only the target `DATABASE_URL` differed) — giving it the identical table/column/FK structure as `studix`, with zero rows in it beyond a single seeded user, cashbox, and one active manual `treasury_txn` row created for the test.
3. Ran the real, unmodified `reverseTreasuryTxn()` route function (imported directly from `treasuryTxn.js`, not reimplemented) against that scratch database, via `globalThis.prisma` injection into the existing dev-hot-reload singleton pattern already in `prisma.js` — no source file modified to make this possible.
4. Used a Prisma Client Extension query hook, gated by `AsyncLocalStorage` tags (not by timing/`setTimeout`), to force a **deterministic** worst-case interleaving: both concurrent calls' decisive read completes first (both observe `status:'active'`), then call A is allowed to run to full completion and commit, and only *after* that commit is call B's next write even dispatched to Postgres. This removes all reliance on real-world race timing — the ordering is enforced by the test harness itself, reproducible every run.
5. Dropped `studix_concurrency_scratch` entirely once done. `studix` (the real database) was never touched by any part of this — confirmed by table row counts before and after (§17.4).

**Result on the original, unpatched code:** the test reproducibly proved the race is real. Both concurrent `reverseTreasuryTxn()` calls **succeeded**: two separate reversal rows were created against the same original transaction, which ended at `status:'cancelled'` (correct) but with two compensating entries instead of one — a genuine double-reversal defect, not a theoretical one.

**Root cause:** the decisive check (`original.status !== 'active'`) was evaluated in application code against a value from a plain `findUnique` (no row lock), while the later write (`tx.treasury_txn.update({ where: { id } })`) was unconditional on `status` — so a second concurrent call could pass the check using stale data and create its own reversal row regardless of what the first call had already committed.

**The fix** (`backend/src/routes/treasuryTxn.js`, `reverseTreasuryTxn`): the status transition now happens via an atomic conditional guard, executed *before* the reversal row is created, using the affected-row count as the sole source of truth for whether the reversal may proceed:
```js
const { count } = await tx.treasury_txn.updateMany({
  where: { id, status: 'active' },
  data:  { status: 'cancelled' },
});
if (count !== 1) {
  throw badRequest('العملية ليست نشطة — قد تكون مُعكوسة بالفعل.');
}
```
This moves the check into the same statement as the write, so Postgres's own row lock does the serializing: a second concurrent call's `UPDATE ... WHERE status='active'` blocks behind the first transaction, then re-evaluates its `WHERE` against the now-committed row — matching zero rows once the first has already flipped it to `'cancelled'`, and correctly rejecting rather than proceeding. The reversal row is now created only after this guard succeeds, using the pre-fetched `original` purely for its other, non-racing fields (`cashbox_id`/`type`/`amount`/`method`/`party` — none of which change after creation, so reading them once, earlier, is safe; only `status` was ever the contested field). The `original.ref_type` check (§17.2) is unaffected and unchanged, since `ref_type` is immutable after creation and was never part of the race.

**Re-verification:** the identical deterministic scratch-DB test was re-run against the patched code (same forced interleaving: both reads observe `active`, call A commits fully, only then is call B's guard even dispatched). Result: call A succeeded; call B was rejected with `"العملية ليست نشطة — قد تكون مُعكوسة بالفعل."`; exactly one reversal row exists in the final state. Confirmed safe.

### 17.4 Post-fix confirmations

- **Focused treasury tests:** `TreasuryPage.treasuryTxn.test.jsx` + `TreasuryPage.cashboxes.test.jsx` — 12/12 pass (unaffected by the backend fix, since these are mocked-`fetch` contract tests; re-run anyway per your instruction).
- **Full regression suite:** 20 test files / 136 tests pass — identical count to §14's original run. 0 broken by the fix.
- **Four financial table counts, live `studix` DB, before vs. after this entire closure session:** `cashboxes = 0`, `treasury_txn = 0`, `payments = 0`, `admission_payments = 0` — unchanged throughout. The concurrency test never touched `studix`; it ran entirely inside `studix_concurrency_scratch`, which was dropped after use. `SELECT datname FROM pg_database WHERE datname LIKE 'studix%'` now shows only `studix` — the scratch database no longer exists.
- **Temporary scripts/artifacts:** the one-off verification script (`backend/_tmp_concurrency_test.mjs`, written and run twice — once against the buggy code to confirm the bug, once against the patched code to confirm the fix) was deleted after each use. None remain in the tree.
- **`payments`, `admission_payments`:** not read, not written, not referenced by the fix or by any test this session (fix is scoped entirely to `treasury_txn`'s own reversal guard).
- **`backend/prisma/schema.prisma`:** not modified. The scratch database was built by pointing the unmodified schema file at a different `DATABASE_URL`, not by editing it.
- **`backend/src/routes/crud.js`:** not modified. The fix lives entirely inside `treasuryTxn.js`'s own `reverseTreasuryTxn` function, consistent with how this sub-phase has handled every other write-path change.

---

Phase 3B-14B is closed, pending your final sign-off on this addendum. All three of your closure conditions (§10.1 PUT/PATCH guards, §10.2 `ref_type` reversal rejection, §10.3 concurrency verification) are now resolved with live-code confirmation and, for concurrency specifically, an empirical fix rather than a documentation-only limitation. Phase 3B-14C is **not started**.
