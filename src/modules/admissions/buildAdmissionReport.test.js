// src/modules/admissions/buildAdmissionReport.test.js
// BUG-02 (printed historical statement) — the itemized admission-payments table shows the
// original per-transaction amounts unmodified, so "إجمالي المدفوع" stays a Gross figure
// matching those rows exactly. Refunds (recorded exclusively as treasury_txn expense rows
// linked by admissionId — same reference implementation as AdmissionsPage's DetailsPanel)
// now surface as a separate "المسترد" figure, with "الصافي" = Gross − Refunded.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openAdmissionReport } from './buildAdmissionReport';
import { fmtMoney } from '../../utils/printStyles';

let writtenHtml;
function mockWindow() {
  writtenHtml = '';
  const win = { document: { open: vi.fn(), write: vi.fn((html) => { writtenHtml += html; }), close: vi.fn() }, focus: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(win);
  return win;
}

const RECORD = {
  id: 'adm_1', name: 'أحمد علي', stage: 'active', createdAt: '2026-01-01',
  payments: [{ at: '2026-01-05', type: 'deposit', amount: 1000, by: 'u1' }],
  followups: [],
};

describe('openAdmissionReport — Gross / Refunded / Net via treasury_txn (BUG-02)', () => {
  beforeEach(() => { mockWindow(); });

  it('no linked treasury refund: shows only the Gross total, no "المسترد"/"الصافي"', () => {
    openAdmissionReport({ record: RECORD, profile: {}, treasuryTxn: [] });
    expect(writtenHtml).toContain(fmtMoney(1000));
    expect(writtenHtml).not.toContain('المسترد');
  });

  it('a linked refund (expense treasury_txn) of 300 -> Gross=1000, Refunded=300, Net=700', () => {
    const treasuryTxn = [
      { admissionId: 'adm_1', status: 'active', type: 'income', amount: 1000 },
      { admissionId: 'adm_1', status: 'active', type: 'expense', amount: 300 },
    ];
    openAdmissionReport({ record: RECORD, profile: {}, treasuryTxn });
    // الصف الخام في جدول المدفوعات يبقى 1000 (تاريخي، بلا تعديل)
    expect(writtenHtml).toContain(fmtMoney(1000));
    expect(writtenHtml).toContain('المسترد');
    expect(writtenHtml).toContain(fmtMoney(300));
    expect(writtenHtml).toContain('الصافي');
    expect(writtenHtml).toContain(fmtMoney(700));
  });

  it('a cancelled (non-active) refund transaction is never deducted', () => {
    const treasuryTxn = [{ admissionId: 'adm_1', status: 'cancelled', type: 'expense', amount: 300 }];
    openAdmissionReport({ record: RECORD, profile: {}, treasuryTxn });
    expect(writtenHtml).not.toContain('المسترد');
  });

  it('missing treasuryTxn does not throw and behaves as no refunds', () => {
    expect(() => openAdmissionReport({ record: RECORD, profile: {} })).not.toThrow();
  });
});
