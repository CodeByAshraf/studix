// backend/src/routes/attendanceSessions.checkIn.integration.test.js
// P1-2 (QR attendance persistence) — checkInStudent / POST /:groupId/:date/check-in records ONE
// student's attendance in PostgreSQL under the same rules as saveAttendanceSession (session
// row lock, completed-session rejection, enrollment eligibility), never overwrites an existing
// row (409 ATTENDANCE_EXISTS) and never touches other students' rows.
//
// Real PostgreSQL integration (scratch database), same pattern as
// attendanceSessions.integration.test.js: router.handle() invoked directly.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { applyFullSchemaDDL } from '../test-helpers/scratchDbFullSchema.js';

const dbCheck = await checkPostgresReachable();

describe('routes/attendanceSessions.js — QR check-in (real PostgreSQL, P1-2)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client;
  let attendanceSessionsRouter, checkInStudent, saveAttendanceSession, completeAttendanceSession;
  let setPrimaryGroup;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('attendance_sessions_checkin');
    client = scratch.client;
    await applyFullSchemaDDL(client);
    ({
      default: attendanceSessionsRouter, checkInStudent, saveAttendanceSession, completeAttendanceSession,
    } = await import('./attendanceSessions.js'));
    ({ setPrimaryGroup } = await import('../lib/enrollmentService.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  async function seedGroup({ days = ['sat'] } = {}) {
    const id = nextId('g');
    await client.groups.create({ data: { id, name: 'مجموعة', price: 100, days } });
    return id;
  }

  async function seedEnrolledStudent(groupId) {
    const id = nextId('s');
    await client.students.create({ data: { id, name: 'طالب', code: nextId('code') } });
    await setPrimaryGroup(id, groupId, { effectiveDate: '2026-01-01' });
    return id;
  }

  function callRoute({ method, url, body }) {
    return new Promise((resolve, reject) => {
      const req = { method, url, headers: {}, body };
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json(b) { resolve({ statusCode: this.statusCode, body: b }); return this; },
      };
      attendanceSessionsRouter.handle(req, res, (err) => (err ? reject(err) : reject(new Error('no route matched'))));
    });
  }

  const rowsFor = (groupId) => client.attendance.findMany({ where: { group_id: groupId, date: new Date(`${SATURDAY}T00:00:00.000Z`) } });

  // 2026-01-03 is a Saturday, 2026-01-06 is a Tuesday (UTC).
  const SATURDAY = '2026-01-03';
  const TUESDAY = '2026-01-06';

  it('creates a real attendance row (and its session) in PostgreSQL', async () => {
    const groupId = await seedGroup();
    const studentId = await seedEnrolledStudent(groupId);

    const record = await checkInStudent({ groupId, date: SATURDAY, studentId, status: 'present', sessionTime: '10:30' });

    expect(record).toMatchObject({ studentId, groupId, date: SATURDAY, status: 'present', sessionTime: '10:30' });
    const rows = await rowsFor(groupId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: record.id, student_id: studentId, status: 'present' });
    const session = await client.attendance_sessions.findUnique({
      where: { group_id_date: { group_id: groupId, date: new Date(`${SATURDAY}T00:00:00.000Z`) } },
    });
    expect(session).toMatchObject({ status: 'draft' });
  });

  it('POST /:groupId/:date/check-in answers 201 with the persisted record', async () => {
    const groupId = await seedGroup();
    const studentId = await seedEnrolledStudent(groupId);

    const result = await callRoute({ method: 'POST', url: `/${groupId}/${SATURDAY}/check-in`, body: { studentId, status: 'late' } });

    expect(result.statusCode).toBe(201);
    expect(result.body.ok).toBe(true);
    expect(result.body.data).toMatchObject({ studentId, groupId, date: SATURDAY, status: 'late' });
    expect(await rowsFor(groupId)).toHaveLength(1);
  });

  it('a duplicate scan is rejected with 409 ATTENDANCE_EXISTS and never overwrites the existing row', async () => {
    const groupId = await seedGroup();
    const studentId = await seedEnrolledStudent(groupId);
    await checkInStudent({ groupId, date: SATURDAY, studentId, status: 'present' });

    const result = await callRoute({ method: 'POST', url: `/${groupId}/${SATURDAY}/check-in`, body: { studentId, status: 'late' } });

    expect(result.statusCode).toBe(409);
    expect(result.body).toMatchObject({ ok: false, code: 'ATTENDANCE_EXISTS' });
    const rows = await rowsFor(groupId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('present');
  });

  it('a completed (locked) session is rejected and nothing is written', async () => {
    const groupId = await seedGroup();
    const marked = await seedEnrolledStudent(groupId);
    const late = await seedEnrolledStudent(groupId);
    await saveAttendanceSession({ groupId, date: SATURDAY, records: [{ studentId: marked, status: 'present' }] });
    await completeAttendanceSession({ groupId, date: SATURDAY });

    await expect(checkInStudent({ groupId, date: SATURDAY, studentId: late, status: 'present' }))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining('مكتملة') });
    const rows = await rowsFor(groupId);
    expect(rows.map((r) => r.student_id)).toEqual([marked]);
  });

  it('an ineligible student (not enrolled / wrong day) is rejected and nothing is written', async () => {
    const groupId = await seedGroup({ days: ['sat'] });
    const enrolled = await seedEnrolledStudent(groupId);
    const stranger = nextId('s');
    await client.students.create({ data: { id: stranger, name: 'طالب', code: nextId('code') } });

    await expect(checkInStudent({ groupId, date: SATURDAY, studentId: stranger, status: 'present' }))
      .rejects.toMatchObject({ status: 400 });
    await expect(checkInStudent({ groupId, date: TUESDAY, studentId: enrolled, status: 'present' }))
      .rejects.toMatchObject({ status: 400 });
    expect(await client.attendance.count({ where: { group_id: groupId } })).toBe(0);
  });

  it('never touches other students\' rows already saved for the same session', async () => {
    const groupId = await seedGroup();
    const a = await seedEnrolledStudent(groupId);
    const b = await seedEnrolledStudent(groupId);
    const c = await seedEnrolledStudent(groupId);
    await saveAttendanceSession({ groupId, date: SATURDAY, records: [{ studentId: a, status: 'absent' }, { studentId: b, status: 'present' }] });

    await checkInStudent({ groupId, date: SATURDAY, studentId: c, status: 'present' });

    const byStudent = Object.fromEntries((await rowsFor(groupId)).map((r) => [r.student_id, r.status]));
    expect(byStudent).toEqual({ [a]: 'absent', [b]: 'present', [c]: 'present' });
  });

  it('rejects invalid input before any write', async () => {
    const groupId = await seedGroup();
    const studentId = await seedEnrolledStudent(groupId);
    await expect(checkInStudent({ groupId, date: SATURDAY, studentId, status: 'excused' })).rejects.toMatchObject({ status: 400 });
    await expect(checkInStudent({ groupId, date: '03-01-2026', studentId, status: 'present' })).rejects.toMatchObject({ status: 400 });
    await expect(checkInStudent({ groupId: 'missing-group', date: SATURDAY, studentId, status: 'present' })).rejects.toMatchObject({ status: 400 });
    expect(await client.attendance.count({ where: { group_id: groupId } })).toBe(0);
  });

  it('concurrent scans of the SAME student produce exactly one row; the other is a duplicate', async () => {
    const groupId = await seedGroup();
    const studentId = await seedEnrolledStudent(groupId);

    const results = await Promise.allSettled([
      checkInStudent({ groupId, date: SATURDAY, studentId, status: 'present' }),
      checkInStudent({ groupId, date: SATURDAY, studentId, status: 'present' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe('ATTENDANCE_EXISTS');
    expect(await rowsFor(groupId)).toHaveLength(1);
  });

  it('concurrent first scans of DIFFERENT students on a new session both persist (race-free session creation)', async () => {
    const groupId = await seedGroup();
    const a = await seedEnrolledStudent(groupId);
    const b = await seedEnrolledStudent(groupId);

    const results = await Promise.allSettled([
      checkInStudent({ groupId, date: SATURDAY, studentId: a, status: 'present' }),
      checkInStudent({ groupId, date: SATURDAY, studentId: b, status: 'present' }),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect((await rowsFor(groupId)).map((r) => r.student_id).sort()).toEqual([a, b].sort());
    expect(await client.attendance_sessions.count({ where: { group_id: groupId } })).toBe(1);
  });
});
