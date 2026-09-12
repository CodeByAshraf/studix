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
    // Test D links a student to an admission (admissions.student_id FK, NO ACTION) — clean
    // up in dependency order so a prior run's admission/log rows don't block student deletes.
    await client.admission_system_log.deleteMany({});
    await client.admissions.deleteMany({});
    await client.students.deleteMany({});
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  it('A: creating students 0001-0005, deleting 0003, then creating another must not collide with 0005 (continues from the real MAX, not a count)', async () => {
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

  it('D: existing admission-activation code generation is unaffected - codes from both paths never collide', async () => {
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

  it('E: accepts a plain YYYY-MM-DD enrollDate against real Postgres, preserving the exact calendar date with no timezone shift', async () => {
    const created = await createStudentDirect({ id: nextId('s'), name: 'تاريخ تسجيل', groupId: 'g1', enrollDate: '2026-03-05' });
    expect(new Date(created.enrollDate).toISOString().slice(0, 10)).toBe('2026-03-05');

    const dbRow = await client.students.findUnique({ where: { id: created.id } });
    expect(dbRow.enroll_date.toISOString().slice(0, 10)).toBe('2026-03-05');
  });

  it('F: rejects an invalid enrollDate with a 400-style error instead of a raw Prisma 500', async () => {
    await expect(
      createStudentDirect({ id: nextId('s'), name: 'تاريخ غير صالح', groupId: 'g1', enrollDate: 'not-a-date' })
    ).rejects.toMatchObject({ status: 400 });
  });
});
