// src/modules/student-report/reportData.recitation.test.js
// Recitation → Student Professional Report integration. recitationRows/avgRecitationPct
// are computed identically in gatherStudentData (professional PDF/WhatsApp path) and
// buildInteractiveReportData (on-screen/simple-print path, via `gathered.recitationRows`
// — no duplicated logic). Every historical recitation record is its own row; percentage
// is always derived via scorePercent, never read from a stored field (none exists).
import { describe, it, expect } from 'vitest';
import { gatherStudentData, buildInteractiveReportData } from './reportData';

const STUDENT_ID = 's1';
const STUDENT = { id: STUDENT_ID, name: 'أشرف محمد', groupId: null, enrollDate: '2026-01-01' };
const OTHER_ID = 's2';

function baseStore(overrides = {}) {
  return {
    students: [STUDENT], groups: [], attendance: [], grades: [], exams: [],
    payments: [], treasuryTxn: [], communications: [],
    ...overrides,
  };
}

const REC_1 = {
  id: 'r1', sessionId: 'sess1', studentId: STUDENT_ID, groupId: 'g1', groupName: 'مجموعة أ',
  date: '2026-01-10', sessionTime: '10:00', score: 18, maxScore: 20, note: 'ممتاز',
};
const REC_2 = {
  id: 'r2', sessionId: 'sess2', studentId: STUDENT_ID, groupId: 'g1', groupName: 'مجموعة أ',
  date: '2026-01-03', sessionTime: '09:00', score: 7, maxScore: 10, note: null,
};
const OTHER_STUDENT_REC = {
  id: 'r3', sessionId: 'sess1', studentId: OTHER_ID, groupId: 'g1', groupName: 'مجموعة أ',
  date: '2026-01-10', sessionTime: '10:00', score: 5, maxScore: 20, note: null,
};

describe('gatherStudentData — recitationRows/avgRecitationPct', () => {
  it('no recitations: empty rows, null average, zero evaluated count', () => {
    const data = gatherStudentData(STUDENT_ID, baseStore());
    expect(data.recitationRows).toEqual([]);
    expect(data.avgRecitationPct).toBeNull();
    expect(data.evaluatedRecitationCount).toBe(0);
  });

  it('multiple historical sessions each remain their own row — never merged or aggregated', () => {
    const data = gatherStudentData(STUDENT_ID, baseStore({ recitations: [REC_1, REC_2, OTHER_STUDENT_REC] }));

    expect(data.recitationRows).toHaveLength(2); // OTHER_STUDENT_REC excluded
    // newest first
    expect(data.recitationRows[0].date).toBe('2026-01-10');
    expect(data.recitationRows[1].date).toBe('2026-01-03');
    expect(data.recitationRows[0].groupName).toBe('مجموعة أ');
    expect(data.recitationRows[0].sessionTime).toBe('10:00');
    expect(data.recitationRows[0].note).toBe('ممتاز');
  });

  it('percentage is derived via scorePercent (score/maxScore), never a stored field', () => {
    const data = gatherStudentData(STUDENT_ID, baseStore({ recitations: [REC_1, REC_2] }));

    const row1 = data.recitationRows.find((r) => r.date === '2026-01-10');
    const row2 = data.recitationRows.find((r) => r.date === '2026-01-03');
    expect(row1.pct).toBe(90); // 18/20
    expect(row2.pct).toBe(70); // 7/10
  });

  it('average percentage is computed ONLY from evaluated (valid-pct) rows, never divided by a larger denominator', () => {
    const data = gatherStudentData(STUDENT_ID, baseStore({ recitations: [REC_1, REC_2] }));
    // (90 + 70) / 2 = 80
    expect(data.avgRecitationPct).toBe(80);
    expect(data.evaluatedRecitationCount).toBe(2);
  });

  it('a row with an invalid/zero maxScore yields pct=null and is excluded from the average (defensive — should not occur in practice)', () => {
    const invalidMax = { ...REC_1, maxScore: 0 };
    const data = gatherStudentData(STUDENT_ID, baseStore({ recitations: [invalidMax, REC_2] }));

    const row = data.recitationRows.find((r) => r.date === '2026-01-10');
    expect(row.pct).toBeNull();
    expect(data.avgRecitationPct).toBe(70); // only REC_2 counted
    expect(data.evaluatedRecitationCount).toBe(1);
  });
});

describe('buildInteractiveReportData — recitation fields reuse gatherStudentData, plus a timeline entry', () => {
  it('exposes the same recitationRows/avgRecitationPct computed by gatherStudentData', () => {
    const bundle = baseStore({ recitations: [REC_1, REC_2] });
    const gathered = gatherStudentData(STUDENT_ID, bundle);
    const interactive = buildInteractiveReportData(STUDENT_ID, bundle);

    expect(interactive.recitationRows).toEqual(gathered.recitationRows);
    expect(interactive.avgRecitationPct).toBe(gathered.avgRecitationPct);
    expect(interactive.evaluatedRecitationCount).toBe(gathered.evaluatedRecitationCount);
  });

  it('adds one timeline entry per recitation record, dated correctly, never merged with another session', () => {
    const bundle = baseStore({ recitations: [REC_1, REC_2] });
    const interactive = buildInteractiveReportData(STUDENT_ID, bundle);

    const recitationEntries = interactive.timeline.filter((t) => t.type === 'recitation');
    expect(recitationEntries).toHaveLength(2);
    expect(recitationEntries.map((t) => t.date).sort()).toEqual(['2026-01-03', '2026-01-10']);
  });

  it('a student with no recitations: empty rows, no recitation timeline entries, no crash', () => {
    const interactive = buildInteractiveReportData(STUDENT_ID, baseStore());
    expect(interactive.recitationRows).toEqual([]);
    expect(interactive.timeline.filter((t) => t.type === 'recitation')).toEqual([]);
  });
});
