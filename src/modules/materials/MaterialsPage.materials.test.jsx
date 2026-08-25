// src/modules/materials/MaterialsPage.materials.test.jsx
// Phase 3B-11 wired the write path (POST/PUT/DELETE /api/invMaterials) directly.
// Materials-domain unification (see MATERIALS_DOMAIN_DECISION_AUDIT.md /
// MATERIALS_FIELD_OWNERSHIP_DECISION.md) then (1) retargeted this page onto the same
// invMaterials collection InventoryPage.jsx uses (one shared Postgres-backed table),
// and (2) added teacher/description/addedAt as real nullable inv_materials columns and
// fixed materialService.js so they actually survive create/edit instead of being
// silently dropped. This file's fetch mock is un-mocked at the pgCreateMaterial/
// pgUpdateMaterial level (nموّه fetch مباشرة) so we verify the real network payload
// buildMaterialRequestBody builds, and the real retry logic on a code conflict.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import MaterialsPage from './MaterialsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

let fetchMock;
let postResponder;   // (body) => Response-like — POST /api/invMaterials فقط
let putResponder;    // (id, body) => Response-like — PUT /api/invMaterials/:id فقط
let deleteResponder; // (id) => Response-like — DELETE /api/invMaterials/:id فقط
let getResponder;    // () => any[] — GET /api/invMaterials (يُستخدَم فقط عند إعادة محاولة code)

function okJson(data, status = 200) {
  return { ok: true, status, json: async () => ({ ok: true, data }) };
}
function errJson(status, error, field) {
  return { ok: false, status, json: async () => ({ ok: false, error, field }) };
}

beforeEach(() => {
  postResponder   = () => okJson({ id: '1', code: 'MAT-000001', name: 'x', subject: null, grade: null, price: '0', cost: '0', minStock: '0', status: 'active', barcode: null, teacher: null, description: null, addedAt: null, createdAt: '2026-08-19T00:00:00.000Z' });
  putResponder    = () => okJson({ id: '1', code: 'MAT-000001', name: 'x', subject: null, grade: null, price: '0', cost: '0', minStock: '0', status: 'active', barcode: null, teacher: null, description: null, addedAt: null });
  deleteResponder = () => okJson(null);
  getResponder    = () => [];

  fetchMock = vi.fn((url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    if (u.endsWith('/api/invMaterials') && method === 'POST') return Promise.resolve(postResponder(opts.body ? JSON.parse(opts.body) : {}));
    if (u.includes('/api/invMaterials/') && method === 'PUT') {
      const id = u.split('/api/invMaterials/')[1];
      return Promise.resolve(putResponder(decodeURIComponent(id), opts.body ? JSON.parse(opts.body) : {}));
    }
    if (u.includes('/api/invMaterials/') && method === 'DELETE') {
      const id = u.split('/api/invMaterials/')[1];
      return Promise.resolve(deleteResponder(decodeURIComponent(id)));
    }
    if (u.endsWith('/api/invMaterials') && method === 'GET') return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: getResponder() }) });
    return Promise.reject(new Error(`unexpected fetch: ${method} ${u}`));
  });
  globalThis.fetch = fetchMock;
});
afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <MaterialsPage />
      </ToastProvider>
    </AuthProvider>
  );
}

function seedStore(extra = {}) {
  useAppStore.setState({
    invMaterials: [], matDist: [], students: [],
    ...extra,
  });
}

function modalBody() {
  return document.querySelector('.modal-body');
}

function postCalls() {
  return fetchMock.mock.calls.filter(([url, opts]) => String(url).endsWith('/api/invMaterials') && (opts?.method || 'GET') === 'POST');
}
function putCalls() {
  return fetchMock.mock.calls.filter(([url, opts]) => String(url).includes('/api/invMaterials/') && opts?.method === 'PUT');
}
function deleteCalls() {
  return fetchMock.mock.calls.filter(([url, opts]) => String(url).includes('/api/invMaterials/') && opts?.method === 'DELETE');
}
function getCalls() {
  return fetchMock.mock.calls.filter(([url, opts]) => String(url).endsWith('/api/invMaterials') && (opts?.method || 'GET') === 'GET');
}

