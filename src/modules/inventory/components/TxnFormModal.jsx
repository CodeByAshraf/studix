// src/modules/inventory/components/TxnFormModal.jsx
// ─────────────────────────────────────────────────────────────────────────────
// مودال تسجيل حركة مخزون. يعرض المخزون الحالي والمتاح للإرشاد.
// التسوية (adjustment) تقبل قيمة موجبة أو سالبة.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { TxnType, TXN_DIRECTION, TxnDirection } from '../constants';
import { TXN_TYPE_META } from '../displayMeta';

export default function TxnFormModal({ material, currentStock, available, onClose, onSave }) {
  const [form, setForm] = useState({
    type: TxnType.PRINTING,
    quantity: '',
    date: new Date().toISOString().split('T')[0],
    reason: '',
    notes: '',
    batchNo: '',
    printVendor: '',
    unitCost: '',
    recipient: '',
  });

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const dir = TXN_DIRECTION[form.type];
  const isAdjustment = dir === TxnDirection.NEUTRAL;
  const isPrinting = form.type === TxnType.PRINTING || form.type === TxnType.PURCHASE;
  const isDelivery = form.type === TxnType.STUDENT_DELIVERY;

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal}>
        <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 4 }}>تسجيل حركة مخزون</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text3)', marginBottom: 4 }}>{material.name} · {material.code}</div>
        <div style={{ display: 'flex', gap: 14, fontSize: '0.75rem', marginBottom: 16, padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8 }}>
          <span>المخزون الحالي: <strong style={{ color: 'var(--accent)' }}>{currentStock}</strong></span>
          <span>المتاح: <strong style={{ color: 'var(--green)' }}>{available}</strong></span>
        </div>

        <Field label="نوع الحركة">
          <select value={form.type} onChange={(e) => set('type', e.target.value)} style={{ ...input, cursor: 'pointer' }}>
            {Object.entries(TXN_TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </Field>

        <Field label={isAdjustment ? 'كمية التسوية (+ زيادة / − نقص)' : 'الكمية'}>
          <input
            type="number"
            value={form.quantity}
            onChange={(e) => set('quantity', e.target.value)}
            placeholder={isAdjustment ? 'مثال: -5 أو 5' : '0'}
            style={input}
            autoFocus
          />
          {isAdjustment && <div style={{ fontSize: '0.68rem', color: 'var(--text3)', marginTop: 4 }}>استخدم قيمة سالبة للنقص وموجبة للزيادة</div>}
        </Field>

        <Field label="التاريخ">
          <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} style={input} />
        </Field>

        {/* حقول دفعة الطباعة — تظهر للطباعة/الشراء */}
        {isPrinting && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="رقم الدفعة">
              <input value={form.batchNo} onChange={(e) => set('batchNo', e.target.value)} placeholder="B-001" style={input} />
            </Field>
            <Field label="المطبعة / المورّد">
              <input value={form.printVendor} onChange={(e) => set('printVendor', e.target.value)} placeholder="مطبعة..." style={input} />
            </Field>
            <Field label="تكلفة الوحدة (ج.م)">
              <input type="number" min="0" value={form.unitCost} onChange={(e) => set('unitCost', e.target.value)} placeholder="0" style={input} />
            </Field>
          </div>
        )}

        {/* حقل المستلِم — يظهر للتسليم */}
        {isDelivery && (
          <Field label="المستلِم">
            <input value={form.recipient} onChange={(e) => set('recipient', e.target.value)} placeholder="اسم الطالب/المستلِم" style={input} />
          </Field>
        )}

        <Field label="السبب">
          <input value={form.reason} onChange={(e) => set('reason', e.target.value)} placeholder="مثال: طباعة دفعة جديدة" style={input} />
        </Field>

        <Field label="ملاحظات">
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} style={{ ...input, resize: 'vertical' }} />
        </Field>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onClose} style={btnSecondary}>إلغاء</button>
          <button onClick={() => onSave(form)} style={btnPrimary}>تسجيل الحركة</button>
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
const modal = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: 420, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto' };
const input = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', color: 'var(--text)', fontFamily: 'Cairo, sans-serif', fontSize: '0.82rem', direction: 'rtl' };
const btnPrimary = { padding: '9px 20px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'Cairo, sans-serif', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' };
const btnSecondary = { padding: '9px 20px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', fontFamily: 'Cairo, sans-serif', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' };
