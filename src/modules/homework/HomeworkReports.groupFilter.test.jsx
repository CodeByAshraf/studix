// src/modules/homework/HomeworkReports.groupFilter.test.jsx
// Pre-Installer Audit C3 — HomeworkReports' "حسب المجموعة" (by-group) breakdown and its
// "By period" group filter both matched `h.groupId === g.id` / `h.groupId === filterGroup`.
// Homework 2.0 stopped setting `groupId` on new homeworks (targeted by grade — see
// homeworkService.js), so both were always empty for any current homework. Fixed by
// resolving via `h.grade`/`g.grade` instead — migration 006 backfilled `grade` on every
// historical row too, so this covers both current and historical homeworks.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import HomeworkReports from './HomeworkReports';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

// C4 Grades/hwSubmissions Frontend Migration (Batch A, feature 004): HomeworkReports now
// fetches two page-level submission aggregates on mount instead of reading the store's
// hwSubmissions array — mocked here (unrelated to this file's grade-filter concern) so the
// real network call is never attempted in this test environment.
vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetHwSubmissionsAggregate: vi.fn().mockResolvedValue([]), pgGetHomeworks: vi.fn() };
});
// Phase 2 (Homework global-read migration): the parent homework list now comes from
// pgGetHomeworks (GET /api/homeworks), not the store's homeworks array — served by the mock.
import { pgGetHwSubmissionsAggregate, pgGetHomeworks } from '../../services/api';

const GROUP_A = { id: 'g1', name: 'مجموعة أ', grade: 'الأول الثانوي' };
const GROUP_B = { id: 'g2', name: 'مجموعة ب', grade: 'الثاني الثانوي' };

const HW_CURRENT = { id: 'hw1', title: 'واجب الرياضيات', subject: 'رياضيات', grade: 'الأول الثانوي', groupId: null, status: 'active', dueDate: '2025-12-01' };
const HW_OTHER    = { id: 'hw2', title: 'واجب العلوم', subject: 'علوم', grade: 'الثاني الثانوي', groupId: null, status: 'active', dueDate: '2025-12-02' };

function seed() {
  useAppStore.setState({
    groups: [GROUP_A, GROUP_B],
    students: [
      { id: 's1', name: 'طالب 1', grade: 'الأول الثانوي', status: 'active' },
    ],
    homeworks: [],
    hwSubmissions: [],
  });
  pgGetHomeworks.mockResolvedValue([HW_CURRENT, HW_OTHER]);
}

function goToGroupTab() {
  fireEvent.click(screen.getByText(/حسب المجموعة/));
}

describe('HomeworkReports — "by group" breakdown and period filter resolve grade-targeted homeworks (C3 fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pgGetHwSubmissionsAggregate.mockResolvedValue([]);
  });

  it('the "by group" tab lists each group under its own matching-grade homework, not an empty breakdown for either', async () => {
    seed();
    render(<ToastProvider><HomeworkReports /></ToastProvider>);
    // awaits the mocked pgGetHwSubmissionsAggregate settling (act-wrapped), unrelated to this
    // test's own grade-filter concern.
    await screen.findByText('واجب الرياضيات');
    goToGroupTab();

    // Group A (grade "الأول الثانوي") -> the current, grade-targeted HW_CURRENT.
    expect(screen.getByText(/مجموعة أ \(1 واجب\)/)).toBeInTheDocument();
    expect(screen.getByText('واجب الرياضيات')).toBeInTheDocument();
    // Group B (grade "الثاني الثانوي") -> HW_OTHER, proving this isn't accidentally
    // matching every group to every homework.
    expect(screen.getByText(/مجموعة ب \(1 واجب\)/)).toBeInTheDocument();
    expect(screen.getByText('واجب العلوم')).toBeInTheDocument();
  });

  it('the "by period" group filter narrows to only the homework whose grade matches the selected group', async () => {
    seed();
    render(<ToastProvider><HomeworkReports /></ToastProvider>);
    await screen.findByText('واجب الرياضيات');
    fireEvent.click(screen.getByText(/حسب الفترة الزمنية/));

    expect(screen.getByText('2 واجب')).toBeInTheDocument(); // unfiltered: both homeworks

    const groupSelect = screen.getAllByRole('combobox').find(
      (el) => Array.from(el.options).some((o) => o.textContent === 'كل المجموعات')
    );
    fireEvent.change(groupSelect, { target: { value: 'g1' } });

    expect(screen.getByText('1 واجب')).toBeInTheDocument();
    expect(screen.getByText('واجب الرياضيات')).toBeInTheDocument();
    expect(screen.queryByText('واجب العلوم')).not.toBeInTheDocument();
  });
});

