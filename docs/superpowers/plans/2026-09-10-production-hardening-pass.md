# Studix Production Hardening Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the confirmed production bugs (enroll/treasury/material date serialization, student-code race, unlogged activation failures, Prisma validation errors surfacing as 500s, missing date validation) identified in the prior audit, in one controlled pass, without touching schema/migrations/installer/licensing.

**Architecture:** Each fix is localized to the existing boundary where the bug lives (frontend API-serialization layer in `src/services/api.js`, or a dedicated backend route file following the codebase's established "export a testable function + thin router" pattern). No new abstractions, no schema changes. Student-code generation is centralized into one shared backend lib (`backend/src/lib/studentCode.js`) reused by both the existing admission-activation path and a new dedicated direct-creation route.

**Tech Stack:** Express + Prisma (backend), React + Zustand (frontend), Vitest (both).

**Spec:** The full task brief is the multi-part message in this conversation (Parts 1–20). No separate spec file exists; this plan is the executable distillation of it, argued against the actual current code (verified by direct reads, not assumed).

## Global Constraints

- No Prisma schema or migration changes, under any circumstance in this pass.
- No installer, licensing, Ed25519 key, or activation-semantics changes.
- No destructive data operations; Part 20 is read-only (a SQL query handed to the operator, not run).
- Reuse existing helpers (`toRequestDate`, `computeNextStudentCode`, `badRequest`, `logger`, `runInTransaction`) — do not invent parallel utilities.
- Every new/changed backend error path must return a safe Arabic message, matching the existing convention (`err.status`/`err.expose` + `errorHandler.js`), never a raw Prisma/DB string.
- Do not commit anything — per this session's standing git policy, changes stay in the working tree for the user to review/commit themselves.

---

## Investigated, no code change (documented here so the final report can cite it)

- **Part 8 (FK/delete safety):** `errorHandler.js` P2003 → 409 with a coherent Arabic message already exists. `StudentsPage.jsx`/`GroupsPage.jsx`/`MaterialsPage.jsx` already have pre-delete guards for every listed relation (students→payments/waReportLog, groups→students/attendance/exams/homeworks/payments/communications/admissions, materials→inventory_txn). "Teachers→groups" isn't a real FK (`teacher` is a free-text name field, no `teachers` table in use). `comm_tasks` has no delete UI at all. No gap.
- **Part 9 (absence_followup conflict):** Generic CRUD P2002 → 409 with a clear Arabic message already covers this; UI already avoids double-create by routing to update when a followup exists. Acceptable as-is per the spec's own "OR return a clear controlled 409" branch.
- **Part 10 (phone duplicates):** Client-cache-based check has the same staleness weakness as Part 2, and the error copy implies duplicates are meant to be forbidden — but the spec explicitly says "do not invent business rules" and "do not add a schema constraint in this pass." Given the ambiguity and production stakes, left unchanged; documented as a known follow-up.
- **Part 11 (parent relationship):** `findOrCreateParentId` (frontend) + `pgCreateParent`'s `onPhoneConflict` retry is already the self-healing 409 flow. Edit-student intentionally does not relink `parent_id` on `parentPhone` change (explicit in-code comment), matching the spec's own caution against silently changing this. No fix.
- **Part 12 (monthlyFee decimal safety):** Every Decimal field (including `monthlyFee`) is passed through untouched by `caseMapper.js` and normalized with `Number(x)` at each consumption site (`paymentService.js`, `groupService.js`) — same pattern as every other Decimal. No gap found.
- **Part 13 (session cookie order):** `res.cookie()` only stages a header; nothing is flushed until `res.json()` after the `users.update`. A failed update never sends a cookie. Not a real bug.
- **Part 14 (inventory txn concurrency):** `materialDistribution.js` already retries once on P2002-on-`number` after a MAX+1 read inside a transaction. Already safe.
- **Part 15 (admission refund timeout):** Default Prisma transaction timeout, realistic payment counts per admission are small, DB is local — genuine risk is low. No change.
- **Part 18 (activity log UX):** The failure toast text already says "failed to log the event," not "failed to save" — it doesn't claim the business operation failed. Acceptable as-is.
- **Part 19 (error response quality):** Satisfied structurally by how Tasks 8–10 below are implemented (safe Arabic messages, no raw Prisma text) — no separate task.

## Part 20 — read-only orphan-parent query (for the final report, not executed)

```sql
SELECT p.id, p.phone, p.full_name, p.created_at
FROM parents p
LEFT JOIN students s ON s.parent_id = p.id
WHERE p.phone IS NOT NULL
  AND s.id IS NULL
ORDER BY p.created_at DESC;
```

---

## Task 1: Extract `computeNextStudentCode` into a shared backend lib

**Files:**
- Create: `backend/src/lib/studentCode.js`
- Modify: `backend/src/routes/admissionActivation.js:50-64` (remove local definition, import instead)

**Interfaces:**
- Produces: `computeNextStudentCode(db)` — `db` is any Prisma client or transaction client exposing `.students.findMany`. Returns `Promise<string>` (`TC-YYYY-####`).

- [ ] **Step 1: Create the shared lib**

```js
// backend/src/lib/studentCode.js
// نُقلت من admissionActivation.js (Phase 3B-13B) لتصبح قابلة لإعادة الاستخدام من مسار
// إنشاء الطالب المباشر أيضاً (POST /api/students) — نفس الخوارزمية بالضبط، مصدر واحد.
// يقبل db (prisma الرئيسي أو tx داخل معاملة) — MAX+1 حقيقي من كل أكواد الطلاب الحالية،
// لا عدّاد محلي/frontend قد يكون قديماً (يحلّ خطر تعارض students.code UNIQUE).
export async function computeNextStudentCode(db) {
  const year = new Date().getFullYear();
  const rows = await db.students.findMany({ select: { code: true } });
  let max = 0;
  const re = /-(\d+)$/;
  for (const { code } of rows) {
    const m = re.exec(code || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `TC-${year}-${String(max + 1).padStart(4, '0')}`;
}
```

- [ ] **Step 2: Update `admissionActivation.js` to import it**

Remove lines 50-64 (the local `computeNextStudentCode` function and its comment block), add near the top imports:

```js
import { computeNextStudentCode } from '../lib/studentCode.js';
```

- [ ] **Step 3: Run existing admission-activation tests to confirm no regression**

Run: `cd backend && npm test -- admissionActivation`
Expected: PASS (unchanged behavior — same function, same signature, same output).

---

## Task 2: Server-authoritative direct student creation with retry-on-conflict

**Files:**
- Modify: `backend/src/routes/crud.js:49` (export `prepareWriteData`)
- Create: `backend/src/routes/studentCreate.js`
- Modify: `backend/src/server.js` (register the new route before the dynamic loop)

**Interfaces:**
- Consumes: `computeNextStudentCode(db)` from Task 1.
- Produces: `createStudentDirect(body)` — exported standalone function (testable without HTTP), returns the created student row (camelCase, BigInt-safe).

- [ ] **Step 1: Export `prepareWriteData` from `crud.js`**

Change line 49 from:
```js
function prepareWriteData(modelName, body) {
```
to:
```js
export function prepareWriteData(modelName, body) {
```
No other change to `crud.js`.

- [ ] **Step 2: Create `backend/src/routes/studentCreate.js`**

```js
// backend/src/routes/studentCreate.js
// ─────────────────────────────────────────────────────────────────────────────
// Production hardening pass — إنشاء طالب مباشر (POST /api/students)، مسار مخصّص
// يُعترَض قبل الـ CRUD العام لنفس /api/students بنفس تقنية examDeleteRouter/
// admissionActivationRouter (اعتراض حسب method+path، مركَّب قبل الحلقة الديناميكية).
//
// السبب: العميل كان يحسب students.code محلياً (existingStudents.length + 1) — عدّاد
// غير موثوق (يتأثر بالحذف/الحالة القديمة/التزامن). students.code UNIQUE. الحل: نفس
// computeNextStudentCode المُستخدَمة بالفعل لتفعيل القبول (backend/src/lib/studentCode.js)،
// مع إعادة محاولة عند تعارض P2002 على code تحديداً — نفس نمط computeNextSeq/
// isP2002OnNumber في materialDistribution.js بالضبط (لا معاملة صريحة هنا: صفّ واحد،
// لا كتابة مركّبة تحتاج ذرّية عبر جداول — إعادة المحاولة عند التعارض كافية ومطابقة
// للسابقة الموجودة فعلاً في هذا الملف نفسه لنمط مشابه).
//
// الحقول الأخرى (name/phone/parentId/parentPhone/grade/groupId/school/notes/status/
// monthlyFee/id) تمرّ عبر prepareWriteData (crud.js) — نفس منطق الـ CRUD العام
// بالضبط (camelCase→snake_case، إسقاط الحقول المُدارة، الاحتفاظ بـ id العميل)، بلا
// أي تكرار لتلك الخوارزمية هنا.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { snakeToCamel } from '../lib/caseMapper.js';
import { prepareWriteData } from './crud.js';
import { computeNextStudentCode } from '../lib/studentCode.js';

// نفس تسلسل BigInt→نص المكرَّر عمداً في crud.js/admissionActivation.js/payments.js —
// لا util مشترك في هذا المشروع (قرار سابق، غير مُعاد فتحه هنا).
function serializeBigInt(input) {
  if (typeof input === 'bigint') return input.toString();
  if (Array.isArray(input)) return input.map(serializeBigInt);
  if (input !== null && typeof input === 'object' && typeof input.toJSON !== 'function') {
    const out = {};
    for (const [k, v] of Object.entries(input)) out[k] = serializeBigInt(v);
    return out;
  }
  return input;
}

function isCodeConflict(err) {
  return err?.code === 'P2002' && Array.isArray(err?.meta?.target) && err.meta.target.includes('code');
}

const MAX_CODE_ATTEMPTS = 3;

// يُصدَّر منفصلاً عن الـ router ليكون قابلاً للاختبار مباشرة بلا HTTP/auth، بنفس مبدأ
// activateAdmission/createPayment/reverseTreasuryTxn.
export async function createStudentDirect(body) {
  const { data, fields } = prepareWriteData('students', body);
  const idField = fields.find((f) => f.isId);
  // نفس منطق preserveClientId الحالي لـ students في crud.js بالضبط — لا نغيّره هنا.
  const clientId = idField && !idField.hasDefaultValue && typeof body?.id === 'string' ? body.id.trim() : '';
  data.id = clientId || crypto.randomUUID();

  let lastErr;
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    // مصدر الحقيقة الوحيد لـ code: يُحسَب هنا من جهة الخادم دائماً، حتى لو أرسل
    // العميل قيمة (تُتجاهَل — لا نقرأها من data أعلاه إطلاقاً بعد هذا السطر).
    data.code = await computeNextStudentCode(prisma);
    try {
      const row = await prisma.students.create({ data });
      return serializeBigInt(snakeToCamel(row));
    } catch (err) {
      if (!isCodeConflict(err) || attempt === MAX_CODE_ATTEMPTS - 1) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

const router = Router();

router.post('/', asyncHandler(async (req, res) => {
  const data = await createStudentDirect(req.body);
  res.status(201).json({ ok: true, data });
}));

export default router;
```

- [ ] **Step 3: Register the route in `server.js`**

Add the import near the other route imports (after `admissionActivationRouter`):
```js
import studentCreateRouter from './routes/studentCreate.js';
```

Add the mount right after the `admissionCancellationRouter` block (~after line 211, before the cashboxes 405-DELETE block), with a comment matching the file's existing style:

```js
// ── Production hardening pass: إنشاء طالب مباشر بكود خادم-authoritative ──
// يُعترَض هنا فقط POST /api/students (segment واحد فقط) — نفس تقنية الاعتراض حسب
// method+path المستخدَمة أعلاه لـ exams/homeworks. GET/PUT/DELETE /api/students تمرّ
// دون أي تغيير للحلقة الديناميكية أدناه، التي تتولّاها كما هي اليوم (preserveClientId
// لا يزال مفعَّلاً هناك لـ GET/PUT). نفس حراسة students الحالية (requireAuth +
// requirePermission('students')).
app.use('/api/students', requireAuth, requirePermission('students'), studentCreateRouter);
```

- [ ] **Step 4: Verify no route-order regression by starting the backend and hitting health**

Run: `cd backend && npm run dev` (or existing dev script), then in another shell: `curl http://localhost:4000/health`
Expected: `ok: true` (or `db.connected` reflecting real local Postgres state) — confirms server still boots with the new import/route wired in correctly (no syntax/import error).
Stop the dev server after confirming.

---

## Task 3: Regression tests for student-code generation

**Files:**
- Create: `backend/src/routes/studentCreate.integration.test.js`

**Interfaces:**
- Consumes: `createStudentDirect` (Task 2), `checkPostgresReachable`/`setupScratchDb`/`teardownScratchDb` from `../test-helpers/scratchDb.js` (existing, same pattern as `admissionActivation.integration.test.js`).

- [ ] **Step 1: Write the test file**

```js
// backend/src/routes/studentCreate.integration.test.js
// Production hardening pass — real PostgreSQL integration (scratch database only), same
// pattern as admissionActivation.integration.test.js. Proves students.code is computed
// server-side (MAX+1 over real rows), survives deletions of non-max codes, respects
// pre-existing seeded codes, and doesn't collide under real concurrent creation.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('studentCreate.js — real PostgreSQL integration', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let client;
  let createStudentDirect;
  let activateAdmission;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('student_create');
    client = scratch.client;
    ({ createStudentDirect } = await import('./studentCreate.js'));
    ({ activateAdmission } = await import('./admissionActivation.js'));
    await client.groups.create({ data: { id: 'g1', name: 'مجموعة اختبار', price: 100 } });
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  beforeEach(async () => {
    await client.students.deleteMany({});
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  it('A: creating students 0001–0005, deleting 0003, then creating another must not collide with 0005 (continues from the real MAX, not a count)', async () => {
    const created = [];
    for (let i = 0; i < 5; i += 1) {
      const s = await createStudentDirect({ id: nextId('s'), name: `طالب ${i}`, groupId: 'g1' });
      created.push(s);
    }
    expect(created.map((s) => s.code).sort()).toEqual([
      expect.stringMatching(/-0001$/), expect.stringMatching(/-0002$/), expect.stringMatching(/-0003$/),
      expect.stringMatching(/-0004$/), expect.stringMatching(/-0005$/),
    ]);

    const toDelete = created.find((s) => s.code.endsWith('-0003'));
    await client.students.delete({ where: { id: toDelete.id } });

    const next = await createStudentDirect({ id: nextId('s'), name: 'طالب جديد', groupId: 'g1' });
    expect(next.code.endsWith('-0005')).toBe(false);
    expect(next.code.endsWith('-0006')).toBe(true);

    const allCodes = (await client.students.findMany({ select: { code: true } })).map((r) => r.code);
    expect(new Set(allCodes).size).toBe(allCodes.length);
  });

  it('B: respects pre-existing seeded codes not created through this path', async () => {
    const year = new Date().getFullYear();
    await client.students.create({ data: { id: nextId('s'), name: 'مزروع', group_id: 'g1', code: `TC-${year}-0042` } });

    const created = await createStudentDirect({ id: nextId('s'), name: 'طالب بعد المزروع', groupId: 'g1' });
    expect(created.code).toBe(`TC-${year}-0043`);
  });

  it('C: real concurrent creation never produces duplicate codes', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        createStudentDirect({ id: nextId('s'), name: `متزامن ${i}`, groupId: 'g1' })
      )
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    expect(fulfilled.length).toBe(8);
    const codes = fulfilled.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('D: existing admission-activation code generation is unaffected — codes from both paths never collide', async () => {
    const direct = await createStudentDirect({ id: nextId('s'), name: 'مباشر', groupId: 'g1' });

    const admission = await client.admissions.create({
      data: { id: nextId('adm'), number: nextId('NUM'), name: 'عبر القبول', stage: 'reserved' },
    });
    const { student: viaActivation } = await activateAdmission(
      { admissionId: admission.id, student: { name: 'عبر القبول', groupId: 'g1' } },
      { userId: null }
    );

    expect(direct.code).not.toBe(viaActivation.code);
  });

  it('ignores any client-supplied code and always assigns the server-computed one', async () => {
    const created = await createStudentDirect({ id: nextId('s'), name: 'محاولة تزوير', groupId: 'g1', code: 'TC-1999-9999' });
    expect(created.code).not.toBe('TC-1999-9999');
    expect(created.code).toMatch(/^TC-\d{4}-\d{4}$/);
  });
});
```

- [ ] **Step 2: Run the new integration tests**

Run: `cd backend && npm run test:integration -- studentCreate`
Expected: PASS (or a single clear SKIPPED test if no local Postgres scratch DB is reachable in this environment — report which occurred, do not treat SKIPPED as a failure to fix).

- [ ] **Step 3: Re-run admission-activation integration tests to confirm Part D's "unaffected" claim holds structurally too**

Run: `cd backend && npm run test:integration -- admissionActivation`
Expected: PASS unchanged.

---

## Task 4: Frontend — stop generating `code` client-side

**Files:**
- Modify: `src/services/studentService.js:38`

**Interfaces:**
- Produces: `createStudent(data, existingStudents)` no longer includes a `code` field in its return value — the backend (Task 2) now assigns it unconditionally regardless of what's sent, but this removes the now-dead/misleading client computation.

- [ ] **Step 1: Remove the client-side code generation**

In `src/services/studentService.js`, change:
```js
export function createStudent(data, existingStudents) {
  const errors = validateStudent(data, existingStudents);
  if (hasErrors(errors)) throw { type: 'VALIDATION', errors };

  const clean = sanitizeStudentData(data);
  return {
    ...clean,
    id:         `s${Date.now()}`,
    code:       generateCode('TC', existingStudents.length + 1),
    enrollDate: new Date().toISOString().split('T')[0],
    createdAt:  new Date().toISOString(),
    updatedAt:  new Date().toISOString(),
  };
}
```
to:
```js
export function createStudent(data, existingStudents) {
  const errors = validateStudent(data, existingStudents);
  if (hasErrors(errors)) throw { type: 'VALIDATION', errors };

  const clean = sanitizeStudentData(data);
  return {
    ...clean,
    id:         `s${Date.now()}`,
    enrollDate: new Date().toISOString().split('T')[0],
    createdAt:  new Date().toISOString(),
    updatedAt:  new Date().toISOString(),
  };
}
```
Remove the now-unused `import { generateCode } from '../utils/helpers';` at the top of the file (check `generateCode` isn't used elsewhere in this file first — it is not, per the file's full contents already read).

- [ ] **Step 2: Search for any test asserting a client-generated `code` on student creation**

Run: `cd .. && grep -rn "generateCode('TC'" src/ --include=*.test.jsx --include=*.test.js` (or the project's `ctx_search` equivalent) to confirm no test in `StudentsPage.test.jsx` or `StudentForm.test.jsx` asserts a specific `TC-...` code being present in the outgoing POST body. If one exists, update it to assert the `code` field is simply absent from the outgoing body (server-assigned), following the same pattern as the materials test's `expect(sentBody.code).toBeUndefined()` (materials already omits `code` from the update body for the same "server owns it" reason).
Expected: either no match, or one test updated to match new behavior.

- [ ] **Step 3: Run the frontend student test suite**

Run: `npm test -- StudentsPage`
Expected: PASS.

---

## Task 5: Date fix — students (`pgCreateStudent`/`pgUpdateStudent`)

**Files:**
- Modify: `src/services/api.js:79-102`
- Test: `src/services/api.test.js` (new `describe` block)

**Interfaces:**
- Consumes: existing `toRequestDate(date)` (already defined at `api.js:405-408`, hoisted — safe to call from earlier in the file).

- [ ] **Step 1: Write the failing tests**

Add to `src/services/api.test.js`, after the existing `pgCreateExam / pgUpdateExam` describe block:

```js
describe('pgCreateStudent / pgUpdateStudent', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockResponse(data, status = 201) {
    fetchMock.mockResolvedValue({ ok: true, status, json: async () => ({ ok: true, data }) });
  }

  it('pgCreateStudent sends enrollDate as a full ISO timestamp, not a plain YYYY-MM-DD string', async () => {
    mockResponse({ id: 's1', name: 'x', enrollDate: '2026-01-15T00:00:00.000Z' });
    await pgCreateStudent({ name: 'x', groupId: 'g1', enrollDate: '2026-01-15' });

    const [, opts] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(opts.body);
    expect(sentBody.enrollDate).toBe('2026-01-15T00:00:00.000Z');
  });

  it('pgUpdateStudent sends enrollDate as a full ISO timestamp too, when present', async () => {
    mockResponse({ id: 's1', name: 'x', enrollDate: '2026-01-15T00:00:00.000Z' });
    await pgUpdateStudent('s1', { name: 'x', enrollDate: '2026-01-15' });

    const [, opts] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(opts.body);
    expect(sentBody.enrollDate).toBe('2026-01-15T00:00:00.000Z');
  });

  it('pgUpdateStudent without enrollDate omits it from the request body (partial-update semantics preserved)', async () => {
    mockResponse({ id: 's1', name: 'x' });
    await pgUpdateStudent('s1', { name: 'x' });

    const [, opts] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(opts.body);
    expect('enrollDate' in sentBody).toBe(false);
  });

  it('pgCreateStudent throws the real server error message on failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ ok: false, error: 'اسم الطالب مطلوب.' }) });
    await expect(pgCreateStudent({ groupId: 'g1', enrollDate: '2026-01-01' })).rejects.toThrow('اسم الطالب مطلوب.');
  });
});
```

Update the top-level import in `src/services/api.test.js` to include `pgCreateStudent, pgUpdateStudent`.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/services/api.test.js -t "pgCreateStudent / pgUpdateStudent"`
Expected: FAIL — `sentBody.enrollDate` is `'2026-01-15'`, not the full ISO string.

- [ ] **Step 3: Implement the fix**

In `src/services/api.js`, change:
```js
export async function pgCreateStudent(data) {
  const res = await fetch(`${PG_API_BASE}/api/students`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
```
to:
```js
export async function pgCreateStudent(data) {
  const body = { ...data, enrollDate: toRequestDate(data.enrollDate) };
  const res = await fetch(`${PG_API_BASE}/api/students`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
```

And change:
```js
export async function pgUpdateStudent(id, data) {
  const res = await fetch(`${PG_API_BASE}/api/students/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
```
to:
```js
export async function pgUpdateStudent(id, data) {
  const body = { ...data, enrollDate: toRequestDate(data.enrollDate) };
  const res = await fetch(`${PG_API_BASE}/api/students/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
```

`toRequestDate` returns `undefined` unchanged when the input is falsy (already the case for `pgCreateExam`), so `enrollDate: undefined` gets dropped by `JSON.stringify` exactly as before when absent — this is a pure serialization fix, no semantic change.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/services/api.test.js -t "pgCreateStudent / pgUpdateStudent"`
Expected: PASS.

---

## Task 6: Date fix — treasury (`pgCreateTreasuryTxn`)

**Files:**
- Modify: `src/services/api.js:248-260`
- Test: `src/services/api.test.js`

- [ ] **Step 1: Write the failing test**

```js
describe('pgCreateTreasuryTxn', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends date as a full ISO timestamp, not a plain YYYY-MM-DD string', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 201,
      json: async () => ({ ok: true, data: { id: 't1', date: '2026-01-15T00:00:00.000Z', amount: '100.00', type: 'income', category: 'other', cashboxId: 'cb1', method: 'cash', party: null, notes: 'وصف' } }),
    });
    await pgCreateTreasuryTxn({
      cashboxId: 'cb1', type: 'income', category: 'other', amount: 100,
      method: 'cash', date: '2026-01-15', description: 'وصف',
    });

    const [, opts] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(opts.body);
    expect(sentBody.date).toBe('2026-01-15T00:00:00.000Z');
  });
});
```

Add `pgCreateTreasuryTxn` to the top-level import list.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/services/api.test.js -t "pgCreateTreasuryTxn"`
Expected: FAIL.

- [ ] **Step 3: Implement the fix**

Change:
```js
export async function pgCreateTreasuryTxn(data) {
  const { description, notes, ...rest } = data;
  const body = { ...rest, notes: notes ? `${description} — ${notes}` : description };
```
to:
```js
export async function pgCreateTreasuryTxn(data) {
  const { description, notes, ...rest } = data;
  const body = { ...rest, date: toRequestDate(rest.date), notes: notes ? `${description} — ${notes}` : description };
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/services/api.test.js -t "pgCreateTreasuryTxn"`
Expected: PASS. Also run `npm test -- TreasuryPage` to confirm no regression in the existing treasury UI test suite (it mocks `api.js`, so it only asserts what's passed *into* `pgCreateTreasuryTxn`, unaffected by this internal change).

---

## Task 7: Date fix — inventory materials (`buildMaterialRequestBody`)

**Files:**
- Modify: `src/services/api.js:913-925`
- Modify: `src/modules/materials/MaterialsPage.materials.test.jsx:130,221`
- Test: `src/services/api.test.js`

- [ ] **Step 1: Implement the fix**

In `src/services/api.js`, change:
```js
function buildMaterialRequestBody(data) {
  const body = {
    name:    data.name,
    subject: data.subject ?? null,
    grade:   data.grade   ?? null,
    price:   data.price   ?? 0,
  };
  if (data.code !== undefined)        body.code        = data.code;
  if (data.teacher !== undefined)     body.teacher     = data.teacher;
  if (data.description !== undefined) body.description = data.description;
  if (data.addedAt !== undefined)     body.addedAt     = data.addedAt;
  return body;
}
```
to:
```js
function buildMaterialRequestBody(data) {
  const body = {
    name:    data.name,
    subject: data.subject ?? null,
    grade:   data.grade   ?? null,
    price:   data.price   ?? 0,
  };
  if (data.code !== undefined)        body.code        = data.code;
  if (data.teacher !== undefined)     body.teacher     = data.teacher;
  if (data.description !== undefined) body.description = data.description;
  if (data.addedAt !== undefined)     body.addedAt     = toRequestDate(data.addedAt);
  return body;
}
```

- [ ] **Step 2: Update the existing test that currently asserts the broken bare-date wire format**

In `src/modules/materials/MaterialsPage.materials.test.jsx`, line 130, change:
```js
      price: 80, teacher: 'أ. أحمد', description: 'وصف تجريبي', addedAt: '2026-01-15',
```
to:
```js
      price: 80, teacher: 'أ. أحمد', description: 'وصف تجريبي', addedAt: '2026-01-15T00:00:00.000Z',
```

Line 221, change:
```js
      teacher: 'أ. محمد', description: 'وصف قديم', addedAt: '2026-01-01',
```
to:
```js
      teacher: 'أ. محمد', description: 'وصف قديم', addedAt: '2026-01-01T00:00:00.000Z',
```

Do NOT touch lines 145/231 (mocked server responses, already full ISO) or lines 161/245 (`normalizeMaterialResponse` truncation assertions, already correct).

- [ ] **Step 3: Add a focused unit test at the api.js boundary**

Add to `src/services/api.test.js`:
```js
describe('pgCreateMaterial / pgUpdateMaterial — addedAt serialization', () => {
  let fetchMock;
  beforeEach(() => { fetchMock = vi.fn(); globalThis.fetch = fetchMock; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('pgCreateMaterial sends addedAt as a full ISO timestamp', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ ok: true, data: { id: '1', addedAt: '2026-01-15T00:00:00.000Z', price: '0', cost: '0', minStock: '0' } }) });
    await pgCreateMaterial({ name: 'م', subject: 'رياضيات', grade: 'g', price: 10, addedAt: '2026-01-15' });

    const [, opts] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(opts.body);
    expect(sentBody.addedAt).toBe('2026-01-15T00:00:00.000Z');
  });
});
```
Add `pgCreateMaterial` to the top-level import list.

- [ ] **Step 4: Run the affected tests**

Run: `npm test -- src/services/api.test.js -t "addedAt serialization"`
Run: `npm test -- MaterialsPage.materials`
Expected: PASS on both.

---

## Task 8: Activation failure logging

**Files:**
- Modify: `backend/src/middleware/activation.js:15,37-42`
- Modify: `backend/src/middleware/activation.test.js`

- [ ] **Step 1: Write the failing test**

Add to `backend/src/middleware/activation.test.js` (add `vi`, `beforeEach` to the vitest import, and new imports):

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isActivationExempt, requireActivation } from './activation.js';
import { getLicenseStatus } from '../lib/license.js';
import logger from '../lib/logger.js';

vi.mock('../lib/license.js', () => ({ getLicenseStatus: vi.fn() }));
```

(Keep the existing `isActivationExempt` describe block as-is; add this new one below it.)

```js
describe('requireActivation — getLicenseStatus() failure path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs the underlying error and still returns the existing generic 402 response', async () => {
    const boom = new Error('اتصال قاعدة البيانات مقطوع');
    getLicenseStatus.mockRejectedValue(boom);
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    const req = { path: '/api/students' };
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) };
    const next = vi.fn();

    await requireActivation(req, res, next);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(json).toHaveBeenCalledWith({ ok: false, error: 'تعذّر التحقّق من حالة التفعيل.', licenseRequired: true });
    expect(next).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain(boom.message);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npm test -- activation.test.js`
Expected: FAIL — `errorSpy` is never called (current code swallows the error with a bare `catch {}`).

- [ ] **Step 3: Implement the fix**

In `backend/src/middleware/activation.js`, add the import:
```js
import { getLicenseStatus } from '../lib/license.js';
import logger from '../lib/logger.js';
```

Change:
```js
  let status;
  try {
    status = await getLicenseStatus();
  } catch {
    return res.status(402).json({ ok: false, error: 'تعذّر التحقّق من حالة التفعيل.', licenseRequired: true });
  }
```
to:
```js
  let status;
  try {
    status = await getLicenseStatus();
  } catch (err) {
    logger.error(`فشل التحقّق من حالة التفعيل: ${err.message}`, { path: req.path, stack: err.stack });
    return res.status(402).json({ ok: false, error: 'تعذّر التحقّق من حالة التفعيل.', licenseRequired: true });
  }
```

No change to the response shape, status code, or message — only the previously-silent failure is now logged. Licensing/activation semantics are unchanged.

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npm test -- activation.test.js`
Expected: PASS (all existing `isActivationExempt` tests plus the new one).

---

## Task 9: Classify `PrismaClientValidationError` as HTTP 400

**Files:**
- Modify: `backend/src/middleware/errorHandler.js:1-71`
- Create: `backend/src/middleware/errorHandler.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/src/middleware/errorHandler.test.js
// Production hardening pass — PrismaClientValidationError (malformed/missing client data
// caught by Prisma before any query runs — e.g. an Invalid Date object, or a required
// field of the wrong type) had no .code property, so it fell through every branch in
// errorHandler.js to the generic 500 fallback. Classified here as a client error (400)
// instead, with a safe generic Arabic message — the raw Prisma message (which can name
// columns/tables) is logged internally, never sent to the client.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { errorHandler } from './errorHandler.js';
import logger from '../lib/logger.js';

function mockRes() {
  const json = vi.fn();
  const res = { status: vi.fn(() => ({ json })) };
  return { res, json };
}

describe('errorHandler — PrismaClientValidationError classification', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('maps PrismaClientValidationError to a controlled 400, not the raw message', () => {
    const err = new Prisma.PrismaClientValidationError(
      'Invalid `prisma.students.create()` invocation: Argument enroll_date: Invalid value',
      { clientVersion: '5.0.0' }
    );
    const { res, json } = mockRes();
    const req = { path: '/api/students', method: 'POST' };

    errorHandler(err, req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ ok: false, error: 'بيانات الطلب غير صالحة أو ناقصة.' });
    const [sentArg] = json.mock.calls[0];
    expect(sentArg.error).not.toContain('enroll_date');
    expect(sentArg.error).not.toContain('prisma');
  });

  it('still logs the underlying Prisma message for diagnosis', () => {
    const err = new Prisma.PrismaClientValidationError('Argument x: Invalid value', { clientVersion: '5.0.0' });
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const { res } = mockRes();

    errorHandler(err, { path: '/api/payments', method: 'POST' }, res, () => {});

    expect(errorSpy).toHaveBeenCalled();
  });

  it('unrelated known Prisma errors (P2002) still work exactly as before', () => {
    const err = Object.assign(new Error('unique violation'), { code: 'P2002', meta: { target: ['code'] } });
    const { res, json } = mockRes();

    errorHandler(err, { path: '/api/students', method: 'POST' }, res, () => {});

    expect(res.status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({ ok: false, error: 'قيمة مكرّرة تنتهك قيد التفرّد.', field: ['code'] });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npm test -- errorHandler.test.js`
Expected: FAIL — the first two tests get a 500 instead of 400 (falls through to the generic handler).

- [ ] **Step 3: Implement the fix**

In `backend/src/middleware/errorHandler.js`, add the import at the top:
```js
import { Prisma } from '@prisma/client';
import logger from '../lib/logger.js';
```

Insert a new branch in `errorHandler`, after the `matchPgCheckViolation` block and before the `err.status && err.expose` block:

```js
  // بيانات غير صالحة/ناقصة اكتشفها Prisma قبل تنفيذ أي استعلام (نوع خاطئ، Invalid Date
  // object، حقل مطلوب غائب...) — بلا code/meta منظّمة (بعكس PrismaClientKnownRequestError
  // أعلاه)، فكانت تسقط للـ 500 العام افتراضياً. تُصنَّف هنا صراحة كخطأ عميل (400) — رسالة
  // Prisma الخام (قد تتضمّن أسماء أعمدة/جدول) تُسجَّل داخلياً فقط، لا تصل العميل أبداً.
  if (err instanceof Prisma.PrismaClientValidationError) {
    logger.error(`بيانات غير صالحة (Prisma validation): ${err.message}`, { path: req.path, method: req.method });
    return res.status(400).json({ ok: false, error: 'بيانات الطلب غير صالحة أو ناقصة.' });
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && npm test -- errorHandler.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full backend test suite to confirm P2002/P2003/P2025/P2000/P2004 handling is untouched**

Run: `cd backend && npm test`
Expected: PASS (no regressions in any existing error-handling test).

---

## Task 10: Reject invalid dates at the boundary (`payments.js`, `treasuryTxn.js`)

**Files:**
- Modify: `backend/src/routes/payments.js:93,126`
- Modify: `backend/src/routes/treasuryTxn.js:130,193-196`
- Test: `backend/src/routes/payments.test.js` (or create if none exists — check first) and `backend/src/routes/treasuryTxn.test.js`

- [ ] **Step 1: Check for existing unit test files for these two routes**

Run: `cd backend && ls src/routes/ | grep -E "payments\.|treasuryTxn\."` to see if `payments.test.js`/`treasuryTxn.test.js` (unit, calling the exported functions directly, no DB) already exist alongside the `.integration.test.js` files. If they exist, add to them following their existing style; if not, create new unit test files mirroring `admissionActivation.js`'s exported-function-testing pattern, mocking `../lib/transaction.js`'s `runInTransaction` minimally or using the integration test's scratch-DB pattern — match whatever convention the sibling `.integration.test.js` files in the same directory already use for these two routes specifically, since they clearly already have some test coverage per the earlier research (do not assume; read them before writing).

- [ ] **Step 2: Write the failing tests (adapt to whichever convention Step 1 found)**

For `createPayment` (payments.js):
```js
it('rejects a malformed date string with a controlled 400, not an Invalid Date reaching Prisma', async () => {
  await expect(createPayment({
    studentId: 's1', cashboxId: 'cb1', month: 1, year: 2026, amount: 100,
    method: 'cash', payType: 'subscription', date: 'not-a-real-date',
  }, { userId: null })).rejects.toMatchObject({ status: 400 });
});

it('rejects an impossible calendar date the same way', async () => {
  await expect(createPayment({
    studentId: 's1', cashboxId: 'cb1', month: 1, year: 2026, amount: 100,
    method: 'cash', payType: 'subscription', date: '2026-02-30',
  }, { userId: null })).rejects.toMatchObject({ status: 400 });
  // Note: JS Date silently rolls 2026-02-30 into March 2 rather than throwing — if this
  // assertion fails because the roll-over produces a *valid* Date, that's expected JS Date
  // behavior, not a bug in this fix; drop this specific case and keep the malformed-string
  // and empty-string cases, which are the real "Invalid Date reaches Prisma" scenarios.
});

it('still requires a non-empty date exactly as before', async () => {
  await expect(createPayment({
    studentId: 's1', cashboxId: 'cb1', month: 1, year: 2026, amount: 100,
    method: 'cash', payType: 'subscription', date: '',
  }, { userId: null })).rejects.toMatchObject({ status: 400 });
});
```

For `transferBetweenCashboxes` (treasuryTxn.js):
```js
it('rejects a malformed date string with a controlled 400', async () => {
  await expect(transferBetweenCashboxes({
    fromCashboxId: 'cb1', toCashboxId: 'cb2', amount: 100, date: 'not-a-real-date',
  }, { userId: null })).rejects.toMatchObject({ status: 400 });
});
```

(Adjust fixture setup — `studentId`/`cashboxId`/`fromCashboxId`/`toCashboxId` values — to match whatever seeding Step 1's existing test file already does; these are illustrative of the assertions needed, not a full standalone file.)

- [ ] **Step 3: Run to verify failure**

Run the relevant test command from Step 1's discovered convention.
Expected: FAIL, or an unhandled Prisma-level error/500 instead of the expected 400 (behavior depends on whether Task 9 is already applied — if Task 9 is done first, this may already partially pass as a 400 from the generic Prisma-validation path; the point of this task is to fail *before* even reaching Prisma, with a specific message, and to catch the empty-string case that Task 9 wouldn't reliably catch since an "Invalid Date" object doesn't always trigger `PrismaClientValidationError` — it can reach the DB driver directly. Confirm by running against Task 9's fix NOT applied first if sequencing allows, or reason about it from the code path directly.)

- [ ] **Step 4: Implement the fix in `payments.js`**

Change:
```js
  if (typeof date !== 'string' || !date.trim()) throw badRequest('التاريخ مطلوب.');
```
to:
```js
  if (typeof date !== 'string' || !date.trim()) throw badRequest('التاريخ مطلوب.');
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) throw badRequest('تاريخ غير صالح.');
```
(inserted right after the existing `date` check, before `materialIdBig` handling)

Then remove the now-duplicate `const parsedDate = new Date(date);` line inside `runInTransaction` (originally at line 126) — the outer `parsedDate` is already captured by the closure.

- [ ] **Step 5: Implement the fix in `treasuryTxn.js`**

For `transferBetweenCashboxes`, change:
```js
  if (!amt || amt <= 0) throw badRequest('المبلغ يجب أن يكون أكبر من صفر.');
  if (!date) throw badRequest('التاريخ مطلوب.');
```
to:
```js
  if (!amt || amt <= 0) throw badRequest('المبلغ يجب أن يكون أكبر من صفر.');
  if (typeof date !== 'string' || !date.trim()) throw badRequest('التاريخ مطلوب.');
  if (Number.isNaN(new Date(date).getTime())) throw badRequest('تاريخ غير صالح.');
```

For the manual-entry `POST /` interceptor (which passes through to the generic CRUD router), change:
```js
router.post('/', (req, res, next) => {
  req.body = { ...req.body, createdBy: req.user?.id ?? null };
  next();
});
```
to:
```js
router.post('/', (req, res, next) => {
  const { date } = req.body || {};
  if (typeof date !== 'string' || !date.trim()) throw badRequest('التاريخ مطلوب.');
  if (Number.isNaN(new Date(date).getTime())) throw badRequest('تاريخ غير صالح.');
  req.body = { ...req.body, createdBy: req.user?.id ?? null };
  next();
});
```
(A synchronous `throw` inside a plain Express middleware — not wrapped in `asyncHandler` — is caught automatically by Express and forwarded to `errorHandler` via `next(err)`; this matches `err.status`/`err.expose` from `badRequest()`, so no `asyncHandler` wrapper is needed here.)

- [ ] **Step 6: Run to verify pass**

Re-run Step 1's test command.
Expected: PASS. Also run the full existing `payments`/`treasuryTxn` test suites (unit + integration) to confirm valid-date and empty-date behavior is unchanged.

Run: `cd backend && npm test -- payments && npm test -- treasuryTxn`
Expected: PASS.

---

## Task 11: Health endpoint — log DB errors, trim exposed connection info

**Files:**
- Modify: `backend/src/routes/health.js`
- Check/update: any existing `health.test.js`

- [ ] **Step 1: Check for an existing health test file**

Run: `cd backend && ls src/routes/ | grep health` — if `health.test.js` exists, read it fully before editing `health.js` so the fix doesn't break an existing assertion on the response shape (e.g. an existing test may assert `connection.user` is present — if so, update that specific assertion, do not leave it silently broken).

- [ ] **Step 2: Implement the fix**

In `backend/src/routes/health.js`, add the logger import:
```js
import logger from '../lib/logger.js';
```

Remove `user` from the sanitized connection info (host/port/database name are useful for a local desktop-app health check; the DB username adds no diagnostic value for this unauthenticated, though localhost-bound, endpoint):
```js
function getSanitizedConnectionInfo() {
  try {
    const url = new URL(process.env.DATABASE_URL);
    return {
      host: url.hostname || null,
      port: url.port || null,
      database: url.pathname.replace(/^\//, '') || null,
    };
  } catch {
    return null;
  }
}
```

Log a DB-check failure (currently silent — only visible in the HTTP response, never in the log file):
```js
router.get('/', asyncHandler(async (req, res) => {
  const db = await checkDbConnection();
  if (!db.connected) {
    logger.error(`فحص صحة الخادم: تعذّر الاتصال بقاعدة البيانات: ${db.error}`, { path: req.path });
  }
  ...
```

- [ ] **Step 3: Run the health test suite**

Run: `cd backend && npm test -- health`
Expected: PASS (update the one assertion on `connection.user` if Step 1 found it; otherwise no changes needed).

---

## Task 12: Remove the dead Vite dev proxy

**Files:**
- Modify: `vite.config.js:24-33`

- [ ] **Step 1: Remove the proxy block**

Change:
```js
  server: {
    historyApiFallback: true,
    proxy: {
      // في بيئة الـ dev: وجّه /api للـ Backend تلقائياً (يتجنب CORS)
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
```
to:
```js
  server: {
    historyApiFallback: true,
  },
```

Every `fetch` call in `src/services/api.js` (~70 call sites) already uses the absolute `PG_API_BASE` URL (from `VITE_API_URL`, default `http://localhost:4000`), never a relative `/api/...` path — this proxy is never hit, and its target port (3001) doesn't even match the real backend default (4000). Confirmed dead.

- [ ] **Step 2: Confirm the frontend dev server still starts cleanly**

Run: `npm run dev` briefly (start, confirm no error, then stop) — or skip live-start and just confirm the config file is still valid JS by running the frontend test suite, which loads Vite config implicitly.

Run: `npm test`
Expected: PASS (no change in behavior expected; this is a config-only removal).

---

## Final Validation (run once, after all tasks above)

- [ ] `cd backend && npm test` — full backend unit test suite.
- [ ] `cd backend && npm run test:integration` — full backend integration suite (scratch DB; report SKIPPED vs run).
- [ ] `npm test` (repo root) — full frontend suite.
- [ ] `npm run lint` (repo root and/or `backend`, whichever is configured) — must be clean on all changed files.
- [ ] `npm run build` (repo root) — production build must succeed; inspect `dist/` output exists and no build warnings reference changed files.
- [ ] `git diff --stat` and `git diff` — confirm only the files listed in this plan changed, and specifically confirm **zero diff** in: `backend/prisma/schema.prisma`, `backend/prisma/migrations/**`, `installer/**`, `backend/src/lib/license.js`, `backend/src/lib/licenseArtifactFormat.js`, any Ed25519 key material, and any file already modified by the user's pre-existing uncommitted work (`backend/src/db/postgresProvisioning*.js`, `backend/src/installer/firstInstall.js`, `backend/src/lib/machineIdentity.js`, `tools/**`, `installer/studix.iss`, `scripts/build-windows-runtime.ps1`, `src/modules/activation/**`, `src/modules/LoginScreen.jsx` — none of these appear in any task above; if `git diff` shows changes to them, STOP and investigate before proceeding, do not assume they're mine).
