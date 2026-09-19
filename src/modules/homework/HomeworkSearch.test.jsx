// src/modules/homework/HomeworkSearch.test.jsx
// Homework Phase 3A — a new search screen answering "which students submitted / did not
// submit?" across homeworks: one row per (homework, eligible student) pair, filterable by
// Date/Date Range, Academic Year, Grade, and Submission Status. Built on top of the shared
// homeworkSearchService (already unit-tested) — this file proves the screen wires filters to
// that service correctly and that print uses the exact same filtered dataset shown on screen.
// Existing per-homework List/Reports screens are untouched by this feature.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import HomeworkSearch from './HomeworkSearch';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

function renderSearch() {
  return render(<ToastProvider><HomeworkSearch /></ToastProvider>);
}

let writtenHtml;
function mockWindow() {
  writtenHtml = '';
  const win = { document: { open: vi.fn(), write: vi.fn((html) => { writtenHtml += html; }), close: vi.fn() }, focus: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(win);
  return win;
}

const GRADE_6 = 'الصف السادس الابتدائي';
const GRADE_7 = 'الصف الأول الإعدادي';

const HW_MARCH_G6 = { id: 'hw1', title: 'واجب مارس', subject: 'رياضيات', grade: GRADE_6, academicYear: '2025/2026', totalScore: 20, dueDate: '2026-03-10', status: 'active', groupId: 'g1' };
const HW_APRIL_G7 = { id: 'hw2', title: 'واجب أبريل', subject: 'علوم',   grade: GRADE_7, academicYear: '2025/2026', totalScore: 20, dueDate: '2026-04-05', status: 'active', groupId: 'g2' };
// Historical record predating Homework 2.0 Phase 2 — no academicYear stamped at creation time.
const HW_HISTORICAL = { id: 'hw3', title: 'واجب قديم', subject: 'عربي', grade: GRADE_6, academicYear: '', totalScore: 10, dueDate: '2025-01-01', status: 'closed', groupId: 'g1' };

const S1_SUBMITTED = { id: 's1', name: 'أحمد علي',   code: 'C001', grade: GRADE_6, status: 'active', groupId: 'g1' };
const S2_MISSING   = { id: 's2', name: 'سارة محمد',  code: 'C002', grade: GRADE_6, status: 'active', groupId: 'gX' }; // different group — must not matter
const S3_G7        = { id: 's3', name: 'منى فتحي',   code: 'C003', grade: GRADE_7, status: 'active', groupId: 'g2' };

function seed(over = {}) {
  useAppStore.setState({
    homeworks: [HW_MARCH_G6, HW_APRIL_G7, HW_HISTORICAL],
    students: [S1_SUBMITTED, S2_MISSING, S3_G7],
    hwSubmissions: [
      { hwId: 'hw1', studentId: 's1', status: 'submitted', submittedAt: '2026-03-09', score: 18, notes: '' },
      // s2: no submission row for hw1 -> defaults to missing
      { hwId: 'hw2', studentId: 's3', status: 'submitted', submittedAt: '2026-04-04', score: 15, notes: '' },
      // hw3 (historical): no submissions at all for either eligible student -> both missing
    ],
    centerProfile: { name: 'م خالد جمعه' },
    ...over,
  });
}

function selectByLabel(label, value) {
  const combo = screen.getByLabelText(label);
  fireEvent.change(combo, { target: { value } });
}

describe('HomeworkSearch — Homework Phase 3A', () => {
  beforeEach(() => { mockWindow(); vi.clearAllMocks(); });

  it('with no filters, shows one row per (homework, eligible student) pair, including historical records with a blank academic year', () => {
    seed();
    renderSearch();
    // hw1: s1+s2 eligible (grade 6). hw2: s3 eligible (grade 7). hw3: s1+s2 eligible (grade 6).
    expect(screen.getAllByText('أحمد علي')).toHaveLength(2); // hw1 + hw3
    expect(screen.getAllByText('سارة محمد')).toHaveLength(2); // hw1 + hw3
    expect(screen.getByText('منى فتحي')).toBeInTheDocument(); // hw2
    expect(screen.getAllByText('واجب قديم')).toHaveLength(2); // historical record renders without crashing (s1+s2 rows)
  });

  it('does not render any Group filter as an eligibility/filter dimension', () => {
    seed();
    renderSearch();
    expect(screen.queryByLabelText('المجموعة')).not.toBeInTheDocument();
    expect(screen.queryByText('كل المجموعات')).not.toBeInTheDocument();
  });

  it('filters by Grade', () => {
    seed();
    renderSearch();
    selectByLabel('الصف', GRADE_7);
    expect(screen.getByText('منى فتحي')).toBeInTheDocument();
    expect(screen.queryByText('أحمد علي')).not.toBeInTheDocument();
    expect(screen.queryByText('سارة محمد')).not.toBeInTheDocument();
  });

  it('filters by date range', () => {
    seed();
    renderSearch();
    fireEvent.change(screen.getByLabelText('من تاريخ'), { target: { value: '2026-03-01' } });
    fireEvent.change(screen.getByLabelText('إلى تاريخ'), { target: { value: '2026-03-31' } });
    expect(screen.getAllByText('واجب مارس')).toHaveLength(2); // s1+s2 rows
    expect(screen.queryByText('واجب أبريل')).not.toBeInTheDocument();
    expect(screen.queryByText('واجب قديم')).not.toBeInTheDocument();
  });

  it('filters by Academic Year', () => {
    seed();
    renderSearch();
    selectByLabel('السنة الدراسية', '2025/2026');
    expect(screen.getAllByText('واجب مارس')).toHaveLength(2); // s1+s2 rows
    expect(screen.queryByText('واجب قديم')).not.toBeInTheDocument(); // academicYear: '' excluded
  });

  it('filters by Submission Status — "لم يُسلَّم فقط" shows only students who never submitted', () => {
    seed();
    renderSearch();
    selectByLabel('حالة التسليم', 'not_submitted');
    expect(screen.getAllByText('سارة محمد')).toHaveLength(2); // missing for hw1 AND hw3
    expect(screen.queryByText('منى فتحي')).not.toBeInTheDocument(); // submitted for hw2
  });

  it('filters by Submission Status — "تم التسليم فقط" shows only students with an actual submission', () => {
    seed();
    renderSearch();
    selectByLabel('حالة التسليم', 'submitted');
    expect(screen.getByText('منى فتحي')).toBeInTheDocument();
    // أحمد علي مؤهَّل مرتين (hw1 submitted, hw3 missing) — يجب أن يظهر مرة واحدة فقط (صف hw1)
    expect(screen.getAllByText('أحمد علي')).toHaveLength(1);
    expect(screen.queryByText('سارة محمد')).not.toBeInTheDocument();
  });

  it('combines Grade + Date Range + Submission Status (the documented "Grade 6 + March + Not Submitted" example)', () => {
    seed();
    renderSearch();
    selectByLabel('الصف', GRADE_6);
    fireEvent.change(screen.getByLabelText('من تاريخ'), { target: { value: '2026-03-01' } });
    fireEvent.change(screen.getByLabelText('إلى تاريخ'), { target: { value: '2026-03-31' } });
    selectByLabel('حالة التسليم', 'not_submitted');
    expect(screen.getByText('سارة محمد')).toBeInTheDocument();
    expect(screen.queryByText('أحمد علي')).not.toBeInTheDocument(); // submitted for hw1
    expect(screen.queryByText('منى فتحي')).not.toBeInTheDocument(); // wrong grade
  });

  it('shows an empty-state message when no row matches the combined filters', () => {
    seed();
    renderSearch();
    selectByLabel('الصف', GRADE_7);
    selectByLabel('حالة التسليم', 'not_submitted');
    expect(screen.getByText(/لا توجد نتائج/)).toBeInTheDocument();
  });

  it('changing a student\'s groupId has no effect on results — grade/eligibility only', () => {
    seed();
    useAppStore.setState({ students: [{ ...S1_SUBMITTED, groupId: 'totally-different-group' }, S2_MISSING, S3_G7] });
    renderSearch();
    expect(screen.getAllByText('أحمد علي')).toHaveLength(2);
  });

  it('print uses exactly the current filtered dataset shown on screen — an excluded student never appears in the printed output', () => {
    seed();
    renderSearch();
    selectByLabel('الصف', GRADE_7);

    fireEvent.click(screen.getByRole('button', { name: /طباعة/ }));

    expect(window.open).toHaveBeenCalled();
    expect(writtenHtml).toContain('منى فتحي');
    expect(writtenHtml).not.toContain('أحمد علي'); // filtered out (wrong grade)
    expect(writtenHtml).not.toContain('سارة محمد'); // filtered out (wrong grade)
  });
});
