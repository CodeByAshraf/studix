# Phase 3B-14 — Financial Domain: Read-Only Pre-Implementation Audit & Architecture Design

**Status: AUDIT ONLY. Nothing implemented. No file modified except this report. No database write of any kind performed.** This document is the sole output of this phase, per explicit instruction. Every claim below is labeled **[VERIFIED FACT]** (directly observed in code/schema/live DB during this session) or **[RECOMMENDATION]** (a proposal requiring your explicit approval before any implementation). Phase 3B-13 remains CLOSED and was not touched. `admission_payments` / Phase 3B-13C remains BLOCKED — this report is the pre-implementation audit that blocker requires.

---

## Part 1 — Current architecture inventory

### Frontend files (all read in full this session)

| File | Lines | Role | Live or dead |
|---|---|---|---|
| `src/store/slices/payments.slice.js` | 27 | `payments[]` state + pure local CRUD actions | **Live** |
| `src/store/slices/treasury.slice.js` | 141 | `cashboxes[]`, `treasuryTxn[]`, `treasuryMeta` state + local CRUD, reversal, transfer, link-from-payment actions | **Live** |
| `src/services/cashboxService.js` | 250 | Self-described *"Single source of truth for all financial computations"* — validation, balance derivation, txn/transfer builders, reporting aggregations | **Live** — imported by `TreasuryPage.jsx`, `PaymentsPage.jsx`, `AdmissionsPage.jsx`, `treasury.slice.js` |
| `src/services/treasuryService.js` | 145 | Category/method label constants + a second, independent set of balance/report functions | **Mixed** — category constants (`INCOME_CATEGORIES`, `EXPENSE_CATEGORIES`, `ALL_CATEGORIES`, `PAYMENT_METHODS`) are live (used by `TxnForm.jsx`, `LedgerTable.jsx`); its own `computeRunningBalance`, `getCurrentBalance`, `getPeriodStats`, `getMonthlyStats`, `txnFromPayment`, `txnFromMatDist`, `getIncomeByCategory`, `getExpenseByCategory` are **[VERIFIED FACT] 100% dead — grep-confirmed zero imports anywhere in `src/`**, superseded by the equivalent `cashboxService.js` functions |
| `src/services/transactionEngine.js` | 341 | A **more sophisticated, entirely separate** financial engine: `TXN_STATUS` (`active/reversed/pending/rejected`), an approval workflow (`APPROVAL_THRESHOLD`), a full per-transaction `history[]` audit trail, `migrateTxn`/`migrateAllTxns` back-compat helpers | **[VERIFIED FACT] 100% dead code — grep-confirmed, imported nowhere in `src/`** |
| `src/services/paymentService.js` | 128 | Payment validation, `createPayment` builder, revenue/unpaid-student reporting helpers | **Live** |
| `src/hooks/usePayments.js` | 53 | A hook exposing `addPayment`/`getRevenue`/`getUnpaid`; its `addPayment` does **not** create any treasury link | **[VERIFIED FACT] 100% dead code — default export never imported anywhere in `src/`.** Note: `src/store/app.store.js:134` separately exports an unrelated same-named `usePayments` (a raw `payments` selector) — a naming collision between two different, unrelated exports, one dead. |
| `src/modules/payments/PaymentsPage.jsx` | 406 | The actual live UI + write path: add/delete payment, refund flow (`RefundView`) | **Live** |
| `src/modules/payments/PaymentForm.jsx`, `PaymentHistory.jsx`, `PaymentReports.jsx`, `buildPaymentsReport.js`, `components/PaymentBadge.jsx` | ~1050 combined | Form + display + print-report consumers of `payments[]` | **Live**, read-only consumers |
| `src/modules/treasury/TreasuryPage.jsx` | 846 | The live UI for cashboxes/ledger/transfers/reports — imports calculation logic from `cashboxService.js`, category/method labels from `treasuryService.js` | **Live** |
| `src/modules/treasury/components/TxnForm.jsx`, `LedgerTable.jsx` | — | Consume only the category/method constants from `treasuryService.js` | **Live** |
| `src/modules/admissions/AdmissionsPage.jsx` (`addPayment`, `doCancelWithRefund`) | — | Admission payments: builds a treasury txn directly via `buildCashboxTxn` + `addTreasuryTxn`, appends to `admissionPaymentsLocal[]` | **Live**, explicitly local-only per Phase 3B-13 decision |
| `src/modules/id-cards/components/PaymentReceipt.jsx` | — | Print-only consumer | **Live** |

**[VERIFIED FACT]** Three independent financial-calculation layers exist in the codebase today (`cashboxService.js` live, `treasuryService.js` half-live/half-dead, `transactionEngine.js` fully dead). `transactionEngine.js` is the most architecturally complete of the three (approval workflow + audit trail + reversal), but it was abandoned in favor of the simpler `cashboxService.js` model actually wired into `treasury.slice.js`. Anyone greping the codebase for "how does approval/audit-trail work" today would find `transactionEngine.js` and reasonably-but-wrongly conclude it's live.

### Backend

**[VERIFIED FACT]** No dedicated backend route file exists for payments, treasury, or cashboxes (confirmed by filesystem search — zero matches). `backend/src/server.js`'s `READ_ONLY_COLLECTIONS` set contains exactly `{'payments', 'treasuryTxn', 'cashboxes', 'admissionPayments'}` — the generic CRUD router (`crud.js`) auto-registers all four, but every non-GET verb is rejected with 405 before reaching any handler. **[VERIFIED FACT]** `src/services/api.js` was grepped this session for any `pgCreatePayment`/`pgCreateTreasury*`/`pgCreateCashbox*`/`pgCreateAdmissionPayment*`-style function — **zero matches**. There is no financial write path anywhere in the frontend's API layer, not even an unused/dead one.