// teacher/description/addedAt اختيارية — تُترَك فارغة (نفس سلوك الفراغ القديم) لو لم تُمرَّر.
function fillCreateForm({ teacher = '', description = '', addedAt } = {}) {
  const body = modalBody();
  fireEvent.change(within(body).getByPlaceholderText('مثال: مذكرة الرياضيات — الترم الأول'), { target: { value: 'مذكرة تجريبية' } });
  const selects = within(body).getAllByRole('combobox');
  fireEvent.change(selects[0], { target: { value: 'رياضيات' } });   // subject
  fireEvent.change(selects[1], { target: { value: 'الصف الأول الثانوي' } }); // grade
  fireEvent.change(within(body).getByPlaceholderText('اسم المدرس...'), { target: { value: teacher } });
  // materialSchema (validation.js) يتطلّب price (بعكس validateMaterial المحلي في
  // useForm الذي يسمح بها فارغة) — بدونها createMaterial() يرمي VALIDATION قبل أي
  // استدعاء شبكة.
  fireEvent.change(within(body).getByPlaceholderText('80'), { target: { value: '80' } });
  if (addedAt) {
    fireEvent.change(body.querySelector('input[type="date"]'), { target: { value: addedAt } });
  }
  fireEvent.change(within(body).getByPlaceholderText('وصف مختصر للمحتوى...'), { target: { value: description } });
}

