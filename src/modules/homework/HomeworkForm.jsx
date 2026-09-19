// src/modules/homework/HomeworkForm.jsx
import { useEffect } from 'react';
import { useAppStore } from '../../store/app.store';
import useForm      from '../../hooks/useForm';
import { validateHomework, SUBJECTS } from '../../services/homeworkService';
import { GRADES } from '../../services/groupService';
import Button from '../../components/ui/Button';

const BASE = {
  background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9,
  padding:'9px 12px', color:'var(--text)', fontFamily:'Cairo,sans-serif',
  fontSize:'0.875rem', outline:'none', width:'100%', direction:'rtl',
  transition:'border-color .15s, box-shadow .15s',
};
const fo = e => { e.target.style.borderColor='var(--accent)'; e.target.style.boxShadow='0 0 0 3px rgba(13,148,136,.12)'; e.target.style.background='var(--surface3)'; };
const bl = inv => e => { e.target.style.borderColor=inv?'var(--red)':'var(--border)'; e.target.style.boxShadow='none'; e.target.style.background=inv?'rgba(239,68,68,.05)':'var(--surface2)'; };

function F({ label, required, error, children }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
      <label style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em' }}>
        {label}{required && <span style={{ color:'var(--red)', marginRight:3 }}>*</span>}
      </label>
      {children}
      {error && <div style={{ fontSize:'0.7rem', color:'var(--red)', display:'flex', alignItems:'center', gap:4 }}>⚠ {error}</div>}
    </div>
  );
}

const I = ({ name, value, onChange, placeholder, type='text', invalid, min, max, disabled }) => (
  <input name={name} type={type} value={value||''} min={min} max={max} onChange={onChange} placeholder={placeholder} disabled={disabled}
    style={{ ...BASE, borderColor:invalid?'var(--red)':'var(--border)', background:invalid?'rgba(239,68,68,.05)':'var(--surface2)', opacity:disabled?0.65:1, cursor:disabled?'default':'text' }}
    onFocus={disabled?undefined:fo} onBlur={disabled?undefined:bl(invalid)}/>
);

const S = ({ name, value, onChange, children, invalid }) => (
  <select name={name} value={value||''} onChange={onChange}
    style={{ ...BASE, cursor:'pointer', borderColor:invalid?'var(--red)':'var(--border)' }}
    onFocus={fo} onBlur={bl(invalid)}
  >{children}</select>
);

// Homework 2.0 Phase 2: academicYear is never a form input — there is no per-student or
// per-homework choice to make (the whole center tracks a single current value,
// centerProfile.academic_year); it is stamped automatically from that value at creation
// (see homeworkService.js's createHomework) and simply displayed here read-only.
const EMPTY = {
  title:'', description:'', subject:'', teacher:'', grade:'',
  totalScore:'10', createdAt:new Date().toISOString().split('T')[0],
  dueDate:'', status:'active', notes:'',
};

