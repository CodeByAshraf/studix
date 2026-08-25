// src/components/RouterNavigate.jsx
// ─────────────────────────────────────────────────────────────────────────────
// الجسر بين React Router وUIContext
//
// يحل مشكلة: UIContext موجود خارج BrowserRouter لكن useNavigate
// يجب أن يُستدعى داخله.
//
// الحل: هذا الـ component يعيش داخل BrowserRouter، يقرأ useNavigate
// ويُسجّله في UIContext عبر registerNavigate()
//
// يُستدعى مرة واحدة فقط في AppRoutes
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useUI } from '../store/ui.context';

export default function RouterNavigate() {
  const rrNavigate     = useNavigate();
  const location       = useLocation();
  const { registerNavigate, syncFromUrl } = useUI();

  // سجّل React Router navigate في UIContext عند أول render
  useEffect(() => {
    registerNavigate(rrNavigate);
  }, [registerNavigate, rrNavigate]);

  // مزامنة URL → currentPage عند Back/Forward
  useEffect(() => {
    syncFromUrl(location.pathname);
  }, [location.pathname, syncFromUrl]);

  return null; // لا يعرض شيئاً — مجرد side effects
}
