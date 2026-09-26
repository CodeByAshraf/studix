// src/modules/student-report/reportData.scopedBundle.test.js
// Scalability Architecture Phase 2 — StudentReportPage.jsx used to feed gatherStudentData
// a manually-assembled "fullStore" object that omitted hwSubmissions/invMaterials (never
// added when those fields were introduced to gatherStudentData) — so the printed/WhatsApp
// report's homework score was always null and every booklet delivery's name/price/
// remaining were always blank, regardless of real data. The new server-scoped bundle
// (pgGetStudentReportData, wired into StudentReportPage.jsx) includes both fields
// correctly. This file locks in that exact before/after behavior as a deliberate,
// documented correction — not a silent change to gatherStudentData itself (which is
// untouched; only what's fed into it changed).
import { describe, it, expect } from 'vitest';
import { gatherStudentData } from './reportData';

const STUDENT_ID = 's1';
const STUDENT = { id: STUDENT_ID, name: 'أشرف محمد', groupId: null };

const HW_SUBMISSIONS = [
  { id: 'sub1', homeworkId: 'hw1', studentId: STUDENT_ID, status: 'submitted' },
  { id: 'sub2', homeworkId: 'hw2', studentId: STUDENT_ID, status: 'missing' },
];

const MATERIAL = { id: 'mat1', name: 'مذكرة الرياضيات', price: 200 };
const INVENTORY_TXN = [{
  id: 'inv1', materialId: 'mat1', type: 'studentDelivery', studentId: STUDENT_ID,
  legacyMetadata: { payStatus: 'partial', paidAmount: 100, receivedAt: '2026-01-05' },
}];

function baseStore(overrides = {}) {
  return {
    students: [STUDENT], groups: [], attendance: [], grades: [], exams: [],
    payments: [], treasuryTxn: [], communications: [],
    ...overrides,
  };
}

describe('reportData — hwSubmissions/invMaterials scoped-bundle fix (Phase 2 documented correction)', () => {
  it('BEFORE (reproduces the old fullStore bug): a bundle missing hwSubmissions/invMaterials always yields a null homework rate and blank booklet enrichment, even with real data present elsewhere', () => {
    const buggyBundle = baseStore({ inventoryTxn: INVENTORY_TXN }); // hwSubmissions/invMaterials keys absent, exactly like the old fullStore
    const data = gatherStudentData(STUDENT_ID, buggyBundle);

    expect(data.hwRate).toBeNull();
    expect(data.hwTotal).toBe(0);
    expect(data.bookletDeliveries).toHaveLength(1);
    expect(data.bookletDeliveries[0].materialName).toBeNull();
    expect(data.bookletDeliveries[0].price).toBe(0);
    expect(data.bookletDeliveries[0].remaining).toBe(0);
  });

  it('AFTER (the fix): a complete bundle including hwSubmissions/invMaterials produces the real homework rate and real booklet enrichment', () => {
    const completeBundle = baseStore({
      hwSubmissions: HW_SUBMISSIONS,
      inventoryTxn: INVENTORY_TXN,
      invMaterials: [MATERIAL],
    });
    const data = gatherStudentData(STUDENT_ID, completeBundle);

    expect(data.hwTotal).toBe(2);
    expect(data.hwDone).toBe(1);
    expect(data.hwRate).toBe(50);
    expect(data.bookletDeliveries).toHaveLength(1);
    expect(data.bookletDeliveries[0].materialName).toBe('مذكرة الرياضيات');
    expect(data.bookletDeliveries[0].price).toBe(200);
    expect(data.bookletDeliveries[0].paidAmount).toBe(100);
    expect(data.bookletDeliveries[0].remaining).toBe(100);
  });

  it('a properly student-scoped bundle (as the new backend endpoint returns) produces the exact same result as filtering a larger, multi-student store for the same underlying facts', () => {
    const otherStudentNoise = {
      attendance: [{ id: 'a-noise', studentId: 'other', status: 'present', date: '2026-01-01' }],
      grades: [{ id: 'g-noise', studentId: 'other', examId: 'ex-noise', score: 10 }],
      hwSubmissions: [{ id: 'sub-noise', homeworkId: 'hw-noise', studentId: 'other', status: 'submitted' }],
      payments: [{ id: 'p-noise', studentId: 'other', amount: 500, month: 1, year: 2026, date: '2026-01-01' }],
      communications: [{ id: 'c-noise', phone: '000', studentName: 'غير ذلك', createdAt: '2026-01-01T00:00:00.000Z' }],
      inventoryTxn: [{ id: 'inv-noise', materialId: 'mat-noise', type: 'studentDelivery', studentId: 'other', legacyMetadata: {} }],
    };

    const thisStudentFacts = {
      attendance: [{ id: 'a1', studentId: STUDENT_ID, status: 'present', date: '2026-01-05' }],
      hwSubmissions: HW_SUBMISSIONS,
      inventoryTxn: INVENTORY_TXN,
      invMaterials: [MATERIAL],
    };

    // "old style": one big store containing this student's facts mixed with noise from
    // other students — mirrors what useAppStore's global collections actually look like.
    const bigMultiStudentStore = baseStore({
      attendance: [...thisStudentFacts.attendance, ...otherStudentNoise.attendance],
      grades: [...otherStudentNoise.grades],
      hwSubmissions: [...thisStudentFacts.hwSubmissions, ...otherStudentNoise.hwSubmissions],
      payments: [...otherStudentNoise.payments],
      communications: [...otherStudentNoise.communications],
      inventoryTxn: [...thisStudentFacts.inventoryTxn, ...otherStudentNoise.inventoryTxn],
      invMaterials: thisStudentFacts.invMaterials,
    });

    // "new style": a bundle pre-scoped to only this student — exactly what
    // GET /students/:id/report-data returns.
    const scopedBundle = baseStore({
      attendance: thisStudentFacts.attendance,
      hwSubmissions: thisStudentFacts.hwSubmissions,
      inventoryTxn: thisStudentFacts.inventoryTxn,
      invMaterials: thisStudentFacts.invMaterials,
    });

    const oldResult = gatherStudentData(STUDENT_ID, bigMultiStudentStore);
    const newResult = gatherStudentData(STUDENT_ID, scopedBundle);

    expect(newResult).toEqual(oldResult);
  });

  it('zero-activity student still produces the exact same (all-zero/null) shape from a scoped bundle as from an empty global store', () => {
    const emptyGlobalStore = baseStore({ hwSubmissions: [], inventoryTxn: [], invMaterials: [] });
    const emptyScopedBundle = baseStore({ hwSubmissions: [], inventoryTxn: [], invMaterials: [] });

    expect(gatherStudentData(STUDENT_ID, emptyScopedBundle)).toEqual(gatherStudentData(STUDENT_ID, emptyGlobalStore));
  });
});
