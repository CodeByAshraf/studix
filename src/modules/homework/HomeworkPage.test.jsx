// src/modules/homework/HomeworkPage.test.jsx
// Phase 3B-6 — نفس عقد ExamsPage.test.jsx: create/delete لا يغيّران الحالة المحلية
// قبل نجاح الخادم، ويُطابقان استجابة الخادم عند النجاح، ويبقيان دون تغيير عند الفشل.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import HomeworkPage from './HomeworkPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgCreateHomework: vi.fn(), pgUpdateHomework: vi.fn(), pgDeleteHomework: vi.fn(), pgGetHwSubmissionsAggregate: vi.fn(), pgGetHomeworks: vi.fn() };
});
import { pgCreateHomework, pgDeleteHomework, pgGetHwSubmissionsAggregate, pgGetHomeworks } from '../../services/api';
import { GRADES } from '../../services/groupService';

const GROUP_ID = 'g1';
const GRADE = GRADES[0];

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <HomeworkPage />
      </ToastProvider>
    </AuthProvider>
  );
}

function seedStore() {
  useAppStore.setState({
    groups: [{ id: GROUP_ID, name: 'Test Group' }],
    students: [],
    homeworks: [],
    hwSubmissions: [],
    centerProfile: { academicYear: '2025/2026' },
  });
  // C4 Grades/hwSubmissions Frontend Migration (Batch A, feature 004): kpi.totalSub/getHwStats
  // now come from pgGetHwSubmissionsAggregate, not the store's hwSubmissions array — these
  // tests only exercise homework CRUD, so an empty aggregate response is enough.
  pgGetHwSubmissionsAggregate.mockResolvedValue([]);
  // Phase 2 (Homework global-read migration): the parent list comes from pgGetHomeworks, not
  // the store's homeworks array (the store copy is still written on save/delete — asserted below).
  pgGetHomeworks.mockResolvedValue([]);
}

describe('HomeworkPage — server-truth write path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
  });

  it('create: does not touch local homeworks before the backend resolves, then adopts the server response', async () => {
    let resolveCall;
    pgCreateHomework.mockImplementation(() => new Promise((resolve) => { resolveCall = resolve; }));

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '+ واجب جديد' }));

    const modalBody = document.querySelector('.modal-body');
    fireEvent.change(within(modalBody).getByPlaceholderText('مثال: تدريبات المعادلات التربيعية'), { target: { value: 'واجب اختبار', name: 'title' } });
    const formSelects = within(modalBody).getAllByRole('combobox');
    fireEvent.change(formSelects[0], { target: { value: GRADE, name: 'grade' } }); // الصف (Homework 2.0 — لا مجموعة)
    fireEvent.change(formSelects[1], { target: { value: 'رياضيات', name: 'subject' } }); // المادة
    fireEvent.change(modalBody.querySelector('input[name="dueDate"]'), { target: { value: '2026-12-01', name: 'dueDate' } });

    fireEvent.click(within(modalBody).getByRole('button', { name: /إنشاء الواجب/ }));

    expect(useAppStore.getState().homeworks).toEqual([]);

    const saved = { id: 'srv-hw1', title: 'واجب اختبار', grade: GRADE, academicYear: '2025/2026', groupId: null, subject: 'رياضيات', dueDate: '2026-12-01', createdAt: '2026-08-18', totalScore: 10, status: 'active', description: '', teacher: '' };
    resolveCall(saved);

    await waitFor(() => {
      expect(useAppStore.getState().homeworks).toEqual([saved]);
    });
    expect(await screen.findByText('واجب اختبار')).toBeInTheDocument(); // page-local list too
  });

  it('delete: calls pgDeleteHomework, cascades submissions locally on success, leaves state untouched on failure', async () => {
    const HW_ONE = { id: 'hw1', title: 'HW One', groupId: GROUP_ID, subject: 'رياضيات', dueDate: '2026-04-01', createdAt: '2026-03-01', totalScore: 10, status: 'active' };
    pgGetHomeworks.mockResolvedValue([HW_ONE]);
    useAppStore.setState({
      homeworks: [HW_ONE],
      hwSubmissions: [{ id: 'sub1', hwId: 'hw1', studentId: 's1', status: 'submitted', score: 8, submittedAt: '2026-03-20', notes: '' }],
    });

    // failure first
    pgDeleteHomework.mockRejectedValueOnce(new Error('الواجب غير موجود.'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /حذف/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'نعم، احذف' }));

    await waitFor(() => expect(pgDeleteHomework).toHaveBeenCalledTimes(1));
    expect(useAppStore.getState().homeworks).toHaveLength(1);
    expect(useAppStore.getState().hwSubmissions).toHaveLength(1);
    expect(await screen.findByText('الواجب غير موجود.')).toBeInTheDocument();

    // now success — the confirm modal stays open after a failed attempt, retry the confirm button
    pgDeleteHomework.mockResolvedValueOnce({ deletedSubmissions: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'نعم، احذف' }));

    await waitFor(() => {
      expect(useAppStore.getState().homeworks).toHaveLength(0);
      expect(useAppStore.getState().hwSubmissions).toHaveLength(0);
    });
    expect(screen.queryByText('HW One')).not.toBeInTheDocument();
  });

  it('reads the parent list once via pgGetHomeworks (no params), never from the global store', async () => {
    const HW_SERVER = { id: 'hw_srv', title: 'Server HW', grade: GRADE, subject: 'رياضيات', dueDate: '2026-04-01', createdAt: '2026-03-01', totalScore: 10, status: 'active' };
    pgGetHomeworks.mockResolvedValue([HW_SERVER]);
    useAppStore.setState({ homeworks: [{ ...HW_SERVER, id: 'hw_store_only', title: 'Store Only HW' }] });

    renderPage();

    expect(await screen.findByText('Server HW')).toBeInTheDocument();
    expect(screen.queryByText('Store Only HW')).not.toBeInTheDocument();
    expect(pgGetHomeworks).toHaveBeenCalledTimes(1);
    expect(pgGetHomeworks).toHaveBeenCalledWith();
  });
});

