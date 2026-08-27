// src/modules/payments/buildPaymentsReport.test.js
// BUG-02 (remaining part):
// - openPaymentsReportPrint: "collected"/status(paid/partial/unpaid)/the overdue list all
//   used to derive from a raw payments.amount sum, so a refunded subscription payment kept
//   counting as fully collected. Now nets out active refunds (getRefundedAmount) — all
//   three derive from the same net totalPaid per student.
// - openStudentPaymentsReport: this IS a printed historical statement — the itemized
//   payments table shows the original per-transaction amounts unmodified, so "إجمالي
//   المدفوع" stays a Gross figure matching those rows exactly. A refund is now shown as a
//   separate "المسترد" figure, with "الصافي" = Gross − Refunded, instead of silently
//   replacing the total with a number that would no longer match the table beneath it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openPaymentsReportPrint, openStudentPaymentsReport } from './buildPaymentsReport';
import { fmtMoney } from '../../utils/printStyles';

let writtenHtml;
function mockWindow() {
  writtenHtml = '';
  const win = {
    document: {
      open: vi.fn(),
      write: vi.fn((html) => { writtenHtml += html; }),
      close: vi.fn(),
    },
    focus: vi.fn(),
  };
  vi.spyOn(window, 'open').mockReturnValue(win);
  return win;
}

const GROUP = { id: 'g1', name: 'مجموعة أ', price: 1000 };
const PROFILE = {};

function student(id, name) {
  return { id, name, code: id.toUpperCase(), groupId: 'g1', status: 'active', grade: 'الأول الثانوي' };
}

describe('openPaymentsReportPrint — "collected"/status/overdue list all derive from the same net figure (BUG-02)', () => {
  beforeEach(() => { mockWindow(); });

  it('a fully-paid, unrefunded student -> status "paid", appears nowhere in the overdue table', () => {
    const now = new Date();
    const students = [student('s1', 'أحمد')];
    const payments = [{ id: 'p1', studentId: 's1', month: now.getMonth() + 1, year: now.getFullYear(), amount: 1000, payType: 'subscription', date: now.toISOString().split('T')[0] }];
    openPaymentsReportPrint({ group: GROUP, month: now.getMonth() + 1, year: now.getFullYear(), students, payments, profile: PROFILE, treasuryTxn: [] });
    expect(writtenHtml).toContain('كل الطلاب دفعوا اشتراك');
    expect(writtenHtml).not.toContain('المتأخرون عن الدفع');
  });

  it('a 300/1000 refund on the only payment drops the student to "partial" and into the overdue list', () => {
    const now = new Date();
    const students = [student('s1', 'أحمد')];
    const payments = [{ id: 'p1', studentId: 's1', month: now.getMonth() + 1, year: now.getFullYear(), amount: 1000, payType: 'subscription', date: now.toISOString().split('T')[0] }];
    const treasuryTxn = [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }];
    openPaymentsReportPrint({ group: GROUP, month: now.getMonth() + 1, year: now.getFullYear(), students, payments, profile: PROFILE, treasuryTxn });
    expect(writtenHtml).toContain('المتأخرون عن الدفع');
    expect(writtenHtml).not.toContain('كل الطلاب دفعوا اشتراك');
  });

  it('a cancelled (non-active) refund transaction does not affect the collected/status figures', () => {
    const now = new Date();
    const students = [student('s1', 'أحمد')];
    const payments = [{ id: 'p1', studentId: 's1', month: now.getMonth() + 1, year: now.getFullYear(), amount: 1000, payType: 'subscription', date: now.toISOString().split('T')[0] }];
    const treasuryTxn = [{ paymentId: 'p1', refType: 'refund', status: 'cancelled', amount: 300 }];
    openPaymentsReportPrint({ group: GROUP, month: now.getMonth() + 1, year: now.getFullYear(), students, payments, profile: PROFILE, treasuryTxn });
    expect(writtenHtml).toContain('كل الطلاب دفعوا اشتراك');
  });

  it('multiple students: a refund on one does not affect another student\'s fully-paid status', () => {
    const now = new Date();
    const students = [student('s1', 'أحمد'), student('s2', 'محمد')];
    const payments = [
      { id: 'p1', studentId: 's1', month: now.getMonth() + 1, year: now.getFullYear(), amount: 1000, payType: 'subscription', date: now.toISOString().split('T')[0] },
      { id: 'p2', studentId: 's2', month: now.getMonth() + 1, year: now.getFullYear(), amount: 1000, payType: 'subscription', date: now.toISOString().split('T')[0] },
    ];
    const treasuryTxn = [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 1000 }];
    openPaymentsReportPrint({ group: GROUP, month: now.getMonth() + 1, year: now.getFullYear(), students, payments, profile: PROFILE, treasuryTxn });
    // محمد ما زال مدفوعاً بالكامل رغم استرداد أحمد الكامل
    expect(writtenHtml).toContain('محمد');
    expect(writtenHtml).toContain('المتأخرون عن الدفع'); // أحمد بات غير مدفوع
  });
});

describe('openStudentPaymentsReport — Gross / Refunded / Net (BUG-02, printed historical statement)', () => {
  beforeEach(() => { mockWindow(); });

  it('no refund: shows only "إجمالي المدفوع", no "المسترد"/"الصافي" clutter', () => {
    const payments = [{ id: 'p1', studentId: 's1', amount: 1000, date: '2026-01-01', method: 'cash', status: 'paid' }];
    openStudentPaymentsReport({ student: student('s1', 'أحمد'), group: GROUP, payments, profile: PROFILE, treasuryTxn: [] });
    expect(writtenHtml).toContain('إجمالي المدفوع');
    expect(writtenHtml).not.toContain('المسترد');
  });

  it('payment 1000, refund 300: Gross stays 1000 (matches the itemized row), Refunded=300, Net=700', () => {
    const payments = [{ id: 'p1', studentId: 's1', amount: 1000, date: '2026-01-01', method: 'cash', status: 'paid' }];
    const treasuryTxn = [{ paymentId: 'p1', refType: 'refund', status: 'active', amount: 300 }];
    openStudentPaymentsReport({ student: student('s1', 'أحمد'), group: GROUP, payments, profile: PROFILE, treasuryTxn });
    // الصف الخام في الجدول يبقى 1000 (تاريخي، بلا تعديل) — والإجمالي يطابقه تماماً
    expect(writtenHtml).toContain(fmtMoney(1000));
    expect(writtenHtml).toContain('المسترد');
    expect(writtenHtml).toContain('الصافي');
    expect(writtenHtml).toContain(fmtMoney(300));
    expect(writtenHtml).toContain(fmtMoney(700));
  });
});
