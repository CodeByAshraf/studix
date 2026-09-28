// backend/src/routes/waReportLog.integration.test.js
// wa_report_log author is server-derived. A real ephemeral-port Express app mounting the real
// middleware chain exactly as server.js does — the waReportLog author router, then the generic
// CRUD, both behind requirePermission('students') — driven with real HTTP (same technique as
// phase4ScopedGetAuth.integration.test.js; the stub only sets req.user from a test header, the
// permission check itself is the real one reading PostgreSQL).
//
// npm run test:integration only. Fail-closed isolation guard: runs only when the caller
// explicitly marks DATABASE_URL as a throwaway cluster (STUDIX_TEST_DB_ISOLATED=1) — a bare run
// (DATABASE_URL from backend/.env) never touches the dev server. If PostgreSQL is unreachable or
// the guard is not set, a single clear "SKIPPED" test is recorded instead.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import process from 'process';
import { Buffer } from 'buffer';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = process.env.STUDIX_TEST_DB_ISOLATED === '1'
  ? await checkPostgresReachable()
  : { reachable: false, reason: 'STUDIX_TEST_DB_ISOLATED=1 not set — refusing to use a non-isolated DATABASE_URL.' };

function send(port, method, path, { user, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json' };
    if (user) headers['x-test-user'] = JSON.stringify(user);
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
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

describe('POST /api/waReportLog — created_by is server-derived (real Express + PostgreSQL)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, server, port;
  let seq = 0;
  const nextId = (prefix) => { seq += 1; return `${prefix}_${seq}_${Date.now()}`; };

  beforeAll(async () => {
    scratch = await setupScratchDb('wa_report_log_author');
    client = scratch.client;

    const { requirePermission } = await import('../middleware/permissions.js');
    const { errorHandler } = await import('../middleware/errorHandler.js');
    const { makeCrudRouter } = await import('./crud.js');
    const { CRUD_POLICIES } = await import('./crudPolicies.js');
    const { COLLECTION_MODELS } = await import('./collections.js');
    const waReportLogRouter = (await import('./waReportLog.js')).default;

    function stubAuth(req, res, next) {
      const raw = req.headers['x-test-user'];
      req.user = raw ? JSON.parse(raw) : undefined;
      next();
    }

    // Mounted exactly as server.js: the author router first, then the generic CRUD.
    const app = express();
    app.use(express.json());
    app.use('/api/waReportLog', stubAuth, requirePermission('students'), waReportLogRouter);
    app.use('/api/waReportLog', stubAuth, requirePermission('students'),
      makeCrudRouter(COLLECTION_MODELS.waReportLog, { writable: true, policy: CRUD_POLICIES.waReportLog }));
    app.use(errorHandler);

    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    port = server.address().port;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (scratch) await teardownScratchDb(scratch);
  });

  async function seedUser(permissions) {
    const user = await client.users.create({ data: { id: nextId('u'), name: 'مستخدم', active: true, permissions } });
    return { id: user.id, userAuthVersion: user.auth_version, roleAuthVersion: null };
  }
  async function seedStudent() {
    const s = await client.students.create({ data: { id: nextId('s'), code: nextId('C'), name: 'طالب', parent_phone: '01012345678' } });
    return s.id;
  }
  const logBody = (studentId, extra = {}) => ({
    studentId, parentPhone: '01012345678', reportType: 'followupSummary', messageType: 'followupSummary', status: 'prepared', ...extra,
  });
  const stored = (id) => client.wa_report_log.findUnique({ where: { id } });

  it('1/4. a normal authenticated request succeeds and stores the authenticated user as created_by', async () => {
    const user = await seedUser(['students']);
    const studentId = await seedStudent();

    // exactly what StudentReportPage.jsx sends (its own id as createdBy)
    const res = await send(port, 'POST', '/api/waReportLog', { user, body: logBody(studentId, { createdBy: user.id }) });

    expect(res.status).toBe(201);
    const row = await stored(res.body.data.id);
    expect(row).toMatchObject({ created_by: user.id, student_id: studentId, parent_phone: '01012345678', report_type: 'followupSummary', status: 'prepared' });
  });

  it('1b. created_by is filled from the session even when the client sends none', async () => {
    const user = await seedUser(['students']);
    const res = await send(port, 'POST', '/api/waReportLog', { user, body: logBody(await seedStudent()) });
    expect(res.status).toBe(201);
    expect((await stored(res.body.data.id)).created_by).toBe(user.id);
  });

  it('2. a client-supplied created_by (either spelling) cannot impersonate another user', async () => {
    const actor = await seedUser(['students']);
    const victim = await seedUser(['students']);
    const studentId = await seedStudent();

    for (const spoof of [{ createdBy: victim.id }, { created_by: victim.id }, { createdBy: victim.id, created_by: victim.id }]) {
      const res = await send(port, 'POST', '/api/waReportLog', { user: actor, body: logBody(studentId, spoof) });
      expect(res.status).toBe(201);
      expect((await stored(res.body.data.id)).created_by).toBe(actor.id);
    }
  });

  it('2b. an existing log cannot be re-attributed through a generic update', async () => {
    const actor = await seedUser(['students']);
    const victim = await seedUser(['students']);
    const created = await send(port, 'POST', '/api/waReportLog', { user: actor, body: logBody(await seedStudent()) });
    const id = created.body.data.id;

    const res = await send(port, 'PUT', `/api/waReportLog/${id}`, { user: victim, body: { createdBy: victim.id, created_by: victim.id, status: 'prepared' } });
    expect(res.status).toBe(200);
    expect((await stored(id)).created_by).toBe(actor.id);
  });

  it('3. permission enforcement is unchanged: without "students" → 403, unauthenticated → 401, nothing stored', async () => {
    const before = await client.wa_report_log.count();
    const studentId = await seedStudent();

    const noPerm = await seedUser(['attendance']);
    expect((await send(port, 'POST', '/api/waReportLog', { user: noPerm, body: logBody(studentId) })).status).toBe(403);
    expect((await send(port, 'POST', '/api/waReportLog', { body: logBody(studentId) })).status).toBe(401);

    expect(await client.wa_report_log.count()).toBe(before);
  });
});
