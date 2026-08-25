// src/modules/admissions/AdmissionsPage.activation.test.jsx
// Phase 3B-13B (Stage ii) — attendFirstLesson() must activate an admission through the
// single dedicated atomic endpoint (pgActivateAdmission → PUT /api/admissions/:id/activate),
// never through the old Stage (i) orchestration of separate pgCreateStudent +
// pgUpdateAdmission + logEvent×2 calls. We mock fetch directly (not the api.js module) so
// we verify the real, unmocked request pgActivateAdmission builds — same technique used
// throughout this migration series.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdmissionsPage from './AdmissionsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

let fetchMock;
let putActivateResponder;  // PUT /api/admissions/:id/activate
let postParentResponder;   // POST /api/parents (Issue 3 — find-or-create step before activation)
let getParentsResponder;   // GET /api/parents (used only by the 409 conflict retry)

function okJson(data, status = 200) {
  return { ok: true, status, json: async () => ({ ok: true, data }) };
}
function errJson(status, error) {
  return { ok: false, status, json: async () => ({ ok: false, error }) };
}

const SAVED_STUDENT = {
  id: 's_admission_1', code: 'TC-2026-0001', name: 'أحمد علي', phone: '01012345678', parentPhone: '01198765432',
  grade: 'الصف الأول الثانوي', groupId: 'g1', school: '', status: 'active', notes: '',
  enrollDate: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const SAVED_ADMISSION = {
  id: 'adm_1', number: 'ADM-000001', name: 'أحمد علي', stage: 'active', studentId: SAVED_STUDENT.id,
};
// شكل استجابة الخادم الخام (activityType/byUser/timestamp/details) — pgActivateAdmission
// (api.js) يمرّرها عبر normalizeAdmissionSystemLogResponse فيعيد تسميتها type/by/at/detail
// فعلياً قبل أن تصل للمخزن (نفس ما يفعله pgCreateAdmissionSystemLog).
const RAW_SYSTEM_LOG_ENTRIES = [
  { id: 'sl-1', admissionId: 'adm_1', activityType: 'firstLesson', byUser: 'u_admin', details: null, timestamp: '2026-01-02T00:00:00.000Z' },
  { id: 'sl-2', admissionId: 'adm_1', activityType: 'activated', byUser: 'u_admin', details: 'TC-2026-0001', timestamp: '2026-01-02T00:00:01.000Z' },
];
const NORMALIZED_SYSTEM_LOG_ENTRIES = [
  { id: 'sl-1', admissionId: 'adm_1', type: 'firstLesson', by: 'u_admin', detail: null, at: '2026-01-02T00:00:00.000Z' },
  { id: 'sl-2', admissionId: 'adm_1', type: 'activated', by: 'u_admin', detail: 'TC-2026-0001', at: '2026-01-02T00:00:01.000Z' },
];

beforeEach(() => {
  putActivateResponder = () => okJson({ admission: SAVED_ADMISSION, student: SAVED_STUDENT, systemLogEntries: RAW_SYSTEM_LOG_ENTRIES });
  postParentResponder  = (body) => okJson({ id: '5', phone: body.phone, fullName: null, altPhone: null, preferredMethod: null, preferredTime: null, notes: null });
  getParentsResponder  = () => [];
  fetchMock = vi.fn((url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    if (u.includes('/api/admissions/') && u.endsWith('/activate') && method === 'PUT') {
      return Promise.resolve(putActivateResponder(opts.body ? JSON.parse(opts.body) : {}));
    }
    if (u.endsWith('/api/parents') && method === 'POST') {
      return Promise.resolve(postParentResponder(opts.body ? JSON.parse(opts.body) : {}));
    }
    if (u.endsWith('/api/parents') && method === 'GET') {
      return Promise.resolve(okJson(getParentsResponder()));
    }
    return Promise.reject(new Error(`unexpected fetch: ${method} ${u}`));
  });
  globalThis.fetch = fetchMock;
});
afterEach(() => { vi.restoreAllMocks(); });

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <AdmissionsPage />
      </ToastProvider>
    </AuthProvider>
  );
}

// egyptPhone يتطلّب 01[0-2,5] + 8 أرقام = 11 رقماً بالضبط.
const GROUP = { id: 'g1', name: 'مجموعة أ', grade: 'الصف الأول الثانوي' };
const ADMISSION = {
  id: 'adm_1', admissionNo: 'ADM-000001', name: 'أحمد علي', phone: '01012345678', parentPhone: '01198765432',
  grade: 'الصف الأول الثانوي', school: '', notes: '', stage: 'confirmed', reservationStatus: 'reserved',
  confirmedGroupId: 'g1', group: 'مجموعة أ',
  createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'admin',
  lastModifiedAt: '2026-01-01T00:00:00.000Z', lastModifiedBy: 'admin',
};

function seedStore(extra = {}) {
  useAppStore.setState({
    admissions: [ADMISSION], admissionFollowups: [], admissionSystemLog: [], admissionPayments: [],
    groups: [GROUP], students: [], invMaterials: [], treasuryTxn: [], cashboxes: [],
    ...extra,
  });
}

function activateCalls() {
  return fetchMock.mock.calls.filter(([url, opts]) => String(url).endsWith('/activate') && opts?.method === 'PUT');
}

async function clickActivate() {
  fireEvent.click(screen.getByText('📋 الحجز')); // switch to the "reserved" tab
  fireEvent.click(await screen.findByText('🎓 حضر أول حصة (تفعيل)'));
}

