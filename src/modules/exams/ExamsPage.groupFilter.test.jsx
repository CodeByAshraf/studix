// src/modules/exams/ExamsPage.groupFilter.test.jsx
// Pre-Installer Audit C2 — the exams list's own "Group" filter dropdown had the exact same
// dead-filter regression as ExamReports.jsx's print mode (same root cause, different call
// site, not enumerated by the original audit finding but the identical bug): it filtered
// `e.groupId === filter.groupId`, always empty for any Exams-2.0 (grade-targeted) exam.
// Fixed by resolving the selected group's `grade` and filtering by `exam.grade` instead.
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ExamsPage from './ExamsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

const GROUP_A = { id: 'g1', name: 'مجموعة أ', grade: 'الأول الثانوي' };
const GROUP_B = { id: 'g2', name: 'مجموعة ب', grade: 'الثاني الثانوي' };

const EXAM_CURRENT = { id: 'e1', name: 'امتحان نوفمبر', subject: 'رياضيات', grade: 'الأول الثانوي', groupId: null, status: 'done', total: 100, pass: 50, date: '2025-11-01' };
const EXAM_OTHER    = { id: 'e2', name: 'امتحان صف آخر', subject: 'كيمياء', grade: 'الثاني الثانوي', groupId: null, status: 'done', total: 100, pass: 50, date: '2025-11-05' };

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <ExamsPage />
      </ToastProvider>
    </AuthProvider>
  );
}

function seed() {
  useAppStore.setState({
    groups: [GROUP_A, GROUP_B],
    students: [],
    grades: [],
    exams: [EXAM_CURRENT, EXAM_OTHER],
    centerProfile: { academicYear: '2025/2026' },
  });
}

function groupFilterSelect() {
  return screen.getAllByRole('combobox').find(
    (el) => Array.from(el.options).some((o) => o.textContent === 'كل المجموعات')
  );
}

describe('ExamsPage — list "Group" filter resolves grade-targeted exams (C2 fix)', () => {
  it('selecting a group shows the current, grade-targeted exam for that group\'s grade, not an empty list', () => {
    seed();
    renderPage();

    expect(screen.getByText('امتحان نوفمبر')).toBeInTheDocument();
    expect(screen.getByText('امتحان صف آخر')).toBeInTheDocument();

    fireEvent.change(groupFilterSelect(), { target: { value: 'g1' } });

    expect(screen.getByText('امتحان نوفمبر')).toBeInTheDocument();
    expect(screen.queryByText('امتحان صف آخر')).not.toBeInTheDocument();
  });

  it('clearing the filter restores all exams', () => {
    seed();
    renderPage();
    fireEvent.change(groupFilterSelect(), { target: { value: 'g2' } });
    expect(screen.queryByText('امتحان نوفمبر')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('× مسح'));
    expect(screen.getByText('امتحان نوفمبر')).toBeInTheDocument();
    expect(screen.getByText('امتحان صف آخر')).toBeInTheDocument();
  });
});
