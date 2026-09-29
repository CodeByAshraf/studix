// backend/src/routes/activityLogsWriteAuth.integration.test.js
// M2/F2 — writing an audit entry needs only a valid, current session; reading the log still
// needs 'activity-log'. Same technique as phase4ScopedGetAuth.integration.test.js: a real
// ephemeral-port Express app driven with real HTTP requests. Both /api/activityLogs mounts are
// reproduced exactly as server.js wires them (dedicated router, then the generic CRUD router
// that performs the insert), each behind the real exported activityLogsGuard.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

function request(port, method, urlPath, { user, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (user) headers['x-test-user'] = JSON.stringify(user.claims);
    if (payload) {
      headers['content-type'] = 'application/json';
    }
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

describe('activityLogs — write needs a current session, read needs activity-log (M2/F2, real Express + PostgreSQL)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch, client, server, port, invalidateUser;
  let seq = 0;

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  beforeAll(async () => {
    scratch = await setupScratchDb('activity_logs_write_auth');
    client = scratch.client;

    const { errorHandler } = await import('../middleware/errorHandler.js');
    const { makeCrudRouter } = await import('./crud.js');
    const { CRUD_POLICIES } = await import('./crudPolicies.js');
    const activityLogsModule = await import('./activityLogs.js');
    ({ invalidateUser } = await import('../lib/authCache.js'));
    const { activityLogsGuard } = activityLogsModule;

    // Stands in for requireAuth (signed-cookie verification only) — every authorization
    // decision under test is made by the real activityLogsGuard/permissions.js.
    function stubAuth(req, res, next) {
      const raw = req.headers['x-test-user'];
      req.user = raw ? JSON.parse(raw) : undefined;
      next();
    }

    const app = express();
    app.use(express.json());
    app.use('/api/activityLogs', stubAuth, activityLogsGuard, activityLogsModule.default);
    app.use('/api/activityLogs', stubAuth, activityLogsGuard,
      makeCrudRouter('activity_logs', { writable: true, preserveClientId: false, policy: CRUD_POLICIES.activityLogs }));
    app.use(errorHandler);

    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    port = server.address().port;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (scratch) await teardownScratchDb(scratch);
  });

  // Returns { claims, name }: `claims` is exactly what requireAuth attaches from the signed
  // session at login ({ id, userAuthVersion, roleAuthVersion }); the name stays server-side.
  async function seedUser(permissions, name = 'مستخدم اختبار') {
    const user = await client.users.create({ data: { id: nextId('u'), name, active: true, permissions } });
    return { claims: { id: user.id, userAuthVersion: user.auth_version, roleAuthVersion: null }, name: user.name };
  }

  // Same body shape pgCreateActivityLog (src/services/api.js) sends.
  const entry = (details = 'حدث اختبار') => ({ action: 'create', module: 'students', details });

  it('a user WITHOUT activity-log can write an audit entry, attributed to themselves', async () => {
    const user = await seedUser(['students']);
    const res = await request(port, 'POST', '/api/activityLogs', { user, body: entry('إضافة طالب') });
    expect(res.status).toBe(201);

    const row = await client.activity_logs.findUnique({ where: { id: res.body.data.id } });
    expect(row.user_id).toBe(user.claims.id);
    expect(row.user_name).toBe(user.name);
    expect(row.action).toBe('create');
  });

  it('the same user still cannot read the activity log (403)', async () => {
    const user = await seedUser(['students']);
    const res = await request(port, 'GET', '/api/activityLogs', { user });
    expect(res.status).toBe(403);
  });

  it('a user WITH activity-log can still read the activity log (200)', async () => {
    const user = await seedUser(['activity-log']);
    const res = await request(port, 'GET', '/api/activityLogs', { user });
    expect(res.status).toBe(200);
  });

  it('an unauthenticated request cannot write (401)', async () => {
    const res = await request(port, 'POST', '/api/activityLogs', { body: entry() });
    expect(res.status).toBe(401);
  });

  it('a deactivated user cannot write (401, same response as every other guarded route)', async () => {
    const user = await seedUser(['students']);
    await client.users.update({ where: { id: user.claims.id }, data: { active: false } });
    invalidateUser(user.claims.id); // what users.js does after any auth-affecting write
    const res = await request(port, 'POST', '/api/activityLogs', { user, body: entry() });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('الجلسة لم تعد صالحة. الرجاء تسجيل الدخول مجدداً.');
  });

  it('a user whose permissions changed after login cannot write with the stale session (401)', async () => {
    const user = await seedUser(['students']);
    await client.users.update({
      where: { id: user.claims.id },
      data: { permissions: ['students', 'groups'], auth_version: { increment: 1 } }, // as users.js does
    });
    invalidateUser(user.claims.id);
    const res = await request(port, 'POST', '/api/activityLogs', { user, body: entry() });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('صلاحياتك تغيّرت. الرجاء تسجيل الدخول مجدداً.');
  });

  it('client-supplied author fields (any casing, createdBy/created_by) never change the stored author', async () => {
    const victim = await seedUser(['activity-log'], 'الضحية');
    const caller = await seedUser(['students'], 'المستدعي');
    const res = await request(port, 'POST', '/api/activityLogs', {
      user: caller,
      body: {
        // userId first, user_id later: the ordering the generic camelToSnake would let win
        userId: victim.claims.id,
        ...entry('محاولة انتحال'),
        user_id: victim.claims.id,
        userName: victim.name,
        user_name: victim.name,
        createdBy: victim.claims.id,
        created_by: victim.claims.id,
      },
    });
    expect(res.status).toBe(201);

    const row = await client.activity_logs.findUnique({ where: { id: res.body.data.id } });
    expect(row.user_id).toBe(caller.claims.id);
    expect(row.user_name).toBe('المستدعي');
  });

  it('editing or deleting an entry stays refused — without activity-log (403) and with it (405)', async () => {
    const writer = await seedUser(['students']);
    const created = await request(port, 'POST', '/api/activityLogs', { user: writer, body: entry() });
    expect(created.status).toBe(201);
    const logPath = `/api/activityLogs/${created.body.data.id}`;

    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const res = await request(port, method, logPath, { user: writer, body: method === 'DELETE' ? undefined : { details: 'x' } });
      expect(res.status).toBe(403);
    }

    const reader = await seedUser(['activity-log']);
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const res = await request(port, method, logPath, { user: reader, body: method === 'DELETE' ? undefined : { details: 'x' } });
      expect(res.status).toBe(405);
    }

    const row = await client.activity_logs.findUnique({ where: { id: created.body.data.id } });
    expect(row.details).toBe('حدث اختبار');
  });

  it('the database trigger still refuses a direct DELETE', async () => {
    // `prisma db push` (scratchDb.js) creates no triggers — install the shipped definitions,
    // read verbatim from the real schema artifact, so this checks the actual trigger.
    const schemaSql = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma', 'studix-schema.sql'), 'utf8');
    const fnSql = schemaSql.match(/CREATE FUNCTION public\.prevent_delete\(\)[\s\S]*?\$\$;/)[0];
    const triggerSql = schemaSql.match(/CREATE TRIGGER trg_no_delete_activity [^;]*;/)[0];
    await client.$executeRawUnsafe(fnSql);
    await client.$executeRawUnsafe(triggerSql);

    const writer = await seedUser(['students']);
    const created = await request(port, 'POST', '/api/activityLogs', { user: writer, body: entry() });
    await expect(client.activity_logs.delete({ where: { id: created.body.data.id } })).rejects.toThrow();
    expect(await client.activity_logs.findUnique({ where: { id: created.body.data.id } })).not.toBeNull();
  });
});
