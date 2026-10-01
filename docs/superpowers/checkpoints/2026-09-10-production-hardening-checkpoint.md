# Studix Production Hardening Pass — Checkpoint (2026-09-10)

Plan: `docs/superpowers/plans/2026-09-10-production-hardening-pass.md` (has full task detail — this
file is the resume pointer, not a restatement).

## Tasks completed (1–4), Task 5 mostly done

- **Task 1 — DONE.** Extracted `computeNextStudentCode(db)` into `backend/src/lib/studentCode.js`
  (new file). `admissionActivation.js` now imports it instead of defining it locally (local def +
  its comment block removed, replaced with a short pointer comment). Verified: existing
  `admissionActivation.test.js` (8 tests) and `admissionActivation.integration.test.js` (3 tests,
  real scratch Postgres) both still pass.

- **Task 2 — DONE.** Exported `prepareWriteData` from `backend/src/routes/crud.js` (one-line change,
  added `export`). Created `backend/src/routes/studentCreate.js` (new file): exports
  `createStudentDirect(body)` — server-authoritative `code` via `computeNextStudentCode(prisma)`,
  retry-on-P2002-conflict (up to 3 attempts, checks `err.meta.target.includes('code')`), reuses
  `prepareWriteData('students', body)` for every other field (camelCase→snake_case, client-id
  preservation, unknown-field dropping — identical to what the generic CRUD router already does).
  Thin `POST /` router wraps it. Registered in `backend/src/server.js`: import added near
  `admissionActivationRouter`, and `app.use('/api/students', requireAuth,
  requirePermission('students'), studentCreateRouter)` inserted right after the
  `admissionCancellationRouter` block, before the cashboxes 405-DELETE block — same
  "intercept by method+path before the dynamic loop" pattern as `examDeleteRouter`. GET/PUT/DELETE
  on `/api/students` are untouched (fall through to the existing generic CRUD router later in the
  file, unchanged).

- **Task 3 — DONE.** Created `backend/src/routes/studentCreate.integration.test.js` (real scratch
  Postgres, same pattern as `admissionActivation.integration.test.js`). 5 tests, all passing against
  a real local Postgres instance (confirmed reachable — not skipped):
  - A: create 0001–0005, delete 0003, create another → gets 0006, never collides with 0005, all
    codes stay unique.
  - B: respects a pre-existing seeded code not created through this path (continues from real MAX).
  - C: 8 real concurrent `createStudentDirect` calls via `Promise.allSettled` → all 8 succeed, all
    8 codes unique.
  - D: a direct-creation code and an admission-activation code never collide (both paths share the
    same `computeNextStudentCode`).
  - Extra: a client-supplied `code` in the request body is always ignored/overridden.
  - One fix needed during verification: `beforeEach` originally only did
    `client.students.deleteMany({})`, which fails on test D's second run because test D links a
    student to a real `admissions` row (`admissions.student_id` FK, NO ACTION). Fixed by deleting
    `admission_system_log` then `admissions` then `students` in `beforeEach`, in that dependency
    order. Re-ran after the fix: all 5 pass.
  - Re-ran `admissionActivation.integration.test.js` afterward too (unaffected): still 3/3 pass.

- **Task 4 — DONE.** `src/services/studentService.js`: removed the
  `import { generateCode } from '../utils/helpers';` line (confirmed unused elsewhere in the file)
  and removed the `code: generateCode('TC', existingStudents.length + 1)` line from
  `createStudent()`'s return object — the backend (Task 2) now assigns `code` unconditionally
  regardless of what the client sends, so this was dead/misleading client computation.
  Searched (`grep -rn "generateCode"` across `*.test.jsx`/`*.test.js`, and `grep -rln "TC-"` in
  `src/modules/students/` and `src/services/*.test.js`) for any test asserting a client-generated
  `code` — no matches, nothing else needed updating.
  Verified: `npx vitest run StudentsPage` → 13/13 pass (`StudentsPage.activityLog.test.jsx` 2,
  `StudentsPage.test.jsx` 11). The `act(...)` warnings in the output are pre-existing noise from
  before this session's changes, not new failures — do not "fix" them, out of scope.

