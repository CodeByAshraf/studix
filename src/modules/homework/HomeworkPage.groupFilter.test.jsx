// src/modules/homework/HomeworkPage.groupFilter.test.jsx
// Pre-Installer Audit C3 — the homework list's "Group" filter filtered
// `h.groupId === filterGroup`. Homework 2.0 stopped setting `groupId` on new homeworks
// (targeted by grade instead — see homeworkService.js), so this filter was always empty
// for any current homework. Fixed by resolving the selected group's `grade` and filtering
// by `h.grade` instead — migration 006 backfilled `grade` on every historical row too.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import HomeworkPage from './HomeworkPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

// C4 Grades/hwSubmissions Frontend Migration (Batch A, feature 004): HomeworkPage now fetches
// submission aggregates on mount — mocked here (unrelated to this file's grade-filter concern)
// so the real network call is never attempted in this test environment.
vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetHwSubmissionsAggregate: vi.fn().mockResolvedValue([]), pgGetHomeworks: vi.fn() };
});
// Phase 2 (Homework global-read migration): the parent homework list now comes from
// pgGetHomeworks (GET /api/homeworks), not the store's homeworks array — served by the mock.
import { pgGetHomeworks } from '../../services/api';

const GROUP_A = { id: 'g1', name: 'مجموعة أ', grade: 'الأول الثانوي' };
const GROUP_B = { id: 'g2', name: 'مجموعة ب', grade: 'الثاني الثانوي' };

const HW_CURRENT = { id: 'hw1', title: 'واجب الرياضيات', subject: 'رياضيات', grade: 'الأول الثانوي', groupId: null, status: 'active', dueDate: '2025-12-01' };
const HW_OTHER    = { id: 'hw2', title: 'واجب العلوم', subject: 'علوم', grade: 'الثاني الثانوي', groupId: null, status: 'active', dueDate: '2025-12-02' };

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <HomeworkPage />
      </ToastProvider>
    </AuthProvider>
  );
}

function seed() {
  useAppStore.setState({
    groups: [GROUP_A, GROUP_B],
    students: [],
    homeworks: [],
    hwSubmissions: [],
    centerProfile: { academicYear: '2025/2026' },
  });
  pgGetHomeworks.mockResolvedValue([HW_CURRENT, HW_OTHER]);
}

function groupFilterSelect() {
  return screen.getAllByRole('combobox').find(
    (el) => Array.from(el.options).some((o) => o.textContent === 'كل المجموعات')
  );
}

describe('HomeworkPage — list "Group" filter resolves grade-targeted homeworks (C3 fix)', () => {
  it('selecting a group shows the current, grade-targeted homework for that group\'s grade, not an empty list', async () => {
    seed();
    renderPage();

    // awaits the mocked pgGetHwSubmissionsAggregate settling (act-wrapped), unrelated to this
    // test's own grade-filter concern.
    expect(await screen.findByText('واجب الرياضيات')).toBeInTheDocument();
    expect(screen.getByText('واجب العلوم')).toBeInTheDocument();

    fireEvent.change(groupFilterSelect(), { target: { value: 'g1' } });

    expect(screen.getByText('واجب الرياضيات')).toBeInTheDocument();
    expect(screen.queryByText('واجب العلوم')).not.toBeInTheDocument();
  });
});
