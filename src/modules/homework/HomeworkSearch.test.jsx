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

// Phase 2 (Homework global-read migration): HomeworkSearch no longer reads s.homeworks /
// s.hwSubmissions — the fixtures below are served ONLY through the mocked scoped APIs (the
// store's homeworks/hwSubmissions stay empty). The pgGetHwSubmissions stand-in applies the
// same parent-homework scope (dueFrom/dueTo/academicYear/grade) GET /api/hwSubmissions does.
vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetHomeworks: vi.fn(), pgGetHwSubmissions: vi.fn() };
});
import { pgGetHomeworks, pgGetHwSubmissions } from '../../services/api';

async function renderSearch() {
  const utils = render(<ToastProvider><HomeworkSearch /></ToastProvider>);
  await settle();
  return utils;
}

// Waits until the rows for the CURRENT filters are on screen (the "N نتيجة" counter only
// renders once the scoped submissions for this exact filter set have arrived).
async function settle() {
  await screen.findByText(/^\d+ نتيجة$/);
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

function serveFromServer(homeworks, hwSubmissions) {
  pgGetHomeworks.mockImplementation(() => Promise.resolve(homeworks));
  pgGetHwSubmissions.mockImplementation(({ dueFrom, dueTo, academicYear, grade } = {}) => {
    const inScope = new Set(homeworks.filter((h) =>
      (!dueFrom || h.dueDate >= dueFrom) && (!dueTo || h.dueDate <= dueTo)
      && (!academicYear || h.academicYear === academicYear) && (!grade || h.grade === grade)
    ).map((h) => h.id));
    return Promise.resolve(hwSubmissions.filter((s) => inScope.has(s.hwId)));
  });
}

function seed(over = {}) {
  serveFromServer([HW_MARCH_G6, HW_APRIL_G7, HW_HISTORICAL], [
      { hwId: 'hw1', studentId: 's1', status: 'submitted', submittedAt: '2026-03-09', score: 18, notes: '' },
      // s2: no submission row for hw1 -> defaults to missing
      { hwId: 'hw2', studentId: 's3', status: 'submitted', submittedAt: '2026-04-04', score: 15, notes: '' },
      // hw3 (historical): no submissions at all for either eligible student -> both missing
  ]);
  useAppStore.setState({
    homeworks: [],
    hwSubmissions: [],
    students: [S1_SUBMITTED, S2_MISSING, S3_G7],
    centerProfile: { name: 'م خالد جمعه' },
    ...over,
  });
}

async function selectByLabel(label, value) {
  const combo = screen.getByLabelText(label);
  fireEvent.change(combo, { target: { value } });
  await settle();
}

async function changeDate(label, value) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  await settle();
}

