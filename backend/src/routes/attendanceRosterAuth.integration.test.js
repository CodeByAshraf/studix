// backend/src/routes/attendanceRosterAuth.integration.test.js
// M2 (Attendance roster) — GET /api/attendance-sessions/:groupId/:date/roster returns
// { id, name, code } entries, so an 'attendance'-only user (who cannot read the students
// collection) can see and mark a session's students. Real PostgreSQL (full migration DDL, as
// attendanceSessions.integration.test.js) + Express with the chain server.js mounts
// (requireAuth stand-in + requirePermission('attendance') + the real router), driven with real
// HTTP. Proves:
//   - attendance-only: exactly { id, name, code } per eligible student, no phone/parent/
//     status/group/financial data; the session can be saved for those students;
//   - 'students' is not required; without 'attendance' -> 403; 401 for logged-out/deactivated/stale;
//   - a full-access user gets the identical roster;
//   - eligibility unchanged (Primary + Additional, attend_days); ?active=true drops inactive
//     students (the marking screen's rule), the default keeps every eligible student.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED" test is
// recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { applyFullSchemaDDL } from '../test-helpers/scratchDbFullSchema.js';

const dbCheck = await checkPostgresReachable();

function request(port, method, urlPath, { user, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (user) headers['x-test-user'] = JSON.stringify(user);
    if (payload) headers['content-type'] = 'application/json';
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* n/a */ }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('attendance roster — scoped { id, name, code } for attendance-only marking (M2, real Express + PostgreSQL)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, server, port, invalidateUser, setPrimaryGroup, addAdditionalEnrollment;
  let seq = 0;
  const nextId = (prefix) => { seq += 1; return `${prefix}_${seq}_${Date.now()}`; };
  const SATURDAY = '2026-01-03';
  const TUESDAY = '2026-01-06';

  beforeAll(async () => {
    scratch = await setupScratchDb('attendance_roster_auth');
    client = scratch.client;
    await applyFullSchemaDDL(client);

    const { requirePermission } = await import('../middleware/permissions.js');
    const { errorHandler } = await import('../middleware/errorHandler.js');
    const attendanceSessionsRouter = (await import('./attendanceSessions.js')).default;
    ({ setPrimaryGroup, addAdditionalEnrollment } = await import('../lib/enrollmentService.js'));
    ({ invalidateUser } = await import('../lib/authCache.js'));

    function stubAuth(req, res, next) {
      const raw = req.headers['x-test-user'];
      req.user = raw ? JSON.parse(raw) : undefined;
      next();
    }

    const app = express();
    app.use(express.json());
    app.use('/api/attendance-sessions', stubAuth, requirePermission('attendance'), attendanceSessionsRouter);
    app.use(errorHandler);

    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    port = server.address().port;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (scratch) await teardownScratchDb(scratch);
  });

  async function seedUser(permissions) {
    const user = await client.users.create({ data: { id: nextId('u'), name: 'مستخدم اختبار', active: true, permissions } });
    return { id: user.id, userAuthVersion: user.auth_version, roleAuthVersion: null };
  }
  async function seedGroup(days = ['sat']) {
    const id = nextId('g');
    await client.groups.create({ data: { id, name: 'مجموعة', price: 100, days } });
    return id;
  }
  async function seedStudent(extra = {}) {
    const id = nextId('s');
    const code = nextId('C');
    await client.students.create({
      data: { id, code, name: `طالب ${id}`, status: 'active', phone: '01011112222', parent_phone: '01033334444', grade: 'الأول', ...extra },
    });
    return { id, code, name: `طالب ${id}` };
  }
  // A group with one Primary and one Additional member (both eligible on Saturday) and one
  // never-enrolled student.
  async function seedRosterGroup() {
    const groupId = await seedGroup(['sat']);
    const primary = await seedStudent();
    const additional = await seedStudent();
    const outsider = await seedStudent();
    await setPrimaryGroup(primary.id, groupId, { effectiveDate: '2026-01-01' });
    await addAdditionalEnrollment(additional.id, groupId, { effectiveDate: '2026-01-01', attendDays: ['sat'] });
    return { groupId, primary, additional, outsider };
  }
  const roster = (user, groupId, date, query = '?active=true') =>
    request(port, 'GET', `/api/attendance-sessions/${groupId}/${date}/roster${query}`, { user });
  const sortById = (rows) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

  it('1+2+4+5. an attendance-only user gets exactly { id, name, code } for the eligible students — no phone/parent/other fields, no students permission', async () => {
    const { groupId, primary, additional, outsider } = await seedRosterGroup();
    const res = await roster(await seedUser(['attendance']), groupId, SATURDAY);
    expect(res.status).toBe(200);
    expect(sortById(res.body.data)).toEqual(sortById([primary, additional]));
    for (const entry of res.body.data) expect(Object.keys(entry).sort()).toEqual(['code', 'id', 'name']);
    expect(res.body.data.map((s) => s.id)).not.toContain(outsider.id);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('01011112222');
    expect(raw).not.toContain('01033334444');
  });

  it('3. the attendance-only user saves the session for those students', async () => {
    const { groupId, primary, additional } = await seedRosterGroup();
    const user = await seedUser(['attendance']);
    const entries = (await roster(user, groupId, SATURDAY)).body.data;

    const res = await request(port, 'PUT', `/api/attendance-sessions/${groupId}/${SATURDAY}`, {
      user,
      body: { sessionTime: '09:00', records: entries.map((s, i) => ({ studentId: s.id, status: i === 0 ? 'present' : 'absent' })) },
    });
    expect(res.status).toBe(200);
    const saved = await client.attendance.findMany({ where: { group_id: groupId } });
    expect(saved.map((r) => r.student_id).sort()).toEqual([primary.id, additional.id].sort());
  });

  it('5. without attendance (even with students + groups) -> 403; 7. logged out / deactivated / stale -> 401', async () => {
    const { groupId } = await seedRosterGroup();
    expect((await roster(await seedUser(['students', 'groups']), groupId, SATURDAY)).status).toBe(403);
    expect((await roster(undefined, groupId, SATURDAY)).status).toBe(401);

    const deactivated = await seedUser(['attendance']);
    await client.users.update({ where: { id: deactivated.id }, data: { active: false } });
    invalidateUser(deactivated.id);
    expect((await roster(deactivated, groupId, SATURDAY)).status).toBe(401);

    const stale = await seedUser(['attendance']);
    await client.users.update({ where: { id: stale.id }, data: { permissions: ['attendance', 'groups'], auth_version: { increment: 1 } } });
    invalidateUser(stale.id);
    expect((await roster(stale, groupId, SATURDAY)).status).toBe(401);
  });

  it('6. a full-access user gets the identical roster', async () => {
    const { groupId } = await seedRosterGroup();
    const limited = await roster(await seedUser(['attendance']), groupId, SATURDAY);
    const full = await roster(await seedUser(['attendance', 'students', 'groups', 'payments', 'exams']), groupId, SATURDAY);
    expect(full.status).toBe(200);
    expect(sortById(full.body.data)).toEqual(sortById(limited.body.data));
  });

  it('8. eligibility unchanged: attend_days still applies; ?active=true drops an inactive student, the default keeps every eligible student', async () => {
    const { groupId, primary, additional } = await seedRosterGroup();
    const user = await seedUser(['attendance']);

    // Tuesday is not a meeting day for this group's enrollments -> nobody eligible
    expect((await roster(user, groupId, TUESDAY)).body.data).toEqual([]);

    await client.students.update({ where: { id: additional.id }, data: { status: 'inactive' } });
    const active = await roster(user, groupId, SATURDAY);
    expect(active.body.data.map((s) => s.id)).toEqual([primary.id]);
    const all = await roster(user, groupId, SATURDAY, '');
    expect(all.body.data.map((s) => s.id).sort()).toEqual([primary.id, additional.id].sort());
    for (const entry of all.body.data) expect(Object.keys(entry).sort()).toEqual(['code', 'id', 'name']);
  });
});
