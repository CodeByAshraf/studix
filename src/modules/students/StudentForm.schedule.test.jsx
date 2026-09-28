// src/modules/students/StudentForm.schedule.test.jsx
// Fix 2 — Student Enrollment & Attendance Schedule. The create/edit form carries the whole
// group schedule: the Primary Group + the days the student attends it (only that group's own
// meeting days, all preselected → null), and any number of Additional Groups, each with its
// own days. onSubmit receives primaryAttendDays + the complete additionalGroups list, which
// the backend applies in one transaction (enrollmentService.applyStudentEnrollmentsTx).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentForm from './StudentForm';
import { useAppStore } from '../../store/app.store';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetStudentEnrollments: vi.fn() };
});
import { pgGetStudentEnrollments } from '../../services/api';

const GRADE = 'الصف الأول الثانوي';
const GA = { id: 'gA', name: 'مجموعة أ', subject: 'رياضيات', grade: GRADE, days: ['sat', 'mon'] };
const GB = { id: 'gB', name: 'مجموعة ب', subject: 'فيزياء', grade: GRADE, days: ['mon', 'thu'] };
const GC = { id: 'gC', name: 'مجموعة ج', subject: 'كيمياء', grade: GRADE, days: ['tue'] };
const G_OTHER_GRADE = { id: 'gX', name: 'مجموعة صف آخر', subject: 'رياضيات', grade: 'الصف الثاني الثانوي', days: ['sun'] };

const STUDENT = {
  id: 's1', name: 'أحمد علي', phone: '01012345678', parentPhone: '', grade: GRADE, groupId: 'gA',
  monthlyFee: 300, school: '', notes: '', status: 'active', enrollDate: '2026-01-01',
};

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ groups: [GA, GB, GC, G_OTHER_GRADE], students: [] });
});

function renderCreate(onSubmit = vi.fn()) {
  render(<StudentForm onSubmit={onSubmit} onCancel={() => {}} />);
  fireEvent.change(document.querySelector('input[name="name"]'), { target: { name: 'name', value: 'سارة محمد' } });
  fireEvent.change(document.querySelector('input[name="phone"]'), { target: { name: 'phone', value: '01098765432' } });
  fireEvent.change(document.querySelector('select[name="grade"]'), { target: { name: 'grade', value: GRADE } });
  return onSubmit;
}

function pickPrimary(groupId) {
  fireEvent.change(document.querySelector('select[name="groupId"]'), { target: { name: 'groupId', value: groupId } });
}

const primaryPicker = () => screen.getByRole('group', { name: 'أيام حضور الطالب في المجموعة الرئيسية' });
const additionalRow = (i) => screen.getByTestId(`additional-row-${i}`);
const submit = () => fireEvent.click(screen.getByText(/تسجيل الطالب|حفظ التعديلات/));

describe('StudentForm — create: Primary Group attendance days', () => {
  it("1. shows only the Primary group's meeting days, all preselected; submitting all days sends null", async () => {
    const onSubmit = renderCreate();
    pickPrimary('gA');

    const days = within(primaryPicker()).getAllByRole('button');
    expect(days.map((b) => b.textContent)).toEqual(['السبت', 'الاثنين']);
    expect(days.every((b) => b.getAttribute('aria-pressed') === 'true')).toBe(true);

    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ groupId: 'gA', primaryAttendDays: null, additionalGroups: [] });
  });

  it('2. a selected subset of the Primary days is sent as that array', async () => {
    const onSubmit = renderCreate();
    pickPrimary('gA');
    fireEvent.click(within(primaryPicker()).getByRole('button', { name: 'الاثنين' }));

    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].primaryAttendDays).toEqual(['sat']);
  });

  it('changing the Primary Group resets its days to all of the new group\'s days', async () => {
    const onSubmit = renderCreate();
    pickPrimary('gA');
    fireEvent.click(within(primaryPicker()).getByRole('button', { name: 'الاثنين' }));
    pickPrimary('gB');

    expect(within(primaryPicker()).getAllByRole('button').map((b) => b.textContent)).toEqual(['الاثنين', 'الخميس']);
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ groupId: 'gB', primaryAttendDays: null });
  });
});

