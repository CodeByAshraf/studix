// backend/src/routes/materials.integration.test.js
// inv_materials (materials) لا مسار مخصّص لها — الـ CRUD العام فقط (crud.js، غير مُعدَّل
// عمداً). added_at عمود @db.Date nullable — الفرونت-إند (src/services/api.js،
// buildMaterialRequestBody) يُطبِّع "YYYY-MM-DD" إلى ISO-8601 كامل عبر toRequestDate قبل
// الإرسال (نفس مبدأ enroll_date/treasury date). هذا الاختبار يتحقّق من نفس المسار الحقيقي
// الذي يستخدمه crud.js (prepareWriteData + Prisma) ضد PostgreSQL فعلي — لا mocking.
//
// npm run test:integration فقط. لو PostgreSQL غير متاح، تُسجَّل حالة "SKIPPED" واحدة واضحة.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkPostgresReachable, setupScratchDb, teardownScratchDb } from '../test-helpers/scratchDb.js';
import { prepareWriteData } from './crud.js';

const dbCheck = await checkPostgresReachable();

describe('inv_materials (materials) — added_at real PostgreSQL integration', () => {
  if (!dbCheck.reachable) {
    it.skip(`SKIPPED — PostgreSQL scratch DB unavailable: ${dbCheck.reason}`, () => {});
    return;
  }

  let scratch;
  let client;
  let seq = 0;

  beforeAll(async () => {
    scratch = await setupScratchDb('materials');
    client = scratch.client;
  }, 60_000);

  afterAll(async () => {
    if (scratch) await teardownScratchDb(scratch);
  });

  function nextCode() {
    seq += 1;
    return `MAT-TEST-${seq}-${Date.now()}`;
  }

  it('persists a full-ISO addedAt (as sent by the frontend toRequestDate helper) with no timezone shift', async () => {
    const { data } = prepareWriteData('inv_materials', {
      name: 'مذكرة اختبار', price: 10, addedAt: '2026-03-05T00:00:00.000Z',
    });
    data.code = nextCode();

    const row = await client.inv_materials.create({ data });
    expect(row.added_at.toISOString().slice(0, 10)).toBe('2026-03-05');
  });

  it('omitting addedAt leaves the column null, no crash (nullable column, no default)', async () => {
    const { data } = prepareWriteData('inv_materials', { name: 'بلا تاريخ إضافة', price: 5 });
    data.code = nextCode();

    const row = await client.inv_materials.create({ data });
    expect(row.added_at).toBeNull();
  });
});