// C4 Grades/hwSubmissions Frontend Migration (Batch A, feature 004): kpi.totalSub and each
// homework row's submitted/late/missing breakdown now come from two page-level
// pgGetHwSubmissionsAggregate calls (groupBy=status, groupBy=homework), fetched once per page
// view regardless of how many homework rows are rendered (FR-007/SC-002).
describe('HomeworkPage — submission aggregates (feature 004)', () => {
  const HW1 = { id: 'hw1', title: 'HW One', grade: GRADE, subject: 'رياضيات', dueDate: '2026-04-01', createdAt: '2026-03-01', totalScore: 10, status: 'active' };
  const HW2 = { id: 'hw2', title: 'HW Two', grade: GRADE, subject: 'علوم',   dueDate: '2026-04-05', createdAt: '2026-03-02', totalScore: 10, status: 'active' };

  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      groups: [{ id: GROUP_ID, name: 'Test Group' }],
      students: [
        { id: 's1', name: 'Student One', code: 'C1', grade: GRADE, status: 'active' },
        { id: 's2', name: 'Student Two', code: 'C2', grade: GRADE, status: 'active' },
      ],
      homeworks: [],
      hwSubmissions: [],
      centerProfile: { academicYear: '2025/2026' },
    });
    pgGetHomeworks.mockResolvedValue([HW1, HW2]);
  });

  // Phase 2.1: GET /api/homeworks is neutrally ordered again (same as the generic route); the
  // list view's newest-due-first order is this page's own explicit sort, independent of it.
  it('lists homeworks newest due date first even when the server returns them in another order', async () => {
    pgGetHwSubmissionsAggregate.mockResolvedValue([]);
    renderPage(); // server order: HW1 (2026-04-01), HW2 (2026-04-05)
    const hwOne = await screen.findByText('HW One');
    const hwTwo = screen.getByText('HW Two');
    expect(hwTwo.compareDocumentPosition(hwOne) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('kpi.totalSub matches the groupBy=status aggregate\'s submitted count, not a client-side filter', async () => {
    pgGetHwSubmissionsAggregate.mockImplementation(({ groupBy }) =>
      Promise.resolve(groupBy === 'status'
        ? [{ key: 'submitted', count: 3 }, { key: 'late', count: 1 }, { key: 'missing', count: 2 }]
        : []));

    renderPage();

    expect(await screen.findByText('3')).toBeInTheDocument(); // KPI "إجمالي تم التسليم"
  });

  it('each row\'s breakdown matches the groupBy=homework aggregate, and total stays the eligible-student count (FR-008), fetching the aggregate exactly once regardless of row count (SC-002)', async () => {
    pgGetHwSubmissionsAggregate.mockImplementation(({ groupBy }) =>
      Promise.resolve(groupBy === 'homework'
        ? [
            { key: 'hw1', total: 5, submitted: 1, late: 1, missing: 3 }, // aggregate's own total (5) must NOT be used
            { key: 'hw2', total: 0, submitted: 0, late: 0, missing: 0 },
          ]
        : []));

    renderPage();

    expect(await screen.findByText('HW One')).toBeInTheDocument();
    // 2 eligible students (s1, s2) for HW1 — never the aggregate's own total of 5.
    expect(screen.getByText('✓ 1')).toBeInTheDocument();
    expect(screen.getByText('⏱ 1')).toBeInTheDocument();
    expect(screen.getByText('✗ 3')).toBeInTheDocument();

    // groupBy=homework is fetched exactly once for the whole page view, not once per row.
    const homeworkCalls = pgGetHwSubmissionsAggregate.mock.calls.filter(([p]) => p.groupBy === 'homework');
    expect(homeworkCalls).toHaveLength(1);
  });
});
