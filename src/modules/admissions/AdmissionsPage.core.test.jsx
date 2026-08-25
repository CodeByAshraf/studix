// src/modules/admissions/AdmissionsPage.core.test.jsx
// Phase 3B-13A — admissions core + relational admissionFollowups/admissionSystemLog.
// We mock fetch directly (not the api.js module) so we verify the real, unmocked request
// bodies pgCreateAdmission/pgUpdateAdmission/pgCreateAdmissionFollowup/
// pgCreateAdmissionSystemLog build — same technique used throughout this migration series
// (MaterialsPage.materials.test.jsx, SettingsPage.centerProfile.test.jsx, etc.).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdmissionsPage from './AdmissionsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

let fetchMock;
let postAdmissionResponder;   // POST /api/admissions
let putAdmissionResponder;    // PUT /api/admissions/:id
let getAdmissionsResponder;   // GET /api/admissions (used only by the 409 retry's fresh fetch)
let postFollowupResponder;    // POST /api/admissionFollowups
let postSystemLogResponder;   // POST /api/admissionSystemLog

function okJson(data, status = 200) {
  return { ok: true, status, json: async () => ({ ok: true, data }) };
}
function errJson(status, error, field) {
  return { ok: false, status, json: async () => ({ ok: false, error, field }) };
}