`backend/src/lib/transaction.js` — the shared `runInTransaction` helper used by every existing dedicated atomic endpoint (`attendanceSessions.js`, `examGrades.js`, `examDelete.js`, `homeworkDelete.js`, `hwSubmissions.js`, `centerProfile.js`, `materialDistribution.js`, `admissionActivation.js`) — carries this doc comment, written at the time the helper was first created ("Phase 0"):

> "تُستخدم لاحقاً للعمليات المركّبة مثل (payment + treasury_txn) معاً في معاملة واحدة لا تنقسم" — *used later for composite operations like (payment + treasury_txn) together in one indivisible transaction*, with a literal code example showing `tx.payments.create()` followed by `tx.treasury_txn.create()` inside one `runInTransaction` call.

**[VERIFIED FACT]** This is not a new idea introduced by this audit — the codebase's own original transaction-infrastructure author already scoped and endorsed exactly the "payment + treasury_txn atomically together" design, unimplemented, three phases before this one.

### Read-sync (boot)

**[VERIFIED FACT]** `PG_COLLECTIONS` (`src/store/db.middleware.js`) includes `cashboxes`, `treasuryTxn`, `payments` — each is read-synced from PostgreSQL on boot via `mergeById`. Since these tables are currently 100% empty (see Part 3), this sync is a no-op today; local state is never overwritten because there is nothing to sync from. `admissionPayments` is **not** in `PG_COLLECTIONS` — `admissionPaymentsLocal` is deliberately excluded, per the existing Phase 3B-13A decision record.

---

## Part 2 — Facts before recommendations

Every claim in Parts 1, 3, 5–15 below is a **[VERIFIED FACT]**, established by directly reading the relevant file or by a read-only live-database query executed this session (script written to `backend/_3b14_audit_readonly.mjs`, run once, then deleted — no writes, guarded entirely by `SELECT`/`information_schema`/`pg_catalog` queries). Recommendations are isolated into Parts 16–20 and explicitly labeled.

---

## Part 3 — Live PostgreSQL schema audit (columns, FKs, constraints, triggers)

All four tables queried live this session via `information_schema` and `pg_catalog` (not inferred from `schema.prisma` alone, though `schema.prisma` matches what was found).

### `cashboxes`
| Column | Type | Null | Default |
|---|---|---|---|
| id | text | NO | — |
| name | text | NO | — |
| type | text | YES | — |
| color / icon | text | YES | — |
| opening_balance | numeric(12,2) | NO | `0` |
| is_default | boolean | NO | `false` |
| active | boolean | NO | `true` |
| notes | text | YES | — |
| created_at | timestamptz | NO | `now()` |

No `balance`/`current_balance` column exists. Check constraint: `chk_cashbox_opening: opening_balance >= 0`. No check constraint on `type` (free string). No FK. No triggers.

### `payments`
| Column | Type | Null | Default |
|---|---|---|---|
| id | text | NO | — |
| student_id | text | NO | — (FK → students.id) |
| group_id | text | YES | — (FK → groups.id) |
| material_id | bigint | YES | — (FK → inv_materials.id) |
| month | smallint | NO | — |
| year | smallint | NO | — |
| amount | numeric(12,2) | NO | — |
| method | text | NO | `'cash'` |
| pay_type | text | NO | `'subscription'` |
| date | date | NO | — |
| status | text | NO | — |
| notes | text | YES | — |
| treasury_txn_id | text | YES | — (FK → treasury_txn.id) |
| created_at | timestamptz | NO | `now()` |

Check constraints: `chk_payment_status: status IN ('paid','partial','unpaid')`; `chk_payment_type: pay_type IN ('subscription','material')`; `chk_payment_method: method IN ('cash','transfer','instapay','check')`; `chk_payment_month: 1–12`; `chk_payment_amount: amount >= 0`. No `created_by` column at all. Trigger: `trg_payment_needs_treasury` (BEFORE INSERT, see below). No no-delete trigger.

### `treasury_txn`
| Column | Type | Null | Default |
|---|---|---|---|
| id | text | NO | — |
| cashbox_id | text | NO | — (FK → cashboxes.id) |
| date | date | NO | — |
| type | text | NO | — |
| category | text | NO | — |
| amount | numeric(12,2) | NO | — |
| method | text | NO | `'cash'` |
| party / notes | text | YES | — |
| status | text | NO | `'active'` |
| ref_type / ref_id | text | YES | — |
| payment_id | text | YES | — (FK → payments.id) |
| admission_id | text | YES | — (FK → admissions.id) |
| source_module / source_doc_no | text | YES | — |
| created_by | text | YES | — **(FK → users.id)** |
| created_by_name | text | YES | — (no FK — denormalized display snapshot) |
| created_at | timestamptz | NO | `now()` |

Check constraints: `chk_treasury_type: type IN ('income','expense')`; `chk_treasury_method: method IN ('cash','transfer','instapay','check')`; `chk_treasury_status: status IN ('active','cancelled')`; `chk_treasury_amount: amount > 0`. Triggers: `trg_payment_needs_treasury`-equivalent does not apply here; **`trg_no_delete_treasury`** (BEFORE DELETE → `prevent_delete()`, raises: *"الحذف ممنوع على هذا الجدول (append-only). استخدم status = cancelled/archived."*).

