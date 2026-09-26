// backend/src/routes/attendance.integration.test.js
// C4 Attendance migration — Phase 1 backend foundation. Real PostgreSQL + Express
// integration (scratch database only), same structure as
// communicationsScopedGet.integration.test.js. Proves:
//   - GET /api/attendance is purely additive (no params → identical to the unfiltered
//     generic route boot-sync still depends on), and its 4 filters (studentId/groupId/
//     date/status) are composable and validated.
//   - GET /api/attendance/aggregate's 5 groupBy dimensions (status/group/student/weekday/
//     date) each return the shape their real frontend consumer needs (see the Attendance
//     C4 Phase 1 audit report), including studentIds batching, threshold filtering, empty
//     results, and that historical rows for a since-transferred student stay correctly
//     attributed to their original group.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

function request(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* n/a */ }
        resolve({ status: res.statusCode, body: json });
      });
    }).on('error', reject);
  });
}

describe('GET /api/attendance + /api/attendance/aggregate (real PostgreSQL + Express integration, C4 Phase 1)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, server, port;
  let seq = 0;

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  beforeAll(async () => {
    scratch = await setupScratchDb('attendance_scoped_get');
    client = scratch.client;

    const attendanceRouter = (await import('./attendance.js')).default;
    const { errorHandler } = await import('../middleware/errorHandler.js');

    const app = express();
    app.use('/api/attendance', attendanceRouter);
    app.use(errorHandler);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    port = server.address().port;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (scratch) await teardownScratchDb(scratch);
  });

  async function seedStudent(overrides = {}) {
    const id = nextId('s');
    return client.students.create({ data: { id, code: id, name: 'طالب اختبار', status: 'active', ...overrides } });
  }

  async function seedGroup(overrides = {}) {
    const id = nextId('g');
    return client.groups.create({ data: { id, name: 'مجموعة اختبار', ...overrides } });
  }

  async function seedAttendance({ studentId, groupId, date, status = 'present', sessionTime = '09:00' }) {
    return client.attendance.create({
      data: {
        id: nextId('a'),
        student_id: studentId,
        group_id: groupId,
        date: new Date(`${date}T00:00:00.000Z`),
        status,
        session_time: sessionTime,
      },
    });
  }

  // ── §A — scoped GET ──────────────────────────────────────────────────────────────────

  describe('GET /api/attendance', () => {
    it('1. no query params: returns every row, identical to the unfiltered generic route the boot-sync depends on', async () => {
      const student = await seedStudent();
      const group = await seedGroup();
      await seedAttendance({ studentId: student.id, groupId: group.id, date: '2026-01-05' });
      await seedAttendance({ studentId: student.id, groupId: group.id, date: '2026-01-06', status: 'absent' });

      const res = await request(port, '/api/attendance');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.count).toBeGreaterThanOrEqual(2);
      // date is server-side normalized to plain YYYY-MM-DD, not a full timestamp
      const row = res.body.data.find((r) => r.studentId === student.id && r.date === '2026-01-05');
      expect(row).toBeTruthy();
      expect(row.groupId).toBe(group.id);
      expect(row.sessionTime).toBe('09:00');
    });

    it('2. studentId filter: returns only that student\'s rows', async () => {
      const s1 = await seedStudent();
      const s2 = await seedStudent();
      const group = await seedGroup();
      await seedAttendance({ studentId: s1.id, groupId: group.id, date: '2026-01-05' });
      await seedAttendance({ studentId: s2.id, groupId: group.id, date: '2026-01-05' });

      const res = await request(port, `/api/attendance?studentId=${s1.id}`);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].studentId).toBe(s1.id);
    });

    it('3. groupId filter: returns only that group\'s rows', async () => {
      const student = await seedStudent();
      const g1 = await seedGroup();
      const g2 = await seedGroup();
      await seedAttendance({ studentId: student.id, groupId: g1.id, date: '2026-01-05' });
      await seedAttendance({ studentId: student.id, groupId: g2.id, date: '2026-01-06' });

      const res = await request(port, `/api/attendance?groupId=${g1.id}`);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].groupId).toBe(g1.id);
    });

    it('4. date filter: returns only that exact date\'s rows', async () => {
      // Dedicated, unused-elsewhere dates — this file's tests share one scratch DB with no
      // per-test cleanup (same convention as studentReport.integration.test.js), so an
      // unscoped date-only query must not collide with another test's seed date.
      const student = await seedStudent();
      const group = await seedGroup();
      await seedAttendance({ studentId: student.id, groupId: group.id, date: '2027-02-10' });
      await seedAttendance({ studentId: student.id, groupId: group.id, date: '2027-02-11' });

      const res = await request(port, '/api/attendance?date=2027-02-10');
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].date).toBe('2027-02-10');
    });

    it('5. status filter: returns only rows with that status', async () => {
      const student = await seedStudent();
      const group = await seedGroup();
      await seedAttendance({ studentId: student.id, groupId: group.id, date: '2026-01-05', status: 'present' });
      await seedAttendance({ studentId: student.id, groupId: group.id, date: '2026-01-06', status: 'absent' });

      const res = await request(port, `/api/attendance?studentId=${student.id}&status=absent`);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].status).toBe('absent');
    });

    it('5b. studentIds batch filter (C4 Phase 2 — StudentsPage.jsx per-row heat map): returns rows for exactly the given students, in one request', async () => {
      const s1 = await seedStudent();
      const s2 = await seedStudent();
      const s3 = await seedStudent();
      const group = await seedGroup();
      await seedAttendance({ studentId: s1.id, groupId: group.id, date: '2026-01-05' });
      await seedAttendance({ studentId: s2.id, groupId: group.id, date: '2026-01-05' });
      await seedAttendance({ studentId: s3.id, groupId: group.id, date: '2026-01-05' });

      const res = await request(port, `/api/attendance?studentIds=${s1.id},${s2.id}`);
      const studentIdsReturned = res.body.data.map((r) => r.studentId).sort();
      expect(studentIdsReturned).toEqual([s1.id, s2.id].sort());
      expect(studentIdsReturned).not.toContain(s3.id);
    });

    it('6. combined filters (studentId + groupId + status) compose with AND semantics', async () => {
      const s1 = await seedStudent();
      const s2 = await seedStudent();
      const group = await seedGroup();
      await seedAttendance({ studentId: s1.id, groupId: group.id, date: '2026-01-05', status: 'absent' });
      await seedAttendance({ studentId: s1.id, groupId: group.id, date: '2026-01-06', status: 'present' });
      await seedAttendance({ studentId: s2.id, groupId: group.id, date: '2026-01-05', status: 'absent' });

      const res = await request(port, `/api/attendance?studentId=${s1.id}&groupId=${group.id}&status=absent`);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].studentId).toBe(s1.id);
      expect(res.body.data[0].status).toBe('absent');
    });

    it('7. empty result: a student with zero attendance returns an empty array, not an error', async () => {
      const student = await seedStudent();
      const res = await request(port, `/api/attendance?studentId=${student.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.count).toBe(0);
    });

    it('8. invalid date parameter: 400, no crash', async () => {
      const res = await request(port, '/api/attendance?date=not-a-date');
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('8b. invalid status parameter: 400, no crash', async () => {
      const res = await request(port, '/api/attendance?status=maybe');
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });
  });

  // ── §B — aggregate ───────────────────────────────────────────────────────────────────

  describe('GET /api/attendance/aggregate', () => {
    it('9. groupBy=status: server-side count per status, scoped by studentId', async () => {
      const student = await seedStudent();
      const group = await seedGroup();
      await seedAttendance({ studentId: student.id, groupId: group.id, date: '2026-01-05', status: 'present' });
      await seedAttendance({ studentId: student.id, groupId: group.id, date: '2026-01-06', status: 'present' });
      await seedAttendance({ studentId: student.id, groupId: group.id, date: '2026-01-07', status: 'absent' });

      const res = await request(port, `/api/attendance/aggregate?groupBy=status&studentId=${student.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(expect.arrayContaining([
        { key: 'present', count: 2 },
        { key: 'absent', count: 1 },
      ]));
    });

    it('10. groupBy=group: per-group total/present/absent/late (getGroupAttendanceStats shape)', async () => {
      const student = await seedStudent();
      const g1 = await seedGroup();
      const g2 = await seedGroup();
      await seedAttendance({ studentId: student.id, groupId: g1.id, date: '2026-01-05', status: 'present' });
      await seedAttendance({ studentId: student.id, groupId: g1.id, date: '2026-01-06', status: 'absent' });
      await seedAttendance({ studentId: student.id, groupId: g2.id, date: '2026-01-05', status: 'present' });

      const res = await request(port, '/api/attendance/aggregate?groupBy=group');
      const g1Row = res.body.data.find((r) => r.key === g1.id);
      const g2Row = res.body.data.find((r) => r.key === g2.id);
      expect(g1Row).toEqual({ key: g1.id, total: 2, present: 1, absent: 1, late: 0 });
      expect(g2Row).toEqual({ key: g2.id, total: 1, present: 1, absent: 0, late: 0 });
    });

    it('11. groupBy=student: per-student total/present/absent/late, with threshold filtering (Frequent-Absentees shape)', async () => {
      const s1 = await seedStudent();
      const s2 = await seedStudent();
      const group = await seedGroup();
      for (let i = 1; i <= 3; i++) await seedAttendance({ studentId: s1.id, groupId: group.id, date: `2026-01-0${i}`, status: 'absent' });
      await seedAttendance({ studentId: s2.id, groupId: group.id, date: '2026-01-01', status: 'absent' });

      const noThreshold = await request(port, '/api/attendance/aggregate?groupBy=student');
      expect(noThreshold.body.data.find((r) => r.key === s1.id)).toEqual({ key: s1.id, total: 3, present: 0, absent: 3, late: 0 });
      expect(noThreshold.body.data.find((r) => r.key === s2.id)).toBeTruthy();

      const withThreshold = await request(port, '/api/attendance/aggregate?groupBy=student&threshold=2');
      expect(withThreshold.body.data.map((r) => r.key)).toContain(s1.id);
      expect(withThreshold.body.data.map((r) => r.key)).not.toContain(s2.id);
    });

    it('12. groupBy=weekday: reuses attendanceEligibility.js\'s own dayCodeOf() day-mapping, scoped by status', async () => {
      const student = await seedStudent();
      const group = await seedGroup();
      // 2026-01-03 is a Saturday, 2026-01-04 is a Sunday (UTC) — matches dayCodeOf's own
      // getUTCDay()-based mapping.
      await seedAttendance({ studentId: student.id, groupId: group.id, date: '2026-01-03', status: 'absent' });
      await seedAttendance({ studentId: student.id, groupId: group.id, date: '2026-01-04', status: 'absent' });
      await seedAttendance({ studentId: student.id, groupId: group.id, date: '2026-01-05', status: 'present' });

      const res = await request(port, `/api/attendance/aggregate?groupBy=weekday&status=absent&studentId=${student.id}`);
      const satRow = res.body.data.find((r) => r.key === 'sat');
      const sunRow = res.body.data.find((r) => r.key === 'sun');
      expect(satRow.count).toBe(1);
      expect(sunRow.count).toBe(1);
      // present-status row must never leak into an absent-scoped weekday aggregate
      expect(res.body.data.reduce((s, r) => s + r.count, 0)).toBe(2);
    });

    it('13. groupBy=date: per-date total/present/absent/late (daily-trend shape), narrowed by from/to', async () => {
      // Dedicated, unused-elsewhere date range — see test 4's comment on why.
      const student = await seedStudent();
      const group = await seedGroup();
      await seedAttendance({ studentId: student.id, groupId: group.id, date: '2027-03-31', status: 'present' });
      await seedAttendance({ studentId: student.id, groupId: group.id, date: '2027-04-05', status: 'present' });
      await seedAttendance({ studentId: student.id, groupId: group.id, date: '2027-04-06', status: 'absent' });

      const res = await request(port, '/api/attendance/aggregate?groupBy=date&from=2027-04-01&to=2027-04-30');
      expect(res.body.data.map((r) => r.key)).not.toContain('2027-03-31');
      expect(res.body.data.find((r) => r.key === '2027-04-05')).toEqual({ key: '2027-04-05', total: 1, present: 1, absent: 0, late: 0 });
      expect(res.body.data.find((r) => r.key === '2027-04-06')).toEqual({ key: '2027-04-06', total: 1, present: 0, absent: 1, late: 0 });
    });

    it('14. studentIds batch aggregation: groupBy=student scoped to an explicit id list (StudentsPage/Dashboard batch shape)', async () => {
      const s1 = await seedStudent();
      const s2 = await seedStudent();
      const s3 = await seedStudent();
      const group = await seedGroup();
      await seedAttendance({ studentId: s1.id, groupId: group.id, date: '2026-01-05', status: 'present' });
      await seedAttendance({ studentId: s2.id, groupId: group.id, date: '2026-01-05', status: 'absent' });
      await seedAttendance({ studentId: s3.id, groupId: group.id, date: '2026-01-05', status: 'present' });

      const res = await request(port, `/api/attendance/aggregate?groupBy=student&studentIds=${s1.id},${s2.id}`);
      const keys = res.body.data.map((r) => r.key).sort();
      expect(keys).toEqual([s1.id, s2.id].sort());
      expect(keys).not.toContain(s3.id);
    });

    it('15. historical/transferred-student behavior: a student\'s attendance under a PRIOR group stays correctly attributed to that old group, unaffected by their current group assignment', async () => {
      const oldGroup = await seedGroup();
      const newGroup = await seedGroup();
      const student = await seedStudent({ group_id: newGroup.id }); // currently enrolled in newGroup
      // historical rows recorded while the student was still in oldGroup
      await seedAttendance({ studentId: student.id, groupId: oldGroup.id, date: '2025-09-01', status: 'present' });
      await seedAttendance({ studentId: student.id, groupId: oldGroup.id, date: '2025-09-08', status: 'absent' });
      // a row recorded after the transfer, under the new group
      await seedAttendance({ studentId: student.id, groupId: newGroup.id, date: '2026-01-05', status: 'present' });

      const oldGroupAgg = await request(port, `/api/attendance/aggregate?groupBy=group&studentId=${student.id}`);
      const oldRow = oldGroupAgg.body.data.find((r) => r.key === oldGroup.id);
      const newRow = oldGroupAgg.body.data.find((r) => r.key === newGroup.id);
      expect(oldRow).toEqual({ key: oldGroup.id, total: 2, present: 1, absent: 1, late: 0 });
      expect(newRow).toEqual({ key: newGroup.id, total: 1, present: 1, absent: 0, late: 0 });

      // the scoped list GET must show the same fidelity — old rows still carry oldGroup.id
      const listRes = await request(port, `/api/attendance?groupId=${oldGroup.id}`);
      expect(listRes.body.data).toHaveLength(2);
      expect(listRes.body.data.every((r) => r.studentId === student.id)).toBe(true);
    });

    it('16. empty aggregate results: an unmatched filter returns an empty array, not an error, for every dimension', async () => {
      const student = await seedStudent();
      for (const groupBy of ['status', 'group', 'student', 'weekday', 'date']) {
        const res = await request(port, `/api/attendance/aggregate?groupBy=${groupBy}&studentId=${student.id}`);
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
      }
    });

    it('17. invalid groupBy: 400, no crash', async () => {
      const res = await request(port, '/api/attendance/aggregate?groupBy=not-a-real-dimension');
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('17b. missing groupBy: 400, no crash', async () => {
      const res = await request(port, '/api/attendance/aggregate');
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('17c. invalid threshold: 400, no crash', async () => {
      const res = await request(port, '/api/attendance/aggregate?groupBy=student&threshold=-1');
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });
  });
});
