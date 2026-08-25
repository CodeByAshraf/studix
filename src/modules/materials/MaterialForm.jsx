// src/modules/materials/MaterialForm.jsx
import { useEffect } from 'react';
import useForm  from '../../hooks/useForm';
import { validateMaterial, SUBJECTS, GRADES } from '../../services/materialService';
import Button   from '../../components/ui/Button';

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

const I = ({ name, value, onChange, placeholder, type='text', invalid, min }) => (
  <input name={name} type={type} value={value||''} min={min} onChange={onChange} placeholder={placeholder}
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
  name:'', subject:'', teacher:'', grade:'', price:'',
  addedAt: new Date().toISOString().split('T')[0],
  description:'',
};

export default function MaterialForm({ initialValues, editId, onSubmit, onCancel, loading }) {
  const { values, errors, touched, handleChange, validate, reset } = useForm(EMPTY, validateMaterial);

  useEffect(() => {
    if (initialValues) {
      reset({
        name:        initialValues.name        || '',
        subject:     initialValues.subject     || '',
        teacher:     initialValues.teacher     || '',
        grade:       initialValues.grade       || '',
        price:       initialValues.price       != null ? String(initialValues.price) : '',
        addedAt:     initialValues.addedAt     || new Date().toISOString().split('T')[0],
        description: initialValues.description || '',
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const err  = f => touched[f] && errors[f];
  const isEr = f => !!(touched[f] && errors[f]);

  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>

        <div style={{ gridColumn:'1/-1' }}>
          <F label="اسم المذكرة" required error={err('name')}>
            <I name="name" value={values.name} onChange={handleChange}
              placeholder="مثال: مذكرة الرياضيات — الترم الأول" invalid={isEr('name')}/>
          </F>
        </div>

        <F label="المادة" required error={err('subject')}>
          <S name="subject" value={values.subject} onChange={handleChange} invalid={isEr('subject')}>
            <option value="">اختر المادة...</option>
            {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
          </S>
        </F>

        <F label="السنة الدراسية" required error={err('grade')}>
          <S name="grade" value={values.grade} onChange={handleChange} invalid={isEr('grade')}>
            <option value="">اختر السنة...</option>
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </S>
        </F>

        <F label="المدرس / المدرسة">
          <I name="teacher" value={values.teacher} onChange={handleChange} placeholder="اسم المدرس..."/>
        </F>

        <F label="السعر (ج.م)" error={err('price')}>
          <I name="price" value={values.price} onChange={handleChange} type="number" min="0" placeholder="80" invalid={isEr('price')}/>
        </F>

        <div style={{ gridColumn:'1/-1' }}>
          <F label="تاريخ الإضافة" required error={err('addedAt')}>
            <I name="addedAt" value={values.addedAt} onChange={handleChange} type="date" invalid={isEr('addedAt')}/>
          </F>
        </div>

        <div style={{ gridColumn:'1/-1' }}>
          <F label="وصف المذكرة (اختياري)">
            <textarea name="description" value={values.description} onChange={handleChange}
              placeholder="وصف مختصر للمحتوى..." rows={3}
              style={{ ...BASE, resize:'vertical', minHeight:68 }}
              onFocus={fo} onBlur={e => { e.target.style.borderColor='var(--border)'; e.target.style.boxShadow='none'; }}/>
          </F>
        </div>

      </div>

      <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20, paddingTop:16, borderTop:'1px solid var(--border)' }}>
        <Button variant="secondary" onClick={onCancel}>إلغاء</Button>
        <Button variant="primary" loading={loading} onClick={() => { if (validate()) onSubmit(values); }}>
          💾 {editId ? 'حفظ التعديلات' : 'إضافة المذكرة'}
        </Button>
      </div>
    </div>
  );
}
