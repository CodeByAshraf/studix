// src/modules/student-report/reportData.interactiveAdapter.test.js
// Scalability Architecture Phase 4 — StudentReportPage.jsx interactive tabs migration.
// buildInteractiveReportData(studentId, bundle) replaces the page's old inline `data`
// useMemo (which read payments/attendance/exams/grades/homeworks/hwSubmissions/
// invMaterials/inventoryTxn/treasuryTxn directly from the global Zustand store) with a
// pure adapter fed by the same scoped GET /students/:id/report-data bundle already used
// for the professional report/WhatsApp paths.
//
// This file proves two things:
//   1. The adapter reproduces every field the interactive JSX consumes, with correct
//      values, for a range of individual scenarios (payments, refunds, homeworks,
//      materials, timeline, missing student, cross-student isolation).
//   2. MANDATORY EQUIVALENCE TEST — the adapter's output is byte-for-byte identical to
//      what the OLD (now-removed) inline global-store derivation produced for the same
//      underlying facts. The OLD logic is reproduced verbatim below (frozen, not
//      imported — StudentReportPage.jsx no longer contains it) as the reference.
import { describe, it, expect } from 'vitest';
import { buildInteractiveReportData } from './reportData';
import { deriveMatDist } from '../../services/materialService';
import { formatCurrency } from '../../utils/helpers';
import { getRefundedAmount } from '../../services/paymentService';

const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                   'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const HW_META = {
  submitted: { label: 'سُلِّم',    c: '#10b981' },
  late:      { label: 'متأخر',    c: '#f59e0b' },
  missing:   { label: 'لم يُسلَّم', c: '#ef4444' },
};

