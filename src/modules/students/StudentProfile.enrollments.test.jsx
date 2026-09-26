// src/modules/students/StudentProfile.enrollments.test.jsx
// Phase 3B (Multi-Group Enrollment UI) — the new "المجموعات" (Groups) tab on
// StudentProfile: shows Primary + Additional enrollments (via the existing Phase 3A
// pgGetStudentEnrollments), and lets the user add/withdraw an Additional Group (via the
// existing pgAddAdditionalGroup/pgWithdrawEnrollment) — no new API logic here, only UI
// wired to those three already-tested functions. Same module-mocking convention as
// StudentsPage.test.jsx (vi.mock('../../services/api', ...) preserving the real module for
// anything not explicitly mocked).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentProfile from './StudentProfile';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return {
    ...actual,
    pgGetPayments: vi.fn(),
    pgGetStudentEnrollments: vi.fn(),
    pgAddAdditionalGroup: vi.fn(),
    pgWithdrawEnrollment: vi.fn(),
  };
});
import { pgGetPayments, pgGetStudentEnrollments, pgAddAdditionalGroup, pgWithdrawEnrollment } from '../../services/api';

const S1 = 's1';
const GROUP_A = 'gA';
const GROUP_B = 'gB';
const GROUP_C = 'gC';

const BASE_STUDENT = {
  id: S1, name: 'طالب واحد', code: 'TC001', grade: 'الأول', phone: '01000000001',
  parentPhone: '01000000002', groupId: GROUP_A, status: 'active', enrollDate: '2025-01-01', monthlyFee: 100,
};

function seedState(extra = {}) {
  useAppStore.setState({
    groups: [
      { id: GROUP_A, name: 'مجموعة أ', grade: 'الأول', max: 20, subject: 'رياضيات' },
      { id: GROUP_B, name: 'مجموعة ب', grade: 'الأول', max: 20, subject: 'فيزياء' },
      { id: GROUP_C, name: 'مجموعة ج', grade: 'الأول', max: 20, subject: 'كيمياء' },
    ],
    students: [BASE_STUDENT],
    attendance: [], exams: [], grades: [], parents: [],
    ...extra,
  });
  pgGetPayments.mockResolvedValue([]);
}

function renderProfile() {
  return render(
    <ToastProvider>
      <StudentProfile studentId={S1} onBack={() => {}} onEdit={() => {}} />
    </ToastProvider>
  );
}

function openGroupsTab() {
  fireEvent.click(screen.getByRole('button', { name: /المجموعات/ }));
}

