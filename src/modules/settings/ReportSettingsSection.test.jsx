// src/modules/settings/ReportSettingsSection.test.jsx
// New feature — Student Report configuration Settings UI. Renders the real component and
// interacts with the real switches/reset button, asserting on the real store state
// (useAppStore) — the same store StudentReportPage.jsx reads from, proving this UI and that
// consumer share the single existing configuration engine rather than two separate systems.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReportSettingsSection, { REPORT_SECTIONS } from './ReportSettingsSection';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';
import { DEFAULT_REPORT_CONFIG } from '../../reportEngine/reportMeta';

function renderSection() {
  return render(
    <ToastProvider>
      <ReportSettingsSection/>
    </ToastProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({ reportConfig: { ...DEFAULT_REPORT_CONFIG } });
});

describe('ReportSettingsSection — every requested section is exposed exactly once', () => {
  it('shows all 12 requested sections with a label and a description', () => {
    renderSection();
    expect(REPORT_SECTIONS).toHaveLength(12);
    for (const section of REPORT_SECTIONS) {
      expect(screen.getByText(section.label)).toBeInTheDocument();
      expect(screen.getByText(section.description)).toBeInTheDocument();
    }
  });

  it('Health Score and AI Summary are exposed as two independent switches, not one', () => {
    renderSection();
    expect(screen.getByText('درجة الصحة الأكاديمية')).toBeInTheDocument();
    expect(screen.getByText('الملخّص الذكي')).toBeInTheDocument();
  });
});

describe('ReportSettingsSection — toggling a switch updates the shared store (single configuration engine)', () => {
  it('turning a switch off sets that flag to false in reportConfig, and only that flag', () => {
    renderSection();
    fireEvent.click(screen.getByRole('switch', { name: 'الرسوم البيانية' }));

    const cfg = useAppStore.getState().reportConfig;
    expect(cfg.showCharts).toBe(false);
    expect(cfg.showAttendance).toBe(true);
    expect(cfg.showPayments).toBe(true);
  });

  it('turning it back on restores true', () => {
    renderSection();
    const toggle = screen.getByRole('switch', { name: 'الرسوم البيانية' });
    fireEvent.click(toggle); // off
    fireEvent.click(toggle); // on
    expect(useAppStore.getState().reportConfig.showCharts).toBe(true);
  });

  it('the switch reflects reportConfig already in the store on mount (off by default state)', () => {
    useAppStore.setState({ reportConfig: { ...DEFAULT_REPORT_CONFIG, showPayments: false } });
    renderSection();
    expect(screen.getByRole('switch', { name: 'سجل المدفوعات' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'الرسوم البيانية' })).toHaveAttribute('aria-checked', 'true');
  });

  it('the enabled-count badge reflects disabled sections', () => {
    useAppStore.setState({ reportConfig: { ...DEFAULT_REPORT_CONFIG, showCharts: false, showBooklets: false } });
    renderSection();
    expect(screen.getByText('10 من 12 قسم مفعَّل')).toBeInTheDocument();
  });
});

describe('ReportSettingsSection — reset to default', () => {
  it('shows a confirmation modal before resetting, and does nothing if cancelled', () => {
    useAppStore.setState({ reportConfig: { ...DEFAULT_REPORT_CONFIG, showCharts: false } });
    renderSection();

    fireEvent.click(screen.getByText('↺ إعادة الضبط الافتراضي'));
    expect(screen.getByText(/سيتم إعادة كل أقسام تقرير الطالب الاحترافي/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('إلغاء'));
    expect(useAppStore.getState().reportConfig.showCharts).toBe(false); // unchanged — cancelled
  });

  it('restores every flag to DEFAULT_REPORT_CONFIG and clears persisted storage after confirming', () => {
    useAppStore.setState({ reportConfig: { ...DEFAULT_REPORT_CONFIG, showCharts: false, showPayments: false } });
    localStorage.setItem('tc_report_config', JSON.stringify({ ...DEFAULT_REPORT_CONFIG, showCharts: false, showPayments: false }));
    renderSection();

    fireEvent.click(screen.getByText('↺ إعادة الضبط الافتراضي'));
    fireEvent.click(screen.getByText('نعم، أعد الضبط'));

    expect(useAppStore.getState().reportConfig).toEqual(DEFAULT_REPORT_CONFIG);
    expect(localStorage.getItem('tc_report_config')).toBeNull();
    expect(screen.getByText('12 من 12 قسم مفعَّل')).toBeInTheDocument();
  });
});
