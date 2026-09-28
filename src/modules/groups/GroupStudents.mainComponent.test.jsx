// src/modules/groups/GroupStudents.mainComponent.test.jsx
// Scalability Architecture Phase 4 Cutover 2 — GroupStudents.jsx's main component (the
// "طلاب المجموعة" panel, NOT TransferModal, which is left untouched in this pass) now
// fetches GET /api/payments?groupId= instead of reading the store's payments array —
// StudentRow itself is unchanged: still picks the single latest payment per student
// (studentId equality, date-desc) from whatever array it receives.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import GroupStudents from './GroupStudents';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';
import { formatCurrency, formatDate } from '../../utils/helpers';

const GROUP = { id: 'g1', name: 'مجموعة أ', max: 20 };
const S1 = { id: 's1', name: 'أحمد', code: 'C1', grade: 'الأول', groupId: 'g1', status: 'active' };
const S2 = { id: 's2', name: 'محمد', code: 'C2', grade: 'الأول', groupId: 'g1', status: 'active' };

function mockFetch(payments) {
  globalThis.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.includes('/api/payments?')) {
      const qp = new URL(u).searchParams;
      const groupId = qp.get('groupId');
      let rows = payments;
      if (groupId) rows = rows.filter((p) => p.groupId === groupId);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: rows }) });
    }
    // Group Membership unification — the panel's member list comes from GET /api/enrollments
    // ?groupId=; both seeded students hold the active Primary enrollment for g1.
    if (u.includes('/api/enrollments?')) {
      const groupId = new URL(u).searchParams.get('groupId');
      const data = useAppStore.getState().students
        .filter((s) => s.groupId === groupId)
        .map((s) => ({ id: `e-${s.id}`, studentId: s.id, groupId, role: 'primary', status: 'active' }));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
    }
    return Promise.reject(new Error(`unexpected fetch: ${u}`));
  });
}
afterEach(() => { vi.restoreAllMocks(); });

function renderPanel() {
  return render(
    <ToastProvider>
      <GroupStudents group={GROUP} onClose={() => {}} onTransferOpen={() => {}} />
    </ToastProvider>
  );
}

describe('GroupStudents — main component "last payment" column (Phase 4 Cutover 2)', () => {
  it('shows the single most recent payment per student, sorted date-desc, not the earliest one', async () => {
    useAppStore.setState({ groups: [GROUP], students: [S1, S2] });
    mockFetch([
      { id: 'p-old', studentId: 's1', groupId: 'g1', amount: 100, date: '2026-01-01' },
      { id: 'p-new', studentId: 's1', groupId: 'g1', amount: 300, date: '2026-03-01' },
    ]);

    renderPanel();

    // آخر دفعة (الأحدث تاريخاً) هي 300، لا 100
    expect(await screen.findByText(formatCurrency(300))).toBeInTheDocument();
    expect(screen.queryByText(formatCurrency(100))).not.toBeInTheDocument();
  });

  it('a student with zero payments in the group shows "لا دفعات"', async () => {
    useAppStore.setState({ groups: [GROUP], students: [S1] });
    mockFetch([]);

    renderPanel();

    expect(await screen.findByText('لا دفعات')).toBeInTheDocument();
  });

  it('a payment belonging to a different student in the same group is not shown for this student', async () => {
    useAppStore.setState({ groups: [GROUP], students: [S1, S2] });
    mockFetch([
      { id: 'p1', studentId: 's2', groupId: 'g1', amount: 500, date: '2026-02-01' },
    ]);

    renderPanel();

    // s2's row shows 500؛ s1's row (بلا دفعات) يعرض "لا دفعات"
    expect(await screen.findByText(formatCurrency(500))).toBeInTheDocument();
    expect(await screen.findByText('لا دفعات')).toBeInTheDocument();
  });
});

// Group Membership unification — the panel's members come from active enrollments (GET
// /api/enrollments?groupId=, the same student_group_enrollments source as the attendance
// roster), not from students.groupId.
describe('GroupStudents — membership comes from active enrollments', () => {
  function mockEnrollments(enrollments) {
    globalThis.fetch = vi.fn((url) => {
      const u = String(url);
      if (u.includes('/api/payments?')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: [] }) });
      }
      if (u.includes('/api/enrollments?')) {
        const groupId = new URL(u).searchParams.get('groupId');
        const data = enrollments.filter((e) => e.groupId === groupId);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });
  }

  it('A/B. shows the Primary member and an Additional member (whose groupId is another group), marking the Additional one', async () => {
    const S3 = { id: 's3', name: 'سارة', code: 'C3', grade: 'الأول', groupId: 'g2', status: 'active' };
    useAppStore.setState({ groups: [GROUP], students: [S1, S3] });
    mockEnrollments([
      { id: 'e1', studentId: 's1', groupId: 'g1', role: 'primary', status: 'active' },
      { id: 'e3p', studentId: 's3', groupId: 'g2', role: 'primary', status: 'active' },
      { id: 'e3a', studentId: 's3', groupId: 'g1', role: 'additional', status: 'active', attendDays: ['sat'] },
    ]);

    renderPanel();

    expect(await screen.findByText('أحمد')).toBeInTheDocument();
    expect(await screen.findByText('سارة')).toBeInTheDocument();
    expect(screen.getAllByText('مجموعة إضافية')).toHaveLength(1);
  });

  it('D. a student with groupId pointing at this group but no active enrollment is not listed as a member', async () => {
    useAppStore.setState({ groups: [GROUP], students: [S1, S2] }); // both have groupId 'g1'
    mockEnrollments([{ id: 'e1', studentId: 's1', groupId: 'g1', role: 'primary', status: 'active' }]);

    renderPanel();

    expect(await screen.findByText('أحمد')).toBeInTheDocument();
    expect(screen.queryByText('محمد')).not.toBeInTheDocument();
  });
});