describe('StudentForm — create: Additional Groups', () => {
  it('3. multiple Additional Groups, each with its own independent days (Primary A sat, B mon+thu, C tue)', async () => {
    const onSubmit = renderCreate();
    pickPrimary('gA');
    fireEvent.click(within(primaryPicker()).getByRole('button', { name: 'الاثنين' })); // A → Saturday only

    fireEvent.click(screen.getByLabelText(/الطالب يحضر مجموعة أخرى/));
    fireEvent.change(within(additionalRow(0)).getByRole('combobox'), { target: { value: 'gB' } });
    fireEvent.click(screen.getByText('+ إضافة مجموعة أخرى'));
    fireEvent.change(within(additionalRow(1)).getByRole('combobox'), { target: { value: 'gC' } });

    // each row's picker shows only its own group's days
    expect(within(additionalRow(0)).getAllByRole('button', { pressed: true }).map((b) => b.textContent)).toEqual(['الاثنين', 'الخميس']);
    expect(within(additionalRow(1)).getAllByRole('button', { pressed: true }).map((b) => b.textContent)).toEqual(['الثلاثاء']);

    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      groupId: 'gA',
      primaryAttendDays: ['sat'],
      additionalGroups: [{ groupId: 'gB', attendDays: null }, { groupId: 'gC', attendDays: null }],
    });
  });

  it("4/5. an Additional row never offers the Primary Group, another row's group, or another grade's group", () => {
    renderCreate();
    pickPrimary('gA');
    fireEvent.click(screen.getByLabelText(/الطالب يحضر مجموعة أخرى/));
    fireEvent.change(within(additionalRow(0)).getByRole('combobox'), { target: { value: 'gB' } });
    fireEvent.click(screen.getByText('+ إضافة مجموعة أخرى'));

    const options = within(within(additionalRow(1)).getByRole('combobox')).getAllByRole('option').map((o) => o.value).filter(Boolean);
    expect(options).toEqual(['gC']); // not gA (Primary), not gB (row 0), not gX (other grade)
  });

  it('an Additional row left without a group blocks the save with a clear message', async () => {
    const onSubmit = renderCreate();
    pickPrimary('gA');
    fireEvent.click(screen.getByLabelText(/الطالب يحضر مجموعة أخرى/));

    submit();
    expect(await screen.findByText(/اختر المجموعة لكل مجموعة إضافية/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('switching the Primary to a group already chosen as Additional blocks the save', async () => {
    const onSubmit = renderCreate();
    pickPrimary('gA');
    fireEvent.click(screen.getByLabelText(/الطالب يحضر مجموعة أخرى/));
    fireEvent.change(within(additionalRow(0)).getByRole('combobox'), { target: { value: 'gB' } });
    pickPrimary('gB');

    submit();
    expect(await screen.findByText(/المجموعة الرئيسية لا يمكن اختيارها كمجموعة إضافية/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('StudentForm — edit: the whole schedule stays inside the edit workflow', () => {
  function renderEdit(onSubmit = vi.fn()) {
    render(<StudentForm initialValues={STUDENT} editId="s1" onSubmit={onSubmit} onCancel={() => {}} />);
    return onSubmit;
  }

  it('12/13. loads the current enrollments, then saves edited Primary days and the edited Additional list', async () => {
    pgGetStudentEnrollments.mockResolvedValue([
      { id: 'e1', studentId: 's1', groupId: 'gA', role: 'primary', status: 'active', attendDays: ['sat'] },
      { id: 'e2', studentId: 's1', groupId: 'gB', role: 'additional', status: 'active', attendDays: ['thu'] },
      { id: 'e3', studentId: 's1', groupId: 'gC', role: 'additional', status: 'active', attendDays: null },
    ]);
    const onSubmit = renderEdit();

    await waitFor(() => expect(screen.getByTestId('additional-row-1')).toBeInTheDocument());
    expect(within(primaryPicker()).getAllByRole('button', { pressed: true }).map((b) => b.textContent)).toEqual(['السبت']);
    expect(within(additionalRow(0)).getAllByRole('button', { pressed: true }).map((b) => b.textContent)).toEqual(['الخميس']);

    fireEvent.click(within(primaryPicker()).getByRole('button', { name: 'الاثنين' }));     // Primary → all days
    fireEvent.click(within(additionalRow(0)).getByRole('button', { name: 'الاثنين' }));    // B → mon+thu (all)
    fireEvent.click(within(additionalRow(1)).getByText('حذف'));                             // withdraw C

    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      primaryAttendDays: null,
      additionalGroups: [{ groupId: 'gB', attendDays: null }],
    });
  });

  it('unticking "attends another group" sends an empty Additional list (withdraws them all)', async () => {
    pgGetStudentEnrollments.mockResolvedValue([
      { id: 'e1', studentId: 's1', groupId: 'gA', role: 'primary', status: 'active', attendDays: null },
      { id: 'e2', studentId: 's1', groupId: 'gB', role: 'additional', status: 'active', attendDays: null },
    ]);
    const onSubmit = renderEdit();
    await screen.findByTestId('additional-row-0');

    fireEvent.click(screen.getByLabelText(/الطالب يحضر مجموعة أخرى/));
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].additionalGroups).toEqual([]);
  });

  it('if the enrollments fail to load, the student saves WITHOUT schedule fields (enrollments left untouched)', async () => {
    pgGetStudentEnrollments.mockRejectedValue(new Error('network'));
    const onSubmit = renderEdit();
    expect(await screen.findByText(/تعذّر تحميل مجموعات الطالب/)).toBeInTheDocument();

    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('primaryAttendDays');
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('additionalGroups');
  });

  it('save is disabled while the current enrollments are still loading', () => {
    pgGetStudentEnrollments.mockReturnValue(new Promise(() => {}));
    renderEdit();
    expect(screen.getByText(/حفظ التعديلات/).closest('button')).toBeDisabled();
  });
});
