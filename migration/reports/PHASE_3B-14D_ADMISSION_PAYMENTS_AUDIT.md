# Phase 3B-14D — `admission_payments` + `treasury_txn`: Audit, Implementation Contract & Closure

**Status: CLOSED — implemented and verified.** §§1–15 below are the original read-only audit (unchanged). §16–17 record the pre-implementation verification and implementation contract written after your decision-gate approval. §18 onward records what was actually implemented, including one necessary technical correction discovered mid-implementation (§18.1). Every claim in §§1–15 is labeled **[VERIFIED FACT]** or **[RECOMMENDATION]**; this audit was built independently — every fact was re-verified fresh against the live schema and current code, not carried over from 3B-14C's report. Phase 3B-14C is CLOSED and untouched.

---

## 1. Scope confirmation

In scope: `admission_payments` write-enablement, atomically linked to `treasury_txn`, including the "cancel admission with refund" flow. Out of scope, untouched, not read for modification: `payments`, `backend/prisma/schema.prisma` (read for schema facts only), `backend/src/routes/crud.js`, `backend/src/routes/materialDistribution.js`, all Phase 3B-8→3B-13 reports, `students.slice.js`.

---

## 2. Current architecture inventory (fresh this session)

**Frontend — the only live write path is `AdmissionsPage.jsx`, re-read in full this session:**
- `addPayment(recordId, payment)` (line 373) — the "record a payment" flow, reachable from `ReservedTab`'s "💰 تسجيل دفعة" button. Builds a treasury entry via `buildCashboxTxn` (`refType:'admission'`, `refId:recordId` — **the admission's id, not a payment id**, `admissionId:recordId`, `createdBy:'admissions'` — a **literal string**, same class of risk the parent Financial Domain audit already flagged for `treasury_txn.created_by`'s real FK), then `addTreasuryTxn(txn)` (**local-only**, not a `pg*` call). Separately appends to `admissionPaymentsLocal` (a **different, standalone Zustand slice** — not the `admissions` array itself, not `payments`).
- `doCancelWithRefund(rec, reason)` (line 265) — cancels a reservation **and** refunds every one of that admission's *not-yet-refunded* payments in one user action. First calls `updateRecord` (`pgUpdateAdmission` — a real, already-migrated Postgres write, awaited and checked for success) to set `reservationStatus:'cancelled'`/`stage:'lead'`. **Only after that succeeds** does it loop over `unrefunded` payments and build one `refType:'refund'` treasury entry per payment (again via local-only `addTreasuryTxn`, again `createdBy:'admissions'`), then marks all of them `refunded:true` in `admissionPaymentsLocal`.
- **[VERIFIED FACT]** Both flows are **100% local for their financial side** — `addTreasuryTxn` here is the same raw slice action (not a `pg*` API call), so zero admission-payment financial data reaches PostgreSQL today, exactly like `payments` before 3B-14C. The admission-record update itself (`pgUpdateAdmission`) is real and already live (3B-13A) — only the payment/refund side is local.
- **[VERIFIED FACT]** No `method` selector exists anywhere in the admission-payment UI (`payForm` state only has `type`/`amount`/`materialId`) — every admission payment is hard-coded `method:'cash'`. There is no method-vocabulary contradiction to resolve here, unlike `payments` in 3B-14C — confirmed by reading the form, not assumed.
- **[VERIFIED FACT]** `materialId` **is** collected in the UI (a real `<select>`, shown only when `type==='booklets'`, filtered by the student's grade) and stored in `admissionPaymentsLocal` — but **no matching column exists anywhere in `admission_payments`** (§3). This is a genuine, currently-collected piece of data with no place to persist it once this becomes a real write — see §7.
- **[VERIFIED FACT]** `payment.by` is always the hard-coded string `'الموظف الحالي'` (never `currentUser?.id`, even though `currentUser` is in scope) — a dormant, pre-existing bug, moot once a real `created_by` is derived server-side (§8).
- **[VERIFIED FACT]** `doCancelWithRefund` performs **no cashbox-balance check** before refunding (unlike `payments`' `RefundView`, which did check client-side) — a pre-existing gap in the current dormant code, not something to carry forward uncritically.
- **`src/store/slices/admissions.slice.js`** — `admissionPaymentsLocal` is a plain array + setter, no other actions. Confirmed via the slice source: no reducer-level business logic lives here.
- **`src/modules/admissions/constants.js`/`mockData.js`** — `PaymentType` = `{DEPOSIT, BOOKLETS, COURSE, OTHER}` (4 values); `ADMISSION_PAYMENT_TYPES` supplies matching labels. Re-verified against the live DB constraint below — **exact 4-for-4 alignment, no vocabulary contradiction**, unlike `payments.pay_type` in 3B-14C.

**Backend:**
- **[VERIFIED FACT]** No `admissionPayments` route file exists (filesystem search, zero matches). `admissionPayments` is still in `READ_ONLY_COLLECTIONS` (`backend/src/server.js:48`) — GET passes through generic CRUD; every other verb 405s. Unchanged since 3B-14C (that phase's own comments confirm it never touched this collection).
- **[VERIFIED FACT]** `src/services/api.js` — zero `pgCreateAdmissionPayment`/`pgRefundAdmissionPayment`-style functions exist, dead or live.

---

## 3. Live PostgreSQL schema — fresh queries this session

### `admission_payments`
```
id (text, PK, no default), admission_id (text, NOT NULL, FK→admissions.id),
type (text, NOT NULL), amount (numeric(12,2), NOT NULL), date (date, NOT NULL),
method (text, NOT NULL, default 'cash'), notes (text, nullable),
treasury_txn_id (text, nullable, FK→treasury_txn.id), created_at (timestamptz, default now())
```
- **Checks:** `chk_adm_pay_type: type IN ('deposit','booklets','course','other')`; `chk_adm_pay_amount: amount > 0`. **No check on `method`** (free string — matches the fact that only `'cash'` is ever produced).
- **Trigger:** `trg_admpay_needs_treasury` (BEFORE INSERT → `enforce_admpay_treasury()`) — same shape as `payments`' own trigger, same `studix.migration_mode` bypass for historical backfill, not for live app writes.
- **No `created_by` column at all** (same as `payments`). **No `status`/`refunded` column of any kind** — there is no mutable field on this table whatsoever; every column is set once at creation. This makes the "immutable record" direction even more clearly the only option here than it was for `payments` (which at least had `status`).
- **No `material_id` column.** Confirmed by direct column listing — this is not an oversight in my reading, the column genuinely does not exist.
- Indexes: PK + `idx_adm_pay_adm` (on `admission_id`) only. No index on `treasury_txn_id`.
- Row count this session: **0**.

### FK structure — materially different from `payments`, and this is the most important structural finding
**[VERIFIED FACT — new this session]** Unlike `payments`↔`treasury_txn` (two independent, non-deferrable FKs pointing in opposite directions, forcing a 3-step create-then-update-back sequence, per 3B-14C §3), `admission_payments`↔`treasury_txn` has **exactly one FK, in one direction only**: `admission_payments.treasury_txn_id → treasury_txn.id`. Queried `pg_constraint` directly: **no column on `treasury_txn` references `admission_payments` at all** — `treasury_txn.admission_id` references `admissions` directly (a coarser link, already used by the dormant `addPayment` code above), not `admission_payments`. There is **no reverse-FK circularity to solve here**. The correct insert order is the simple 2-step `treasury_txn` first (to satisfy the trigger), then `admission_payments` referencing it — **the 3-step "create with null, then update back" pattern from 3B-14C's `payments.js` does not apply and must not be copied.** If a precise, per-row link back from the treasury row to the specific `admission_payments` row is wanted (as opposed to the coarser `admission_id`-only link), it would have to use the generic `ref_type`/`ref_id` columns (no CHECK constraint on either), exactly as `payments` did with `ref_type:'payment'` — this is a design choice, not a schema requirement, see §9.

---

## 4. Vocabulary — no contradiction found (re-verified, not assumed)

`type`: DB allows exactly `deposit, booklets, course, other`; the live form (`PaymentType` enum, `ADMISSION_PAYMENT_TYPES` labels) offers exactly the same 4, exactly matching — **already fully aligned, confirmed fresh, no decision required.** `method`: DB allows any string (no CHECK); the live form never offers a choice at all, always `'cash'` — no divergence exists because there is only one value ever produced. **Unlike 3B-14C, there is no vocabulary-reconciliation decision to make for this sub-phase.**

---

## 5. The `materialId` gap — real, currently-collected data with no column to hold it

**[VERIFIED FACT]** When `type==='booklets'`, the form collects a real `materialId` (which specific study booklet was purchased, filtered by the student's grade) and it is stored in `admissionPaymentsLocal` today. There is no `admission_payments.material_id` column, and no other column that could hold it without loss (`notes` is free text and would only capture it if deliberately concatenated in, the same class of workaround 3B-14B used for `description`/`notes`, except here the two pieces of information — a human note and a structured material reference — are not really equivalent). **This is a decision, not something to resolve silently**, see §14 Decision 1: add a nullable `material_id` (BigInt, FK→`inv_materials.id`, matching `payments.material_id`'s existing shape exactly) — a schema change — vs. fold the material's name into `notes` as text (lossy, no schema change) vs. drop the field from the write path entirely (a real, currently-working feature stops being persisted).

---

## 6. Append-only — independently assessed, not assumed from `payments`' precedent

**[VERIFIED FACT]** `admission_payments` has no DB-level delete/update trigger today, same starting point as `payments` had before 3B-14C. Unlike `payments`, there is not even a mutable `status` column here to make "immutable" a design choice about — every column is set once, so there is structurally nothing to protect *except* the row's continued existence. **[RECOMMENDATION]** the same reasoning that led to `trg_no_delete_payments` applies at least as strongly here (a transactional financial record, per your own restated standard), but this is presented as a decision requiring your confirmation, not carried over automatically — see §14 Decision 2.

---

## 7. `created_by` — same real-FK risk, independently confirmed

**[VERIFIED FACT]** `admission_payments` has no `created_by` column (same as `payments`) — the "`created_by` = `req.user.id`" principle applies only to the linked `treasury_txn` row, which does have the real FK. The current dormant code passes the **literal string `'admissions'`** as `createdBy` into `buildCashboxTxn` at both call sites (`addPayment`, `doCancelWithRefund`) — this would violate `treasury_txn.created_by`'s FK immediately on any real write, exactly as the parent Financial Domain audit flagged (Part 10) and 3B-14B/3B-14C both re-confirmed dormant. Fixing this (deriving `created_by` from `req.user.id` server-side, ignoring anything the client sends) is not a new principle to invent — it is the same one already applied in `treasuryTxn.js` and `payments.js` — but is listed here because it is a real behavior change from the code being replaced, not an assumption.

---

## 8. Cashbox resolution — same anti-pattern as pre-3B-14C `payments`, independently flagged

**[VERIFIED FACT]** Both `addPayment` and `doCancelWithRefund` silently pick `cashboxes.find(cb => cb.isDefault && cb.active) || cashboxes.find(cb => cb.active) || cashboxes[0]` — the exact pattern 3B-14C's Decision 3 replaced with an explicit, required selection. **[RECOMMENDATION]** apply the same explicit-selection requirement here for consistency — but this is presented as a decision (§14 Decision 3), not assumed, since admission payments are entered in a different UI context (a compact inline form inside the admissions table, not a dedicated page) where the UX tradeoff of adding a required cashbox field may look different than it did for `PaymentForm.jsx`.

---

## 9. The refund model — genuinely different shape from `payments`, requiring its own decision

**[VERIFIED FACT]** `payments`' refund model (3B-14C) is **one payment, refunded partially or fully, one user action at a time**, with an aggregate "sum of refunds ≤ original amount" invariant per payment. `admission_payments`' actual UX is **all of one admission's outstanding payments, refunded together in a single "cancel reservation" action** — `doCancelWithRefund` loops over every `unrefunded` payment for that admission and refunds each one in full; there is no partial-refund concept anywhere in the current code for this table. This is a structurally different operation, not a smaller version of the same one, and copying 3B-14C's per-payment refund endpoint shape here would not match how this feature is actually used.

Two legitimate designs, not yet chosen:
- **Option A — one atomic "cancel admission + refund all its outstanding payments" endpoint.** Mirrors `admissionActivation.js`'s own precedent most closely (a composite operation spanning `admissions` + N rows of a related table, in one transaction) — update `admissions.reservation_status`/`stage` **and** create one refund `treasury_txn` row per outstanding `admission_payments` row, all inside one `runInTransaction`, guarded by an atomic check that the admission isn't already cancelled (preventing a double-cancel-and-refund race, §11). Strongest consistency guarantee — either the whole cancellation-with-refund happens, or none of it does.
- **Option B — keep the admission-status update as its own call (as today, via the already-live `pgUpdateAdmission`), followed by a separate dedicated "refund all outstanding payments for admission X" endpoint**, itself atomic and guarded against double-processing, but not in the *same* transaction as the admission-status update. Closer to the current code's own sequencing (`updateRecord` first, refund logic only after it succeeds) and comment ("payments processed only after the admission update succeeds, not before") — but reopens a real inconsistency window: if the admission update succeeds and the refund call then fails, the admission is left cancelled with its money not yet refunded (recoverable by retry/manual review, but a real intermediate state that Option A eliminates entirely).

Not decided here — see §14 Decision 4. Whichever is chosen, the "refund all outstanding payments for this admission" operation must itself be idempotent/guarded against being run twice concurrently for the same admission (§11) — a genuinely new concurrency question this sub-phase introduces, distinct from 3B-14C's per-payment sum invariant.

---

## 10. Money-flow design (sketched pending §14's decisions)

**Add payment** (`POST /api/admissionPayments`, one `runInTransaction`):
1. Validate input (admission exists and is in an eligible stage, amount > 0, `type` in the 4 known values, date present, `materialId` per §14 Decision 1).
2. Resolve cashbox — explicit, required (pending §14 Decision 3) or, if you decide otherwise, some other explicit rule; no silent fallback either way per the standard already set in 3B-14C.
3. `tx.treasury_txn.create()` — `type:'income'`, `category` derived from `PAYMENT_TO_CASHBOX_CATEGORY[type]`, `ref_type:'admissionPayment'`, `ref_id:<admission_payments id, pre-generated>`, `admission_id:<the admission's id>` (the existing coarse link, kept for continuity with the dormant code's own convention), `created_by:req.user.id`.
4. `tx.admission_payments.create()` — referencing the just-created `treasury_txn_id`. **Two steps, not three** — no reverse column to complete (§3).

**Cancel + refund** — exact shape depends on §14 Decision 4 (Option A or B). In either case, the decisive guard is an atomic check on the admission's own cancellation state (e.g., a conditional update analogous to 3B-14B's `updateMany({where:{id, reservationStatus:{not:'cancelled'}}})`), not a plain `findUnique`-then-act — the same class of fix 3B-14B's closure review required, applied here from the start rather than discovered after the fact.

---

## 11. Concurrency — a new question, not inherited from 3B-14C

**[VERIFIED FACT]** There is no aggregate-sum invariant here (§9) — each `admission_payments` row is refunded once, in full, never partially. The concurrency-sensitive operation is different: **two concurrent "cancel this admission" attempts (e.g., a double-click, or two staff members acting on the same reservation) could both pass a naive "is it already cancelled?" check before either commits, and both proceed to refund the same set of outstanding payments — a double-refund, structurally analogous to 3B-14B's reversal race, but triggered by admission-cancellation rather than a treasury-txn-status check.** This has **not been tested or reasoned through in detail yet** — flagging it now, before implementation, specifically so it is not shipped described as "verified logically." Whichever option (§9) is chosen, the guard must be a single atomic conditional operation (a conditional `UPDATE ... WHERE reservation_status != 'cancelled'`, or equivalent), and — per your own standing instruction from 3B-14C's closure — its safety must be **proven by a deterministic scratch-database test**, not asserted, before this sub-phase can close.

---

## 12. Files expected to change

- **`backend/src/routes/admissionPayments.js`** (new) — `createAdmissionPayment({...}, {userId})`; either `cancelAdmissionWithRefund({...}, {userId})` (Option A) or a narrower `refundAdmissionPayments({admissionId, reason}, {userId})` (Option B) per §14 Decision 4; explicit `PUT/PATCH/DELETE /:id` → 405.
- **`backend/src/server.js`** — new router mounted before the dynamic loop; `admissionPayments` stays in `READ_ONLY_COLLECTIONS` (same defense-in-depth reasoning as `payments`).
- **Live `studix` schema (DDL)** — at minimum the append-only trigger if §14 Decision 2 is approved; possibly `material_id` if §14 Decision 1 is approved. Nothing else — no vocabulary widening is needed here (§4).
- **`src/services/api.js`** — `pgCreateAdmissionPayment`, and whichever refund function §14 Decision 4 implies.
- **`src/store/db.middleware.js`** — `COLLECTION_FIXUPS.admissionPayments` (amount/date normalization, mirroring the others).
- **`src/modules/admissions/AdmissionsPage.jsx`** — `addPayment`/`doCancelWithRefund` rewritten server-truth-first; the inline payment form gains a cashbox field if §14 Decision 3 is approved; `admissionPaymentsLocal`'s `refunded` flag usage replaced by deriving "refunded" from linked `treasury_txn` rows (no DB column exists to store it, same principle as `payments`).
- **Not touched:** `payments` (any of its files), `schema.prisma` beyond what §14 explicitly approves, `crud.js`, `students.slice.js`, `admissionActivation.js`, `materialDistribution.js`.

---

## 13. Test / DB-verification strategy (same discipline as 3B-14C, adapted)

Vitest + Testing Library component-contract tests for `AdmissionsPage.jsx`'s rewritten add/cancel-refund flows (mocked `fetch`, same technique as every prior sub-phase). Backend: a disposable scratch database (schema.prisma pushed unmodified, then manually brought to parity with whatever DDL §14 approves — the same technique 3B-14C's closure established, since `schema.prisma` cannot represent CHECK constraints or triggers), used for the real, unmodified `createAdmissionPayment`/cancel-refund functions, covering: 2-step atomicity and rollback at each failure point, the append-only trigger (if approved), and — this phase's genuinely new requirement — a **deterministic concurrency test proving two concurrent "cancel this admission" attempts cannot both refund the same outstanding payments**, following 3B-14C's §22.5 methodology (real concurrent calls, no artificial timing needed once a real conditional guard exists). `studix` itself is never used for anything beyond before/after row-count confirmation.

---

## 14. Decisions Required From You

**Decision 1 — the `materialId` gap (§5).** Add a nullable `material_id` (BigInt, FK→`inv_materials.id`, mirroring `payments.material_id` exactly) — a schema change — vs. fold it into `notes` as text (lossy) vs. stop persisting it (drops a currently-working feature).

**Decision 2 — append-only enforcement for `admission_payments` (§6).** Add `trg_no_delete_admission_payments` (reusing the existing `prevent_delete()` function, same as `payments`) vs. app-level 405 guard only, vs. neither yet.

**Decision 3 — cashbox resolution (§8).** Require explicit cashbox selection in the admission-payment inline form (consistent with `payments`' Decision 3) vs. some other explicit rule vs. leaving this specific UX unchanged pending further product input.

**Decision 4 — the cancel-with-refund transaction boundary (§9), the most consequential decision in this phase.** Option A (one atomic endpoint: admission-status update + all outstanding-payment refunds together, strongest consistency, new endpoint replaces the current two-step client-side sequencing) vs. Option B (admission update stays a separate, already-live `pgUpdateAdmission` call; only the refund side becomes a new atomic, guarded endpoint — closer to today's sequencing, but reopens a genuine inconsistency window between the two calls).

**Decision 5 — precise per-row treasury linkage.** Use the generic `ref_type:'admissionPayment'`/`ref_id:<admission_payments id>` pair (matching `payments`' `ref_type:'payment'` convention, enabling the existing `treasuryTxn.js` reversal guard to correctly refuse to reverse these rows) vs. relying solely on the coarser existing `admission_id` link the dormant code already sets. Recommended: both — the coarse link for continuity, the precise pair for the same defensive reason `payments` needed it — but not decided here.

---

## 15. Decision Gate

### A. Verified Facts
- Zero live backend write path exists for `admission_payments` today; both write flows in `AdmissionsPage.jsx` are 100% local (financial side only — the admission-record update itself is already real).
- `type` vocabulary is already fully aligned (4/4) between the DB and the live form; `method` has no divergence because only `'cash'` is ever produced — **no vocabulary-reconciliation decision is needed in this sub-phase**, unlike 3B-14C.
- The FK relationship between `admission_payments` and `treasury_txn` is single-direction only — the 3-step create-then-update-back pattern from `payments.js` does not apply here.
- A real, currently-collected field (`materialId`, for booklet purchases) has no corresponding DB column.
- No mutable column of any kind exists on `admission_payments` — the "immutable record" direction is even more clearly the only option here than for `payments`.
- The actual refund UX is bulk-per-admission, not per-payment — a structurally different operation from 3B-14C's model, introducing a new, not-yet-designed concurrency guard (double-cancellation race) rather than reusing 3B-14C's aggregate-sum guard.

### B. Recommendations (not yet approved)
- Treat `admission_payments` as immutable, same as `payments`, with refund represented via linked `treasury_txn` rows only.
- Prefer Option A (§9/§14 Decision 4) for the cancel-with-refund transaction boundary, for the same atomicity reasoning `admissionActivation.js` already established in this codebase — but explicitly not decided by this audit.
- Set both the coarse `admission_id` link and a precise `ref_type`/`ref_id` pair on refund/payment treasury rows.

### C. Decisions Required From You
Five items, listed in full in §14: (1) the `materialId` gap, (2) append-only mechanism, (3) cashbox resolution, (4) the cancel-with-refund transaction boundary, (5) precise per-row treasury linkage.

*(Approved by you, with five explicit decisions: (1) add a real `material_id` column rather than fold into `notes` or drop it; (2) DB-level delete protection, reusing `prevent_delete()`; (3) explicit required cashbox selection, no silent fallback, for both create and refund; (4) ONE atomic transaction for the entire cancel-with-refund operation, with genuine concurrency protection against double-cancellation; (5) precise per-row treasury linkage in addition to the existing coarse `admission_id` link, kept one-way and simple — explicitly not the 3B-14C circular/3-step pattern.)*

---

## 16. Pre-implementation verification (fresh queries this session, per your explicit instruction before touching `material_id`)

- **`inv_materials.id` is `bigint`, primary key** — confirmed via `information_schema`/`pg_constraint` directly, not assumed from the 3B-14C report. This is the exact same type `payments.material_id` already references (`fk_payments_material: FOREIGN KEY (material_id) REFERENCES inv_materials(id)`), and `inventory_txn.material_id` references it the same way — **a real, twice-established precedent, not a new relationship being invented.** Adding `admission_payments.material_id BIGINT NULL REFERENCES inv_materials(id)` is structurally identical to existing, working columns.
- **`treasury_txn.ref_type`/`ref_id`** — re-confirmed **no CHECK constraint of any kind** on either column (only `type`/`status`/`amount`/`method` are constrained). Introducing new values (`'admissionPayment'`, `'admissionRefund'`) requires no schema change.
- **`admissions.reservation_status`** — CHECK constraint confirmed: `NULL | 'reserved' | 'waiting' | 'cancelled'`. `stage` CHECK: `'lead'|'reserved'|'waiting'|'confirmed'|'active'`. Both values the dormant `doCancelWithRefund` code already writes (`'cancelled'`, `'lead'`) are valid today — no widening needed.
- **Baseline row counts, this session:** `admission_payments=0, admissions=0, treasury_txn=0, payments=0, cashboxes=0`; `inv_materials=1` (real, pre-existing, unrelated data — untouched by anything in this phase).

## 17. Implementation Contract

### 17.1 Final schema changes (live `studix` DDL only — `schema.prisma` cannot represent any of this, confirmed in 3B-14C)
```sql
ALTER TABLE admission_payments ADD COLUMN material_id BIGINT NULL;
ALTER TABLE admission_payments ADD CONSTRAINT fk_admission_payments_material FOREIGN KEY (material_id) REFERENCES inv_materials(id);
CREATE TRIGGER trg_no_delete_admission_payments BEFORE DELETE ON admission_payments FOR EACH ROW EXECUTE FUNCTION prevent_delete();
```
No CHECK constraint changes anywhere (§4/§16 — vocabulary already aligned). No new trigger function — `prevent_delete()` is reused exactly as-is.

### 17.2 Exact FK directions
- `admission_payments.treasury_txn_id → treasury_txn.id` (existing, one-way, unchanged).
- `admission_payments.material_id → inv_materials.id` (new, one-way, nullable, mirrors `payments.material_id` exactly).
- **No column on `treasury_txn` references `admission_payments`.** Precise traceability (Decision 5) is via the existing, unconstrained `treasury_txn.ref_type`/`ref_id` pair (`ref_id` holding the `admission_payments.id`) — not a new FK, not a new circular pair. This is deliberately the simpler, one-way shape the audit found, not 3B-14C's structure.

### 17.3 Create transaction order (2 steps — confirmed no 3rd "update back" step is needed, unlike `payments.js`)
1. Pre-generate `admissionPaymentId = crypto.randomUUID()` in application code.
2. `tx.treasury_txn.create()` — `type:'income'`, `category` from `PAYMENT_TO_CASHBOX_CATEGORY[type]`, `ref_type:'admissionPayment'`, `ref_id:admissionPaymentId`, `admission_id:<the admission's id>` (coarse link, kept), `cashbox_id:<required, explicit>`, `created_by:req.user.id`.
3. `tx.admission_payments.create()` — `id:admissionPaymentId`, referencing the just-created `treasury_txn_id`, plus `material_id` (validated to exist first if provided).

### 17.4 Cancel + refund transaction sequence (ONE `runInTransaction` call)
1. **Atomic guard (the lock):** `tx.admissions.updateMany({ where: { id: admissionId, reservation_status: { in: ['reserved','waiting'] } }, data: { reservation_status: 'cancelled', stage: 'lead', cancel_reason: reason ?? null } })`. If the returned count isn't exactly 1, throw immediately (already cancelled, or never reserved) — no further steps run. This single statement is what makes the whole operation both correct and race-safe (§17.5) — it is not a separate "check" followed by a separate "act."
2. Only after that guard succeeds: fetch every `admission_payments` row for this `admission_id`, and every existing `treasury_txn` row with `ref_type:'admissionRefund'` whose `ref_id` is one of those payment ids and `status:'active'` — the difference is the refundable set. (No mutable "refunded" flag exists or is introduced; this is a derived set, computed fresh inside the same transaction the guard just serialized.)
3. For each refundable payment: resolve its cashbox from its **own** original linked `treasury_txn.cashbox_id` (via `admission_payments.treasury_txn_id`) — never re-resolved, never a default (mirrors 3B-14C Decision 5). Recompute that cashbox's live balance from real `treasury_txn` rows and confirm it covers the refund; if not, throw — which rolls back the **entire** transaction, including the admission-status change from step 1. Create one `treasury_txn` row: `type:'expense'`, `category:'refund'`, `ref_type:'admissionRefund'`, `ref_id:<that payment's id>`, `admission_id`, `cashbox_id` (as resolved), `amount:<that payment's amount>`, `notes:reason`, `created_by:req.user.id`.
4. Return the updated admission plus the full list of new refund `treasury_txn` rows.

**All four steps are inside one transaction. A failure at step 3 (for any one payment, on any one cashbox) rolls back step 1's admission-status change too** — satisfying your explicit "succeed or fail together" requirement. There is no scenario where the admission ends up cancelled with some payments refunded and others not, or cancelled with zero refunds recorded.

### 17.5 Locking strategy
The conditional `updateMany` in step 1 **is** the lock — Postgres takes a row lock on the `admissions` row for the statement's target the moment it executes, held until the transaction ends. A second, genuinely concurrent `cancelAdmissionWithRefund` call for the *same* `admissionId` will have its own `updateMany` either (a) execute first and win, or (b) block behind the first's row lock, then — once unblocked — re-evaluate its `WHERE reservation_status IN ('reserved','waiting')` against the now-committed (already `'cancelled'`) row, matching zero rows, and correctly throw. This is the exact same mechanism (a conditional UPDATE used as both the check and the act, not a separate `findUnique`-then-write) that fixed 3B-14B's reversal race and is what 3B-14C's audit explicitly asked not to describe as "verified logically" without proof — proof is in §17.12 / the closure DB verification, not asserted here.

### 17.6 Failure/rollback behavior
| Failure point | Result |
|---|---|
| `admissionId` doesn't exist | 400, no rows written |
| Already cancelled / never reserved (guard count ≠ 1) | 400, no rows written, no lock contention with a legitimate concurrent caller |
| Any refunded cashbox's live balance insufficient | 400, **entire transaction rolls back** — admission stays in its prior reserved/waiting state, zero refund rows exist, zero partial state |
| Create: nonexistent/inactive cashbox | 400, no rows written |
| Create: invalid `material_id` | 400, no rows written |
| Any `PUT/PATCH/DELETE /api/admissionPayments/:id` | 405, before touching the database |
| Raw `DELETE` bypassing the app | rejected by `trg_no_delete_admission_payments`, row untouched |

### 17.7 Cashbox selection behavior
**Create:** `cashboxId` is a required request field; the server rejects (400) if it doesn't reference an existing, `active` cashbox — no fallback of any kind, mirroring 3B-14C Decision 3 exactly. **Refund:** no `cashboxId` is ever accepted from the client — each refund uses the cashbox its own original payment used, resolved server-side only (§17.4 step 3), mirroring 3B-14C Decision 5.

### 17.8 `material_id` behavior
Optional. If present, must reference an existing `inv_materials` row (validated with `tx.inv_materials.findUnique` before either insert, mirroring `payments.js`'s existing validation exactly) — invalid/nonexistent → 400, no rows written. No restriction tying it to `type:'booklets'` specifically, at either the DB or route level — consistent with how `payments.material_id` is equally unrestricted by `pay_type`.

### 17.9 Delete-protection behavior
Two independent layers, matching `payments`: `trg_no_delete_admission_payments` (DB-level, unconditional, no bypass) **and** an app-level `DELETE /api/admissionPayments/:id` → 405 in the new route file. Proven directly in §22-equivalent DB verification (a raw `DELETE` attempt against the real trigger, not just code review).

### 17.10 Per-row treasury traceability
Every `treasury_txn` row created by this phase carries **both** the existing coarse `admission_id` link **and** a precise `ref_type`/`ref_id` pointing at the exact `admission_payments.id` it belongs to (`'admissionPayment'` for the original entry, `'admissionRefund'` for its refund) — resolving Decision 5 without any new column or FK, and without reintroducing 3B-14C's bidirectional-FK complexity.

### 17.11 Frontend/backend contract changes
- `src/services/api.js`: `pgCreateAdmissionPayment(data)`, `pgCancelAdmissionWithRefund(admissionId, reason)`.
- `src/modules/admissions/AdmissionsPage.jsx`: `addPayment` and `doCancelWithRefund` rewritten server-truth-first (no local mutation before success; on success, adopt the full server response); the inline payment form gains a required cashbox `<select>`, blocked with a clear message when no active cashbox exists; any future "is this refunded" UI need would derive from linked `treasury_txn` rows, exactly as `payments` does (no mutable flag exists to read).
- `backend/src/routes/admissionPayments.js` (new): `POST /` (create), `PUT/PATCH/DELETE /:id` → 405. Mounted at `/api/admissionPayments`.
- `backend/src/routes/admissionCancellation.js` (new, separate file — `admissionActivation.js` stays untouched, one-concern-per-file matching `examDelete.js`/`examGrades.js`'s existing precedent): `PUT /api/admissions/:id/cancel-with-refund`. Mounted at `/api/admissions`, alongside (not replacing) the existing `admissionActivationRouter`.
- `backend/src/server.js`: both routers mounted before the dynamic loop; `admissionPayments` stays in `READ_ONLY_COLLECTIONS`.
- `src/store/db.middleware.js`: `COLLECTION_FIXUPS.admissionPayments` added.

### 17.12 Tests required to prove each invariant
- **Frontend contract** (mocked `fetch`): create success (exact body, no premature mutation, adopts server response); create failure (zero mutation); cashbox required (zero active cashboxes blocks submission, zero fetch calls); cancel-with-refund success (adopts admission status change + all new refund `treasury_txn` rows together); cancel-with-refund failure (nothing changes).
- **Backend DB verification** (disposable scratch database, schema mirrored to live `studix` including this phase's new DDL, dropped after use): 2-step create atomicity/rollback at each failure point; `material_id` FK validation (valid and invalid); hard-delete rejection at the DB level (raw `DELETE`, bypassing the app); cancel-with-refund happy path across multiple payments in different cashboxes; one insufficient-balance cashbox among several rolls back the **entire** operation (no partial refunds, admission not left cancelled); already-cancelled admission rejected cleanly with zero side effects.
- **Concurrency — proven, not asserted:** two genuinely concurrent `cancelAdmissionWithRefund` calls against the *same* admission (with outstanding payments), via `Promise.allSettled`, across multiple rounds — expect exactly one success, refund rows created exactly once per payment (never duplicated), following 3B-14C §22.5's methodology exactly (real lock, no artificial timing needed).
- **Live HTTP routing check** (real dev server, real `studix`, zero create/refund ever attempted): `GET` passthrough still works; `PUT/PATCH/DELETE /api/admissionPayments/:id` → 405; `PUT /api/admissions/:id/cancel-with-refund` with a nonexistent id → 400; final row counts re-confirmed unchanged.

---

**This contract has been internally checked against the live schema and current code (§16) before any implementation begins, per your instruction. Proceeding to implementation now.**

---

## 18. Implementation

**Files changed (11) — none beyond what §17.11 specified, plus one necessary technical correction (§18.1):**

1. **`backend/src/routes/admissionPayments.js`** (new) — `createAdmissionPayment({...}, {userId})`: 2-step atomic create (`treasury_txn` first, `admission_payments` referencing it — no 3rd "update back" step, confirmed unnecessary per §3/§17.2). `PUT/PATCH/DELETE /:id` → 405. Also creates `admission_system_log` rows (`paymentReceived`, `bookletsDelivered`) inside the same transaction — a discovered improvement over the current dormant code's separate best-effort logging call, not a new decision.
2. **`backend/src/routes/admissionCancellation.js`** (new, separate file — `admissionActivation.js` untouched) — `cancelAdmissionWithRefund({admissionId, reason}, {userId})`: the atomic guard (`admissions.updateMany({where:{id, reservation_status:{in:['reserved','waiting']}}})`) doubles as the lock; only on success does it identify refundable payments (derived from absence of an active `admissionRefund` treasury_txn row, never a mutable flag) and create one refund row per payment, each checked against its own cashbox's live balance — any single failure rolls back everything, including the admission-status change. `admission_system_log` entries (`cancelled`, `refundIssued`) created in the same transaction.
3. **`backend/src/server.js`** — both routers mounted before the dynamic loop (`admissionCancellationRouter` alongside the existing `admissionActivationRouter` on `/api/admissions`; `admissionPaymentsRouter` on `/api/admissionPayments`). `admissionPayments` stays in `READ_ONLY_COLLECTIONS` (defense-in-depth, same as `payments`).
4. **Live `studix` schema (DDL)** — `admission_payments` gained `material_id BIGINT NULL REFERENCES inv_materials(id)` and `trg_no_delete_admission_payments` (reusing `prevent_delete()`), applied in one transaction. No CHECK constraint changes anywhere (vocabulary was already aligned).
5. **`backend/prisma/schema.prisma`** — **one field added** (`admission_payments.material_id` + its relation to `inv_materials`), via `prisma db pull` against the now-altered live `studix`, followed by `prisma generate`. See §18.1 for why this was necessary despite the "no schema.prisma changes" pattern established in 3B-14B/C.
6. **`src/services/api.js`** — `pgCreateAdmissionPayment`, `pgCancelAdmissionWithRefund`, `normalizeAdmissionPaymentResponse`; both reuse the existing `normalizeAdmissionSystemLogResponse`/`normalizeTreasuryTxnResponse`/`normalizeAdmissionResponse` so the `logs`/`refundTxns`/`admission` each new endpoint returns land in exactly the shape the rest of the app already expects.
7. **`src/store/db.middleware.js`** — `admissionPayments` added to `PG_COLLECTIONS` (boot-synced from PostgreSQL now, like `payments`/`treasuryTxn`) with a matching `COLLECTION_FIXUPS` entry.
8. **`src/store/slices/admissions.slice.js`, `app.store.js`** — `admissionPaymentsLocal`/`setAdmissionPaymentsLocal` renamed to `admissionPayments`/`setAdmissionPayments` throughout (state key, setter, `persist` whitelist) — this state is no longer local-only, so the old name was actively misleading; not a cosmetic choice, a correctness one (per your "frontend/backend contract consistency" standard).
9. **`src/modules/admissions/AdmissionsPage.jsx`** — `addPayment` and `doCancelWithRefund` rewritten server-truth-first (atomic calls, no local mutation before success, full adoption of `payment`/`treasuryTxn`/`admission`/`refundTxns`/`logs` together on success); `cancelReservation`'s old "skip the modal, call `pgUpdateAdmission` directly" path for zero-payment cancellations replaced with a direct call to the same atomic endpoint (uniform guarding against double-cancellation regardless of whether payments exist); the inline payment form gained a required cashbox `<select>` (blocked, clear message, when no active cashbox exists); `CancelRefundModal`'s refundable-payments preview now derives from linked `treasury_txn` rows (`ref_type:'admissionRefund'`) instead of a nonexistent `p.refunded` flag, mirroring the server's own logic; `buildCashboxTxn`/`PAYMENT_TO_CASHBOX_CATEGORY`/`SOURCE_MODULE_ADMISSIONS` imports removed (their only call sites were the two rewritten functions).
10. **`src/modules/admissions/AdmissionsPage.payments.test.jsx`** (new) — 5 component-contract tests.
11. **`AdmissionsPage.core.test.jsx`, `AdmissionsPage.activation.test.jsx`** — seed key updated from `admissionPaymentsLocal` to `admissionPayments` to match the rename; one test title corrected to match.

**Not touched:** `payments` (any file, backend or frontend), `backend/src/routes/crud.js`, `backend/src/routes/admissionActivation.js`, `backend/src/routes/materialDistribution.js`, `src/store/slices/students.slice.js` — all confirmed by direct inspection after implementation, not assumed.

### 18.1 A necessary technical correction, discovered mid-implementation

3B-14B/3B-14C established that CHECK constraints and triggers never require a `schema.prisma` change, since Prisma's schema format doesn't represent either. **A genuinely new *column* is different**: Prisma's generated client derives its typed `create()`/`update()` argument shapes from `schema.prisma` at `generate` time, so `tx.admission_payments.create({ data: { material_id: ... } })` failed with `Unknown argument material_id` the first time it was actually exercised (§18.2's DB verification caught this immediately, before any live write). This is not a new architectural decision or a scope change — `material_id` was already explicitly approved (Decision 1) — it is a mechanical requirement to make that already-approved column usable through the typed client the rest of this codebase relies on throughout. Resolved via `prisma db pull` (against live `studix`, which already had the column from the approved DDL) followed by `prisma generate` — confirmed the diff was exactly one field (`material_id` + its `inv_materials` relation) on the `admission_payments` model, nothing else changed, same model count (27) as before.

### 18.2 DB verification

Same methodology as 3B-14C: a disposable scratch database (`studix_3b14d_scratch`), schema pushed from the (now-updated) `schema.prisma`, then manually brought to full parity with everything `schema.prisma` still cannot represent (CHECK constraints, `prevent_delete()`/`enforce_admpay_treasury()` and their triggers) — dropped after use. The real, unmodified `createAdmissionPayment`/`cancelAdmissionWithRefund` functions were imported directly and pointed at it via the `globalThis.prisma` injection technique. `studix` itself was never used for anything beyond before/after row-count confirmation.

- **2-step create, confirmed correct:** a `booklets` payment with a real `material_id` succeeded; `payment.treasuryTxnId` correctly referenced the treasury row created in the prior step; precise traceability (`ref_type:'admissionPayment'`, `ref_id:<payment id>`) and the coarse `admission_id` link were both set correctly on the same row.
- **Create rollback:** nonexistent cashbox, inactive cashbox, and nonexistent `material_id` were each rejected with zero rows written in every case.
- **Cancel-with-refund happy path:** an admission with two outstanding payments in the same cashbox was cancelled with both refunded together in one call, refund total matching exactly.
- **All-or-nothing, proven not assumed:** an admission with two payments in *different* cashboxes, one of which had been drained by an unrelated expense between payment and cancellation, was cancelled — and the **entire operation rolled back**: zero refund rows were created (not even for the cashbox that had sufficient balance), and the admission's `reservation_status` remained `'reserved'`, not `'cancelled'`. This directly proves the "succeed or fail together" requirement, not just the happy path.
- **Already-cancelled rejection:** a second cancellation attempt on an already-cancelled admission was rejected cleanly, zero side effects.
- **Concurrency, proven deterministically:** three independent rounds, each creating a fresh admission with one outstanding payment, then firing **two genuinely concurrent** `cancelAdmissionWithRefund` calls via `Promise.allSettled` (no artificial delays — the real `updateMany` row lock provides the guarantee). Every round: **exactly one succeeded, one was rejected, and exactly one refund row existed afterward** — never two. Because this is enforced by Postgres's own locking semantics rather than test timing, the result is deterministic by construction, matching the standard set by 3B-14C's own corrected closure.
- **Hard delete:** a raw `DELETE FROM admission_payments`, bypassing the application entirely, was rejected by `trg_no_delete_admission_payments` with the expected append-only exception; the row was confirmed still present afterward.

### 18.3 Live HTTP routing check (real `studix`, zero create/cancel ever attempted)

Using a locally-minted valid session (same technique as 3B-14C's closure): `GET /api/admissionPayments` → 200 (generic CRUD passthrough, unaffected); `PUT`/`PATCH`/`DELETE /api/admissionPayments/:id` → 405, before touching the database; `POST /api/admissionPayments` with a nonexistent admission → 400; `PUT /api/admissions/:id/cancel-with-refund` with a nonexistent id → 400 (the same guard that protects against double-cancellation also correctly refuses a nonexistent one — zero rows matched, zero rows written); an unauthenticated request → 401 (confirms `requireAuth` gates before any dedicated-route logic runs); the plain, single-segment `PUT /api/admissions/:id` (generic CRUD, untouched by this phase) still reaches its own handler correctly (404 for a nonexistent id) — confirming the new `/:id/cancel-with-refund` route coexists with it without interference. Final live counts re-confirmed unchanged: `admission_payments=0, admissions=0, treasury_txn=0, payments=0, cashboxes=0`.

### 18.4 Testing

5 component-contract tests (`AdmissionsPage.payments.test.jsx`), mocked `fetch`, mirroring `PaymentsPage.payments.test.jsx`'s technique: successful atomic creation (exact body, no premature mutation, adopts `payment`+`treasuryTxn`+`logs` together); creation failure (zero mutation); cashbox required (zero active cashboxes disables submission, zero fetch calls); successful cancel-with-refund (exact request, no premature mutation, adopts the admission status change + refund `treasuryTxn` + `logs` together, and confirms the original `admissionPayments` array is byte-for-byte unchanged — immutability, mirroring 3B-14C's frontend-level check); cancel-with-refund failure (admission, payments, and treasuryTxn all untouched). Two pre-existing tests (`AdmissionsPage.core.test.jsx`, `AdmissionsPage.activation.test.jsx`) updated only to seed the renamed `admissionPayments` key instead of `admissionPaymentsLocal`.

**Full regression:** 22 test files / 147 tests pass (was 142 at 3B-14C's closure; +5 new, 0 broken).

### 18.5 Explicit confirmations

- **`payments`** (any file, frontend or backend): not read for modification, not written to, not referenced by any new code this phase.
- **`backend/src/routes/crud.js`, `backend/src/routes/admissionActivation.js`, `backend/src/routes/materialDistribution.js`, `src/store/slices/students.slice.js`:** confirmed untouched by direct inspection after implementation (grep for phase markers / cross-references, zero hits).
- **`backend/prisma/schema.prisma`:** exactly one field added (`material_id` on `admission_payments`), a necessary consequence of Decision 1 (§18.1), not a scope expansion — confirmed via model count (27, unchanged) and direct diff of the affected model only.
- **No temporary scripts or scratch databases remain** — `_tmp_scratch_setup_3b14d.mjs` and `_tmp_admission_payments_verify.mjs` both deleted after use; `studix_3b14d_scratch` dropped; the dev server used for the live check stopped afterward.
- **Live `studix` row counts:** unchanged throughout (`admission_payments=0, admissions=0, treasury_txn=0, payments=0, cashboxes=0`), confirmed before and after every verification step.

Phase 3B-14D is closed pending your review. This closes the Phase 3B-14 financial-domain migration series (3B-14A cashboxes → 3B-14B treasury_txn → 3B-14C payments → 3B-14D admission_payments) — no further sub-phase is proposed or scoped by this report.
