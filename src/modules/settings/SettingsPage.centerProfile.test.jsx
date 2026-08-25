// src/modules/settings/SettingsPage.centerProfile.test.jsx
// Phase 3B-10 — نفس عقد AbsenceFollowup/CommunicationPage: save لا يغيّر الحالة المحلية
// قبل نجاح الخادم، ويتبنّى استجابة الخادم كما هي عند النجاح، ويبقى دون تغيير عند الفشل.
// slogan استثناء متعمَّد (بلا عمود DB) — يبقى محلياً فقط ولا يُرسَل أبداً.
//
// pgUpdateCenterProfile (services/api.js) يبني حمولة الطلب الفعلية داخلياً (نفس نمط
// pgCreateCommunication/pgCreateExam — انظر api.test.js)، فتمويه الدالة نفسها بالكامل
// كان سيتجاوز هذا الفلترة الداخلية. هنا نموّه fetch مباشرة (نفس تقنية api.test.js) حتى
// نتحقّق من حمولة الشبكة الحقيقية التي يبنيها الكود الفعلي غير المموَّه.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SettingsPage from './SettingsPage';
import { useAppStore } from '../../store/app.store';
import { AuthProvider } from '../../store/auth.context';
import { UIProvider } from '../../store/ui.context';
import { ToastProvider } from '../../components/Toast';

let fetchMock;
let putResponder; // (body) => Response-like — تتحكّم بها كل حالة اختبار لطلب PUT فقط

beforeEach(() => {
  putResponder = () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { id: 1 } }) });
  fetchMock = vi.fn((url, opts = {}) => {
    if (String(url).includes('/health')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, database: { connected: true, tableCount: 27, error: null } }) });
    }
    if (String(url).includes('/api/centerProfile') && opts.method === 'PUT') {
      return Promise.resolve(putResponder(opts.body ? JSON.parse(opts.body) : {}));
    }
    return Promise.reject(new Error(`unexpected fetch: ${opts.method || 'GET'} ${url}`));
  });
  globalThis.fetch = fetchMock;
});
afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <AuthProvider>
      <UIProvider>
        <ToastProvider>
          <SettingsPage />
        </ToastProvider>
      </UIProvider>
    </AuthProvider>
  );
}

function seedStore(extra = {}) {
  useAppStore.setState({
    centerProfile: { name: '', slogan: '', address: '', phone1: '', phone2: '', logoUrl: '' },
    ...extra,
  });
}

// Field لا يربط <label> بـ <input> عبر htmlFor/id (لا aria)، فنستخدم placeholder
// (فريد لكل حقل ومعروف من الكود) بدل getByLabelText.
function fillField(placeholder, value) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
}

function putCalls() {
  return fetchMock.mock.calls.filter(([url, opts]) => String(url).includes('/api/centerProfile') && opts?.method === 'PUT');
}

describe('SettingsPage — centerProfile write path', () => {
  beforeEach(() => {
    seedStore();
  });

  it('save: sends only the approved DB-backed fields over the wire, does not touch local state before the backend resolves, then adopts the server response verbatim while keeping the local-only slogan', async () => {
    let resolvePut;
    putResponder = () => new Promise((resolve) => { resolvePut = resolve; });

    renderPage();

    fillField('مثال: مركز النور التعليمي', 'مركز ستوديكس');
    fillField('مثال: نحو مستقبل أفضل', 'شعار محلي فقط');
    fillField('مثال: 15 شارع الجمهورية، المنصورة', 'القاهرة');
    fillField('01XXXXXXXXX', '0100000000');
    fillField('01XXXXXXXXX (اختياري)', '0200000000');

    fireEvent.click(screen.getByRole('button', { name: /حفظ/ }));

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    const sentBody = JSON.parse(putCalls()[0][1].body);

    expect(sentBody).toEqual({
      name: 'مركز ستوديكس', address: 'القاهرة', phone1: '0100000000', phone2: '0200000000', logoUrl: '',
    });
    expect(sentBody.id).toBeUndefined();
    expect(sentBody.slogan).toBeUndefined();
    expect(sentBody.updatedAt).toBeUndefined();
    expect(sentBody.updated_at).toBeUndefined();
    expect(sentBody.teacherName).toBeUndefined();
    expect(sentBody.subject).toBeUndefined();
    expect(sentBody.academicYear).toBeUndefined();

    // لا تعديل محلي قبل نجاح الخادم
    expect(useAppStore.getState().centerProfile).toEqual({ name: '', slogan: '', address: '', phone1: '', phone2: '', logoUrl: '' });

    const saved = {
      id: 1, name: 'مركز ستوديكس', address: 'القاهرة', phone1: '0100000000', phone2: '0200000000',
      logoUrl: null, teacherName: null, subject: null, academicYear: null, updatedAt: '2026-08-19T00:00:00.000Z',
    };
    resolvePut({ ok: true, status: 200, json: async () => ({ ok: true, data: saved }) });

    await waitFor(() => {
      expect(useAppStore.getState().centerProfile).toEqual({ ...saved, slogan: 'شعار محلي فقط' });
    });
  });

  it('save failure: leaves local state untouched and surfaces the real server error', async () => {
    putResponder = () => ({ ok: false, status: 403, json: async () => ({ ok: false, error: 'لا تملك صلاحية الوصول لهذا الإجراء.' }) });

    renderPage();
    fillField('مثال: مركز النور التعليمي', 'اسم جديد');
    fireEvent.click(screen.getByRole('button', { name: /حفظ/ }));

    expect(await screen.findByText('لا تملك صلاحية الوصول لهذا الإجراء.')).toBeInTheDocument();
    expect(useAppStore.getState().centerProfile).toEqual({ name: '', slogan: '', address: '', phone1: '', phone2: '', logoUrl: '' });
  });

  it('reset remains local-only and never sends a PUT request', async () => {
    seedStore({ centerProfile: { name: 'قديم', slogan: 'قديم', address: '', phone1: '', phone2: '', logoUrl: '' } });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '↺ مسح' }));
    const confirmBtn = await screen.findByRole('button', { name: 'نعم، امسح' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(useAppStore.getState().centerProfile.name).toBe('');
    });
    expect(putCalls()).toHaveLength(0);
  });
});
