// src/modules/attendance/AttendanceReports.studentSearch.test.jsx
// "Report by student" used a native <select> full of every active student. It now uses the
// shared StudentSearchSelect (same component already proven in PaymentForm.jsx) — this test
// proves the swap preserves the exact prior behavior: same active-only eligibility, same
// selectedStudent state driving the same report content, with Arabic partial-name search on top.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AttendanceReports from './AttendanceReports';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

// C4 Attendance migration Phase 2 — "report by student" now fetches
// GET /api/attendance?studentId= instead of filtering the store's global attendance array.
vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetAttendance: vi.fn() };
});
import { pgGetAttendance } from '../../services/api';

const ACTIVE_STUDENT   = { id: 's1', name: 'أشرف محمد', code: 'C001', status: 'active' };
const INACTIVE_STUDENT = { id: 's2', name: 'أشرف علي',  code: 'C002', status: 'inactive' };

const ATTENDANCE = [
  { id: 'a1', studentId: 's1', groupId: 'g1', date: '2026-01-01', status: 'present', sessionTime: '10:00' },
  { id: 'a2', studentId: 's1', groupId: 'g1', date: '2026-01-02', status: 'absent',  sessionTime: '10:00' },
];

function seed() {
  useAppStore.setState({
    students: [ACTIVE_STUDENT, INACTIVE_STUDENT],
    groups: [],
  });
  pgGetAttendance.mockImplementation(({ studentId }) =>
    Promise.resolve(ATTENDANCE.filter((r) => r.studentId === studentId)));
}

beforeEach(() => { vi.clearAllMocks(); });

function renderReports() {
  return render(<ToastProvider><AttendanceReports /></ToastProvider>);
}

describe('AttendanceReports — "report by student" uses the searchable student selector', () => {
  it('renders the search combobox instead of a plain <select>, defaulting to the student tab', () => {
    seed();
    renderReports();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('typing a partial Arabic name filters to matching active students only (eligibility unchanged)', () => {
    seed();
    renderReports();
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'أشرف' } });

    // كلا الاسمين يطابقان الاستعلام، لكن الطالب الموقوف يجب ألا يظهر — نفس فلترة
    // status==='active' التي كانت مطبَّقة على الـ <select> القديم بالضبط.
    expect(screen.getByRole('option', { name: /أشرف محمد/ })).toBeInTheDocument();
    expect(screen.queryByText('أشرف علي')).not.toBeInTheDocument();
  });

  it('selecting a search result sets the same selectedStudent state the old <select> produced, driving the same report', async () => {
    seed();
    renderReports();
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'أشرف محمد' } });
    fireEvent.click(screen.getByRole('option', { name: /أشرف محمد/ }));

    // نفس محتوى التقرير الذي كان يظهر سابقاً عند اختيار s1 عبر <select>: اسم/كود الطالب
    // في رأس التقرير + إحصاءات الحضور المشتقة من getAttendanceStats(selectedStudent, attendance)
    // — attendance يصل الآن عبر pgGetAttendance({studentId}) بدل الـ store، فالتحقّق أصبح async.
    expect(screen.getByText('C001')).toBeInTheDocument();
    expect(await screen.findByText('سجل الجلسات (2)')).toBeInTheDocument();
    expect(pgGetAttendance).toHaveBeenCalledWith({ studentId: 's1' });
  });
});