### `admission_payments`
| Column | Type | Null | Default |
|---|---|---|---|
| id | text | NO | — |
| admission_id | text | NO | — (FK → admissions.id) |
| type | text | NO | — |
| amount | numeric(12,2) | NO | — |
| date | date | NO | — |
| method | text | NO | `'cash'` |
| notes | text | YES | — |
| treasury_txn_id | text | YES | — (FK → treasury_txn.id) |
| created_at | timestamptz | NO | `now()` |

Check constraints: `chk_adm_pay_type: type IN ('deposit','booklets','course','other')`; `chk_adm_pay_amount: amount > 0`. No check on `method`. No `created_by` column. Trigger: `trg_admpay_needs_treasury` (BEFORE INSERT).

### Trigger function bodies (verified via `pg_get_functiondef`)

```sql
-- enforce_payment_treasury() / enforce_admpay_treasury() (near-identical):
IF current_setting('studix.migration_mode', TRUE) = 'on' THEN RETURN NEW; END IF;
IF NEW.treasury_txn_id IS NULL THEN
  RAISE EXCEPTION 'كل دفعة (قبول) جديدة يجب أن ترتبط بحركة خزنة.';
END IF;
RETURN NEW;
```

**[VERIFIED FACT]** Both trigger functions honor a session-level escape hatch, `studix.migration_mode`, that bypasses the treasury-link requirement entirely when set to `'on'`. This was placed by whoever originally authored the schema, specifically for historical/bulk data import — it is a pre-existing, ready-to-use tool for any future backfill of pre-migration local data, not something this audit needs to invent.

