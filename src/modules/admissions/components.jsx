// src/modules/admissions/components.jsx
// مكوّنات واجهة صغيرة قابلة لإعادة الاستخدام داخل صفحة التسجيل والقبول.
import { initials, avatarColor } from './mockData';

// شارة ملوّنة
export function Badge({ label, color }) {
  return (
    <span style={{
      display: 'inline-block', fontSize: '0.72rem', fontWeight: 700,
      padding: '3px 11px', borderRadius: 99, color,
      background: `${color}14`, border: `1px solid ${color}33`,
      whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

// صورة رمزية بالأحرف الأولى
export function Avatar({ name, size = 40 }) {
  const c = avatarColor(name);
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: c.bg, color: c.fg, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 800, fontSize: size * 0.36, fontFamily: 'Cairo,sans-serif',
    }}>{initials(name)}</div>
  );
}

// بطاقة إحصائية
export function StatCard({ icon, label, value, color, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, minWidth: 140, textAlign: 'right', cursor: 'pointer',
      background: active ? `${color}0d` : 'var(--surface)',
      border: `1px solid ${active ? `${color}55` : 'var(--border)'}`,
      borderRadius: 14, padding: '16px 18px', transition: 'all .15s',
      fontFamily: 'Cairo,sans-serif', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 10, background: `${color}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19,
      }}>{icon}</div>
      <div>
        <div style={{ fontSize: '1.6rem', fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text3)', fontWeight: 600, marginTop: 2 }}>{label}</div>
      </div>
    </button>
  );
}

// حقل نموذج
export function Field({ label, required, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text3)', marginBottom: 6 }}>
        {label} {required && <span style={{ color: 'var(--red)' }}>*</span>}
      </label>
      {children}
    </div>
  );
}

// أنماط الإدخال المشتركة
export const inputStyle = {
  width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)',
  borderRadius: 9, padding: '9px 12px', color: 'var(--text)',
  fontFamily: 'Cairo,sans-serif', fontSize: '0.85rem', outline: 'none', direction: 'rtl',
};
