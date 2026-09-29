// backend/src/routes/deleteRelatedRecords.integration.test.js
// M2/F3 — related-record checks for DELETE /api/students/:id and DELETE /api/groups/:id run on
// the server, under exactly the permission that guards each delete ('students' / 'groups').
// Real PostgreSQL + Express, mounting the real chain exactly as server.js does (requireAuth
// stand-in + requirePermission, the guard router, then the real generic CRUD router). Proves:
//   - a students-only / groups-only user deletes an EMPTY record (no other permission needed);
//   - linked records -> 409 with the page's own message (STUDENT_/GROUP_HAS_RELATED_RECORDS),
//     nothing deleted;
//   - without 'students' / 'groups' -> 403 (even holding every related permission); 401 unauthenticated;
//   - existing protections intact: homework rule (GROUP_HAS_HOMEWORK), 404 for a missing
//     record, and the FK still refusing (409) a relation the guard does not check.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED" test is
// recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

function del(port, urlPath, user) {
  return new Promise((resolve, reject) => {
    const headers = user ? { 'x-test-user': JSON.stringify(user) } : {};
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'DELETE', headers }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { /* n/a */ }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('DELETE /api/students/:id and /api/groups/:id — server-side related-record checks (M2/F3, real Express + PostgreSQL)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, server, port;
  let seq = 0;
  const nextId = (prefix) => { seq += 1; return `${prefix}_${seq}_${Date.now()}`; };
  const DAY = new Date('2026-01-05T00:00:00.000Z');

  beforeAll(async () => {
    scratch = await setupScratchDb('delete_related_records');
    client = scratch.client;

    const { requirePermission } = await import('../middleware/permissions.js');
    const { errorHandler } = await import('../middleware/errorHandler.js');
    const { makeCrudRouter } = await import('./crud.js');
    const studentDeleteRouter = (await import('./studentDelete.js')).default;
    const groupDeleteRouter = (await import('./groupDelete.js')).default;

    function stubAuth(req, res, next) {
      const raw = req.headers['x-test-user'];
      req.user = raw ? JSON.parse(raw) : undefined;
      next();
    }

    // Same order as server.js: the guard router first, then the generic CRUD router.
    const app = express();
    app.use('/api/students', stubAuth, requirePermission('students'), studentDeleteRouter);
    app.use('/api/groups', stubAuth, requirePermission('groups'), groupDeleteRouter);
    app.use('/api/students', stubAuth, requirePermission('students'), makeCrudRouter('students', { writable: true, preserveClientId: true }));
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
  const seedGroup = (grade = `grade_${nextId('x')}`) => client.groups.create({ data: { id: nextId('g'), name: 'مجموعة اختبار', grade } });
  const seedStudent = (groupId = null) => {
    const id = nextId('s');
    return client.students.create({ data: { id, code: id, name: 'طالب اختبار', status: 'active', group_id: groupId } });
  };
  const seedExam = (groupId = null) => client.exams.create({ data: { id: nextId('e'), name: 'امتحان', date: DAY, total: 100, group_id: groupId } });
  const seedHomework = (grade) => client.homeworks.create({ data: { id: nextId('hw'), title: 'واجب', grade, due_date: DAY } });
  const seedPayment = ({ studentId, groupId = null }) => client.payments.create({
    data: { id: nextId('p'), student_id: studentId, group_id: groupId, month: 1, year: 2026, amount: 100, date: DAY, status: 'paid' },
  });
  const seedCommunication = ({ studentId = null, groupId = null }) => client.communications.create({
    data: { id: nextId('c'), number: nextId('COM'), type: 'call', result: 'done', student_id: studentId, group_id: groupId },
  });
  const seedAttendance = ({ studentId, groupId }) => client.attendance.create({
    data: { id: nextId('a'), student_id: studentId, group_id: groupId, date: DAY, status: 'present' },
  });
  const studentExists = async (id) => (await client.students.findUnique({ where: { id } })) !== null;
  const groupExists = async (id) => (await client.groups.findUnique({ where: { id } })) !== null;

  // ═══ Students ═══
  it('1. a students-only user deletes an empty student (no exams/homework/payments permission needed)', async () => {
    const s = await seedStudent();
    const res = await del(port, `/api/students/${s.id}`, await seedUser(['students']));
    expect(res.status).toBe(200);
    expect(await studentExists(s.id)).toBe(false);
  });

  it.each([
    ['grades', 'درجة مسجّلة', async (s) => client.grades.create({ data: { id: nextId('gr'), exam_id: (await seedExam()).id, student_id: s.id } })],
    ['hw_submissions', 'تسليم واجب', async (s) => client.hw_submissions.create({ data: { id: nextId('hs'), homework_id: (await seedHomework('any')).id, student_id: s.id } })],
    ['payments', 'دفعة مسجّلة', (s) => seedPayment({ studentId: s.id })],
    ['communications', 'سجل تواصل', (s) => seedCommunication({ studentId: s.id })],
    ['attendance', 'سجل حضور', async (s) => seedAttendance({ studentId: s.id, groupId: (await seedGroup()).id })],
    ['admissions', 'سجل قبول', (s) => client.admissions.create({ data: { id: nextId('adm'), number: nextId('N'), name: 'قبول', student_id: s.id } })],
  ])('2. students-only user: a student with %s -> 409 with the page\'s message, nothing deleted', async (_table, label, link) => {
    const s = await seedStudent();
    await link(s);
    const res = await del(port, `/api/students/${s.id}`, await seedUser(['students']));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      ok: false,
      code: 'STUDENT_HAS_RELATED_RECORDS',
      error: `لا يمكن حذف طالب اختبار — له 1 ${label}. أوقفه بدلاً من حذفه (الحالة: موقوف).`,
    });
    expect(await studentExists(s.id)).toBe(true);
  });

  it('5. without the students permission (even with exams/homework/payments) -> 403, nothing deleted; unauthenticated -> 401', async () => {
    const s = await seedStudent();
    expect((await del(port, `/api/students/${s.id}`, await seedUser(['exams', 'homework', 'payments', 'groups']))).status).toBe(403);
    expect((await del(port, `/api/students/${s.id}`)).status).toBe(401);
    expect(await studentExists(s.id)).toBe(true);
  });

  it('6. existing protections: a missing student -> 404; an unchecked FK relation (active enrollment) still refused by the database (409)', async () => {
    const user = await seedUser(['students']);
    expect((await del(port, `/api/students/${nextId('missing')}`, user)).status).toBe(404);

    const s = await seedStudent();
    const g = await seedGroup();
    await client.student_group_enrollments.create({
      data: { id: nextId('en'), student_id: s.id, group_id: g.id, role: 'additional', status: 'active', start_date: DAY },
    });
    const res = await del(port, `/api/students/${s.id}`, user);
    expect(res.status).toBe(409);
    expect(await studentExists(s.id)).toBe(true);
  });

  // ═══ Groups ═══
  it('3. a groups-only user deletes an empty group (no students/attendance/communications/payments permission needed)', async () => {
    const g = await seedGroup();
    const res = await del(port, `/api/groups/${g.id}`, await seedUser(['groups']));
    expect(res.status).toBe(200);
    expect(await groupExists(g.id)).toBe(false);
  });

  it.each([
    ['a primary student (students.group_id)', 'بها 1 طالب. انقل الطلاب أولاً.', (g) => seedStudent(g.id)],
    ['an active Additional enrollment only', 'بها 1 طالب. انقل الطلاب أولاً.', async (g) => client.student_group_enrollments.create({
      data: { id: nextId('en'), student_id: (await seedStudent()).id, group_id: g.id, role: 'additional', status: 'active', start_date: DAY },
    })],
    ['attendance history', 'لها 1 سجل حضور تاريخي.', async (g) => seedAttendance({ studentId: (await seedStudent()).id, groupId: g.id })],
    ['an exam', 'لها 1 امتحان.', (g) => seedExam(g.id)],
    ['an admission', 'لها 1 سجل قبول مرتبط.', (g) => client.admissions.create({ data: { id: nextId('adm'), number: nextId('N'), name: 'قبول', group_id: g.id } })],
    ['a communication', 'لها 1 سجل تواصل مرتبط.', (g) => seedCommunication({ groupId: g.id })],
    ['a payment', 'لها 1 دفعة مسجَّلة.', async (g) => seedPayment({ studentId: (await seedStudent()).id, groupId: g.id })],
  ])('4. groups-only user: a group with %s -> 409 with the page\'s message, nothing deleted', async (_label, suffix, link) => {
    const g = await seedGroup();
    await link(g);
    const res = await del(port, `/api/groups/${g.id}`, await seedUser(['groups']));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ ok: false, code: 'GROUP_HAS_RELATED_RECORDS', error: `لا يمكن حذف المجموعة — ${suffix}` });
    expect(await groupExists(g.id)).toBe(true);
  });

  it('4b. a withdrawn enrollment is not a member (page definition) — but the FK still refuses the delete (409), unchanged', async () => {
    const g = await seedGroup();
    await client.student_group_enrollments.create({
      data: { id: nextId('en'), student_id: (await seedStudent()).id, group_id: g.id, role: 'additional', status: 'withdrawn', start_date: DAY },
    });
    const res = await del(port, `/api/groups/${g.id}`, await seedUser(['groups']));
    expect(res.status).toBe(409);
    expect(res.body.code).toBeUndefined(); // the generic FK 409, not the guard's
    expect(await groupExists(g.id)).toBe(true);
  });

  it('5. without the groups permission (even with students/attendance/payments) -> 403, nothing deleted; unauthenticated -> 401', async () => {
    const g = await seedGroup();
    expect((await del(port, `/api/groups/${g.id}`, await seedUser(['students', 'attendance', 'payments', 'homework']))).status).toBe(403);
    expect((await del(port, `/api/groups/${g.id}`)).status).toBe(401);
    expect(await groupExists(g.id)).toBe(true);
  });

  it('6. existing protections: the homework rule still answers GROUP_HAS_HOMEWORK; a missing group -> 404', async () => {
    const user = await seedUser(['groups']);
    const grade = `grade_${nextId('x')}`;
    const g = await seedGroup(grade);
    await seedHomework(grade);
    const res = await del(port, `/api/groups/${g.id}`, user);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('GROUP_HAS_HOMEWORK');
    expect(await groupExists(g.id)).toBe(true);

    expect((await del(port, `/api/groups/${nextId('missing')}`, user)).status).toBe(404);
  });

  it('7. the related-record checks need no permission beyond the delete\'s own — a students-/groups-only user gets 409, never 403', async () => {
    const s = await seedStudent();
    await seedPayment({ studentId: s.id });
    expect((await del(port, `/api/students/${s.id}`, await seedUser(['students']))).status).toBe(409);

    const g = await seedGroup();
    await seedCommunication({ groupId: g.id });
    expect((await del(port, `/api/groups/${g.id}`, await seedUser(['groups']))).status).toBe(409);
  });
});
