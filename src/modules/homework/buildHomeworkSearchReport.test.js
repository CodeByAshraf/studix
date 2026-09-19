// src/modules/homework/buildHomeworkSearchReport.test.js
// Homework Phase 3A — print for the Homework Search screen. Takes the rows array exactly as
// already filtered/displayed on screen (homeworkSearchService.filterHomeworkSubmissionRows'
// output) and renders it verbatim — there is no second filtering implementation here, so
// print can never show something the screen didn't.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openHomeworkSearchReportPrint } from './buildHomeworkSearchReport';

let writtenHtml;
function mockWindow() {
  writtenHtml = '';
  const win = { document: { open: vi.fn(), write: vi.fn((html) => { writtenHtml += html; }), close: vi.fn() }, focus: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(win);
  return win;
}

const ROWS = [
  { homeworkId: 'hw1', homeworkTitle: 'واجب الجبر', homeworkDate: '2026-03-05', grade: 'الصف السادس الابتدائي', studentName: 'أحمد علي', studentCode: 'C001', status: 'submitted', score: 18, totalScore: 20 },
  { homeworkId: 'hw2', homeworkTitle: 'واجب الهندسة', homeworkDate: '2026-03-20', grade: 'الصف السادس الابتدائي', studentName: 'سارة محمد', studentCode: 'C002', status: 'missing', score: null, totalScore: 20 },
];

describe('openHomeworkSearchReportPrint — prints exactly the rows it is given', () => {
  beforeEach(() => { mockWindow(); });

  it('renders every row passed in', () => {
    openHomeworkSearchReportPrint({ rows: ROWS, profile: {} });
    expect(writtenHtml).toContain('أحمد علي');
    expect(writtenHtml).toContain('واجب الجبر');
    expect(writtenHtml).toContain('سارة محمد');
    expect(writtenHtml).toContain('واجب الهندسة');
  });

  it('never renders a row that was excluded from the input array (no independent re-filtering)', () => {
    // Only the first row is passed — proves the function has no access to (and cannot fall
    // back to) any wider dataset; whatever the caller filtered out truly cannot appear.
    openHomeworkSearchReportPrint({ rows: [ROWS[0]], profile: {} });
    expect(writtenHtml).toContain('أحمد علي');
    expect(writtenHtml).not.toContain('سارة محمد');
    expect(writtenHtml).not.toContain('واجب الهندسة');
  });

  it('shows score/total for a graded row and never fabricates a score for an ungraded ("missing") row', () => {
    openHomeworkSearchReportPrint({ rows: ROWS, profile: {} });
    expect(writtenHtml).toContain('18/20');
    // سارة محمد: score:null — يجب ألا تظهر أي درجة ملفَّقة (لا "0/20" ولا "—/20" كرقم)
    const saraRow = writtenHtml.split('سارة محمد')[1]?.split('</tr>')[0] || '';
    expect(saraRow).not.toContain('0/20');
  });

  it('renders a clean empty state instead of crashing when given zero rows', () => {
    expect(() => openHomeworkSearchReportPrint({ rows: [], profile: {} })).not.toThrow();
    expect(writtenHtml).toBeTruthy();
  });
});
