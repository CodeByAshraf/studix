// src/modules/setup/SetupWizard.jsx
// INSTALL-04 — First-Run Setup wizard. Public route (/setup, outside ProtectedRoute), visually
// modeled directly on LoginScreen.jsx (same dark/glass card, Cairo font, RTL, teal accent) —
// no new visual language invented.
//
// No second auth system: on successful POST /api/setup, the backend already establishes the
// normal session cookie (signSession, same as POST /api/session) — but React's own auth state
// (AuthProvider) only ever changes through its existing login() method. Rather than reaching
// into AuthProvider's internals (out of this phase's allowed-file scope — auth.context.jsx is
// not one of the files INSTALL-04 may modify), this component simply calls the SAME login(id,
// password) the normal /login screen already uses, with the password still held in local
// component state. That call re-POSTs to /api/session (trivially succeeds — the password was
// just set) and is what actually flips isLoggedIn/currentUser — the exact existing mechanism,
// not a new one. The backend's own auto-login (already-set cookie) is what makes /setup usable
// even if this second round-trip were ever skipped; both together are simply "log in normally,
// automatically, right after creation."
//
// Fetches its own status/creation requests directly (not via services/api.js) — only
// PG_API_BASE is imported from there (a read-only constant), per this phase's scope boundary.
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../../store/auth.context';
import { PG_API_BASE } from '../../services/api';

const MIN_PASSWORD_LENGTH = 8; // matches backend/src/db/firstAdmin.js's own minimum

