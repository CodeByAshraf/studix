// backend/src/routes/groupOptions.integration.test.js
// M2 (Group Options) — GET /api/groups/options lets admissions/attendance users pick a group
// without full Groups access. Real PostgreSQL + Express with every /api/groups mount in
// server.js's order: the options route first, then the group-delete guard and the generic
// CRUD router, both behind requirePermission('groups') (the mount ORDER in server.js itself is
// pinned by crudPolicies.test.js). requireAuth is stubbed by a test header; every
// authorization decision under test is the real one.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED" test is
// recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

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

describe('GET /api/groups/options — scoped group picker for admissions/attendance (M2 Group Options, real Express + PostgreSQL)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, server, port, invalidateUser;
  let seq = 0;
  const nextId = (prefix) => { seq += 1; return `${prefix}_${seq}_${Date.now()}`; };
  const DAY = new Date('2026-01-05T00:00:00.000Z');

  beforeAll(async () => {
    scratch = await setupScratchDb('group_options');
    client = scratch.client;

    const { requirePermission, requireAnyPermission } = await import('../middleware/permissions.js');
    const { errorHandler } = await import('../middleware/errorHandler.js');
    const { makeCrudRouter } = await import('./crud.js');
    const groupOptionsModule = await import('./groupOptions.js');
    const groupDeleteRouter = (await import('./groupDelete.js')).default;
    ({ invalidateUser } = await import('../lib/authCache.js'));

    function stubAuth(req, res, next) {
      const raw = req.headers['x-test-user'];
      req.user = raw ? JSON.parse(raw) : undefined;
      next();
    }

    // Same guards, same order as server.js.
    const app = express();
    app.use(express.json());
    app.use('/api/groups/options', stubAuth,
      requireAnyPermission(...groupOptionsModule.GROUP_OPTION_PERMISSIONS), groupOptionsModule.default);
    app.use('/api/groups', stubAuth, requirePermission('groups'), groupDeleteRouter);
    app.use('/api/groups', stubAuth, requirePermission('groups'), makeCrudRouter('groups', { writable: true, preserveClientId: true }));
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
  const seedGroup = (extra = {}) => client.groups.create({
    data: { id: nextId('g'), name: 'مجموعة اختبار', grade: 'الصف الأول الثانوي', max: 20, price: 300, teacher_name: 'مدرس', color: '#000', ...extra },
  });
  const seedStudent = (extra = {}) => {
    const id = nextId('s');
    return client.students.create({ data: { id, code: id, name: 'طالب سري', status: 'active', phone: '01011112222', parent_phone: '01033334444', ...extra } });
  };
  const enroll = (studentId, groupId, { role = 'primary', status = 'active' } = {}) => client.student_group_enrollments.create({
    data: { id: nextId('en'), student_id: studentId, group_id: groupId, role, status, start_date: DAY },
  });
  const options = (user) => request(port, 'GET', '/api/groups/options', { user });

  // ── permissions ──
  it.each([['groups'], ['admissions'], ['attendance']])('a user with only "%s" gets 200', async (permission) => {
    const g = await seedGroup();
    const res = await options(await seedUser([permission]));
    expect(res.status).toBe(200);
    expect(res.body.data.map((o) => o.id)).toContain(g.id);
  });

  it('a user with none of groups/admissions/attendance gets 403 (even with students, exams, homework, payments)', async () => {
    expect((await options(await seedUser(['students', 'exams', 'homework', 'payments', 'materials']))).status).toBe(403);
  });

  it('logged out, deactivated or stale session -> 401 (existing session/version checks)', async () => {
    expect((await request(port, 'GET', '/api/groups/options')).status).toBe(401);

    const deactivated = await seedUser(['admissions']);
    await client.users.update({ where: { id: deactivated.id }, data: { active: false } });
    invalidateUser(deactivated.id);
    expect((await options(deactivated)).status).toBe(401);

    const stale = await seedUser(['attendance']);
    await client.users.update({ where: { id: stale.id }, data: { permissions: ['attendance', 'students'], auth_version: { increment: 1 } } });
    invalidateUser(stale.id);
    expect((await options(stale)).status).toBe(401);
  });

  // ── response shape / privacy ──
  it('returns exactly id, name, grade, max, price, activeCount — no students, phones, teacher or other group fields', async () => {
    const g = await seedGroup({ name: 'مجموعة الشكل', max: 12, price: 450 });
    await enroll((await seedStudent()).id, g.id);
    const res = await options(await seedUser(['admissions']));
    const row = res.body.data.find((o) => o.id === g.id);
    expect(row).toEqual({ id: g.id, name: 'مجموعة الشكل', grade: 'الصف الأول الثانوي', max: 12, price: 450, activeCount: 1 });
    for (const r of res.body.data) {
      expect(Object.keys(r).sort()).toEqual(['activeCount', 'grade', 'id', 'max', 'name', 'price']);
    }
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('طالب سري');
    expect(raw).not.toContain('01011112222');
    expect(raw).not.toContain('01033334444');
    expect(raw).not.toContain('مدرس');
  });

  // ── activeCount = active enrollments (Primary + Additional) of active students ──
  it('activeCount counts distinct active students with an active Primary or Additional enrollment, and nothing else', async () => {
    const g = await seedGroup();
    const other = await seedGroup();
    await enroll((await seedStudent()).id, g.id, { role: 'primary' });             // counted
    await enroll((await seedStudent()).id, g.id, { role: 'additional' });          // counted
    await enroll((await seedStudent({ status: 'inactive' })).id, g.id);            // inactive student
    await enroll((await seedStudent()).id, g.id, { status: 'withdrawn' });         // ended enrollment
    await enroll((await seedStudent()).id, other.id);                              // other group
    await seedStudent({ group_id: g.id });                                         // no enrollment row
    const multi = await seedStudent();                                             // in both groups
    await enroll(multi.id, g.id, { role: 'additional' });
    await enroll(multi.id, other.id, { role: 'primary' });

    const res = await options(await seedUser(['attendance']));
    expect(res.body.data.find((o) => o.id === g.id).activeCount).toBe(3);
    expect(res.body.data.find((o) => o.id === other.id).activeCount).toBe(2);
    const empty = await seedGroup();
    expect((await options(await seedUser(['groups']))).body.data.find((o) => o.id === empty.id).activeCount).toBe(0);
  });

  // ── route ordering + group CRUD/delete unchanged ──
  it('options is reachable before the groups guard, while everything else under /api/groups stays groups-only', async () => {
    const g = await seedGroup();
    for (const permission of ['admissions', 'attendance']) {
      const user = await seedUser([permission]);
      expect((await options(user)).status).toBe(200);
      const attempts = [
        ['GET', '/api/groups', undefined],
        ['GET', `/api/groups/${g.id}`, undefined],
        ['POST', '/api/groups', { id: nextId('g'), name: 'جديدة' }],
        ['PUT', `/api/groups/${g.id}`, { name: 'تعديل' }],
        ['DELETE', `/api/groups/${g.id}`, undefined],
        ['POST', '/api/groups/options', { name: 'x' }], // non-GET falls through to the groups guard
      ];
      for (const [method, urlPath, body] of attempts) {
        const res = await request(port, method, urlPath, { user, body });
        expect(res.status, `${permission}: ${method} ${urlPath}`).toBe(403);
      }
    }
    expect(await client.groups.findUnique({ where: { id: g.id } })).not.toBeNull();
  });

  it('a groups user keeps full Groups behavior: full records, create, and delete with the F3 related-record guard', async () => {
    const user = await seedUser(['groups']);
    const g = await seedGroup();
    const list = await request(port, 'GET', '/api/groups', { user });
    expect(list.status).toBe(200);
    expect(list.body.data.find((x) => x.id === g.id).teacherName).toBe('مدرس'); // full record, unchanged

    const created = await request(port, 'POST', '/api/groups', { user, body: { id: nextId('g'), name: 'مجموعة جديدة' } });
    expect(created.status).toBe(201);

    await enroll((await seedStudent()).id, g.id);
    const blocked = await request(port, 'DELETE', `/api/groups/${g.id}`, { user });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('GROUP_HAS_RELATED_RECORDS');

    const empty = await seedGroup();
    expect((await request(port, 'DELETE', `/api/groups/${empty.id}`, { user })).status).toBe(200);
  });
});
