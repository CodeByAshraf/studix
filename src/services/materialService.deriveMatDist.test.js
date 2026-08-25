// src/services/materialService.deriveMatDist.test.js
// matDist read-path migration — deriveMatDist replaces the local, never-boot-synced
// matDist state with a pure derivation over inventoryTxn (already PostgreSQL-backed,
// already boot-synced). Mirrors backend/src/routes/materialDistribution.js's own
// read-only selection rule exactly (RELEVANT_TYPES, status!='cancelled', latest per
// student) — this is the read side of the same logic, not a new decision. Pure-function
// test, no React/network, same pattern as reportData.bookletDeliveries.test.js
// (Phase 3B-12 Finding #3).
import { describe, it, expect } from 'vitest';
import { deriveMatDist } from './materialService';

function txn(overrides) {
  return {
    id: 't1', materialId: '7', studentId: 's1', type: 'studentDelivery', status: 'active',
    createdAt: '2026-01-01T10:00:00.000Z', legacyMetadata: { payStatus: 'unpaid', paidAmount: 0, receivedAt: null },
    ...overrides,
  };
}

describe('deriveMatDist', () => {
  it('a studentDelivery row produces received:true with payStatus/paidAmount/receivedAt from legacyMetadata', () => {
    const t = txn({ legacyMetadata: { payStatus: 'paid', paidAmount: 100, receivedAt: '2026-01-05' } });
    const result = deriveMatDist([t]);
    expect(result).toEqual([{ id: 't1', matId: '7', studentId: 's1', received: true, receivedAt: '2026-01-05', payStatus: 'paid', paidAmount: 100 }]);
  });

  it('a reservation row (never delivered) produces received:false', () => {
    const t = txn({ type: 'reservation', legacyMetadata: { payStatus: 'paid', paidAmount: 50, receivedAt: null } });
    const result = deriveMatDist([t]);
    expect(result).toEqual([{ id: 't1', matId: '7', studentId: 's1', received: false, receivedAt: null, payStatus: 'paid', paidAmount: 50 }]);
  });

  it('a cancelled row is excluded entirely — the exact client-side equivalent of Phase 3B-12 Finding #1', () => {
    const t = txn({ status: 'cancelled', type: 'studentDelivery' });
    expect(deriveMatDist([t])).toEqual([]);
  });

  it('the most recent of two rows for the same student wins, regardless of array order', () => {
    const older = txn({ id: 'old', type: 'reservation', createdAt: '2026-01-01T00:00:00.000Z' });
    const newer = txn({ id: 'new', type: 'studentDelivery', createdAt: '2026-01-02T00:00:00.000Z' });
    // ترتيب معكوس عمداً — يجب ألا يعتمد الاشتقاق على ترتيب المصفوفة، فقط على createdAt.
    const result = deriveMatDist([newer, older]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('new');
    expect(result[0].received).toBe(true);
  });

  it('a reservationRelease after a reservation correctly resolves to not-received, with no leftover reservation entry', () => {
    const reservation = txn({ id: 'r1', type: 'reservation', createdAt: '2026-01-01T00:00:00.000Z' });
    const release = txn({ id: 'r2', type: 'reservationRelease', createdAt: '2026-01-02T00:00:00.000Z' });
    const result = deriveMatDist([reservation, release]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r2');
    expect(result[0].received).toBe(false);
  });

  it('a delivered-then-returned student correctly resolves to not-received', () => {
    const delivery = txn({ id: 'd1', type: 'studentDelivery', createdAt: '2026-01-01T00:00:00.000Z' });
    const ret = txn({ id: 'd2', type: 'return', createdAt: '2026-01-02T00:00:00.000Z' });
    const result = deriveMatDist([delivery, ret]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('d2');
    expect(result[0].received).toBe(false);
  });

  it('missing legacyMetadata defaults to payStatus:unpaid, paidAmount:0, receivedAt:null', () => {
    const t = txn({ legacyMetadata: null });
    const result = deriveMatDist([t]);
    expect(result[0]).toMatchObject({ payStatus: 'unpaid', paidAmount: 0, receivedAt: null });
  });

  it('a student with no relevant transaction history for a material produces no entry at all (not a defaulted one)', () => {
    // نفس isUntouchedDefault في materialDistribution.js — لا حركة = لا سجل، لا افتراضي مُصطنَع.
    expect(deriveMatDist([])).toEqual([]);
  });

  it('irrelevant transaction types (e.g. purchase/damaged) are ignored entirely', () => {
    const t = txn({ type: 'purchase' });
    expect(deriveMatDist([t])).toEqual([]);
  });

  it('two different students on the same material both produce independent entries', () => {
    const a = txn({ id: 'a', studentId: 's1' });
    const b = txn({ id: 'b', studentId: 's2' });
    const result = deriveMatDist([a, b]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.studentId).sort()).toEqual(['s1', 's2']);
  });

  it('two different materials for the same student both produce independent entries', () => {
    const a = txn({ id: 'a', materialId: '7' });
    const b = txn({ id: 'b', materialId: '9' });
    const result = deriveMatDist([a, b]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.matId).sort()).toEqual(['7', '9']);
  });
});
