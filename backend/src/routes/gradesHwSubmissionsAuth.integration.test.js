// backend/src/routes/gradesHwSubmissionsAuth.integration.test.js
// Grades + Homework Submissions Backend Read Foundation (spec 003) — authorization-boundary
// check for the two new scoped GET endpoints (GET /api/grades?studentId=...,
// GET /api/hwSubmissions?studentId=..., GET /api/hwSubmissions/aggregate?groupBy=...). Same
// technique as phase4ScopedGetAuth.integration.test.js: a real ephemeral-port Express app
// mounting the real middleware chain (requireAuth + requirePermission) exactly as server.js
// does, driven with real HTTP requests.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED" test is
// recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

function request(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
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

describe('Grades + hwSubmissions scoped GET endpoints — authorization boundary (real Express + PostgreSQL, spec 003)', () => {
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
    scratch = await setupScratchDb('grades_hwsub_auth');
    client = scratch.client;

    const { requirePermission } = await import('../middleware/permissions.js');
    const { errorHandler } = await import('../middleware/errorHandler.js');
    const gradesRouter = (await import('./grades.js')).default;
    const hwSubmissionsScopedGetRouter = (await import('./hwSubmissionsScopedGet.js')).default;
    const homeworksScopedGetRouter = (await import('./homeworksScopedGet.js')).default;

    function stubAuth(req, res, next) {
      const raw = req.headers['x-test-user'];
      req.user = raw ? JSON.parse(raw) : undefined;
      next();
    }

    const app = express();
    app.use('/api/grades', stubAuth, requirePermission('exams'), gradesRouter);
    app.use('/api/hwSubmissions', stubAuth, requirePermission('homework'), hwSubmissionsScopedGetRouter);
    app.use('/api/homeworks', stubAuth, requirePermission('homework'), homeworksScopedGetRouter);
    app.use(errorHandler);

    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    port = server.address().port;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (scratch) await teardownScratchDb(scratch);
  });

  async function seedUser(id, permissions) {
    const user = await client.users.create({ data: { id, name: 'مستخدم اختبار', active: true, permissions } });
    return { id: user.id, userAuthVersion: user.auth_version, roleAuthVersion: null };
  }

  it('GET /api/grades: a user WITH the exams permission succeeds', async () => {
    const user = await seedUser(nextId('u'), ['exams']);
    const res = await request(port, '/api/grades', { 'x-test-user': JSON.stringify(user) });
    expect(res.status).toBe(200);
  });

  it('GET /api/grades: a user WITHOUT the exams permission is rejected with 403', async () => {
    const user = await seedUser(nextId('u'), ['students']);
    const res = await request(port, '/api/grades', { 'x-test-user': JSON.stringify(user) });
    expect(res.status).toBe(403);
  });

  it('GET /api/grades: unauthenticated is rejected with 401', async () => {
    const res = await request(port, '/api/grades');
    expect(res.status).toBe(401);
  });

  // Phase 1C (Grades global-read migration) — GET /aggregate is mounted on the same router as
  // GET / above, so it inherits the identical requireAuth/requirePermission('exams') chain;
  // these three mirror the GET /api/grades cases above to prove that inheritance explicitly.
  it('GET /api/grades/aggregate: a user WITH the exams permission succeeds', async () => {
    const user = await seedUser(nextId('u'), ['exams']);
    const res = await request(port, '/api/grades/aggregate?groupBy=none', { 'x-test-user': JSON.stringify(user) });
    expect(res.status).toBe(200);
  });

  it('GET /api/grades/aggregate: a user WITHOUT the exams permission is rejected with 403', async () => {
    const user = await seedUser(nextId('u'), ['students']);
    const res = await request(port, '/api/grades/aggregate?groupBy=none', { 'x-test-user': JSON.stringify(user) });
    expect(res.status).toBe(403);
  });

  it('GET /api/grades/aggregate: unauthenticated is rejected with 401', async () => {
    const res = await request(port, '/api/grades/aggregate?groupBy=none');
    expect(res.status).toBe(401);
  });

  it('GET /api/hwSubmissions: a user WITH the homework permission succeeds', async () => {
    const user = await seedUser(nextId('u'), ['homework']);
    const res = await request(port, '/api/hwSubmissions', { 'x-test-user': JSON.stringify(user) });
    expect(res.status).toBe(200);
  });

  it('GET /api/hwSubmissions: a user WITHOUT the homework permission is rejected with 403', async () => {
    const user = await seedUser(nextId('u'), ['students']);
    const res = await request(port, '/api/hwSubmissions', { 'x-test-user': JSON.stringify(user) });
    expect(res.status).toBe(403);
  });

  it('GET /api/hwSubmissions: unauthenticated is rejected with 401', async () => {
    const res = await request(port, '/api/hwSubmissions');
    expect(res.status).toBe(401);
  });

  it('GET /api/hwSubmissions/aggregate: a user WITH the homework permission succeeds', async () => {
    const user = await seedUser(nextId('u'), ['homework']);
    const res = await request(port, '/api/hwSubmissions/aggregate?groupBy=status', { 'x-test-user': JSON.stringify(user) });
    expect(res.status).toBe(200);
  });

  it('GET /api/hwSubmissions/aggregate: a user WITHOUT the homework permission is rejected with 403', async () => {
    const user = await seedUser(nextId('u'), ['students']);
    const res = await request(port, '/api/hwSubmissions/aggregate?groupBy=status', { 'x-test-user': JSON.stringify(user) });
    expect(res.status).toBe(403);
  });

  it('GET /api/hwSubmissions/aggregate: unauthenticated is rejected with 401', async () => {
    const res = await request(port, '/api/hwSubmissions/aggregate?groupBy=status');
    expect(res.status).toBe(401);
  });

  // Phase 2 (Homework global-read migration) — GET /api/homeworks?grade= is mounted exactly as
  // server.js mounts it (requireAuth + requirePermission('homework')).
  it('GET /api/homeworks: a user WITH the homework permission succeeds', async () => {
    const user = await seedUser(nextId('u'), ['homework']);
    const res = await request(port, '/api/homeworks?grade=x', { 'x-test-user': JSON.stringify(user) });
    expect(res.status).toBe(200);
  });

  it('GET /api/homeworks: a user WITHOUT the homework permission is rejected with 403', async () => {
    const user = await seedUser(nextId('u'), ['groups']);
    const res = await request(port, '/api/homeworks?grade=x', { 'x-test-user': JSON.stringify(user) });
    expect(res.status).toBe(403);
  });

  it('GET /api/homeworks: unauthenticated is rejected with 401', async () => {
    const res = await request(port, '/api/homeworks');
    expect(res.status).toBe(401);
  });
});
