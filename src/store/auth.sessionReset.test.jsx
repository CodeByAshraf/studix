// src/store/auth.sessionReset.test.jsx
// BUG-04 — stale cross-session financial/business data leak via un-cleared
// localStorage['studix-v1'] on logout. Zustand's `persist` middleware cached
// payments/treasuryTxn/students/etc. across the session boundary; logout() never
// cleared it, and db.middleware.js's loadFromPostgres explicitly never overwrites a
// collection on a failed/403 fetch ("لا نلمس" — don't touch). On a shared front-desk
// computer, a less-privileged user logging in after a more-privileged one could still
// see the previous user's real financial data, rendered straight from the stale store
// (Dashboard.jsx's revenue KPI is a concretely-demonstrated instance — gated only by the
// 'dashboard' permission, never by 'payments'/'treasury').
//
// Fix: resetAppStore() (app.store.js) is now called from both session-boundary points in
// auth.context.jsx (logout, and right before the post-login resync) — a single centralized
// mechanism, not ad-hoc per-screen guards. This test exercises the real login()/logout()
// functions against a mocked backend (services/api.js), asserting on the real useAppStore
// contents — not a re-implementation of the fix's logic.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AuthProvider, useAuth } from './auth.context';
import { useAppStore } from './app.store';

// محاكاة حالة صلاحية الجلسة على الخادم — نفس الدور الذي يلعبه كوكي الجلسة الموقّع
// حقيقياً (credentials:'include')، لكن كمتغيّر اختبار بسيط بما أن pgGetCollection لا
// تستقبل أي معرّف هوية صراحةً كوسيط.
let serverSessionUserId = null;

const USERS = {
  'admin-a':   { id: 'admin-a',   name: 'Admin A',   role: 'admin', active: true, permissions: ['dashboard', 'payments', 'treasury', 'groups', 'students'] },
  'teacher-b': { id: 'teacher-b', name: 'Teacher B', role: 'user',  active: true, permissions: ['dashboard', 'groups', 'students'] },
};

const PERMISSION_FOR_COLLECTION = { payments: 'payments', treasuryTxn: 'treasury' };

const COLLECTION_DATA = {
  payments:    [{ id: 'p1', studentId: 's1', groupId: 'g1', amount: 1000, month: 1, year: 2026, status: 'paid', date: '2026-01-01' }],
  treasuryTxn: [{ id: 'tt1', cashboxId: 'cb1', type: 'income', amount: 1000, status: 'active', category: 'subscriptions', date: '2026-01-01' }],
  students:    [{ id: 's1', name: 'طالب أ', status: 'active', groupId: 'g1' }],
  groups:      [{ id: 'g1', name: 'مجموعة أ' }],
};

vi.mock('../services/api', async () => {
  const actual = await vi.importActual('../services/api');
  return {
    ...actual,
    pgLogin: vi.fn(async (id, password) => {
      const user = USERS[id];
      if (!user || password !== 'correct-pw') return { ok: false, status: 401 };
      serverSessionUserId = id;
      return { ok: true, user };
    }),
    pgLogout: vi.fn(async () => { serverSessionUserId = null; }),
    pgCheckHealth: vi.fn(async () => ({ ok: true, tableCount: 10, connection: 'ok' })),
    pgGetCollection: vi.fn(async (name) => {
      const user = USERS[serverSessionUserId];
      const requiredPerm = PERMISSION_FOR_COLLECTION[name];
      if (requiredPerm && (!user || !user.permissions.includes(requiredPerm))) {
        throw new Error(`PG GET /${name} → 403`);
      }
      return COLLECTION_DATA[name] || [];
    }),
  };
});

