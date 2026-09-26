// backend/src/routes/attendanceSessions.integration.test.js
// Group Closure (Attendance Integration) — the attendance-sessions route now: (1) exposes
// GET /:groupId/:date/roster, the eligible-student-id list for that group/date, reusing
// attendanceEligibility.js (no duplicated logic here); (2) validates every record's
// studentId against that same eligibility check before persisting a session, rejecting the
// whole save (atomic, matches saveAttendanceSession's existing all-or-nothing transaction)
// if any student is ineligible.
//
// Real PostgreSQL integration (scratch database), same pattern as
// attendanceEligibility.integration.test.js / crud.studentsGroupId.integration.test.js:
// router.handle() invoked directly, no supertest dependency anywhere in this codebase.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { applyFullSchemaDDL } from '../test-helpers/scratchDbFullSchema.js';

const dbCheck = await checkPostgresReachable();

describe('routes/attendanceSessions.js — eligibility integration (real PostgreSQL)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client;
  let attendanceSessionsRouter, saveAttendanceSession;
  let setPrimaryGroup, addAdditionalEnrollment;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('attendance_sessions_eligibility');
    client = scratch.client;
    await applyFullSchemaDDL(client);
    ({ default: attendanceSessionsRouter, saveAttendanceSession } = await import('./attendanceSessions.js'));
    ({ setPrimaryGroup, addAdditionalEnrollment } = await import('../lib/enrollmentService.js'));
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

  // 2026-01-03 is a Saturday, 2026-01-06 is a Tuesday (UTC).
  const SATURDAY = '2026-01-03';
  const TUESDAY = '2026-01-06';

  // ── GET /:groupId/:date/roster ─────────────────────────────────────────────────────
  it('GET roster returns the eligible student ids for that group/date (Primary + Additional both included)', async () => {
    const groupId = await seedGroup({ days: ['sat'] });
    const primaryStudent = await seedStudent();
    const additionalStudent = await seedStudent();
    await setPrimaryGroup(primaryStudent, groupId, { effectiveDate: '2026-01-01' });
    await addAdditionalEnrollment(additionalStudent, groupId, { effectiveDate: '2026-01-01', attendDays: ['sat'] });
    const ineligibleStudent = await seedStudent(); // never enrolled

    const result = await callRoute(attendanceSessionsRouter, { method: 'GET', url: `/${groupId}/${SATURDAY}/roster` });

    expect(result.body.ok).toBe(true);
    expect(result.body.data).toContain(primaryStudent);
    expect(result.body.data).toContain(additionalStudent);
    expect(result.body.data).not.toContain(ineligibleStudent);
  });

  it('GET roster excludes a student whose attend_days does not include that date\'s day', async () => {
    const groupId = await seedGroup({ days: ['sat', 'tue'] });
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupId, { effectiveDate: '2026-01-01' });
    await client.student_group_enrollments.updateMany({
      where: { student_id: studentId, group_id: groupId },
      data: { attend_days: ['sat'] },
    });

    const saturdayResult = await callRoute(attendanceSessionsRouter, { method: 'GET', url: `/${groupId}/${SATURDAY}/roster` });
    const tuesdayResult = await callRoute(attendanceSessionsRouter, { method: 'GET', url: `/${groupId}/${TUESDAY}/roster` });

    expect(saturdayResult.body.data).toContain(studentId);
    expect(tuesdayResult.body.data).not.toContain(studentId);
  });

  // ── saveAttendanceSession — eligibility validation ─────────────────────────────────
  it('saveAttendanceSession succeeds for an eligible Primary-enrolled student (regression)', async () => {
    const groupId = await seedGroup({ days: ['sat'] });
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupId, { effectiveDate: '2026-01-01' });

    const result = await saveAttendanceSession({
      groupId, date: SATURDAY, sessionTime: '09:00', records: [{ studentId, status: 'present' }],
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].studentId).toBe(studentId);
  });

  it('saveAttendanceSession succeeds for an eligible Additional-enrolled student (not the Primary Group)', async () => {
    const primaryGroup = await seedGroup({ name: 'Primary', days: ['sun'] });
    const additionalGroup = await seedGroup({ name: 'Additional', days: ['sat'] });
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, primaryGroup, { effectiveDate: '2026-01-01' });
    await addAdditionalEnrollment(studentId, additionalGroup, { effectiveDate: '2026-01-01' });

    const result = await saveAttendanceSession({
      groupId: additionalGroup, date: SATURDAY, sessionTime: '09:00', records: [{ studentId, status: 'present' }],
    });

    expect(result.records).toHaveLength(1);
  });

  it('saveAttendanceSession rejects a student with no active enrollment in that group, and persists nothing', async () => {
    const groupId = await seedGroup({ days: ['sat'] });
    const ineligibleStudent = await seedStudent(); // never enrolled anywhere

    await expect(saveAttendanceSession({
      groupId, date: SATURDAY, sessionTime: '09:00', records: [{ studentId: ineligibleStudent, status: 'present' }],
    })).rejects.toThrow();

    const rows = await client.attendance.findMany({ where: { group_id: groupId } });
    expect(rows).toHaveLength(0);
  });

  it('saveAttendanceSession rejects a student whose attend_days excludes that date, even though they are Primary-enrolled in the group', async () => {
    const groupId = await seedGroup({ days: ['sat', 'tue'] });
    const studentId = await seedStudent();
    await setPrimaryGroup(studentId, groupId, { effectiveDate: '2026-01-01' });
    await client.student_group_enrollments.updateMany({
      where: { student_id: studentId, group_id: groupId },
      data: { attend_days: ['sat'] },
    });

    await expect(saveAttendanceSession({
      groupId, date: TUESDAY, sessionTime: '09:00', records: [{ studentId, status: 'present' }],
    })).rejects.toThrow();
  });

  it('saveAttendanceSession rejects the WHOLE session (atomic) when one of several students is ineligible', async () => {
    const groupId = await seedGroup({ days: ['sat'] });
    const eligibleStudent = await seedStudent();
    const ineligibleStudent = await seedStudent();
    await setPrimaryGroup(eligibleStudent, groupId, { effectiveDate: '2026-01-01' });

    await expect(saveAttendanceSession({
      groupId, date: SATURDAY, sessionTime: '09:00',
      records: [
        { studentId: eligibleStudent, status: 'present' },
        { studentId: ineligibleStudent, status: 'present' },
      ],
    })).rejects.toThrow();

    const rows = await client.attendance.findMany({ where: { group_id: groupId } });
    expect(rows).toHaveLength(0); // eligible student's record was NOT partially saved either
  });
});
