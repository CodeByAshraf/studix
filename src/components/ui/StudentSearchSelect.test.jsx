// src/components/ui/StudentSearchSelect.test.jsx
// Searchable student combobox — replaces the Payments screen's old native <select> of every
// student (unusable past ~1,000 students). Purely presentational component: no store, no
// network — filters the array it's given by name/code/phone and renders only a capped set
// of DOM rows, never the full list.
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentSearchSelect from './StudentSearchSelect';

const STUDENTS = [
  { id: 's1', name: 'أشرف محمد', code: 'C001', phone: '01011112222', status: 'active' },
  { id: 's2', name: 'أشرف أحمد', code: 'C002', phone: '01022223333', status: 'active' },
  { id: 's3', name: 'أشرف السيد', code: 'C003', phone: null, status: 'active' },
  { id: 's4', name: 'سارة علي', code: 'C004', phone: '01099998888', status: 'active' },
];

function Harness(props) {
  const [value, setValue] = useState(props.initialValue || '');
  return <StudentSearchSelect students={props.students ?? STUDENTS} value={value} onChange={(id) => { setValue(id); props.onChange?.(id); }} />;
}

function getInput() {
  return screen.getByRole('combobox');
}

describe('StudentSearchSelect', () => {
  it('shows a search placeholder initially, not a giant list of every student', () => {
    render(<Harness />);
    expect(getInput()).toHaveAttribute('placeholder', 'ابحث عن الطالب...');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('empty search (focused, no query): shows a helpful prompt, never the full student list', () => {
    render(<Harness />);
    fireEvent.focus(getInput());
    expect(screen.getByText('اكتب اسم الطالب أو الكود أو رقم الهاتف للبحث...')).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('search by full student name returns only matching students', () => {
    render(<Harness />);
    fireEvent.focus(getInput());
    fireEvent.change(getInput(), { target: { value: 'أشرف محمد' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(within(options[0]).getByText('أشرف محمد')).toBeInTheDocument();
  });

  it('search by partial name returns every matching student (e.g. "أشرف" -> 3 students)', () => {
    render(<Harness />);
    fireEvent.focus(getInput());
    fireEvent.change(getInput(), { target: { value: 'أشرف' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options.map((o) => within(o).getByText(/أشرف/).textContent)).toEqual(
      expect.arrayContaining(['أشرف محمد', 'أشرف أحمد', 'أشرف السيد'])
    );
    expect(screen.queryByText('سارة علي')).not.toBeInTheDocument();
  });

  it('search by student code returns the matching student', () => {
    render(<Harness />);
    fireEvent.focus(getInput());
    fireEvent.change(getInput(), { target: { value: 'C004' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(within(options[0]).getByText('سارة علي')).toBeInTheDocument();
  });

  it('search by phone number returns the matching student, when phone is available', () => {
    render(<Harness />);
    fireEvent.focus(getInput());
    fireEvent.change(getInput(), { target: { value: '01022223333' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(within(options[0]).getByText('أشرف أحمد')).toBeInTheDocument();
  });

  it('trims leading/trailing whitespace and tolerates case for latin code/phone input', () => {
    render(<Harness />);
    fireEvent.focus(getInput());
    fireEvent.change(getInput(), { target: { value: '   c004   ' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText('سارة علي')).toBeInTheDocument();
  });

  it('no results: shows the exact required Arabic message', () => {
    render(<Harness />);
    fireEvent.focus(getInput());
    fireEvent.change(getInput(), { target: { value: 'لا يوجد طالب بهذا الاسم' } });
    expect(screen.getByText('لا يوجد طالب مطابق للبحث')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('selecting a result calls onChange with the student id, closes the dropdown, and shows the student name in the field', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.focus(getInput());
    fireEvent.change(getInput(), { target: { value: 'سارة' } });
    fireEvent.click(screen.getByRole('option', { name: /سارة علي/ }));

    expect(onChange).toHaveBeenCalledWith('s4');
    expect(getInput()).toHaveValue('سارة علي');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('a large dataset (5,000 students) never renders more than the capped result count as DOM rows', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({
      id: `bulk-${i}`, name: `طالب رقم ${i}`, code: `B${i}`, phone: null, status: 'active',
    }));
    render(<Harness students={many} />);
    fireEvent.focus(getInput());
    // استعلام عام جداً (كل الطلاب في هذا المجموعة يطابقونه) — لا يجب أن يُنتج 5000 صفّ DOM.
    fireEvent.change(getInput(), { target: { value: 'طالب' } });
    const options = screen.getAllByRole('option');
    expect(options.length).toBeLessThanOrEqual(30);
    expect(options.length).toBeGreaterThan(0);
  });

  it('blur without picking a new result reverts the field back to the previously confirmed selection', () => {
    render(<Harness initialValue="s1" />);
    fireEvent.focus(getInput());
    expect(getInput()).toHaveValue('أشرف محمد');
    fireEvent.change(getInput(), { target: { value: 'شيء غير موجود' } });
    fireEvent.blur(getInput());
    expect(getInput()).toHaveValue('أشرف محمد');
  });

  it('Escape closes the dropdown and reverts unconfirmed typing', () => {
    render(<Harness initialValue="s2" />);
    fireEvent.focus(getInput());
    fireEvent.change(getInput(), { target: { value: 'زيد' } });
    fireEvent.keyDown(getInput(), { key: 'Escape' });
    expect(getInput()).toHaveValue('أشرف أحمد');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });
});