function Harness() {
  const { login, logout, currentUser } = useAuth();
  return (
    <div>
      <div data-testid="current-user">{currentUser?.id || 'none'}</div>
      <button onClick={() => login('admin-a', 'correct-pw')}>login-admin</button>
      <button onClick={() => login('teacher-b', 'correct-pw')}>login-teacher</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

function renderHarness() {
  return render(<AuthProvider><Harness/></AuthProvider>);
}

function emptyBusinessData() {
  return { students: [], groups: [], payments: [], treasuryTxn: [], attendance: [], admissions: [] };
}

beforeEach(() => {
  serverSessionUserId = null;
  sessionStorage.clear();
  useAppStore.setState(emptyBusinessData());
  vi.clearAllMocks();
});

describe('BUG-04 — session-boundary reset (real login()/logout() against a mocked backend)', () => {
  it('Admin A logs in and receives their own permitted financial data', async () => {
    renderHarness();
    fireEvent.click(screen.getByText('login-admin'));

    await waitFor(() => expect(screen.getByTestId('current-user')).toHaveTextContent('admin-a'));
    await waitFor(() => expect(useAppStore.getState().payments).toHaveLength(1));
    expect(useAppStore.getState().treasuryTxn).toHaveLength(1);
  });

  it('logging out clears financial/business data immediately, synchronously with logout() itself', async () => {
    renderHarness();
    fireEvent.click(screen.getByText('login-admin'));
    await waitFor(() => expect(useAppStore.getState().payments).toHaveLength(1));

    act(() => { fireEvent.click(screen.getByText('logout')); });

    // مزامَن (resetAppStore يُستدعى مباشرة داخل logout()، لا ينتظر أي شيء) — يجب أن
    // يكون فارغاً فوراً، لا بعد انتظار غير محدَّد.
    expect(useAppStore.getState().payments).toEqual([]);
    expect(useAppStore.getState().treasuryTxn).toEqual([]);
    expect(useAppStore.getState().students).toEqual([]);
  });

  it('the failure scenario: Teacher B (no payments/treasury permission) logging in after Admin A never sees Admin A\'s stale financial data, but does receive their own legitimately-permitted data (students/groups)', async () => {
    renderHarness();

    // Admin A: يملك صلاحيات payments/treasury، يسجّل دخول، تُحمَّل بياناته.
    fireEvent.click(screen.getByText('login-admin'));
    await waitFor(() => expect(useAppStore.getState().payments).toHaveLength(1));
    expect(useAppStore.getState().treasuryTxn).toHaveLength(1);

    // Admin A يسجّل خروج.
    act(() => { fireEvent.click(screen.getByText('logout')); });
    expect(useAppStore.getState().payments).toEqual([]);

    // Teacher B: لا يملك payments/treasury، يسجّل دخول على نفس المتصفح.
    fireEvent.click(screen.getByText('login-teacher'));
    await waitFor(() => expect(screen.getByTestId('current-user')).toHaveTextContent('teacher-b'));

    // بيانات Teacher B الفعلياً مسموح بها (students/groups) تصل بنجاح...
    await waitFor(() => expect(useAppStore.getState().students).toHaveLength(1));
    expect(useAppStore.getState().groups).toHaveLength(1);

    // ...لكن payments/treasuryTxn تبقيان فارغتين تماماً — لا بيانات Admin A المتبقية
    // ظهرت أبداً، حتى مؤقتاً، رغم أن جلبهما فشل (403) تماماً كما يفشل في db.middleware.js
    // الحقيقي (لا يُعاد لمسهما عند الفشل — لكن الآن يبدآن أصلاً من [] بعد المسح، لا من
    // بيانات Admin A القديمة).
    expect(useAppStore.getState().payments).toEqual([]);
    expect(useAppStore.getState().treasuryTxn).toEqual([]);
  });

  it('normal logout then re-login as the SAME user still works end-to-end (no regression to the ordinary flow)', async () => {
    renderHarness();

    fireEvent.click(screen.getByText('login-admin'));
    await waitFor(() => expect(useAppStore.getState().payments).toHaveLength(1));

    act(() => { fireEvent.click(screen.getByText('logout')); });
    expect(screen.getByTestId('current-user')).toHaveTextContent('none');

    fireEvent.click(screen.getByText('login-admin'));
    await waitFor(() => expect(screen.getByTestId('current-user')).toHaveTextContent('admin-a'));
    await waitFor(() => expect(useAppStore.getState().payments).toHaveLength(1));
    expect(useAppStore.getState().treasuryTxn).toHaveLength(1);
  });

  it('an ordinary refresh for the SAME still-logged-in user does not destroy legitimate persisted state (resetAppStore is only ever called from login()/logout(), never on mount)', async () => {
    // يحاكي حالة ما بعد إعادة تحميل حقيقية: sessionStorage لا يزال يحمل جلسة صالحة،
    // وuseAppStore يحمل بيانات حقيقية استُرجِعت بالفعل من localStorage['studix-v1']
    // المُستمرّ (rehydrate) — لا استدعاء لـ login()/logout() هنا إطلاقاً.
    sessionStorage.setItem('tc_session', JSON.stringify(USERS['admin-a']));
    useAppStore.setState({
      students: COLLECTION_DATA.students,
      groups: COLLECTION_DATA.groups,
      payments: COLLECTION_DATA.payments,
      treasuryTxn: COLLECTION_DATA.treasuryTxn,
    });

    renderHarness();

    // AuthProvider يقرأ الجلسة المحفوظة فوراً (useState(savedSession)) بلا أي مسح.
    await waitFor(() => expect(screen.getByTestId('current-user')).toHaveTextContent('admin-a'));
    expect(useAppStore.getState().payments).toHaveLength(1);
    expect(useAppStore.getState().treasuryTxn).toHaveLength(1);
    expect(useAppStore.getState().students).toHaveLength(1);
  });
});
