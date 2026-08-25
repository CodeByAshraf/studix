// src/modules/communication/components/ParentEditModal.jsx
// ─────────────────────────────────────────────────────────────────────────────
// مودال تعديل بيانات ولي الأمر الإضافية (هاتف بديل، تفضيلات، ملاحظات).
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { CommType } from '../constants';
import { PREFERRED_METHOD_META } from '../displayMeta';

export default function ParentEditModal({ parent, onClose, onSave, loading = false }) {
  const [form, setForm] = useState({
    altPhone: parent.altPhone || '',
    preferredMethod: parent.preferredMethod || '',
    preferredTime: parent.preferredTime || '',
    notes: parent.notes || '',
  });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // Phase 3B-16 Decision Needed #1: سجل بلا id حقيقي (لم يُطابَق بعد) وبلا هاتف
  // قابل للتطبيع (normalizedPhone) لا يمكن ربطه بصف parents حقيقي بأي شكل آمن —
  // لا مطابقة/إنشاء بالاسم إطلاقاً، ولا تخزين محلي مكرّر بديل. الحفظ مُعطَّل كلياً.
  const canSave = !!(parent.id || parent.normalizedPhone);

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal}>
        <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 4 }}>تعديل بيانات ولي الأمر</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text3)', marginBottom: 16 }}>{parent.parentName} · {parent.phone}</div>

        {!canSave && (
          <div style={noPhoneNotice}>
            ⚠ لا يوجد رقم هاتف صالح لهذا السجل — لا يمكن حفظ هذه البيانات في قاعدة البيانات
            بدون رقم هاتف يُمكن ربطه بولي أمر حقيقي.
          </div>
        )}

        <Field label="هاتف بديل">
          <input value={form.altPhone} onChange={(e) => set('altPhone', e.target.value)} placeholder="01xxxxxxxxx" style={input} dir="ltr" disabled={!canSave} />
        </Field>
        <Field label="طريقة التواصل المفضّلة">
          <select value={form.preferredMethod} onChange={(e) => set('preferredMethod', e.target.value)} style={{ ...input, cursor: canSave ? 'pointer' : 'not-allowed' }} disabled={!canSave}>
            <option value="">— غير محدّد —</option>
            {Object.entries(PREFERRED_METHOD_META).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </Field>
        <Field label="الوقت المفضّل للتواصل">
          <input value={form.preferredTime} onChange={(e) => set('preferredTime', e.target.value)} placeholder="مثال: بعد العصر" style={input} disabled={!canSave} />
        </Field>
        <Field label="ملاحظات">
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} style={{ ...input, resize: 'vertical' }} disabled={!canSave} />
        </Field>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onClose} style={btnSec} disabled={loading}>إلغاء</button>
          <button onClick={() => onSave(form)} style={{ ...btnPri, opacity: (!canSave || loading) ? .5 : 1, cursor: (!canSave || loading) ? 'not-allowed' : 'pointer' }} disabled={!canSave || loading}>
            {loading ? 'جارٍ الحفظ...' : 'حفظ'}
          </button>
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
const noPhoneNotice = { background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 9, padding: '9px 11px', color: 'var(--red)', fontSize: '0.76rem', fontFamily: 'Cairo, sans-serif', marginBottom: 14, lineHeight: 1.5 };
