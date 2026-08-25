// src/modules/student-report/WhatsappPreviewModal.jsx
// ─────────────────────────────────────────────────────────────────────────────
// مكوّن معاينة رسالة واتساب — عرض/نسخ/فتح/إلغاء فقط. لا منطق أعمال.
// كل الحسابات تأتي جاهزة من studentWhatsappService عبر props.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';

export default function WhatsappPreviewModal({ studentName, parentPhone, message, onCopy, onOpen, onClose }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await onCopy(message);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const hasPhone = !!parentPhone;

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal}>
        {/* رأس */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: '1rem' }}>📲 معاينة رسالة ولي الأمر</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', fontSize: 20, cursor: 'pointer', color: 'var(--text3)' }}>✕</button>
        </div>

        {/* بيانات */}
        <div style={{ display: 'flex', gap: 14, fontSize: '0.8rem', marginBottom: 12, padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8 }}>
          <span>الطالب: <strong>{studentName}</strong></span>
          <span style={{ direction: 'ltr' }}>
            الهاتف: <strong>{hasPhone ? parentPhone : '—'}</strong>
          </span>
        </div>

        {!hasPhone && (
          <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,.1)', color: 'var(--red)', borderRadius: 8, fontSize: '0.78rem', marginBottom: 12 }}>
            ⚠ لا يوجد رقم هاتف لولي الأمر — يمكنك نسخ الرسالة وإرسالها يدوياً.
          </div>
        )}

        {/* معاينة الرسالة (قابلة للتمرير) */}
        <div style={{
          maxHeight: 340, overflowY: 'auto', whiteSpace: 'pre-wrap',
          direction: 'rtl', textAlign: 'right',
          background: '#e7f7ee', border: '1px solid #b7e4c7', borderRadius: 12,
          padding: '14px 16px', fontSize: '0.85rem', lineHeight: 1.7, color: '#0f172a',
        }}>
          {message}
        </div>

        {/* أزرار */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={btnSec}>❌ إلغاء</button>
          <button onClick={handleCopy} style={btnCopy}>{copied ? '✓ تم النسخ' : '📋 نسخ الرسالة'}</button>
          <button onClick={onOpen} disabled={!hasPhone} style={{ ...btnWa, opacity: hasPhone ? 1 : 0.5, cursor: hasPhone ? 'pointer' : 'not-allowed' }}>
            📲 فتح واتساب
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 };
const modal = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: 480, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', fontFamily: 'Cairo, sans-serif' };
const btnBase = { padding: '9px 18px', borderRadius: 9, fontFamily: 'Cairo, sans-serif', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', border: 'none' };
const btnSec = { ...btnBase, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)' };
const btnCopy = { ...btnBase, background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' };
const btnWa = { ...btnBase, background: '#25D366', color: '#fff' };
