// src/modules/admissions/AdmissionsPage.activation.test.jsx
// Phase 3B-13B (Stage ii) — attendFirstLesson() must activate an admission through the
// single dedicated atomic endpoint (pgActivateAdmission → PUT /api/admissions/:id/activate),
// never through the old Stage (i) orchestration of separate pgCreateStudent +
// pgUpdateAdmission + logEvent×2 calls. We mock fetch directly (not the api.js module) so
// we verify the real, unmocked request pgActivateAdmission builds — same technique used
// throughout this migration series.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdmissionsPage from './AdmissionsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

let fetchMock;
let serverGroups = [];     // GET /api/groups/options — page-mount fetch (M2 Group Options)
let putActivateResponder;  // PUT /api/admissions/:id/activate
let postParentResponder;   // POST /api/parents — must never be called by activation (M2/F4: parent linked server-side)
let getParentsResponder;   // GET /api/parents — likewise never called by activation (M2/F4)

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
    // AdmissionsPage.jsx's single page-mount fetch of admissionPayments (Phase 4) — no
    // payments needed for these activation tests, so an empty array is sufficient.
    if (u.includes('/api/admissionPayments') && method === 'GET') return Promise.resolve(okJson([]));
    // Confirm-reservation writes (M2 Group Options confirm test): echo the admission update,
    // accept the "confirmed" system-log entry.
    if (/\/api\/admissions\/[^/]+$/.test(u) && method === 'PUT') {
      const body = opts.body ? JSON.parse(opts.body) : {};
      return Promise.resolve(okJson({ ...ADMISSION, stage: body.stage, groupId: body.groupId ?? null, group: body.group ?? null }));
    }
    if (u.endsWith('/api/admissionSystemLog') && method === 'POST') {
      return Promise.resolve(okJson({ id: 'sl-confirm-1', admissionId: 'adm_1', activityType: 'confirmed', byUser: 'u1', details: '', timestamp: '2026-01-10T00:00:00.000Z' }));
    }
    // M2/F1 — the page-mount cashbox options fetch (deposit picker); unused by activation.
    if (u.endsWith('/api/cashboxes/options') && method === 'GET') return Promise.resolve(okJson([]));
    // M2 (Group Options) — the page-mount group options fetch (confirm picker + activation lookup).
    if (u.endsWith('/api/groups/options') && method === 'GET') {
      return Promise.resolve(okJson(serverGroups.map(({ id, name, grade = null, max = null, price = 0 }) => ({ id, name, grade, max, price, activeCount: 0 }))));
    }
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

// M2 (Group Options): `groups` are the SERVER's groups, served by GET /api/groups/options; the
// store's Groups collection stays empty (an admissions-only user never loads it), so every
// activation here also proves the lookup no longer depends on the Groups permission.
function seedStore({ groups = [GROUP], ...extra } = {}) {
  serverGroups = groups;
  useAppStore.setState({
    admissions: [ADMISSION], admissionFollowups: [], admissionSystemLog: [], admissionPayments: [],
    groups: [], students: [], invMaterials: [], treasuryTxn: [], cashboxes: [],
    ...extra,
  });
}

const groupOptionsCalls = () => fetchMock.mock.calls.filter(([u, o]) => String(u).endsWith('/api/groups/options') && (o?.method || 'GET') === 'GET');

function activateCalls() {
  return fetchMock.mock.calls.filter(([url, opts]) => String(url).endsWith('/activate') && opts?.method === 'PUT');
}

async function clickActivate() {
  // the group options (page-mount fetch) must have settled, as for a real user
  await waitFor(() => expect(groupOptionsCalls()).toHaveLength(1));
  await act(() => new Promise((resolve) => { setTimeout(resolve, 0); }));
  fireEvent.click(screen.getByText('📋 الحجز')); // switch to the "reserved" tab
  fireEvent.click(await screen.findByText('🎓 حضر أول حصة (تفعيل)'));
}