// نسخة طبق الأصل من منطق StudentReportPage.jsx القديم (قبل هذه المرحلة) — مرجع الحقيقة
// لاختبار التكافؤ أدناه فقط، غير مُستورَدة من الكود الحقيقي عمداً (أُزيلت من الصفحة).
// تعمل على "store" كامل (كل الطلاب معاً)، بالضبط كما كانت الصفحة تقرأه من useAppStore.
function oldReferenceData(studentId, store) {
  const student = store.students.find((s) => s.id === studentId);
  if (!student) return null;
  const group = store.groups.find((g) => g.id === student.groupId) || null;

  const attAll     = store.attendance.filter((r) => r.studentId === student.id).sort((a, b) => a.date.localeCompare(b.date));
  const attPresent = attAll.filter((r) => r.status === 'present').length;
  const attAbsent  = attAll.filter((r) => r.status === 'absent').length;
  const attLate    = attAll.filter((r) => r.status === 'late').length;
  const attPct     = attAll.length ? Math.round(attPresent / attAll.length * 100) : null;

  const monthlyMap = {};
  attAll.forEach((r) => {
    const k = r.date.slice(0, 7);
    if (!monthlyMap[k]) monthlyMap[k] = { present: 0, absent: 0, late: 0, total: 0 };
    monthlyMap[k].total++;
    monthlyMap[k][r.status]++;
  });
  const attTrend = Object.entries(monthlyMap).sort(([a], [b]) => a.localeCompare(b))
    .map(([m, d]) => ({ label: m.slice(5), val: d.total ? Math.round(d.present / d.total * 100) : 0 }));

  const myGrades = store.grades.filter((g) => g.studentId === student.id);
  const examRows = myGrades.map((g) => {
    const exam = store.exams.find((e) => e.id === g.examId);
    if (!exam) return null;
    const pct = g.absent ? null : Math.round(g.score / exam.total * 100);
    return { exam, score: g.score, total: exam.total, pct, absent: g.absent, pass: exam.pass };
  }).filter(Boolean).sort((a, b) => a.exam.date.localeCompare(b.exam.date));
  const validExams  = examRows.filter((r) => !r.absent && r.pct != null);
  const avgExamPct  = validExams.length ? Math.round(validExams.reduce((s, r) => s + r.pct, 0) / validExams.length) : null;
  const passedExams = validExams.filter((r) => r.score >= r.pass).length;

  const myGroupHW = store.homeworks.filter((h) => h.groupId === student.groupId);
  const hwRows = myGroupHW.map((hw) => {
    const sub = store.hwSubmissions.find((s) => s.hwId === hw.id && s.studentId === student.id);
    return { hw, status: sub?.status || 'missing', submittedAt: sub?.submittedAt, score: sub?.score };
  }).sort((a, b) => a.hw.dueDate.localeCompare(b.hw.dueDate));
  const hwSubmitted = hwRows.filter((r) => r.status === 'submitted').length;
  const hwLate      = hwRows.filter((r) => r.status === 'late').length;
  const hwMissing   = hwRows.filter((r) => r.status === 'missing').length;

  const matDist = deriveMatDist(store.inventoryTxn);
  const matRows = matDist.filter((d) => d.studentId === student.id).map((d) => {
    const mat = store.materials.find((m) => m.id === d.matId);
    return mat ? { ...d, mat, remaining: Math.max(0, (Number(mat.price) || 0) - (Number(d.paidAmount) || 0)) } : null;
  }).filter(Boolean);
  const matReceived = matRows.filter((r) => r.received).length;
  const matPaid     = matRows.filter((r) => r.payStatus === 'paid').length;
  const matTotal    = matRows.reduce((s, r) => s + (r.paidAmount || 0), 0);

  const payRows  = store.payments.filter((p) => p.studentId === student.id).sort((a, b) => a.date.localeCompare(b.date));
  const totalPaid = payRows.reduce((s, p) => s + p.amount, 0);
  const refundedTotal = payRows.reduce((s, p) => s + getRefundedAmount(p.id, store.treasuryTxn), 0);
  const netPaid  = totalPaid - refundedTotal;
  const paidCount = payRows.filter((p) => p.status === 'paid').length;

  const timeline = [
    { date: student.enrollDate, icon: '🎓', title: 'التسجيل في المركز', sub: group?.name, color: '#0d9488', type: 'enroll' },
    ...payRows.map((p) => ({ date: p.date, icon: '💰', title: `دفع ${formatCurrency(p.amount)}`, sub: MONTHS_AR[(p.month || 1) - 1], color: '#10b981', type: 'payment' })),
    ...attAll.filter((r) => r.status !== 'present').map((r) => ({ date: r.date, icon: r.status === 'absent' ? '✗' : '⏱', title: r.status === 'absent' ? 'غياب' : 'حضور متأخر', sub: null, color: r.status === 'absent' ? '#ef4444' : '#f59e0b', type: 'attendance' })),
    ...examRows.map((r) => ({ date: r.exam.date, icon: '📝', title: r.exam.name, sub: r.absent ? 'غائب' : `${r.score}/${r.total}`, color: r.pct >= 60 ? '#8b5cf6' : '#ef4444', type: 'exam' })),
    ...hwRows.filter((r) => r.submittedAt).map((r) => ({ date: r.submittedAt, icon: '📋', title: `تسليم: ${r.hw.title}`, sub: HW_META[r.status]?.label, color: HW_META[r.status]?.c || '#94a3b8', type: 'hw' })),
    ...matRows.filter((r) => r.receivedAt).map((r) => ({ date: r.receivedAt, icon: '📚', title: `استلام: ${r.mat.name}`, sub: r.mat.subject, color: '#3b82f6', type: 'material' })),
  ].filter((t) => t.date).sort((a, b) => b.date.localeCompare(a.date));

  return {
    student, group,
    attAll, attPresent, attAbsent, attLate, attPct, attTrend,
    examRows, avgExamPct, passedExams, validExams,
    hwRows, hwSubmitted, hwLate, hwMissing,
    matRows, matReceived, matPaid, matTotal,
    payRows, totalPaid, refundedTotal, netPaid, paidCount,
    timeline,
  };
}

