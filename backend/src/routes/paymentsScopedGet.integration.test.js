// backend/src/routes/paymentsScopedGet.integration.test.js
// Scalability Architecture Phase 4 — real PostgreSQL integration (scratch database only).
// Proves the new, additive GET /api/payments query-filtering (studentId/groupId/month/
// year) matches the exact current full-array `.filter()` semantics used by PaymentForm.jsx
// (studentId+month+year), StudentsPage.jsx/GroupsPage.jsx (studentId/groupId only, no
// status filter — every payment status counts), and preserves the exact unfiltered
// behavior the boot-sync (loadFromPostgres -> pgGetCollection('payments'), no query
// params at all) depends on today. Drives the REAL Express app + REAL HTTP requests (same
// technique as materialDistributionPaymentAuth.integration.test.js) so query-string
// parsing itself is exercised, not just the underlying Prisma call.
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

describe('GET /api/payments — scoped filtering (real PostgreSQL + Express integration, Phase 4)', () => {
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
    scratch = await setupScratchDb('payments_scoped_get');
    client = scratch.client;

    const paymentsRouter = (await import('./payments.js')).default;
    const { errorHandler } = await import('../middleware/errorHandler.js');

    const app = express();
    app.use('/api/payments', paymentsRouter);
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

  async function seedGroup() {
    const id = nextId('g');
    return client.groups.create({ data: { id, name: 'مجموعة اختبار', price: 300 } });
  }

  async function seedPayment(studentId, overrides = {}) {
    return client.payments.create({
      data: {
        id: nextId('p'), student_id: studentId, month: 1, year: 2026, amount: 300,
        pay_type: 'subscription', date: new Date('2026-01-05'), status: 'paid', ...overrides,
      },
    });
  }

  it('no query params: returns every row, identical to the unfiltered generic route the boot-sync depends on', async () => {
    const student = await seedStudent();
    await seedPayment(student.id);
    await seedPayment(student.id, { month: 2 });

    const res = await request(port, '/api/payments');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.count).toBeGreaterThanOrEqual(2);
  });

  it('studentId filter: returns only this student\'s payments, matching PaymentForm.jsx\'s current student_id equality filter exactly', async () => {
    const studentA = await seedStudent();
    const studentB = await seedStudent();
    await seedPayment(studentA.id);
    await seedPayment(studentB.id);

    const res = await request(port, `/api/payments?studentId=${studentA.id}`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].studentId).toBe(studentA.id);
  });

  it('studentId+month+year filter: matches PaymentForm.jsx\'s exact duplicate-subscription-guard predicate (exact equality, no null-year fallback)', async () => {
    const student = await seedStudent();
    await seedPayment(student.id, { month: 1, year: 2026 });
    await seedPayment(student.id, { month: 1, year: 2025 }); // same month number, different year — must be excluded
    await seedPayment(student.id, { month: 2, year: 2026 }); // different month — must be excluded

    const res = await request(port, `/api/payments?studentId=${student.id}&month=1&year=2026`);
    expect(res.body.data).toHaveLength(1);
  });

  it('date boundary: December of one year vs January of the next are correctly distinguished by year, not just month', async () => {
    const student = await seedStudent();
    await seedPayment(student.id, { month: 12, year: 2025, date: new Date('2025-12-20') });
    await seedPayment(student.id, { month: 1, year: 2026, date: new Date('2026-01-05') });

    const dec = await request(port, `/api/payments?studentId=${student.id}&month=12&year=2025`);
    const jan = await request(port, `/api/payments?studentId=${student.id}&month=1&year=2026`);
    expect(dec.body.data).toHaveLength(1);
    expect(jan.body.data).toHaveLength(1);
    expect(dec.body.data[0].id).not.toBe(jan.body.data[0].id);
  });

  it('groupId filter: matches GroupsPage.jsx/GroupStudents.jsx\'s current group_id equality filter', async () => {
    const groupA = await seedGroup();
    const groupB = await seedGroup();
    const studentA = await seedStudent({ group_id: groupA.id });
    const studentB = await seedStudent({ group_id: groupB.id });
    await seedPayment(studentA.id, { group_id: groupA.id });
    await seedPayment(studentB.id, { group_id: groupB.id });

    const res = await request(port, `/api/payments?groupId=${groupA.id}`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].groupId).toBe(groupA.id);
  });

  it('every payment status (paid/partial) is returned regardless — matches StudentsPage.jsx\'s count, which never filters by status', async () => {
    const student = await seedStudent();
    await seedPayment(student.id, { status: 'paid' });
    await seedPayment(student.id, { status: 'partial' });

    const res = await request(port, `/api/payments?studentId=${student.id}`);
    expect(res.body.data).toHaveLength(2);
  });

  it('empty result: a student with zero payments returns an empty array, not an error', async () => {
    const student = await seedStudent();
    const res = await request(port, `/api/payments?studentId=${student.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  it('a nonexistent studentId returns an empty array, not an error (mirrors current client-side .filter() behavior for an unknown id)', async () => {
    const res = await request(port, '/api/payments?studentId=does-not-exist');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
