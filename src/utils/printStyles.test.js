// src/utils/printStyles.test.js
// BUG: printStyles.js's reportHeaderHTML (the "unified print system" shared by
// buildAttendanceReport.js/buildExamReport.js/buildPaymentsReport.js/buildAdmissionReport.js)
// rendered an initials badge derived from centerProfile.name whenever no logo was uploaded —
// the same issue already fixed in reportEngine/components.js and
// student-report/buildPrintReport.js, but left unfixed here (the most-used of the three
// print systems). For "م خالد جمعه" that produced a "مخ" badge sitting next to the
// unmodified full name, visually reading like "مخ خالد جمعه". This proves the fix: no badge
// is rendered without a logo, and the name renders exactly as entered.
import { describe, it, expect } from 'vitest';
import { reportHeaderHTML, reportFooterHTML, initials } from './printStyles';

describe('reportHeaderHTML — centerProfile.name renders exactly as entered, no derived initials badge', () => {
  it('Arabic name with a single-letter first word: no "مخ"-style badge, no rh-logo-ph element', () => {
    const html = reportHeaderHTML({ name: 'م خالد جمعه' });
    expect(html).toContain('م خالد جمعه');
    expect(html).not.toContain('مخ خالد جمعه');
    expect(html).not.toContain('class="rh-logo rh-logo-ph"');
  });

  it('a normal Latin name renders exactly as entered, with no derived initials', () => {
    const html = reportHeaderHTML({ name: 'Ahmed Khaled' });
    expect(html).toContain('Ahmed Khaled');
    expect(html).not.toContain('class="rh-logo rh-logo-ph"');
    // لا يظهر "AK" (أو أي اختصار حرفين) كعنصر مستقل بجانب الاسم.
    expect(html).not.toContain('>AK<');
  });

  it('a logo IS uploaded: still renders the <img> logo normally (unrelated behavior untouched)', () => {
    const html = reportHeaderHTML({ name: 'م خالد جمعه', logoUrl: 'https://example.com/logo.png' });
    expect(html).toContain('https://example.com/logo.png');
    expect(html).toContain('م خالد جمعه');
    expect(html).not.toContain('rh-logo-ph');
  });

  it('no profile at all falls back to the existing generic center label, unaffected by this fix', () => {
    const html = reportHeaderHTML(null);
    expect(html).toContain('مركز التعليم');
    expect(html).not.toContain('rh-logo-ph');
  });

  it('reportFooterHTML still renders the name exactly, untouched by this fix', () => {
    const html = reportFooterHTML({ name: 'م خالد جمعه' });
    expect(html).toContain('م خالد جمعه');
  });

  it('the generic initials() helper itself is untouched (still usable elsewhere, e.g. student avatars)', () => {
    expect(initials('أشرف محمد علي')).toBe('أم');
    expect(initials('Ahmed Khaled')).toBe('AK');
  });
});
