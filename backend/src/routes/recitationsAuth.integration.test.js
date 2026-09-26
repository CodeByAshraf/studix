// backend/src/routes/recitationsAuth.integration.test.js
// Recitation Assessment — Phase 2: authorization-boundary check for the new dedicated
// 'recitation' permission. Same technique as cashboxBalanceAuth.integration.test.js: a
// real ephemeral-port Express app mounting the real middleware chain (requireAuth +
// requirePermission('recitation')) exactly as server.js does, driven with real HTTP
// requests (Node's built-in http.request — no supertest dependency in this project).
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

function request(port, { method = 'GET', path = '/', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method, headers },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch { /* no/invalid body */ }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('GET /api/recitation-sessions — 20. recitation permission boundary (real Express + PostgreSQL)', () => {
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
    scratch = await setupScratchDb('recitations_auth');
    client = scratch.client;

    const { requirePermission } = await import('../middleware/permissions.js');
    const { errorHandler } = await import('../middleware/errorHandler.js');
    const recitationsRouter = (await import('./recitations.js')).default;

    const app = express();
    app.use(express.json());
    app.use('/api/recitation-sessions', (req, res, next) => {
      const raw = req.headers['x-test-user'];
      req.user = raw ? JSON.parse(raw) : undefined;
      next();
    }, requirePermission('recitation'), recitationsRouter);
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

  it('an authenticated user WITH the recitation permission gets a 200', async () => {
    const user = await seedUser(nextId('u'), ['recitation']);

    const res = await request(port, {
      path: '/api/recitation-sessions',
      headers: { 'x-test-user': JSON.stringify(user) },
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('an authenticated user WITH the attendance permission but NOT recitation is rejected with 403 (permissions are not shared)', async () => {
    const user = await seedUser(nextId('u'), ['attendance']);

    const res = await request(port, {
      path: '/api/recitation-sessions',
      headers: { 'x-test-user': JSON.stringify(user) },
    });

    expect(res.status).toBe(403);
  });

  it('an unauthenticated request (no req.user at all) is rejected with 401', async () => {
    const res = await request(port, { path: '/api/recitation-sessions' });
    expect(res.status).toBe(401);
  });
});
