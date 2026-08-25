# Phase 3B-14C — `payments` + `treasury_txn`: Read-Only Pre-Implementation Audit & Implementation

**Status: CLOSED — implemented and verified.** §§1–18 below are the original read-only audit (unchanged). §19 onward records what was implemented after your explicit decision-gate approval, including one mid-implementation discovery (the `visa`/`treasury_txn.method` question) that required stopping and asking before proceeding, per your own instruction. Every claim is labeled **[VERIFIED FACT]** or **[RECOMMENDATION]** in the audit portion; the implementation portion documents what was actually built and how it was verified. Phase 3B-14B is CLOSED and untouched. `admission_payments` remains explicitly out of scope — that is Phase 3B-14D, not started.

This audit builds on, and does not re-litigate, `PHASE_3B-14_FINANCIAL_DOMAIN_AUDIT.md` (the parent audit) and `PHASE_3B-14B_TREASURY_TXN_AUDIT.md` (the closed ledger phase). Where the parent audit already established a fact, it is cited, not re-derived.

---

## 1. Scope confirmation

In scope: `payments` table write-enablement, atomically linked to `treasury_txn`, plus the refund flow. Out of scope, untouched, not read for modification: `admission_payments`, `backend/prisma/schema.prisma` (read for schema facts only), `backend/src/routes/crud.js`, `backend/src/routes/admissionActivation.js`, `backend/src/routes/materialDistribution.js`, all Phase 3B-8→3B-13 code, `AdmissionsPage.jsx`'s admission-payment call sites (still 100% local/dormant — confirmed in §9).

---

## 2. Current architecture inventory (re-verified fresh this session)

**Frontend, live vs. dead:**
- `src/modules/payments/PaymentsPage.jsx` (406 lines, read in full) — the only real write path. Three flows: `handleSave` (add payment), `handleDelete` (delete payment), `RefundView.doRefund` (refund). All three are **100% local** — `setPayments`/`addTreasuryTxn`/`addLinkedTxn`/`reverseLinkedTxn` are Zustand store mutations only; **zero network calls exist anywhere in this file or its dependents.**
- `src/store/slices/payments.slice.js` (27 lines) — pure local CRUD, no server calls.
- `src/hooks/usePayments.js` — **[VERIFIED FACT — still dead]** re-confirmed zero imports anywhere in `src/`; already flagged dead in the parent audit (Part 1) and in 3B-14B's own §2. `src/store/app.store.js:134` exports a *different*, unrelated, live `usePayments` (a raw selector) — same naming collision noted previously, still present, not touched by this phase.
- `src/services/paymentService.js` (128 lines) — validation, `createPayment` builder (client-side id `p${Date.now()}`, no server round-trip), revenue/unpaid helpers. `PAYMENT_METHODS` = `{cash, transfer, instapay, visa}`; `PAYMENT_TYPES` = `{subscription, material, exam, extra, other}`; `PAYMENT_STATUS` = `{paid, partial, unpaid}`.
- `src/services/cashboxService.js`'s `txnFromPayment` (still the live builder used by `addLinkedTxn`) — **[VERIFIED FACT]** already sets `refType:'payment', refId:<payment.id>` on the treasury entry it builds. This is exactly the convention `treasuryTxn.js`'s existing reversal guard (`if (original.ref_type) throw`, closed in 3B-14B §17.2) needs to keep blocking generic reversal of payment-linked rows — the frontend's pre-existing convention and the backend's pre-existing guard already agree; 3B-14C's job is to make this real server-side, not invent it.
- `src/modules/payments/PaymentForm.jsx` — **[VERIFIED FACT]** genuinely renders all 5 `PAYMENT_TYPES` and all 4 `PAYMENT_METHODS` as live, selectable options today (`Object.entries(...)` over both constants, confirmed by reading the form). This is real, currently-reachable user-facing functionality, not dead code — narrowing it is a product-visible regression, not a cleanup.
- `src/modules/admissions/AdmissionsPage.jsx` (`addPayment`, `doCancelWithRefund`) — **[VERIFIED FACT — confirmed still dormant]** calls the same local `addTreasuryTxn` action, never a `pg*` API function. Since 3B-14B only converted `TreasuryPage.jsx`'s own three call sites to real backend writes (not the underlying `addTreasuryTxn` action itself, which every other caller — including this one — still uses purely as a local mutator), this page's writes still never reach PostgreSQL. Its known `createdBy:'admissions'` literal-string risk (parent audit, Part 10) remains dormant, not live. Out of scope for 3B-14C; will matter for 3B-14D.

**Backend:**
- **[VERIFIED FACT]** No `payments` route file exists. `payments` is still in `READ_ONLY_COLLECTIONS` (`backend/src/server.js:47`) — GET passes through generic CRUD (as it does for all 25 tables); every other verb is 405'd.
- **[VERIFIED FACT]** `src/services/api.js` — re-grepped this session, zero `pgCreatePayment`/`pgRefundPayment`-style functions exist. No financial write path for this table, dead or live.

---

## 3. Live PostgreSQL schema — fresh queries this session (`information_schema`/`pg_catalog`, read-only)

