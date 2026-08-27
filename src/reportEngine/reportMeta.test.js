// src/reportEngine/reportMeta.test.js
// New feature — Student Report configuration. reportMeta.js had no prior test coverage;
// this covers the one change made to it (splitting showHealthScore out of showEvaluation)
// plus buildReportConfig's existing merge contract, which the new Settings UI now relies on.
import { describe, it, expect } from 'vitest';
import { DEFAULT_REPORT_CONFIG, buildReportConfig } from './reportMeta';

describe('DEFAULT_REPORT_CONFIG', () => {
  it('showHealthScore and showEvaluation are two distinct flags, both true by default', () => {
    expect(DEFAULT_REPORT_CONFIG.showHealthScore).toBe(true);
    expect(DEFAULT_REPORT_CONFIG.showEvaluation).toBe(true);
  });

  it('has exactly the 13 known flags (12 user-configurable sections + showSignature, not exposed in Settings)', () => {
    expect(Object.keys(DEFAULT_REPORT_CONFIG).sort()).toEqual([
      'showAcademicTimeline', 'showAttendance', 'showBooklets', 'showCharts',
      'showCommunication', 'showEvaluation', 'showExams', 'showFinancials',
      'showHealthScore', 'showPayments', 'showProfile', 'showSignature', 'showSnapshot',
    ]);
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