export default function HomeworkForm({ initialValues, editId, onSubmit, onCancel, loading }) {
  const centerProfile        = useAppStore((s) => s.centerProfile);
  const { values, errors, touched, handleChange, validate, reset } = useForm(EMPTY, validateHomework);

  useEffect(() => {
    if (initialValues) {
      reset({
        title:       initialValues.title       || '',
        description: initialValues.description || '',
        subject:     initialValues.subject     || '',
        teacher:     initialValues.teacher     || '',
        grade:       initialValues.grade       || '',
        totalScore:  initialValues.totalScore  != null ? String(initialValues.totalScore) : '10',
        createdAt:   initialValues.createdAt   || new Date().toISOString().split('T')[0],
        dueDate:     initialValues.dueDate     || '',
        status:      initialValues.status      || 'active',
        notes:       initialValues.notes       || '',
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const err  = f => touched[f] && errors[f];
  const isEr = f => !!(touched[f] && errors[f]);

  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>

        {/* عنوان الواجب */}
        <div style={{ gridColumn:'1/-1' }}>
          <F label="عنوان الواجب" required error={err('title')}>
            <I name="title" value={values.title} onChange={handleChange} placeholder="مثال: تدريبات المعادلات التربيعية" invalid={isEr('title')}/>
          </F>
        </div>

        {/* الصف — Homework 2.0: الهدف الأكاديمي (لا المجموعة) */}
        <F label="الصف" required error={err('grade')}>
          <S name="grade" value={values.grade} onChange={handleChange} invalid={isEr('grade')}>
            <option value="">اختر الصف...</option>
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </S>
        </F>

        {/* السنة الدراسية — عرض فقط، من إعدادات المركز (centerProfile.academicYear) —
            لا اختيار هنا: قيمة واحدة للمركز بأكمله، تُختَم تلقائياً عند الإنشاء ولا تتغيّر
            عند التعديل (انظر onSubmit أدناه). */}
        <F label="السنة الدراسية">
          <I name="academicYearDisplay" value={editId ? (initialValues?.academicYear || '—') : (centerProfile?.academicYear || '—')} onChange={() => {}} disabled/>
        </F>

        {/* المادة */}
        <F label="المادة" required error={err('subject')}>
          <S name="subject" value={values.subject} onChange={handleChange} invalid={isEr('subject')}>
            <option value="">اختر المادة...</option>
            {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
          </S>
        </F>

        {/* المدرس */}
        <F label="المدرس / المدرسة">
          <I name="teacher" value={values.teacher} onChange={handleChange} placeholder="اسم المدرس..."/>
        </F>

        {/* الدرجة الكلية */}
        <F label="الدرجة الكلية" error={err('totalScore')}>
          <I name="totalScore" value={values.totalScore} onChange={handleChange} type="number" min="0" placeholder="10" invalid={isEr('totalScore')}/>
        </F>

        {/* تاريخ الإنشاء */}
        <F label="تاريخ الإنشاء" required error={err('createdAt')}>
          <I name="createdAt" value={values.createdAt} onChange={handleChange} type="date" invalid={isEr('createdAt')}/>
        </F>

        {/* موعد التسليم */}
        <F label="موعد التسليم" required error={err('dueDate')}>
          <I name="dueDate" value={values.dueDate} onChange={handleChange} type="date" invalid={isEr('dueDate')}/>
        </F>

        {/* الحالة (عند التعديل فقط) */}
        {editId && (
          <F label="الحالة">
            <S name="status" value={values.status} onChange={handleChange}>
              <option value="active">نشط</option>
              <option value="closed">منتهي</option>
              <option value="draft">مسودة</option>
            </S>
          </F>
        )}

        {/* وصف الواجب */}
        <div style={{ gridColumn:'1/-1' }}>
          <F label="وصف الواجب / التعليمات">
            <textarea name="description" value={values.description} onChange={handleChange}
              placeholder="تعليمات الواجب والصفحات المطلوبة..." rows={3}
              style={{ ...BASE, resize:'vertical', minHeight:72 }}
              onFocus={fo} onBlur={e => { e.target.style.borderColor='var(--border)'; e.target.style.boxShadow='none'; }}/>
          </F>
        </div>

      </div>

      <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20, paddingTop:16, borderTop:'1px solid var(--border)' }}>
        <Button variant="secondary" onClick={onCancel}>إلغاء</Button>
        <Button variant="primary" loading={loading} onClick={() => {
          if (!validate()) return;
          // academicYear is never edited by the user — stamped once from the center's
          // current setting at creation, and preserved unchanged on every later edit
          // (never silently overwritten to "today's" value just because the homework was
          // touched for something unrelated, e.g. changing its status).
          const academicYear = editId ? (initialValues?.academicYear || '') : (centerProfile?.academicYear || '');
          // groupId: no longer collected by this form at all (Homework 2.0 — Group is not
          // the target). An existing homework's historical group_id must survive an
          // unrelated edit untouched, not be silently nulled out just because this form no
          // longer has a field for it — a brand-new homework simply has none (null).
          const groupId = editId ? (initialValues?.groupId ?? null) : null;
          onSubmit({ ...values, academicYear, groupId });
        }}>
          💾 {editId ? 'حفظ التعديلات' : 'إنشاء الواجب'}
        </Button>
      </div>
    </div>
  );
}
