// src/modules/student-report/reportData.refunds.test.js
// BUG-02 (dead refund-detection logic) — gatherStudentData used to look for
// payment.type === 'refund' to compute refundTotal, but a payment row never actually
// carries that value in the real data model (refunds live exclusively in treasury_txn,
// refType:'refund', status:'active'). refundTotal was therefore always 0 in practice,
// silently disabling the paid/refunded/netPaid fields and the "يوجد استرداد مالي" alert
// that buildStudentReport.js/buildAlerts already correctly consume. Now derived via
// getRefundedAmount, the real single source of truth used everywhere else.
import { describe, it, expect } from 'vitest';
import { gatherStudentData, buildAlerts } from './reportData';

const STUDENT_ID = 's1';
const STUDENT = { id: STUDENT_ID, name: 'طالب', groupId: null, monthlyFee: 1000 };

function storeWith(payments, treasuryTxn) {
  return {
    students: [STUDENT], groups: [], attendance: [], hwSubmissions: [], grades: [], exams: [],
    payments, communications: [], inventoryTxn: [], treasuryTxn,
  };
}

describe('gatherStudentData — paidTotal/refundTotal/netPaid are derived from treasury_txn (BUG-02)', () => {
  it('payment 1000, refund 0 -> paidTotal=1000, refundTotal=0, netPaid=1000', () => {
    const payments = [{ id: 'p1', studentId: STUDENT_ID, amount: 1000, date: '2026-01-01' }];
    const data = gatherStudentData(STUDENT_ID, storeWith(payments, []));
    expect(data.paidTotal).toBe(1000);
    expect(data.refundTotal).toBe(0);
    expect(data.netPaid).toBe(1000);
  });

  it('payment 1000, active refund 300 -> paidTotal=1000, refundTotal=300, netPaid=700', () => {
    const payments = [{ id: 'p1', studentId: STUDENT_ID, amount: 1000, date: '2026-01-01' }];
    const treasuryTxn = [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }];
    const data = gatherStudentData(STUDENT_ID, storeWith(payments, treasuryTxn));
    expect(data.paidTotal).toBe(1000);
    expect(data.refundTotal).toBe(300);
    expect(data.netPaid).toBe(700);
  });

  it('a legacy payment.type === "refund" field (the old, non-functional signal) no longer matters either way', () => {
    const payments = [{ id: 'p1', studentId: STUDENT_ID, amount: 1000, type: 'refund', date: '2026-01-01' }];
    const data = gatherStudentData(STUDENT_ID, storeWith(payments, []));
    // لا حركة خزنة فعلية مرتبطة بهذه الدفعة — لا استرداد حقيقي، بصرف النظر عن حقل type
    expect(data.paidTotal).toBe(1000);
    expect(data.refundTotal).toBe(0);
  });

  it('a cancelled (non-active) refund transaction is never deducted', () => {
    const payments = [{ id: 'p1', studentId: STUDENT_ID, amount: 1000, date: '2026-01-01' }];
    const treasuryTxn = [{ paymentId: 'p1', refType: 'refund', status: 'cancelled', amount: 300 }];
    const data = gatherStudentData(STUDENT_ID, storeWith(payments, treasuryTxn));
    expect(data.refundTotal).toBe(0);
    expect(data.netPaid).toBe(1000);
  });

  it('buildAlerts raises "يوجد استرداد مالي" once refundTotal is real (was unreachable before the fix)', () => {
    const payments = [{ id: 'p1', studentId: STUDENT_ID, amount: 1000, date: '2026-01-01' }];
    const treasuryTxn = [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }];
    const data = gatherStudentData(STUDENT_ID, storeWith(payments, treasuryTxn));
    expect(buildAlerts(data)).toContain('⚠ يوجد استرداد مالي');
  });

  it('missing treasuryTxn on the store object does not throw and behaves as no refunds', () => {
    const payments = [{ id: 'p1', studentId: STUDENT_ID, amount: 1000, date: '2026-01-01' }];
    const store = { students: [STUDENT], groups: [], attendance: [], hwSubmissions: [], grades: [], exams: [], payments, communications: [], inventoryTxn: [] };
    const data = gatherStudentData(STUDENT_ID, store);
    expect(data.refundTotal).toBe(0);
    expect(data.netPaid).toBe(1000);
  });
});
