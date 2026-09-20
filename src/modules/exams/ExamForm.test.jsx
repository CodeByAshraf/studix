// src/modules/exams/ExamForm.test.jsx
// Exams Phase 3C — scheduling fields (scheduledTime, durationMinutes) on ExamForm.jsx.
// Both fields are optional, administrative-display-only (no timer/Start action exists
// yet), and the computed end time is never sent to the server — only the two raw inputs
// are (see examService.test.js for the pure createExam/updateExam/computeExamEndTime
// coverage). This file proves the form wiring: rendering, loading existing values on
// edit, validation error display, and that a historical exam with no timing data still
// opens/validates/submits normally.
//
// ExamForm.jsx's F/I helper components don't associate <label> with <input> via
// htmlFor/id (same as every other form in this codebase — see ExamsPage.test.jsx's own
// comment on this), so fields are queried by `name` attribute directly rather than
// getByLabelText.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ExamForm from './ExamForm';
import { useAppStore } from '../../store/app.store';
import { GRADES } from '../../services/groupService';
import { validateExam } from '../../services/examService';

const GRADE_6 = GRADES[0];

function seed(over = {}) {
  useAppStore.setState({ centerProfile: { academicYear: '2025/2026' }, ...over });
}

function fillRequired(container) {
  fireEvent.change(screen.getByPlaceholderText('مثال: امتحان شهري مارس — رياضيات'), { target: { value: 'امتحان', name: 'name' } });
  fireEvent.change(container.querySelector('select[name="grade"]'), { target: { value: GRADE_6, name: 'grade' } });
  fireEvent.change(container.querySelector('select[name="subject"]'), { target: { value: 'رياضيات', name: 'subject' } });
}

describe('ExamForm — scheduling fields (Exams Phase 3C)', () => {
  beforeEach(() => { seed(); });

  it('renders empty, optional scheduling fields for a new exam — no end time shown yet', () => {
    const { container } = render(<ExamForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(container.querySelector('input[name="scheduledTime"]')).toHaveValue('');
    expect(container.querySelector('input[name="durationMinutes"]')).toHaveValue(null);
    expect(screen.queryByText(/موعد الانتهاء المتوقَّع/)).not.toBeInTheDocument();
  });

  it('shows the computed end time once both scheduledTime and durationMinutes are filled', () => {
    const { container } = render(<ExamForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(container.querySelector('input[name="scheduledTime"]'), { target: { value: '09:00' } });
    fireEvent.change(container.querySelector('input[name="durationMinutes"]'), { target: { value: '60' } });
    expect(screen.getByText(/موعد الانتهاء المتوقَّع/)).toBeInTheDocument();
    expect(container.querySelector('input[name="endTimeDisplay"]')).toHaveValue('10:00');
  });

  it('flags a midnight-crossing end time explicitly', () => {
    const { container } = render(<ExamForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(container.querySelector('input[name="scheduledTime"]'), { target: { value: '23:30' } });
    fireEvent.change(container.querySelector('input[name="durationMinutes"]'), { target: { value: '60' } });
    expect(container.querySelector('input[name="endTimeDisplay"]')).toHaveValue('00:30 (اليوم التالي)');
  });

  it('providing only one scheduling field shows no end time and no validation error', () => {
    const { container } = render(<ExamForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const scheduledTimeInput = container.querySelector('input[name="scheduledTime"]');
    fireEvent.change(scheduledTimeInput, { target: { value: '09:00' } });
    fireEvent.blur(scheduledTimeInput);
    expect(screen.queryByText(/موعد الانتهاء المتوقَّع/)).not.toBeInTheDocument();
    expect(screen.queryByText(/تنسيق الوقت غير صحيح/)).not.toBeInTheDocument();
  });

  it('submitting with valid scheduling fields includes them in the payload', () => {
    const onSubmit = vi.fn();
    const { container } = render(<ExamForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    fillRequired(container);
    fireEvent.change(screen.getByPlaceholderText('100'), { target: { value: '100', name: 'total' } });
    fireEvent.change(container.querySelector('input[name="scheduledTime"]'), { target: { value: '14:00' } });
    fireEvent.change(container.querySelector('input[name="durationMinutes"]'), { target: { value: '45' } });

    fireEvent.click(screen.getByRole('button', { name: /إنشاء الامتحان/ }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.scheduledTime).toBe('14:00');
    expect(payload.durationMinutes).toBe('45');
  });

  it('a historical exam (no scheduling data at all) opens for editing and validates without any timing fields', () => {
    const onSubmit = vi.fn();
    const historicalExam = { id: 'e1', name: 'امتحان قديم', grade: GRADE_6, subject: 'رياضيات', date: '2024-01-10', total: 100, pass: 50, status: 'done' };
    const { container } = render(<ExamForm initialValues={historicalExam} editId="e1" onSubmit={onSubmit} onCancel={vi.fn()} />);

    expect(container.querySelector('input[name="scheduledTime"]')).toHaveValue('');
    expect(container.querySelector('input[name="durationMinutes"]')).toHaveValue(null);

    fireEvent.click(screen.getByRole('button', { name: /حفظ التعديلات/ }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.scheduledTime).toBe('');
    expect(payload.durationMinutes).toBe('');
  });

  it('editing an exam with existing scheduling data loads it correctly', () => {
    const scheduledExam = { id: 'e2', name: 'امتحان مجدول', grade: GRADE_6, subject: 'رياضيات', date: '2026-03-10', total: 100, pass: 50, status: 'upcoming', scheduledTime: '10:30', durationMinutes: 90 };
    const { container } = render(<ExamForm initialValues={scheduledExam} editId="e2" onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(container.querySelector('input[name="scheduledTime"]')).toHaveValue('10:30');
    expect(container.querySelector('input[name="durationMinutes"]')).toHaveValue(90);
    expect(container.querySelector('input[name="endTimeDisplay"]')).toHaveValue('12:00');
  });

  it('the native time input itself rejects an out-of-range value (defense at the HTML5 widget level)', () => {
    const { container } = render(<ExamForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const scheduledTimeInput = container.querySelector('input[name="scheduledTime"]');
    fireEvent.change(scheduledTimeInput, { target: { value: '25:00' } });
    // type="time" constrains its own .value to a valid HH:MM or empty — "25:00" never
    // actually reaches React state, so the field stays empty rather than becoming invalid.
    expect(scheduledTimeInput).toHaveValue('');
  });

  it('(defensive, service-level) validateExam itself rejects a malformed time string regardless of input source — see examService.test.js for full coverage', () => {
    // The native <input type="time"> widget can never produce an out-of-range value (see
    // the test above), so this can only be reached via non-UI data (e.g. a future API/
    // import path). validateExam's own rejection is already fully exercised directly in
    // examService.test.js's "rejects invalid time formats" test — this is a single
    // pointer assertion, not a duplicate of that coverage.
    expect(validateExam({ name: 'x', grade: GRADE_6, date: '2026-01-01', total: '10', pass: '5', scheduledTime: '25:00' }).scheduledTime).toBeTruthy();
  });

  it('rejects an invalid (non-positive) duration and blocks submit', () => {
    const onSubmit = vi.fn();
    const { container } = render(<ExamForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    fillRequired(container);
    fireEvent.change(screen.getByPlaceholderText('100'), { target: { value: '100', name: 'total' } });
    fireEvent.change(container.querySelector('input[name="durationMinutes"]'), { target: { value: '0' } });

    fireEvent.click(screen.getByRole('button', { name: /إنشاء الامتحان/ }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/رقماً صحيحاً أكبر من صفر/)).toBeInTheDocument();
  });
});
