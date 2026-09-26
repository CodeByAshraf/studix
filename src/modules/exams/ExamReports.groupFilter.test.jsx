// src/modules/exams/ExamReports.groupFilter.test.jsx
// Pre-Installer Audit C2 — the "طباعة كشف → بالمجموعة + امتحان" exam dropdown filtered
// `exams.filter(e => e.groupId === groupId)`. Exams Phase 2 stopped setting `groupId` on
// new exams (targeted by grade instead — see ExamForm.jsx/examService.js), so this filter
// was always empty for any current exam, silently showing "لا توجد امتحانات لهذه
// المجموعة" no matter what. The fix resolves the selected group's `grade` and filters
// exams by `exam.grade` instead — migration 007 backfilled `grade` on every historical
// exam row too, so this reproduces correctly for both current AND historical records.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ExamReports from './ExamReports';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

// Phase 1D (Grades global-read migration) — ExamReports now fetches the grades aggregate on
// mount (Top Students tab), so every render here needs ToastProvider + a resolved mock, same
// as every other page migrated to scoped/aggregate fetches (see StudentPerformance/ExamResults
// test files). This file's own tests are about the print tab's group→grade exam resolution,
// unrelated to grades data, so an empty aggregate is enough.
vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetGradesAggregate: vi.fn(), pgGetGrades: vi.fn() };
});
import { pgGetGradesAggregate, pgGetGrades } from '../../services/api';

beforeEach(() => {
  pgGetGradesAggregate.mockResolvedValue([]);
  pgGetGrades.mockResolvedValue([]);
});

const GROUP_A = { id: 'g1', name: 'مجموعة أ', grade: 'الأول الثانوي' };
const GROUP_B = { id: 'g2', name: 'مجموعة ب', grade: 'الثاني الثانوي' };
const GROUP_EMPTY = { id: 'g3', name: 'مجموعة فارغة', grade: 'الثالث الثانوي' };

// Current (Exams 2.0) exam — grade-targeted, groupId is null exactly like a real new exam.
const EXAM_CURRENT = { id: 'e1', name: 'امتحان شهر نوفمبر', subject: 'رياضيات', grade: 'الأول الثانوي', groupId: null, status: 'done', total: 100, pass: 50, date: '2025-11-01' };
// Historical (pre-migration) exam — groupId still set, but grade was backfilled by
// migration 007 from its old group's grade, exactly as production data looks.
const EXAM_HISTORICAL = { id: 'e2', name: 'امتحان أكتوبر (قديم)', subject: 'علوم', grade: 'الأول الثانوي', groupId: 'g_old_deleted', status: 'done', total: 100, pass: 50, date: '2025-10-01' };
// Different grade entirely — must never appear for group A.
const EXAM_OTHER_GRADE = { id: 'e3', name: 'امتحان صف آخر', subject: 'كيمياء', grade: 'الثاني الثانوي', groupId: null, status: 'done', total: 100, pass: 50, date: '2025-11-05' };

function seed() {
  useAppStore.setState({
    groups: [GROUP_A, GROUP_B, GROUP_EMPTY],
    students: [],
    grades: [],
    exams: [EXAM_CURRENT, EXAM_HISTORICAL, EXAM_OTHER_GRADE],
  });
}

function openGroupPrintMode() {
  render(<ToastProvider><ExamReports /></ToastProvider>);
  fireEvent.click(screen.getByText(/طباعة كشف/));
  // mode='group' is the default tab — no extra click needed, but assert it's active by
  // finding the exam select's own label.
}

function examSelect() {
  return screen.getAllByRole('combobox').find(
    (el) => el.tagName === 'SELECT' && Array.from(el.options).some((o) => /اختر الامتحان|لا توجد امتحانات|اختر المجموعة أولاً/.test(o.textContent))
  );
}

function groupSelect() {
  return screen.getAllByRole('combobox').find(
    (el) => el.tagName === 'SELECT' && Array.from(el.options).some((o) => o.textContent === 'اختر المجموعة...')
  );
}

describe('ExamReports (print tab, "بالمجموعة + امتحان" mode) — group→grade exam resolution (C2 fix)', () => {
  it('lists both the current (grade-targeted, groupId=null) and historical (backfilled grade) exams for the selected group, never the other grade\'s exam', () => {
    seed();
    openGroupPrintMode();

    fireEvent.change(groupSelect(), { target: { value: 'g1' } });

    const opts = Array.from(examSelect().options).map((o) => o.textContent);
    expect(opts.some((t) => t.includes('امتحان شهر نوفمبر'))).toBe(true);
    expect(opts.some((t) => t.includes('امتحان أكتوبر (قديم)'))).toBe(true);
    expect(opts.some((t) => t.includes('امتحان صف آخر'))).toBe(false);
    expect(screen.queryByText('لا توجد امتحانات لهذه المجموعة')).not.toBeInTheDocument();
  });

  it('shows the "no exams" placeholder, not a crash, for a group whose grade truly has none', () => {
    seed();
    openGroupPrintMode();

    fireEvent.change(groupSelect(), { target: { value: 'g3' } });

    expect(within(examSelect()).getByText('لا توجد امتحانات لهذه المجموعة')).toBeInTheDocument();
  });

  it('the generate button stays disabled until both a group and an exam resolved via the fixed filter are chosen', () => {
    seed();
    openGroupPrintMode();
    const generateButton = () => screen.getByText('🖨 توليد الكشف وطباعته').closest('button');

    expect(generateButton()).toBeDisabled();
    fireEvent.change(groupSelect(), { target: { value: 'g1' } });
    expect(generateButton()).toBeDisabled();
    fireEvent.change(examSelect(), { target: { value: 'e1' } });
    expect(generateButton()).not.toBeDisabled();
  });
});