describe('AdmissionsPage — attendFirstLesson activation (Phase 3B-13B Stage ii — atomic endpoint)', () => {
  beforeEach(() => { seedStore(); });

  it('activates via exactly ONE call to the atomic endpoint (plus the Issue 3 parent-link call), with the correct request body, no premature mutation, adopting admission + student + system-log entries together on success', async () => {
    let resolvePut;
    putActivateResponder = () => new Promise((resolve) => { resolvePut = resolve; });

    renderPage();
    await clickActivate();

    // Issue 3: find-or-create-parent happens BEFORE the atomic activation call, using the
    // admission's own normalized parentPhone ('01198765432' -> '201198765432').
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/parents'),
      expect.objectContaining({ method: 'POST' })
    ));
    const [, parentPostOpts] = fetchMock.mock.calls.find(([u, o]) => String(u).endsWith('/api/parents') && o?.method === 'POST');
    expect(JSON.parse(parentPostOpts.body).phone).toBe('201198765432');

    await waitFor(() => expect(activateCalls()).toHaveLength(1));
    const [sentUrl, sentOpts] = activateCalls()[0];
    expect(decodeURIComponent(sentUrl.split('/api/admissions/')[1].replace('/activate', ''))).toBe('adm_1');
    const sentBody = JSON.parse(sentOpts.body);
    expect(sentBody.student.name).toBe('أحمد علي');
    expect(sentBody.student.groupId).toBe('g1');
    expect(sentBody.student.grade).toBe('الصف الأول الثانوي');
    // Issue 3: parentId resolved from the find-or-create step above is threaded through
    expect(sentBody.student.parentId).toBe('5');
    // لا id/code محليان يُرسَلان — الخادم يولّدهما داخل المعاملة نفسها
    expect(sentBody.student.id).toBeUndefined();
    expect(sentBody.student.code).toBeUndefined();
    expect(sentBody.student.gender).toBeUndefined(); // لا عمود له إطلاقاً في students

    // لا تعديل محلي قبل نجاح الاستدعاء الذرّي الواحد
    expect(useAppStore.getState().students).toEqual([]);
    expect(useAppStore.getState().admissions[0].stage).toBe('confirmed');
    expect(useAppStore.getState().admissionSystemLog).toEqual([]);

    resolvePut(okJson({ admission: SAVED_ADMISSION, student: SAVED_STUDENT, systemLogEntries: RAW_SYSTEM_LOG_ENTRIES }));

    await waitFor(() => {
      expect(useAppStore.getState().students).toEqual([SAVED_STUDENT]);
    });
    expect(useAppStore.getState().admissions[0].stage).toBe('active');
    expect(useAppStore.getState().admissions[0].linkedStudentId).toBe(SAVED_STUDENT.id);
    expect(useAppStore.getState().admissionSystemLog).toEqual(NORMALIZED_SYSTEM_LOG_ENTRIES);

    // نداءا شبكة فقط: ربط ولي الأمر (Issue 3) ثم التفعيل الذرّي — لا 4 نداءات منفصلة كما في Stage (i)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('activation failure: leaves students, admissions, and admissionSystemLog completely untouched, and shows the real server error', async () => {
    putActivateResponder = () => errJson(400, 'قيمة أطول من المسموح.');

    renderPage();
    await clickActivate();

    expect(await screen.findByText('قيمة أطول من المسموح.')).toBeInTheDocument();
    expect(useAppStore.getState().students).toEqual([]);
    expect(useAppStore.getState().admissions[0].stage).toBe('confirmed');
    expect(useAppStore.getState().admissions[0].linkedStudentId).toBeUndefined();
    expect(useAppStore.getState().admissionSystemLog).toEqual([]);
  });

  it('idempotent re-activation (admission already active server-side): adopts the existing linked student, adds no new system-log entries, and does not error', async () => {
    putActivateResponder = () => okJson({ admission: SAVED_ADMISSION, student: SAVED_STUDENT, systemLogEntries: [] });

    renderPage();
    await clickActivate();

    await waitFor(() => {
      expect(useAppStore.getState().students).toEqual([SAVED_STUDENT]);
    });
    expect(useAppStore.getState().admissions[0].stage).toBe('active');
    // لا سجلّي نشاط جديدين أُضيفا — استجابة idempotent فارغة من systemLogEntries
    expect(useAppStore.getState().admissionSystemLog).toEqual([]);
    expect(activateCalls()).toHaveLength(1);
  });
});

describe('AdmissionsPage — attendFirstLesson parentId linking (Product Completion Phase 1, Issue 3)', () => {
  it('omits parentId (no find-or-create call at all) when the admission has no parent phone', async () => {
    seedStore({ admissions: [{ ...ADMISSION, parentPhone: '' }] });

    renderPage();
    await clickActivate();

    await waitFor(() => expect(activateCalls()).toHaveLength(1));
    const sentBody = JSON.parse(activateCalls()[0][1].body);
    expect(sentBody.student.parentId).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/parents'), expect.anything());
  });

  it('re-resolves the existing parent id on a 409 phone conflict instead of failing the activation', async () => {
    seedStore();
    postParentResponder = () => ({ ok: false, status: 409, json: async () => ({ ok: false, error: 'مكرر', field: ['phone'] }) });
    getParentsResponder  = () => [{ id: '11', phone: '201198765432' }];

    renderPage();
    await clickActivate();

    await waitFor(() => expect(activateCalls()).toHaveLength(1));
    const sentBody = JSON.parse(activateCalls()[0][1].body);
    expect(sentBody.student.parentId).toBe('11');
  });
});
