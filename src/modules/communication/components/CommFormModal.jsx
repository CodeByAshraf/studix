// src/modules/communication/components/CommFormModal.jsx
// ─────────────────────────────────────────────────────────────────────────────
// مودال تسجيل تواصل جديد.
// MEDIUM-C (Finding 5): حقل "اسم الطالب" أصبح بحثاً موحَّداً (طلاب + قبولات) بنفس نمط
// StudentReportPage.jsx's المُثبَت بالفعل (بحث فوري، قائمة نتائج، اختيار يملأ الحقول) —
// عند اختيار نتيجة حقيقية تُضبَط studentId/admissionId والـ parentId المشتقّ (فقط لو
// السجل المختار له ربط ولي أمر حقيقي بالفعل — لا اختراع لربط من تطابق اسم/هاتف). كتابة
// نص لا يطابق أي نتيجة تبقى كما كانت دائماً: نص حرّ بلا أي FK (fallback الاستفسار
// الجديد الحالي، بلا أي تغيير).
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { CommType, CommReason, CommResult, Priority } from '../constants';
import { COMM_TYPE_META, COMM_REASON_META, COMM_RESULT_META, PRIORITY_META } from '../displayMeta';

const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS_PER_KIND = 5;

export default function CommFormModal({ onClose, onSave, students = [], admissions = [], parents = [] }) {
  const [form, setForm] = useState({
    type: CommType.PHONE_CALL,
    reason: CommReason.INQUIRY,
    result: CommResult.ANSWERED,
    studentName: '',
    parentName: '',
    phone: '',
    notes: '',
    priority: Priority.NORMAL,
    followupDate: '',
    followupTime: '',
    // MEDIUM-C: null دائماً إلا بعد اختيار فعلي من نتائج البحث أدناه — لا قيمة افتراضية
    // مُخمَّنة أبداً.
    studentId: null,
    admissionId: null,
    parentId: null,
  });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  // ── بحث موحَّد (طلاب + قبولات) — نفس نمط StudentReportPage.jsx بالضبط ──
  const results = useMemo(() => {
    const q = form.studentName.trim().toLowerCase();
    // لا نتائج بعد اختيار فعلي — القائمة تُغلَق تلقائياً (نفس !selectedId هناك)، ولا
    // نتائج قبل حد أدنى من الأحرف (يمنع قائمة ضخمة عند فتح المودال).
    if (q.length < MIN_QUERY_LENGTH || form.studentId || form.admissionId) return [];

    const studentMatches = students
      .filter((s) => s.name?.toLowerCase().includes(q) || s.code?.toLowerCase().includes(q) || s.phone?.includes(q))
      .slice(0, MAX_RESULTS_PER_KIND)
      .map((item) => ({ kind: 'student', item }));

    const admissionMatches = admissions
      .filter((a) => a.name?.toLowerCase().includes(q) || a.phone?.includes(q) || a.parentPhone?.includes(q))
      .slice(0, MAX_RESULTS_PER_KIND)
      .map((item) => ({ kind: 'admission', item }));

    return [...studentMatches, ...admissionMatches];
  }, [students, admissions, form.studentName, form.studentId, form.admissionId]);

  // تعديل نص البحث يُلغي أي ربط سابق فوراً — نص معروض غير مطابق لـ id محتفَظ به يعني
  // ربطاً زائفاً (بالضبط ما يُمنَع صراحةً هنا: لا FK يبقى مرتبطاً بنص غيّره المستخدم).
  const handleStudentNameChange = (v) => {
    setForm((p) => ({ ...p, studentName: v, studentId: null, admissionId: null, parentId: null }));
  };

  const selectStudent = (s) => {
    const parentId = s.parentId ?? null;
    const linkedParent = parentId ? parents.find((p) => p.id === parentId) : null;
    setForm((p) => ({
      ...p,
      studentId: s.id,
      admissionId: null,
      parentId,
      studentName: s.name,
      // قيم مساعدة فقط — الحقول تبقى قابلة للتعديل يدوياً بعدها بلا أي قفل.
      parentName: linkedParent?.fullName || p.parentName,
      phone: s.parentPhone || s.phone || p.phone,
    }));
  };

  const selectAdmission = (a) => {
    setForm((p) => ({
      ...p,
      studentId: null,
      admissionId: a.id,
      parentId: a.parentId ?? null,
      studentName: a.name,
      parentName: a.parentName || p.parentName,
      phone: a.parentPhone || a.phone || p.phone,
    }));
  };

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal}>
        <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 16 }}>تسجيل تواصل جديد</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="نوع التواصل *">
            <select value={form.type} onChange={(e) => set('type', e.target.value)} style={sel}>
              {Object.entries(COMM_TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </Field>
          <Field label="النتيجة *">
            <select value={form.result} onChange={(e) => set('result', e.target.value)} style={sel}>
              {Object.entries(COMM_RESULT_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="السبب">
            <select value={form.reason} onChange={(e) => set('reason', e.target.value)} style={sel}>
              {Object.entries(COMM_REASON_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="الأولوية">
            <select value={form.priority} onChange={(e) => set('priority', e.target.value)} style={sel}>
              {Object.entries(PRIORITY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <div style={{ position: 'relative' }}>
            <Field label="اسم الطالب">
              <input
                value={form.studentName}
                onChange={(e) => handleStudentNameChange(e.target.value)}
                placeholder="ابحث لربط سجل حقيقي، أو اكتب استفساراً جديداً..."
                autoComplete="off"
                style={input}
              />
            </Field>
            {(form.studentId || form.admissionId) && (
              <div style={linkedBadge}>
                {form.studentId ? '✓ مرتبط بطالب حقيقي' : '✓ مرتبط بسجل قبول'}
              </div>
            )}
            {results.length > 0 && (
              <div style={dropdown}>
                {results.map(({ kind, item }) => (
                  <div
                    key={`${kind}_${item.id}`}
                    onClick={() => (kind === 'student' ? selectStudent(item) : selectAdmission(item))}
                    style={dropdownItem}
                    onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface2)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.background = ''; }}
                  >
                    <span style={{ fontSize: '0.62rem', fontWeight: 700, color: kind === 'student' ? 'var(--accent)' : '#f59e0b', flexShrink: 0 }}>
                      {kind === 'student' ? 'طالب' : 'قبول'}
                    </span>
                    <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                    {item.phone && <span style={{ fontSize: '0.68rem', color: 'var(--text3)', direction: 'ltr' }}>{item.phone}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <Field label="اسم ولي الأمر">
            <input value={form.parentName} onChange={(e) => set('parentName', e.target.value)} style={input} />
          </Field>
          <Field label="رقم الهاتف">
            <input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="01xxxxxxxxx" style={input} dir="ltr" />
          </Field>
          <div />
          <Field label="تاريخ المتابعة (اختياري)">
            <input type="date" value={form.followupDate} onChange={(e) => set('followupDate', e.target.value)} style={input} />
          </Field>
          <Field label="وقت المتابعة (اختياري)">
            <input type="time" value={form.followupTime} onChange={(e) => set('followupTime', e.target.value)} style={input} />
          </Field>
        </div>

        <Field label="ملاحظات">
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} style={{ ...input, resize: 'vertical' }} />
        </Field>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onClose} style={btnSec}>إلغاء</button>
          <button onClick={() => onSave(form)} style={btnPri}>حفظ</button>
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
const modal = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: 540, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto' };
const input = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', color: 'var(--text)', fontFamily: 'Cairo, sans-serif', fontSize: '0.82rem', direction: 'rtl' };
const sel = { ...input, cursor: 'pointer' };
const btnPri = { padding: '9px 20px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'Cairo, sans-serif', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' };
const btnSec = { padding: '9px 20px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', fontFamily: 'Cairo, sans-serif', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' };
const dropdown = { position: 'absolute', top: '100%', right: 0, left: 0, zIndex: 10, marginTop: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,.25)', maxHeight: 220, overflowY: 'auto' };
const dropdownItem = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: '0.8rem' };
const linkedBadge = { fontSize: '0.66rem', fontWeight: 700, color: 'var(--green)', marginTop: 3 };
