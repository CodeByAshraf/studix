// backend/src/routes/treasuryTxn.test.js
// اختبار وحدة صرف (بلا قاعدة بيانات) لـ parseTreasuryDate فقط — عمداً في ملف منفصل عن
// treasuryTxn.integration.test.js: استيراد treasuryTxn.js هنا يُحمِّل prisma.js (المُتصل
// بـ DATABASE_URL الحقيقي عبر singleton عادي)، وهو ما لا يجوز أن يحدث في نفس الملف الذي
// يعتمد على استيراد ديناميكي مؤجَّل بعد setupScratchDb لالتقاط قاعدة scratch (انظر توضيح
// treasuryTxn.integration.test.js) — لا اتصال فعلي بقاعدة بيانات يحدث هنا إطلاقاً، فلا
// خطر من الاستيراد الثابت العادي.
import { describe, it, expect } from 'vitest';
import { parseTreasuryDate } from './treasuryTxn.js';

describe('parseTreasuryDate', () => {
  it('normalizes a plain YYYY-MM-DD string to UTC midnight (no timezone shift)', () => {
    const parsed = parseTreasuryDate('2026-03-05');
    expect(parsed.toISOString()).toBe('2026-03-05T00:00:00.000Z');
  });

  it('accepts an already-full ISO-8601 string unchanged', () => {
    const parsed = parseTreasuryDate('2026-03-05T12:30:00.000Z');
    expect(parsed.toISOString()).toBe('2026-03-05T12:30:00.000Z');
  });

  it('returns null for an unparseable date string', () => {
    expect(parseTreasuryDate('not-a-date')).toBeNull();
  });

  it('returns null for non-string/non-Date input', () => {
    expect(parseTreasuryDate(12345)).toBeNull();
    expect(parseTreasuryDate(null)).toBeNull();
  });
});
