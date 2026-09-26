// backend/src/routes/admissionActivation.enrollmentSync.integration.test.js
// Phase 1 (Multi-Group Enrollment) — activateAdmission is the third real backend write
// path that can set students.group_id (the other two are studentCreate.js and crud.js's
// generic PUT — see enrollmentService.js's module doc and the Phase 1 report). Converting
// an admission into a student with a confirmed group is a Primary Group assignment, same
// as studentCreate.js's initial groupId — the new student must end up with a matching
// active Primary enrollment row, in the same transaction as the student row itself.
//
// Kept separate from admissionActivation.integration.test.js (existing file, not modified
// here) so that file's own BUG-05 regression coverage stays untouched and independently
// verifiable.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { applyFullSchemaDDL } from '../test-helpers/scratchDbFullSchema.js';

const dbCheck = await checkPostgresReachable();

describe('admissionActivation.js <-> enrollmentService.js sync — real PostgreSQL integration', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let client;
  let activateAdmission;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('admission_activation_enrollment_sync');
    client = scratch.client;
    await applyFullSchemaDDL(client);
    ({ activateAdmission } = await import('./admissionActivation.js'));
    await client.groups.create({ data: { id: 'g1', name: 'مجموعة اختبار', price: 100 } });
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  async function seedAdmission(overrides = {}) {
    const id = nextId('adm');
    return client.admissions.create({
      data: { id, number: nextId('NUM'), name: 'طالب اختبار', stage: 'reserved', ...overrides },
    });
  }

  it('activating an admission with a confirmed group creates a matching active Primary enrollment for the new student', async () => {
    const admission = await seedAdmission();

    const result = await activateAdmission(
      { admissionId: admission.id, student: { name: 'طالب جديد', groupId: 'g1' } },
      { userId: null }
    );

    expect(result.student.groupId).toBe('g1');
    const primary = await client.student_group_enrollments.findFirst({
      where: { student_id: result.student.id, role: 'primary', status: 'active' },
    });
    expect(primary).not.toBeNull();
    expect(primary.group_id).toBe('g1');
  });
});
