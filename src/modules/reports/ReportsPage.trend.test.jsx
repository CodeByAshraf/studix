// src/modules/reports/ReportsPage.trend.test.jsx
// Scalability Architecture Phase 4 Cutover 2 — the "اتجاه الإيراد — آخر 6 أشهر" mini bar
// chart intentionally crosses a calendar-year boundary (e.g. Sep–Dec of one year plus
// Jan–Feb of the next). This proves the migrated implementation — up to two
// GET /api/payments/aggregate?groupBy=month&year= calls, one per spanned calendar year,
// merged back into the original 6-month order — reproduces the exact real values, not
// just that the aggregate function was called.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReportsPage from './ReportsPage';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';
import { mockPaymentsBackend } from '../../test-utils/mockPaymentsBackend';

function renderPage() {
  return render(
    <ToastProvider>
      <ReportsPage />
    </ToastProvider>
  );
}

// يجلب الحاوية المباشرة للأعمدة الستة (شقيقة العنوان "📈 اتجاه الإيراد...") ويُعيد نص كل
// عمود بالترتيب — يثبت ترتيب الأشهر الفعلي المعروض، لا فقط القيم كمجموعة غير مرتَّبة.
async function trendBarValues() {
  const heading = await screen.findByText(/اتجاه الإيراد/);
  const barsRow = heading.parentElement.lastElementChild;
  return Array.from(barsRow.children).map((bar) => bar.textContent.trim());
}

describe('ReportsPage — 6-month revenue trend correctly crosses a Dec/Jan year boundary', () => {
  // toFake: ['Date'] فقط — تزييف setTimeout أيضاً (السلوك الافتراضي) يُجمّد الاستطلاع
  // الداخلي لـ waitFor/findBy* في @testing-library، فتنتهي كل الاختبارات بمهلة زمنية.
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('Sep 2025..Feb 2026 window: pulls Sep-Dec from the 2025 aggregate call and Jan-Feb from the 2026 call, in the correct order', async () => {
    vi.setSystemTime(new Date('2026-02-15T12:00:00.000Z'));
    useAppStore.setState({
      groups: [], students: [{ id: 's1', name: 'طالب', status: 'active' }],
      attendance: [], grades: [], exams: [],
    });

    // كل شهر بمبلغ مميّز يسمح بالتحقّق من الترتيب: سبتمبر..فبراير = 100..600
    mockPaymentsBackend([
      { id: 'p-sep', studentId: 's1', amount: 100, month: 9,  year: 2025, status: 'paid', date: '2025-09-05' },
      { id: 'p-oct', studentId: 's1', amount: 200, month: 10, year: 2025, status: 'paid', date: '2025-10-05' },
      { id: 'p-nov', studentId: 's1', amount: 300, month: 11, year: 2025, status: 'paid', date: '2025-11-05' },
      { id: 'p-dec', studentId: 's1', amount: 400, month: 12, year: 2025, status: 'paid', date: '2025-12-05' },
      { id: 'p-jan', studentId: 's1', amount: 500, month: 1,  year: 2026, status: 'paid', date: '2026-01-05' },
      { id: 'p-feb', studentId: 's1', amount: 600, month: 2,  year: 2026, status: 'paid', date: '2026-02-05' },
    ], []);

    renderPage();

    expect(await trendBarValues()).toEqual(['100', '200', '300', '400', '500', '600']);
  });

  it('a payment in the same month number of an unrelated year is NOT pulled into the wrong bucket (no year bleed-through)', async () => {
    vi.setSystemTime(new Date('2026-02-15T12:00:00.000Z'));
    useAppStore.setState({
      groups: [], students: [{ id: 's1', name: 'طالب', status: 'active' }],
      attendance: [], grades: [], exams: [],
    });

    mockPaymentsBackend([
      { id: 'p-sep-2025', studentId: 's1', amount: 100, month: 9, year: 2025, status: 'paid', date: '2025-09-05' },
      // نفس رقم الشهر (سبتمبر) لكن سنة غير مشمولة بالنافذة إطلاقاً — يجب ألا يُحتسَب
      { id: 'p-sep-2024', studentId: 's1', amount: 9999, month: 9, year: 2024, status: 'paid', date: '2024-09-05' },
      { id: 'p-feb', studentId: 's1', amount: 600, month: 2, year: 2026, status: 'paid', date: '2026-02-05' },
    ], []);

    renderPage();

    const values = await trendBarValues();
    expect(values[0]).toBe('100'); // سبتمبر 2025، لا 9999+100
    expect(values[5]).toBe('600'); // فبراير 2026 (الشهر الحالي)
  });

  it('a within-window month with zero payments renders no value label (bar stays empty), not an error', async () => {
    vi.setSystemTime(new Date('2026-02-15T12:00:00.000Z'));
    useAppStore.setState({
      groups: [], students: [{ id: 's1', name: 'طالب', status: 'active' }],
      attendance: [], grades: [], exams: [],
    });

    // نوفمبر 2025 بلا أي دفعة إطلاقاً ضمن النافذة
    mockPaymentsBackend([
      { id: 'p-sep', studentId: 's1', amount: 100, month: 9, year: 2025, status: 'paid', date: '2025-09-05' },
      { id: 'p-feb', studentId: 's1', amount: 600, month: 2, year: 2026, status: 'paid', date: '2026-02-05' },
    ], []);

    renderPage();

    const values = await trendBarValues();
    expect(values[0]).toBe('100');
    expect(values[2]).toBe(''); // نوفمبر (index 2 = ثالث شهر: سبتمبر,أكتوبر,نوفمبر) — بلا قيمة
    expect(values[5]).toBe('600');
  });
});