- **Task 5 — mostly done, needs final read-back only.** Date fix for `pgCreateStudent`/
  `pgUpdateStudent` in `src/services/api.js`:
  - Both functions now build `body = { ...data, enrollDate: toRequestDate(data.enrollDate) }`
    before `JSON.stringify` (uses the existing, already-defined-later-in-file `toRequestDate`
    helper — safe because it's a hoisted function declaration).
  - Added one short comment above each function pointing at the `toRequestDate` rationale
    comment, matching this file's existing per-function documentation convention.
  - Wrote 4 new tests in `src/services/api.test.js` under `describe('pgCreateStudent /
    pgUpdateStudent', ...)`: create sends full ISO, update sends full ISO when present, update
    **omits** `enrollDate` entirely when absent (partial-update semantics preserved — verified this
    matters because `updateStudent()` in `studentService.js` never actually includes `enrollDate`
    in practice today), and create still surfaces the real server error message on failure.
  - **Verified red-then-green discipline was followed properly**: ran the new tests before the
    fix and confirmed all 4 new tests (`pgCreateStudent`/`pgUpdateStudent`/`pgCreateTreasuryTxn`/
    `pgCreateMaterial`) failed with the exact expected diff (`'2026-01-15'` vs
    `'2026-01-15T00:00:00.000Z'`), then applied the fix.

## Task 6 also implemented ahead of plan order (treasury date fix)

Folded into the same edit pass as Task 5 for efficiency (all three date fixes were verified
red-then-green together in one test run). `src/services/api.js` `pgCreateTreasuryTxn`: added
`date: toRequestDate(rest.date)` to the constructed `body`, plus a short comment. New test added
in `api.test.js` under `describe('pgCreateTreasuryTxn', ...)`.

## Task 7 also implemented ahead of plan order (material date fix)

Also folded into the same pass. `src/services/api.js` `buildMaterialRequestBody`: changed
`body.addedAt = data.addedAt` to `body.addedAt = toRequestDate(data.addedAt)`, plus a short
comment. Updated the two existing assertions in
`src/modules/materials/MaterialsPage.materials.test.jsx` that asserted the OLD broken bare-date
wire format:
- Line ~130 (create test): `addedAt: '2026-01-15'` → `addedAt: '2026-01-15T00:00:00.000Z'`
- Line ~221 (update test): `addedAt: '2026-01-01'` → `addedAt: '2026-01-01T00:00:00.000Z'`
Did NOT touch the other `addedAt` occurrences in that same file (mocked server responses at the
old ~145/231, already full ISO; `normalizeMaterialResponse` truncation assertions at the old
~161/245, already correctly asserting bare-date output — those are response-side, unaffected by
this request-side fix).
Added a new test in `api.test.js` under `describe('pgCreateMaterial / pgUpdateMaterial — addedAt
serialization', ...)`.

## Tests run and their exact results (most recent, all after the fixes were applied)

1. `cd backend && npm run test:integration -- studentCreate` → **5/5 PASS** (real Postgres, not
   skipped).
2. `cd backend && npm run test:integration -- admissionActivation` → **3/3 PASS**.
3. `cd backend && npm test -- admissionActivation` → **8/8 PASS**.
4. `npx vitest run StudentsPage` (repo root) → **13/13 PASS** (2 files).
5. `npx vitest run src/services/api.test.js -t "pgCreateStudent|pgCreateTreasuryTxn|addedAt
   serialization"` — run BEFORE the api.js fixes, confirmed **4/4 FAIL** with the expected
   `'2026-01-15'` vs `'...T00:00:00.000Z'` mismatch (proves the new tests actually catch the bug).
6. `npx vitest run src/services/api.test.js MaterialsPage.materials TreasuryPage` (repo root) —
   run AFTER all api.js fixes — **57/57 PASS** across 5 test files:
   - `api.test.js` (includes the new student/treasury/material date tests)
   - `MaterialsPage.materials.test.jsx` (7 tests, includes the 2 updated addedAt assertions)
   - `TreasuryPage.treasuryTxn.test.jsx` (7 tests)
   - `TreasuryPage.cashboxes.test.jsx` (7 tests)
   - `TreasuryPage.cashboxSync.test.jsx` (5 tests)

No known failures. No test was skipped, weakened, or deleted to get a pass.

## Files created this session

- `backend/src/lib/studentCode.js`
- `backend/src/routes/studentCreate.js`
- `backend/src/routes/studentCreate.integration.test.js`
- `docs/superpowers/plans/2026-09-10-production-hardening-pass.md`
- `docs/superpowers/checkpoints/2026-09-10-production-hardening-checkpoint.md` (this file)

## Files modified this session

- `backend/src/routes/admissionActivation.js` (Task 1)
- `backend/src/routes/crud.js` (Task 2 — one-line export)
- `backend/src/server.js` (Task 2 — import + one `app.use` block added)
- `src/services/studentService.js` (Task 4)
- `src/services/api.js` (Tasks 5, 6, 7 — `pgCreateStudent`, `pgUpdateStudent`,
  `pgCreateTreasuryTxn`, `buildMaterialRequestBody`)
- `src/services/api.test.js` (Tasks 5, 6, 7 — new tests + import list)
- `src/modules/materials/MaterialsPage.materials.test.jsx` (Task 7 — 2 assertion updates)

Confirmed via `git diff --stat` on exactly these 7 modified files: 108 insertions, 25 deletions,
nothing else touched. Confirmed via `git status` that none of the user's pre-existing uncommitted
work was touched (all the licensing/installer/machineIdentity/`tools/license-manager-gui`/
`docs/PRODUCTION-RUNBOOK.md` files that were already `M`/`??` at session start remain exactly as
they were — I did not stage, edit, or revert any of them).

## Nothing committed

No `git add` / `git commit` has been run this session. Everything above is in the working tree
only, per this session's standing policy of never committing without an explicit user request.

## Current task / exact remaining work

Plan file has 12 tasks total (`docs/superpowers/plans/2026-09-10-production-hardening-pass.md`).
Tasks 1–7 are now fully done (6 and 7 were pulled forward and completed alongside 5). **Not yet
started:**

- **Task 8** — Activation failure logging (`backend/src/middleware/activation.js`): add
  `logger.error(...)` inside the currently-bare `catch {}` around `getLicenseStatus()`, keep the
  402 response identical. New test in `backend/src/middleware/activation.test.js` (unit, mock
  `../lib/license.js`, spy on `logger.error`). Full code for both the fix and the test is already
  written out in the plan file's Task 8 section — copy directly from there.
- **Task 9** — Classify `PrismaClientValidationError` as HTTP 400 in
  `backend/src/middleware/errorHandler.js` (currently falls through to 500 — confirmed via a
  scratch `node -e` check in this session that `new Prisma.PrismaClientValidationError(msg, {
  clientVersion: '5.0.0' })` is a valid constructor call and the resulting error has no `.code`
  property). New file `backend/src/middleware/errorHandler.test.js`. Full code already written in
  the plan's Task 9 section.
- **Task 10** — Invalid-date validation in `backend/src/routes/payments.js` (add
  `Number.isNaN(parsedDate.getTime())` check right after the existing non-empty check, then remove
  the now-duplicate `const parsedDate = new Date(date)` inside the transaction closure) and
  `backend/src/routes/treasuryTxn.js` (same check in `transferBetweenCashboxes`, plus add a
  date-required + date-valid check to the `POST /` interceptor middleware that currently only
  injects `createdBy`). **Before writing tests**, Task 10 Step 1 says to check whether
  `payments.test.js`/`treasuryTxn.test.js` (unit-level, no DB) already exist alongside the
  `.integration.test.js` files in `backend/src/routes/` — this was NOT checked yet this session,
  do that first so new tests match whatever convention is already there.
- **Task 11** — Health endpoint (`backend/src/routes/health.js`): log DB-check failures via
  `logger.error`, remove `user` from `getSanitizedConnectionInfo()`'s returned object. Check first
  whether a `health.test.js` already exists and asserts the current shape (plan Task 11 Step 1) —
  not yet checked this session.
- **Task 12** — Remove the dead Vite dev proxy from `vite.config.js` (confirmed genuinely dead by
  an earlier research fork: every `fetch` in `api.js` uses the absolute `PG_API_BASE`, and the
  proxy's target port 3001 doesn't even match the real backend's default port 4000).
- **Final Validation section** (end of the plan file) — full test suites (backend unit +
  integration, frontend, lint, build, `git diff --stat` triple-check against the
  do-not-touch list) — run once, after Tasks 8–12 are all done.

## Important implementation decisions made this session (not to re-litigate)

- Executing the plan **inline in this same session** rather than dispatching fresh subagents per
  task — this session already holds all the research context from 5 parallel research forks + many
  direct file reads; re-briefing fresh agents would throw that away for no benefit.
- `createStudentDirect` does **not** wrap the compute+create in an explicit Prisma transaction —
  matches the existing prior-art pattern in `materialDistribution.js` (`computeNextSeq` +
  `isP2002OnNumber` retry, no wrapping transaction) rather than the heavier
  `runInTransaction`-based pattern used by `admissionActivation.js`/`payments.js` (those wrap
  multi-table writes; this is a single-table single-row create, retry-on-conflict is sufficient
  and matches the closer precedent).
- Deliberately did **not** implement a Part 10 (phone-duplicate) server-side check, even though it
  would have been easy to add to the new `studentCreate.js` route — the task brief's own language
  for Part 10 is cautious ("do not invent business rules", "do not add a schema constraint"), and
  Parts 8/9/11/12/13/14/15/18/19 were all investigated and found to need no code change (full
  rationale for each is written into the plan file's "Investigated, no code change" section) —
  these are correctly considered DONE (as "investigated, documented, intentionally not changed"),
  not pending work.
- Part 20 (orphan-parent read-only SQL) is also already finished — the query is written into the
  plan file, to be handed to the operator in the final report; it does not get run against any
  real database by me.
- Toast/`generateCode` import cleanup in `studentService.js` was scoped narrowly: only removed the
  now-dead `generateCode` import and its one call site; did not touch `sanitizeText`'s import or
  anything else in that file even if it looked possibly unrelated-unused, to avoid scope creep.

## Exact next steps for continuation

1. Read this checkpoint and the plan file (`docs/superpowers/plans/2026-09-10-production-hardening-pass.md`).
2. Resume at Task 8 in the plan (Tasks 1–7 are done, do not redo them).
3. Follow each task's Steps as written (they include exact code and exact run commands).
4. After Task 12, run the Final Validation section once.
5. Produce the final implementation report per the original task brief's required format (executive
   summary, confirmed bugs fixed, issues intentionally not changed, files changed, student-code
   strategy, parent/student behavior confirmation, tests, build, lint/typecheck, git diff --stat,
   safety confirmation, remaining risks, production readiness rating).
