// backend/src/routes/teachers.integration.test.js
// M-04 — teacher records live in PostgreSQL (the `teachers` table, served by the generic CRUD at
// /api/teachers under the 'users' permission, exactly as server.js mounts it), and the
// teacher-account link is users.teacher_id, written through /api/users POST/PUT `teacherId`.
// Real Express + real PostgreSQL (scratch database only), real requirePermission; the session is
// stubbed through a header the same way deleteRelatedRecords.integration.test.js does.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('teachers — server-backed records and the users.teacher_id link (M-04, real Express + PostgreSQL)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, server, port;
  let seq = 0;
  const nextId = (prefix) => { seq += 1; return `${prefix}_${seq}_${Date.now()}`; };

  beforeAll(async () => {
    scratch = await setupScratchDb('teachers_m04');
    client = scratch.client;

    const { requirePermission } = await import('../middleware/permissions.js');
    const { errorHandler } = await import('../middleware/errorHandler.js');
    const { makeCrudRouter } = await import('./crud.js');
    const usersRouter = (await import('./users.js')).default;

    function stubAuth(req, res, next) {
      const raw = req.headers['x-test-user'];
      req.user = raw ? JSON.parse(raw) : undefined;
      next();
    }

    const app = express();
    app.use(express.json());
    app.use('/api/users', stubAuth, requirePermission('users'), usersRouter);
    app.use('/api/teachers', stubAuth, requirePermission('users'), makeCrudRouter('teachers', { writable: true }));
    app.use(errorHandler);

    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    port = server.address().port;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (scratch) await teardownScratchDb(scratch);
  });

  function request(method, urlPath, { user, body } = {}) {
    return new Promise((resolve, reject) => {
      const headers = { 'Content-Type': 'application/json' };
      if (user) headers['x-test-user'] = JSON.stringify(user);
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
      req.end(body ? JSON.stringify(body) : undefined);
    });
  }

  async function seedUser(permissions) {
    const user = await client.users.create({ data: { id: nextId('u'), name: 'مستخدم اختبار', active: true, permissions } });
    return { id: user.id, userAuthVersion: user.auth_version, roleAuthVersion: null };
  }
  const seedTeacher = (data = {}) => client.teachers.create({ data: { name: 'مدرس اختبار', phone: '01000000000', subject: 'رياضيات', ...data } });

  describe('authorization', () => {
    it('no session -> 401; a session without the users permission -> 403; nothing is written', async () => {
      const before = await client.teachers.count();
      expect((await request('GET', '/api/teachers')).status).toBe(401);
      const noUsers = await seedUser(['students', 'payments']);
      expect((await request('GET', '/api/teachers', { user: noUsers })).status).toBe(403);
      expect((await request('POST', '/api/teachers', { user: noUsers, body: { name: 'محظور' } })).status).toBe(403);
      expect(await client.teachers.count()).toBe(before);
    });
  });

  describe('CRUD through /api/teachers (the single source of truth)', () => {
    it('create -> read -> update -> delete round trip, with a server-generated id', async () => {
      const admin = await seedUser(['users']);

      const created = await request('POST', '/api/teachers', {
        user: admin, body: { name: 'أحمد سامي', phone: '01011111111', subject: 'فيزياء', active: true },
      });
      expect(created.status).toBe(201);
      const t = created.body.data;
      expect(t.id).toMatch(/^\d+$/); // BigInt id from the sequence, serialized as a string
      expect(t).toMatchObject({ name: 'أحمد سامي', phone: '01011111111', subject: 'فيزياء', active: true });

      const list = await request('GET', '/api/teachers', { user: admin });
      expect(list.body.data.map((r) => r.id)).toContain(t.id);

      const updated = await request('PUT', `/api/teachers/${t.id}`, {
        user: admin, body: { name: 'أحمد سامي علي', phone: '01022222222', subject: 'كيمياء', active: false },
      });
      expect(updated.status).toBe(200);
      expect(updated.body.data).toMatchObject({ id: t.id, name: 'أحمد سامي علي', subject: 'كيمياء', active: false });
      expect(await client.teachers.findUnique({ where: { id: BigInt(t.id) } })).toMatchObject({ name: 'أحمد سامي علي', active: false });

      expect((await request('DELETE', `/api/teachers/${t.id}`, { user: admin })).status).toBe(200);
      expect(await client.teachers.findUnique({ where: { id: BigInt(t.id) } })).toBeNull();
    });

    it('a teacher linked to an account (users.teacher_id) cannot be deleted: 409, nothing deleted', async () => {
      const admin = await seedUser(['users']);
      const teacher = await seedTeacher();
      await client.users.create({ data: { id: nextId('linked'), name: 'حساب مرتبط', active: true, teacher_id: teacher.id } });

      const res = await request('DELETE', `/api/teachers/${teacher.id}`, { user: admin });
      expect(res.status).toBe(409);
      expect(await client.teachers.findUnique({ where: { id: teacher.id } })).not.toBeNull();
    });
  });

  describe('users.teacher_id link through /api/users teacherId', () => {
    it('POST links a new account to an existing teacher; the response carries teacherId', async () => {
      const admin = await seedUser(['users']);
      const teacher = await seedTeacher();
      const id = nextId('acc');
      const res = await request('POST', '/api/users', {
        user: admin, body: { id, name: 'حساب مدرس', password: 'secret-123', teacherId: String(teacher.id) },
      });
      expect(res.status).toBe(201);
      expect(res.body.user.teacherId).toBe(String(teacher.id));
      expect((await client.users.findUnique({ where: { id } })).teacher_id).toBe(teacher.id);
    });

    it('PUT links, relinks and unlinks (null), without bumping auth_version', async () => {
      const admin = await seedUser(['users']);
      const t1 = await seedTeacher({ name: 'مدرس 1' });
      const t2 = await seedTeacher({ name: 'مدرس 2' });
      const account = await client.users.create({ data: { id: nextId('acc'), name: 'حساب', active: true } });

      let res = await request('PUT', `/api/users/${account.id}`, { user: admin, body: { teacherId: String(t1.id) } });
      expect(res.status).toBe(200);
      expect(res.body.user.teacherId).toBe(String(t1.id));

      res = await request('PUT', `/api/users/${account.id}`, { user: admin, body: { teacherId: String(t2.id) } });
      expect(res.body.user.teacherId).toBe(String(t2.id));

      res = await request('PUT', `/api/users/${account.id}`, { user: admin, body: { teacherId: null } });
      expect(res.status).toBe(200);
      expect(res.body.user.teacherId).toBeNull();

      const after = await client.users.findUnique({ where: { id: account.id } });
      expect(after.teacher_id).toBeNull();
      expect(after.auth_version).toBe(account.auth_version); // not auth-affecting
    });

    it('omitting teacherId leaves an existing link untouched', async () => {
      const admin = await seedUser(['users']);
      const teacher = await seedTeacher();
      const account = await client.users.create({ data: { id: nextId('acc'), name: 'حساب', active: true, teacher_id: teacher.id } });
      const res = await request('PUT', `/api/users/${account.id}`, { user: admin, body: { name: 'اسم جديد' } });
      expect(res.status).toBe(200);
      expect((await client.users.findUnique({ where: { id: account.id } })).teacher_id).toBe(teacher.id);
    });

    it.each([['nonexistent', '999999999'], ['non-numeric', 'tc1700000000000'], ['negative', '-5']])(
      'an invalid teacherId (%s) is refused with 400 on POST and PUT, nothing written',
      async (_label, bad) => {
        const admin = await seedUser(['users']);
        const id = nextId('acc');
        const post = await request('POST', '/api/users', { user: admin, body: { id, name: 'حساب', password: 'secret-123', teacherId: bad } });
        expect(post.status).toBe(400);
        expect(await client.users.findUnique({ where: { id } })).toBeNull();

        const account = await client.users.create({ data: { id: nextId('acc'), name: 'حساب', active: true } });
        const put = await request('PUT', `/api/users/${account.id}`, { user: admin, body: { teacherId: bad } });
        expect(put.status).toBe(400);
        expect((await client.users.findUnique({ where: { id: account.id } })).teacher_id).toBeNull();
      },
    );
  });
});
