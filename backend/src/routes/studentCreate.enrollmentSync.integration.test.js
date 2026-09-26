// backend/src/routes/studentCreate.enrollmentSync.integration.test.js
// Phase 1 (Multi-Group Enrollment) — verifies createStudentDirect (POST /api/students)
// is one of the two real backend write paths that can set students.group_id (the other
// is crud.js's generic PUT/PATCH — see enrollmentService.js's module doc and the Phase 1
// report for why that one is intentionally left unchanged this phase). A new student
// created with an initial groupId must end up with a matching active Primary enrollment
// row, in the same transaction as the student row itself — never just the scalar column.
//
// Kept separate from studentCreate.integration.test.js (existing file, not modified here)
// so that file's own regression coverage stays untouched and independently verifiable.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { applyFullSchemaDDL } from '../test-helpers/scratchDbFullSchema.js';

const dbCheck = await checkPostgresReachable();

describe('studentCreate.js <-> enrollmentService.js sync — real PostgreSQL integration', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let client;
  let createStudentDirect;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('student_create_enrollment_sync');
    client = scratch.client;
    await applyFullSchemaDDL(client);
    ({ createStudentDirect } = await import('./studentCreate.js'));
    await client.groups.create({ data: { id: 'g1', name: 'مجموعة اختبار', price: 100 } });
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  it('creating a student with an initial groupId also creates a matching active Primary enrollment', async () => {
    const created = await createStudentDirect({ id: nextId('s'), name: 'طالب جديد', groupId: 'g1' });

    expect(created.groupId).toBe('g1');
    const primary = await client.student_group_enrollments.findFirst({
      where: { student_id: created.id, role: 'primary', status: 'active' },
    });
    expect(primary).not.toBeNull();
    expect(primary.group_id).toBe('g1');
  });

  it('creating a student with no groupId creates zero enrollment rows', async () => {
    const created = await createStudentDirect({ id: nextId('s'), name: 'طالب بلا مجموعة' });

    expect(created.groupId).toBeFalsy();
    const anyEnrollment = await client.student_group_enrollments.findFirst({
      where: { student_id: created.id },
    });
    expect(anyEnrollment).toBeNull();
  });
});
