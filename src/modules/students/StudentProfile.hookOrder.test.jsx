// src/modules/students/StudentProfile.hookOrder.test.jsx
// Pre-Installer Audit C1 — handleSaveNotes' useCallback was declared AFTER the
// `if (!student) return null` early return. If a mounted StudentProfile's student is
// removed from the store on a subsequent render (e.g. deleted elsewhere while the profile
// stays open), the early return fires before that hook — a different number of hooks than
// the previous render, which is a React Rules-of-Hooks violation ("Rendered fewer hooks
// than expected") and crashes that render. The fix hoists the hook above the early return.
// This test reproduces exactly that lifecycle: mount with a real student, then remove it
// from the store on a later render of the SAME mounted instance, and confirms no crash.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentProfile from './StudentProfile';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

const GROUP_ID = 'g1';
const S1 = 's1';

const BASE_STUDENT = {
  id: S1, name: 'طالب واحد', code: 'TC001', grade: 'الأول', phone: '01000000001',
  parentPhone: '01000000002', groupId: GROUP_ID, status: 'active', enrollDate: '2025-01-01', monthlyFee: 100,
};

function mockPaymentsFetch() {
  globalThis.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.includes('/api/payments?')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: [] }) });
    }
    return Promise.reject(new Error(`unexpected fetch: ${u}`));
  });
}
afterEach(() => { vi.restoreAllMocks(); });

describe('StudentProfile — hook order stays stable when the student disappears mid-mount (C1)', () => {
  it('does not throw when the student is removed from the store on a later render of an already-mounted instance', () => {
    useAppStore.setState({
      groups: [{ id: GROUP_ID, name: 'مجموعة أ', grade: 'الأول', max: 20 }],
      students: [BASE_STUDENT],
      attendance: [], exams: [], grades: [], parents: [],
    });
    mockPaymentsFetch();

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ToastProvider>
        <StudentProfile studentId={S1} onBack={() => {}} onEdit={() => {}} />
      </ToastProvider>
    );
    expect(screen.getAllByText('طالب واحد').length).toBeGreaterThan(0);

    // Simulate the student being deleted elsewhere while this profile instance stays mounted.
    expect(() => {
      act(() => {
        useAppStore.setState({ students: [] });
      });
    }).not.toThrow();

    // No "Rendered fewer hooks than expected" (or any other) React error was logged.
    const hookOrderError = consoleError.mock.calls.some(
      (args) => args.some((a) => typeof a === 'string' && a.includes('Rendered fewer hooks'))
    );
    expect(hookOrderError).toBe(false);
  });
});
