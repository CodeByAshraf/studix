// src/modules/communication/components/TaskFormModal.jsx
// ─────────────────────────────────────────────────────────────────────────────
// مودال إضافة مهمة متابعة يدوية.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { Priority } from '../constants';
import { PRIORITY_META } from '../displayMeta';

export default function TaskFormModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    title: '',
    dueDate: '',
    dueTime: '',
    priority: Priority.NORMAL,
  });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal}>
        <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 16 }}>مهمة متابعة جديدة</div>

        <Field label="عنوان المهمة *">
          <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="مثال: الاتصال بولي أمر أحمد" style={input} autoFocus />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="تاريخ الاستحقاق *">
            <input type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} style={input} />
          </Field>
          <Field label="الوقت">
            <input type="time" value={form.dueTime} onChange={(e) => set('dueTime', e.target.value)} style={input} />
          </Field>
        </div>
        <Field label="الأولوية">
          <select value={form.priority} onChange={(e) => set('priority', e.target.value)} style={{ ...input, cursor: 'pointer' }}>
            {Object.entries(PRIORITY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Field>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onClose} style={btnSec}>إلغاء</button>
          <button onClick={() => onSave(form)} style={btnPri}>إضافة</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text3)', display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 };
const modal = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: 420, maxWidth: '94vw' };
const input = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', color: 'var(--text)', fontFamily: 'Cairo, sans-serif', fontSize: '0.82rem', direction: 'rtl' };
const btnPri = { padding: '9px 20px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'Cairo, sans-serif', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' };
const btnSec = { padding: '9px 20px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', fontFamily: 'Cairo, sans-serif', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' };