async function fetchSetupStatus() {
  try {
    const res = await fetch(`${PG_API_BASE}/api/setup/status`, {
      credentials: 'include',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { open: null };
    const json = await res.json();
    return { open: typeof json?.open === 'boolean' ? json.open : null };
  } catch {
    return { open: null };
  }
}

async function submitSetup({ name, id, password, confirmPassword }) {
  let res;
  try {
    res = await fetch(`${PG_API_BASE}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name, id, password, confirmPassword }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { ok: false, message: 'تعذّر الاتصال بالخادم. تحقّق من تشغيل خادم Studix وحاول مجدداً.' };
  }
  let json = null;
  try { json = await res.json(); } catch { /* استجابة بدون body */ }
  if (!res.ok) return { ok: false, message: json?.error || 'تعذّر إكمال الإعداد.' };
  return { ok: true };
}

function FullScreenMessage({ title, text, action }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center',
      background: '#070e1a', color: '#e2f8f6', fontFamily: 'Cairo, sans-serif', direction: 'rtl',
    }}>
      {title && <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{title}</div>}
      <div style={{ fontSize: '0.9rem', color: '#4a9994', maxWidth: 420 }}>{text}</div>
      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: 8, background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)',
            color: '#fff', border: 'none', borderRadius: 9, padding: '9px 20px',
            fontFamily: 'Cairo, sans-serif', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export default function SetupWizard() {
  const { isLoggedIn, login } = useAuth();
  const navigate = useNavigate();

  const [statusChecked, setStatusChecked] = useState(false);
  const [setupOpen, setSetupOpen] = useState(null);

  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const checkStatus = useCallback(async () => {
    setStatusChecked(false);
    const result = await fetchSetupStatus();
    setSetupOpen(result.open);
    setStatusChecked(true);
  }, []);

  useEffect(() => {
    if (isLoggedIn) return; // already logged in — no need to check, redirect handled below
    checkStatus();
  }, [isLoggedIn, checkStatus]);

  // بالفعل مسجَّل دخوله — لا معنى لعرض المعالج (يطابق سلوك /login نفسه في App.jsx).
  if (isLoggedIn) return <Navigate to="/" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim() || !id.trim() || !password.trim()) {
      setError('يرجى تعبئة جميع الحقول المطلوبة.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`كلمة المرور ${MIN_PASSWORD_LENGTH} أحرف على الأقل.`);
      return;
    }
    if (password !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين.');
      return;
    }

    setLoading(true);
    const result = await submitSetup({ name: name.trim(), id: id.trim(), password, confirmPassword });
    if (!result.ok) {
      setError(result.message);
      setLoading(false);
      return;
    }

    // الحساب أُنشئ فعلياً على الخادم بنجاح من هنا فصاعداً — أي فشل في الخطوة التالية
    // (تسجيل الدخول التلقائي) يُوجَّه لصفحة الدخول العادية بدل تعليق المستخدم هنا.
    const loginResult = await login(id.trim(), password);
    if (!loginResult?.success) {
      navigate('/login', { replace: true });
      return;
    }
    navigate('/', { replace: true });
  };

  if (!statusChecked) {
    return <FullScreenMessage text="جاري التحقّق من حالة الإعداد..." />;
  }

  if (setupOpen === null) {
    return (
      <FullScreenMessage
        title="تعذّر الاتصال بالخادم"
        text="تعذّر التحقّق من حالة الإعداد الأولي — تحقّق من تشغيل خادم Studix وحاول مجدداً."
        action={{ label: 'إعادة المحاولة', onClick: checkStatus }}
      />
    );
  }

  if (setupOpen === false) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', background: '#070e1a', fontFamily: 'Cairo, sans-serif',
      direction: 'rtl', overflow: 'hidden', position: 'relative',
    }}>
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'linear-gradient(rgba(13,148,136,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(13,148,136,0.04) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }} />
        <div style={{ position: 'absolute', top: '-10%', right: '-5%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(13,148,136,.12) 0%, transparent 70%)', filter: 'blur(40px)' }} />
        <div style={{ position: 'absolute', bottom: '-5%', left: '-10%', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(59,130,246,.08) 0%, transparent 70%)', filter: 'blur(60px)' }} />
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', position: 'relative', zIndex: 1 }}>
        <div style={{ width: '100%', maxWidth: 460 }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{
              width: 72, height: 72, borderRadius: 20, margin: '0 auto 20px',
              background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 50%, #065f52 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 0 1px rgba(13,148,136,.3), 0 20px 60px rgba(13,148,136,.25), 0 0 80px rgba(13,148,136,.1)',
              position: 'relative',
            }}>
              <span style={{ fontFamily: 'Cairo, sans-serif', fontWeight: 900, fontSize: 22, color: '#fff', letterSpacing: -1 }}>Sx</span>
              <div style={{ position: 'absolute', inset: -3, borderRadius: 23, border: '1px solid rgba(13,148,136,.2)' }} />
            </div>
            <div style={{ fontFamily: 'Cairo, sans-serif', fontSize: 30, fontWeight: 900, color: '#f0fdfa', letterSpacing: -1.5, lineHeight: 1, marginBottom: 8 }}>
              Studix
            </div>
            <div style={{ fontFamily: 'Cairo, sans-serif', fontSize: 12, fontWeight: 500, color: '#0d9488', letterSpacing: 3, textTransform: 'uppercase' }}>
              الإعداد الأولي
            </div>
          </div>

          <div style={{
            background: 'rgba(15, 32, 64, 0.8)', border: '1px solid rgba(30, 58, 110, 0.6)',
            borderRadius: 20, padding: '32px 28px', backdropFilter: 'blur(20px)',
            boxShadow: '0 8px 40px rgba(0,0,0,.4), 0 0 0 1px rgba(13,148,136,.08)',
          }}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#e2f8f6', marginBottom: 4 }}>
                إنشاء حساب المدير الأول
              </div>
              <div style={{ fontSize: 13, color: '#4a9994' }}>
                هذه الخطوة تظهر مرة واحدة فقط عند أول تشغيل لـ Studix
              </div>
            </div>

            <form onSubmit={handleSubmit} noValidate>
              <FormField label="الاسم الكامل">
                <TextInput value={name} onChange={setName} placeholder="مدير النظام" autoComplete="name" />
              </FormField>

              <FormField label="اسم المستخدم">
                <TextInput value={id} onChange={setId} placeholder="admin" autoComplete="username" />
              </FormField>

              <FormField label="كلمة المرور">
                <PasswordInput value={password} onChange={setPassword} showPass={showPass} setShowPass={setShowPass} autoComplete="new-password" />
              </FormField>

              <FormField label="تأكيد كلمة المرور" marginBottom={24}>
                <PasswordInput value={confirmPassword} onChange={setConfirmPassword} showPass={showPass} setShowPass={setShowPass} autoComplete="new-password" />
              </FormField>

              {error && (
                <div style={{
                  padding: '10px 14px', marginBottom: 16, borderRadius: 9,
                  background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)',
                  color: '#ef4444', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
                }} role="alert">
                  ⚠️ {error}
                </div>
              )}

              <button type="submit" disabled={loading}
                style={{
                  width: '100%', padding: '13px', borderRadius: 10, border: 'none',
                  background: loading ? 'rgba(13,148,136,.5)' : 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)',
                  color: '#fff', fontFamily: 'Cairo, sans-serif', fontSize: 15, fontWeight: 800,
                  cursor: loading ? 'wait' : 'pointer', transition: 'all .2s',
                  boxShadow: loading ? 'none' : '0 4px 20px rgba(13,148,136,.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {loading ? (
                  <>
                    <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', animation: 'spin .7s linear infinite', display: 'inline-block' }} />
                    جارٍ الإنشاء...
                  </>
                ) : (
                  <>إنشاء الحساب والمتابعة <span style={{ fontFamily: 'monospace' }}>→</span></>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;900&display=swap');
      `}</style>
    </div>
  );
}

function FormField({ label, children, marginBottom = 16 }) {
  return (
    <div style={{ marginBottom }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#4a9994', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 7 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const fieldInputStyle = {
  width: '100%', padding: '11px 13px', background: 'rgba(10, 22, 40, 0.8)',
  border: '1px solid rgba(30,58,110,.8)', borderRadius: 10, color: '#e2f8f6',
  fontFamily: 'Cairo, sans-serif', fontSize: 14, outline: 'none', direction: 'rtl',
  transition: 'border-color .15s, box-shadow .15s', boxSizing: 'border-box',
};

function TextInput({ value, onChange, placeholder, autoComplete }) {
  return (
    <input
      value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      autoComplete={autoComplete}
      style={fieldInputStyle}
      onFocus={(e) => { e.target.style.borderColor = '#0d9488'; e.target.style.boxShadow = '0 0 0 3px rgba(13,148,136,.12)'; }}
      onBlur={(e) => { e.target.style.borderColor = 'rgba(30,58,110,.8)'; e.target.style.boxShadow = 'none'; }}
    />
  );
}

function PasswordInput({ value, onChange, showPass, setShowPass, autoComplete }) {
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={showPass ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="••••••••" autoComplete={autoComplete}
        style={{ ...fieldInputStyle, padding: '11px 40px 11px 13px' }}
        onFocus={(e) => { e.target.style.borderColor = '#0d9488'; e.target.style.boxShadow = '0 0 0 3px rgba(13,148,136,.12)'; }}
        onBlur={(e) => { e.target.style.borderColor = 'rgba(30,58,110,.8)'; e.target.style.boxShadow = 'none'; }}
      />
      <button type="button" onClick={() => setShowPass((p) => !p)} aria-label={showPass ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
        style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', color: '#4a9994', padding: 0 }}>
        {showPass ? '🙈' : '👁'}
      </button>
    </div>
  );
}