describe('MaterialsPage — inv_materials write path (unified with InventoryPage)', () => {
  beforeEach(() => {
    seedStore();
  });

  it('create: sends name/subject/grade/price/teacher/description/addedAt/code over the wire (no id/createdAt/cost/minStock/status/barcode), does not touch local state before the backend resolves, then adopts the server response with price/cost/minStock normalized to numbers and addedAt truncated to YYYY-MM-DD', async () => {
    let resolvePost;
    postResponder = () => new Promise((resolve) => { resolvePost = resolve; });

    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: '+ إضافة مذكرة' })[0]);
    fillCreateForm({ teacher: 'أ. أحمد', description: 'وصف تجريبي', addedAt: '2026-01-15' });
    fireEvent.click(within(modalBody()).getByRole('button', { name: /إضافة المذكرة/ }));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    const sentBody = JSON.parse(postCalls()[0][1].body);

    expect(sentBody).toEqual({
      code: 'MAT-000001', name: 'مذكرة تجريبية', subject: 'رياضيات', grade: 'الصف الأول الثانوي',
      price: 80, teacher: 'أ. أحمد', description: 'وصف تجريبي', addedAt: '2026-01-15',
    });
    expect(sentBody.id).toBeUndefined();
    expect(sentBody.createdAt).toBeUndefined();
    expect(sentBody.cost).toBeUndefined();
    expect(sentBody.minStock).toBeUndefined();
    expect(sentBody.status).toBeUndefined();
    expect(sentBody.barcode).toBeUndefined();

    // لا تعديل محلي قبل نجاح الخادم
    expect(useAppStore.getState().invMaterials).toEqual([]);

    resolvePost(okJson({
      id: '7', code: 'MAT-000001', name: 'مذكرة تجريبية', subject: 'رياضيات', grade: 'الصف الأول الثانوي',
      price: '150.00', cost: '80.00', minStock: '3.00', status: 'active', barcode: null,
      teacher: 'أ. أحمد', description: 'وصف تجريبي', addedAt: '2026-01-15T00:00:00.000Z',
      createdAt: '2026-08-19T00:00:00.000Z',
    }));

    await waitFor(() => {
      const mats = useAppStore.getState().invMaterials;
      expect(mats).toHaveLength(1);
      expect(mats[0].id).toBe('7');
      expect(mats[0].price).toBe(150);
      expect(typeof mats[0].price).toBe('number');
      expect(mats[0].cost).toBe(80);
      expect(typeof mats[0].cost).toBe('number');
      expect(mats[0].minStock).toBe(3);
      expect(typeof mats[0].minStock).toBe('number');
      expect(mats[0].teacher).toBe('أ. أحمد');
      expect(mats[0].description).toBe('وصف تجريبي');
      expect(mats[0].addedAt).toBe('2026-01-15');
    });
  });

  it('create failure: leaves local state untouched and surfaces the real server error', async () => {
    postResponder = () => errJson(400, 'قيمة أطول من المسموح.');

    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: '+ إضافة مذكرة' })[0]);
    fillCreateForm();
    fireEvent.click(within(modalBody()).getByRole('button', { name: /إضافة المذكرة/ }));

    expect(await screen.findByText('قيمة أطول من المسموح.')).toBeInTheDocument();
    expect(useAppStore.getState().invMaterials).toEqual([]);
  });

  it('duplicate code (409): retries exactly once with a recomputed code, fetched fresh from the server', async () => {
    let call = 0;
    postResponder = (body) => {
      call += 1;
      if (call === 1) {
        expect(body.code).toBe('MAT-000001');
        return errJson(409, 'قيمة مكرّرة تنتهك قيد التفرّد.', ['code']);
      }
      expect(body.code).toBe('MAT-000003'); // أُعيد حسابه من fresh (أعلى موجود 2) + 1
      return okJson({ id: '9', code: body.code, name: body.name, subject: body.subject, grade: body.grade, price: '0', cost: '0', minStock: '0' });
    };
    getResponder = () => [{ code: 'MAT-000001' }, { code: 'MAT-000002' }]; // "fresh" من الخادم، أعلى من المحلي

    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: '+ إضافة مذكرة' })[0]);
    fillCreateForm();
    fireEvent.click(within(modalBody()).getByRole('button', { name: /إضافة المذكرة/ }));

    await waitFor(() => expect(postCalls()).toHaveLength(2));
    expect(getCalls()).toHaveLength(1); // إعادة الحساب جاءت من fetch حقيقي، لا من الحالة المحلية القديمة
    await waitFor(() => expect(useAppStore.getState().invMaterials).toHaveLength(1));
    expect(useAppStore.getState().invMaterials[0].code).toBe('MAT-000003');
  });

  it('update: PUT payload includes teacher/description/addedAt alongside name/subject/grade/price (not just the fields being changed), omits code entirely, does not touch local state before success, and the edited material keeps its teacher/description/addedAt after adopting the server response', async () => {
    const existing = {
      id: '1', code: 'MAT-000001', name: 'قديم', subject: 'رياضيات', grade: 'الصف الأول الثانوي',
      teacher: 'أ. محمد', price: 100, description: 'وصف قديم', addedAt: '2026-01-01',
    };
    seedStore({ invMaterials: [existing] });

    let resolvePut;
    putResponder = () => new Promise((resolve) => { resolvePut = resolve; });

    renderPage();
    fireEvent.click(screen.getByTitle('تعديل'));
    fireEvent.change(within(modalBody()).getByPlaceholderText('مثال: مذكرة الرياضيات — الترم الأول'), { target: { value: 'اسم محدَّث' } });
    fireEvent.click(within(modalBody()).getByRole('button', { name: /حفظ التعديلات/ }));

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    const [sentId, sentBody] = [putCalls()[0][0].split('/api/invMaterials/')[1], JSON.parse(putCalls()[0][1].body)];
    expect(decodeURIComponent(sentId)).toBe('1');
    expect(sentBody).toEqual({
      name: 'اسم محدَّث', subject: 'رياضيات', grade: 'الصف الأول الثانوي', price: 100,
      teacher: 'أ. محمد', description: 'وصف قديم', addedAt: '2026-01-01',
    });
    expect(sentBody.code).toBeUndefined();
    expect(sentBody.id).toBeUndefined();

    expect(useAppStore.getState().invMaterials).toEqual([existing]);

    const saved = {
      id: '1', code: 'MAT-000001', name: 'اسم محدَّث', subject: 'رياضيات', grade: 'الصف الأول الثانوي',
      price: '100.00', cost: '0', minStock: '0', status: 'active', barcode: null,
      teacher: 'أ. محمد', description: 'وصف قديم', addedAt: '2026-01-01T00:00:00.000Z',
    };
    resolvePut(okJson(saved));

    await waitFor(() => {
      const mats = useAppStore.getState().invMaterials;
      expect(mats).toHaveLength(1);
      expect(mats[0].name).toBe('اسم محدَّث');
      expect(mats[0].price).toBe(100);
      expect(mats[0].cost).toBe(0);
      expect(mats[0].minStock).toBe(0);
      // الحقل الجوهري لهذا الاختبار: teacher/description/addedAt لم تُمحَ بعد التعديل
      expect(mats[0].teacher).toBe('أ. محمد');
      expect(mats[0].description).toBe('وصف قديم');
      expect(mats[0].addedAt).toBe('2026-01-01');
    });
  });

  it('update failure: leaves the existing local record untouched and shows the real server error', async () => {
    const existing = { id: '1', code: 'MAT-000001', name: 'قديم', subject: 'رياضيات', grade: 'الصف الأول الثانوي', price: 100 };
    seedStore({ invMaterials: [existing] });
    putResponder = () => errJson(404, 'السجل غير موجود.');

    renderPage();
    fireEvent.click(screen.getByTitle('تعديل'));
    fireEvent.click(within(modalBody()).getByRole('button', { name: /حفظ التعديلات/ }));

    expect(await screen.findByText('السجل غير موجود.')).toBeInTheDocument();
    expect(useAppStore.getState().invMaterials).toEqual([existing]);
  });

  // matDist read-path migration: matDist لم يعد حالة مستقلة، بل مُشتَق من inventoryTxn —
  // حذف مادة لم يعد يلمس inventoryTxn إطلاقاً هنا (الخادم أصلاً يرفض حذف مادة لها
  // inventory_txn حقيقية، 409 — انظر PHASE_NEXT_MATDIST_IMPLEMENTATION_PLAN.md).
  it('delete: calls DELETE /api/invMaterials/:id, does not touch local state before success, then removes the material — inventoryTxn (and the matDist derived from it) is untouched by material deletion', async () => {
    const existing = { id: '1', code: 'MAT-000001', name: 'مذكرة', subject: 'رياضيات', grade: 'الصف الأول الثانوي', price: 100 };
    const txn = { id: 'd1', materialId: '1', studentId: 's1', type: 'studentDelivery', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', legacyMetadata: { payStatus: 'unpaid', paidAmount: 0, receivedAt: null } };
    seedStore({ invMaterials: [existing], inventoryTxn: [txn] });

    let resolveDel;
    deleteResponder = () => new Promise((resolve) => { resolveDel = resolve; });

    renderPage();
    fireEvent.click(screen.getByTitle('حذف'));
    fireEvent.click(await screen.findByRole('button', { name: 'نعم، احذف' }));

    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(decodeURIComponent(deleteCalls()[0][0].split('/api/invMaterials/')[1])).toBe('1');

    expect(useAppStore.getState().invMaterials).toEqual([existing]);
    expect(useAppStore.getState().inventoryTxn).toEqual([txn]);

    resolveDel(okJson(null));

    await waitFor(() => {
      expect(useAppStore.getState().invMaterials).toEqual([]);
      expect(useAppStore.getState().inventoryTxn).toEqual([txn]);
    });
  });

  it('delete failure: leaves local state (invMaterials and matDist) untouched and shows the real server error', async () => {
    const existing = { id: '1', code: 'MAT-000001', name: 'مذكرة', subject: 'رياضيات', grade: 'الصف الأول الثانوي', price: 100 };
    const dist = { id: 'd1', matId: '1', studentId: 's1' };
    seedStore({ invMaterials: [existing], matDist: [dist] });
    deleteResponder = () => errJson(409, 'انتهاك مفتاح خارجي (سجل مرتبط غير موجود).');

    renderPage();
    fireEvent.click(screen.getByTitle('حذف'));
    fireEvent.click(await screen.findByRole('button', { name: 'نعم، احذف' }));

    expect(await screen.findByText('انتهاك مفتاح خارجي (سجل مرتبط غير موجود).')).toBeInTheDocument();
    expect(useAppStore.getState().invMaterials).toEqual([existing]);
    expect(useAppStore.getState().matDist).toEqual([dist]);
  });
});
