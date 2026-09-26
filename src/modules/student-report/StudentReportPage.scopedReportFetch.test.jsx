// src/modules/student-report/StudentReportPage.scopedReportFetch.test.jsx
// Scalability Architecture Phase 2 — both "⭐ تقرير احترافي (PDF)" and "📲 إرسال ملخص
// لولي الأمر" now fetch the student's scoped report-data bundle (GET /students/:id/
// report-data) before generating anything, instead of reading a locally-assembled full
// store. This locks in: the correct studentId is requested, the fetched bundle (not the
// stale global store) is what feeds gatherStudentData, both buttons disable while the
// fetch is in flight, and a fetch failure surfaces a toast without crashing or silently
// generating a report from incomplete data.
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

vi.mock('./buildStudentReport', async () => {
  const actual = await vi.importActual('./buildStudentReport');
  return { ...actual, generateStudentReport: vi.fn() };
});
import { generateStudentReport } from './buildStudentReport';

const STUDENT_ID = 's1';

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
    students: [{
      id: STUDENT_ID, name: 'Test Student', code: 'C1', phone: '0100000000',
      parentPhone: '0111111111', groupId: null, enrollDate: '2026-01-01', monthlyFee: 100,
    }],
    groups: [], attendance: [], absenceFollowup: [], payments: [], exams: [], grades: [],
    homeworks: [], hwSubmissions: [], invMaterials: [], matDist: [], communications: [],
    inventoryTxn: [], centerProfile: {}, waReportLog: [], treasuryTxn: [],
  });
}

function selectStudent() {
  fireEvent.change(screen.getByPlaceholderText('ابحث باسم الطالب أو الكود أو رقم الهاتف...'), {
    target: { value: 'Test Student' },
  });
  return screen.findByText('Test Student').then((el) => fireEvent.click(el));
}

const SCOPED_BUNDLE = {
  students: [{ id: STUDENT_ID, name: 'Test Student', groupId: null }],
  groups: [], attendance: [], hwSubmissions: [], grades: [], exams: [],
  payments: [], treasuryTxn: [], communications: [], inventoryTxn: [], invMaterials: [],
};

describe('StudentReportPage — professional report button fetches the scoped bundle (Phase 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore();
  });

  it('clicking "⭐ تقرير احترافي (PDF)" fetches this exact student\'s scoped bundle and passes it (not the stale global store) into generateStudentReport', async () => {
    pgGetStudentReportData.mockResolvedValue(SCOPED_BUNDLE);
    renderPage();
    await selectStudent();

    fireEvent.click(screen.getByText('⭐ تقرير احترافي (PDF)'));

    await waitFor(() => expect(pgGetStudentReportData).toHaveBeenCalledWith(STUDENT_ID));
    await waitFor(() => expect(generateStudentReport).toHaveBeenCalledTimes(1));
    const [sentStudentId, sentBundle] = generateStudentReport.mock.calls[0];
    expect(sentStudentId).toBe(STUDENT_ID);
    expect(sentBundle).toBe(SCOPED_BUNDLE);
  });

  it('both report buttons disable while the fetch is in flight, and re-enable after it resolves', async () => {
    let resolveFetch;
    pgGetStudentReportData.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));
    renderPage();
    await selectStudent();

    const proBtn = screen.getByText('⭐ تقرير احترافي (PDF)');
    const waBtn = screen.getByText('📲 إرسال ملخص لولي الأمر');
    fireEvent.click(proBtn);

    expect(proBtn).toBeDisabled();
    expect(waBtn).toBeDisabled(); // نفس مؤشر الانشغال المشترك — لا نداءين متزامنين

    resolveFetch(SCOPED_BUNDLE);
    await waitFor(() => expect(proBtn).not.toBeDisabled());
    expect(waBtn).not.toBeDisabled();
  });

  it('a fetch failure surfaces an error toast and never calls generateStudentReport with incomplete data', async () => {
    pgGetStudentReportData.mockRejectedValueOnce(new Error('PG GET /students/s1/report-data → 500'));
    renderPage();
    await selectStudent();

    fireEvent.click(screen.getByText('⭐ تقرير احترافي (PDF)'));

    expect(await screen.findByText('PG GET /students/s1/report-data → 500')).toBeInTheDocument();
    expect(generateStudentReport).not.toHaveBeenCalled();
  });
});
