// backend/src/routes/materialDistribution.integration.test.js
// Production blocker fix pass — real PostgreSQL integration (scratch database only), same
// methodology as studentCreate.integration.test.js. Covers ONLY the inventory_txn.number
// concurrency fix added to saveMaterialDistribution (backend/src/routes/
// materialDistribution.js): concurrent distribution saves must never collide on the
// UNIQUE "INV-######" sequence and must never fail. No other materialDistribution.js
// behavior (idempotency/reconciliation semantics) is covered here — this file did not
// exist before this fix.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('materialDistribution.js — real PostgreSQL integration (concurrency)', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let client;
  let saveMaterialDistribution;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('material_distribution');
    client = scratch.client;
    ({ saveMaterialDistribution } = await import('./materialDistribution.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  async function seedStudent() {
    const id = nextId('s');
    return client.students.create({ data: { id, code: id, name: 'طالب اختبار', status: 'active' } });
  }

  async function seedMaterial() {
    const code = nextId('MAT');
    return client.inv_materials.create({ data: { code, name: 'مذكرة اختبار', price: 10 } });
  }

  it('E: real concurrent material distributions (different materials, racing for the same global INV sequence) never produce duplicate numbers, and none fail', async () => {
    const N = 8;
    const materials = await Promise.all(Array.from({ length: N }, () => seedMaterial()));
    const students = await Promise.all(Array.from({ length: N }, () => seedStudent()));

    const results = await Promise.allSettled(
      materials.map((material, i) =>
        saveMaterialDistribution(
          { materialId: String(material.id), records: [{ studentId: students[i].id, received: true }] },
          { createdBy: null }
        )
      )
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected.map((r) => r.reason?.message)).toEqual([]);
    expect(fulfilled).toHaveLength(N);

    const txnRows = await client.inventory_txn.findMany({
      where: { student_id: { in: students.map((s) => s.id) } },
      select: { number: true },
    });
    expect(txnRows).toHaveLength(N);
    const numbers = txnRows.map((r) => r.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
