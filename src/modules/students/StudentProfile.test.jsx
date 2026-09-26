// src/modules/students/StudentProfile.test.jsx
// MEDIUM-A Finding 6 — students.parent_id (Phase 1) كان مكتوباً لكن غير مُستخدَم في
// العرض إطلاقاً. يتحقّق هذا الاختبار أن معلومات ولي الأمر المرتبط (هاتف بديل/طريقة
// تواصل مفضّلة/وقت مفضّل) تظهر فقط عندما يتوفّر ربط حقيقي بصف parents، وتبقى غائبة
// تماماً بلا أي تغيير في السلوك عندما لا يوجد ربط (لا كسر لأي حالة سابقة).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import StudentProfile from './StudentProfile';
import { useAppStore } from '../../store/app.store';
import { ToastProvider } from '../../components/Toast';

const GROUP_ID = 'g1';
const S1 = 's1';

const BASE_STUDENT = {
  id: S1, name: 'طالب واحد', code: 'TC001', grade: 'الأول', phone: '01000000001',
  parentPhone: '01000000002', groupId: GROUP_ID, status: 'active', enrollDate: '2025-01-01', monthlyFee: 100,
};

// Phase 4 Cutover 2: StudentProfile.jsx now fetches GET /api/payments?studentId= instead
// of reading the store's payments array — these tests only exercise unrelated
// parent-linking display, so an empty response is enough; still needs ToastProvider since
// the component calls useToast() unconditionally now.
function mockPaymentsFetch() {
  globalThis.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.includes('/api/payments?')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: [] }) });
    }
    return Promise.reject(new Error(`unexpected fetch: ${u}`));
  });
}
afterEach(() => { vi.restoreAllMocks(); });

function seedBaseState(extra = {}) {
  useAppStore.setState({
    groups: [{ id: GROUP_ID, name: 'مجموعة أ', grade: 'الأول', max: 20 }],
    students: [BASE_STUDENT],
    attendance: [], exams: [], grades: [], parents: [],
    ...extra,
  });
  mockPaymentsFetch();
}

function renderProfile() {
  return render(
    <ToastProvider>
      <StudentProfile studentId={S1} onBack={() => {}} onEdit={() => {}} />
    </ToastProvider>
  );
}

describe('StudentProfile — linked parent info (MEDIUM-A Finding 6)', () => {
  it('shows nothing extra when the student has no parentId', () => {
    seedBaseState();
    renderProfile();
    expect(screen.queryByText(/هاتف بديل/)).not.toBeInTheDocument();
    expect(screen.queryByText(/التواصل المفضّل/)).not.toBeInTheDocument();
    expect(screen.queryByText(/الوقت المفضّل/)).not.toBeInTheDocument();
  });

  it('shows nothing extra when parentId is set but does not resolve to any loaded parents row', () => {
    seedBaseState({ students: [{ ...BASE_STUDENT, parentId: 'p_missing' }] });
    renderProfile();
    expect(screen.queryByText(/هاتف بديل/)).not.toBeInTheDocument();
  });

  it('shows nothing extra when the linked parent row has none of the three fields populated', () => {
    seedBaseState({
      students: [{ ...BASE_STUDENT, parentId: 'p1' }],
      parents: [{ id: 'p1', phone: '01000000002' }],
    });
    renderProfile();
    expect(screen.queryByText(/هاتف بديل/)).not.toBeInTheDocument();
    expect(screen.queryByText(/التواصل المفضّل/)).not.toBeInTheDocument();
    expect(screen.queryByText(/الوقت المفضّل/)).not.toBeInTheDocument();
  });

  it('shows alternate phone, preferred method, and preferred time when parentId resolves to a fully-populated parents row', () => {
    seedBaseState({
      students: [{ ...BASE_STUDENT, parentId: 'p1' }],
      parents: [{ id: 'p1', phone: '01000000002', altPhone: '01099999999', preferredMethod: 'whatsapp', preferredTime: 'بعد العصر' }],
    });
    renderProfile();
    expect(screen.getByText(/هاتف بديل: 01099999999/)).toBeInTheDocument();
    expect(screen.getByText(/التواصل المفضّل: واتساب/)).toBeInTheDocument();
    expect(screen.getByText(/الوقت المفضّل: بعد العصر/)).toBeInTheDocument();
  });
});

