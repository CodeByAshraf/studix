// backend/src/routes/enrollments.integration.test.js
// Phase 3A (Multi-Group Enrollment — Enrollment API). Real PostgreSQL integration, same
// pattern as crud.studentsGroupId.integration.test.js: invokes the routers returned by
// enrollments.js directly via router.handle(), no supertest dependency anywhere in this
// codebase. Also exercises makeCrudRouter('students', ...) for the Phase 1 PUT regression
// check (test 9) and to confirm the existing Primary Group path composes correctly with
// this phase's new Additional Group operations.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { applyFullSchemaDDL } from '../test-helpers/scratchDbFullSchema.js';

const dbCheck = await checkPostgresReachable();

describe('routes/enrollments.js — real PostgreSQL integration', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client;
  let studentEnrollmentsRouter, enrollmentRouter;
  let makeCrudRouter;
  let setPrimaryGroup;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('enrollments_route');
    client = scratch.client;
    await applyFullSchemaDDL(client);
    ({ studentEnrollmentsRouter, enrollmentRouter } = await import('./enrollments.js'));
    ({ makeCrudRouter } = await import('./crud.js'));
    ({ setPrimaryGroup } = await import('../lib/enrollmentService.js'));
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

  async function seedStudent() {
    const id = nextId('s');
    await client.students.create({ data: { id, name: 'طالب', code: nextId('code') } });
    return id;
  }

  function callRoute(router, { method, url, body }) {
    return new Promise((resolve, reject) => {
      const req = { method, url, headers: {}, body };
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json(b) { resolve({ statusCode: this.statusCode, body: b }); return this; },
      };
      router.handle(req, res, (err) => (err ? reject(err) : reject(new Error('no route matched'))));
    });
  }

  async function activeEnrollments(studentId) {
    return client.student_group_enrollments.findMany({
      where: { student_id: studentId, status: 'active' },
    });
  }

  // ── 1. Read active enrollments for a student ──────────────────────────────────────
  it('1. GET /api/students/:studentId/enrollments returns the active enrollments with role/group/status/dates/attendDays', async () => {
    const groupA = await seedGroup('A');
    const groupB = await seedGroup('B');
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupA, { effectiveDate: '2026-01-01' });
    await callRoute(studentEnrollmentsRouter, {
      method: 'POST', url: `/${studentId}/enrollments`,
      body: { groupId: groupB, startDate: '2026-02-01', attendDays: ['sat'] },
    });

    const result = await callRoute(studentEnrollmentsRouter, { method: 'GET', url: `/${studentId}/enrollments` });

    expect(result.body.ok).toBe(true);
    expect(result.body.data).toHaveLength(2);
    const primary = result.body.data.find((e) => e.role === 'primary');
    const additional = result.body.data.find((e) => e.role === 'additional');
    expect(primary.groupId).toBe(groupA);
    expect(primary.status).toBe('active');
    expect(additional.groupId).toBe(groupB);
    expect(additional.status).toBe('active');
    expect(additional.attendDays).toEqual(['sat']);
    expect(additional.endDate).toBeFalsy();
  });

  it('1b. GET returns an empty list for a student with no active enrollment', async () => {
    const studentId = await seedStudent();

    const result = await callRoute(studentEnrollmentsRouter, { method: 'GET', url: `/${studentId}/enrollments` });

    expect(result.body.ok).toBe(true);
    expect(result.body.data).toEqual([]);
  });

  // ── 2 & 3. Add Additional Group, never touching students.group_id ─────────────────
  it('2/3. POST adds an active Additional Group enrollment without changing students.group_id', async () => {
    const groupA = await seedGroup('A');
    const groupB = await seedGroup('B');
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupA, { effectiveDate: '2026-01-01' });

    const result = await callRoute(studentEnrollmentsRouter, {
      method: 'POST', url: `/${studentId}/enrollments`,
      body: { groupId: groupB, startDate: '2026-02-01', endDate: '2026-06-01', attendDays: ['tue'] },
    });

    expect(result.statusCode).toBe(201);
    expect(result.body.data.role).toBe('additional');
    expect(result.body.data.status).toBe('active');
    expect(result.body.data.groupId).toBe(groupB);
    expect(result.body.data.attendDays).toEqual(['tue']);
    const student = await client.students.findUnique({ where: { id: studentId } });
    expect(student.group_id).toBe(groupA); // unchanged by the Additional Group add
  });

  // ── 4. Withdraw Additional Group ───────────────────────────────────────────────────
  it('4. DELETE /api/enrollments/:id withdraws an Additional Group enrollment', async () => {
    const groupA = await seedGroup('A');
    const groupB = await seedGroup('B');
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupA, { effectiveDate: '2026-01-01' });
    const added = await callRoute(studentEnrollmentsRouter, {
      method: 'POST', url: `/${studentId}/enrollments`, body: { groupId: groupB },
    });
    const enrollmentId = added.body.data.id;

    const result = await callRoute(enrollmentRouter, { method: 'DELETE', url: `/${enrollmentId}` });

    expect(result.body.ok).toBe(true);
    expect(result.body.data.status).toBe('withdrawn');
    const remaining = await activeEnrollments(studentId);
    expect(remaining.map((e) => e.id)).not.toContain(enrollmentId);
    const student = await client.students.findUnique({ where: { id: studentId } });
    expect(student.group_id).toBe(groupA); // Primary untouched by withdrawing an Additional
  });

  it('4b. DELETE refuses to withdraw a Primary enrollment through this route (Additional Group only)', async () => {
    const groupA = await seedGroup('A');
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupA, { effectiveDate: '2026-01-01' });
    const primary = await client.student_group_enrollments.findFirst({
      where: { student_id: studentId, role: 'primary', status: 'active' },
    });

    await expect(callRoute(enrollmentRouter, { method: 'DELETE', url: `/${primary.id}` })).rejects.toThrow();

    const stillActive = await client.student_group_enrollments.findUnique({ where: { id: primary.id } });
    expect(stillActive.status).toBe('active'); // untouched
  });

  // ── 5. Withdrawing Primary (existing crud.js path) does not auto-promote an
  //       Additional Group added through this new route ──────────────────────────────
  it('5. withdrawing the Primary via the existing PUT /api/students/:id path does not promote an Additional Group added via this route', async () => {
    const groupA = await seedGroup('A');
    const groupB = await seedGroup('B');
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupA, { effectiveDate: '2026-01-01' });
    await callRoute(studentEnrollmentsRouter, {
      method: 'POST', url: `/${studentId}/enrollments`, body: { groupId: groupB },
    });
    const studentsRouter = makeCrudRouter('students', { writable: true, preserveClientId: true });

    await callRoute(studentsRouter, { method: 'PUT', url: `/${studentId}`, body: { groupId: null } });

    const student = await client.students.findUnique({ where: { id: studentId } });
    expect(student.group_id).toBeNull();
    const stillPrimary = await client.student_group_enrollments.findFirst({
      where: { student_id: studentId, role: 'primary', status: 'active' },
    });
    expect(stillPrimary).toBeNull();
    const additional = await client.student_group_enrollments.findFirst({
      where: { student_id: studentId, group_id: groupB },
    });
    expect(additional.role).toBe('additional'); // not promoted
    expect(additional.status).toBe('active'); // untouched
  });

  // ── 6. Duplicate active student/group enrollment rejected safely ──────────────────
  it('6. POSTing an Additional Group for a group the student is already actively enrolled in is rejected, with no partial state change', async () => {
    const groupA = await seedGroup('A');
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupA, { effectiveDate: '2026-01-01' });
    const beforeCount = (await activeEnrollments(studentId)).length;

    await expect(callRoute(studentEnrollmentsRouter, {
      method: 'POST', url: `/${studentId}/enrollments`, body: { groupId: groupA },
    })).rejects.toThrow();

    const afterCount = (await activeEnrollments(studentId)).length;
    expect(afterCount).toBe(beforeCount);
    const student = await client.students.findUnique({ where: { id: studentId } });
    expect(student.group_id).toBe(groupA);
  });

  // ── 7. Invalid student/group rejected safely ───────────────────────────────────────
  it('7a. POSTing with a non-existent groupId is rejected, with no row created', async () => {
    const studentId = await seedStudent();

    await expect(callRoute(studentEnrollmentsRouter, {
      method: 'POST', url: `/${studentId}/enrollments`, body: { groupId: 'group-does-not-exist' },
    })).rejects.toThrow();

    const rows = await activeEnrollments(studentId);
    expect(rows).toHaveLength(0);
  });

  it('7b. POSTing under a non-existent studentId is rejected, with no row created', async () => {
    const groupA = await seedGroup('A');

    await expect(callRoute(studentEnrollmentsRouter, {
      method: 'POST', url: `/student-does-not-exist/enrollments`, body: { groupId: groupA },
    })).rejects.toThrow();

    const rows = await client.student_group_enrollments.findMany({ where: { group_id: groupA } });
    expect(rows).toHaveLength(0);
  });

  // ── 8. Transaction rollback behavior (schedule update) ─────────────────────────────
  it('8a. PATCH on a non-existent enrollmentId is rejected safely', async () => {
    await expect(callRoute(enrollmentRouter, {
      method: 'PATCH', url: '/enrollment-does-not-exist', body: { attendDays: ['sat'] },
    })).rejects.toThrow();
  });

  it('8b. PATCH with start_date after end_date is rejected, leaving the row unchanged', async () => {
    const groupA = await seedGroup('A');
    const groupB = await seedGroup('B');
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupA, { effectiveDate: '2026-01-01' });
    const added = await callRoute(studentEnrollmentsRouter, {
      method: 'POST', url: `/${studentId}/enrollments`, body: { groupId: groupB, startDate: '2026-02-01' },
    });
    const enrollmentId = added.body.data.id;

    await expect(callRoute(enrollmentRouter, {
      method: 'PATCH', url: `/${enrollmentId}`, body: { endDate: '2026-01-01' }, // before start_date
    })).rejects.toThrow();

    const unchanged = await client.student_group_enrollments.findUnique({ where: { id: enrollmentId } });
    expect(unchanged.end_date).toBeNull();
  });

  it('8c. PATCH updates attend_days/start_date/end_date on an active enrollment', async () => {
    const groupA = await seedGroup('A');
    const groupB = await seedGroup('B');
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupA, { effectiveDate: '2026-01-01' });
    const added = await callRoute(studentEnrollmentsRouter, {
      method: 'POST', url: `/${studentId}/enrollments`, body: { groupId: groupB, startDate: '2026-02-01' },
    });
    const enrollmentId = added.body.data.id;

    const result = await callRoute(enrollmentRouter, {
      method: 'PATCH', url: `/${enrollmentId}`, body: { attendDays: ['sat', 'tue'], endDate: '2026-12-01' },
    });

    expect(result.body.data.attendDays).toEqual(['sat', 'tue']);
    expect(result.body.data.endDate).toBeTruthy();
  });

  it('8d. PATCH refuses to edit a withdrawn (closed) enrollment', async () => {
    const groupA = await seedGroup('A');
    const groupB = await seedGroup('B');
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupA, { effectiveDate: '2026-01-01' });
    const added = await callRoute(studentEnrollmentsRouter, {
      method: 'POST', url: `/${studentId}/enrollments`, body: { groupId: groupB },
    });
    const enrollmentId = added.body.data.id;
    await callRoute(enrollmentRouter, { method: 'DELETE', url: `/${enrollmentId}` });

    await expect(callRoute(enrollmentRouter, {
      method: 'PATCH', url: `/${enrollmentId}`, body: { attendDays: ['sat'] },
    })).rejects.toThrow();
  });

  // ── 9. Existing Primary Group transfer still works (Phase 1 regression) ───────────
  it('9. the existing PUT /api/students/:id Primary Group transfer path is unaffected by this phase\'s additions', async () => {
    const groupA = await seedGroup('A');
    const groupB = await seedGroup('B');
    const studentId = await seedStudent();
    const studentsRouter = makeCrudRouter('students', { writable: true, preserveClientId: true });
    await callRoute(studentsRouter, { method: 'PUT', url: `/${studentId}`, body: { groupId: groupA } });

    const result = await callRoute(studentsRouter, { method: 'PUT', url: `/${studentId}`, body: { groupId: groupB } });

    expect(result.body.data.groupId).toBe(groupB);
    const student = await client.students.findUnique({ where: { id: studentId } });
    expect(student.group_id).toBe(groupB);
    const primary = await client.student_group_enrollments.findFirst({
      where: { student_id: studentId, role: 'primary', status: 'active' },
    });
    expect(primary.group_id).toBe(groupB);
  });
});
