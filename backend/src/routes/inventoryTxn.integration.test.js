// backend/src/routes/inventoryTxn.integration.test.js
// State Synchronization Audit fix — createManualInventoryTxn (backend/src/routes/
// inventoryTxn.js) previously did not exist at all: InventoryPage.jsx's manual
// transaction/physical-count flows only ever wrote to local Zustand state, never to
// PostgreSQL. Real PostgreSQL integration (scratch database only), same methodology as
// materialDistribution.integration.test.js/materialDistributionPayment.integration.test.js.
//
// npm run test:integration only. If PostgreSQL is unreachable, a single clear "SKIPPED"
// test is recorded instead of a silent skip or a hard failure.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';

const dbCheck = await checkPostgresReachable();

describe('inventoryTxn.js — createManualInventoryTxn real PostgreSQL integration', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let client;
  let createManualInventoryTxn;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('inventory_txn_manual');
    client = scratch.client;
    ({ createManualInventoryTxn } = await import('./inventoryTxn.js'));
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextId(prefix) {
    seq += 1;
    return `${prefix}_${seq}_${Date.now()}`;
  }

  async function seedMaterial(overrides = {}) {
    const code = nextId('MAT');
    return client.inv_materials.create({ data: { code, name: 'مذكرة اختبار', price: 100, ...overrides } });
  }

  it('A. a manual transaction creates a real row: unique INV-###### number, correct real columns, extra fields preserved via legacy_metadata and flattened back on the response', async () => {
    const material = await seedMaterial();

    const saved = await createManualInventoryTxn({
      materialId: String(material.id), type: 'purchase', quantity: 50,
      employee: 'موظف الاختبار', reason: 'شراء دفعة جديدة', notes: 'ملاحظة',
      batchNo: 'B-001', unitCost: 5.5, recipient: null,
    }, { userId: null });

    expect(saved.number).toMatch(/^INV-\d{6}$/);
    expect(saved.materialId).toBe(String(material.id));
    expect(saved.type).toBe('purchase');
    // quantity/unitCost أعمدة Decimal حقيقية — الاستدعاء المباشر هنا (بلا HTTP/JSON) يُعيد
    // كائن Prisma.Decimal الخام؛ التطبيع لرقم يحدث فقط في غلاف الفرونت-إند (pgCreateInventoryTxn
    // في src/services/api.js)، نفس مبدأ باقي هذا الملف الاختباري (استدعاء الدالة مباشرة).
    expect(Number(saved.quantity)).toBe(50);
    expect(saved.batchNo).toBe('B-001');
    expect(Number(saved.unitCost)).toBe(5.5);
    // حقول بلا عمود حقيقي — تعود مُسطَّحة من legacy_metadata مباشرة.
    expect(saved.employee).toBe('موظف الاختبار');
    expect(saved.reason).toBe('شراء دفعة جديدة');

    const dbRow = await client.inventory_txn.findUnique({ where: { id: saved.id } });
    expect(dbRow).not.toBeNull();
    expect(dbRow.number).toBe(saved.number);
    expect(Number(dbRow.quantity)).toBe(50);
    expect(dbRow.batch_no).toBe('B-001');
    expect(Number(dbRow.unit_cost)).toBe(5.5);
    expect(dbRow.legacy_metadata).toMatchObject({ employee: 'موظف الاختبار', reason: 'شراء دفعة جديدة', notes: 'ملاحظة' });
    expect(dbRow.status).toBe('active');
  });

  it('B. a physical-count adjustment (type=adjustment) preserves countedQty/systemQty and allows a negative quantity', async () => {
    const material = await seedMaterial();

    const saved = await createManualInventoryTxn({
      materialId: String(material.id), type: 'adjustment', quantity: -3,
      reason: 'جرد فعلي — المعدود 7 مقابل المحسوب 10', countedQty: 7, systemQty: 10, employee: 'موظف',
    }, { userId: null });

    expect(Number(saved.quantity)).toBe(-3);
    expect(saved.countedQty).toBe(7);
    expect(saved.systemQty).toBe(10);

    const dbRow = await client.inventory_txn.findUnique({ where: { id: saved.id } });
    expect(Number(dbRow.quantity)).toBe(-3);
    expect(dbRow.legacy_metadata).toMatchObject({ countedQty: 7, systemQty: 10 });
  });

  it('C. rejects an invalid type with a 400-style error, zero rows created', async () => {
    const material = await seedMaterial();
    const before = await client.inventory_txn.count();

    await expect(createManualInventoryTxn({
      materialId: String(material.id), type: 'not-a-real-type', quantity: 5,
    }, { userId: null })).rejects.toMatchObject({ status: 400 });

    expect(await client.inventory_txn.count()).toBe(before);
  });

  it('C2. rejects a non-existent material, zero rows created', async () => {
    const before = await client.inventory_txn.count();

    await expect(createManualInventoryTxn({
      materialId: '999999999', type: 'purchase', quantity: 5,
    }, { userId: null })).rejects.toMatchObject({ status: 400 });

    expect(await client.inventory_txn.count()).toBe(before);
  });

  // إثبات حتمي، لا احتمالاً إحصائياً — الضمان يأتي من القفل الاستشاري المُشترَك مع
  // materialDistribution.js (نفس INVENTORY_NUMBER_ADVISORY_LOCK_KEY)، لا فحص سابق عرضة
  // لسباق. نفس منهجية اختبار التزامن في materialDistribution.integration.test.js.
  it('D. two genuinely concurrent manual transactions never produce duplicate INV-###### numbers', async () => {
    const material = await seedMaterial();

    const [a, b] = await Promise.all([
      createManualInventoryTxn({ materialId: String(material.id), type: 'purchase', quantity: 10 }, { userId: null }),
      createManualInventoryTxn({ materialId: String(material.id), type: 'purchase', quantity: 20 }, { userId: null }),
    ]);

    expect(a.number).not.toBe(b.number);
    const rows = await client.inventory_txn.findMany({ where: { material_id: material.id } });
    const numbers = rows.map((r) => r.number);
    expect(new Set(numbers).size).toBe(numbers.length); // لا تكرار إطلاقاً
  });
});
