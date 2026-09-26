// src/modules/reports/StudentPerformance.revenue.test.jsx
// BUG-02 (remaining part) — the per-student deep-dive profile's "إجمالي المدفوع" summed
// payments.amount directly. Now comes net-of-refunds from the server aggregate endpoint.
//
// Scalability Architecture Phase 4 Cutover 1: StudentPerformance.jsx now fetches
// GET /api/payments/aggregate?groupBy=none&studentId= instead of reading the store's
// payments/treasuryTxn arrays for this number. We mock fetch directly (same technique as
// PaymentsPage.payments.test.jsx).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentPerformance from './StudentPerformance';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';
import { formatCurrency } from '../../utils/helpers';

const STUDENT = { id: 's1', name: 'أحمد', status: 'active', grade: 'الأول الثانوي', code: 'C1' };

function mockAggregateFetch(revenue) {
  globalThis.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.includes('/api/payments/aggregate')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: [{ key: 's1', count: 1, revenue }] }) });
    }
    return Promise.reject(new Error(`unexpected fetch: ${u}`));
  });
}
afterEach(() => { vi.restoreAllMocks(); });

function seed() {
  useAppStore.setState({
    students: [STUDENT], groups: [], attendance: [], grades: [], exams: [],
  });
}

// StudentSearchSelect (يحلّ محلّ <select> القديم): يكتب استعلاماً ثم ينقر النتيجة
// المطابقة — لا "value" مباشرة، بنفس تفاعل مستخدم حقيقي مع الحقل الجديد.
function selectStudent() {
  render(
    <ToastProvider>
      <StudentPerformance />
    </ToastProvider>
  );
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: STUDENT.name } });
  fireEvent.click(screen.getByRole('option', { name: new RegExp(STUDENT.name) }));
}

describe('StudentPerformance — student profile "إجمالي المدفوع" is net of active refunds (BUG-02, remaining part)', () => {
  it('payment 1000, refund 0 -> shows 1000', async () => {
    seed();
    mockAggregateFetch(1000);
    selectStudent();
    expect(await screen.findByText(formatCurrency(1000))).toBeInTheDocument();
  });

  it('payment 1000, refund 300 -> shows 700, not 1000', async () => {
    seed();
    mockAggregateFetch(700);
    selectStudent();
    expect(await screen.findByText(formatCurrency(700))).toBeInTheDocument();
    expect(screen.queryByText(formatCurrency(1000))).not.toBeInTheDocument();
  });
});