describe('HomeworkSearch — Homework Phase 3A', () => {
  beforeEach(() => { mockWindow(); vi.clearAllMocks(); });

  it('with no filters, shows one row per (homework, eligible student) pair, including historical records with a blank academic year', async () => {
    seed();
    await renderSearch();
    // hw1: s1+s2 eligible (grade 6). hw2: s3 eligible (grade 7). hw3: s1+s2 eligible (grade 6).
    expect(screen.getAllByText('أحمد علي')).toHaveLength(2); // hw1 + hw3
    expect(screen.getAllByText('سارة محمد')).toHaveLength(2); // hw1 + hw3
    expect(screen.getByText('منى فتحي')).toBeInTheDocument(); // hw2
    expect(screen.getAllByText('واجب قديم')).toHaveLength(2); // historical record renders without crashing (s1+s2 rows)
  });

  it('does not render any Group filter as an eligibility/filter dimension', async () => {
    seed();
    await renderSearch();
    expect(screen.queryByLabelText('المجموعة')).not.toBeInTheDocument();
    expect(screen.queryByText('كل المجموعات')).not.toBeInTheDocument();
  });

  it('filters by Grade', async () => {
    seed();
    await renderSearch();
    await selectByLabel('الصف', GRADE_7);
    expect(screen.getByText('منى فتحي')).toBeInTheDocument();
    expect(screen.queryByText('أحمد علي')).not.toBeInTheDocument();
    expect(screen.queryByText('سارة محمد')).not.toBeInTheDocument();
  });

  it('filters by date range', async () => {
    seed();
    await renderSearch();
    await changeDate('من تاريخ', '2026-03-01');
    await changeDate('إلى تاريخ', '2026-03-31');
    expect(screen.getAllByText('واجب مارس')).toHaveLength(2); // s1+s2 rows
    expect(screen.queryByText('واجب أبريل')).not.toBeInTheDocument();
    expect(screen.queryByText('واجب قديم')).not.toBeInTheDocument();
  });

  it('filters by Academic Year', async () => {
    seed();
    await renderSearch();
    await selectByLabel('السنة الدراسية', '2025/2026');
    expect(screen.getAllByText('واجب مارس')).toHaveLength(2); // s1+s2 rows
    expect(screen.queryByText('واجب قديم')).not.toBeInTheDocument(); // academicYear: '' excluded
  });

  it('filters by Submission Status — "لم يُسلَّم فقط" shows only students who never submitted', async () => {
    seed();
    await renderSearch();
    await selectByLabel('حالة التسليم', 'not_submitted');
    expect(screen.getAllByText('سارة محمد')).toHaveLength(2); // missing for hw1 AND hw3
    expect(screen.queryByText('منى فتحي')).not.toBeInTheDocument(); // submitted for hw2
  });

  it('filters by Submission Status — "تم التسليم فقط" shows only students with an actual submission', async () => {
    seed();
    await renderSearch();
    await selectByLabel('حالة التسليم', 'submitted');
    expect(screen.getByText('منى فتحي')).toBeInTheDocument();
    // أحمد علي مؤهَّل مرتين (hw1 submitted, hw3 missing) — يجب أن يظهر مرة واحدة فقط (صف hw1)
    expect(screen.getAllByText('أحمد علي')).toHaveLength(1);
    expect(screen.queryByText('سارة محمد')).not.toBeInTheDocument();
  });

  it('combines Grade + Date Range + Submission Status (the documented "Grade 6 + March + Not Submitted" example)', async () => {
    seed();
    await renderSearch();
    await selectByLabel('الصف', GRADE_6);
    await changeDate('من تاريخ', '2026-03-01');
    await changeDate('إلى تاريخ', '2026-03-31');
    await selectByLabel('حالة التسليم', 'not_submitted');
    expect(screen.getByText('سارة محمد')).toBeInTheDocument();
    expect(screen.queryByText('أحمد علي')).not.toBeInTheDocument(); // submitted for hw1
    expect(screen.queryByText('منى فتحي')).not.toBeInTheDocument(); // wrong grade
  });

  it('shows an empty-state message when no row matches the combined filters', async () => {
    seed();
    await renderSearch();
    await selectByLabel('الصف', GRADE_7);
    await selectByLabel('حالة التسليم', 'not_submitted');
    expect(screen.getByText(/لا توجد نتائج/)).toBeInTheDocument();
  });

  it('changing a student\'s groupId has no effect on results — grade/eligibility only', async () => {
    seed();
    useAppStore.setState({ students: [{ ...S1_SUBMITTED, groupId: 'totally-different-group' }, S2_MISSING, S3_G7] });
    await renderSearch();
    expect(screen.getAllByText('أحمد علي')).toHaveLength(2);
  });

  it('print uses exactly the current filtered dataset shown on screen — an excluded student never appears in the printed output', async () => {
    seed();
    await renderSearch();
    await selectByLabel('الصف', GRADE_7);

    fireEvent.click(screen.getByRole('button', { name: /طباعة/ }));

    expect(window.open).toHaveBeenCalled();
    expect(writtenHtml).toContain('منى فتحي');
    expect(writtenHtml).not.toContain('أحمد علي'); // filtered out (wrong grade)
    expect(writtenHtml).not.toContain('سارة محمد'); // filtered out (wrong grade)
  });

  it('never reads the global store: homework data comes only from the scoped APIs, one parent fetch per mount (no N+1)', async () => {
    seed();
    await renderSearch();
    expect(pgGetHomeworks).toHaveBeenCalledTimes(1);
    expect(pgGetHomeworks).toHaveBeenCalledWith();
    // One submissions request for the (empty) initial scope — not one per homework.
    expect(pgGetHwSubmissions).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('أحمد علي')).toHaveLength(2);
  });

  it('pushes the homework-level filters to the server as the submissions scope; status stays client-side', async () => {
    seed();
    await renderSearch();
    await selectByLabel('الصف', GRADE_7);
    await changeDate('من تاريخ', '2026-03-01');
    await selectByLabel('السنة الدراسية', '2025/2026');
    await selectByLabel('حالة التسليم', 'not_submitted');
    expect(pgGetHwSubmissions).toHaveBeenLastCalledWith({ dueFrom: '2026-03-01', dueTo: '', academicYear: '2025/2026', grade: GRADE_7 });
    // status change did not trigger another submissions request (4 = initial + 3 scope changes)
    expect(pgGetHwSubmissions).toHaveBeenCalledTimes(4);
    expect(pgGetHomeworks).toHaveBeenCalledTimes(1);
  });

  it('never shows rows built from a stale scope while the new scope is loading (no false "missing")', async () => {
    seed();
    await renderSearch();
    let resolveNext;
    pgGetHwSubmissions.mockImplementationOnce(() => new Promise((res) => { resolveNext = res; }));
    fireEvent.change(screen.getByLabelText('الصف'), { target: { value: GRADE_7 } });
    expect(screen.getByText('جارٍ تحميل النتائج...')).toBeInTheDocument();
    expect(screen.queryByText('منى فتحي')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /طباعة/ })).toBeDisabled();
    resolveNext([{ hwId: 'hw2', studentId: 's3', status: 'submitted', submittedAt: '2026-04-04', score: 15, notes: '' }]);
    await settle();
    expect(screen.getByText('منى فتحي')).toBeInTheDocument();
  });

  it('surfaces a load failure instead of an empty or "all missing" result', async () => {
    seed();
    pgGetHwSubmissions.mockRejectedValue(new Error('PG GET /hwSubmissions → 500'));
    render(<ToastProvider><HomeworkSearch /></ToastProvider>);
    expect(await screen.findByText('تعذّر تحميل نتائج البحث')).toBeInTheDocument();
    expect(screen.queryByText('أحمد علي')).not.toBeInTheDocument();
  });
});
