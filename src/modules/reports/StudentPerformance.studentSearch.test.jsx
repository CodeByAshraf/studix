// src/modules/reports/StudentPerformance.studentSearch.test.jsx
// The "تحليل طالب بعينه" deep-dive used a native <select> of activeStudents. It now uses the
// shared StudentSearchSelect (same component already proven in PaymentForm.jsx). This proves
// the swap preserves the exact prior behavior: same activeStudents-only eligibility, same
// selectedStudentId state driving the same profile, with Arabic partial-name search on top.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentPerformance from './StudentPerformance';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

const ACTIVE_STUDENT   = { id: 's1', name: 'أشرف محمد', code: 'C001', status: 'active', grade: 'الأول الثانوي' };
const INACTIVE_STUDENT = { id: 's2', name: 'أشرف علي',  code: 'C002', status: 'inactive', grade: 'الأول الثانوي' };

function mockAggregateFetch() {
  globalThis.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.includes('/api/payments/aggregate')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: [] }) });
    }
    return Promise.reject(new Error(`unexpected fetch: ${u}`));
  });
}
afterEach(() => { vi.restoreAllMocks(); });

function seed() {
  useAppStore.setState({
    students: [ACTIVE_STUDENT, INACTIVE_STUDENT], groups: [], attendance: [], grades: [], exams: [],
  });
}

function renderPage() {
  return render(
    <ToastProvider>
      <StudentPerformance />
    </ToastProvider>
  );
}

describe('StudentPerformance — student deep-dive uses the searchable student selector', () => {
  it('renders the search combobox instead of a plain <select>', () => {
    seed();
    renderPage();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('typing a partial Arabic name filters to matching active students only (activeStudents eligibility unchanged)', () => {
    seed();
    renderPage();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'أشرف' } });

    // كلا الاسمين يطابقان الاستعلام، لكن الطالب الموقوف يجب ألا يظهر — نفس فلترة
    // activeStudents = students.filter(s => s.status === 'active') المطبَّقة سابقاً على
    // الـ <select> القديم بالضبط.
    expect(screen.getByRole('option', { name: /أشرف محمد/ })).toBeInTheDocument();
    expect(screen.queryByText('أشرف علي')).not.toBeInTheDocument();
  });

  it('selecting a search result sets the same selectedStudentId state the old <select> produced, driving the same profile', async () => {
    seed();
    mockAggregateFetch();
    renderPage();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'أشرف محمد' } });
    fireEvent.click(screen.getByRole('option', { name: /أشرف محمد/ }));

    // نفس محتوى الملف الشخصي الذي كان يظهر سابقاً عند اختيار s1 عبر <select>.
    expect(await screen.findByText('C001')).toBeInTheDocument();
  });
});
