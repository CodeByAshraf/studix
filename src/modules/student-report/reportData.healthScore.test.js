// src/modules/student-report/reportData.healthScore.test.js
// computeHealthScore ("تفصيل العوامل" — Student Report health-score breakdown) had no
// dedicated tests before this fix. Three factors (homework/financial/communication) used
// to invent a positive default (8/15, 10/10, 5/10) whenever there was genuinely no data —
// this violated "do not invent positive activity" for a brand-new student. Fixed to
// "no data = 0" (Option 1, explicit product decision). Attendance and exams were already
// correct and are covered here only as regression guards — their behavior is unchanged.
import { describe, it, expect } from 'vitest';
import { computeHealthScore } from './reportData';

const ZERO_ATTENDANCE = { total: 0, present: 0, absent: 0, late: 0, pct: null };

function baseData(overrides = {}) {
  return {
    attendance: ZERO_ATTENDANCE,
    examAvg: null,
    hwRate: null,
    netPaid: 0,
    monthlyFee: 0,
    communications: [],
    ...overrides,
  };
}

function factor(breakdown, label) {
  return breakdown.find((b) => b.label === label);
}

describe('computeHealthScore', () => {
  it('A. brand-new student, zero activity everywhere: every factor is 0, no invented positive default, total score is 0', () => {
    const hs = computeHealthScore(baseData());

    expect(factor(hs.breakdown, 'الحضور')).toEqual({ label: 'الحضور', score: 0, max: 30 });
    expect(factor(hs.breakdown, 'الامتحانات')).toEqual({ label: 'الامتحانات', score: 0, max: 35 });
    expect(factor(hs.breakdown, 'الواجبات')).toEqual({ label: 'الواجبات', score: 0, max: 15 });
    expect(factor(hs.breakdown, 'الانضباط المالي')).toEqual({ label: 'الانضباط المالي', score: 0, max: 10 });
    expect(factor(hs.breakdown, 'التواصل')).toEqual({ label: 'التواصل', score: 0, max: 10 });
    expect(hs.score).toBe(0);
  });

  it('B. homework with no submission records -> 0/15 (not the old invented 8/15)', () => {
    const hs = computeHealthScore(baseData({ hwRate: null }));
    expect(factor(hs.breakdown, 'الواجبات')).toEqual({ label: 'الواجبات', score: 0, max: 15 });
  });

  it('C. financial: monthlyFee = 0 and no payments -> 0/10, explicitly NOT the old invented 10/10', () => {
    const hs = computeHealthScore(baseData({ monthlyFee: 0, netPaid: 0 }));
    const fin = factor(hs.breakdown, 'الانضباط المالي');
    expect(fin).toEqual({ label: 'الانضباط المالي', score: 0, max: 10 });
    expect(fin.score).not.toBe(10);
  });

  it('D. financial: monthlyFee > 0 and zero payments -> remains 0/10 (already-correct behavior, unchanged)', () => {
    const hs = computeHealthScore(baseData({ monthlyFee: 500, netPaid: 0 }));
    expect(factor(hs.breakdown, 'الانضباط المالي')).toEqual({ label: 'الانضباط المالي', score: 0, max: 10 });
  });

  it('E. communication: zero records -> 0/10, explicitly NOT the old invented 5/10', () => {
    const hs = computeHealthScore(baseData({ communications: [] }));
    const comm = factor(hs.breakdown, 'التواصل');
    expect(comm).toEqual({ label: 'التواصل', score: 0, max: 10 });
    expect(comm.score).not.toBe(5);
  });

  it('F. real homework activity: existing percentage calculation still works (75% of 15 = 11)', () => {
    const hs = computeHealthScore(baseData({ hwRate: 75 }));
    expect(factor(hs.breakdown, 'الواجبات')).toEqual({ label: 'الواجبات', score: 11, max: 15 });
  });

  it('G. real communication records: existing positive behavior still works (flat 10/10)', () => {
    const hs = computeHealthScore(baseData({ communications: [{ id: 'c1', createdAt: '2026-01-01T00:00:00.000Z' }] }));
    expect(factor(hs.breakdown, 'التواصل')).toEqual({ label: 'التواصل', score: 10, max: 10 });
  });

  it('H. attendance: no records -> 0/30, and the real-percentage calculation remains unchanged (e.g. 20/25 present -> 24/30)', () => {
    const hsEmpty = computeHealthScore(baseData({ attendance: ZERO_ATTENDANCE }));
    expect(factor(hsEmpty.breakdown, 'الحضور')).toEqual({ label: 'الحضور', score: 0, max: 30 });

    const hsReal = computeHealthScore(baseData({ attendance: { total: 25, present: 20, absent: 5, late: 0, pct: 80 } }));
    expect(factor(hsReal.breakdown, 'الحضور')).toEqual({ label: 'الحضور', score: 24, max: 30 });
  });

  it('H2. small-sample attendance (1/1 present -> 100%) is intentionally left unchanged in this task', () => {
    const hs = computeHealthScore(baseData({ attendance: { total: 1, present: 1, absent: 0, late: 0, pct: 100 } }));
    expect(factor(hs.breakdown, 'الحضور')).toEqual({ label: 'الحضور', score: 30, max: 30 });
  });

  it('I. exams: no exam/grade records -> 0/35, unchanged', () => {
    const hs = computeHealthScore(baseData({ examAvg: null }));
    expect(factor(hs.breakdown, 'الامتحانات')).toEqual({ label: 'الامتحانات', score: 0, max: 35 });
  });

  it('I2. real exam average is still scored proportionally (unchanged, regression guard)', () => {
    const hs = computeHealthScore(baseData({ examAvg: 80 }));
    expect(factor(hs.breakdown, 'الامتحانات')).toEqual({ label: 'الامتحانات', score: 28, max: 35 });
  });
});
