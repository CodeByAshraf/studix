// src/reportEngine/components.test.js
// Print-quality audit fix — DataTable's totals-row rendering. Reproduces the exact
// original failure (a "المتوسط: 0%" cell where the real average was non-zero) and proves
// the fix: a totals-row value is now always used as-is (already formatted by the caller —
// examsSection passes fmtPct(examAvg) directly), never re-run through the column's own
// render(row) function. Before the fix, a column with both a totals value AND a render
// function double-formatted the already-formatted string (fmtPct('71%') → Number('71%')
// is NaN → the `|| 0` fallback inside fmtPct silently turns it into '0%').
import { describe, it, expect } from 'vitest';
import { DataTable } from './components';
import { fmtPct, fmtMoney } from './helpers';

describe('DataTable — totals row (print-quality audit fix)', () => {
  it('reproduces the original bug\'s exact scenario and proves it is fixed: a pre-formatted percentage in totals is shown as-is, not re-run through the column render', () => {
    const examAvg = 71;
    const html = DataTable({
      columns: [
        { key: 'examName', label: 'الامتحان' },
        { key: 'pct', label: 'النسبة', numeric: true, render: (r) => fmtPct(r.pct) },
      ],
      rows: [{ examName: 'اختبار 1', pct: 92 }, { examName: 'اختبار 2', pct: 50 }],
      totals: { examName: 'المتوسط', pct: fmtPct(examAvg) },
    });

    // The bug's exact symptom: before the fix this was '0%'.
    expect(html).not.toMatch(/المتوسط[\s\S]{0,200}>0%</);
    // The correct value renders in the totals row.
    expect(html).toMatch(/المتوسط[\s\S]{0,200}>71%</);
  });

  it('a totals value for a column with NO render function still renders correctly (unaffected by the fix)', () => {
    const html = DataTable({
      columns: [{ key: 'label', label: 'البند' }, { key: 'count', label: 'العدد', numeric: true }],
      rows: [{ label: 'صف 1', count: 3 }],
      totals: { label: 'الإجمالي', count: 3 },
    });
    expect(html).toContain('>3<');
  });

  it('a totals value that is itself a pre-formatted currency string renders exactly as given, not re-formatted', () => {
    const html = DataTable({
      columns: [
        { key: 'label', label: 'البند' },
        { key: 'amount', label: 'المبلغ', numeric: true, render: (r) => fmtMoney(r.amount) },
      ],
      rows: [{ label: 'دفعة 1', amount: 100 }, { label: 'دفعة 2', amount: 200 }],
      totals: { label: 'الإجمالي', amount: fmtMoney(300) },
    });
    expect(html).toContain(fmtMoney(300));
    // must not contain a garbled re-formatted value (e.g. "0 ج.م" from double-formatting)
    expect(html).not.toMatch(/الإجمالي[\s\S]{0,200}>0 ج\.م</);
  });

  it('a column present in a data row but absent from totals renders the empty-cell fallback, not a crash', () => {
    const html = DataTable({
      columns: [
        { key: 'label', label: 'البند' },
        { key: 'date', label: 'التاريخ', render: (r) => r.date },
      ],
      rows: [{ label: 'صف 1', date: '2026-01-01' }],
      totals: { label: 'الإجمالي' }, // no 'date' key at all
    });
    expect(html).toContain('الإجمالي');
  });

  it('with no totals prop at all, no totals row is rendered (unaffected by the fix)', () => {
    const html = DataTable({
      columns: [{ key: 'label', label: 'البند' }],
      rows: [{ label: 'صف 1' }],
    });
    expect(html).not.toContain('الإجمالي');
  });

  it('normal data rows still use the column render function exactly as before (regression guard)', () => {
    const html = DataTable({
      columns: [{ key: 'pct', label: 'النسبة', render: (r) => fmtPct(r.pct) }],
      rows: [{ pct: 55 }],
    });
    expect(html).toContain('>55%<');
  });

  it('the empty-rows state is unaffected by the fix', () => {
    const html = DataTable({ columns: [{ key: 'x', label: 'X' }], rows: [], options: { emptyText: 'لا توجد بيانات هنا' } });
    expect(html).toContain('لا توجد بيانات هنا');
  });
});
