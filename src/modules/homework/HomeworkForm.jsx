// src/modules/homework/HomeworkForm.jsx
import { useEffect } from 'react';
import { useAppStore } from '../../store/app.store';
import useForm      from '../../hooks/useForm';
import { validateHomework, SUBJECTS } from '../../services/homeworkService';
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

const I = ({ name, value, onChange, placeholder, type='text', invalid, min, max }) => (
  <input name={name} type={type} value={value||''} min={min} max={max} onChange={onChange} placeholder={placeholder}
    style={{ ...BASE, borderColor:invalid?'var(--red)':'var(--border)', background:invalid?'rgba(239,68,68,.05)':'var(--surface2)' }}
    onFocus={fo} onBlur={bl(invalid)}/>
);

const S = ({ name, value, onChange, children, invalid }) => (
  <select name={name} value={value||''} onChange={onChange}
    style={{ ...BASE, cursor:'pointer', borderColor:invalid?'var(--red)':'var(--border)' }}
    onFocus={fo} onBlur={bl(invalid)}
  >{children}</select>
);

const EMPTY = {
  title:'', description:'', subject:'', teacher:'', groupId:'',
  totalScore:'10', createdAt:new Date().toISOString().split('T')[0],
  dueDate:'', status:'active', notes:'',
};

export default function HomeworkForm({ initialValues, editId, onSubmit, onCancel, loading }) {
  const groups               = useAppStore((s) => s.groups);
  const { values, errors, touched, handleChange, validate, reset, setField } = useForm(EMPTY, validateHomework);

  useEffect(() => {
    if (initialValues) {
      reset({
        title:       initialValues.title       || '',
        description: initialValues.description || '',
        subject:     initialValues.subject     || '',
        teacher:     initialValues.teacher     || '',
        groupId:     initialValues.groupId     || '',
        totalScore:  initialValues.totalScore  != null ? String(initialValues.totalScore) : '10',
        createdAt:   initialValues.createdAt   || new Date().toISOString().split('T')[0],
        dueDate:     initialValues.dueDate     || '',
        status:      initialValues.status      || 'active',
        notes:       initialValues.notes       || '',
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // Auto-fill teacher when group is selected
  const handleGroupChange = (e) => {
    handleChange(e);
    const g = groups.find(g => g.id === e.target.value);
    if (g?.teacher && !values.teacher) setField('teacher', g.teacher);
    if (g?.subject && !values.subject) setField('subject', g.subject);
  };

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

        {/* المجموعة */}
        <F label="المجموعة / الصف" required error={err('groupId')}>
          <S name="groupId" value={values.groupId} onChange={handleGroupChange} invalid={isEr('groupId')}>
            <option value="">اختر المجموعة...</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name} — {g.grade}</option>)}
          </S>
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
        <Button variant="primary" loading={loading} onClick={() => { if (validate()) onSubmit(values); }}>
          💾 {editId ? 'حفظ التعديلات' : 'إنشاء الواجب'}
        </Button>
      </div>
    </div>
  );
}
