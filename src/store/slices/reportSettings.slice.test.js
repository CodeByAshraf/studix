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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_REPORT_CONFIG, showCharts: false, showPayments: false }));
    const { createReportSettingsSlice } = await import('./reportSettings.slice');
    const slice = createReportSettingsSlice(vi.fn());
    expect(slice.reportConfig.showCharts).toBe(false);
    expect(slice.reportConfig.showPayments).toBe(false);
    expect(slice.reportConfig.showAttendance).toBe(true); // untouched flags keep their saved value
  });

  it('a saved config missing a flag that did not exist yet when it was saved is backfilled from the current default — existing users automatically get new defaults', async () => {
    // Simulates an older saved config that predates a flag being added later (e.g. a future
    // DEFAULT_REPORT_CONFIG addition) — only a subset of keys stored, not the full shape.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ showFinancials: false }));
    const { createReportSettingsSlice } = await import('./reportSettings.slice');
    const slice = createReportSettingsSlice(vi.fn());
    expect(slice.reportConfig.showFinancials).toBe(false); // explicit saved choice preserved
    expect(slice.reportConfig.showHealthScore).toBe(true);  // missing key -> current default
    expect(slice.reportConfig.showSnapshot).toBe(true);     // missing key -> current default
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_REPORT_CONFIG, showCharts: false, showPayments: false }));
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
