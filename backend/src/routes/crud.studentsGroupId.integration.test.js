// backend/src/routes/crud.studentsGroupId.integration.test.js
// Phase 1 follow-up — closes the crud.js generic PUT/PATCH gap the Phase 1 audit flagged
// (see studentCreate.enrollmentSync.integration.test.js's own header): a PUT/PATCH to
// /api/students/:id carrying group_id must route through enrollmentService
// (setPrimaryGroupTx / withdrawEnrollmentTx), in the same transaction as any other student
// fields in the same request, exactly like studentCreate.js and admissionActivation.js
// already do for their own write paths.
//
// Invokes the router returned by makeCrudRouter(...) directly and reads its res.json(...)
// callback — same technique cryptoGlobalIndependence.integration.test.js already uses for
// crud.js (no supertest dependency anywhere in this codebase).
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { applyFullSchemaDDL } from '../test-helpers/scratchDbFullSchema.js';

const dbCheck = await checkPostgresReachable();

describe('crud.js — students.group_id PUT/PATCH routes through enrollmentService (real PostgreSQL integration)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, makeCrudRouter, addAdditionalEnrollment;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('crud_students_group_id');
    client = scratch.client;
    await applyFullSchemaDDL(client);
    ({ makeCrudRouter } = await import('./crud.js'));
    ({ addAdditionalEnrollment } = await import('../lib/enrollmentService.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  async function seedGroup(name = 'مجموعة') {
    const id = nextId('g');
    await client.groups.create({ data: { id, name, price: 100 } });
    return id;
  }

  async function seedStudent({ groupId = null } = {}) {
    const id = nextId('s');
    await client.students.create({ data: { id, name: 'طالب', code: nextId('code'), group_id: groupId } });
    return id;
  }

  async function activePrimary(studentId) {
    return client.student_group_enrollments.findFirst({
      where: { student_id: studentId, role: 'primary', status: 'active' },
    });
  }

  function studentsRouter() {
    return makeCrudRouter('students', { writable: true, preserveClientId: true });
  }

  function callRoute(router, { method, id, body }) {
    return new Promise((resolve, reject) => {
      const req = { method, url: `/${id}`, headers: {}, body };
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json(b) { resolve({ statusCode: this.statusCode, body: b }); return this; },
      };
      router.handle(req, res, (err) => (err ? reject(err) : reject(new Error('no route matched'))));
    });
  }

  // ── 1. Set / transfer Primary Group through PUT ──────────────────────────────────
  it('1a. PUT with groupId (no previous Primary) creates an active Primary enrollment and syncs students.group_id', async () => {
    const groupId = await seedGroup('A');
    const studentId = await seedStudent();
    const router = studentsRouter();

    const result = await callRoute(router, { method: 'PUT', id: studentId, body: { groupId } });

    expect(result.body.ok).toBe(true);
    expect(result.body.data.groupId).toBe(groupId);
    const primary = await activePrimary(studentId);
    expect(primary).not.toBeNull();
    expect(primary.group_id).toBe(groupId);
    const student = await client.students.findUnique({ where: { id: studentId } });
    expect(student.group_id).toBe(groupId);
  });

  it('1b. PUT with a different groupId transfers: old Primary becomes transferred (kept), new becomes active', async () => {
    const groupA = await seedGroup('A');
    const groupB = await seedGroup('B');
    const studentId = await seedStudent();
    const router = studentsRouter();
    await callRoute(router, { method: 'PUT', id: studentId, body: { groupId: groupA } });
    const oldPrimary = await activePrimary(studentId);

    const result = await callRoute(router, { method: 'PUT', id: studentId, body: { groupId: groupB } });

    expect(result.body.data.groupId).toBe(groupB);
    const closedOld = await client.student_group_enrollments.findUnique({ where: { id: oldPrimary.id } });
    expect(closedOld.status).toBe('transferred');
    const newPrimary = await activePrimary(studentId);
    expect(newPrimary.group_id).toBe(groupB);
    const allForStudent = await client.student_group_enrollments.findMany({ where: { student_id: studentId } });
    expect(allForStudent.length).toBe(2); // old row kept, not deleted
  });

  // ── 2. groupId + another field, applied atomically ────────────────────────────────
  it('2. PATCH with groupId and name updates the enrollment and the other field together', async () => {
    const groupId = await seedGroup('A');
    const studentId = await seedStudent();
    const router = studentsRouter();

    const result = await callRoute(router, {
      method: 'PATCH',
      id: studentId,
      body: { groupId, name: 'اسم جديد' },
    });

    expect(result.body.data.groupId).toBe(groupId);
    expect(result.body.data.name).toBe('اسم جديد');
    const student = await client.students.findUnique({ where: { id: studentId } });
    expect(student.name).toBe('اسم جديد');
    expect(student.group_id).toBe(groupId);
    const primary = await activePrimary(studentId);
    expect(primary.group_id).toBe(groupId);
  });

  // ── 3. Idempotent — same groupId as current Primary ───────────────────────────────
  it('3. PUT with the groupId the student already has as Primary is a no-op (no duplicate history row)', async () => {
    const groupId = await seedGroup('A');
    const studentId = await seedStudent();
    const router = studentsRouter();
    await callRoute(router, { method: 'PUT', id: studentId, body: { groupId } });
    const before = await activePrimary(studentId);

    await callRoute(router, { method: 'PUT', id: studentId, body: { groupId } });

    const after = await activePrimary(studentId);
    expect(after.id).toBe(before.id); // same row, not replaced
    const allForStudent = await client.student_group_enrollments.findMany({ where: { student_id: studentId } });
    expect(allForStudent.length).toBe(1);
  });

  // ── 4. groupId: null withdraws Primary, no auto-promotion ─────────────────────────
  it('4a. PUT with groupId: null withdraws the active Primary and sets students.group_id to NULL without promoting an Additional', async () => {
    const groupA = await seedGroup('A');
    const groupB = await seedGroup('B');
    const studentId = await seedStudent();
    const router = studentsRouter();
    await callRoute(router, { method: 'PUT', id: studentId, body: { groupId: groupA } });
    const primaryBefore = await activePrimary(studentId);
    await addAdditionalEnrollment(studentId, groupB, { effectiveDate: '2026-02-01' });

    const result = await callRoute(router, { method: 'PUT', id: studentId, body: { groupId: null } });

    expect(result.body.data.groupId).toBeFalsy();
    const student = await client.students.findUnique({ where: { id: studentId } });
    expect(student.group_id).toBeNull();
    const withdrawnPrimary = await client.student_group_enrollments.findUnique({ where: { id: primaryBefore.id } });
    expect(withdrawnPrimary.status).toBe('withdrawn');
    const stillPrimary = await activePrimary(studentId);
    expect(stillPrimary).toBeNull(); // no automatic promotion
    const additional = await client.student_group_enrollments.findFirst({
      where: { student_id: studentId, role: 'additional', group_id: groupB },
    });
    expect(additional.role).toBe('additional'); // untouched, not promoted
    expect(additional.status).toBe('active');
  });

  it('4b. PUT with groupId: null when there is no active Primary is a harmless no-op', async () => {
    const studentId = await seedStudent();
    const router = studentsRouter();

    const result = await callRoute(router, { method: 'PUT', id: studentId, body: { groupId: null, name: 'اسم' } });

    expect(result.body.ok).toBe(true);
    const student = await client.students.findUnique({ where: { id: studentId } });
    expect(student.group_id).toBeNull();
    expect(student.name).toBe('اسم');
  });

  // ── 5. Transaction rollback — group_id + other field are all-or-nothing ───────────
  it('5. a failed transaction (invalid target group) leaves both the enrollment state and other student fields unchanged', async () => {
    const groupA = await seedGroup('A');
    const studentId = await seedStudent();
    const router = studentsRouter();
    await callRoute(router, { method: 'PUT', id: studentId, body: { groupId: groupA, name: 'قبل' } });
    const beforeStudent = await client.students.findUnique({ where: { id: studentId } });
    const beforePrimary = await activePrimary(studentId);
    const beforeCount = (await client.student_group_enrollments.findMany({ where: { student_id: studentId } })).length;

    // A non-existent target group violates the group_id FK inside the same transaction —
    // forces a real mid-transaction failure without any test-only hook in production code
    // (same technique as enrollmentService.integration.test.js's own rollback test).
    await expect(callRoute(router, {
      method: 'PUT',
      id: studentId,
      body: { groupId: 'group-does-not-exist', name: 'بعد' },
    })).rejects.toThrow();

    const afterStudent = await client.students.findUnique({ where: { id: studentId } });
    const afterPrimary = await activePrimary(studentId);
    const afterCount = (await client.student_group_enrollments.findMany({ where: { student_id: studentId } })).length;
    expect(afterStudent.name).toBe(beforeStudent.name); // still 'قبل', not 'بعد'
    expect(afterStudent.group_id).toBe(beforeStudent.group_id);
    expect(afterPrimary.id).toBe(beforePrimary.id);
    expect(afterPrimary.status).toBe('active');
    expect(afterCount).toBe(beforeCount); // no orphaned/partial rows from the failed attempt
  });

  // ── 6. Every other collection's generic update path is unchanged ──────────────────
  it('6. PUT on a non-students collection (groups) still uses the plain generic update path, unaffected', async () => {
    const groupId = await seedGroup('قديم');
    const router = makeCrudRouter('groups', { writable: true, preserveClientId: true });

    const result = await callRoute(router, { method: 'PUT', id: groupId, body: { name: 'جديد' } });

    expect(result.body.ok).toBe(true);
    expect(result.body.data.name).toBe('جديد');
    const group = await client.groups.findUnique({ where: { id: groupId } });
    expect(group.name).toBe('جديد');
    const anyEnrollment = await client.student_group_enrollments.findFirst({ where: { group_id: groupId } });
    expect(anyEnrollment).toBeNull(); // no enrollment side effect for a non-students collection
  });
});
