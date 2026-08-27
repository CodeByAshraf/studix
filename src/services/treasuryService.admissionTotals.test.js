// src/services/treasuryService.admissionTotals.test.js
// BUG-02 — new shared helper (getAdmissionTreasuryTotals) extracted from AdmissionsPage's
// DetailsPanel (the pre-existing, reference-correct financial computation) so the card
// view and the printed admission report can reuse the exact same algorithm instead of
// duplicating it.
import { describe, it, expect } from 'vitest';
import { getAdmissionTreasuryTotals } from './treasuryService';

describe('getAdmissionTreasuryTotals', () => {
  it('income 1000, no refund -> income=1000, refund=0, net=1000', () => {
    const txn = [{ admissionId: 'a1', status: 'active', type: 'income', amount: 1000 }];
    expect(getAdmissionTreasuryTotals('a1', txn)).toEqual({ income: 1000, refund: 0, net: 1000 });
  });

  it('income 1000, expense (refund) 300 -> net=700', () => {
    const txn = [
      { admissionId: 'a1', status: 'active', type: 'income', amount: 1000 },
      { admissionId: 'a1', status: 'active', type: 'expense', amount: 300 },
    ];
    expect(getAdmissionTreasuryTotals('a1', txn)).toEqual({ income: 1000, refund: 300, net: 700 });
  });

  it('ignores non-active transactions', () => {
    const txn = [
      { admissionId: 'a1', status: 'active', type: 'income', amount: 1000 },
      { admissionId: 'a1', status: 'cancelled', type: 'expense', amount: 300 },
    ];
    expect(getAdmissionTreasuryTotals('a1', txn)).toEqual({ income: 1000, refund: 0, net: 1000 });
  });

  it('ignores transactions linked to a different admissionId', () => {
    const txn = [
      { admissionId: 'a1', status: 'active', type: 'income', amount: 1000 },
      { admissionId: 'a2', status: 'active', type: 'income', amount: 500 },
    ];
    expect(getAdmissionTreasuryTotals('a1', txn)).toEqual({ income: 1000, refund: 0, net: 1000 });
  });

  it('defaults to zero totals with no transactions', () => {
    expect(getAdmissionTreasuryTotals('a1', [])).toEqual({ income: 0, refund: 0, net: 0 });
    expect(getAdmissionTreasuryTotals('a1')).toEqual({ income: 0, refund: 0, net: 0 });
  });
});
