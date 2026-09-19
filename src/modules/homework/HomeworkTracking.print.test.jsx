// src/modules/homework/HomeworkTracking.print.test.jsx
// New feature — wires a "🖨 طباعة تقرير الدرجات" print action into the existing
// per-homework grading screen (HomeworkTracking.jsx), the natural entry point since it is
// already scoped to exactly one group + one homework (no duplicate homework-report screen
// was created). Critically, the button must print from the store's PERSISTED hwSubmissions,
// not the screen's local unsaved edits (localSubs) — printing a draft score before "💾 حفظ
// الحالات" is clicked would show data that was never actually saved.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import HomeworkTracking from './HomeworkTracking';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgSaveHwSubmissions: vi.fn() };
});

// Homework 2.0 Phase 2: the roster is grade-based — HW.grade/S1.grade set explicitly and
// matching (not two coincidentally-undefined values) so this file still proves real wiring.
const GROUP_ID = 'g1';
const GRADE = 'الصف السادس الابتدائي';
const HW = { id: 'hw1', groupId: GROUP_ID, grade: GRADE, title: 'واجب الجبر', subject: 'رياضيات', totalScore: 20, dueDate: '2026-03-15' };
const S1 = 's1';

function renderTracking() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <HomeworkTracking hw={HW} onClose={() => {}} />
      </ToastProvider>
    </AuthProvider>
  );
}

function seed(hwSubmissions = []) {
  useAppStore.setState({
    students: [{ id: S1, name: 'أحمد علي', code: 'C001', grade: GRADE, status: 'active' }],
    groups: [{ id: GROUP_ID, name: 'مجموعة أ' }],
    hwSubmissions,
    centerProfile: { name: 'م خالد جمعه' },
  });
}

let writtenHtml;
function mockWindow() {
  writtenHtml = '';
  const win = { document: { open: vi.fn(), write: vi.fn((html) => { writtenHtml += html; }), close: vi.fn() }, focus: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(win);
  return win;
}

describe('HomeworkTracking — print action wiring', () => {
  beforeEach(() => { mockWindow(); vi.clearAllMocks(); });

  it('renders the print button and opens the real report with the correct group/homework/profile', () => {
    seed([{ hwId: 'hw1', studentId: S1, status: 'submitted', submittedAt: '2026-03-14', score: 18, notes: '' }]);
    renderTracking();

    const printBtn = screen.getByText('🖨 طباعة تقرير الدرجات');
    fireEvent.click(printBtn);

    expect(window.open).toHaveBeenCalled();
    expect(writtenHtml).toContain('واجب الجبر');
    expect(writtenHtml).toContain('مجموعة أ');
    expect(writtenHtml).toContain('أحمد علي');
    expect(writtenHtml).toContain('18/20');
    expect(writtenHtml).toContain('م خالد جمعه');
  });

  it('prints from the persisted store hwSubmissions, not an unsaved local score edit', () => {
    // لا شيء محفوظ بعد في المتجر — الطالب "لم يُسلَّم" فعلياً حتى لو عدّل المستخدم الحالة/الدرجة محلياً الآن.
    seed([]);
    renderTracking();

    // تعديل محلي غير محفوظ: "تحديد الكل: تم التسليم" (أول زر مطابق — زر "تحديد الكل" العام
    // يسبق أزرار الحالة داخل كل صف طالب) ثم كتابة درجة، بلا الضغط على "💾 حفظ الحالات"
    fireEvent.click(screen.getAllByRole('button', { name: /تم التسليم/ })[0]);
    const scoreInput = screen.getByPlaceholderText('—');
    fireEvent.change(scoreInput, { target: { value: '15' } });

    fireEvent.click(screen.getByText('🖨 طباعة تقرير الدرجات'));

    expect(writtenHtml).toContain('لم يُسلَّم'); // الحالة المحفوظة الحقيقية، لا "15/20" غير المحفوظة
    expect(writtenHtml).not.toContain('15/20');
  });
});
