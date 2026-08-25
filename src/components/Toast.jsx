// src/components/Toast.jsx
import { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext(null);

let _toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const add = useCallback((message, type = 'info', duration = 5000) => {
    const id = ++_toastId;
    setToasts(prev => [...prev, { id, message, type }]);
    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, duration);
    }
    return id;
  }, []);

  const remove = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = {
    success: (msg, dur) => add(msg, 'success', dur),
    error:   (msg, dur) => add(msg, 'error',   dur ?? 8000),
    warning: (msg, dur) => add(msg, 'warning', dur),
    info:    (msg, dur) => add(msg, 'info',    dur),
  };

  const icons = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span style={{ fontSize:16, flexShrink:0 }}>{icons[t.type]}</span>
            <span style={{ flex:1, lineHeight:1.5 }}>{t.message}</span>
            <button
              onClick={() => remove(t.id)}
              style={{ opacity:.6, fontSize:16, cursor:'pointer', background:'none',
                border:'none', color:'inherit', flexShrink:0 }}>×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
