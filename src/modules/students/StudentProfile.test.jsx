// src/modules/students/StudentProfile.test.jsx
// MEDIUM-A Finding 6 — students.parent_id (Phase 1) كان مكتوباً لكن غير مُستخدَم في
// العرض إطلاقاً. يتحقّق هذا الاختبار أن معلومات ولي الأمر المرتبط (هاتف بديل/طريقة
// تواصل مفضّلة/وقت مفضّل) تظهر فقط عندما يتوفّر ربط حقيقي بصف parents، وتبقى غائبة
// تماماً بلا أي تغيير في السلوك عندما لا يوجد ربط (لا كسر لأي حالة سابقة).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentProfile from './StudentProfile';
import { useAppStore } from '../../store/app.store';

const GROUP_ID = 'g1';
const S1 = 's1';

const BASE_STUDENT = {
  id: S1, name: 'طالب واحد', code: 'TC001', grade: 'الأول', phone: '01000000001',
  parentPhone: '01000000002', groupId: GROUP_ID, status: 'active', enrollDate: '2025-01-01', monthlyFee: 100,
};

function seedBaseState(extra = {}) {
  useAppStore.setState({
    groups: [{ id: GROUP_ID, name: 'مجموعة أ', grade: 'الأول', max: 20 }],
    students: [BASE_STUDENT],
    attendance: [], exams: [], grades: [], payments: [], parents: [],
    ...extra,
  });
}

function renderProfile() {
  return render(<StudentProfile studentId={S1} onBack={() => {}} onEdit={() => {}} />);
}

describe('StudentProfile — linked parent info (MEDIUM-A Finding 6)', () => {
  it('shows nothing extra when the student has no parentId', () => {
    seedBaseState();
    renderProfile();
    expect(screen.queryByText(/هاتف بديل/)).not.toBeInTheDocument();
    expect(screen.queryByText(/التواصل المفضّل/)).not.toBeInTheDocument();
    expect(screen.queryByText(/الوقت المفضّل/)).not.toBeInTheDocument();
  });

  it('shows nothing extra when parentId is set but does not resolve to any loaded parents row', () => {
    seedBaseState({ students: [{ ...BASE_STUDENT, parentId: 'p_missing' }] });
    renderProfile();
    expect(screen.queryByText(/هاتف بديل/)).not.toBeInTheDocument();
  });

  it('shows nothing extra when the linked parent row has none of the three fields populated', () => {
    seedBaseState({
      students: [{ ...BASE_STUDENT, parentId: 'p1' }],
      parents: [{ id: 'p1', phone: '01000000002' }],
    });
    renderProfile();
    expect(screen.queryByText(/هاتف بديل/)).not.toBeInTheDocument();
    expect(screen.queryByText(/التواصل المفضّل/)).not.toBeInTheDocument();
    expect(screen.queryByText(/الوقت المفضّل/)).not.toBeInTheDocument();
  });

  it('shows alternate phone, preferred method, and preferred time when parentId resolves to a fully-populated parents row', () => {
    seedBaseState({
      students: [{ ...BASE_STUDENT, parentId: 'p1' }],
      parents: [{ id: 'p1', phone: '01000000002', altPhone: '01099999999', preferredMethod: 'whatsapp', preferredTime: 'بعد العصر' }],
    });
    renderProfile();
    expect(screen.getByText(/هاتف بديل: 01099999999/)).toBeInTheDocument();
    expect(screen.getByText(/التواصل المفضّل: واتساب/)).toBeInTheDocument();
    expect(screen.getByText(/الوقت المفضّل: بعد العصر/)).toBeInTheDocument();
  });
});