describe('AdmissionsPage — attendFirstLesson activation (Phase 3B-13B Stage ii — atomic endpoint)', () => {
  beforeEach(() => { seedStore(); });

  it('activates via exactly ONE call to the atomic endpoint (the parent is linked server-side, M2/F4), with the correct request body, no premature mutation, adopting admission + student + system-log entries together on success', async () => {
    let resolvePut;
    putActivateResponder = () => new Promise((resolve) => { resolvePut = resolve; });

    renderPage();
    await clickActivate();

    await waitFor(() => expect(activateCalls()).toHaveLength(1));
    const [sentUrl, sentOpts] = activateCalls()[0];
    expect(decodeURIComponent(sentUrl.split('/api/admissions/')[1].replace('/activate', ''))).toBe('adm_1');
    const sentBody = JSON.parse(sentOpts.body);
    expect(sentBody.student.name).toBe('أحمد علي');
    expect(sentBody.student.groupId).toBe('g1');
    expect(sentBody.student.grade).toBe('الصف الأول الثانوي');
    // M2/F4: the parent phone goes to the activation endpoint, which finds-or-creates the
    // parent in its own transaction — no client-resolved parentId, no POST /api/parents
    // ('students' permission) beforehand.
    expect(sentBody.student.parentPhone).toBe('01198765432');
    expect(sentBody.student.parentId).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/parents'), expect.anything());
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

    // 4 نداءات شبكة فقط: جلبات تحميل الصفحة الثلاثة (دفعات القبول Phase 4 + خيارات الخزن M2/F1 +
    // خيارات المجموعات M2 Group Options)، ثم التفعيل الذرّي (يربط ولي الأمر داخله، M2/F4)
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(groupOptionsCalls()).toHaveLength(1);
    expect(activateCalls()).toHaveLength(1);
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

  // M2/F4 — replaces the old "409 phone conflict re-resolve" client flow: find-or-create (incl.
  // an already-existing parent) now happens server-side inside the activation transaction, so
  // the page never touches /api/parents — which would be 403 for an admissions-only user.
  it('M2/F4: with a parent phone, activation never calls /api/parents (not even when it would be 403) and sends only parentPhone', async () => {
    seedStore();
    postParentResponder = () => ({ ok: false, status: 403, json: async () => ({ ok: false, error: 'لا تملك صلاحية الوصول لهذا الإجراء.' }) });

    renderPage();
    await clickActivate();

    await waitFor(() => expect(activateCalls()).toHaveLength(1));
    const sentBody = JSON.parse(activateCalls()[0][1].body);
    expect(sentBody.student.parentPhone).toBe('01198765432');
    expect(sentBody.student.parentId).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/parents'), expect.anything());
    await waitFor(() => expect(useAppStore.getState().students).toEqual([SAVED_STUDENT]));
  });
});

// M2 (Group Options) — an admissions-only user (no Groups collection) confirms a reservation:
// the group picker and its capacity come from GET /api/groups/options (server activeCount).
describe('AdmissionsPage — confirm reservation with group options (M2 Group Options)', () => {
  it('lists same-grade groups from the options with server capacity, disables a full group, and confirms into the chosen one', async () => {
    seedStore({
      admissions: [{ ...ADMISSION, stage: 'reserved', confirmedGroupId: null, group: null }],
      groups: [
        { id: 'g1', name: 'مجموعة أ', grade: 'الصف الأول الثانوي', max: 10 },
        { id: 'g-full', name: 'مجموعة ممتلئة', grade: 'الصف الأول الثانوي', max: 2 },
        { id: 'g-other', name: 'مجموعة صف آخر', grade: 'الصف الثاني الثانوي', max: 10 },
      ],
    });
    // server-side capacity: g1 has 3 active members, g-full is at its max
    const base = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((url, opts = {}) => {
      if (String(url).endsWith('/api/groups/options')) {
        return Promise.resolve(okJson([
          { id: 'g1', name: 'مجموعة أ', grade: 'الصف الأول الثانوي', max: 10, price: 300, activeCount: 3 },
          { id: 'g-full', name: 'مجموعة ممتلئة', grade: 'الصف الأول الثانوي', max: 2, price: 300, activeCount: 2 },
          { id: 'g-other', name: 'مجموعة صف آخر', grade: 'الصف الثاني الثانوي', max: 10, price: 300, activeCount: 0 },
        ]));
      }
      return base(url, opts);
    });
    expect(useAppStore.getState().groups).toEqual([]);

    renderPage();
    await waitFor(() => expect(groupOptionsCalls()).toHaveLength(1));
    await act(() => new Promise((resolve) => { setTimeout(resolve, 0); }));
    fireEvent.click(screen.getByText('📋 الحجز'));
    fireEvent.click(await screen.findByText('تأكيد الحجز'));

    // M-03: the page's group filter now lists the real groups as <option>s, so the confirm
    // picker's choices are located by their buttons (the filter options are not buttons).
    const g1 = await screen.findByRole('button', { name: /مجموعة أ/ });
    expect(screen.getByText('3/10')).toBeInTheDocument();          // capacity from activeCount
    expect(screen.getByText('ممتلئة')).toBeInTheDocument();        // g-full is full…
    expect(screen.getByRole('button', { name: /مجموعة ممتلئة/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /مجموعة صف آخر/ })).toBeNull(); // other grade not offered

    fireEvent.click(g1);
    fireEvent.click(screen.getAllByRole('button').find((b) => /تأكيد/.test(b.textContent) && b.textContent !== 'تأكيد الحجز'));

    await waitFor(() => expect(useAppStore.getState().admissions[0].stage).toBe('confirmed'));
    const put = fetchMock.mock.calls.find(([u, o]) => /\/api\/admissions\/adm_1$/.test(String(u)) && o?.method === 'PUT');
    const sent = JSON.parse(put[1].body);
    expect(sent.groupId).toBe('g1');
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringMatching(/\/api\/groups(\?|$)/), expect.anything());
  });
});