// Homework 2.0 Phase 2: homeworks now target grade (student.grade===homework.grade), not
// Group. This fixture deliberately keeps one grade per group (GRADE_A for g1's
// student/homeworks, GRADE_B for g2's) so the OLD frozen group-based reference below and
// the NEW grade-based real logic (reportData.js) still agree on the same partition for
// this scenario — the point of the equivalence test is "the refactor didn't change
// observable output for these facts," not re-testing the group-vs-grade business rule
// itself (that has its own dedicated coverage elsewhere: reportData.js's own inline
// comment, studentReport.integration.test.js's test F, HomeworkTracking.test.jsx, etc.).
const GRADE_A = 'الصف الأول الثانوي';
const GRADE_B = 'الصف الثاني الثانوي';
const G1 = { id: 'g1', name: 'مجموعة أ', teacher: 'أ. محمد' };
const G2 = { id: 'g2', name: 'مجموعة ب', teacher: 'أ. سارة' };
const S1 = { id: 's1', name: 'أحمد علي', groupId: 'g1', grade: GRADE_A, enrollDate: '2025-09-01', status: 'active', code: 'C1' };
const S2 = { id: 's2', name: 'نور خالد', groupId: 'g2', grade: GRADE_B, enrollDate: '2025-09-05', status: 'active', code: 'C2' };

const HW1 = { id: 'hw1', groupId: 'g1', grade: GRADE_A, title: 'واجب 1', subject: 'رياضيات', dueDate: '2026-01-10', totalScore: 10 };
const HW2 = { id: 'hw2', groupId: 'g1', grade: GRADE_A, title: 'واجب 2', subject: 'رياضيات', dueDate: '2026-01-20', totalScore: 10 };
const HW3_NOISE = { id: 'hw3', groupId: 'g2', grade: GRADE_B, title: 'واجب مجموعة ب', subject: 'علوم', dueDate: '2026-01-15', totalScore: 10 };

const E1 = { id: 'e1', name: 'اختبار 1', subject: 'رياضيات', date: '2026-01-08', total: 100, pass: 50 };
const E2 = { id: 'e2', name: 'اختبار 2', subject: 'رياضيات', date: '2026-02-08', total: 100, pass: 50 };

const MAT1 = { id: 'mat1', name: 'مذكرة الجبر', subject: 'رياضيات', price: 150 };

function buildFullFixture() {
  return {
    students: [S1, S2],
    groups: [G1, G2],
    attendance: [
      { id: 'a1', studentId: 's1', groupId: 'g1', date: '2026-01-03', status: 'present' },
      { id: 'a2', studentId: 's1', groupId: 'g1', date: '2026-01-10', status: 'absent' },
      { id: 'a3', studentId: 's1', groupId: 'g1', date: '2026-01-17', status: 'late' },
      { id: 'a4', studentId: 's1', groupId: 'g1', date: '2026-02-03', status: 'present' },
      { id: 'a-noise', studentId: 's2', groupId: 'g2', date: '2026-01-03', status: 'present' },
    ],
    exams: [E1, E2],
    grades: [
      { id: 'g-1', studentId: 's1', examId: 'e1', score: 80, absent: false },
      { id: 'g-2', studentId: 's1', examId: 'e2', score: 0, absent: true }, // غائب — لا نسبة
      { id: 'g-noise', studentId: 's2', examId: 'e1', score: 60, absent: false },
    ],
    homeworks: [HW1, HW2, HW3_NOISE],
    hwSubmissions: [
      { id: 'sub1', hwId: 'hw1', studentId: 's1', status: 'submitted', submittedAt: '2026-01-09', score: 9 },
      // hw2: بلا تسليم إطلاقاً — يجب أن يظهر "missing" افتراضياً
      { id: 'sub-noise', hwId: 'hw3', studentId: 's2', status: 'submitted', submittedAt: '2026-01-14', score: 8 },
    ],
    payments: [
      { id: 'p1', studentId: 's1', amount: 500, month: 1, year: 2026, date: '2026-01-05', status: 'paid', method: 'cash', notes: null },
      { id: 'p2', studentId: 's1', amount: 300, month: 1, year: 2026, date: '2026-01-12', status: 'partial', method: 'cash', notes: null },
      { id: 'p3', studentId: 's1', amount: 400, month: 2, year: 2026, date: '2026-02-01', status: 'unpaid', method: 'transfer', notes: 'ملاحظة' },
      { id: 'p-noise', studentId: 's2', amount: 999, month: 1, year: 2026, date: '2026-01-01', status: 'paid', method: 'cash', notes: null },
    ],
    treasuryTxn: [
      { paymentId: 'p1', refType: 'refund', status: 'active', amount: 100 },     // استرداد فعلي
      { paymentId: 'p2', refType: 'refund', status: 'cancelled', amount: 50 },   // ملغى — لا يُطرَح
      { paymentId: 'p-noise', refType: 'refund', status: 'active', amount: 999 }, // ضوضاء طالب آخر
    ],
    inventoryTxn: [
      { id: 'inv1', materialId: 'mat1', studentId: 's1', type: 'studentDelivery', status: 'active', createdAt: '2026-01-06T00:00:00.000Z',
        legacyMetadata: { payStatus: 'partial', paidAmount: 50, receivedAt: '2026-01-06' } },
      { id: 'inv-noise', materialId: 'mat1', studentId: 's2', type: 'studentDelivery', status: 'active', createdAt: '2026-01-06T00:00:00.000Z',
        legacyMetadata: { payStatus: 'paid', paidAmount: 150, receivedAt: '2026-01-06' } },
    ],
    materials: [MAT1],
    invMaterials: [MAT1],
    communications: [],
  };
}

