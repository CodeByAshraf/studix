// src/modules/inventory/components/CountModal.jsx
// ─────────────────────────────────────────────────────────────────────────────
// مودال الجرد الفعلي — يُدخل الموظف الكمية المعدودة فعلياً على الرف،
// ويعرض النظام الفرق مع المحسوب قبل تسجيل التسوية التلقائية.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';

export default function CountModal({ material, systemQty, onClose, onSave }) {
  const [counted, setCounted] = useState('');
  const c = Number(counted);
  const hasValue = counted !== '' && !Number.isNaN(c);
  const diff = hasValue ? c - systemQty : 0;

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal}>
        <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 4 }}>📋 جرد فعلي</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text3)', marginBottom: 16 }}>{material.name} · {material.code}</div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1, textAlign: 'center', padding: '12px', background: 'var(--surface2)', borderRadius: 10 }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text3)' }}>المحسوب (النظام)</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--accent)' }}>{systemQty}</div>
          </div>
          <div style={{ flex: 1, textAlign: 'center', padding: '12px', background: 'var(--surface2)', borderRadius: 10 }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text3)' }}>الفرق</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: diff === 0 ? 'var(--text3)' : diff > 0 ? 'var(--green)' : 'var(--red)' }}>
              {hasValue ? (diff > 0 ? `+${diff}` : diff) : '—'}
            </div>
          </div>
        </div>

        <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text3)', display: 'block', marginBottom: 6 }}>الكمية المعدودة فعلياً</label>
        <input
          type="number"
          min="0"
          value={counted}
          onChange={(e) => setCounted(e.target.value)}
          placeholder="عُدّ الرف وأدخل العدد"
          style={input}
          autoFocus
        />
        {hasValue && diff !== 0 && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text3)', marginTop: 8, lineHeight: 1.6 }}>
            سيتم تسجيل تسوية تلقائية بمقدار {diff > 0 ? `زيادة ${diff}` : `عجز ${Math.abs(diff)}`} نسخة.
            لن تُعدّل الحركات السابقة.
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onClose} style={btnSecondary}>إلغاء</button>
          <button onClick={() => onSave(counted)} disabled={!hasValue} style={{ ...btnPrimary, opacity: hasValue ? 1 : 0.5 }}>تسجيل الجرد</button>
        </div>
      </div>
    </div>
  );
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 };
const modal = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: 420, maxWidth: '94vw' };
const input = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', color: 'var(--text)', fontFamily: 'Cairo, sans-serif', fontSize: '0.82rem', direction: 'rtl' };
const btnPrimary = { padding: '9px 20px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'Cairo, sans-serif', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' };
const btnSecondary = { padding: '9px 20px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', fontFamily: 'Cairo, sans-serif', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' };
