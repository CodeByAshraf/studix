// backend/src/routes/admissionActivationParent.integration.test.js
// M2/F4 — admission activation is self-contained: the parent is found-or-created from
// parentPhone INSIDE the activation transaction, under the 'admissions' permission only.
// Real PostgreSQL + Express with the real chain as server.js mounts it (requireAuth stand-in +
// requirePermission('admissions') + the activation router), plus the standalone
// /api/parents CRUD behind 'students' to prove it is unchanged. Proves:
//   - an admissions-only user activates with a parent phone; the parent is created (normalized
//     phone) or an existing one reused (never modified), and linked to the new student;
//   - no 'students' permission is involved, and /api/parents stays 403 for that user;
//   - without 'admissions' -> 403, nothing written;
//   - a failure after the parent step rolls back parent + student + enrollment together;
//   - no parent phone / an unusable phone / an explicit parentId / missing group / missing
//     name / idempotent re-activation behave exactly as before;
//   - two concurrent activations sharing a new phone resolve to ONE parent row.
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

describe('PUT /api/admissions/:id/activate — parent linked inside the activation (M2/F4, real Express + PostgreSQL)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, server, port;
  let seq = 0;
  const nextId = (prefix) => { seq += 1; return `${prefix}_${seq}_${Date.now()}`; };
  // A fresh, valid Egyptian mobile per test (so parent rows never collide across tests).
  let phoneSeq = 0;
  const nextLocalPhone = () => { phoneSeq += 1; return `011${String(Date.now() % 1e4).padStart(4, '0')}${String(phoneSeq).padStart(4, '0')}`; };
  const toStored = (local) => `20${local.slice(1)}`;

  beforeAll(async () => {
    scratch = await setupScratchDb('admission_activation_parent');
    client = scratch.client;

    const { requirePermission } = await import('../middleware/permissions.js');
    const { errorHandler } = await import('../middleware/errorHandler.js');
    const { makeCrudRouter } = await import('./crud.js');
    const admissionActivationRouter = (await import('./admissionActivation.js')).default;

    function stubAuth(req, res, next) {
      const raw = req.headers['x-test-user'];
      req.user = raw ? JSON.parse(raw) : undefined;
      next();
    }

    const app = express();
    app.use(express.json());
    app.use('/api/admissions', stubAuth, requirePermission('admissions'), admissionActivationRouter);
    app.use('/api/parents', stubAuth, requirePermission('students'), makeCrudRouter('parents', { writable: true }));
    app.use(errorHandler);

    await client.groups.create({ data: { id: 'g1', name: 'مجموعة اختبار', grade: 'الصف الأول الثانوي' } });

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
  const seedAdmission = () => client.admissions.create({ data: { id: nextId('adm'), number: nextId('N'), name: 'طالب قبول', stage: 'reserved' } });
  const activate = (admissionId, user, student) => request(port, 'PUT', `/api/admissions/${admissionId}/activate`, { user, body: { student } });
  const studentBody = (extra = {}) => ({ name: 'أحمد علي', groupId: 'g1', phone: '01000000000', grade: 'الصف الأول الثانوي', status: 'active', ...extra });
  const parentByPhone = (phone) => client.parents.findUnique({ where: { phone } });

  it('1+2+4. an admissions-only user activates with a parent phone: the parent is created (normalized phone) and linked; no students permission involved', async () => {
    const user = await seedUser(['admissions']);
    const admission = await seedAdmission();
    const local = nextLocalPhone();

    const res = await activate(admission.id, user, studentBody({ parentPhone: local }));
    expect(res.status).toBe(200);

    const parent = await parentByPhone(toStored(local));
    expect(parent).not.toBeNull();
    const student = await client.students.findUnique({ where: { id: res.body.data.student.id } });
    expect(student.parent_id).toBe(parent.id);
    expect(student.parent_phone).toBe(local); // stored as sent, exactly as before
    expect(res.body.data.student.parentId).toBe(parent.id.toString());
    expect((await client.admissions.findUnique({ where: { id: admission.id } })).student_id).toBe(student.id);

    // …and general parent management stays closed to this user (standalone route unchanged).
    expect((await request(port, 'POST', '/api/parents', { user, body: { phone: toStored(nextLocalPhone()) } })).status).toBe(403);
    expect((await request(port, 'GET', '/api/parents', { user })).status).toBe(403);
  });

  it('3. an existing parent (same number, any accepted format) is reused — no second row, existing data untouched', async () => {
    const local = nextLocalPhone();
    const existing = await client.parents.create({ data: { phone: toStored(local), full_name: 'ولي أمر قديم', notes: 'ملاحظة' } });
    const res = await activate((await seedAdmission()).id, await seedUser(['admissions']), studentBody({ parentPhone: `+2${local}` }));
    expect(res.status).toBe(200);

    const student = await client.students.findUnique({ where: { id: res.body.data.student.id } });
    expect(student.parent_id).toBe(existing.id);
    expect(await client.parents.count({ where: { phone: toStored(local) } })).toBe(1);
    const after = await client.parents.findUnique({ where: { id: existing.id } });
    expect(after.full_name).toBe('ولي أمر قديم');
    expect(after.notes).toBe('ملاحظة');
  });

  it('5. a user without admissions (even with students + groups) gets 403 and nothing is written', async () => {
    const admission = await seedAdmission();
    const local = nextLocalPhone();
    const res = await activate(admission.id, await seedUser(['students', 'groups']), studentBody({ parentPhone: local }));
    expect(res.status).toBe(403);
    expect(await parentByPhone(toStored(local))).toBeNull();
    expect((await client.admissions.findUnique({ where: { id: admission.id } })).stage).toBe('reserved');
    expect((await request(port, 'PUT', `/api/admissions/${admission.id}/activate`, { body: { student: studentBody() } })).status).toBe(401);
  });

  it('6. atomic: a failure after the parent step (unknown group) rolls back parent, student and enrollment together', async () => {
    const admission = await seedAdmission();
    const local = nextLocalPhone();
    const studentsBefore = await client.students.count();
    const enrollmentsBefore = await client.student_group_enrollments.count();

    const res = await activate(admission.id, await seedUser(['admissions']), studentBody({ parentPhone: local, groupId: 'no-such-group' }));
    expect(res.status).toBeGreaterThanOrEqual(400);

    expect(await parentByPhone(toStored(local))).toBeNull();
    expect(await client.students.count()).toBe(studentsBefore);
    expect(await client.student_group_enrollments.count()).toBe(enrollmentsBefore);
    const after = await client.admissions.findUnique({ where: { id: admission.id } });
    expect(after.stage).toBe('reserved');
    expect(after.student_id).toBeNull();
  });

  it('7. without a parent phone: behaves exactly as before — no parent row, parent_id and parent_phone null', async () => {
    const parentsBefore = await client.parents.count();
    const res = await activate((await seedAdmission()).id, await seedUser(['admissions']), studentBody());
    expect(res.status).toBe(200);
    const student = await client.students.findUnique({ where: { id: res.body.data.student.id } });
    expect(student.parent_id).toBeNull();
    expect(student.parent_phone).toBeNull();
    expect(await client.parents.count()).toBe(parentsBefore);
  });

  it('8. validation and duplicate handling unchanged', async () => {
    const user = await seedUser(['admissions']);

    // an unusable phone creates no parent (same as the page's normalizer returning null)
    const parentsBefore = await client.parents.count();
    const bad = await activate((await seedAdmission()).id, user, studentBody({ parentPhone: '12345' }));
    expect(bad.status).toBe(200);
    expect((await client.students.findUnique({ where: { id: bad.body.data.student.id } })).parent_id).toBeNull();
    expect(await client.parents.count()).toBe(parentsBefore);

    // an explicit parentId (previous contract) still wins over parentPhone
    const explicit = await client.parents.create({ data: { phone: toStored(nextLocalPhone()) } });
    const withId = await activate((await seedAdmission()).id, user, studentBody({ parentId: explicit.id.toString(), parentPhone: nextLocalPhone() }));
    expect(withId.status).toBe(200);
    expect((await client.students.findUnique({ where: { id: withId.body.data.student.id } })).parent_id).toBe(explicit.id);

    // unchanged input validation
    const noName = await activate((await seedAdmission()).id, user, studentBody({ name: '' }));
    expect(noName.status).toBe(400);
    expect(noName.body.error).toBe('اسم الطالب مطلوب.');
    const badParentId = await activate((await seedAdmission()).id, user, studentBody({ parentId: 'abc' }));
    expect(badParentId.status).toBe(400);
    expect(badParentId.body.error).toBe('معرّف ولي الأمر غير صحيح.');

    // idempotent re-activation: same student, and no parent created on the replay
    const admission = await seedAdmission();
    const local = nextLocalPhone();
    const first = await activate(admission.id, user, studentBody({ parentPhone: local }));
    const replay = await activate(admission.id, user, studentBody({ parentPhone: nextLocalPhone() }));
    expect(replay.status).toBe(200);
    expect(replay.body.data.student.id).toBe(first.body.data.student.id);
    expect(replay.body.data.systemLogEntries).toEqual([]);
    expect(await client.parents.count({ where: { phone: toStored(local) } })).toBe(1);
  });

  it('8b. two concurrent activations sharing a NEW parent phone resolve to one parent row, both succeed', async () => {
    const user = await seedUser(['admissions']);
    const local = nextLocalPhone();
    const [a, b] = await Promise.all([
      activate((await seedAdmission()).id, user, studentBody({ parentPhone: local })),
      activate((await seedAdmission()).id, user, studentBody({ parentPhone: local })),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await client.parents.count({ where: { phone: toStored(local) } })).toBe(1);
    const parent = await parentByPhone(toStored(local));
    expect(a.body.data.student.parentId).toBe(parent.id.toString());
    expect(b.body.data.student.parentId).toBe(parent.id.toString());
  });

  it('9. group handling unchanged: a missing groupId is still rejected (400) before anything is written', async () => {
    const admission = await seedAdmission();
    const local = nextLocalPhone();
    const res = await activate(admission.id, await seedUser(['admissions']), studentBody({ groupId: '', parentPhone: local }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('المجموعة مطلوبة.');
    expect(await parentByPhone(toStored(local))).toBeNull();
  });
});