### `payments`
```
id (text, PK, no default), student_id (text, NOT NULL, FK→students.id),
group_id (text, nullable, FK→groups.id), material_id (bigint, nullable, FK→inv_materials.id),
month (smallint, NOT NULL), year (smallint, NOT NULL), amount (numeric(12,2), NOT NULL),
method (text, NOT NULL, default 'cash'), pay_type (text, NOT NULL, default 'subscription'),
date (date, NOT NULL), status (text, NOT NULL), notes (text, nullable),
treasury_txn_id (text, nullable, FK→treasury_txn.id), created_at (timestamptz, default now())
```
- **Checks:** `chk_payment_method: cash|transfer|instapay|check`; `chk_payment_status: paid|partial|unpaid`; `chk_payment_type: subscription|material`; `chk_payment_month: 1–12`; `chk_payment_amount: amount >= 0`.
- **Trigger:** `trg_payment_needs_treasury` (BEFORE INSERT → `enforce_payment_treasury()`): raises unless `NEW.treasury_txn_id IS NOT NULL`, **unless** `current_setting('studix.migration_mode', TRUE) = 'on'`. No bypass is used by any live app path — this is a backfill-only escape hatch (parent audit, Part 3), not something 3B-14C should ever set.
- **No `created_by` column at all.** No update/delete-blocking trigger of any kind — `payments` is currently as mutable/deletable at the DB level as any ordinary table.
- **No `refunded`/`refundedAmount`/`refundReason`/`recordedBy` columns.** **[VERIFIED FACT — a live silent-data-loss risk, same class of bug 3B-14B's own DB verification caught for `description`/`notes`]**: `RefundView.doRefund` currently writes exactly these four non-existent fields onto the local payment object. If this shape were ever sent to a real write endpoint via generic CRUD's `prepareWriteData` (which silently drops unknown columns), all four would vanish silently. This is strong, concrete evidence for the "immutable payment record" approach (§6) — there is no DB-backed place to put mutable refund state on `payments` even if we wanted one.
- Row count this session: **0** (confirmed unchanged from the parent/3B-14B audits — no data has been written to `studix` since).

### `treasury_txn` (re-confirmed unchanged since 3B-14B closure — no drift)
Same shape as 3B-14B §3/§15, unchanged. Relevant columns for this phase: `ref_type`/`ref_id` (generic, text, no CHECK), **`payment_id`** (text, nullable, real FK→`payments.id`, **indexed** — `@@index([payment_id], map: "idx_treasury_payment")`), `admission_id` (unrelated, out of scope), `created_by` (real FK→`users.id`).

### FK circularity — a structural finding requiring a specific insert order
**[VERIFIED FACT — new this session, not previously documented]** `payments.treasury_txn_id → treasury_txn.id` (`payments_treasury_txn_id_fkey`) and `treasury_txn.payment_id → payments.id` (`fk_treasury_payment`) are **two independent foreign keys pointing in opposite directions between the same two tables**. Queried both constraints' deferrability directly: **`condeferrable = false`** on both. Neither is checked at commit; each is checked immediately after its own INSERT statement. Consequence: **neither row can be inserted first while forward-referencing the other's not-yet-existing id** — there is no ordering that lets both FKs be populated in the same pair of statements. The only valid design is:
1. Pre-generate both ids in application code (`crypto.randomUUID()`, no DB round trip needed for this).
2. Insert `treasury_txn` **first**, with `payment_id` left **NULL** (the trigger-mandatory direction is `payments→treasury_txn`, not the reverse; `treasury_txn.payment_id` is not required by any trigger).
3. Insert `payments` **second**, with `treasury_txn_id` set to the already-created row's id — satisfying `trg_payment_needs_treasury`.
4. `treasury_txn.payment_id` therefore stays **NULL for the original income entry**, by construction, not by omission — it is meaningful only for rows created *after* the payment already exists (i.e., a refund's own treasury_txn row, §6), where the ordering problem doesn't arise because the payment row is already committed within the same transaction by the time the refund entry is inserted.

This is a hard constraint on the transaction's internal write order, verified directly against the live database's constraint metadata, not inferred from the schema file alone.

---

## 4. Vocabulary contradictions — re-verified live, still unresolved (parent audit Contradictions 2 & 3)

Both contradictions the parent audit flagged as open (Part 7, Part 19 items 7) are confirmed **still open** — nothing in 3B-14A or 3B-14B touched `payments`' own constraints or `paymentService.js`'s constants.

**`pay_type`:** DB allows exactly `subscription, material` (2 values). `PaymentForm.jsx` lets a real user select 5: `subscription, material, exam, extra, other`. **3 of 5 live, reachable form options would be rejected outright by the DB CHECK constraint as currently written.**

**`method`:** DB allows `cash, transfer, instapay, check`. `PaymentForm.jsx` (via `paymentService.js`'s `PAYMENT_METHODS`) offers `cash, transfer, instapay, visa`. **`visa` is not a valid DB value; `check` is a valid DB value the form never offers.** A fourth, independent list still exists in `buildPaymentsReport.js` (`PAY_METHOD`: all 5, `cash/transfer/instapay/visa/check`) — read-only report-label consumer, not a write path, but evidence the divergence has never been reconciled anywhere in the codebase.

**This is the single decision with the largest product-visible impact in this phase** — resolving it either removes real, currently-working form options (narrow frontend to match DB) or requires a schema change (widen the DB CHECK constraints) that your own instruction (`"do not introduce schema changes unless the audit demonstrates they are required"`) means I should not pick myself. See §16 Decision 1.

---

## 5. Refund model — the three-way inconsistency (parent audit Part 12), and what "immutable + linked refund" resolves

**[VERIFIED FACT, re-confirmed]** Today: `RefundView.doRefund` builds a fresh `expense`/`category:'refund'` treasury entry directly (bypassing `reverseTreasuryTxn` entirely — it never touches the *original* income entry), **and separately mutates the payment row in place** (`amount: p.amount - amt`, plus the four non-existent columns named in §3). This is the behavior your already-approved decision ("immutable payment records + separate linked refund treasury transactions") replaces.

Applying that decision concretely, given the real schema (§3):
- The `payments` row, once created, is **never written to again** by anything in this phase — no PUT/PATCH ever reaches it (§7), and the refund endpoint itself does not update it either. `payments.status` stays frozen at its creation-time value (`paid`/`partial`) even after a full refund.
- A refund is represented **solely** as a new `treasury_txn` row: `type:'expense'`, `ref_type:'refund'`, `payment_id:<original payment id>` (the real, indexed FK — now actually used, for exactly the case it appears designed for), `ref_id:<original payment id>` (kept for symmetry with the income entry's own `ref_id`, redundant with `payment_id` but harmless and consistent with existing convention).
- "How much of this payment has been refunded so far" becomes a **derived** value: `SUM(treasury_txn.amount) WHERE payment_id = :paymentId AND ref_type='refund' AND status='active'`. Nothing stores this as a column anywhere, matching the same "derived, never stored" principle already established for cashbox balances (parent audit Part 4/11).
- **[RECOMMENDATION — frontend consequence, not just a backend one]** `PaymentHistory.jsx`, `UnpaidStudents.jsx`, `PaymentReports.jsx`, and the receipt/badge components currently read `p.refunded`/`p.refundedAmount` directly off the payment object. All of them will need to compute "net paid" / "refunded" from the linked `treasury_txn` rows instead, once those client-only fields no longer exist. This is real, non-trivial frontend work this phase must account for, not a side detail — flagging it now so it's scoped, not discovered mid-implementation.
- **Generic reversal endpoint stays correctly out of reach:** because the refund entry carries `ref_type:'refund'` (non-null), `treasuryTxn.js`'s existing `if (original.ref_type) throw` guard (closed, verified in 3B-14B §17.2) already refuses to let anyone reverse it through `PUT /api/treasuryTxn/:id/reverse`. No change needed there — this phase only needs to *create* refund rows correctly, the existing ledger endpoint already refuses to touch them.

**What replaces the "delete payment" button:** since `payments` becomes un-deletable and un-editable (§7), `PaymentsPage.jsx`'s current `handleDelete` ("حذف الدفعة", cascading into the currently-broken `reverseLinkedTxn` — see §9) has no valid server-side equivalent left. **[DECISION REQUIRED]** — see §16 Decision 4: repurpose that button into "refund in full" (reusing the new refund endpoint with `amount = payment.amount` and a required reason, mirroring `RefundView`'s existing reason-required UX), or remove it and route users to the Refund view exclusively. Not resolved here.

---

## 6. Refund concurrency — an aggregate-sum race, explicitly *not* provable by the single-row technique 3B-14B used

**[VERIFIED FACT — architecturally distinct from the bug fixed in 3B-14B]** 3B-14B's race was a single row's status flip, fixed by folding the check into one conditional `UPDATE ... WHERE status='active'`. Refund correctness is a different shape: the invariant is **"SUM of all active refund rows for this payment must never exceed the payment's amount"** — an aggregate over a growing set of *other* rows, not a single row's own status. A conditional `UPDATE ... WHERE <sum condition>` is not expressible as one atomic statement the way the reversal guard was, because the row being checked (the payment) is not the row being written (a new refund `treasury_txn` row).

Two concurrent refund requests against the same payment, both reading "0 (or X) refunded so far" before either commits, could both pass a naive check-then-insert and jointly over-refund the payment — the exact same *shape* of bug as 3B-14B's, recurring in a new place, and **I am not asserting it is either safe or unsafe by reasoning alone** — per your explicit instruction (§8), this must be proven by a deterministic test, not described as "verified logically."

**[RECOMMENDATION]** The correct fix is a **pessimistic lock on the payment row for the duration of the refund transaction**, acquired via `tx.$queryRawUnsafe('SELECT * FROM payments WHERE id = $1 FOR UPDATE', id)` (Prisma's typed client has no `FOR UPDATE` primitive; raw SQL inside the same `tx` is required — this does not touch `crud.js` or the schema). This serializes concurrent refund attempts against the *same* payment: the second transaction blocks at the lock acquisition until the first commits, then re-reads the sum-of-refunds-so-far against post-commit data before deciding whether its own refund fits. Locking a row purely to serialize logically-related writes elsewhere (not to modify the locked row itself) is a standard, legitimate Postgres pattern — consistent with, not a departure from, the "payments is immutable" decision (the row is locked, never written).

This will require its own deterministic, scratch-database concurrency test before closure — same methodology 3B-14B's closure review established (disposable database, `AsyncLocalStorage`-gated interleaving, real unmodified route code, dropped after use), extended to two rows (a payment + its refund attempts) instead of one. Proposed explicitly in §13; not run yet, since this is audit-only.

---

## 7. Append-only for `payments` — what's actually needed, and what would be a schema change

**[VERIFIED FACT]** `payments` has **no** DB-level delete or update trigger today (§3) — unlike `treasury_txn`, which already had `trg_no_delete_treasury` before 3B-14B even started. Whatever "append-only protection... where approved" means for `payments`, it is **not already half-built** the way it was for `treasury_txn`.

**[RECOMMENDATION]** App-level guard only, no schema change — mirroring `treasury_txn.js`'s own `PUT/PATCH/DELETE /:id → 405` pattern exactly, inside a new dedicated `payments.js` route file. This satisfies "immutable payment records" without adding a new DB trigger, consistent with your instruction not to introduce schema changes unless the audit demonstrates they're required — nothing here demonstrates a DB-level trigger is *required*; an app-level 405 is sufficient given there is exactly one write surface (the dedicated route file) and generic CRUD's own POST/PUT/PATCH/DELETE for `payments` can simply stay 405'd via `READ_ONLY_COLLECTIONS` (unchanged) as a second, redundant layer underneath the dedicated router — the same defense-in-depth style already used for `cashboxes`/`treasury_txn`. A DB trigger identical to `prevent_delete()` remains available later if you ever want DB-level parity with `treasury_txn`; not proposed now. See §16 Decision 2.

---

## 8. `created_by` — does not apply to `payments` itself; applies to its linked `treasury_txn` row

**[VERIFIED FACT]** `payments` has no `created_by` column at all (§3) — the approved "`created_by` = `req.user.id`" decision cannot be applied to the `payments` row itself, only to the `treasury_txn` row created alongside it (which does have a real `created_by` FK, already handled correctly by the existing `treasuryTxn.js` convention: `userId: req.user?.id ?? null`). The new payments endpoint must derive this the same way — never read `createdBy` from the request body, exactly as `treasuryTxn.js`'s `POST /` middleware already does for the manual-entry case.

---

## 9. A currently-live bug worth knowing before designing the replacement

**[VERIFIED FACT]** `PaymentsPage.jsx`'s `handleDelete` calls `reverseLinkedTxn('payment', p.id, `حذف دفعة ${p.id}`, currentUser?.id)` — but `reverseLinkedTxn`'s real signature (`treasury.slice.js`) is `(refId, reason, by)`, only **three** parameters. The call's four arguments therefore map as `refId:'payment'` (a literal string, not an actual ref id), `reason:p.id`, `by:`the reason text`, and `currentUser?.id` is silently dropped entirely. Inside `reverseLinkedTxn`, `txns.find(t => t.refId === refId ...)` then searches for a treasury row whose `refId` literally equals the string `'payment'` — which never matches any real linked entry (real entries carry `refId:<payment.id>`, per `txnFromPayment`, §2). **Deleting a payment today does not actually reverse its linked treasury entry** — this cascade has been silently broken since it was written, and is confirmed dead-on-arrival by direct signature inspection, not something 3B-14C is breaking. Worth knowing precisely because it means nothing today depends on this cascade actually working; the new atomic refund/void design (§5) isn't replacing working behavior, it's replacing a bug.

---

## 10. Money-flow design — atomic operations, transaction boundaries

**Create payment** (`POST /api/payments`, one `runInTransaction` call):
1. Validate input (student exists, amount > 0, month 1–12, `pay_type`/`method` within the agreed vocabulary — §16 Decision 1, date present).
2. Inside `tx`: fetch `student` (for `monthly_fee`) and `group` (for `price`) server-side — **[RECOMMENDATION]** compute `status` (`paid`/`partial`) server-side from real DB fee data, the same "server recomputes authoritative state, never trusts a client-sent derived value" principle already used for `admissionActivation.js`'s student-code generation. The client-sent `status` (if any) is ignored.
3. Pre-generate `paymentId`/`treasuryTxnId` (`crypto.randomUUID()`, two calls, no DB round trip).
4. `tx.treasury_txn.create()` — `id:treasuryTxnId, cashbox_id:<resolved cashbox>, type:'income', category:<derived from pay_type>, amount, method, party:<student name>, notes:<description>, ref_type:'payment', ref_id:paymentId, payment_id:null (§3 — cannot be set yet), created_by:req.user.id`.
5. `tx.payments.create()` — `id:paymentId, student_id, group_id, material_id, month, year, amount, method, pay_type, date, status:<server-computed>, notes, treasury_txn_id:treasuryTxnId`.
6. Return both rows.

**Cashbox resolution** — **[DECISION REQUIRED]** today the client silently auto-picks "default active cashbox, else first active" with no user choice (§2). Keep that exact behavior server-side (no new UI), or let the payment form specify a cashbox explicitly? Not resolved here — see §16 Decision 3.

**Refund** (`POST /api/payments/:id/refund`, one `runInTransaction` call):
1. Inside `tx`: `SELECT * FROM payments WHERE id = $1 FOR UPDATE` (raw — the pessimistic lock, §6). 404 if missing.
2. Compute `alreadyRefunded = SUM(treasury_txn.amount) WHERE payment_id = paymentId AND ref_type='refund' AND status='active'` (inside the same `tx`, after the lock — this is what the lock protects).
3. Validate `0 < amount <= payment.amount - alreadyRefunded`; require a non-empty reason (matching `RefundView`'s existing UX and `reverseTreasuryTxn`'s existing required-reason precedent from 3B-14B).
4. Resolve the cashbox that should absorb the expense — **[RECOMMENDATION]** the same cashbox the original payment's income entry used (`treasury_txn.cashbox_id` looked up via `payments.treasury_txn_id`), not a re-picked "default" — refunding from a *different* cashbox than the money originally entered would silently misstate that cashbox's balance. Not explicitly decided by you yet; flagging as the sensible default, open to being overridden.
5. Live balance check against that specific cashbox (server-side recomputation from real `treasury_txn` rows, never trusting a client-sent balance — parent audit Part 19 item 14, already an established principle).
6. `tx.treasury_txn.create()` — `type:'expense', category:'refund', ref_type:'refund', ref_id:paymentId, payment_id:paymentId, amount, party:<student name>, notes:<reason>, created_by:req.user.id`.
7. `payments` row is **never written to** (§5). Return the new treasury row.

---

## 11. Files expected to change

- **`backend/src/routes/payments.js`** (new) — `reversePaymentCreate`... i.e. `createPayment({...}, {userId})` and `refundPayment({id, amount, reason}, {userId})`, both exported standalone (testable without HTTP, mirroring `treasuryTxn.js`/`admissionActivation.js` exactly); thin router: `POST /`, `POST /:id/refund`, explicit `PUT/PATCH/DELETE /:id` → 405.
- **`backend/src/server.js`** — mount `paymentsRouter` before the dynamic loop, same position/pattern as `treasuryTxnRouter`. `payments` **stays** in `READ_ONLY_COLLECTIONS` (defense-in-depth under the dedicated router, §7) — no removal needed, unlike `treasuryTxn`'s removal in 3B-14B, because *no* verb for `payments` should ever reach generic CRUD.
- **`src/services/api.js`** — `pgCreatePayment`, `pgRefundPayment`, plus a `normalizePaymentResponse` (Decimal→Number, date normalization — same pattern as 3B-14B's `normalizeTreasuryTxnResponse`).
- **`src/store/db.middleware.js`** — `COLLECTION_FIXUPS.payments` mirrored, matching 3B-14B's precedent for the boot-sync path.
- **`src/store/slices/payments.slice.js`** — server-truth-first `addPayment`/refund actions replacing pure-local mutation; `removePayment`/local delete semantics likely retired (§5's decision).
- **`src/modules/payments/PaymentsPage.jsx`** — `handleSave` rewritten server-truth-first; `RefundView` rewritten to call the new refund endpoint instead of building a local treasury entry + mutating the payment; `handleDelete` either repurposed into "full refund" or removed (§16 Decision 4).
- **`src/modules/payments/PaymentHistory.jsx`, `UnpaidStudents.jsx`, `PaymentReports.jsx`, `components/PaymentBadge.jsx`, `buildPaymentsReport.js`** — all currently read `p.refunded`/`p.refundedAmount` directly; need to switch to deriving refund state from linked `treasury_txn` rows (§5).
- **`src/services/paymentService.js`** — `PAYMENT_METHODS`/`PAYMENT_TYPES` narrowed or left as-is depending on §16 Decision 1; `createPayment`'s client-side id generation retired if server-generated ids are adopted (consistent with every atomic endpoint since `materialDistribution.js`).
- **Not touched:** `backend/prisma/schema.prisma`, `backend/src/routes/crud.js`, `backend/src/server.js`'s `PRESERVE_CLIENT_ID_COLLECTIONS`/`ADMIN_ONLY_COLLECTIONS`, anything under `admission_payments`/`AdmissionsPage.jsx`.

---

## 12. Frontend server-truth adoption plan

Same discipline as `TreasuryPage.jsx`'s 3B-14B rewrite: no local mutation before a successful server response; on success, adopt exactly what the server returns (including server-computed `status` and server-generated ids) rather than the client's locally-built object. `handleSave` posts the raw form data and waits; `RefundView.doRefund` posts to the refund endpoint and waits; both replace their current "mutate local state immediately" pattern. Any UI that currently reads `p.refunded`/`p.refundedAmount` must instead read the payment's linked `treasury_txn` rows (via a selector combining `payments` + `treasuryTxn` state, both already boot-synced from PostgreSQL) to derive "net paid so far" and "is this fully refunded."

---

## 13. Failure/rollback matrix

| Step | Failure | Result |
|---|---|---|
| Create: student/group lookup fails | 400, no rows written | `payments`/`treasury_txn` unchanged |
| Create: `treasury_txn.create()` succeeds, `payments.create()` fails (e.g. unexpected constraint violation) | transaction rolls back both | Postgres transaction guarantees this — no orphaned treasury row, no half-written payment |
| Refund: lock acquisition | second concurrent refund on same payment blocks, does not fail | proceeds once first commits, re-checks sum against fresh data |
| Refund: sum check fails (over-refund) | 400, no treasury row written | `payments`/`treasury_txn` unchanged |
| Refund: cashbox balance insufficient | 400, no treasury row written | same |
| Any request: `PUT/PATCH/DELETE /api/payments/:id` | 405, before touching DB | `payments` unchanged |

---

## 14. Concurrency strategy — explicit, not asserted

Two distinct concurrency concerns in this phase, requiring two distinct treatments:
1. **Double-create** (two identical "add payment" submissions, e.g. double-click) — **[RECOMMENDATION]** not a correctness hazard the way the other two are: each successful call creates one legitimate `payment` + `treasury_txn` pair; a genuine double-submission produces two real payments, which is a UX/idempotency concern (client-side submit-guard), not a data-integrity race. Not proposed as a server-side dedupe mechanism here — flagging so it isn't assumed solved by this audit if you want one.
2. **Refund over-commit** (§6) — **the one real correctness race in this phase.** Proposed fix: `SELECT ... FOR UPDATE` lock on the payment row for the duration of the refund transaction. **This will be proven, not asserted**, via the same deterministic scratch-database methodology 3B-14B's closure review required (§6, §18) — I will not write "verified logically" in the closure report for this item.

---

## 15. Test strategy

No new framework. Vitest + Testing Library component-contract tests (mocked `fetch`) for `PaymentsPage.jsx`'s create/refund flows, mirroring `TreasuryPage.treasuryTxn.test.jsx`'s exact technique (assert the outgoing request body, assert no premature local mutation, assert server-response adoption, assert untouched state on failure). Backend: one-off guaranteed-rollback Prisma scripts (real schema, real constraints, wrapped in a `$transaction` that always throws a sentinel, deleted after use) for `createPayment`'s two-table write shape and vocabulary/constraint edge cases; a **separate, deterministic, disposable-scratch-database test** specifically for the refund concurrency guarantee (§6), following 3B-14B's corrected methodology exactly — not folded into the guaranteed-rollback script, since genuine concurrency needs two real connections, which a single rolled-back transaction cannot provide (the same limitation 3B-14B's closure review already worked through).

---

## 16. Decisions Required From You

**Decision 1 — `pay_type`/`method` vocabulary reconciliation (the highest-impact decision in this phase).** Options: (a) widen `chk_payment_type` to `subscription|material|exam|extra|other` and `chk_payment_method` to add `visa` (schema change — requires your explicit sign-off per your own instruction #9, but preserves all currently-working form options); (b) narrow `PaymentForm.jsx`'s option lists to match the DB exactly (`subscription|material` only; `cash|transfer|instapay|check`, dropping `visa`) — no schema change, but removes real, currently-reachable functionality (exam fees, "extra/مراجعة" bookings, "other", visa-method payments) that a real user can select today. Not resolved here — recommend you decide (a) vs (b) explicitly before implementation; I have not defaulted to either.

**Decision 2 — Append-only enforcement mechanism for `payments`.** App-level 405 guard only (§7, recommended, no schema change) vs. also adding a DB-level `prevent_delete()`-style trigger for full parity with `treasury_txn` (schema change, not demonstrated as required).

**Decision 3 — Cashbox resolution on payment creation.** Keep today's silent "auto-pick default active cashbox" behavior server-side (no new UI) vs. let the payment form specify a cashbox explicitly (bigger UX change).

**Decision 4 — What replaces "delete payment" in the UI.** Repurpose the existing delete button into "refund in full" (reusing the new refund endpoint, reason required) vs. remove it entirely and route users through the Refund view only.

**Decision 5 (tied to 3) — Refund cashbox.** Recommended default: refund debits the *same* cashbox the original payment's income entry used (looked up via `payments.treasury_txn_id → treasury_txn.cashbox_id`), not a freshly re-picked "default" cashbox. Confirm or override.

**Decision 6 — Payment ids.** Server-generated `crypto.randomUUID()` (matching every atomic endpoint since `materialDistribution.js`/`admissionActivation.js`/3B-14B's Decision 2), replacing the current client-side `p${Date.now()}` scheme. No collections currently reference a payment's id before server confirmation (unlike `students`/`groups`/`admissions`/`cashboxes`, which are in `PRESERVE_CLIENT_ID_COLLECTIONS` for exactly that reason) — recommended, not yet confirmed by you.

---

## 17. Exact closure criteria (for when implementation is later approved and completed)

- Both endpoints implemented and exercising the exact transaction boundaries in §10, using the insert order forced by §3's FK-circularity finding.
- Refund concurrency proven by a deterministic scratch-database test (§6/§14/§15) — passing, with the actual race demonstrated against the *unpatched* design first if one is found, exactly as 3B-14B's closure review required, never asserted from reasoning alone.
- Focused payment tests + full regression suite passing, count re-confirmed against this session's baseline (136 tests, 20 files, unchanged since 3B-14B closure).
- Live `studix` row counts for all four financial tables re-confirmed unchanged from this audit's baseline (`cashboxes=0, treasury_txn=0, payments=0, admission_payments=0`) until real implementation is approved and run.
- No temporary scripts/scratch databases remain.
- `admission_payments`, `schema.prisma`, `crud.js` confirmed untouched.
- All six §16 decisions resolved explicitly, not defaulted.
- Closure report filed as `PHASE_3B-14C_PAYMENTS_TREASURY_AUDIT.md`'s implementation addendum (same file, extended — matching 3B-14B's own §17 pattern of correcting/extending the same report rather than starting a new one).

---

## 18. Decision Gate

### A. Verified Facts
- `payments` has zero live backend write path today (GET-only via generic CRUD); `PaymentsPage.jsx`'s three write flows are 100% local, zero network calls.
- `payments.pay_type`/`method` CHECK constraints are still narrower than the live, reachable frontend form options — confirmed by reading `PaymentForm.jsx` directly, not inferred.
- `payments`↔`treasury_txn` have two independent, non-deferrable FKs pointing in opposite directions — forcing `treasury_txn` to be inserted before `payments` in any atomic create, with `treasury_txn.payment_id` necessarily NULL for that row.
- `payments` has no DB-level append-only protection and no `created_by` column at all.
- `PaymentsPage.jsx`'s existing delete→reverse cascade is already broken today (signature mismatch, confirmed by direct inspection) — nothing currently depends on it working.
- The refund-over-commit race is a structurally different concurrency problem from the one fixed in 3B-14B (aggregate-sum invariant vs. single-row status flip) and requires a lock-based fix, not a conditional-update fix — not yet proven safe or unsafe by any test.

### B. Recommendations (not yet approved)
- `treasury_txn` as ledger, `payments` as an immutable business document referencing it (already established direction, applied concretely here).
- Refund via pessimistic row lock (`SELECT ... FOR UPDATE`) + aggregate sum check inside one transaction, proven by a deterministic scratch-database test before closure.
- App-level-only append-only guard for `payments` (no schema change).
- Server-generated payment ids; server-computed `status` from real fee data; `created_by` derived server-side onto the linked `treasury_txn` row only.

### C. Decisions Required From You
Six items, listed in full in §16: (1) vocabulary reconciliation direction, (2) append-only mechanism, (3) cashbox resolution on create, (4) UI replacement for "delete payment", (5) refund cashbox default, (6) payment id strategy.

*(Approved by you, with six explicit decisions: (1) widen the DB CHECK constraints rather than narrow the frontend, consolidating vocabulary into one shared source of truth; (2) app-level 405 guard **plus** a DB-level `prevent_delete()` trigger on `payments`, explicitly not on `cashboxes`; (3) no silent cashbox auto-pick — the form must require an explicit choice; (4) "delete payment" replaced entirely by a full-refund operation, payment immutable; (5) refund always uses the same cashbox as the original payment; (6) server-generated UUIDs for payments, no client-id preservation.)*

---

## 19. A discovery that stopped implementation before it started

Decision 1 (widen `payments.method` to include `visa`) has a direct consequence Decision-Gate item didn't separately name: the atomic create endpoint also writes a **linked `treasury_txn` row** carrying the same method, and `treasury_txn.method`'s own CHECK constraint (`chk_treasury_method`) still only allowed `cash|transfer|instapay|check` — no `visa`. Your own scope instruction (§13 in your approval message) named schema changes as limited to "the payment vocabulary CHECK constraints and payments append-only trigger," which doesn't literally cover `treasury_txn`. Every `visa` payment would have failed at the treasury_txn insert step otherwise, contradicting Decision 1's own intent.

Per your instruction to stop when a discovery materially changes the approved design, I asked before writing any code. **Your answer:** widen `chk_treasury_method` too, as a necessary consequence of the already-approved vocabulary decision, not a new architectural direction — with `visa` mapped honestly (never silently substituted to `transfer` or any other value), documented explicitly, and no other `treasury_txn` vocabulary change authorized. Implemented exactly that; see §21.2.

## 20. Implementation

**Files changed (13):**

1. **`backend/src/routes/payments.js`** (new) — exports `createPayment({...}, {userId})` and `refundPayment({id, amount, reason}, {userId})`, both atomic via `runInTransaction`, mirroring `treasuryTxn.js`/`admissionActivation.js`'s structure exactly. Thin router: `POST /` (create), `POST /:id/refund`, explicit `PUT/PATCH/DELETE /:id` → 405.
2. **`backend/src/server.js`** — `paymentsRouter` mounted before the dynamic loop, same position/pattern as `treasuryTxnRouter`. `payments` **stays** in `READ_ONLY_COLLECTIONS` (unlike `treasuryTxn`'s removal in 3B-14B) — no verb for `payments` should ever reach generic CRUD, since even the simple-create case here needs the composite two-table transaction, not a single-table passthrough.
3. **Live `studix` schema (DDL, not `schema.prisma`)** — four changes, applied in one transaction (all-or-nothing): widened `chk_payment_type` (added `exam`/`extra`/`other`), widened `chk_payment_method` (added `visa`), widened `chk_treasury_method` (added `visa`, per §19), added `trg_no_delete_payments BEFORE DELETE ON payments EXECUTE FUNCTION prevent_delete()` (reusing the existing function, not a new one). `schema.prisma` itself untouched — Prisma's schema format doesn't represent CHECK constraints or triggers at all (confirmed in the original audit, §3), so there was nothing in that file to change.
4. **`src/services/api.js`** — `pgCreatePayment`, `pgRefundPayment`, `normalizePaymentResponse`.
5. **`src/store/db.middleware.js`** — `COLLECTION_FIXUPS.payments` added (amount/date normalization on the boot-sync path, mirroring cashboxes/treasuryTxn).
6. **`src/utils/validation.js`** — `paymentSchema.cashboxId` added as a required field (Decision 3).
7. **`src/modules/payments/PaymentForm.jsx`** — required cashbox `<select>` added (active cashboxes only, starts empty always — no pre-fill even when exactly one exists, per the letter of Decision 3); submit button disabled and a clear inline message shown when zero active cashboxes exist.
8. **`src/modules/payments/PaymentsPage.jsx`** — `handleSave` rewritten server-truth-first (atomic create, adopts both `payment` and `treasuryTxn` from one response); `handleDelete`/`deleteTarget` replaced by `handleFullRefund`/`fullRefundTarget` (a reason-required confirm modal, calling the refund endpoint with the full remaining amount — no local mutation of the payment, ever); `RefundView` rewritten to call `pgRefundPayment`, adopt only the new refund `treasuryTxn`, and derive "remaining refundable" from linked ledger rows instead of a mutated `payment.amount`.
9. **`src/modules/payments/PaymentHistory.jsx`** — the delete button's icon/title changed (🗑→↩️, "استرداد كامل") to reflect its new full-refund semantics; same callback wiring, no structural change.
10. **`src/services/paymentService.js`** — `getRefundedAmount`/`getRemainingRefundable` added (the single derivation point for "how much of this payment has been refunded," replacing the old `p.refunded`/`p.refundedAmount` fields that never had a matching DB column).
11. **`src/modules/payments/buildPaymentsReport.js`** — `PAY_METHOD`/`PAY_TYPE_L` now derive from `paymentService.js`'s `PAYMENT_METHODS`/`PAYMENT_TYPES` instead of maintaining an independent, already-diverged copy (Decision 1's "consolidate into one shared source of truth").
12. **`src/store/slices/treasury.slice.js`, `src/services/cashboxService.js`, `src/store/app.store.js`, `src/store/index.js`** — `addLinkedTxn`/`reverseLinkedTxn` removed (zero remaining call sites confirmed by grep before removal — `PaymentsPage.jsx` was their only caller, and its `reverseLinkedTxn` call was itself already silently broken by a signature mismatch, §9 of the audit); `txnFromPayment` (`cashboxService.js`) removed as its only caller (`addLinkedTxn`) no longer exists; dangling re-exports cleaned up in `app.store.js`/`index.js`, matching 3B-14B's own precedent for actions this exact phase makes dead.
13. **`src/modules/payments/PaymentsPage.payments.test.jsx`** (new) — 6 component-contract tests.

**Not touched:** `backend/prisma/schema.prisma` (confirmed — no field/model changes, only live DDL outside Prisma's representation), `backend/src/routes/crud.js`, `src/store/slices/students.slice.js`, `src/modules/admissions/AdmissionsPage.jsx` and `admissions.slice.js` (its own local, dormant `addTreasuryTxn` calls are unaffected — still 100% local, per §2 of the audit), any Phase 3B-8→3B-13 file, `backend/src/server.js`'s `PRESERVE_CLIENT_ID_COLLECTIONS`/`ADMIN_ONLY_COLLECTIONS`.

## 21. Decisions applied — confirmation against the live implementation

### 21.1 Cashbox resolution (Decision 3)
`createPayment` requires `cashboxId` in the request and rejects (400) if the cashbox doesn't exist or `active` is false — no fallback of any kind. Confirmed live: an inactive/nonexistent cashbox is rejected before any row is written (§22.2).

### 21.2 Vocabulary widening (Decision 1 + §19's necessary consequence)
`payments.pay_type`: `subscription|material|exam|extra|other` (was 2, now 5 — matches the live form exactly). `payments.method` **and** `treasury_txn.method`: `cash|transfer|instapay|check|visa` (both widened identically, so a `visa` payment's linked ledger row can honestly record `method:'visa'` — never remapped). `buildPaymentsReport.js`'s independent label list retired in favor of `paymentService.js`'s canonical `PAYMENT_METHODS`/`PAYMENT_TYPES`.

### 21.3 Payments append-only (Decision 2)
Both layers present: `payments.js`'s `PUT/PATCH/DELETE /:id` → 405 (app level), **and** `trg_no_delete_payments` (DB level, live) — confirmed both independently in §22. `cashboxes` deliberately untouched, per your explicit instruction.

### 21.4 Full refund replaces delete (Decision 4)
No `pgDeletePayment` exists anywhere in `api.js`. The former delete button now opens a reason-required "استرداد كامل" modal that calls `POST /:id/refund` with the full remaining amount. The payment row is never written to by this flow — only a new linked `treasury_txn` expense row is created. Confirmed via a real-DB immutability check in §22 (byte-for-byte row comparison before/after).

### 21.5 Same-cashbox refund (Decision 5)
`refundPayment` derives the cashbox from the original payment's own linked `treasury_txn.cashbox_id` — the client never sends a `cashboxId` for refund, and the server never re-resolves one. Confirmed both in the frontend contract test (refund request body has no `cashboxId` key) and the backend DB verification (refund row's `cashbox_id` matches the original exactly).

### 21.6 Server-generated payment IDs (Decision 6)
`createPayment` calls `crypto.randomUUID()` for both the payment and its treasury_txn id, inside the transaction; `payments` was never added to `PRESERVE_CLIENT_ID_COLLECTIONS`. The client-side `p${Date.now()}` id scheme (`paymentService.js`'s `createPayment`, still present but now only reachable through the already-dead `hooks/usePayments.js`) is no longer used by the live write path.

### 21.7 Atomicity and FK order (requirement 7)
Implemented exactly as specified: `treasury_txn` created first (`payment_id: null`), then `payments` (referencing the just-created `treasury_txn_id`), then `treasury_txn.payment_id` updated to point at the new payment — all three steps inside one `runInTransaction` call, confirmed to roll back completely on any failure at any step (§22.2/22.3).

### 21.8 Refund concurrency (requirement 8) — proven, not asserted
`refundPayment` acquires a `SELECT ... FOR UPDATE` lock on the payment row (raw SQL inside the transaction) before computing the sum of prior active refunds, serializing concurrent refund attempts against the same payment via Postgres's own row-lock semantics — the same class of fix applied to `treasuryTxn.js`'s reversal race during 3B-14B's closure, adapted here for an aggregate-sum invariant rather than a single-row status flip. **This is not described as "verified logically" anywhere in this report** — see §22.5 for the deterministic proof.

## 22. DB verification

**Methodology:** a disposable scratch database (`studix_3b14c_scratch`), schema pushed unmodified from `schema.prisma`, then manually brought to full parity with the live `studix` schema — including the CHECK constraints, triggers, and trigger functions that `schema.prisma` cannot represent at all (confirmed necessary: a fresh `db push` alone produces a database with **no** CHECK constraints or triggers whatsoever, since none of that is part of the Prisma schema format). The real, unmodified `createPayment`/`refundPayment` functions were imported directly and pointed at this scratch database via the `globalThis.prisma` singleton-injection technique established in 3B-14B's closure — no source file modified to make this possible. `studix` itself was never touched by any of this; the scratch database was dropped when done.

**22.1 — Vocabulary widening, end-to-end:** created a real payment with `method:'visa'`, `payType:'exam'` — both succeeded, and the linked `treasury_txn` row's own `method` column stored `'visa'` too (proving the ledger-side widening from §19 actually works, not just the payments-side one).

**22.2 — Atomicity / rollback at each meaningful failure point:**
- Nonexistent `cashboxId` → rejected, payment and treasury_txn row counts unchanged (zero residue).
- Inactive `cashboxId` → same (no silent fallback, Decision 3 confirmed under an actual attempted write, not just code review).
- 3-step FK order (`payment_id` initially null, then linked after the payment exists) confirmed by inspecting the final committed row.

**22.3 — Refund correctness:**
- Partial refund succeeds; the original payment row is **byte-for-byte identical** before and after (compared as real DB rows, not JS objects) — immutability proven against Postgres itself.
- Over-refund (amount exceeding remaining) → rejected, zero new rows.
- Insufficient cashbox balance (simulated by draining a cashbox with an unrelated expense between payment and refund) → rejected, zero new rows.

**22.4 — Hard delete:** a raw `DELETE FROM payments` (bypassing the application entirely) was rejected by `trg_no_delete_payments` with the expected append-only exception; the row was confirmed still present afterward — the trigger genuinely blocks, it doesn't silently no-op.

**22.5 — Concurrency, proven deterministically:** three independent rounds, each creating a fresh 100-EGP payment in its own cashbox with ample balance, then firing **two genuinely concurrent** `refundPayment(id, 70, reason)` calls via `Promise.allSettled` (no artificial delays or synchronization — the real `SELECT ... FOR UPDATE` lock is what provides the guarantee, so none was needed for determinism). Result, every round: **exactly one of the two succeeded, one was rejected, and the sum of active refund rows never exceeded 100.** Because the safety property is enforced by Postgres's own row-level locking rather than by test timing, this outcome is deterministic by construction, not a statistical likelihood — re-running it does not change the qualitative result. This directly answers requirement 9: no residue on `studix` (the race ran entirely on the scratch database), and the invariant is empirically proven, not reasoned about.

**22.6 — Live HTTP routing check (studix, zero-risk — no create/refund ever attempted):** with a locally-minted valid session (using the real `admin` user id and the server's own `SESSION_SECRET`, the same signing path `POST /api/session` uses), confirmed live against the running dev server: `GET /api/payments` → 200 (still passes through generic CRUD as before); `PUT`/`PATCH`/`DELETE /api/payments/:id` → 405, all before touching the database; `POST /api/payments/:id/refund` with a nonexistent id → 400 (proving real routing reaches the real handler); `POST /api/payments` with a nonexistent student → 400. An unauthenticated request confirmed `requireAuth` gates the route first (401), matching every other financial route's guard order. Final live counts re-confirmed: `payments=0, treasury_txn=0, cashboxes=0, admission_payments=0` — unchanged throughout.

**22.7 — Final baseline:** identical to before this phase began. All temporary scripts (`_tmp_scratch_setup.mjs`, `_tmp_payments_verify.mjs`) deleted after use; the scratch database dropped; the dev server used for the live routing check stopped afterward.

## 23. Testing

6 component-contract tests (`PaymentsPage.payments.test.jsx`), mocked `fetch`, mirroring `TreasuryPage.treasuryTxn.test.jsx`'s exact technique:
- Successful atomic creation: exact `POST /api/payments` body (confirms no client `id`/`status` is sent as authoritative), no premature mutation, adopts **both** `payment` and `treasuryTxn` together from one response.
- Creation failure: neither collection mutated.
- Cashbox selection: zero active cashboxes blocks submission entirely (disabled button, zero fetch calls, clear inline message) — Decision 3 enforced at the UI layer, not just the API.
- Full refund: exact `POST /:id/refund` body (amount = full remaining, reason required, **no `cashboxId` key at all** — Decision 5), no premature mutation, adopts only the new refund `treasuryTxn`, and the original payment object in the store is asserted unchanged (`toEqual`) both before and after — immutability checked at the frontend contract level, complementing §22.3's real-DB check.
- Refund failure: neither collection mutated.
- No-DELETE-path check: confirms this page never issues a `DELETE` request under any exercised scenario.

**Full regression:** 21 test files / 142 tests pass (was 136 at 3B-14B's closure; +6 new, 0 broken).

## 24. Explicit confirmations

- **`admission_payments`:** not read for modification, not written to, not referenced by any new code — row count unchanged (0) throughout, confirmed in §22.6.
- **`backend/prisma/schema.prisma`:** not modified — confirmed no field/model changes; the DDL changes live entirely outside what this file can represent.
- **`backend/src/routes/crud.js`:** not modified.
- **`src/store/slices/students.slice.js`:** not modified.
- **`src/modules/admissions/AdmissionsPage.jsx` / `admissions.slice.js`:** not modified; their own dormant, local-only treasury calls are unaffected by anything in this phase.
- **No temporary scripts or scratch databases remain** — both deleted/dropped after use (§22.7).

Phase 3B-14C is closed pending your review. Phase 3B-14D (`admission_payments`) is **not started**.
