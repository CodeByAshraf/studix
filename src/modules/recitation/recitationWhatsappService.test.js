// src/modules/recitation/recitationWhatsappService.test.js
// Recitation WhatsApp — same shape as homeworkWhatsappService.test.js (the closest
// precedent). Reuses studentWhatsappService.js's openWhatsapp/buildWhatsappUrl/
// copyMessage verbatim — this file only owns the two genuinely new pieces: the
// contact-phone convention (identical fallback to absence/homework) and the
// recitation-specific message text. Never fabricates a score for an unevaluated row.
import { describe, it, expect } from 'vitest';
import { getRecitationContactPhone, buildRecitationMessage } from './recitationWhatsappService';

describe('getRecitationContactPhone — same convention as getAbsenceContactPhone/getHomeworkContactPhone', () => {
  it('prefers parentPhone', () => {
    expect(getRecitationContactPhone({ parentPhone: '01011112222', phone: '01099998888' })).toBe('01011112222');
  });
  it('falls back to the student\'s own phone when parentPhone is absent', () => {
    expect(getRecitationContactPhone({ phone: '01099998888' })).toBe('01099998888');
  });
  it('returns an empty string when neither phone exists', () => {
    expect(getRecitationContactPhone({})).toBe('');
    expect(getRecitationContactPhone(undefined)).toBe('');
  });
});

describe('buildRecitationMessage', () => {
  const BASE = {
    studentName: 'أحمد علي',
    groupName: 'مجموعة أ',
    date: '2026-03-10',
    score: 18,
    maxScore: 20,
    percentage: 90,
  };

  it('includes student name, group, date, and score/max score', () => {
    const msg = buildRecitationMessage(BASE);
    expect(msg).toContain('أحمد علي');
    expect(msg).toContain('مجموعة أ');
    expect(msg).toContain('18/20');
  });

  it('includes the derived percentage', () => {
    const msg = buildRecitationMessage(BASE);
    expect(msg).toContain('90%');
  });

  it('includes the note line when a note is present', () => {
    const msg = buildRecitationMessage({ ...BASE, note: 'أداء ممتاز' });
    expect(msg).toContain('أداء ممتاز');
    expect(msg).toMatch(/ملاحظة/);
  });

  it('omits the note line entirely when no note is present', () => {
    const msg = buildRecitationMessage({ ...BASE, note: null });
    expect(msg).not.toMatch(/ملاحظة/);
  });

  it('omits the note line when note is an empty string', () => {
    const msg = buildRecitationMessage({ ...BASE, note: '' });
    expect(msg).not.toMatch(/ملاحظة/);
  });

  it('never outputs the literal "undefined" or "null"', () => {
    const msg = buildRecitationMessage({ studentName: 'سارة', score: 5, maxScore: 10, percentage: 50 });
    expect(msg).not.toContain('undefined');
    expect(msg).not.toContain('null');
  });

  it('(defensive) never fabricates a score when score is null — the message must not claim a numeric result', () => {
    const msg = buildRecitationMessage({ ...BASE, score: null, percentage: null });
    expect(msg).not.toMatch(/\d+\s*\/\s*20/);
    expect(msg).not.toContain('%');
  });

  it('uses the existing date formatting convention (long Arabic date, not a raw ISO string)', () => {
    const msg = buildRecitationMessage(BASE);
    expect(msg).not.toContain('2026-03-10');
  });
});
