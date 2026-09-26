// src/modules/exams/ExamReports.studentSearch.test.jsx
// The "طباعة كشف" tab's "بالطالب" mode used a native <select> of groupStudents
// (students.filter(s => s.groupId === groupId && s.status === 'active')). It now uses the
// shared StudentSearchSelect (same component already proven in PaymentForm.jsx). This proves
// the swap preserves the exact prior behavior: same group-scoped + active-only eligibility,
// same studentId state driving the same "generate report" enablement, with Arabic
// partial-name/code search on top.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ExamReports from './ExamReports';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

// Phase 1D (Grades global-read migration) — same reason as ExamReports.groupFilter.test.jsx.
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

// s1/s2: active, in group A (eligible). s3: active but in group B (must stay excluded while
// group A is selected — proves group-scoping is preserved). s4: in group A but inactive
// (must stay excluded — proves the existing status==='active' filter is preserved).
const STUDENT_A1        = { id: 's1', name: 'أشرف محمد', code: 'C001', groupId: 'g1', status: 'active' };
const STUDENT_A2        = { id: 's2', name: 'أشرف علي',  code: 'C002', groupId: 'g1', status: 'active' };
const STUDENT_OTHER_GRP = { id: 's3', name: 'أشرف حسن',  code: 'C003', groupId: 'g2', status: 'active' };
const STUDENT_INACTIVE  = { id: 's4', name: 'أشرف سعيد', code: 'C004', groupId: 'g1', status: 'inactive' };

function seed() {
  useAppStore.setState({
    groups: [GROUP_A, GROUP_B],
    students: [STUDENT_A1, STUDENT_A2, STUDENT_OTHER_GRP, STUDENT_INACTIVE],
    grades: [], exams: [],
  });
}

function openStudentPrintMode() {
  render(<ToastProvider><ExamReports /></ToastProvider>);
  // زر التاب "{icon} {label}" يُصيَّر كعُقَد نصية منفصلة (الأيقونة + مسافة + النص) —
  // نص العنصر الكامل "🖨 طباعة كشف"، فمطابقة جزئية (regex) أضمن من نص حرفي كامل هنا.
  fireEvent.click(screen.getByText(/طباعة كشف/));
  fireEvent.click(screen.getByText('بالطالب'));
}

function generateButton() {
  return screen.getByText('🖨 توليد الكشف وطباعته').closest('button');
}

// حقل المجموعة الوحيد الظاهر هنا هو <select> يحمل خيار "اختر المجموعة..." — تمييزه بهذا
// بدل ترتيب فهرسي هش يمنع أي كسر لاحق لو أُضيف <select> آخر إلى الصفحة.
function groupSelect() {
  return screen.getAllByRole('combobox').find(
    (el) => el.tagName === 'SELECT' && Array.from(el.options).some((o) => o.textContent === 'اختر المجموعة...')
  );
}

// StudentSearchSelect هو العنصر الوحيد من نوع role=combobox المُصيَّر كـ <input> هنا —
// كل حقول المجموعة/الامتحان الأخرى في هذه الشاشة هي <select> عادية.
function studentInput() {
  return screen.getAllByRole('combobox').find((el) => el.tagName === 'INPUT');
}

// getAllByRole('option') على مستوى الصفحة يلتقط أيضاً <option> الخاصة بـ <select> المجموعة
// (بما فيها الخيار الفارغ) — النطاق داخل الـ listbox الذي يُصيَّره StudentSearchSelect فقط
// هو ما يعكس فعلياً نتائج البحث.
function resultOptions() {
  return within(screen.getByRole('listbox')).getAllByRole('option');
}

describe('ExamReports (print tab, "بالطالب" mode) — group-scoped student selector is now searchable', () => {
  it('renders a disabled search combobox with a "pick a group first" placeholder until a group is chosen', () => {
    seed();
    openStudentPrintMode();

    expect(studentInput()).toBeDisabled();
    expect(studentInput()).toHaveAttribute('placeholder', 'اختر المجموعة أولاً...');
    expect(generateButton()).toBeDisabled();
  });

  it('after picking the group, searching by partial Arabic name returns only that group\'s active students', () => {
    seed();
    openStudentPrintMode();

    fireEvent.change(groupSelect(), { target: { value: 'g1' } });

    expect(studentInput()).not.toBeDisabled();
    fireEvent.change(studentInput(), { target: { value: 'أشرف' } });

    const options = resultOptions();
    expect(options).toHaveLength(2);
    expect(screen.getByRole('option', { name: /أشرف محمد/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /أشرف علي/ })).toBeInTheDocument();
    // مجموعة أخرى (نفس نمط الاسم) وطالب موقوف في نفس المجموعة — كلاهما يجب ألا يظهر،
    // بنفس فلترة groupStudents القديمة بالضبط.
    expect(screen.queryByText('أشرف حسن')).not.toBeInTheDocument();
    expect(screen.queryByText('أشرف سعيد')).not.toBeInTheDocument();
  });

  it('searching by student code returns the matching student', () => {
    seed();
    openStudentPrintMode();
    fireEvent.change(groupSelect(), { target: { value: 'g1' } });

    fireEvent.change(studentInput(), { target: { value: 'C002' } });

    const options = resultOptions();
    expect(options).toHaveLength(1);
    expect(screen.getByRole('option', { name: /أشرف علي/ })).toBeInTheDocument();
  });

  it('selecting a result sets the same studentId state the old <select> produced, enabling report generation', () => {
    seed();
    openStudentPrintMode();
    fireEvent.change(groupSelect(), { target: { value: 'g1' } });

    fireEvent.change(studentInput(), { target: { value: 'أشرف محمد' } });
    fireEvent.click(screen.getByRole('option', { name: /أشرف محمد/ }));

    expect(studentInput()).toHaveValue('أشرف محمد');
    expect(generateButton()).not.toBeDisabled();
  });

  it('changing the group resets the student selection, keeping the old cross-field reset behavior', () => {
    seed();
    openStudentPrintMode();
    fireEvent.change(groupSelect(), { target: { value: 'g1' } });
    fireEvent.change(studentInput(), { target: { value: 'أشرف محمد' } });
    fireEvent.click(screen.getByRole('option', { name: /أشرف محمد/ }));
    expect(generateButton()).not.toBeDisabled();

    fireEvent.change(groupSelect(), { target: { value: 'g2' } });
    expect(generateButton()).toBeDisabled();
    expect(studentInput()).toHaveValue('');
  });
});