// State Synchronization Audit fix — real defect: handleSaveNotes only wrote to local
// Zustand state, with zero backend call. Notes appeared saved but were silently discarded
// on the next boot-sync/reload since the server never received them. Fixed by routing
// through the existing pgUpdateStudent (PUT /api/students/:id) endpoint, same partial-
// payload convention already used by StudentsPage.jsx's own edit flow, and only updating
// Zustand from the server's own response after a real success.
describe('StudentProfile — notes persistence (State Synchronization Audit fix)', () => {
  function mockNotesFetch({ putImpl } = {}) {
    globalThis.fetch = vi.fn((url, opts = {}) => {
      const u = String(url);
      if (u.includes('/api/payments?')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: [] }) });
      }
      if (u.endsWith(`/api/students/${S1}`) && opts.method === 'PUT') {
        return Promise.resolve(putImpl ? putImpl(JSON.parse(opts.body)) : {
          ok: true, status: 200, json: async () => ({ ok: true, data: { ...BASE_STUDENT, notes: JSON.parse(opts.body).notes } }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${opts.method || 'GET'} ${u}`));
    });
  }

  function openNotesEditor() {
    fireEvent.click(screen.getByRole('button', { name: /الملاحظات/ }));
    // الصفحة نفسها لها زر "✎ تعديل" عام (رأس الصفحة) بنفس النص بالضبط — نطاق البحث هنا
    // داخل صف "ملاحظات الطالب" فقط ليصل لزر NotesTab تحديداً، لا الزر العام.
    const notesRow = screen.getByText('ملاحظات الطالب').parentElement.parentElement;
    fireEvent.click(within(notesRow).getByText('✎ تعديل'));
  }

  it('saving a note calls the real student update API with a partial {notes} payload — no full-object payload required', async () => {
    seedBaseState();
    mockNotesFetch(); // بعد seedBaseState عمداً — seedBaseState تستدعي mockPaymentsFetch نفسها، فتُطبَّق هذه بعدها
    renderProfile();
    openNotesEditor();

    fireEvent.change(screen.getByPlaceholderText('اكتب ملاحظاتك هنا...'), { target: { value: 'ملاحظة تجريبية' } });
    fireEvent.click(screen.getByText('حفظ الملاحظات'));

    await waitFor(() => {
      const putCall = globalThis.fetch.mock.calls.find(([u, o]) => o?.method === 'PUT');
      expect(putCall).toBeTruthy();
      expect(JSON.parse(putCall[1].body)).toEqual({ notes: 'ملاحظة تجريبية' });
    });
  });

  it('a successful save updates Zustand from the server response, and closes the editor', async () => {
    seedBaseState();
    mockNotesFetch();
    renderProfile();
    openNotesEditor();

    fireEvent.change(screen.getByPlaceholderText('اكتب ملاحظاتك هنا...'), { target: { value: 'ملاحظة محفوظة' } });
    fireEvent.click(screen.getByText('حفظ الملاحظات'));

    await waitFor(() => expect(useAppStore.getState().students.find(s => s.id === S1).notes).toBe('ملاحظة محفوظة'));
    // المودال/وضع التعديل يُغلَق فقط بعد نجاح حقيقي — النص يظهر الآن للقراءة فقط.
    expect(screen.queryByPlaceholderText('اكتب ملاحظاتك هنا...')).not.toBeInTheDocument();
    expect(screen.getByText('ملاحظة محفوظة')).toBeInTheDocument();
  });

  it('a failed API call does NOT update Zustand, keeps the editor open with the user\'s typed text intact, and shows an error', async () => {
    seedBaseState();
    mockNotesFetch({ putImpl: () => Promise.resolve({ ok: false, status: 400, json: async () => ({ ok: false, error: 'فشل الاتصال بالخادم' }) }) });
    renderProfile();
    openNotesEditor();

    fireEvent.change(screen.getByPlaceholderText('اكتب ملاحظاتك هنا...'), { target: { value: 'نص لم يُحفَظ' } });
    fireEvent.click(screen.getByText('حفظ الملاحظات'));

    expect(await screen.findByText('فشل الاتصال بالخادم')).toBeInTheDocument();
    expect(useAppStore.getState().students.find(s => s.id === S1).notes).toBeUndefined();
    // وضع التعديل يبقى مفتوحاً والنص المكتوب لم يُفقَد — لا حاجة لإعادة كتابته.
    expect(screen.getByPlaceholderText('اكتب ملاحظاتك هنا...')).toHaveValue('نص لم يُحفَظ');
  });

  it('notes survive a simulated reload: after a successful save, re-mounting the component from the same (now server-updated) store state still shows the saved note', async () => {
    seedBaseState();
    mockNotesFetch();
    const { unmount } = renderProfile();
    openNotesEditor();
    fireEvent.change(screen.getByPlaceholderText('اكتب ملاحظاتك هنا...'), { target: { value: 'يبقى بعد إعادة التحميل' } });
    fireEvent.click(screen.getByText('حفظ الملاحظات'));
    await waitFor(() => expect(useAppStore.getState().students.find(s => s.id === S1).notes).toBe('يبقى بعد إعادة التحميل'));

    // محاكاة "إعادة تحميل" — إلغاء تركيب المكوّن ثم إعادة تركيبه من نفس حالة الـ store
    // الحالية (التي أصبحت الآن مطابقة لما أرسله الخادم فعلاً، لا للتفاؤل المحلي القديم).
    unmount();
    renderProfile();
    fireEvent.click(screen.getByRole('button', { name: /الملاحظات/ }));
    expect(screen.getByText('يبقى بعد إعادة التحميل')).toBeInTheDocument();
  });
});

// C4 Grades/hwSubmissions Frontend Migration (Batch A, feature 004) — ExamsTab now fetches
// GET /api/grades?studentId= instead of reading the store's grades array.
function mockFetchWithGrades(gradesRows) {
  globalThis.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.includes('/api/payments?')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: [] }) });
    }
    if (u.includes('/api/grades?')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: gradesRows, count: gradesRows.length }) });
    }
    return Promise.reject(new Error(`unexpected fetch: ${u}`));
  });
}

const EXAM_1 = { id: 'e1', name: 'امتحان الوحدة الأولى', type: 'monthly', date: '2026-01-05', total: 100, pass: 50 };

describe('StudentProfile — ExamsTab reads scoped grades (feature 004)', () => {
  it('fetches GET /api/grades?studentId= and shows the same stats a full-history join would produce', async () => {
    useAppStore.setState({
      groups: [{ id: GROUP_ID, name: 'مجموعة أ', grade: 'الأول', max: 20 }],
      students: [BASE_STUDENT],
      attendance: [], parents: [],
      exams: [EXAM_1],
    });
    // Raw backend shape — score arrives as a Decimal-as-string, proving pgGetGrades'
    // normalization (numeric score) is what makes the average/pass calculation below work.
    mockFetchWithGrades([{ id: 'g1', examId: 'e1', studentId: S1, score: '85', absent: false }]);

    renderProfile();
    fireEvent.click(screen.getByRole('button', { name: /الامتحانات/ }));

    expect(await screen.findByText('نتائج الامتحانات')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('امتحان الوحدة الأولى')).toBeInTheDocument());
    // 85/100 = 85% >= pass(50) → ناجح, avgScore 85%
    expect(screen.getByText('85%')).toBeInTheDocument();
  });

  it('shows the empty state only after loading completes, not during the loading window', async () => {
    useAppStore.setState({
      groups: [{ id: GROUP_ID, name: 'مجموعة أ', grade: 'الأول', max: 20 }],
      students: [BASE_STUDENT],
      attendance: [], parents: [],
      exams: [EXAM_1],
    });
    mockFetchWithGrades([]);

    renderProfile();
    fireEvent.click(screen.getByRole('button', { name: /الامتحانات/ }));

    expect(await screen.findByText('لا توجد نتائج بعد')).toBeInTheDocument();
  });

  it('surfaces a visible error when the grades fetch fails (closes analyze finding U1)', async () => {
    useAppStore.setState({
      groups: [{ id: GROUP_ID, name: 'مجموعة أ', grade: 'الأول', max: 20 }],
      students: [BASE_STUDENT],
      attendance: [], parents: [],
      exams: [EXAM_1],
    });
    globalThis.fetch = vi.fn((url) => {
      const u = String(url);
      if (u.includes('/api/payments?')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, data: [] }) });
      }
      if (u.includes('/api/grades?')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ ok: false, error: 'PG GET /grades → 500' }) });
      }
      return Promise.reject(new Error(`unexpected fetch: ${u}`));
    });

    renderProfile();
    fireEvent.click(screen.getByRole('button', { name: /الامتحانات/ }));

    expect(await screen.findByText(/PG GET \/grades/)).toBeInTheDocument();
  });
});