// C4 Grades/hwSubmissions Frontend Migration (Batch A, feature 004): the summary totals and
// every tab's per-homework breakdown now come from two page-level pgGetHwSubmissionsAggregate
// calls (groupBy=status, groupBy=homework), reused across all 4 tabs + summary — fetched once
// per view, not once per homework/tab (FR-007/SC-002, research.md §7: fully migratable).
describe('HomeworkReports — submission aggregates (feature 004)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      groups: [GROUP_A, GROUP_B],
      students: [
        { id: 's1', name: 'طالب 1', grade: 'الأول الثانوي', status: 'active' },
        { id: 's2', name: 'طالب 2', grade: 'الثاني الثانوي', status: 'active' },
      ],
      homeworks: [],
      hwSubmissions: [],
    });
    pgGetHomeworks.mockResolvedValue([HW_CURRENT, HW_OTHER]);
  });

  it('summary totals match the groupBy=status aggregate exactly, and each tab\'s breakdown matches the groupBy=homework aggregate — each dimension fetched exactly once per view', async () => {
    pgGetHwSubmissionsAggregate.mockImplementation(({ groupBy }) => {
      if (groupBy === 'status') return Promise.resolve([{ key: 'submitted', count: 1 }, { key: 'late', count: 0 }, { key: 'missing', count: 1 }]);
      if (groupBy === 'homework') return Promise.resolve([
        { key: 'hw1', total: 9, submitted: 1, late: 0, missing: 0 }, // aggregate's own total (9) must NOT be used
        { key: 'hw2', total: 9, submitted: 0, late: 0, missing: 1 },
      ]);
      return Promise.resolve([]);
    });

    render(<ToastProvider><HomeworkReports /></ToastProvider>);

    // Summary totals (top-level StatBoxes) — value div is the label's previous sibling.
    await waitFor(() => {
      const submittedLabel = screen.getByText('تم التسليم');
      expect(submittedLabel.previousElementSibling).toHaveTextContent('1');
      const missingLabel = screen.getByText('لم يُسلَّم');
      expect(missingLabel.previousElementSibling).toHaveTextContent('1');
    });

    // "By group" tab: Group A (1 eligible student, hw1's aggregate: submitted=1) —
    // confirms total stays the eligible-student count (1), never the aggregate's own total (9).
    fireEvent.click(screen.getByText(/حسب المجموعة/));
    expect(screen.getByText((_, el) => el.tagName === 'SPAN' && el.textContent === '✓ 1')).toBeInTheDocument();

    // Each aggregate dimension is fetched exactly once for the whole page view — reused across
    // the summary and all 4 tabs, not re-fetched per tab switch or per homework row.
    const statusCalls    = pgGetHwSubmissionsAggregate.mock.calls.filter(([p]) => p.groupBy === 'status');
    const homeworkCalls  = pgGetHwSubmissionsAggregate.mock.calls.filter(([p]) => p.groupBy === 'homework');
    expect(statusCalls).toHaveLength(1);
    expect(homeworkCalls).toHaveLength(1);
    // Phase 2: the parent homework list is likewise fetched once (unscoped) and reused by every tab.
    expect(pgGetHomeworks).toHaveBeenCalledTimes(1);
    expect(pgGetHomeworks).toHaveBeenCalledWith();
  });
});
