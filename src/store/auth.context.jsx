// src/store/auth.context.jsx
import {
  createContext, useContext, useState, useCallback, useMemo, useEffect,
} from 'react';
import { INITIAL_TEACHERS } from '../data/initialData';
import { pgLogin, pgLogout, BackendUnreachableError } from '../services/api';
import { AUTH_CONFIG } from '../config/app.config';
import { storage } from '../hooks/useErrorHandler';

// Stabilization phase (Decision 6/Correction — Identity Reconciliation): PostgreSQL
// هو مصدر الحقيقة الوحيد لـ users/roles/permissions الآن. لا مزيد من
// localStorage['studix-auth-users']/['studix-auth-roles'] — أُزيلا بالكامل، لا
// fallback محلي/offline للدخول بعد الآن (كان يعتمد على نفس البيانات المُزالة).
// 'teachers' يبقى محلياً تماماً كما كان (نطاق مدرّسين منفصل، خارج هذه المرحلة).
const MAX_ATTEMPTS = AUTH_CONFIG.MAX_LOGIN_ATTEMPTS;
const LOCKOUT_MS   = AUTH_CONFIG.LOCKOUT_MS;
const ATTEMPTS_KEY = AUTH_CONFIG.ATTEMPTS_STORAGE_KEY;

function getAttempts(userId) {
  const data = storage.get(ATTEMPTS_KEY, {});
  return data[userId] || { count: 0, lastAt: 0, lockedUntil: 0 };
}
function recordFailedAttempt(userId) {
  const data    = storage.get(ATTEMPTS_KEY, {});
  const current = data[userId] || { count: 0, lastAt: 0, lockedUntil: 0 };
  const now     = Date.now();
  const newCount = current.count + 1;
  data[userId]  = {
    count:       newCount,
    lastAt:      now,
    lockedUntil: newCount >= MAX_ATTEMPTS ? now + LOCKOUT_MS : current.lockedUntil,
  };
  storage.set(ATTEMPTS_KEY, data);
  return data[userId];
}
function clearAttempts(userId) {
  const data = storage.get(ATTEMPTS_KEY, {});
  delete data[userId];
  storage.set(ATTEMPTS_KEY, data);
}

const SESSION_KEY = AUTH_CONFIG.SESSION_KEY;
function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function saveSession(safeUser) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(safeUser)); } catch {}
}
function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

const AuthContext = createContext(null);

export function AuthProvider({ children, onLogin }) {
  const savedSession = loadSession();

  const [isLoggedIn,  setIsLoggedIn]  = useState(!!savedSession);
  const [currentUser, setCurrentUser] = useState(savedSession);
  // Teachers فقط يبقى محلياً — نطاق منفصل (Teachers domain)، لا علاقة له بهذه المرحلة.
  const [teachers, setTeachers] = useState(() => {
    try {
      const saved = localStorage.getItem('studix-auth-teachers');
      return saved ? JSON.parse(saved) : INITIAL_TEACHERS;
    } catch { return INITIAL_TEACHERS; }
  });

  const isAdmin = useMemo(
    () => !!(currentUser?.role === 'admin' || currentUser?.isAdmin),
    [currentUser],
  );

  // canAccess: للاسترشاد بالواجهة فقط (إخفاء/إظهار عناصر التنقّل) — التفويض
  // الفعلي والمُعتمَد يُفحَص حصراً على الخادم (requirePermission) في كل طلب.
  // permissions هنا هي المصفوفة الفعّالة التي أعادها الخادم عند تسجيل الدخول
  // (بعد تطبيق نفس منطق: تجاوز شخصي > صلاحيات الدور > فارغة) — لا حساب محلي
  // مبنيّ على INITIAL_ROLES بعد الآن.
  const canAccess = useCallback((pageId) => {
    if (!currentUser || currentUser.active === false) return false;
    return Array.isArray(currentUser.permissions) && currentUser.permissions.includes(pageId);
  }, [currentUser]);

  // ── Persist teachers فقط (users/roles أُزيلا — انظر التعليق أعلى الملف) ──
  useEffect(() => {
    try { localStorage.setItem('studix-auth-teachers', JSON.stringify(teachers)); } catch {}
  }, [teachers]);

  const login = useCallback(async (userId, password) => {
    const attempts = getAttempts(userId);
    if (attempts.lockedUntil > Date.now()) {
      const remaining = Math.ceil((attempts.lockedUntil - Date.now()) / 60000);
      return { success: false, message: `الحساب مُقفَل مؤقتاً — حاول بعد ${remaining} دقيقة` };
    }

    // PostgreSQL هو المصدر الوحيد للهوية الآن — لا فحص محلي/offline بديل بعد
    // إزالة studix-auth-users (Decision 6). لو الخادم غير متاح فعلياً (شبكة/تشغيل)،
    // هذا فشل حقيقي يُعرَض للمستخدم صراحة، لا يُستبدَل بمسار محلي صامت.
    let backendResult;
    try {
      backendResult = await pgLogin(userId, password);
    } catch (err) {
      if (err instanceof BackendUnreachableError) {
        return { success: false, message: 'تعذّر الاتصال بالخادم. تحقّق من الاتصال وحاول مجدداً.' };
      }
      throw err;
    }

    if (!backendResult.ok) {
      const updated = recordFailedAttempt(userId);
      const left    = MAX_ATTEMPTS - updated.count;
      if (left <= 0)
        return { success: false, message: 'كلمة المرور خاطئة — تم قفل الحساب لمدة 15 دقيقة' };
      return { success: false, message: `كلمة المرور غير صحيحة (${left} محاولة متبقية)` };
    }

    clearAttempts(userId);
    // الهوية والصلاحيات المعتمَدة تأتي حصراً من استجابة الخادم.
    const safeUser = {
      id: backendResult.user.id,
      name: backendResult.user.name,
      role: backendResult.user.role,
      active: backendResult.user.active,
      permissions: backendResult.user.permissions,
      isAdmin: backendResult.user.role === 'admin',
      authSource: 'backend',
    };
    setCurrentUser(safeUser);
    setIsLoggedIn(true);
    saveSession(safeUser);
    onLogin?.({ userId: safeUser.id, userName: safeUser.name || safeUser.id });
    // name مُعاد هنا أيضاً صراحة — استدعاء login() لا يرى currentUser المحدَّث في
    // نفس اللفّة (تحديث state غير متزامن)، فأي مستهلك يحتاج الاسم فوراً بعد نجاح
    // الدخول (سجل النشاط مثلاً) يقرأه من نتيجة login() مباشرة، لا من currentUser.
    return { success: true, name: safeUser.name };
  }, [onLogin]);

  const logout = useCallback((onLogout) => {
    onLogout?.({ userId: currentUser?.id });
    pgLogout(); // best-effort — يمسح كوكي جلسة الـ backend أيضاً لو كانت موجودة
    setIsLoggedIn(false);
    setCurrentUser(null);
    clearSession();
  }, [currentUser]);

  const value = useMemo(() => ({
    isLoggedIn,
    currentUser,
    isAdmin,
    canAccess,
    login,
    logout,
    loading: false,
    teachers,
    setTeachers,
  }), [
    isLoggedIn, currentUser, isAdmin, canAccess,
    login, logout,
    teachers,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export default AuthContext;
