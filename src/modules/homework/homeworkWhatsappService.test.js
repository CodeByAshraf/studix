// src/modules/homework/homeworkWhatsappService.test.js
// Homework Phase 3B — WhatsApp parent follow-up. Reuses the existing WhatsApp
// infrastructure (studentWhatsappService.js: openWhatsapp/buildWhatsappUrl/copyMessage) —
// this file only owns the two genuinely new pieces: the contact-phone convention
// (same fallback as absenceWhatsappService.js's getAbsenceContactPhone) and the
// homework-specific message text. Never fabricates a score for an ungraded/missing submission.
//
// Phase 3B clarification: WhatsApp is only offered for exactly two cases — Not Submitted
// (status:'missing') and Graded/Score (score != null, regardless of submitted/late).
// "Submitted but not graded" and "Late but not graded" get no WhatsApp action at all —
// shouldShowHomeworkWhatsapp() is the single source of truth for that gate (consumed by
// HomeworkSearch.jsx to decide whether to render the row's 📲 button).
import { describe, it, expect } from 'vitest';
import { getHomeworkContactPhone, buildHomeworkMessage, shouldShowHomeworkWhatsapp } from './homeworkWhatsappService';

describe('shouldShowHomeworkWhatsapp — the only two WhatsApp-eligible cases', () => {
  it('Not Submitted (status:missing) is eligible, regardless of score', () => {
    expect(shouldShowHomeworkWhatsapp({ status: 'missing', score: null })).toBe(true);
  });
  it('Graded/Score (score != null) is eligible when submitted', () => {
    expect(shouldShowHomeworkWhatsapp({ status: 'submitted', score: 18 })).toBe(true);
  });
  it('Graded/Score (score != null) is eligible when late — a late submission with a real score still counts as the Score case', () => {
    expect(shouldShowHomeworkWhatsapp({ status: 'late', score: 12 })).toBe(true);
  });
  it('Submitted but not graded is NOT eligible', () => {
    expect(shouldShowHomeworkWhatsapp({ status: 'submitted', score: null })).toBe(false);
  });
  it('Late but not graded is NOT eligible', () => {
    expect(shouldShowHomeworkWhatsapp({ status: 'late', score: null })).toBe(false);
  });
});

describe('getHomeworkContactPhone — same convention as attendance\'s getAbsenceContactPhone', () => {
  it('prefers parentPhone', () => {
    expect(getHomeworkContactPhone({ parentPhone: '01011112222', phone: '01099998888' })).toBe('01011112222');
  });
  it('falls back to the student\'s own phone when parentPhone is absent', () => {
    expect(getHomeworkContactPhone({ phone: '01099998888' })).toBe('01099998888');
  });
  it('returns an empty string when neither phone exists', () => {
    expect(getHomeworkContactPhone({})).toBe('');
    expect(getHomeworkContactPhone(undefined)).toBe('');
  });
});

describe('buildHomeworkMessage', () => {
  const BASE = {
    studentName: 'أحمد علي',
    homeworkTitle: 'واجب الجبر',
    subject: 'رياضيات',
    homeworkDate: '2026-03-10',
    totalScore: 20,
  };

  it('includes student name, homework title, subject, and date when available', () => {
    const msg = buildHomeworkMessage({ ...BASE, status: 'submitted', score: 18 });
    expect(msg).toContain('أحمد علي');
    expect(msg).toContain('واجب الجبر');
    expect(msg).toContain('رياضيات');
  });

  it('submitted + graded: shows score/totalScore', () => {
    const msg = buildHomeworkMessage({ ...BASE, status: 'submitted', score: 18 });
    expect(msg).toContain('18/20');
  });

  // Phase 3B clarification: HomeworkSearch.jsx now never offers a WhatsApp action for
  // submitted/late-but-ungraded rows (shouldShowHomeworkWhatsapp gates it out) — these two
  // tests remain as a defensive invariant of buildHomeworkMessage itself: even if called
  // directly with such a combination, it must still never fabricate a score.
  it('(defensive) submitted + ungraded: states not-yet-graded, never fabricates a score', () => {
    const msg = buildHomeworkMessage({ ...BASE, status: 'submitted', score: null });
    expect(msg).toMatch(/لم يتم تصحيح/);
    expect(msg).not.toMatch(/\d+\s*\/\s*20/);
  });

  it('late + graded: states submitted late AND shows the real score', () => {
    const msg = buildHomeworkMessage({ ...BASE, status: 'late', score: 12 });
    expect(msg).toMatch(/متأخر/);
    expect(msg).toContain('12/20');
  });

  it('(defensive) late + ungraded: states submitted late, states not-yet-graded, never fabricates a score', () => {
    const msg = buildHomeworkMessage({ ...BASE, status: 'late', score: null });
    expect(msg).toMatch(/متأخر/);
    expect(msg).toMatch(/لم يتم تصحيح/);
    expect(msg).not.toMatch(/\d+\s*\/\s*20/);
  });

  it('not submitted: states not submitted, contains no score and does not imply grading', () => {
    const msg = buildHomeworkMessage({ ...BASE, status: 'missing', score: null });
    expect(msg).toMatch(/لم يتم تسليم/);
    expect(msg).not.toMatch(/\d+\s*\/\s*20/);
    expect(msg).not.toMatch(/لم يتم تصحيح/); // grading language shouldn't appear when nothing was submitted at all
  });

  it('gracefully omits subject/date when not provided, without crashing or inserting "undefined"', () => {
    const msg = buildHomeworkMessage({ studentName: 'سارة', homeworkTitle: 'واجب', status: 'missing', score: null });
    expect(msg).not.toContain('undefined');
    expect(msg).not.toContain('null');
  });
});
