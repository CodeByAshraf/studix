// src/store/slices/reportSettings.slice.test.js
// New feature — Student Report configuration. Proves the persistence contract in isolation
// (read-merge-with-defaults on init, write-through on update, reset clears storage) without
// needing a full page render — the localStorage key is exercised directly, the same
// mechanism a real browser refresh/reinitialization would go through.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_REPORT_CONFIG } from '../../reportEngine/reportMeta';

const STORAGE_KEY = 'tc_report_config';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('reportSettings.slice — read side (simulates what a fresh page load/reinitialization does)', () => {
  it('with nothing stored yet, initializes to exactly DEFAULT_REPORT_CONFIG', async () => {
    const { createReportSettingsSlice } = await import('./reportSettings.slice');
    const slice = createReportSettingsSlice(vi.fn());
    expect(slice.reportConfig).toEqual(DEFAULT_REPORT_CONFIG);
  });

  it('a previously-saved config is loaded as-is on the next initialization ("survives reload")', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_REPORT_CONFIG, showCharts: false, showPaymentHistory: false }));
    const { createReportSettingsSlice } = await import('./reportSettings.slice');
    const slice = createReportSettingsSlice(vi.fn());
    expect(slice.reportConfig.showCharts).toBe(false);
    expect(slice.reportConfig.showPaymentHistory).toBe(false);
    expect(slice.reportConfig.showAttendance).toBe(true); // untouched flags keep their saved value
  });

  it('a saved config missing a flag that did not exist yet when it was saved is backfilled from the current default — existing users automatically get new defaults', async () => {
    // Simulates an older saved config that predates a flag being added later (e.g.
    // showHomework, added by the Student Report Sections rework) — only a subset of keys
    // stored, not the full shape.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ showFinancialSummary: false }));
    const { createReportSettingsSlice } = await import('./reportSettings.slice');
    const slice = createReportSettingsSlice(vi.fn());
    expect(slice.reportConfig.showFinancialSummary).toBe(false); // explicit saved choice preserved
    expect(slice.reportConfig.showHealthScore).toBe(true);  // missing key -> current default
    expect(slice.reportConfig.showHomework).toBe(true);     // missing key (new flag) -> current default
    expect(slice.reportConfig.showSnapshot).toBe(true);     // missing key -> current default
  });
});

describe('reportSettings.slice — legacy key migration (showFinancials/showPayments renamed)', () => {
  // Student Report Sections rework renamed showFinancials -> showFinancialSummary and
  // showPayments -> showPaymentHistory (clearer, non-overlapping names). Without this
  // migration, an existing user who had explicitly turned one of these off would silently
  // see it reset to visible (true) the next time they load the app, since the new key name
  // would be "missing" from their saved object and merge in as the default — exactly the
  // kind of persisted-setting regression the rename must not cause.
  it('a legacy showFinancials value is carried onto showFinancialSummary on load', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ showFinancials: false }));
    const { createReportSettingsSlice } = await import('./reportSettings.slice');
    const slice = createReportSettingsSlice(vi.fn());
    expect(slice.reportConfig.showFinancialSummary).toBe(false);
  });

  it('a legacy showPayments value is carried onto showPaymentHistory on load', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ showPayments: false }));
    const { createReportSettingsSlice } = await import('./reportSettings.slice');
    const slice = createReportSettingsSlice(vi.fn());
    expect(slice.reportConfig.showPaymentHistory).toBe(false);
  });

  it('both legacy keys migrate together, independently of each other and of unrelated flags', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ showFinancials: false, showPayments: false, showCharts: false }));
    const { createReportSettingsSlice } = await import('./reportSettings.slice');
    const slice = createReportSettingsSlice(vi.fn());
    expect(slice.reportConfig.showFinancialSummary).toBe(false);
    expect(slice.reportConfig.showPaymentHistory).toBe(false);
    expect(slice.reportConfig.showCharts).toBe(false);
    expect(slice.reportConfig.showAttendance).toBe(true);
  });

  it('the new key wins if a saved config somehow already has both the legacy and the new key', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ showFinancials: false, showFinancialSummary: true }));
    const { createReportSettingsSlice } = await import('./reportSettings.slice');
    const slice = createReportSettingsSlice(vi.fn());
    expect(slice.reportConfig.showFinancialSummary).toBe(true);
  });

  it('the legacy key names never leak into the loaded config object', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ showFinancials: false, showPayments: false }));
    const { createReportSettingsSlice } = await import('./reportSettings.slice');
    const slice = createReportSettingsSlice(vi.fn());
    expect(slice.reportConfig).not.toHaveProperty('showFinancials');
    expect(slice.reportConfig).not.toHaveProperty('showPayments');
  });

  it('a config with no legacy keys at all is unaffected by migration', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ showCharts: false }));
    const { createReportSettingsSlice } = await import('./reportSettings.slice');
    const slice = createReportSettingsSlice(vi.fn());
    expect(slice.reportConfig.showCharts).toBe(false);
    expect(slice.reportConfig.showFinancialSummary).toBe(true);
    expect(slice.reportConfig.showPaymentHistory).toBe(true);
  });
});

describe('reportSettings.slice — write side', () => {
  it('setReportConfig merges the update, persists it, and returns the new state to set()', async () => {
    const { createReportSettingsSlice } = await import('./reportSettings.slice');
    let state = { reportConfig: { ...DEFAULT_REPORT_CONFIG } };
    const set = vi.fn((updater) => {
      state = { ...state, ...(typeof updater === 'function' ? updater(state) : updater) };
    });
    const slice = createReportSettingsSlice(set);
    slice.setReportConfig({ showCharts: false });

    expect(set).toHaveBeenCalledOnce();
    expect(state.reportConfig.showCharts).toBe(false);
    expect(state.reportConfig.showAttendance).toBe(true); // untouched flags unaffected
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).showCharts).toBe(false);
  });

  it('resetReportConfig restores every flag to the default and clears the stored key', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_REPORT_CONFIG, showCharts: false, showPaymentHistory: false }));
    const { createReportSettingsSlice } = await import('./reportSettings.slice');
    let state = {};
    const set = vi.fn((updater) => {
      state = { ...state, ...(typeof updater === 'function' ? updater(state) : updater) };
    });
    const slice = createReportSettingsSlice(set);
    state.reportConfig = slice.reportConfig; // simulate the store having loaded the saved (disabled) config

    slice.resetReportConfig();

    expect(state.reportConfig).toEqual(DEFAULT_REPORT_CONFIG);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
