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
    pgUpdateEnrollmentSchedule: vi.fn(),
  };
});
import { pgGetPayments, pgGetStudentEnrollments, pgAddAdditionalGroup, pgWithdrawEnrollment, pgUpdateEnrollmentSchedule } from '../../services/api';

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
      // Fix 2 — each group carries its real meeting days (the day pickers show only these).
      { id: GROUP_A, name: 'مجموعة أ', grade: 'الأول', max: 20, subject: 'رياضيات', days: ['sat', 'mon'] },
      { id: GROUP_B, name: 'مجموعة ب', grade: 'الأول', max: 20, subject: 'فيزياء', days: ['sat', 'tue'] },
      { id: GROUP_C, name: 'مجموعة ج', grade: 'الأول', max: 20, subject: 'كيمياء', days: ['wed'] },
      { id: 'gOther', name: 'مجموعة صف آخر', grade: 'الثاني', max: 20, subject: 'رياضيات', days: ['sun'] },
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
    // Fix 2 — the Primary row now also shows its effective days, so match each row exactly
    expect(screen.getByText('أيام الحضور: السبت، الثلاثاء')).toBeInTheDocument();
    expect(screen.getByText('أيام الحضور: كل أيام المجموعة (السبت - الاثنين)')).toBeInTheDocument();
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
    // Fix 2 — group B meets sat+tue: both preselected; deselecting Tuesday leaves ['sat']
    fireEvent.click(screen.getByRole('button', { name: 'الثلاثاء' }));
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

  // ── Fix 2 — attendance days from the group's own schedule, editable in place ──────────
  it("8. the add form's day picker shows only the chosen group's meeting days (not all 7), all selected by default → null", async () => {
    seedState();
    pgGetStudentEnrollments.mockResolvedValue([primaryEnrollment()]);
    pgAddAdditionalGroup.mockResolvedValue(additionalEnrollment());
    renderProfile();
    openGroupsTab();
    await screen.findByText('مجموعة أ');

    fireEvent.click(screen.getByText('+ إضافة مجموعة'));
    fireEvent.change(screen.getByDisplayValue('اختر مجموعة إضافية...'), { target: { value: GROUP_B } });

    const picker = screen.getByRole('group', { name: 'أيام الحضور' });
    expect(within(picker).getAllByRole('button').map(b => b.textContent)).toEqual(['السبت', 'الثلاثاء']);
    expect(within(picker).getAllByRole('button').every(b => b.getAttribute('aria-pressed') === 'true')).toBe(true);

    fireEvent.click(screen.getByText('إضافة'));
    await waitFor(() => expect(pgAddAdditionalGroup).toHaveBeenCalledWith(
      S1, expect.objectContaining({ groupId: GROUP_B, attendDays: null })
    ));
  });

  it("9. the add dropdown lists only groups of the student's grade", async () => {
    seedState();
    pgGetStudentEnrollments.mockResolvedValue([primaryEnrollment()]);
    renderProfile();
    openGroupsTab();
    await screen.findByText('مجموعة أ');

    fireEvent.click(screen.getByText('+ إضافة مجموعة'));

    const optionTexts = within(screen.getByDisplayValue('اختر مجموعة إضافية...')).getAllByRole('option').map(o => o.textContent);
    expect(optionTexts.some(t => t.includes('مجموعة صف آخر'))).toBe(false);
    expect(optionTexts.some(t => t.includes('مجموعة ج'))).toBe(true);
  });

  it("10. editing an Additional Group's days calls PATCH (pgUpdateEnrollmentSchedule) and refreshes", async () => {
    seedState();
    pgGetStudentEnrollments.mockResolvedValue([primaryEnrollment(), additionalEnrollment()]);
    pgUpdateEnrollmentSchedule.mockResolvedValue(additionalEnrollment({ attendDays: ['tue'] }));
    renderProfile();
    openGroupsTab();
    await screen.findByText('مجموعة ب');
    const callsBefore = pgGetStudentEnrollments.mock.calls.length;

    fireEvent.click(screen.getAllByText('تعديل الأيام')[1]); // [0] Primary, [1] Additional
    fireEvent.click(screen.getByRole('button', { name: 'السبت' }));
    fireEvent.click(screen.getByText('حفظ الأيام'));

    await waitFor(() => expect(pgUpdateEnrollmentSchedule).toHaveBeenCalledWith('e-additional', { attendDays: ['tue'] }));
    await waitFor(() => expect(pgGetStudentEnrollments.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("11. editing the Primary Group's days offers only the Primary group's days and sends the subset", async () => {
    seedState();
    pgGetStudentEnrollments.mockResolvedValue([primaryEnrollment()]);
    pgUpdateEnrollmentSchedule.mockResolvedValue(primaryEnrollment({ attendDays: ['sat'] }));
    renderProfile();
    openGroupsTab();
    await screen.findByText('مجموعة أ');

    fireEvent.click(screen.getByText('تعديل الأيام'));
    const picker = screen.getByRole('group', { name: 'أيام الحضور' });
    expect(within(picker).getAllByRole('button').map(b => b.textContent)).toEqual(['السبت', 'الاثنين']);
    fireEvent.click(within(picker).getByRole('button', { name: 'الاثنين' }));
    fireEvent.click(screen.getByText('حفظ الأيام'));

    await waitFor(() => expect(pgUpdateEnrollmentSchedule).toHaveBeenCalledWith('e-primary', { attendDays: ['sat'] }));
  });

  it('12. the last selected day cannot be deselected (an empty attend_days is never produced)', async () => {
    seedState();
    pgGetStudentEnrollments.mockResolvedValue([primaryEnrollment({ attendDays: ['sat'] })]);
    pgUpdateEnrollmentSchedule.mockResolvedValue(primaryEnrollment({ attendDays: ['sat'] }));
    renderProfile();
    openGroupsTab();
    await screen.findByText('مجموعة أ');

    fireEvent.click(screen.getByText('تعديل الأيام'));
    const picker = screen.getByRole('group', { name: 'أيام الحضور' });
    fireEvent.click(within(picker).getByRole('button', { name: 'السبت' })); // the only selected day
    expect(within(picker).getByRole('button', { name: 'السبت' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByText('حفظ الأيام'));

    await waitFor(() => expect(pgUpdateEnrollmentSchedule).toHaveBeenCalledWith('e-primary', { attendDays: ['sat'] }));
  });
});
