// src/modules/inventory/components/MaterialFormModal.jsx
// ─────────────────────────────────────────────────────────────────────────────
// مودال إضافة/تعديل مادة تعليمية. لا يحتوي على كمية (المخزون من الحركات فقط).
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { MaterialStatus } from '../constants';
import { INV_GRADES, INV_SUBJECTS } from '../displayMeta';

export default function MaterialFormModal({ material, onClose, onSave, defaultMinStock = 10 }) {
  const [form, setForm] = useState(() => ({
    code:         material?.code || '',
    name:         material?.name || '',
    subject:      material?.subject || INV_SUBJECTS[0],
    grade:        material?.grade || INV_GRADES[0],
    academicYear: material?.academicYear || '',
    edition:      material?.edition || '',
    // material.price هو الحقل الحقيقي (عمود inv_materials.price) — كل صف الآن مصدره
    // موحَّد (MaterialsPage أو InventoryPage كلاهما يكتبان نفس العمود، انظر
    // MATERIALS_DOMAIN_DECISION_AUDIT.md)، فـ sellingPrice المحلي القديم لا يصل أبداً من
    // الخادم. material?.sellingPrice يبقى fallback احترازياً فقط، لا كحقل مُتوقَّع فعلياً.
    sellingPrice: material?.sellingPrice ?? material?.price ?? '',
    printingCost: material?.printingCost ?? '',
    minStock:     material?.minStock ?? defaultMinStock,
    status:       material?.status || MaterialStatus.ACTIVE,
    barcode:      material?.barcode || '',
    notes:        material?.notes || '',
  }));

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modal, width: 520 }}>
        <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 16 }}>
          {material ? 'تعديل مادة' : 'إضافة مادة جديدة'}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="الكود (اختياري — يُولّد تلقائياً)">
            <input value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="MAT-000001" style={input} disabled={!!material} />
          </Field>
          <Field label="اسم المادة *">
            <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="مذكرة المراجعة النهائية" style={input} />
          </Field>
          <Field label="المادة الدراسية">
            <select value={form.subject} onChange={(e) => set('subject', e.target.value)} style={{ ...input, cursor: 'pointer' }}>
              {INV_SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="الصف *">
            <select value={form.grade} onChange={(e) => set('grade', e.target.value)} style={{ ...input, cursor: 'pointer' }}>
              {INV_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="العام الدراسي">
            <input value={form.academicYear} onChange={(e) => set('academicYear', e.target.value)} placeholder="2025/2026" style={input} />
          </Field>
          <Field label="الإصدار">
            <input value={form.edition} onChange={(e) => set('edition', e.target.value)} placeholder="الإصدار الأول" style={input} />
          </Field>
          <Field label="سعر البيع (ج.م)">
            <input type="number" min="0" value={form.sellingPrice} onChange={(e) => set('sellingPrice', e.target.value)} placeholder="0" style={input} />
          </Field>
          <Field label="تكلفة الطباعة (ج.م)">
            <input type="number" min="0" value={form.printingCost} onChange={(e) => set('printingCost', e.target.value)} placeholder="0" style={input} />
          </Field>
          <Field label="الحد الأدنى للمخزون">
            <input type="number" min="0" value={form.minStock} onChange={(e) => set('minStock', e.target.value)} style={input} />
          </Field>
          <Field label="الحالة">
            <select value={form.status} onChange={(e) => set('status', e.target.value)} style={{ ...input, cursor: 'pointer' }}>
              <option value={MaterialStatus.ACTIVE}>نشطة</option>
              <option value={MaterialStatus.INACTIVE}>مؤرشفة</option>
            </select>
          </Field>
          <Field label="الباركود / QR (اختياري)">
            <input value={form.barcode} onChange={(e) => set('barcode', e.target.value)} placeholder="امسح أو أدخل الرمز" style={input} />
          </Field>
        </div>

        <Field label="ملاحظات">
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} style={{ ...input, resize: 'vertical' }} />
        </Field>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onClose} style={btnSecondary}>إلغاء</button>
          <button onClick={() => onSave(form)} style={btnPrimary}>{material ? 'حفظ التعديل' : 'إضافة'}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text3)', display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 };
const modal = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto' };
const input = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', color: 'var(--text)', fontFamily: 'Cairo, sans-serif', fontSize: '0.82rem', direction: 'rtl' };
const btnPrimary = { padding: '9px 20px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'Cairo, sans-serif', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' };
const btnSecondary = { padding: '9px 20px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', fontFamily: 'Cairo, sans-serif', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' };