const primaryEnrollment = (over = {}) => ({
  id: 'e-primary', studentId: S1, groupId: GROUP_A, role: 'primary', status: 'active',
  startDate: '2025-01-01T00:00:00.000Z', endDate: null, attendDays: null, ...over,
});
const additionalEnrollment = (over = {}) => ({
  id: 'e-additional', studentId: S1, groupId: GROUP_B, role: 'additional', status: 'active',
  startDate: '2025-02-01T00:00:00.000Z', endDate: null, attendDays: ['sat', 'tue'], ...over,
});

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('StudentProfile — Groups tab (Phase 3B)', () => {
  it('1. student with Primary only: shows the Primary Group, and "no additional groups"', async () => {
    seedState();
    pgGetStudentEnrollments.mockResolvedValue([primaryEnrollment()]);
    renderProfile();

    openGroupsTab();

    expect(await screen.findByText('مجموعة أ')).toBeInTheDocument();
    expect(screen.getByText('لا توجد مجموعات إضافية')).toBeInTheDocument();
  });

  it('2. student with Primary + Additional: shows both, additional row includes its attendDays', async () => {
    seedState();
    pgGetStudentEnrollments.mockResolvedValue([primaryEnrollment(), additionalEnrollment()]);
    renderProfile();

    openGroupsTab();

    expect(await screen.findByText('مجموعة أ')).toBeInTheDocument();
    expect(screen.getByText('مجموعة ب')).toBeInTheDocument();
    expect(screen.getByText(/السبت/)).toBeInTheDocument();
    expect(screen.getByText(/الثلاثاء/)).toBeInTheDocument();
  });

  it('3. student with Additional only (no Primary): shows "no Primary Group" and the Additional row', async () => {
    seedState({ students: [{ ...BASE_STUDENT, groupId: null }] });
    pgGetStudentEnrollments.mockResolvedValue([additionalEnrollment()]);
    renderProfile();

    openGroupsTab();

    expect(await screen.findByText('لا توجد مجموعة رئيسية حالياً')).toBeInTheDocument();
    expect(screen.getByText('مجموعة ب')).toBeInTheDocument();
  });

  it('4. student with no enrollments at all: both sections show empty state, no crash', async () => {
    seedState({ students: [{ ...BASE_STUDENT, groupId: null }] });
    pgGetStudentEnrollments.mockResolvedValue([]);
    renderProfile();

    openGroupsTab();

    expect(await screen.findByText('لا توجد مجموعة رئيسية حالياً')).toBeInTheDocument();
    expect(screen.getByText('لا توجد مجموعات إضافية')).toBeInTheDocument();
  });

  it('5. adding an Additional Group calls pgAddAdditionalGroup with the selected fields and refreshes the list', async () => {
    seedState();
    pgGetStudentEnrollments
      .mockResolvedValueOnce([primaryEnrollment()])
      .mockResolvedValueOnce([primaryEnrollment(), additionalEnrollment()]);
    pgAddAdditionalGroup.mockResolvedValue(additionalEnrollment());
    renderProfile();
    openGroupsTab();
    await screen.findByText('مجموعة أ');

    fireEvent.click(screen.getByText('+ إضافة مجموعة'));
    fireEvent.change(screen.getByDisplayValue('اختر مجموعة إضافية...'), { target: { value: GROUP_B } });
    fireEvent.click(screen.getByText('السبت'));
    fireEvent.click(screen.getByText('إضافة'));

    await waitFor(() => expect(pgAddAdditionalGroup).toHaveBeenCalledWith(
      S1, expect.objectContaining({ groupId: GROUP_B, attendDays: ['sat'] })
    ));
    // refreshed: the second mocked response (with the additional group) is now shown
    await waitFor(() => expect(screen.getByText('مجموعة ب')).toBeInTheDocument());
  });

  it('6. withdrawing an Additional Group confirms, then calls pgWithdrawEnrollment and refreshes', async () => {
    seedState();
    pgGetStudentEnrollments
      .mockResolvedValueOnce([primaryEnrollment(), additionalEnrollment()])
      .mockResolvedValueOnce([primaryEnrollment()]);
    pgWithdrawEnrollment.mockResolvedValue({ ...additionalEnrollment(), status: 'withdrawn' });
    renderProfile();
    openGroupsTab();
    await screen.findByText('مجموعة ب');

    fireEvent.click(screen.getByText('سحب'));
    fireEvent.click(await screen.findByRole('button', { name: 'نعم، اسحب' }));

    await waitFor(() => expect(pgWithdrawEnrollment).toHaveBeenCalledWith('e-additional'));
    await waitFor(() => expect(screen.getByText('لا توجد مجموعات إضافية')).toBeInTheDocument());
  });

  it('7. duplicate prevention: the "add" group dropdown excludes groups the student is already actively enrolled in', async () => {
    seedState();
    pgGetStudentEnrollments.mockResolvedValue([primaryEnrollment(), additionalEnrollment()]); // A (primary) + B (additional)
    renderProfile();
    openGroupsTab();
    await screen.findByText('مجموعة أ');

    fireEvent.click(screen.getByText('+ إضافة مجموعة'));

    const select = screen.getByDisplayValue('اختر مجموعة إضافية...');
    const optionTexts = within(select).getAllByRole('option').map(o => o.textContent);
    expect(optionTexts.some(t => t.includes('مجموعة أ'))).toBe(false); // already Primary
    expect(optionTexts.some(t => t.includes('مجموعة ب'))).toBe(false); // already Additional
    expect(optionTexts.some(t => t.includes('مجموعة ج'))).toBe(true);  // not yet enrolled — selectable
  });
});
