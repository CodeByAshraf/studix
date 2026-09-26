// backend/src/lib/enrollmentService.integration.test.js
// Phase 1 (Multi-Group Enrollment — Primary Group write-through sync). Real PostgreSQL
// integration (scratch database only), same pattern as studentCreate.integration.test.js /
// licenseConfig.integration.test.js: setupScratchDb (db push, base schema.prisma shape)
// + applyFullSchemaDDL (backend/migrations/*.sql — needed here specifically for the
// student_group_enrollments table, its two partial unique indexes, and its CHECK
// constraints added in migration 005, none of which schema.prisma/db push represent).
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { applyFullSchemaDDL } from '../test-helpers/scratchDbFullSchema.js';

const dbCheck = await checkPostgresReachable();

describe('enrollmentService.js — real PostgreSQL integration', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let client;
  let setPrimaryGroup;
  let addAdditionalEnrollment;
  let withdrawEnrollment;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('enrollment_service');
    client = scratch.client;
    await applyFullSchemaDDL(client);
    ({ setPrimaryGroup, addAdditionalEnrollment, withdrawEnrollment } = await import('./enrollmentService.js'));
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
    await client.students.create({
      data: { id, name: 'طالب', code: nextId('code'), group_id: groupId },
    });
    return id;
  }

  async function activePrimary(studentId) {
    return client.student_group_enrollments.findFirst({
      where: { student_id: studentId, role: 'primary', status: 'active' },
    });
  }

  // ── 1. Existing (Phase 0 backfilled) Primary stays synchronized ──────────────────
  it('1. a Phase-0-shaped student (group_id set, matching active primary enrollment) is already consistent', async () => {
    const groupId = await seedGroup();
    const studentId = await seedStudent({ groupId });
    // Simulates the Phase 0 backfill directly (role='primary', status='active', attend_days=NULL).
    await client.student_group_enrollments.create({
      data: {
        id: nextId('e'), student_id: studentId, group_id: groupId,
        role: 'primary', status: 'active', start_date: new Date('2026-01-01'),
      },
    });

    const student = await client.students.findUnique({ where: { id: studentId } });
    const primary = await activePrimary(studentId);
    expect(student.group_id).toBe(groupId);
    expect(primary.group_id).toBe(groupId);
    expect(primary.status).toBe('active');
    expect(primary.attend_days).toBeNull();
  });

  // ── 2. Set Primary Group — no previous Primary ────────────────────────────────────
  it('2. setPrimaryGroup with no previous Primary creates an active enrollment and updates students.group_id', async () => {
    const groupId = await seedGroup();
    const studentId = await seedStudent();

    await setPrimaryGroup(studentId, groupId, { effectiveDate: '2026-02-01' });

    const student = await client.students.findUnique({ where: { id: studentId } });
    const primary = await activePrimary(studentId);
    expect(student.group_id).toBe(groupId);
    expect(primary).not.toBeNull();
    expect(primary.role).toBe('primary');
    expect(primary.status).toBe('active');
    expect(primary.end_date).toBeNull();
  });

  // ── 3. Change Primary Group (transfer) ────────────────────────────────────────────
  it('3. setPrimaryGroup with an existing Primary transfers: old becomes transferred (kept), new becomes active', async () => {
    const groupA = await seedGroup('A');
    const groupB = await seedGroup('B');
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupA, { effectiveDate: '2026-01-01' });
    const oldPrimary = await activePrimary(studentId);

    await setPrimaryGroup(studentId, groupB, { effectiveDate: '2026-03-01' });

    const student = await client.students.findUnique({ where: { id: studentId } });
    const closedOld = await client.student_group_enrollments.findUnique({ where: { id: oldPrimary.id } });
    const newPrimary = await activePrimary(studentId);

    expect(student.group_id).toBe(groupB);
    expect(closedOld.status).toBe('transferred');
    expect(closedOld.group_id).toBe(groupA); // history row still exists, unchanged group
    expect(closedOld.end_date).not.toBeNull();
    expect(newPrimary.group_id).toBe(groupB);
    expect(newPrimary.status).toBe('active');

    const allForStudent = await client.student_group_enrollments.findMany({ where: { student_id: studentId } });
    expect(allForStudent.length).toBe(2); // no row deleted
  });

  // ── 4. Additional enrollment — added, does not touch students.group_id ──────────
  it('4. addAdditionalEnrollment creates an active additional enrollment without changing students.group_id', async () => {
    const groupA = await seedGroup('A');
    const groupB = await seedGroup('B');
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupA, { effectiveDate: '2026-01-01' });

    await addAdditionalEnrollment(studentId, groupB, { effectiveDate: '2026-02-01' });

    const student = await client.students.findUnique({ where: { id: studentId } });
    const additional = await client.student_group_enrollments.findFirst({
      where: { student_id: studentId, role: 'additional', group_id: groupB },
    });
    expect(student.group_id).toBe(groupA); // unchanged
    expect(additional).not.toBeNull();
    expect(additional.status).toBe('active');
  });

  // ── 5. Withdraw Additional — only that enrollment changes ───────────────────────
  it('5. withdrawEnrollment on an Additional enrollment leaves the Primary and students.group_id unchanged', async () => {
    const groupA = await seedGroup('A');
    const groupB = await seedGroup('B');
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupA, { effectiveDate: '2026-01-01' });
    const additional = await addAdditionalEnrollment(studentId, groupB, { effectiveDate: '2026-02-01' });

    await withdrawEnrollment(additional.id, { effectiveDate: '2026-03-01' });

    const student = await client.students.findUnique({ where: { id: studentId } });
    const withdrawn = await client.student_group_enrollments.findUnique({ where: { id: additional.id } });
    const primary = await activePrimary(studentId);
    expect(student.group_id).toBe(groupA); // unchanged
    expect(withdrawn.status).toBe('withdrawn');
    expect(withdrawn.end_date).not.toBeNull();
    expect(primary.group_id).toBe(groupA);
    expect(primary.status).toBe('active');
  });

  // ── 6. Withdraw Primary — group_id -> NULL, no auto-promotion ───────────────────
  it('6. withdrawEnrollment on the Primary sets students.group_id to NULL and does not promote any Additional', async () => {
    const groupA = await seedGroup('A');
    const groupB = await seedGroup('B');
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupA, { effectiveDate: '2026-01-01' });
    await addAdditionalEnrollment(studentId, groupB, { effectiveDate: '2026-02-01' });
    const primaryBefore = await activePrimary(studentId);

    await withdrawEnrollment(primaryBefore.id, { effectiveDate: '2026-03-01' });

    const student = await client.students.findUnique({ where: { id: studentId } });
    const withdrawnPrimary = await client.student_group_enrollments.findUnique({ where: { id: primaryBefore.id } });
    const stillPrimary = await activePrimary(studentId);
    const additionalStillActive = await client.student_group_enrollments.findFirst({
      where: { student_id: studentId, role: 'additional', group_id: groupB },
    });

    expect(student.group_id).toBeNull();
    expect(withdrawnPrimary.status).toBe('withdrawn');
    expect(stillPrimary).toBeNull(); // no automatic promotion
    expect(additionalStillActive.status).toBe('active'); // untouched
    expect(additionalStillActive.role).toBe('additional'); // NOT auto-promoted to primary
  });

  // ── 7. Transaction rollback — Primary change is all-or-nothing ──────────────────
  it('7. a failure during setPrimaryGroup leaves both the enrollment state and students.group_id unchanged', async () => {
    const groupA = await seedGroup('A');
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupA, { effectiveDate: '2026-01-01' });
    const beforeStudent = await client.students.findUnique({ where: { id: studentId } });
    const beforePrimary = await activePrimary(studentId);
    const beforeCount = (await client.student_group_enrollments.findMany({ where: { student_id: studentId } })).length;

    // A non-existent target group violates the group_id FK inside the same transaction —
    // forces a real mid-transaction failure without any test-only hook in production code.
    await expect(setPrimaryGroup(studentId, 'group-does-not-exist', { effectiveDate: '2026-04-01' }))
      .rejects.toThrow();

    const afterStudent = await client.students.findUnique({ where: { id: studentId } });
    const afterPrimary = await activePrimary(studentId);
    const afterCount = (await client.student_group_enrollments.findMany({ where: { student_id: studentId } })).length;

    expect(afterStudent.group_id).toBe(beforeStudent.group_id);
    expect(afterPrimary.id).toBe(beforePrimary.id);
    expect(afterPrimary.status).toBe('active');
    expect(afterCount).toBe(beforeCount); // no orphaned/partial rows from the failed attempt
  });

  // ── 8. Database constraints still enforced ───────────────────────────────────────
  it('8a. a second active Primary for the same student is rejected at the DB level (bypassing the service)', async () => {
    const groupA = await seedGroup('A');
    const groupB = await seedGroup('B');
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupA, { effectiveDate: '2026-01-01' });

    await expect(client.student_group_enrollments.create({
      data: {
        id: nextId('e'), student_id: studentId, group_id: groupB,
        role: 'primary', status: 'active', start_date: new Date('2026-02-01'),
      },
    })).rejects.toThrow();
  });

  it('8b. duplicate active membership in the same group is rejected at the DB level (bypassing the service)', async () => {
    const groupA = await seedGroup('A');
    const studentId = await seedStudent();
    await addAdditionalEnrollment(studentId, groupA, { effectiveDate: '2026-01-01' });

    await expect(client.student_group_enrollments.create({
      data: {
        id: nextId('e'), student_id: studentId, group_id: groupA,
        role: 'additional', status: 'active', start_date: new Date('2026-02-01'),
      },
    })).rejects.toThrow();
  });

  // ── extra: idempotent no-op — setting Primary to the group it's already in ──────
  it('9. setPrimaryGroup to the same group the student is already Primary in is a no-op (no duplicate history row)', async () => {
    const groupA = await seedGroup('A');
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupA, { effectiveDate: '2026-01-01' });
    const before = await activePrimary(studentId);

    await setPrimaryGroup(studentId, groupA, { effectiveDate: '2026-02-01' });

    const after = await activePrimary(studentId);
    const allForStudent = await client.student_group_enrollments.findMany({ where: { student_id: studentId } });
    expect(after.id).toBe(before.id); // same row, not replaced
    expect(allForStudent.length).toBe(1);
  });
});