function toBundle(fixture, studentId) {
  const student = fixture.students.find((s) => s.id === studentId);
  return {
    students: [student],
    groups: fixture.groups.filter((g) => g.id === student.groupId),
    attendance: fixture.attendance.filter((r) => r.studentId === studentId),
    grades: fixture.grades.filter((g) => g.studentId === studentId),
    exams: fixture.exams,
    // Homework 2.0 Phase 2: mirrors the real scoped backend query (studentReport.js —
    // grade-based, not group_id-based).
    homeworks: fixture.homeworks.filter((h) => h.grade === student.grade),
    hwSubmissions: fixture.hwSubmissions.filter((s) => s.studentId === studentId),
    payments: fixture.payments.filter((p) => p.studentId === studentId),
    treasuryTxn: fixture.treasuryTxn.filter((t) =>
      fixture.payments.filter((p) => p.studentId === studentId).some((p) => p.id === t.paymentId)
    ),
    inventoryTxn: fixture.inventoryTxn.filter((t) => t.studentId === studentId),
    invMaterials: fixture.invMaterials,
    communications: [],
  };
}

describe('buildInteractiveReportData — focused scenarios', () => {
  it('normal student with payments: payRows/totalPaid/paidCount are correct', () => {
    const fixture = buildFullFixture();
    const data = buildInteractiveReportData('s1', toBundle(fixture, 's1'));
    expect(data.payRows.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']); // sorted ascending by date
    expect(data.totalPaid).toBe(1200);
    expect(data.paidCount).toBe(1); // only p1 has status 'paid'
  });

  it('zero-payment student: empty payRows, zero totals, no crash', () => {
    const fixture = buildFullFixture();
    fixture.payments = fixture.payments.filter((p) => p.studentId !== 's1');
    fixture.treasuryTxn = [];
    const data = buildInteractiveReportData('s1', toBundle(fixture, 's1'));
    expect(data.payRows).toEqual([]);
    expect(data.totalPaid).toBe(0);
    expect(data.refundedTotal).toBe(0);
    expect(data.netPaid).toBe(0);
    expect(data.paidCount).toBe(0);
  });

  it('multiple payments in the same month: both rows present, correctly summed', () => {
    const fixture = buildFullFixture();
    const data = buildInteractiveReportData('s1', toBundle(fixture, 's1'));
    const januaryRows = data.payRows.filter((p) => p.month === 1);
    expect(januaryRows).toHaveLength(2);
    expect(januaryRows.reduce((s, p) => s + p.amount, 0)).toBe(800);
  });

  it('multiple months: rows for both months present, sorted ascending', () => {
    const fixture = buildFullFixture();
    const data = buildInteractiveReportData('s1', toBundle(fixture, 's1'));
    expect(data.payRows.map((p) => p.month)).toEqual([1, 1, 2]);
  });

  it('paid/partial/unpaid statuses are each preserved on their row, only paid counted in paidCount', () => {
    const fixture = buildFullFixture();
    const data = buildInteractiveReportData('s1', toBundle(fixture, 's1'));
    expect(data.payRows.map((p) => p.status)).toEqual(['paid', 'partial', 'unpaid']);
    expect(data.paidCount).toBe(1);
  });

  it('active refund is deducted: refundedTotal/netPaid correct', () => {
    const fixture = buildFullFixture();
    const data = buildInteractiveReportData('s1', toBundle(fixture, 's1'));
    expect(data.refundedTotal).toBe(100); // only p1's active refund
    expect(data.netPaid).toBe(1200 - 100);
  });

  it('cancelled/non-active refund is never deducted', () => {
    const fixture = buildFullFixture();
    // فقط الاسترداد الملغى لـ p2 — لا استرداد فعلي إطلاقاً
    fixture.treasuryTxn = [{ paymentId: 'p2', refType: 'refund', status: 'cancelled', amount: 50 }];
    const data = buildInteractiveReportData('s1', toBundle(fixture, 's1'));
    expect(data.refundedTotal).toBe(0);
    expect(data.netPaid).toBe(data.totalPaid);
  });

  it('booklet/material payments: matRows enriched with material name/price/remaining, reflects the latest inventory_txn state', () => {
    const fixture = buildFullFixture();
    const data = buildInteractiveReportData('s1', toBundle(fixture, 's1'));
    expect(data.matRows).toHaveLength(1);
    expect(data.matRows[0].mat.name).toBe('مذكرة الجبر');
    expect(data.matRows[0].received).toBe(true);
    expect(data.matRows[0].remaining).toBe(100); // 150 - 50
  });

  it('a later "return" transaction supersedes an earlier "studentDelivery" for the same (material, student) pair', () => {
    const fixture = buildFullFixture();
    fixture.inventoryTxn.push({
      id: 'inv1-return', materialId: 'mat1', studentId: 's1', type: 'return', status: 'active',
      createdAt: '2026-01-20T00:00:00.000Z', legacyMetadata: {},
    });
    const data = buildInteractiveReportData('s1', toBundle(fixture, 's1'));
    expect(data.matRows).toHaveLength(1);
    expect(data.matRows[0].received).toBe(false); // آخر حركة نشطة هي "return"، لا "studentDelivery"
  });

  it('homeworks: every group homework appears, including ones never submitted (defaults to "missing")', () => {
    const fixture = buildFullFixture();
    const data = buildInteractiveReportData('s1', toBundle(fixture, 's1'));
    expect(data.hwRows).toHaveLength(2); // hw1 + hw2 (hw3 belongs to g2 — excluded)
    const hw2Row = data.hwRows.find((r) => r.hw.id === 'hw2');
    expect(hw2Row.status).toBe('missing');
    expect(hw2Row.submittedAt).toBeUndefined();
    const hw1Row = data.hwRows.find((r) => r.hw.id === 'hw1');
    expect(hw1Row.status).toBe('submitted');
    expect(hw1Row.score).toBe(9);
  });

  it('exams: an absent-marked grade has a null percentage and is excluded from avgExamPct/passedExams', () => {
    const fixture = buildFullFixture();
    const data = buildInteractiveReportData('s1', toBundle(fixture, 's1'));
    expect(data.examRows).toHaveLength(2);
    const absentRow = data.examRows.find((r) => r.exam.id === 'e2');
    expect(absentRow.absent).toBe(true);
    expect(absentRow.pct).toBeNull();
    expect(data.validExams).toHaveLength(1); // فقط e1
    expect(data.avgExamPct).toBe(80);
  });

  it('timeline: events from every source are merged and sorted newest-first', () => {
    const fixture = buildFullFixture();
    const data = buildInteractiveReportData('s1', toBundle(fixture, 's1'));
    const dates = data.timeline.map((t) => t.date);
    const sorted = [...dates].sort().reverse();
    expect(dates).toEqual(sorted);
    expect(data.timeline.some((t) => t.type === 'payment')).toBe(true);
    expect(data.timeline.some((t) => t.type === 'attendance')).toBe(true);
    expect(data.timeline.some((t) => t.type === 'exam')).toBe(true);
    expect(data.timeline.some((t) => t.type === 'hw')).toBe(true);
    expect(data.timeline.some((t) => t.type === 'material')).toBe(true);
    expect(data.timeline.some((t) => t.type === 'enroll')).toBe(true);
  });

  it('nonexistent student: returns null, does not throw', () => {
    const fixture = buildFullFixture();
    const bundle = { students: [], groups: [], attendance: [], grades: [], exams: [], homeworks: [], hwSubmissions: [], payments: [], treasuryTxn: [], inventoryTxn: [], invMaterials: [], communications: [] };
    expect(buildInteractiveReportData('does-not-exist', bundle)).toBeNull();
  });

  it('cross-student isolation: s2\'s noise data never leaks into s1\'s report', () => {
    const fixture = buildFullFixture();
    const data = buildInteractiveReportData('s1', toBundle(fixture, 's1'));
    expect(data.payRows.every((p) => p.studentId === 's1')).toBe(true);
    expect(data.attAll.every((r) => r.studentId === 's1')).toBe(true);
    expect(data.hwRows.every((r) => r.hw.groupId === 'g1')).toBe(true);
    expect(data.matRows.every((r) => r.studentId === 's1')).toBe(true);
    expect(data.totalPaid).toBe(1200); // لا 999 دفعة الضوضاء
  });
});

describe('buildInteractiveReportData — MANDATORY equivalence with the old global-store derivation', () => {
  it('produces byte-for-byte identical derived output to the old inline logic, for the same underlying facts', () => {
    const fixture = buildFullFixture();

    for (const studentId of ['s1', 's2']) {
      const old = oldReferenceData(studentId, fixture);
      const scopedBundle = toBundle(fixture, studentId);
      const neu = buildInteractiveReportData(studentId, scopedBundle);

      expect(neu.payRows, `payRows for ${studentId}`).toEqual(old.payRows);
      expect(neu.totalPaid, `totalPaid for ${studentId}`).toBe(old.totalPaid);
      expect(neu.refundedTotal, `refundedTotal for ${studentId}`).toBe(old.refundedTotal);
      expect(neu.netPaid, `netPaid for ${studentId}`).toBe(old.netPaid);
      expect(neu.paidCount, `paidCount for ${studentId}`).toBe(old.paidCount);
      expect(neu.timeline, `timeline for ${studentId}`).toEqual(old.timeline);
      expect(neu.attPct, `attPct for ${studentId}`).toBe(old.attPct);
      expect(neu.attAll, `attAll for ${studentId}`).toEqual(old.attAll);
      expect(neu.attPresent, `attPresent for ${studentId}`).toBe(old.attPresent);
      expect(neu.attAbsent, `attAbsent for ${studentId}`).toBe(old.attAbsent);
      expect(neu.attLate, `attLate for ${studentId}`).toBe(old.attLate);
      expect(neu.attTrend, `attTrend for ${studentId}`).toEqual(old.attTrend);
      expect(neu.examRows, `examRows for ${studentId}`).toEqual(old.examRows);
      expect(neu.avgExamPct, `avgExamPct for ${studentId}`).toBe(old.avgExamPct);
      expect(neu.passedExams, `passedExams for ${studentId}`).toBe(old.passedExams);
      expect(neu.hwRows, `hwRows for ${studentId}`).toEqual(old.hwRows);
      expect(neu.hwSubmitted, `hwSubmitted for ${studentId}`).toBe(old.hwSubmitted);
      expect(neu.hwLate, `hwLate for ${studentId}`).toBe(old.hwLate);
      expect(neu.hwMissing, `hwMissing for ${studentId}`).toBe(old.hwMissing);
      expect(neu.matRows, `matRows for ${studentId}`).toEqual(old.matRows);
      expect(neu.matReceived, `matReceived for ${studentId}`).toBe(old.matReceived);
      expect(neu.matPaid, `matPaid for ${studentId}`).toBe(old.matPaid);
      expect(neu.matTotal, `matTotal for ${studentId}`).toBe(old.matTotal);
    }
  });

  it('boundary case: a student with zero activity anywhere produces identical (empty/null) output old vs new', () => {
    const fixture = buildFullFixture();
    fixture.students.push({ id: 's3', name: 'طالب فارغ', groupId: null, enrollDate: '2026-01-01', status: 'active', code: 'C3' });

    const old = oldReferenceData('s3', fixture);
    const neu = buildInteractiveReportData('s3', toBundle(fixture, 's3'));

    expect(neu).toEqual(old);
  });
});
