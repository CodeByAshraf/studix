// backend/src/routes/homeworksScopedGet.integration.test.js
// Phase 2 (Homework global-read migration). Real PostgreSQL + Express integration (scratch
// database only), same structure as hwSubmissionsScopedGet.integration.test.js. Proves:
//   - GET /api/homeworks with no params returns every row the generic unfiltered route would
//     (boot-sync still depends on it), in the same neutral order (Phase 2.1: no server sort).
//   - ?grade= returns only that grade's homeworks.
//   - A present-but-empty grade is rejected with 400 before any lookup.
//   - Only GET / is intercepted: GET /:id still falls through to the next router.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED" test is
// recorded instead of a silent skip or a hard failure.
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

describe('GET /api/homeworks (real PostgreSQL + Express integration, Phase 2)', () => {
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
    scratch = await setupScratchDb('homeworks_scoped_get');
    client = scratch.client;

    const homeworksScopedGetRouter = (await import('./homeworksScopedGet.js')).default;
    const { errorHandler } = await import('../middleware/errorHandler.js');

    const app = express();
    app.use('/api/homeworks', homeworksScopedGetRouter);
    // Stand-in for the generic CRUD router mounted after it in server.js.
    app.get('/api/homeworks/:id', (req, res) => res.json({ ok: true, fellThrough: req.params.id }));
    app.use(errorHandler);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    port = server.address().port;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (scratch) await teardownScratchDb(scratch);
  });

  async function seedHomework(overrides = {}) {
    const id = nextId('hw');
    return client.homeworks.create({
      data: { id, title: 'واجب اختبار', due_date: new Date('2026-01-15T00:00:00.000Z'), ...overrides },
    });
  }

  it('GET / with no params returns every row the generic unfiltered route would, in the same (unsorted) order', async () => {
    await seedHomework({ due_date: new Date('2026-01-01T00:00:00.000Z') });
    await seedHomework({ due_date: new Date('2026-03-01T00:00:00.000Z') });
    await seedHomework({ due_date: new Date('2026-02-01T00:00:00.000Z') });

    const res = await request(port, '/api/homeworks');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const generic = await client.homeworks.findMany({});
    expect(res.body.count).toBe(generic.length);
    // Same query as the generic route (findMany, no orderBy) → same rows in the same order;
    // seeded out of due-date order, so a reintroduced server sort would fail this.
    expect(res.body.data.map((r) => r.id)).toEqual(generic.map((r) => r.id));
    const dates = res.body.data.map((r) => r.dueDate);
    expect(dates).not.toEqual([...dates].sort().reverse());
    // Same camelCase shape the boot-sync normalizer expects.
    expect(res.body.data[0]).toHaveProperty('dueDate');
    expect(res.body.data[0]).toHaveProperty('totalScore');
  });

  it('GET /?grade=... returns only that grade\'s homeworks', async () => {
    const grade = `grade_${nextId('g')}`;
    const a = await seedHomework({ grade });
    const b = await seedHomework({ grade });
    await seedHomework({ grade: `${grade}_other` });
    await seedHomework({ grade: null });

    const res = await request(port, `/api/homeworks?grade=${encodeURIComponent(grade)}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.data.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('a grade with no homework returns an empty result, not an error', async () => {
    const res = await request(port, `/api/homeworks?grade=${encodeURIComponent('لا يوجد')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: [], count: 0 });
  });

  it('a present-but-empty grade is rejected with 400 before any lookup', async () => {
    const res = await request(port, '/api/homeworks?grade=');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('GET /:id is not intercepted — it falls through to the next router', async () => {
    const res = await request(port, '/api/homeworks/some_id');
    expect(res.status).toBe(200);
    expect(res.body.fellThrough).toBe('some_id');
  });
});
