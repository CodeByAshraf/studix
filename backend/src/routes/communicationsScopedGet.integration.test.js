// backend/src/routes/communicationsScopedGet.integration.test.js
// Scalability Architecture Phase 4 — real PostgreSQL integration (scratch database only).
// Proves the new, additive GET /api/communications?studentId=&groupId= matches the exact
// current predicate used by StudentsPage.jsx (`c.studentId === s.id`) and GroupsPage.jsx
// (`c.groupId === g.id`) — a direct column match, deliberately NOT the phone/name matching
// reportData.js uses (already covered by Phase 2's studentReport.js, unchanged) — and
// preserves the exact unfiltered behavior the boot-sync depends on with no query params.
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

describe('GET /api/communications — scoped filtering (real PostgreSQL + Express integration, Phase 4)', () => {
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
    scratch = await setupScratchDb('communications_scoped_get');
    client = scratch.client;

    const communicationsRouter = (await import('./communications.js')).default;
    const { errorHandler } = await import('../middleware/errorHandler.js');

    const app = express();
    app.use('/api/communications', communicationsRouter);
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
    return client.groups.create({ data: { id, name: 'مجموعة اختبار' } });
  }

  async function seedComm(overrides = {}) {
    return client.communications.create({
      data: { id: nextId('c'), number: nextId('CN'), type: 'call', result: 'ok', ...overrides },
    });
  }

  it('no query params: returns every row, identical to the unfiltered generic route the boot-sync depends on', async () => {
    await seedComm();
    await seedComm();

    const res = await request(port, '/api/communications');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.count).toBeGreaterThanOrEqual(2);
  });

  it('studentId filter: matches StudentsPage.jsx\'s exact direct student_id equality (NOT phone/name matching)', async () => {
    const student = await seedStudent();
    await seedComm({ student_id: student.id });
    // سجل يطابق بالاسم/الهاتف فقط (لا student_id) — يجب ألا يُطابَق هنا، هذا هو بالضبط
    // الفرق المُوثَّق عن reportData.js (تعمّداً غير موحَّد — انظر رأس communications.js).
    await seedComm({ student_name: student.name, phone: '01000000000' });

    const res = await request(port, `/api/communications?studentId=${student.id}`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].studentId).toBe(student.id);
  });

  it('groupId filter: matches GroupsPage.jsx\'s exact direct group_id equality', async () => {
    const groupA = await seedGroup();
    const groupB = await seedGroup();
    await seedComm({ group_id: groupA.id });
    await seedComm({ group_id: groupB.id });

    const res = await request(port, `/api/communications?groupId=${groupA.id}`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].groupId).toBe(groupA.id);
  });

  it('archived/completed status records are still returned — matches StudentsPage.jsx\'s count, which never filters by status', async () => {
    const student = await seedStudent();
    await seedComm({ student_id: student.id, status: 'archived' });
    await seedComm({ student_id: student.id, status: 'open' });

    const res = await request(port, `/api/communications?studentId=${student.id}`);
    expect(res.body.data).toHaveLength(2);
  });

  it('empty result: a student with zero communications returns an empty array, not an error', async () => {
    const student = await seedStudent();
    const res = await request(port, `/api/communications?studentId=${student.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.count).toBe(0);
  });
});
