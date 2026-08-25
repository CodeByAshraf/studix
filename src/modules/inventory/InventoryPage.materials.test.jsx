// src/modules/inventory/InventoryPage.materials.test.jsx
// InventoryPage's own material create/update/delete previously wrote only to local
// Zustand state (addInvMaterial/updateInvMaterial/removeInvMaterial — no network call
// at all). Materials-domain unification (see MATERIALS_DOMAIN_DECISION_AUDIT.md) wired
// these onto the same real pgCreateMaterial/pgUpdateMaterial/pgDeleteMaterial functions
// MaterialsPage.jsx already used (Phase 3B-11) — same POST/PUT/DELETE /api/invMaterials
// endpoints, same server-truth-first pattern, same code-conflict retry. This test
// verifies the real network payload buildMaterialRequestBody builds from this page's
// own form shape (sellingPrice → price), mirroring MaterialsPage.materials.test.jsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import InventoryPage from './InventoryPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { ToastProvider } from '../../components/Toast';

let fetchMock;
let postResponder;
let putResponder;
let deleteResponder;
let getResponder;

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
        <InventoryPage />
      </ToastProvider>
    </AuthProvider>
  );
}

function seedStore(extra = {}) {
  useAppStore.setState({
    invMaterials: [], inventoryTxn: [], inventorySettings: { defaultMinStock: 10, allowNegativeStock: false, reservationExpiryDays: 7 },
    ...extra,
  });
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

// INV_SUBJECTS[0]/INV_GRADES[0] (displayMeta.js) — القيم الافتراضية لقوائم الاختيار،
// بلا لمسها (تحديد ثابت للاختبار، لا حاجة لتغييرها).
const DEFAULT_SUBJECT = 'رياضيات';
const DEFAULT_GRADE   = 'الصف الأول الإعدادي';

function openAddForm() {
  fireEvent.click(screen.getByText('+ مادة'));
}

function fillCreateForm({ name = 'مادة اختبار فريدة', sellingPrice = '50' } = {}) {
  fireEvent.change(screen.getByPlaceholderText('مذكرة المراجعة النهائية'), { target: { value: name } });
  const priceInputs = screen.getAllByPlaceholderText('0'); // sellingPrice ثم printingCost يتشاركان نفس placeholder
  fireEvent.change(priceInputs[0], { target: { value: sellingPrice } });
}

describe('InventoryPage — material CRUD now writes through the real inv_materials Postgres path', () => {
  beforeEach(() => {
    seedStore();
  });

  it('create: sends name/subject/grade/price/code over the wire (mapped from this page\'s own sellingPrice field), does not touch local state before the backend resolves, then adopts the server response verbatim into invMaterials', async () => {
    let resolvePost;
    postResponder = () => new Promise((resolve) => { resolvePost = resolve; });

    renderPage();
    openAddForm();
    fillCreateForm({ name: 'مادة اختبار فريدة', sellingPrice: '50' });
    fireEvent.click(screen.getByRole('button', { name: 'إضافة' }));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    const sentBody = JSON.parse(postCalls()[0][1].body);

    expect(sentBody).toEqual({
      code: 'MAT-000001', name: 'مادة اختبار فريدة', subject: DEFAULT_SUBJECT, grade: DEFAULT_GRADE, price: 50,
    });
    expect(sentBody.id).toBeUndefined();
    expect(sentBody.academicYear).toBeUndefined();
    expect(sentBody.edition).toBeUndefined();
    expect(sentBody.printingCost).toBeUndefined();
    expect(sentBody.notes).toBeUndefined();
    // هذه الصفحة لا تملك مدخلات لها إطلاقاً — يجب أن تكون غائبة عن الحمولة كلياً (لا حتى
    // null صريحة)، وإلا كانت ستمحو صامتاً أي قيمة وضعتها MaterialsPage على نفس الصف عند
    // أي تعديل لاحق من InventoryPage (انظر تعليق buildMaterialRequestBody في api.js).
    expect(sentBody.teacher).toBeUndefined();
    expect(sentBody.description).toBeUndefined();
    expect(sentBody.addedAt).toBeUndefined();
    expect('teacher' in sentBody).toBe(false);
    expect('description' in sentBody).toBe(false);
    expect('addedAt' in sentBody).toBe(false);

    // لا تعديل محلي قبل نجاح الخادم — نفس الضمان في MaterialsPage
    expect(useAppStore.getState().invMaterials).toEqual([]);

    resolvePost(okJson({
      id: '11', code: 'MAT-000001', name: 'مادة اختبار فريدة', subject: DEFAULT_SUBJECT, grade: DEFAULT_GRADE,
      price: '50.00', cost: '0', minStock: '0', status: 'active', barcode: null,
      teacher: null, description: null, addedAt: null, createdAt: '2026-08-19T00:00:00.000Z',
    }));

    await waitFor(() => {
      const mats = useAppStore.getState().invMaterials;
      expect(mats).toHaveLength(1);
      expect(mats[0].id).toBe('11'); // id الحقيقي من الخادم، لا mat_${Date.now()} المحلي القديم
      expect(mats[0].price).toBe(50);
      expect(typeof mats[0].price).toBe('number');
    });
  });

  it('create failure: leaves local state untouched and surfaces the real server error', async () => {
    postResponder = () => errJson(400, 'قيمة أطول من المسموح.');

    renderPage();
    openAddForm();
    fillCreateForm();
    fireEvent.click(screen.getByRole('button', { name: 'إضافة' }));

    expect(await screen.findByText('قيمة أطول من المسموح.')).toBeInTheDocument();
    expect(useAppStore.getState().invMaterials).toEqual([]);
  });

  it('duplicate code (409): retries exactly once with a recomputed code, fetched fresh from the server (not from this page\'s own possibly-stale local array)', async () => {
    let call = 0;
    postResponder = (body) => {
      call += 1;
      if (call === 1) {
        expect(body.code).toBe('MAT-000001');
        return errJson(409, 'قيمة مكرّرة تنتهك قيد التفرّد.', ['code']);
      }
      expect(body.code).toBe('MAT-000003');
      return okJson({ id: '12', code: body.code, name: body.name, subject: body.subject, grade: body.grade, price: '0', cost: '0', minStock: '0' });
    };
    getResponder = () => [{ code: 'MAT-000001' }, { code: 'MAT-000002' }];

    renderPage();
    openAddForm();
    fillCreateForm();
    fireEvent.click(screen.getByRole('button', { name: 'إضافة' }));

    await waitFor(() => expect(postCalls()).toHaveLength(2));
    expect(getCalls()).toHaveLength(1);
    await waitFor(() => expect(useAppStore.getState().invMaterials).toHaveLength(1));
    expect(useAppStore.getState().invMaterials[0].code).toBe('MAT-000003');
  });

  it('update: PUT payload maps sellingPrice back to price, omits code, does not touch local state before success, adopts the server response verbatim (including any teacher/description/addedAt already on the row from the other module)', async () => {
    const existing = {
      id: '1', code: 'MAT-000001', name: 'قديم', subject: DEFAULT_SUBJECT, grade: DEFAULT_GRADE, price: 50,
      teacher: 'أ. سارة', description: 'أُنشئت من MaterialsPage', addedAt: '2026-02-01',
    };
    seedStore({ invMaterials: [existing] });

    let resolvePut;
    putResponder = () => new Promise((resolve) => { resolvePut = resolve; });

    renderPage();
    fireEvent.click(screen.getByText('قديم')); // اختيار البطاقة
    fireEvent.click(screen.getByRole('button', { name: 'تعديل' }));
    fireEvent.change(screen.getByPlaceholderText('مذكرة المراجعة النهائية'), { target: { value: 'اسم محدَّث من المخزون' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التعديل' }));

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    const [sentId, sentBody] = [putCalls()[0][0].split('/api/invMaterials/')[1], JSON.parse(putCalls()[0][1].body)];
    expect(decodeURIComponent(sentId)).toBe('1');
    expect(sentBody).toEqual({ name: 'اسم محدَّث من المخزون', subject: DEFAULT_SUBJECT, grade: DEFAULT_GRADE, price: 50 });
    expect(sentBody.code).toBeUndefined();
    // الأهم في هذا الاختبار: teacher/description/addedAt غائبة كلياً عن حمولة PUT — لو
    // أُرسلت كـ null صريحة هنا، الخادم كان سيمحو "أ. سارة"/"أُنشئت من MaterialsPage"/
    // "2026-02-01" الموجودة فعلاً على هذا الصف (Prisma partial update: مفتاح غائب = لا
    // لمس، null صريحة = امسح). هذا بالضبط الخلل المُكتشَف أثناء التنفيذ وأُصلح في
    // buildMaterialRequestBody (api.js) قبل هذا الاختبار.
    expect('teacher' in sentBody).toBe(false);
    expect('description' in sentBody).toBe(false);
    expect('addedAt' in sentBody).toBe(false);

    expect(useAppStore.getState().invMaterials).toEqual([existing]);

    const saved = {
      id: '1', code: 'MAT-000001', name: 'اسم محدَّث من المخزون', subject: DEFAULT_SUBJECT, grade: DEFAULT_GRADE,
      price: '50.00', cost: '0', minStock: '0', status: 'active', barcode: null,
      teacher: 'أ. سارة', description: 'أُنشئت من MaterialsPage', addedAt: '2026-02-01T00:00:00.000Z',
    };
    resolvePut(okJson(saved));

    await waitFor(() => {
      const mats = useAppStore.getState().invMaterials;
      expect(mats).toHaveLength(1);
      expect(mats[0].name).toBe('اسم محدَّث من المخزون');
      // InventoryPage لا يملك مدخلات teacher/description/addedAt — لكن القيم التي كانت
      // موجودة بالفعل على الصف (من MaterialsPage) تُحفَظ عبر استجابة الخادم، لا تُمحى.
      expect(mats[0].teacher).toBe('أ. سارة');
      expect(mats[0].description).toBe('أُنشئت من MaterialsPage');
      expect(mats[0].addedAt).toBe('2026-02-01');
    });
  });

  it('update failure: leaves the existing local record untouched and shows the real server error', async () => {
    const existing = { id: '1', code: 'MAT-000001', name: 'قديم', subject: DEFAULT_SUBJECT, grade: DEFAULT_GRADE, price: 50 };
    seedStore({ invMaterials: [existing] });
    putResponder = () => errJson(404, 'السجل غير موجود.');

    renderPage();
    fireEvent.click(screen.getByText('قديم'));
    fireEvent.click(screen.getByRole('button', { name: 'تعديل' }));
    fireEvent.click(screen.getByRole('button', { name: 'حفظ التعديل' }));

    expect(await screen.findByText('السجل غير موجود.')).toBeInTheDocument();
    expect(useAppStore.getState().invMaterials).toEqual([existing]);
  });

  it('delete: calls DELETE /api/invMaterials/:id, does not touch local state before success, then removes the material', async () => {
    const existing = { id: '1', code: 'MAT-000001', name: 'مادة للحذف', subject: DEFAULT_SUBJECT, grade: DEFAULT_GRADE, price: 50 };
    seedStore({ invMaterials: [existing] });

    let resolveDel;
    deleteResponder = () => new Promise((resolve) => { resolveDel = resolve; });

    renderPage();
    fireEvent.click(screen.getByText('مادة للحذف'));
    fireEvent.click(screen.getByRole('button', { name: 'حذف' }));

    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(decodeURIComponent(deleteCalls()[0][0].split('/api/invMaterials/')[1])).toBe('1');

    expect(useAppStore.getState().invMaterials).toEqual([existing]);

    resolveDel(okJson(null));

    await waitFor(() => {
      expect(useAppStore.getState().invMaterials).toEqual([]);
    });
  });

  it('delete failure: leaves local state untouched and shows the real server error', async () => {
    const existing = { id: '1', code: 'MAT-000001', name: 'مادة للحذف', subject: DEFAULT_SUBJECT, grade: DEFAULT_GRADE, price: 50 };
    seedStore({ invMaterials: [existing] });
    deleteResponder = () => errJson(409, 'انتهاك مفتاح خارجي (سجل مرتبط غير موجود).');

    renderPage();
    fireEvent.click(screen.getByText('مادة للحذف'));
    fireEvent.click(screen.getByRole('button', { name: 'حذف' }));

    expect(await screen.findByText('انتهاك مفتاح خارجي (سجل مرتبط غير موجود).')).toBeInTheDocument();
    expect(useAppStore.getState().invMaterials).toEqual([existing]);
  });

  it('delete blocked locally when the material has inventory transactions — no network call is made', async () => {
    const existing = { id: '1', code: 'MAT-000001', name: 'مادة محجوزة', subject: DEFAULT_SUBJECT, grade: DEFAULT_GRADE, price: 50 };
    const txn = { id: 't1', number: 'INV-000001', materialId: '1', type: 'purchase', quantity: 5, createdAt: '2026-01-01T00:00:00.000Z' };
    seedStore({ invMaterials: [existing], inventoryTxn: [txn] });

    renderPage();
    fireEvent.click(screen.getByText('مادة محجوزة'));
    fireEvent.click(screen.getByRole('button', { name: 'حذف' }));

    expect(await screen.findByText('لا يمكن حذف مادة لها حركات مخزون')).toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(0);
    expect(useAppStore.getState().invMaterials).toEqual([existing]);
  });
});
