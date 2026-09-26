// src/reportEngine/reportMeta.test.js
// Student Report configuration — reportMeta.js is the single authoritative source for
// visibility across all 3 report surfaces (on-screen StudentReportPage, Professional PDF,
// Simple Print). Covers: showHealthScore split from showEvaluation, buildReportConfig's
// merge contract, the Student Report Sections rework (showFinancials/showPayments renamed
// to showFinancialSummary/showPaymentHistory, showHomework added), REPORT_SECTIONS (the
// metadata both ReportSettingsSection.jsx and StudentReportPage.jsx consume), and
// isSectionVisible (the small reusable helper replacing scattered `!== false` checks).
import { describe, it, expect } from 'vitest';
import { DEFAULT_REPORT_CONFIG, buildReportConfig, REPORT_SECTIONS, isSectionVisible } from './reportMeta';

describe('DEFAULT_REPORT_CONFIG', () => {
  it('showHealthScore and showEvaluation are two distinct flags, both true by default', () => {
    expect(DEFAULT_REPORT_CONFIG.showHealthScore).toBe(true);
    expect(DEFAULT_REPORT_CONFIG.showEvaluation).toBe(true);
  });

  it('has exactly the 15 known flags (14 user-configurable sections + showSignature, not exposed in Settings)', () => {
    expect(Object.keys(DEFAULT_REPORT_CONFIG).sort()).toEqual([
      'showAcademicTimeline', 'showAttendance', 'showBooklets', 'showCharts',
      'showCommunication', 'showEvaluation', 'showExams', 'showFinancialSummary',
      'showHealthScore', 'showHomework', 'showPaymentHistory', 'showProfile',
      'showRecitation', 'showSignature', 'showSnapshot',
    ]);
  });

  it('every flag defaults to true — default behavior shows every section', () => {
    for (const value of Object.values(DEFAULT_REPORT_CONFIG)) {
      expect(value).toBe(true);
    }
  });
});

describe('buildReportConfig', () => {
  it('with no overrides, returns exactly DEFAULT_REPORT_CONFIG', () => {
    expect(buildReportConfig()).toEqual(DEFAULT_REPORT_CONFIG);
    expect(buildReportConfig({})).toEqual(DEFAULT_REPORT_CONFIG);
  });

  it('merges overrides on top of the defaults, leaving unrelated flags untouched', () => {
    const cfg = buildReportConfig({ showCharts: false, showHealthScore: false });
    expect(cfg.showCharts).toBe(false);
    expect(cfg.showHealthScore).toBe(false);
    expect(cfg.showAttendance).toBe(true);
    expect(cfg.showEvaluation).toBe(true);
  });
});

describe('REPORT_SECTIONS — single source of truth for Settings UI + StudentReportPage', () => {
  it('every entry has a key that exists in DEFAULT_REPORT_CONFIG, a label, a description, and a scope', () => {
    for (const section of REPORT_SECTIONS) {
      expect(DEFAULT_REPORT_CONFIG).toHaveProperty(section.key);
      expect(typeof section.label).toBe('string');
      expect(section.label.length).toBeGreaterThan(0);
      expect(typeof section.description).toBe('string');
      expect(['all', 'pdf', 'screen-print']).toContain(section.scope);
    }
  });

  it('every key is unique — no duplicate/overlapping section entries', () => {
    const keys = REPORT_SECTIONS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('showFinancialSummary and showPaymentHistory are separate, non-overlapping sections (not the old ambiguous showFinancials/showPayments pair)', () => {
    const keys = REPORT_SECTIONS.map((s) => s.key);
    expect(keys).toContain('showFinancialSummary');
    expect(keys).toContain('showPaymentHistory');
    expect(keys).not.toContain('showFinancials');
    expect(keys).not.toContain('showPayments');
  });

  it('showSignature is intentionally not user-configurable (matches the pre-existing 12-section Settings UI)', () => {
    expect(REPORT_SECTIONS.map((s) => s.key)).not.toContain('showSignature');
  });
});

describe('isSectionVisible', () => {
  it('true when the flag is explicitly true', () => {
    expect(isSectionVisible({ showAttendance: true }, 'showAttendance')).toBe(true);
  });

  it('false only when the flag is explicitly false', () => {
    expect(isSectionVisible({ showAttendance: false }, 'showAttendance')).toBe(false);
  });

  it('defaults to true when the key is missing from config entirely (new flag, old saved config)', () => {
    expect(isSectionVisible({}, 'showHomework')).toBe(true);
  });

  it('defaults to true when config itself is null/undefined (no config passed at all)', () => {
    expect(isSectionVisible(undefined, 'showAttendance')).toBe(true);
    expect(isSectionVisible(null, 'showAttendance')).toBe(true);
  });
});
