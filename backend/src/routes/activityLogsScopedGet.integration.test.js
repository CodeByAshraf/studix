// backend/src/routes/activityLogsScopedGet.integration.test.js
// Scalability Architecture Phase 4 (activityLogs) — real PostgreSQL integration (scratch
// database only). Proves the new GET /api/activityLogs (backend/src/routes/activityLogs.js)
// returns deterministic newest-first ordering (timestamp DESC, id DESC tie-break), an exact
// total count over the whole table (not just the returned page), respects limit/offset, and
// preserves the exact ts/user/description field aliases ActivityLogPage.jsx/Dashboard.jsx
// already expect (same aliases COLLECTION_FIXUPS.activityLogs/normalizeActivityLogResponse
// apply elsewhere) — replacing the previous unfiltered, unordered generic CRUD GET that
// served this path before this phase.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
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

describe('GET /api/activityLogs — deterministic ordering, real total count (real PostgreSQL + Express, Phase 4)', () => {
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
    scratch = await setupScratchDb('activity_logs_scoped_get');
    client = scratch.client;

    const activityLogsRouter = (await import('./activityLogs.js')).default;
    const { errorHandler } = await import('../middleware/errorHandler.js');

    const app = express();
    app.use('/api/activityLogs', activityLogsRouter);
    app.use(errorHandler);
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    port = server.address().port;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (scratch) await teardownScratchDb(scratch);
  });

  // كل اختبار يتحقّق من total/الترتيب على كامل الجدول — تفريغه قبل كل اختبار يعزل كل
  // اختبار تماماً (نفس أسلوب paymentHistorySearch.integration.test.js's beforeEach).
  beforeEach(async () => {
    await client.activity_logs.deleteMany({});
  });

  async function seedLog(overrides = {}) {
    return client.activity_logs.create({
      data: {
        id: nextId('al'), action: 'create', module: 'students',
        details: 'تسجيل طالب', timestamp: new Date(), ...overrides,
      },
    });
  }

  it('no logs: returns an empty array and total 0, not an error', async () => {
    const res = await request(port, '/api/activityLogs');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it('returns items with the expected aliased fields (ts/user/description), plus the raw fields', async () => {
    const user = await client.users.create({ data: { id: nextId('u'), name: 'أحمد', active: true } });
    await seedLog({ user_id: user.id, user_name: user.name, module: 'payments', action: 'create', details: 'دفعة جديدة' });

    const res = await request(port, '/api/activityLogs');
    expect(res.body.data.items).toHaveLength(1);
    const item = res.body.data.items[0];
    expect(item.action).toBe('create');
    expect(item.module).toBe('payments');
    expect(item.user).toBe('أحمد'); // aliased from userName
    expect(item.description).toBe('دفعة جديدة'); // aliased from details
    expect(typeof item.ts).toBe('string'); // aliased from timestamp
    expect(item.id).toBeDefined();
  });

  it('a log with no user (userName null) aliases "user" to the fallback "النظام"', async () => {
    await seedLog({ user_id: null, user_name: null, details: 'حدث نظام' });
    const res = await request(port, '/api/activityLogs');
    expect(res.body.data.items[0].user).toBe('النظام');
  });

  it('default limit: returns a bounded page without an explicit limit', async () => {
    for (let i = 0; i < 10; i += 1) await seedLog({ timestamp: new Date(2026, 0, 1 + i) });
    const res = await request(port, '/api/activityLogs');
    expect(res.body.data.items.length).toBeGreaterThan(0);
    expect(res.body.data.items.length).toBeLessThanOrEqual(50); // default cap, all 10 seeded rows fit under it
    expect(res.body.data.total).toBe(10);
  });

  it('explicit limit is honored', async () => {
    for (let i = 0; i < 10; i += 1) await seedLog({ timestamp: new Date(2026, 0, 1 + i) });
    const res = await request(port, '/api/activityLogs?limit=3');
    expect(res.body.data.items).toHaveLength(3);
    expect(res.body.data.total).toBe(10);
  });

  it('offset is honored: page 2 returns a distinct, non-overlapping slice', async () => {
    for (let i = 0; i < 10; i += 1) await seedLog({ timestamp: new Date(2026, 0, 1 + i) });
    const page1 = await request(port, '/api/activityLogs?limit=4&offset=0');
    const page2 = await request(port, '/api/activityLogs?limit=4&offset=4');
    expect(page1.body.data.items).toHaveLength(4);
    expect(page2.body.data.items).toHaveLength(4);
    const ids1 = page1.body.data.items.map((r) => r.id);
    const ids2 = page2.body.data.items.map((r) => r.id);
    expect(ids1.some((id) => ids2.includes(id))).toBe(false);
  });

  it('deterministic newest-first ordering by timestamp', async () => {
    const oldest = await seedLog({ timestamp: new Date('2026-01-01T00:00:00.000Z'), details: 'oldest' });
    const middle = await seedLog({ timestamp: new Date('2026-01-02T00:00:00.000Z'), details: 'middle' });
    const newest = await seedLog({ timestamp: new Date('2026-01-03T00:00:00.000Z'), details: 'newest' });

    const res = await request(port, '/api/activityLogs?limit=50');
    expect(res.body.data.items.map((r) => r.id)).toEqual([newest.id, middle.id, oldest.id]);
  });

  it('tie-break: rows sharing the exact same timestamp are still ordered deterministically by id DESC', async () => {
    const sameTs = new Date('2026-01-05T12:00:00.000Z');
    const a = await seedLog({ id: 'al_aaa', timestamp: sameTs });
    const b = await seedLog({ id: 'al_bbb', timestamp: sameTs });
    const c = await seedLog({ id: 'al_ccc', timestamp: sameTs });

    const res1 = await request(port, '/api/activityLogs?limit=50');
    const res2 = await request(port, '/api/activityLogs?limit=50');
    const order1 = res1.body.data.items.map((r) => r.id);
    const order2 = res2.body.data.items.map((r) => r.id);
    // نفس الترتيب في كل مرة (حتمي) — وبالضبط ترتيب id تنازلي لثلاثتها بنفس التوقيت
    // ("al_ccc" > "al_bbb" > "al_aaa" نصياً).
    expect(order1).toEqual(order2);
    expect(order1).toEqual([c.id, b.id, a.id]);
  });

  it('total count reflects the complete table, not just the returned page', async () => {
    for (let i = 0; i < 25; i += 1) await seedLog({ timestamp: new Date(2026, 0, 1 + i) });
    const res = await request(port, '/api/activityLogs?limit=5');
    expect(res.body.data.items).toHaveLength(5);
    expect(res.body.data.total).toBe(25);
  });

  it('invalid limit/offset parameters are rejected with 400', async () => {
    const badLimit = await request(port, '/api/activityLogs?limit=abc');
    const negativeLimit = await request(port, '/api/activityLogs?limit=0');
    const overLimit = await request(port, '/api/activityLogs?limit=99999');
    const badOffset = await request(port, '/api/activityLogs?offset=-1');
    expect(badLimit.status).toBe(400);
    expect(negativeLimit.status).toBe(400);
    expect(overLimit.status).toBe(400);
    expect(badOffset.status).toBe(400);
  });

  it('PUT/PATCH/DELETE remain blocked with 405 (append-only, unchanged by this phase)', async () => {
    const log = await seedLog();
    const methods = ['PUT', 'PATCH', 'DELETE'];
    for (const method of methods) {
      const res = await new Promise((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port, path: `/api/activityLogs/${log.id}`, method },
          (res) => {
            let raw = '';
            res.on('data', (c) => { raw += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') }));
          }
        );
        req.on('error', reject);
        req.end();
      });
      expect(res.status, method).toBe(405);
    }
  });
});
