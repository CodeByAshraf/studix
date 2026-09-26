// backend/src/routes/groupDelete.integration.test.js
// Phase 2.1 (Homework behavioral cleanup) — DELETE /api/groups/:id homework guard. Real
// PostgreSQL + Express, mounting the real middleware chain (requireAuth stand-in +
// requirePermission('groups')) exactly as server.js does, followed by the real generic CRUD
// router for groups. Proves:
//   - Group deletion requires exactly the 'groups' permission — with or without 'homework'.
//   - A user without 'groups' (even with 'homework') is rejected 403; unauthenticated 401.
//   - The grade-based homework rule is enforced server-side for every authorized caller, and
//     does not leak into unrelated groups (other grade, grade-less group).
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED" test is
// recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

function del(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'DELETE', headers }, (res) => {
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

describe('DELETE /api/groups/:id — homework guard + authorization (real Express + PostgreSQL, Phase 2.1)', () => {
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
    scratch = await setupScratchDb('group_delete_guard');
    client = scratch.client;

    const { requirePermission } = await import('../middleware/permissions.js');
    const { errorHandler } = await import('../middleware/errorHandler.js');
    const { makeCrudRouter } = await import('./crud.js');
    const groupDeleteRouter = (await import('./groupDelete.js')).default;

    function stubAuth(req, res, next) {
      const raw = req.headers['x-test-user'];
      req.user = raw ? JSON.parse(raw) : undefined;
      next();
    }

    // Same order as server.js: the guard router first, then the generic CRUD for groups.
    const app = express();
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
    return { 'x-test-user': JSON.stringify({ id: user.id, userAuthVersion: user.auth_version, roleAuthVersion: null }) };
  }

  async function seedGroup(grade) {
    return client.groups.create({ data: { id: nextId('g'), name: 'مجموعة اختبار', grade } });
  }

  async function seedHomework(grade) {
    return client.homeworks.create({
      data: { id: nextId('hw'), title: 'واجب اختبار', grade, due_date: new Date('2026-01-15T00:00:00.000Z') },
    });
  }

  const exists = async (id) => (await client.groups.findUnique({ where: { id } })) !== null;

  // ── 1. Authorized Group manager WITH the homework permission ──
  it('groups+homework user: deletes a group whose grade has no homework', async () => {
    const headers = await seedUser(['groups', 'homework']);
    const g = await seedGroup(`grade_${nextId('x')}`);
    const res = await del(port, `/api/groups/${g.id}`, headers);
    expect(res.status).toBe(200);
    expect(await exists(g.id)).toBe(false);
  });

  it('groups+homework user: is blocked with 409 GROUP_HAS_HOMEWORK when the grade has homework', async () => {
    const headers = await seedUser(['groups', 'homework']);
    const grade = `grade_${nextId('x')}`;
    const g = await seedGroup(grade);
    await seedHomework(grade);
    await seedHomework(grade);
    const res = await del(port, `/api/groups/${g.id}`, headers);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ ok: false, code: 'GROUP_HAS_HOMEWORK', error: 'لا يمكن حذف المجموعة — لها 2 واجب مسجَّل.' });
    expect(await exists(g.id)).toBe(true);
  });

  // ── 2. Authorized Group manager WITHOUT the homework permission ──
  it('groups-only user (no homework permission): deletes a group whose grade has no homework', async () => {
    const headers = await seedUser(['groups']);
    const g = await seedGroup(`grade_${nextId('x')}`);
    const res = await del(port, `/api/groups/${g.id}`, headers);
    expect(res.status).toBe(200);
    expect(await exists(g.id)).toBe(false);
  });

  it('groups-only user (no homework permission): the homework rule still applies (409, not 403)', async () => {
    const headers = await seedUser(['groups']);
    const grade = `grade_${nextId('x')}`;
    const g = await seedGroup(grade);
    await seedHomework(grade);
    const res = await del(port, `/api/groups/${g.id}`, headers);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('GROUP_HAS_HOMEWORK');
    expect(await exists(g.id)).toBe(true);
  });

  // ── 3. Unauthorized users ──
  it('a user without the groups permission (even with homework) is rejected 403 and nothing is deleted', async () => {
    const headers = await seedUser(['homework', 'students']);
    const g = await seedGroup(`grade_${nextId('x')}`);
    const res = await del(port, `/api/groups/${g.id}`, headers);
    expect(res.status).toBe(403);
    expect(await exists(g.id)).toBe(true);
  });

  it('unauthenticated is rejected 401 and nothing is deleted', async () => {
    const g = await seedGroup(`grade_${nextId('x')}`);
    const res = await del(port, `/api/groups/${g.id}`);
    expect(res.status).toBe(401);
    expect(await exists(g.id)).toBe(true);
  });

  // ── Rule scope ──
  it('homework of a different grade does not block deletion', async () => {
    const headers = await seedUser(['groups']);
    const grade = `grade_${nextId('x')}`;
    const g = await seedGroup(grade);
    await seedHomework(`${grade}_other`);
    const res = await del(port, `/api/groups/${g.id}`, headers);
    expect(res.status).toBe(200);
  });

  it('a grade-less legacy group is not blocked by grade-less homework rows', async () => {
    const headers = await seedUser(['groups']);
    const g = await seedGroup(null);
    await seedHomework(null);
    const res = await del(port, `/api/groups/${g.id}`, headers);
    expect(res.status).toBe(200);
  });

  it('a missing group falls through to the generic CRUD delete unchanged (404)', async () => {
    const headers = await seedUser(['groups']);
    const res = await del(port, `/api/groups/${nextId('missing')}`, headers);
    expect(res.status).toBe(404);
  });
});