### Live row counts (this session)
`treasury_txn = 0`, `payments = 0`, `cashboxes = 0`, `admission_payments = 0`. **All four tables are completely empty.** No historical PostgreSQL data exists to reconcile or migrate. (Existing user-entered financial data lives only in each browser's local Zustand/localStorage state — see Part 15.)

---

## Part 4 — Single source of truth determination

**[VERIFIED FACT]** Cashbox balance: both the frontend (`cashboxService.js`'s `getCashboxBalance`, reducing `treasuryTxn` filtered by `cashboxId` and non-reversed/rejected status, starting from `openingBalance`) and the DB schema (`cashboxes` has no balance column at all) already agree — balance is a **derived** value, not stored state. This is a genuine point of pre-existing alignment, not a decision this audit needs to make.

**[VERIFIED FACT]** Revenue/ledger source of truth is currently **ambiguous by construction**: `payments[]` and `treasuryTxn[]` are two independently-mutable local arrays, kept in sync only by application code (`addLinkedTxn` on create, `reverseLinkedTxn` on delete) — nothing enforces that every payment has exactly one linked treasury row, or vice versa, today. The DB schema resolves this ambiguity by design: `payments.treasury_txn_id` and `treasury_txn.payment_id` are both present (a redundant bidirectional FK pair enabling lookup from either side), and `enforce_payment_treasury()` makes the link **mandatory** at insert time. **[RECOMMENDATION]** `treasury_txn` should be treated as the ledger (source of truth for money movement); `payments`/`admission_payments` are business documents that must reference a ledger row, never the other way around. This matches what the schema already enforces — it is not a new architectural stance being introduced here.

---

## Part 5 — Money-flow tracing (verified from code, current local-only behavior)

- **Payment (regular):** `PaymentsPage.jsx handleSave` → `createPayment()` (local build) → `setPayments` (local) → `addLinkedTxn(payment, student, group, defaultCashboxId, userId)` → `txnFromPayment` (from `cashboxService.js`) + `addTreasuryTxn` (local). Two independent local-state writes, no atomicity, no network call.
- **Payment (admission deposit/booklets/course/other):** `AdmissionsPage.jsx addPayment` → `buildCashboxTxn(...)` (`createdBy` hardcoded to the literal string `'admissions'`) → `addTreasuryTxn` (local) → `setAdmissionPaymentsLocal` append (local, stores only `txnId` reference, not a financial copy).
- **Refund:** `PaymentsPage.jsx RefundView.doRefund` — checks cashbox sufficiency client-side (`getCashboxBalance`), builds an `expense`/`category:'refund'` txn via `buildCashboxTxn`, calls `addTreasuryTxn` directly (**not** `reverseTreasuryTxn`) — then **mutates the original payment row in place** (`amount: p.amount - amt`, sets `refunded`/`refundedAmount`/`refundReason`). See Part 12 for why this is architecturally inconsistent with the treasury-side reversal model used elsewhere.
- **Payment deletion:** `handleDelete` → `setPayments` filter-out (local) → `reverseLinkedTxn('payment', p.id, reason, userId)` → finds the linked active txn by `refId`, calls `reverseTreasuryTxn` (creates a linked opposite-type txn, marks original `status:'reversed'`).
- **Admission cancellation + refund:** `doCancelWithRefund` — updates the admission server-side first (real PG write, already migrated in 3B-13A), only after success marks local `admissionPaymentsLocal` rows `refunded:true` (no new treasury txn is created for this path — the refund is recorded only as a flag on the local payment-reference row, with no corresponding expense txn built). This is a second, distinct "refund" behavior from `RefundView`'s.
- **Transfer:** `TreasuryPage.jsx` (via `treasury.slice.js`'s `transferBetweenCashboxes`) → `buildTransfer` builds a linked `outTxn`/`inTxn` pair sharing a `transferId`, both `refType:'transfer'` — single local `set()` call, both rows or neither (atomic only in the "one JS call" sense, not a DB transaction, since nothing hits the DB).
- **Opening/closing balance:** `cashboxes.openingBalance` is the only stored balance-related value; "closing balance" is never stored — it is always `getCashboxBalance(...)` recomputed live from all `treasuryTxn` rows for that cashbox.
- **Adjustment:** No dedicated "adjustment" concept exists in the current code — an adjustment would today be entered as a manual income/expense `treasuryTxn` via `TreasuryPage.jsx`'s `TxnForm`, indistinguishable from any other manual entry.

---

## Part 6 — Atomicity audit

**[VERIFIED FACT]** There is currently no atomicity to audit in the database sense, because there is currently no database write path at all for any of these four tables — every "atomic" guarantee that exists today (e.g., `transferBetweenCashboxes`'s single `set()` call producing both `outTxn`/`inTxn`, or `reverseTreasuryTxn`'s single `set()` call producing both the reversal and the status update) is a JavaScript-level atomicity guarantee (one state update, both changes land together in one browser's memory) — it provides no cross-tab, cross-device, or crash-safety guarantee whatsoever.

**[VERIFIED FACT]** The established precedent for introducing real atomicity in this codebase (`materialDistribution.js`, `admissionActivation.js`) is a dedicated endpoint wrapping the composite writes in one `runInTransaction` call, with the decisive read done via `tx` inside that same transaction — not the generic CRUD router (which has no per-collection hook for composite writes). `transaction.js`'s own "Phase 0" comment (Part 1) explicitly anticipates this exact `payment + treasury_txn` pairing.

---

## Part 7 — Trigger/constraint audit, including discovered contradictions

Full trigger/constraint inventory is in Part 3. The following are genuine contradictions between the frontend's current local data model and the live DB schema, discovered this session and **reported here per your explicit instruction, without being silently resolved**:

**[CONTRADICTION 1 — status vocabulary]** `treasury_txn.status` DB check constraint only permits `'active'` or `'cancelled'`. The live frontend model uses **four** status values: `'active'`, `'reversed'` (`reverseTreasuryTxn`), `'pending'` and `'rejected'` (legacy-compat `approveTreasuryTxn`/`rejectTreasuryTxn`, still exported and wired into the store, though not exercised by the currently-visible UI flows I read). `'reversed'`/`'pending'`/`'rejected'` are **not valid values** in the DB as it exists today. A write using the frontend's current status vocabulary as-is would be rejected by the CHECK constraint.

**[CONTRADICTION 2 — pay_type vocabulary]** `payments.pay_type` DB check constraint only permits `'subscription'` or `'material'`. The live frontend (`paymentService.js`'s `PAYMENT_TYPES`) uses **five** values: `subscription`, `material`, `exam`, `extra`, `other`. Three of the five values a user can select today in the payment form (`exam`, `extra`, `other`) would be **rejected outright** by this constraint if written as-is.

**[CONTRADICTION 3 — payment method vocabulary, four-way divergence]** No fewer than four different lists of payment methods exist in the codebase and they do not agree:
- DB check constraints (both `payments.method` and `treasury_txn.method`): `cash, transfer, instapay, check`.
- `paymentService.js`'s `PAYMENT_METHODS`: `cash, transfer, instapay, visa` (**has `visa`, which the DB rejects; lacks `check`, which the DB allows**).
- `treasuryService.js`'s `PAYMENT_METHODS`: `cash, transfer, check` (lacks `instapay`).
- `buildPaymentsReport.js`'s local `PAY_METHOD` label map: `cash, transfer, instapay, visa, check` (all five, superset of everything else).

**[VERIFIED FACT — alignment, not a contradiction]** `admission_payments.type`'s check constraint (`deposit, booklets, course, other`) matches the frontend's `PaymentType` enum (`src/modules/admissions/constants.js`) **exactly**, 4-for-4. This table's schema was evidently designed directly against the actual admissions payment-type vocabulary, unlike `payments.pay_type`.

**[VERIFIED FACT]** Only `treasury_txn` carries a no-delete trigger among these four tables. `payments`, `cashboxes`, and `admission_payments` currently have no DB-level delete protection — if a write path is added, whether to also make these append-only (matching the established `trg_no_delete_*` pattern on `activity_logs`/`admission_system_log`/`communications`/`inventory_txn`) is an open decision, not something already decided by the schema.

---

## Part 8 — ID/numbering audit

**[VERIFIED FACT]** All four tables use `id String @id` with **no default** — every existing row would require an explicitly supplied id, exactly like `students`/`groups`/`admissions` before their respective migrations. The current frontend generates ids as `p${Date.now()}` (payments), `tx_${Date.now()}_${rand}` / `cb_${Date.now()}` / `tr_${Date.now()}` (cashboxService), `ap_${Date.now()}` (admissionPaymentsLocal) — timestamp-based, no collision handling, no server round-trip today.

**[VERIFIED FACT — precedent]** The two most recent dedicated atomic endpoints (`materialDistribution.js`, `admissionActivation.js`) do **not** preserve client-supplied ids at all — they generate ids server-side via `crypto.randomUUID()` inside the transaction, because they are single-purpose composite endpoints, not generic CRUD passthroughs. `PRESERVE_CLIENT_ID_COLLECTIONS` (`students`, `groups`, `admissions`) exists specifically for collections still written through **generic CRUD**, where local children may reference the client id before server confirmation.

---

## Part 9 — Decimal/date/currency audit

**[VERIFIED FACT]** All four tables store `amount` as `Decimal @db.Decimal(12,2)` — the DB schema already fully satisfies the "no floating point for persisted amounts" requirement and needs no schema change on this point.

**[VERIFIED FACT — risk]** The frontend, in every calculation layer read this session (`paymentService.js`, `cashboxService.js`, `treasuryService.js`, `transactionEngine.js`), performs `amount` arithmetic as plain JS `Number` (`+`/`-`/`.reduce`) — this is floating-point arithmetic, currently applied to values that are not yet persisted anywhere (since there's no DB write path today), but this is exactly the pattern that must **not** be carried into any persisted write. **[RECOMMENDATION]** Any new write endpoint must send `amount` as a Decimal-compatible string/number straight from user input (never a JS-recomputed running total) and must never write back a client-summed value as an authoritative stored amount; JS-number arithmetic remains fine for **display-only** aggregation (KPIs, reports), which is a read-time concern, not a write-time one.

**[VERIFIED FACT]** Dates: all four tables use `@db.Date` for `date` and `@db.Timestamptz(6)` for `created_at` — consistent with the `normalizeDateOnly` pattern already established for `admissions.reservationDate`/`exams` etc. in prior phases; no new normalization concept is needed here.

**[VERIFIED FACT]** Currency: no currency column exists anywhere — not on any of the four tables, not in any frontend constant or builder. The system is implicitly single-currency (EGP) end to end. Per your explicit Part 9 instruction, no multi-currency handling is proposed.

---

## Part 10 — User/audit-trail audit

**[VERIFIED FACT — real FK, contradicts current frontend convention]** `treasury_txn.created_by` is a genuine FK to `users.id` (nullable). `payments` and `admission_payments` have **no** `created_by`/attribution column at all in the DB; `cashboxes` has none either. The frontend currently passes **three different, mutually inconsistent** values as "createdBy" into `buildCashboxTxn` across its three call sites: the literal string `'system'` (default parameter in `cashboxService.js`), `currentUser?.id` (`PaymentsPage.jsx`), and the literal string `'admissions'` (`AdmissionsPage.jsx`). Only the `currentUser?.id` case would satisfy the FK; the two literal-string cases would violate it on any real insert (same class of bug as the previously-discovered `admissions.created_by` display-name-vs-FK issue from an earlier phase).

**[VERIFIED FACT]** `treasury_txn.created_by_name` is a separate, non-FK denormalized column — the schema already anticipates storing both the real user FK and a display-name snapshot side by side, the same "real FK + display copy" pattern already used for `admissions`.

**[VERIFIED FACT — cross-cutting, not specific to financial domain]** The `addLog` action (`src/store/slices/activity.slice.js`) used throughout the payment/treasury flows for UI-visible activity entries is **100% local, persisted only to `localStorage`** (`storage.set('tc_activity_log', ...)`) — it never reaches the durable, append-only-protected PostgreSQL `activity_logs` table. Every activity-log line generated by a payment or treasury action today (e.g. "دفعة: X — Y ج.م") exists only in the browser that created it, and is lost on `clearLogs()` or a different device/browser.

---

## Part 11 — Cashbox model determination

Covered fully in Part 4/Part 3: balance is derived (agreement between frontend and schema), `cashboxes.type` is an unconstrained free string on both sides (`CASHBOX_TYPES`: `main/branch/safe/bank` frontend-only classification, no DB check constraint) — no contradiction, just an open string today on both ends.

---

## Part 12 — Refund model audit

**[VERIFIED FACT — inconsistency]** Two functionally different refund behaviors coexist for what is conceptually the same event ("money given back to someone"):

1. **`treasury.slice.js`'s `reverseTreasuryTxn`** (used by `PaymentsPage.jsx`'s delete-payment flow, via `reverseLinkedTxn`): non-destructive. Creates a new, opposite-type, linked reversal transaction; marks the original `status:'reversed'` (a status value the live DB does not currently accept — Contradiction 1, Part 7). The original transaction's `amount` is never altered.
2. **`PaymentsPage.jsx`'s `RefundView.doRefund`**: on the treasury side, builds a brand-new `expense`/`category:'refund'` transaction directly via `buildCashboxTxn` + `addTreasuryTxn` (bypassing `reverseTreasuryTxn` entirely — no link back to the original income txn's `refId` other than a fresh `refType:'refund', refId: <payment id>` pointing at the payment, not at the original treasury txn). On the **payments** side, it **destructively overwrites the original payment row**: `amount: isFullRefund ? p.amount : p.amount - amt`, plus new fields `refunded`/`refundedAmount`/`refundReason` that have **no corresponding DB column** on `payments` today. The original paid amount is not preserved anywhere once a partial refund is applied.
3. **`AdmissionsPage.jsx`'s `doCancelWithRefund`**: a third variant — marks `admissionPaymentsLocal` rows `refunded:true` with **no new treasury transaction created at all** for the refund itself (the money-out side of an admission cancellation refund is not represented as a ledger movement in the current code, only as a flag on the original payment-reference row).

**[RECOMMENDATION, not implemented]** Before any write-enabled implementation, one refund model must be chosen and applied consistently across all three sites: the original financial document (`payments`/`admission_payments` row) should be treated as an immutable record of what was actually paid; a refund should always be represented as its own linked `treasury_txn` (expense, `ref_type:'refund'`, pointing back at the original transaction's id, not the payment's id), and any "is this refunded / how much" tracking should live in queryable derived state (e.g., sum of linked refund txns) rather than as a mutated `amount` field on the original row. This is a design choice for you to approve or redirect, not something already decided.

---

## Part 13 — `admission_payments` dependency analysis

Confirmed unlocking condition: `trg_admpay_needs_treasury` requires `treasury_txn_id` to be non-null on insert (unless `studix.migration_mode` is set). This cannot be satisfied until `treasury_txn` itself has a working write path — `admission_payments` cannot be migrated independently of `treasury_txn`; it must come after (or atomically alongside) a `treasury_txn` write path exists. `type` vocabulary is already fully aligned (Part 7); `amount`/`created_by`/refund-model concerns are shared with the rest of the financial domain, not unique to this table.

---

## Part 14 — Reporting/reconciliation audit

**[VERIFIED FACT]** Every report in the current app (`PaymentReports.jsx`, `buildPaymentsReport.js`, `cashboxService.js`'s `getSystemOverview`/`getCashboxStats`/`getIncomeByCategory`/`getExpenseByCategory`, `TreasuryPage.jsx`'s reports view) is computed client-side, in JS, from whatever is currently in that browser's local Zustand state — there is no server-side aggregation/reporting endpoint for any financial data today. This is a direct consequence of, not a separate problem from, the fact that no financial write path to PostgreSQL exists yet (Part 15).

---

## Part 15 — Multi-user/concurrency audit

**[VERIFIED FACT — the central finding of this audit]** Because zero financial writes reach PostgreSQL today, there is currently **no concurrency risk in the database sense** — but this is because there is currently **no shared financial data at all**. Each browser/device's `payments`/`cashboxes`/`treasuryTxn`/`admissionPaymentsLocal` state is local to that browser (Zustand + localStorage), boot-synced from an empty PostgreSQL table that never receives anything back. Two secretaries recording payments on two different computers today are maintaining two silently divergent, never-reconciled financial records — not a race condition to fix, but the pre-existing absence of a shared source of truth that this entire migration exists to solve. This should be treated as the primary business justification for prioritizing this migration, independent of the `admission_payments` blocker that originally triggered it.

---

## Part 16 — Migration sequencing proposal *(RECOMMENDATION — not started, not approved)*

Mirroring the established closable-sub-phase pattern from 3B-13:

- **3B-14A — `cashboxes`**: simplest table, no inbound trigger dependency, no vocabulary contradictions to resolve first. Candidate for a straightforward write-enablement (generic CRUD or a small dedicated endpoint) once the id/created-by conventions are settled.
- **3B-14B — `treasury_txn` (manual entries only, not yet linked to payments)**: requires resolving Contradiction 1 (status vocabulary) and the `created_by` convention (Part 10) before any write is attempted. This is the ledger; it should exist before anything is required to link to it.
- **3B-14C — `payments` + `treasury_txn`, atomically linked**: the exact composite endpoint `transaction.js`'s own original comment anticipated. Requires resolving Contradiction 2 (pay_type vocabulary) and Contradiction 3 (method vocabulary) first — either the DB constraints are widened to match real frontend usage, or the frontend's option lists are narrowed to match the DB, but this decision must be made explicitly, not silently, since it changes what a user can select in the payment form.
- **3B-14D — `admission_payments` + `treasury_txn`, atomically linked**: unblocks Phase 3B-13C. Depends on 3B-14C's linkage pattern existing first (same `enforce_*_treasury` trigger shape).

Each sub-phase would follow the existing full workflow (its own read-only audit/decision gate → explicit approval → implementation → regression + DB verification → closure report → explicit closure approval) — this proposal is sequencing only, not a commitment to any of the open decisions inside it.

---

## Part 17 — Protected scope

Must not be touched by this phase or by any future phase without separate explicit approval: all Phase 3B-8 through 3B-13 application code and reports; `admissions.slice.js`; `backend/src/routes/admissionActivation.js`; `backend/src/routes/materialDistribution.js`; `backend/prisma/schema.prisma`; `backend/src/routes/crud.js`; `backend/src/server.js`'s `READ_ONLY_COLLECTIONS`/`PRESERVE_CLIENT_ID_COLLECTIONS`/`ADMIN_ONLY_COLLECTIONS`; `src/store/db.middleware.js`'s `PG_COLLECTIONS`/`SINGLETON_MERGERS`/`COLLECTION_FIXUPS`.

## Part 18 — Testing strategy *(RECOMMENDATION)*

No new framework. Reuse exactly what's established: Vitest + Testing Library component-contract tests (mocking `fetch` directly, as in `AdmissionsPage.activation.test.jsx`) for any new UI write path; one-off, deleted-after-use Node scripts wrapping Prisma calls in a `prisma.$transaction` that always throws a sentinel error at the end, for guaranteed-rollback verification of any new backend endpoint against the real schema — the same technique used for this audit's own live-DB verification, minus the throw (this audit's script was pure `SELECT`, no write attempted, so no rollback wrapper was needed).

---

## Part 19 — Twenty architecture decisions (evidence-cited, FACT vs RECOMMENDATION distinguished)

1. **Ledger is `treasury_txn`; business documents (`payments`, `admission_payments`) must reference it, never the reverse.** [RECOMMENDATION, grounded in VERIFIED FACT] — Evidence: `enforce_payment_treasury`/`enforce_admpay_treasury` triggers already enforce mandatory linkage at insert time (Part 3/7); this is the schema's own design intent, not invented here. Risk if ignored: re-introducing the current ambiguous dual-array model at the DB level. Alternative considered: `payments`-as-primary with `treasury_txn` as a derived mirror — rejected, contradicts the trigger direction.
2. **Cashbox balance stays derived, never stored.** [VERIFIED FACT — already true on both sides, no decision needed] — Evidence: no balance column in `cashboxes`; `getCashboxBalance` already computes it. Risk of changing this: none identified; not proposed.
3. **A dedicated atomic endpoint (`runInTransaction`), not generic CRUD, for any payment↔treasury linkage.** [RECOMMENDATION] — Evidence: `transaction.js`'s own "Phase 0" comment (Part 1); precedent in `materialDistribution.js`/`admissionActivation.js`. Risk of generic CRUD instead: no way to enforce the composite write atomically — `crud.js` has no per-collection hook. Alternative: two sequential generic-CRUD calls — rejected, reintroduces the exact orphan-record race pattern fixed in 3B-13B Stage ii.
4. **Server-generated ids (`crypto.randomUUID()`) for any new atomic-endpoint writes, not client-preserved ids.** [RECOMMENDATION] — Evidence: precedent in `admissionActivation.js`/`materialDistribution.js` (Part 8); none of these four tables are in `PRESERVE_CLIENT_ID_COLLECTIONS` today. Risk of client ids instead: none of the current `Date.now()`-based ids have collision protection.
5. **`created_by` must be `req.user.id` or `NULL`, never the literal strings `'system'`/`'admissions'`.** [RECOMMENDATION, evidence is VERIFIED FACT] — Evidence: real FK confirmed live (Part 3/10); current frontend's two literal-string conventions would violate it. Risk if ignored: every treasury write from the admissions flow would fail with a FK violation.
6. **`amount` sent to the server must be the raw user-entered value, never a client-recomputed running total.** [RECOMMENDATION] — Evidence: DB already stores `Decimal(12,2)` correctly (Part 3); frontend calculation layers use JS floats throughout (Part 9), a risk only if a *computed* value were ever persisted as authoritative, which nothing does yet.
7. **The `payments.pay_type` and `payments.method`/`treasury_txn.method` CHECK constraints must be explicitly reconciled with real frontend usage before any write.** [RECOMMENDATION — decision required from you] — Evidence: Contradictions 2 and 3 (Part 7), verified live. Two directions possible: widen the DB constraints to match current frontend option lists (`exam`/`extra`/`other` pay types, `visa` method), or narrow the frontend's option lists to match the DB. Neither is chosen here — this is exactly the kind of contradiction you asked to have reported rather than silently resolved.
8. **`treasury_txn.status`'s CHECK constraint (`active`/`cancelled`) must be reconciled with the frontend's four-value model (`active`/`reversed`/`pending`/`rejected`) before any write.** [RECOMMENDATION — decision required] — Evidence: Contradiction 1 (Part 7). Alternatives: (a) widen the DB constraint to accept `reversed`/`pending`/`rejected`; (b) collapse the frontend model down to `active`/`cancelled` only, dropping the pending-approval workflow (which is dead code in `transactionEngine.js` anyway, per Part 1) and re-mapping `reversed` → `cancelled`. Not decided here.
9. **One refund model, chosen deliberately, replacing the three currently-inconsistent behaviors.** [RECOMMENDATION — decision required] — Evidence: Part 12. A specific candidate model is sketched there but explicitly marked as a proposal, not a decision.
10. **No multi-currency work.** [VERIFIED FACT — confirmed no currency concept exists anywhere today; nothing to design] — Evidence: Part 9.
11. **No floating-point persisted amounts; JS-number math remains fine for read-time display aggregation only.** [RECOMMENDATION, consistent with your explicit Part 8 instruction] — Evidence: Part 9.
12. **`admission_payments.type` needs no vocabulary change — already aligned.** [VERIFIED FACT] — Evidence: Part 7.
13. **`treasury_txn`/`payments` append-only-at-DB-level status (matching the existing `trg_no_delete_*` family) is an open decision, not yet made by the schema for these two tables (only `treasury_txn` currently has it).** [RECOMMENDATION — decision required] — Evidence: Part 7.
14. **Client-side sufficient-balance checks (as already done in `validateTransfer`/`RefundView`) should be treated as a UX convenience only; the atomic endpoint must not treat client-computed balance as authoritative for approval decisions**, since balance is always derived server-side from `treasury_txn` rows at write time. [RECOMMENDATION] — Evidence: Part 3/4/11 (balance is derived, never stored, so only a live server-side recomputation at write time is trustworthy).
15. **`studix.migration_mode` is an available, pre-existing tool for backfilling any pre-existing local browser data into PostgreSQL without needing a treasury row per historical record — but no backfill of existing local data is proposed or scoped by this audit.** [VERIFIED FACT + explicit non-recommendation] — Evidence: Part 3. Whether to backfill any given browser's existing local financial history at all, and how, is a business decision outside this audit's scope.
16. **`activityLogs` (local, localStorage-only) should not be assumed to satisfy any audit-trail requirement for financial actions** — a real, durable, DB-backed audit trail for money movements would need to come from `treasury_txn`'s own columns (`created_by`, `created_at`, `created_by_name`) plus whatever the append-only decision (item 13) settles on, not from `addLog`. [VERIFIED FACT] — Evidence: Part 10.
17. **Reporting/reconciliation endpoints are out of scope for whatever sub-phase writes these tables first** — existing client-side aggregation (`cashboxService.js`'s report functions) can continue reading from the now-real-synced local state without a dedicated backend reporting endpoint, at least initially. [RECOMMENDATION] — Evidence: Part 14; no server-side aggregation exists or is required by any current UI.
18. **Dead code (`transactionEngine.js`, `hooks/usePayments.js`, `treasuryService.js`'s dead functions) should be explicitly addressed (documented as intentionally superseded, or removed) at some point in this migration, since it currently misleads anyone reading the codebase about what's actually live** — but this is a housekeeping decision, not a blocking one, and is not proposed for immediate action. [RECOMMENDATION, low priority] — Evidence: Part 1.
19. **Migration sequencing (cashboxes → treasury_txn → payments+treasury_txn → admission_payments+treasury_txn) is proposed as the safest incremental order**, matching dependency direction (nothing can link to `treasury_txn` before it has a write path; `treasury_txn` cannot link to a cashbox that doesn't exist). [RECOMMENDATION] — Evidence: Part 3 (FK direction), Part 16.
20. **No sub-phase should begin implementation without its own explicit approval**, exactly as every prior 3B sub-phase has required. [Process decision, not evidence-based] — matches the established, repeatedly-confirmed working pattern of this entire migration series.

---

## Part 20 — Decision Gate

### A. Verified Facts
- Entire financial domain (`payments`, `treasuryTxn`, `cashboxes`, `admissionPaymentsLocal`) is 100% local-only today; zero PostgreSQL write path exists (grep-confirmed against `api.js`); all four PG tables are currently empty.
- Three independent, disagreeing financial-calculation layers exist in the frontend; one (`transactionEngine.js`) and one hook (`hooks/usePayments.js`) are entirely dead code.
- Cashbox balance is derived (not stored) on both the frontend and the DB schema — pre-existing agreement.
- The DB schema already models mandatory `payment ↔ treasury_txn` and `admission_payment ↔ treasury_txn` linkage via `enforce_*_treasury` BEFORE INSERT triggers, with a `studix.migration_mode` bypass already available for backfill.
- `transaction.js`'s original "Phase 0" comment already anticipated and endorsed a composite `payment + treasury_txn` atomic transaction, unimplemented until now.
- `treasury_txn.created_by` is a real FK to `users.id`; the current frontend's `'system'`/`'admissions'` literal-string conventions would violate it.

### B. Discovered Risks / Contradictions (reported, not resolved)
1. `treasury_txn.status` CHECK (`active`/`cancelled`) contradicts the frontend's 4-value status model (`active`/`reversed`/`pending`/`rejected`).
2. `payments.pay_type` CHECK (`subscription`/`material`) contradicts the frontend's 5-value model (adds `exam`/`extra`/`other`).
3. Payment-method vocabulary diverges four ways across the DB and three different frontend constant lists (`visa` vs `check` mismatch being the sharpest case).
4. Three mutually inconsistent refund behaviors exist across `reverseTreasuryTxn`, `RefundView.doRefund`, and `doCancelWithRefund` — one of them destructively overwrites the original `payments.amount` and writes to fields with no DB column.
5. `created_by` convention is inconsistent and, in two of three call sites, would violate the real FK.

### C. Recommended Architecture
`treasury_txn` as ledger; `payments`/`admission_payments` as business documents referencing it via mandatory FK (already enforced by existing triggers); balance stays fully derived; a dedicated atomic endpoint per linkage pair, following the `materialDistribution.js`/`admissionActivation.js` precedent; server-generated ids; `created_by` = `req.user.id`/`NULL` only.

### D. Proposed Sub-Phases
3B-14A (`cashboxes`) → 3B-14B (`treasury_txn` manual entries) → 3B-14C (`payments` + `treasury_txn` linked) → 3B-14D (`admission_payments` + `treasury_txn` linked, unblocks 3B-13C). None started; none scoped in implementation detail beyond this sequencing.

### E. Files Expected to Change (in whichever sub-phase is eventually approved — none changed now)
New dedicated route file(s) under `backend/src/routes/` (e.g. `treasuryTxn.js`, `paymentTreasury.js`, `admissionPaymentTreasury.js`); `backend/src/server.js` (removing the relevant entries from `READ_ONLY_COLLECTIONS` once a real endpoint exists, or leaving generic CRUD read-only-forever if bypassed entirely by dedicated endpoints); `src/services/api.js` (new `pg*` functions); `src/store/slices/treasury.slice.js` and `payments.slice.js` (server-truth-first writes replacing pure-local mutation); possibly `src/services/cashboxService.js`/`treasuryService.js` if vocabulary reconciliation (item 7/8 above) changes option lists.

### F. Files Protected (must not change without separate approval)
Listed in full in Part 17.

### G. DB Tables Involved
`treasury_txn`, `payments`, `cashboxes`, `admission_payments` — no other table's schema requires change.

### H. API Surface (anticipated shape only, not designed in detail, not implemented)
Likely one atomic endpoint per linkage pair (`POST /api/payments` composite, `POST /api/admissionPayments` composite, `POST /api/treasuryTxn` for manual entries, `POST /api/cashboxes` for cashbox CRUD) — exact routes to be designed in each sub-phase's own audit, not here.

### I. Test/Verification Plan
Vitest + Testing Library component-contract tests per new write path (mocked `fetch`, following `AdmissionsPage.activation.test.jsx`'s pattern exactly); one-off guaranteed-rollback Node scripts for each new endpoint's real-schema DB verification, deleted after use, with an explicit before/after row-count check.

### J. Open Decisions Requiring Your Approval
1. How to resolve the `treasury_txn.status` vocabulary contradiction (widen DB constraint vs. collapse frontend model) — item 8.
2. How to resolve the `payments.pay_type` and payment-method vocabulary contradictions — item 7.
3. Which refund model to standardize on — item 9.
4. Whether to add append-only (`trg_no_delete_*`) protection to `payments`/`admission_payments`/`cashboxes` — item 13.
5. Whether/how to address the dead code (`transactionEngine.js`, `hooks/usePayments.js`) — item 18.
6. Whether to approve the proposed 3B-14A → 3B-14D sequencing, or a different order/grouping.
7. Whether any pre-existing local browser financial data should ever be backfilled into PostgreSQL (using the available `studix.migration_mode` mechanism), and if so, in which sub-phase.

**No implementation, no file modification beyond this report, and no database write has occurred in this phase. Awaiting your explicit approval before any Phase 3B-14 sub-phase may begin.**
