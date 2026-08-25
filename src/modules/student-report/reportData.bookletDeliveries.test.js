// src/modules/student-report/reportData.bookletDeliveries.test.js
// Phase 3B-12 closure (Finding #3) — bookletDeliveries must recognize inventory_txn rows
// written by the Phase 3B-12 settlement endpoint (real student_id FK, recipient always
// null), while still matching legacy pre-migration rows (free-text recipient, no
// studentId). Pure-function test of gatherStudentData — no React, no network.
import { describe, it, expect } from 'vitest';
import { gatherStudentData } from './reportData';

const STUDENT_ID = 's1';
const STUDENT = { id: STUDENT_ID, name: 'أحمد علي', groupId: null };

function storeWith(inventoryTxn) {
  return {
    students: [STUDENT], groups: [], attendance: [], hwSubmissions: [], grades: [], exams: [],
    payments: [], communications: [], inventoryTxn,
  };
}

describe('gatherStudentData — bookletDeliveries (Phase 3B-12 Finding #3)', () => {
  it('recognizes a migrated delivery matched by studentId (real FK), even with no recipient', () => {
    const txn = { id: 't1', type: 'studentDelivery', studentId: STUDENT_ID, recipient: null };
    const data = gatherStudentData(STUDENT_ID, storeWith([txn]));
    expect(data.bookletDeliveries).toEqual([txn]);
  });

  it('still recognizes a legacy delivery matched only by recipient name (no studentId)', () => {
    const txn = { id: 't2', type: 'studentDelivery', studentId: null, recipient: 'استلم أحمد علي مذكرة الرياضيات' };
    const data = gatherStudentData(STUDENT_ID, storeWith([txn]));
    expect(data.bookletDeliveries).toEqual([txn]);
  });

  it('does not lose a migrated delivery just because recipient is absent (the exact regression)', () => {
    const txn = { id: 't3', type: 'studentDelivery', studentId: STUDENT_ID, recipient: undefined };
    const data = gatherStudentData(STUDENT_ID, storeWith([txn]));
    expect(data.bookletDeliveries).toHaveLength(1);
  });

  it("does not match another student's migrated delivery (studentId mismatch, no recipient)", () => {
    const txn = { id: 't4', type: 'studentDelivery', studentId: 'other-student', recipient: null };
    const data = gatherStudentData(STUDENT_ID, storeWith([txn]));
    expect(data.bookletDeliveries).toEqual([]);
  });

  it('ignores non-delivery transaction types regardless of studentId/recipient', () => {
    const txn = { id: 't5', type: 'reservation', studentId: STUDENT_ID, recipient: null };
    const data = gatherStudentData(STUDENT_ID, storeWith([txn]));
    expect(data.bookletDeliveries).toEqual([]);
  });

  it('a transaction matched by both studentId and recipient is not double-counted', () => {
    const txn = { id: 't6', type: 'studentDelivery', studentId: STUDENT_ID, recipient: 'أحمد علي' };
    const data = gatherStudentData(STUDENT_ID, storeWith([txn]));
    expect(data.bookletDeliveries).toEqual([txn]);
  });

  it('mixed history: one legacy delivery + one migrated delivery for the same student are both included', () => {
    const legacy = { id: 't7', type: 'studentDelivery', studentId: null, recipient: 'أحمد علي' };
    const migrated = { id: 't8', type: 'studentDelivery', studentId: STUDENT_ID, recipient: null };
    const data = gatherStudentData(STUDENT_ID, storeWith([legacy, migrated]));
    expect(data.bookletDeliveries).toHaveLength(2);
    expect(data.bookletDeliveries).toEqual(expect.arrayContaining([legacy, migrated]));
  });

  it('existing behavior intact: no inventoryTxn at all yields an empty, non-throwing result', () => {
    const data = gatherStudentData(STUDENT_ID, storeWith([]));
    expect(data.bookletDeliveries).toEqual([]);
  });
});
