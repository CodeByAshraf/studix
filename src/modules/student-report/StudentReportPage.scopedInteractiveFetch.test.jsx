// src/modules/student-report/StudentReportPage.scopedInteractiveFetch.test.jsx
// Scalability Architecture Phase 4 — StudentReportPage.jsx's interactive tabs (Overview/
// Attendance/Exams/Homeworks/Materials/Payments/Timeline) now fetch GET /students/:id/
// report-data (via pgGetStudentReportData + buildInteractiveReportData) instead of reading
// payments/attendance/exams/grades/homeworks/hwSubmissions/invMaterials/inventoryTxn/
// treasuryTxn directly from the global store. This file covers the new async boundary
// itself: loading state, error state, and — critically — that switching the selected
// student never shows a previous student's report while the new one is still loading.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentReportPage from './StudentReportPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual('../../services/api');
  return { ...actual, pgGetStudentReportData: vi.fn() };
});
import { pgGetStudentReportData } from '../../services/api';

const STUDENT_A = {
  id: 'sA', name: 'أحمد علي', code: 'CA', phone: '0100000001',
  parentPhone: '0111111111', groupId: null, enrollDate: '2026-01-01', monthlyFee: 1000,
};
const STUDENT_B = {
  id: 'sB', name: 'سارة محمود', code: 'CB', phone: '0100000002',
  parentPhone: '0111111112', groupId: null, enrollDate: '2026-01-01', monthlyFee: 1000,
};

function emptyBundleFor(student) {
  return {
    students: [student], groups: [], attendance: [], hwSubmissions: [], homeworks: [],
    grades: [], exams: [], payments: [], treasuryTxn: [], communications: [],
    inventoryTxn: [], invMaterials: [],
  };
}

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <StudentReportPage />
      </ToastProvider>
    </AuthProvider>
  );
}

function seedStore() {
  useAppStore.setState({
    students: [STUDENT_A, STUDENT_B], groups: [], attendance: [], absenceFollowup: [],
    payments: [], exams: [], grades: [], homeworks: [], hwSubmissions: [], invMaterials: [],
    matDist: [], communications: [], inventoryTxn: [], centerProfile: {}, waReportLog: [],
    treasuryTxn: [],
  });
}

function selectStudentByName(name) {
  fireEvent.change(screen.getByPlaceholderText('ابحث باسم الطالب أو الكود أو رقم الهاتف...'), {
    target: { value: name },
  });
  fireEvent.click(screen.getByText(name));
}

describe('StudentReportPage — interactive report async boundary (Phase 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
  });

  it('shows a loading state after selecting a student, before the bundle resolves', async () => {
    let resolveFetch;
    pgGetStudentReportData.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));

    renderPage();
    selectStudentByName('أحمد علي');

    expect(await screen.findByText('...جارِ تحميل تقرير الطالب')).toBeInTheDocument();
    expect(screen.queryByText('ملخص الحضور')).not.toBeInTheDocument();

    resolveFetch(emptyBundleFor(STUDENT_A));
    await waitFor(() => expect(screen.queryByText('...جارِ تحميل تقرير الطالب')).not.toBeInTheDocument());
    expect(await screen.findByText('ملخص الحضور')).toBeInTheDocument();
  });

  it('shows an error state and a toast when the fetch fails, without crashing', async () => {
    pgGetStudentReportData.mockRejectedValue(new Error('فشل الاتصال بالخادم'));

    renderPage();
    selectStudentByName('أحمد علي');

    expect(await screen.findByText('تعذّر تحميل تقرير الطالب')).toBeInTheDocument();
    expect(await screen.findByText('فشل الاتصال بالخادم')).toBeInTheDocument(); // toast
    expect(screen.queryByText('ملخص الحضور')).not.toBeInTheDocument();
  });

  it('switching to a different student never shows the previous student\'s report while the new one is loading', async () => {
    pgGetStudentReportData.mockResolvedValueOnce(emptyBundleFor(STUDENT_A));
    renderPage();
    selectStudentByName('أحمد علي');
    await screen.findByText('ملخص الحضور'); // student A's report fully loaded

    let resolveB;
    pgGetStudentReportData.mockReturnValueOnce(new Promise((resolve) => { resolveB = resolve; }));
    fireEvent.click(screen.getByText('×')); // clear search to pick a new student
    selectStudentByName('سارة محمود');

    // أثناء انتظار حزمة الطالبة B، لا يظهر أي محتوى تقرير قديم للطالب A (اسمه غير موجود
    // في أي مكان بالجسم الرئيسي بينما الحالة "جارِ التحميل" ظاهرة)
    expect(await screen.findByText('...جارِ تحميل تقرير الطالب')).toBeInTheDocument();
    expect(screen.queryByText('ملخص الحضور')).not.toBeInTheDocument();

    resolveB(emptyBundleFor(STUDENT_B));
    await waitFor(() => expect(screen.queryByText('...جارِ تحميل تقرير الطالب')).not.toBeInTheDocument());
    expect(await screen.findByText('ملخص الحضور')).toBeInTheDocument();
    expect(pgGetStudentReportData).toHaveBeenLastCalledWith('sB');
  });

  it('a stale response for a since-abandoned student selection is never rendered (student-mismatch guard)', async () => {
    // الطالبة B تُطلَب أولاً لكن تستقر متأخرة — إن وصلت بعد أن تحوّل الاختيار للطالب A
    // (الذي استقرّ أولاً)، يجب ألا تُستبدَل بيانات A ببيانات B القديمة.
    let resolveB;
    pgGetStudentReportData.mockImplementation((id) => {
      if (id === 'sB') return new Promise((resolve) => { resolveB = resolve; });
      return Promise.resolve(emptyBundleFor(STUDENT_A));
    });

    renderPage();
    selectStudentByName('سارة محمود'); // يبدأ جلب B (لن يستقر بعد)
    fireEvent.click(screen.getByText('×'));
    selectStudentByName('أحمد علي'); // يبدأ جلب A، يستقر فوراً
    await screen.findByRole('heading', { name: 'أحمد علي' });

    // استجابة B المتأخرة تصل الآن — بعد أن أصبح الطالب المُختار A
    resolveB(emptyBundleFor(STUDENT_B));
    await new Promise((r) => setTimeout(r, 0));

    // التقرير المعروض يبقى تقرير A (لا انتقال غير متوقَّع لبيانات B القديمة)
    expect(screen.getByRole('heading', { name: 'أحمد علي' })).toBeInTheDocument();
  });
});
