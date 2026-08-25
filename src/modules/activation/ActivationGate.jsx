// src/modules/activation/ActivationGate.jsx
// Phase 5c — Activation gate. Wraps the entire authenticated app shell (mounted once,
// high in App.jsx, around <DBInit><AppRoutes/></DBInit>) and decides whether to render the
// real app or a full-screen "Studix requires activation" gate instead. Never gates the
// login screen itself — passes children through unconditionally while isLoggedIn is false,
// since normal login must keep working on an unactivated installation.
//
// The backend is the sole authority: every render decision here comes from a fresh network
// call (pgGetLicenseStatus for admins, pgProbeActivation for everyone else — see
// services/api.js's own comments for why the split exists), never from a cached/assumed
// client-side flag. Re-checks automatically on login/logout/user-switch (isLoggedIn/
// currentUser?.id in the effect's own dependencies, independent of runCheck's identity) and
// whenever ActivationScreen reports a successful activation (onActivated => runCheck()).
import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../store/auth.context';
import { pgGetLicenseStatus, pgProbeActivation } from '../../services/api';
import ActivationScreen from './ActivationScreen';

// SUPPORT_ACCESS_PATH: exempted from the gate for the exact same reason the backend
// allowlists /api/support-access in requireActivation (middleware/activation.js) — an
// unactivated installation is precisely the kind of stuck state Support Access exists to
// repair. Without this, the gate would make Support Access's own page unreachable through
// the UI even though the backend keeps it fully open, defeating its purpose. This is the
// ONLY path exempted here — everything else the app renders stays gated.
const SUPPORT_ACCESS_PATH = '/support-access';

function FullScreenMessage({ title, text, action }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center',
      background: 'var(--bg)', color: 'var(--text)', fontFamily: 'Cairo, sans-serif', direction: 'rtl',
    }}>
      {title && <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{title}</div>}
      <div style={{ fontSize: '0.9rem', color: 'var(--text2)', maxWidth: 420 }}>{text}</div>
      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: 8, background: 'var(--accent)', color: '#fff', border: 'none',
            borderRadius: 9, padding: '9px 20px', fontFamily: 'Cairo, sans-serif',
            fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export default function ActivationGate({ children }) {
  const { isLoggedIn, isAdmin, currentUser, logout } = useAuth();
  const location = useLocation();
  // phase: checking | unreachable | blocked | activated
  const [state, setState] = useState({ phase: 'checking', status: null });

  const runCheck = useCallback(async () => {
    setState({ phase: 'checking', status: null });

    if (isAdmin) {
      try {
        const status = await pgGetLicenseStatus();
        setState({ phase: status.activated ? 'activated' : 'blocked', status });
      } catch {
        setState({ phase: 'unreachable', status: null });
      }
      return;
    }

    const probe = await pgProbeActivation();
    if (probe.blocked === null) {
      setState({ phase: 'unreachable', status: null });
    } else {
      setState({ phase: probe.blocked ? 'blocked' : 'activated', status: null });
    }
  }, [isAdmin]);

  // يُعاد الفحص عند كل تغيّر فعلي في هوية المستخدم المسجَّل (تسجيل دخول/خروج/تبديل
  // مستخدم بنفس الدور) — currentUser?.id مُدرَجة صراحةً هنا (لا فقط داخل deps الخاصة
  // بـ runCheck) حتى تُعاد المحاولة أيضاً عند تبديل مستخدمَين بنفس isAdmin بالضبط.
  useEffect(() => {
    if (!isLoggedIn) return;
    runCheck();
  }, [isLoggedIn, currentUser?.id, runCheck]);

  if (!isLoggedIn) return children;
  if (location.pathname === SUPPORT_ACCESS_PATH) return children;

  if (state.phase === 'checking') {
    return <FullScreenMessage text="جاري التحقّق من حالة التفعيل..." />;
  }

  if (state.phase === 'unreachable') {
    return (
      <FullScreenMessage
        title="تعذّر الاتصال بالخادم"
        text="تعذّر التحقّق من حالة التفعيل — تحقّق من تشغيل خادم Studix وحاول مجدداً."
        action={{ label: 'إعادة المحاولة', onClick: runCheck }}
      />
    );
  }

  if (state.phase === 'blocked') {
    return (
      <ActivationScreen
        isAdmin={isAdmin}
        status={state.status}
        onActivated={runCheck}
        onLogout={logout}
      />
    );
  }

  return children; // activated
}