beforeEach(() => {
  postAdmissionResponder = (body) => okJson({ ...body, id: body.id, number: body.number });
  putAdmissionResponder  = (id, body) => okJson({ id, number: 'ADM-000001', ...body });
  getAdmissionsResponder = () => [];
  postFollowupResponder  = (body) => okJson({ id: 'srv-followup-1', ...body });
  postSystemLogResponder = (body) => okJson({ id: `srv-sl-${Math.random()}`, ...body, timestamp: new Date().toISOString() });

  fetchMock = vi.fn((url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (u.endsWith('/api/admissions') && method === 'POST') return Promise.resolve(postAdmissionResponder(body));
    if (u.endsWith('/api/admissions') && method === 'GET')  return Promise.resolve(okJson(getAdmissionsResponder()));
    if (u.includes('/api/admissions/') && method === 'PUT') {
      const id = decodeURIComponent(u.split('/api/admissions/')[1]);
      return Promise.resolve(putAdmissionResponder(id, body));
    }
    if (u.endsWith('/api/admissionFollowups') && method === 'POST') return Promise.resolve(postFollowupResponder(body));
    if (u.endsWith('/api/admissionSystemLog') && method === 'POST') return Promise.resolve(postSystemLogResponder(body));
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

function loginSession(user) {
  sessionStorage.setItem('tc_session', JSON.stringify(user));
}

function seedStore(extra = {}) {
  useAppStore.setState({
    admissions: [], admissionFollowups: [], admissionSystemLog: [], admissionPayments: [],
    groups: [], students: [], invMaterials: [], treasuryTxn: [], cashboxes: [],
    ...extra,
  });
}

function postAdmissionCalls() {
  return fetchMock.mock.calls.filter(([url, opts]) => String(url).endsWith('/api/admissions') && opts?.method === 'POST');
}
function putAdmissionCalls() {
  return fetchMock.mock.calls.filter(([url, opts]) => String(url).includes('/api/admissions/') && opts?.method === 'PUT');
}
function followupCalls() {
  return fetchMock.mock.calls.filter(([url, opts]) => String(url).endsWith('/api/admissionFollowups') && opts?.method === 'POST');
}
function systemLogCalls() {
  return fetchMock.mock.calls.filter(([url, opts]) => String(url).endsWith('/api/admissionSystemLog') && opts?.method === 'POST');
}

// Field لا يربط <label> بـ <input> عبر htmlFor/id (لا aria) — نجد الحقل عبر أخيه في نفس
// <div> الأب (components.jsx: Field يرسم <div><label/>{children}</div>). الحقول
// required تُلحَق بـ " *" (Field: {label} {required && <span>*</span>}), فنطابق بداية
// النص فقط على عنصر <label> تحديداً — تجنّباً لالتقاط "الطالب" كنص فرعي داخل "اسم
// الطالب"/"رقم الطالب" أو عناصر أخرى غير متعلّقة.
function fieldInput(labelText) {
  const [label] = screen.getAllByText(
    (content, el) => el.tagName === 'LABEL' && content.trim().startsWith(labelText)
  );
  return label.parentElement.querySelector('input, select, textarea');
}

async function switchTab(label) {
  fireEvent.click(screen.getByText(label));
}

describe('AdmissionsPage — admissions core write path (Phase 3B-13A)', () => {
  beforeEach(() => { seedStore(); loginSession({ id: 'u_admin', name: 'Admin User', role: 'admin', isAdmin: true }); });

  it('create lead: sends the real client-computed id/number, real createdBy (session user id, not a display name), no premature local mutation, adopts server truth', async () => {
    let resolvePost;
    postAdmissionResponder = () => new Promise((resolve) => { resolvePost = resolve; });

    renderPage();
    fireEvent.click(screen.getByText('+ إضافة عميل محتمل'));
    fireEvent.change(fieldInput('اسم الطالب'), { target: { value: 'أحمد علي' } });
    fireEvent.change(fieldInput('رقم الطالب'), { target: { value: '01012345678' } });
    fireEvent.click(screen.getByText('حفظ'));

    await waitFor(() => expect(postAdmissionCalls()).toHaveLength(1));
    const sentBody = JSON.parse(postAdmissionCalls()[0][1].body);
    expect(sentBody.id).toMatch(/^adm_\d+$/);
    expect(sentBody.number).toBe('ADM-000001'); // nextAdmissionNumber على قائمة فاضية
    expect(sentBody.name).toBe('أحمد علي');
    expect(sentBody.stage).toBe('lead');
    expect(sentBody.createdBy).toBe('u_admin'); // معرّف الجلسة الحقيقي، لا اسم عرض
    // لا followups/payments/systemLog في الحمولة — لم تعد جزءاً من صف القبول أصلاً
    expect(sentBody.followups).toBeUndefined();
    expect(sentBody.payments).toBeUndefined();
    expect(sentBody.systemLog).toBeUndefined();

    // لا تعديل محلي قبل نجاح الخادم
    expect(useAppStore.getState().admissions).toEqual([]);

    resolvePost(okJson({ ...sentBody, id: sentBody.id, number: sentBody.number }));

    await waitFor(() => {
      expect(useAppStore.getState().admissions).toHaveLength(1);
    });
    expect(useAppStore.getState().admissions[0].admissionNo).toBe('ADM-000001');
  });

  it('create failure: leaves admissions state untouched, shows the real server error, and keeps the form open (no premature reset)', async () => {
    postAdmissionResponder = () => errJson(400, 'اسم الطالب مطلوب.');

    renderPage();
    fireEvent.click(screen.getByText('+ إضافة عميل محتمل'));
    fireEvent.change(fieldInput('اسم الطالب'), { target: { value: 'أحمد علي' } });
    fireEvent.change(fieldInput('رقم الطالب'), { target: { value: '01012345678' } });
    fireEvent.click(screen.getByText('حفظ'));

    expect(await screen.findByText('اسم الطالب مطلوب.')).toBeInTheDocument();
    expect(useAppStore.getState().admissions).toEqual([]);
    // النموذج بقي مفتوحاً — زر "حفظ" ما زال موجوداً (لم يُغلَق النموذج رغم الفشل)
    expect(screen.getByText('حفظ')).toBeInTheDocument();
  });

  it('admission number conflict (409 on number): retries exactly once with a number recomputed from a fresh server fetch, not stale local state', async () => {
    let call = 0;
    postAdmissionResponder = (body) => {
      call += 1;
      if (call === 1) {
        expect(body.number).toBe('ADM-000001'); // أول محاولة: من القائمة المحلية الفاضية
        return errJson(409, 'قيمة مكرّرة تنتهك قيد التفرّد.', ['number']);
      }
      expect(body.number).toBe('ADM-000003'); // أُعيد حسابه من fresh (أعلى موجود 000002) + 1
      return okJson({ ...body, id: body.id, number: body.number });
    };
    getAdmissionsResponder = () => [{ number: 'ADM-000001' }, { number: 'ADM-000002' }];

    renderPage();
    fireEvent.click(screen.getByText('+ إضافة عميل محتمل'));
    fireEvent.change(fieldInput('اسم الطالب'), { target: { value: 'أحمد علي' } });
    fireEvent.change(fieldInput('رقم الطالب'), { target: { value: '01012345678' } });
    fireEvent.click(screen.getByText('حفظ'));

    await waitFor(() => expect(postAdmissionCalls()).toHaveLength(2));
    expect(fetchMock.mock.calls.some(([url, opts]) => String(url).endsWith('/api/admissions') && (opts?.method || 'GET') === 'GET')).toBe(true);
    await waitFor(() => expect(useAppStore.getState().admissions).toHaveLength(1));
    expect(useAppStore.getState().admissions[0].admissionNo).toBe('ADM-000003');
  });

  it('admission number conflict, retry also fails: surfaces the real error, no infinite retry, no local mutation', async () => {
    let call = 0;
    postAdmissionResponder = () => {
      call += 1;
      if (call === 1) return errJson(409, 'قيمة مكرّرة تنتهك قيد التفرّد.', ['number']);
      return errJson(409, 'قيمة مكرّرة تنتهك قيد التفرّد (ثانية).', ['number']);
    };

    renderPage();
    fireEvent.click(screen.getByText('+ إضافة عميل محتمل'));
    fireEvent.change(fieldInput('اسم الطالب'), { target: { value: 'أحمد علي' } });
    fireEvent.change(fieldInput('رقم الطالب'), { target: { value: '01012345678' } });
    fireEvent.click(screen.getByText('حفظ'));

    expect(await screen.findByText('قيمة مكرّرة تنتهك قيد التفرّد (ثانية).')).toBeInTheDocument();
    expect(postAdmissionCalls()).toHaveLength(2); // مرة واحدة فقط لإعادة المحاولة، لا أكثر
    expect(useAppStore.getState().admissions).toEqual([]);
  });

  it('update (stage transition via "تحويل لحجز"): sends the correct payload, no premature local mutation, adopts server truth while preserving local-only fields', async () => {
    const existing = {
      id: 'adm_1', admissionNo: 'ADM-000001', name: 'أحمد علي', parentName: '', phone: '01012345678',
      parentPhone: '01198765432', grade: 'الصف الأول الثانوي', school: '', source: 'حضور مباشر',
      notes: '', stage: 'lead', leadStatus: 'new', secretary: 'الموظف الحالي',
      createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'admin',
      lastModifiedAt: '2026-01-01T00:00:00.000Z', lastModifiedBy: 'admin',
    };
    let resolvePut;
    putAdmissionResponder = () => new Promise((resolve) => { resolvePut = resolve; });
    seedStore({ admissions: [existing] });

    renderPage();
    fireEvent.click(screen.getByText('تحويل لحجز'));

    await waitFor(() => expect(putAdmissionCalls()).toHaveLength(1));
    const [sentUrl, sentOpts] = putAdmissionCalls()[0];
    expect(decodeURIComponent(sentUrl.split('/api/admissions/')[1])).toBe('adm_1');
    const sentBody = JSON.parse(sentOpts.body);
    expect(sentBody.stage).toBe('reserved');
    expect(sentBody.reservationStatus).toBe('reserved');
    expect(sentBody.lastModifiedBy).toBe('u_admin'); // معرّف الجلسة الحقيقي
    expect(sentBody.number).toBeUndefined(); // لا يُرسَل أبداً في التحديث
    expect(sentBody.createdBy).toBeUndefined(); // لا يُرسَل أبداً في التحديث

    // لا تعديل محلي قبل نجاح الخادم
    expect(useAppStore.getState().admissions[0].stage).toBe('lead');

    resolvePut(okJson({ ...existing, stage: 'reserved', reservationStatus: 'reserved', reservationDate: '2026-01-05' }));

    await waitFor(() => {
      expect(useAppStore.getState().admissions[0].stage).toBe('reserved');
    });
    // حقل محلي بحت (secretary، لا عمود له في admissions) بقي محفوظاً بعد تبنّي استجابة الخادم
    expect(useAppStore.getState().admissions[0].secretary).toBe('الموظف الحالي');
  });

  it('update failure: leaves the admission record untouched and shows the real server error', async () => {
    const existing = {
      id: 'adm_1', admissionNo: 'ADM-000001', name: 'أحمد علي', phone: '01012345678',
      parentPhone: '01198765432', grade: 'الصف الأول الثانوي', stage: 'lead',
    };
    putAdmissionResponder = () => errJson(404, 'السجل غير موجود.');
    seedStore({ admissions: [existing] });

    renderPage();
    fireEvent.click(screen.getByText('تحويل لحجز'));

    expect(await screen.findByText('السجل غير موجود.')).toBeInTheDocument();
    expect(useAppStore.getState().admissions[0].stage).toBe('lead');
  });

  it('convertToReservation also logs a RESERVATION system-log entry with the correct admissionId, merged into admissionSystemLog', async () => {
    const existing = {
      id: 'adm_1', admissionNo: 'ADM-000001', name: 'أحمد علي', phone: '01012345678',
      parentPhone: '01198765432', grade: 'الصف الأول الثانوي', stage: 'lead',
    };
    seedStore({ admissions: [existing] });

    renderPage();
    fireEvent.click(screen.getByText('تحويل لحجز'));

    await waitFor(() => expect(systemLogCalls()).toHaveLength(1));
    const sentBody = JSON.parse(systemLogCalls()[0][1].body);
    expect(sentBody.admissionId).toBe('adm_1');
    expect(sentBody.activityType).toBe('reservation');

    await waitFor(() => {
      expect(useAppStore.getState().admissionSystemLog).toHaveLength(1);
      expect(useAppStore.getState().admissionSystemLog[0].admissionId).toBe('adm_1');
    });
  });
});

describe('AdmissionsPage — admissionFollowups write path (Phase 3B-13A)', () => {
  const existing = {
    id: 'adm_1', admissionNo: 'ADM-000001', name: 'أحمد علي', phone: '01012345678',
    parentPhone: '01198765432', grade: 'الصف الأول الثانوي', stage: 'lead',
  };

  beforeEach(() => {
    seedStore({ admissions: [existing] });
    loginSession({ id: 'u_admin', name: 'Admin User', role: 'admin', isAdmin: true });
  });

  it('create followup: sends the correct admissionId, no premature local mutation, adopts server truth', async () => {
    let resolvePost;
    postFollowupResponder = () => new Promise((resolve) => { resolvePost = resolve; });

    renderPage();
    await switchTab('🔄 المتابعة');
    fireEvent.click(screen.getByText('+ إضافة متابعة'));
    fireEvent.change(fieldInput('الطالب'), { target: { value: 'adm_1' } });
    fireEvent.click(screen.getByText('حفظ المتابعة'));

    await waitFor(() => expect(followupCalls()).toHaveLength(1));
    const sentBody = JSON.parse(followupCalls()[0][1].body);
    expect(sentBody.admissionId).toBe('adm_1');
    expect(sentBody.type).toBe('call');

    expect(useAppStore.getState().admissionFollowups).toEqual([]);

    // شكل استجابة الخادم الخام (note/employee/date) — pgCreateAdmissionFollowup (api.js)
    // يعيد تسميتها notes/by/at فعلياً قبل أن تصل للمخزن.
    const serverRow = { id: 'srv-f1', admissionId: 'adm_1', type: 'call', note: '', employee: 'الموظف الحالي', date: '2026-01-01' };
    resolvePost(okJson(serverRow));

    await waitFor(() => {
      expect(useAppStore.getState().admissionFollowups).toEqual([
        { id: 'srv-f1', admissionId: 'adm_1', type: 'call', notes: '', by: 'الموظف الحالي', at: '2026-01-01' },
      ]);
    });
  });

  it('followup creation failure: leaves admissionFollowups untouched, shows the real server error, form stays open', async () => {
    postFollowupResponder = () => errJson(400, 'نوع المتابعة غير صالح.');

    renderPage();
    await switchTab('🔄 المتابعة');
    fireEvent.click(screen.getByText('+ إضافة متابعة'));
    fireEvent.change(fieldInput('الطالب'), { target: { value: 'adm_1' } });
    fireEvent.click(screen.getByText('حفظ المتابعة'));

    expect(await screen.findByText('نوع المتابعة غير صالح.')).toBeInTheDocument();
    expect(useAppStore.getState().admissionFollowups).toEqual([]);
    expect(screen.getByText('حفظ المتابعة')).toBeInTheDocument();
  });
});

describe('AdmissionsPage — composed view (Phase 3B-13A store architecture)', () => {
  it('composes admission + admissionFollowups + admissionPayments correctly for display, without ever writing the composed shape back into admissions[]', async () => {
    const admission = {
      id: 'adm_1', admissionNo: 'ADM-000001', name: 'أحمد علي', phone: '01012345678',
      parentPhone: '01198765432', grade: 'الصف الأول الثانوي', stage: 'lead',
    };
    const followup = { id: 'f1', admissionId: 'adm_1', type: 'call', notes: 'اتصال أول', at: '2026-01-01 10:00', by: 'سكرتيرة' };
    seedStore({ admissions: [admission], admissionFollowups: [followup] });

    renderPage();
    await switchTab('🔄 المتابعة');

    // الخط الزمني يعرض المتابعة المُطبَّعة مسبقاً من collection منفصل، لا من صف القبول
    expect(await screen.findByText('اتصال أول')).toBeInTheDocument();

    // صف القبول الخام في state.admissions نفسه يبقى بلا followups مُضمَّنة أبداً
    expect(useAppStore.getState().admissions[0].followups).toBeUndefined();
    expect(useAppStore.getState().admissionFollowups).toEqual([followup]);
  });
});
