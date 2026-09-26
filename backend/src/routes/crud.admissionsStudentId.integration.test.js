// backend/src/routes/crud.admissionsStudentId.integration.test.js
// Pre-installer review follow-up — closes the crud.js generic PUT/PATCH gap found during
// the final pre-installer review: a plain PUT/PATCH to /api/admissions/:id carrying
// student_id used to write it directly via the generic path, bypassing both guards that
// PUT /api/admissions/:id/activate (admissionActivation.js) enforces — the conditional
// updateMany({where:{id, student_id:null}}) race guard against double-linking a student to
// two admissions, and the admission_system_log audit trail — silently. crud.js now rejects
// any generic write that touches student_id with a 400, same style as the pre-existing
// students.group_id special-case in crud.studentsGroupId.integration.test.js. stage and
// every other admissions field must remain writable through this same generic path (the
// AdmissionsPage.jsx reservation flow — convertToReservation/confirmReservation — depends
// on writing `stage` through exactly this route).
//
// Invokes the router returned by makeCrudRouter(...) directly, same technique as
// crud.studentsGroupId.integration.test.js (no supertest dependency anywhere in this codebase).
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { applyFullSchemaDDL } from '../test-helpers/scratchDbFullSchema.js';

const dbCheck = await checkPostgresReachable();

describe('crud.js — admissions.student_id is rejected on the generic PUT/PATCH path (real PostgreSQL integration)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, makeCrudRouter;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('crud_admissions_student_id');
    client = scratch.client;
    await applyFullSchemaDDL(client);
    ({ makeCrudRouter } = await import('./crud.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  async function seedAdmission(overrides = {}) {
    const id = nextId('a');
    await client.admissions.create({
      data: { id, number: nextId('num'), name: 'عميل', stage: 'lead', ...overrides },
    });
    return id;
  }

  async function seedStudent() {
    const id = nextId('s');
    await client.students.create({ data: { id, name: 'طالب', code: nextId('code') } });
    return id;
  }

  function admissionsRouter() {
    return makeCrudRouter('admissions', { writable: true, preserveClientId: true });
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

  it('1. PUT with studentId is rejected with 400 and leaves the admission row unchanged', async () => {
    const admissionId = await seedAdmission({ stage: 'confirmed' });
    const studentId = await seedStudent();
    const router = admissionsRouter();

    await expect(callRoute(router, {
      method: 'PUT', id: admissionId, body: { studentId },
    })).rejects.toMatchObject({ status: 400 });

    const admission = await client.admissions.findUnique({ where: { id: admissionId } });
    expect(admission.student_id).toBeNull();
  });

  it('2. PATCH with studentId alongside other fields is rejected wholesale (no partial write of the other fields)', async () => {
    const admissionId = await seedAdmission({ stage: 'confirmed', notes: 'قبل' });
    const studentId = await seedStudent();
    const router = admissionsRouter();

    await expect(callRoute(router, {
      method: 'PATCH', id: admissionId, body: { studentId, notes: 'بعد' },
    })).rejects.toMatchObject({ status: 400 });

    const admission = await client.admissions.findUnique({ where: { id: admissionId } });
    expect(admission.student_id).toBeNull();
    expect(admission.notes).toBe('قبل');
  });

  it('3. PUT with stage (no studentId) still writes normally through the generic path — reservation flow unaffected', async () => {
    const admissionId = await seedAdmission({ stage: 'lead' });
    const router = admissionsRouter();

    const result = await callRoute(router, {
      method: 'PUT', id: admissionId, body: { stage: 'reserved', reservationStatus: 'reserved' },
    });

    expect(result.body.ok).toBe(true);
    expect(result.body.data.stage).toBe('reserved');
    const admission = await client.admissions.findUnique({ where: { id: admissionId } });
    expect(admission.stage).toBe('reserved');
    expect(admission.reservation_status).toBe('reserved');
  });

  it('4. PUT with studentId: null (clearing, not setting) is also rejected — no silent divergence from the activate/cancel paths', async () => {
    const admissionId = await seedAdmission({ stage: 'active' });
    const router = admissionsRouter();

    await expect(callRoute(router, {
      method: 'PUT', id: admissionId, body: { studentId: null },
    })).rejects.toMatchObject({ status: 400 });
  });
});
