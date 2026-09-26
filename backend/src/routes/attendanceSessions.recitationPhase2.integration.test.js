// backend/src/routes/attendanceSessions.recitationPhase2.integration.test.js
// Recitation Assessment — Phase 2, Part A: attendance_sessions integration.
//
// saveAttendanceSession now creates/upserts the matching attendance_sessions row (session
// identity = group_id+date) in the SAME transaction as the attendance rows it writes, and
// rejects any further save once that session is completed — real PostgreSQL integration
// (scratch database), same pattern/helpers as attendanceSessions.integration.test.js.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { applyFullSchemaDDL } from '../test-helpers/scratchDbFullSchema.js';

const dbCheck = await checkPostgresReachable();

describe('routes/attendanceSessions.js — Recitation Phase 2 Part A (real PostgreSQL)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client;
  let saveAttendanceSession, completeAttendanceSession;
  let setPrimaryGroup;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('attendance_sessions_recitation_p2a');
    client = scratch.client;
    await applyFullSchemaDDL(client);
    ({ saveAttendanceSession, completeAttendanceSession } = await import('./attendanceSessions.js'));
    ({ setPrimaryGroup } = await import('../lib/enrollmentService.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  async function seedGroup({ name = 'مجموعة', days = ['sat'] } = {}) {
    const id = nextId('g');
    await client.groups.create({ data: { id, name, price: 100, days } });
    return id;
  }

  async function seedStudent() {
    const id = nextId('s');
    await client.students.create({ data: { id, name: 'طالب', code: nextId('code') } });
    return id;
  }

  async function seedEligibleStudent(groupId) {
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupId, { effectiveDate: '2026-01-01' });
    return studentId;
  }

  async function seedUser() {
    const id = nextId('u');
    await client.users.create({ data: { id, name: 'مستخدم اختبار', active: true } });
    return id;
  }

  // 2026-01-03 is a Saturday (UTC).
  const SATURDAY = '2026-01-03';

  it('1. saveAttendanceSession creates the matching attendance_sessions row (draft, group_id+date identity)', async () => {
    const groupId = await seedGroup();
    const studentId = await seedEligibleStudent(groupId);

    await saveAttendanceSession({ groupId, date: SATURDAY, sessionTime: '09:00', records: [{ studentId, status: 'present' }] });

    const session = await client.attendance_sessions.findUnique({
      where: { group_id_date: { group_id: groupId, date: new Date(`${SATURDAY}T00:00:00.000Z`) } },
    });
    expect(session).not.toBeNull();
    expect(session.status).toBe('draft');
    expect(session.recitation_status).toBe('not_started');
    expect(session.session_time).toBe('09:00');
  });

  it('2. session creation is atomic with attendance save — an ineligible student rejects the whole save, no orphaned session row', async () => {
    const groupId = await seedGroup();
    const ineligibleStudent = await seedStudent(); // never enrolled

    await expect(saveAttendanceSession({
      groupId, date: SATURDAY, sessionTime: '09:00', records: [{ studentId: ineligibleStudent, status: 'present' }],
    })).rejects.toThrow();

    const session = await client.attendance_sessions.findUnique({
      where: { group_id_date: { group_id: groupId, date: new Date(`${SATURDAY}T00:00:00.000Z`) } },
    });
    expect(session).toBeNull(); // no orphaned session header despite the failed attendance write
  });

  it('3. draft attendance remains editable (regression) — re-saving updates session_time without error', async () => {
    const groupId = await seedGroup();
    const studentId = await seedEligibleStudent(groupId);

    await saveAttendanceSession({ groupId, date: SATURDAY, sessionTime: '09:00', records: [{ studentId, status: 'present' }] });
    const result = await saveAttendanceSession({ groupId, date: SATURDAY, sessionTime: '10:00', records: [{ studentId, status: 'late' }] });

    expect(result.records[0].status).toBe('late');
    const session = await client.attendance_sessions.findUnique({
      where: { group_id_date: { group_id: groupId, date: new Date(`${SATURDAY}T00:00:00.000Z`) } },
    });
    expect(session.session_time).toBe('10:00');
    expect(session.status).toBe('draft');
  });

  it('4. completed attendance rejects further save with a 409-style error, and does not modify attendance rows', async () => {
    const groupId = await seedGroup();
    const studentId = await seedEligibleStudent(groupId);
    await saveAttendanceSession({ groupId, date: SATURDAY, sessionTime: '09:00', records: [{ studentId, status: 'present' }] });
    await completeAttendanceSession({ groupId, date: SATURDAY }, { userId: null });

    await expect(saveAttendanceSession({
      groupId, date: SATURDAY, sessionTime: '09:00', records: [{ studentId, status: 'absent' }],
    })).rejects.toMatchObject({ status: 409 });

    const rows = await client.attendance.findMany({ where: { group_id: groupId, date: new Date(`${SATURDAY}T00:00:00.000Z`) } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('present'); // unchanged — the rejected save wrote nothing
  });

  it('5. attendance completion works — sets status/completed_at/completed_by', async () => {
    const groupId = await seedGroup();
    const studentId = await seedEligibleStudent(groupId);
    const userId = await seedUser();
    await saveAttendanceSession({ groupId, date: SATURDAY, sessionTime: '09:00', records: [{ studentId, status: 'present' }] });

    const result = await completeAttendanceSession({ groupId, date: SATURDAY }, { userId });

    expect(result.status).toBe('completed');
    expect(result.completedAt).toBeTruthy();
    expect(result.completedBy).toBe(userId);
  });

  it('5b. completing a session with no saved attendance yet fails with a clear error', async () => {
    const groupId = await seedGroup();
    await expect(completeAttendanceSession({ groupId, date: SATURDAY }, { userId: null })).rejects.toThrow();
  });

  it('6. attendance completion is race-safe — two concurrent completions, exactly one succeeds, the other gets 409', async () => {
    const groupId = await seedGroup();
    const studentId = await seedEligibleStudent(groupId);
    const user1 = await seedUser();
    const user2 = await seedUser();
    await saveAttendanceSession({ groupId, date: SATURDAY, sessionTime: '09:00', records: [{ studentId, status: 'present' }] });

    const results = await Promise.allSettled([
      completeAttendanceSession({ groupId, date: SATURDAY }, { userId: user1 }),
      completeAttendanceSession({ groupId, date: SATURDAY }, { userId: user2 }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ status: 409 });
  });
});
