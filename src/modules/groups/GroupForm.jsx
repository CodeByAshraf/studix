// src/modules/groups/GroupForm.jsx
import { useEffect } from 'react';
import useForm from '../../hooks/useForm';
import { validateGroup, ALL_DAYS, DAYS_AR, SUBJECTS, GRADES, GROUP_COLORS } from '../../services/groupService';
import Button from '../../components/ui/Button';

const EMPTY = {
  name:'', subject:'', grade:'', teacher:'',
  time:'09:00', days:[], price:'', max:'', color:GROUP_COLORS[0], notes:'',
};

const INP_BASE = {
  background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9,
  padding:'9px 12px', color:'var(--text)', fontFamily:'Cairo,sans-serif',
  fontSize:'0.875rem', outline:'none', width:'100%', direction:'rtl',
  transition:'border-color .15s, box-shadow .15s',
};

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

function I({ name, value, onChange, placeholder, type='text', invalid, min, max }) {
  return (
    <input name={name} type={type} value={value||''} min={min} max={max}
      onChange={onChange} placeholder={placeholder}
      style={{ ...INP_BASE, borderColor:invalid?'var(--red)':'var(--border)', background:invalid?'rgba(239,68,68,.05)':'var(--surface2)' }}
      onFocus={e  => { e.target.style.borderColor='var(--accent)'; e.target.style.boxShadow='0 0 0 3px rgba(13,148,136,.12)'; e.target.style.background='var(--surface3)'; }}
      onBlur={e   => { e.target.style.borderColor=invalid?'var(--red)':'var(--border)'; e.target.style.boxShadow='none'; e.target.style.background=invalid?'rgba(239,68,68,.05)':'var(--surface2)'; }}
    />
  );
}

function S({ name, value, onChange, children, invalid }) {
  return (
    <select name={name} value={value||''} onChange={onChange}
      style={{ ...INP_BASE, cursor:'pointer', borderColor:invalid?'var(--red)':'var(--border)', background:invalid?'rgba(239,68,68,.05)':'var(--surface2)' }}
      onFocus={e  => { e.target.style.borderColor='var(--accent)'; e.target.style.boxShadow='0 0 0 3px rgba(13,148,136,.12)'; }}
      onBlur={e   => { e.target.style.borderColor=invalid?'var(--red)':'var(--border)'; e.target.style.boxShadow='none'; }}
    >{children}</select>
  );
}

// ─────────────────────────────────────────────────────────────
export default function GroupForm({ initialValues, editId, existingGroups, onSubmit, onCancel, loading }) {
  const { values, errors, touched, handleChange, validate, reset, setField } = useForm(
    EMPTY,
    (vals) => validateGroup(vals, existingGroups, editId)
  );

  useEffect(() => {
    if (initialValues) {
      reset({
        name:    initialValues.name    || '',
        subject: initialValues.subject || '',
        grade:   initialValues.grade   || '',
        teacher: initialValues.teacher || '',
        time:    initialValues.time    || '09:00',
        days:    initialValues.days    || [],
        price:   String(initialValues.price || ''),
        max:     String(initialValues.max   || ''),
        color:   initialValues.color   || GROUP_COLORS[0],
        notes:   initialValues.notes   || '',
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // Toggle day
  const toggleDay = (day) => {
    const current = values.days || [];
    const updated  = current.includes(day)
      ? current.filter(d => d !== day)
      : [...current, day];
    setField('days', updated);
  };

  const err  = f => touched[f] && errors[f];
  const isEr = f => !!(touched[f] && errors[f]);

  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>

        {/* اسم المجموعة */}
        <div style={{ gridColumn:'1/-1' }}>
          <F label="اسم المجموعة" required error={err('name')}>
            <I name="name" value={values.name} onChange={handleChange} placeholder="مثال: رياضيات ثانوي — أ" invalid={isEr('name')}/>
          </F>
        </div>

        {/* المادة */}
        <F label="المادة" required error={err('subject')}>
          <S name="subject" value={values.subject} onChange={handleChange} invalid={isEr('subject')}>
            <option value="">اختر المادة...</option>
            {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
          </S>
        </F>

        {/* السنة الدراسية */}
        <F label="السنة الدراسية" required error={err('grade')}>
          <S name="grade" value={values.grade} onChange={handleChange} invalid={isEr('grade')}>
            <option value="">اختر السنة...</option>
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </S>
        </F>

        {/* موعد الحصة */}
        <F label="موعد الحصة" required error={err('time')}>
          <I name="time" value={values.time} onChange={handleChange} type="time" invalid={isEr('time')}/>
        </F>

        {/* المدرس */}
        <F label="المدرس / المدرسة">
          <I name="teacher" value={values.teacher} onChange={handleChange} placeholder="اسم المدرس..."/>
        </F>

        {/* الحد الأقصى */}
        <F label="الحد الأقصى للطلاب" required error={err('max')}>
          <I name="max" value={values.max} onChange={handleChange} type="number" placeholder="20" min="1" max="100" invalid={isEr('max')}/>
        </F>

        {/* أيام الأسبوع */}
        <div style={{ gridColumn:'1/-1' }}>
          <F label="أيام الأسبوع" required error={err('days')}>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:2 }}>
              {ALL_DAYS.map(day => {
                const active = (values.days || []).includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    style={{
                      padding:'6px 12px', borderRadius:8, fontSize:'0.78rem', fontWeight:700,
                      cursor:'pointer', transition:'all .15s', fontFamily:'Cairo,sans-serif',
                      background: active ? 'var(--accent)' : 'var(--surface3)',
                      color:      active ? 'var(--surface)' : 'var(--text3)',
                      border:     `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    }}
                  >
                    {DAYS_AR[day]}
                  </button>
                );
              })}
            </div>
          </F>
        </div>

        {/* لون المجموعة */}
        <div style={{ gridColumn:'1/-1' }}>
          <F label="لون المجموعة">
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:4 }}>
              {GROUP_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setField('color', c)}
                  style={{
                    width:26, height:26, borderRadius:'50%', background:c,
                    border:`3px solid ${values.color === c ? '#fff' : 'transparent'}`,
                    cursor:'pointer', transition:'transform .15s',
                    outline: values.color === c ? `2px solid ${c}` : 'none',
                    outlineOffset:2,
                  }}
                  onMouseOver={e => e.currentTarget.style.transform='scale(1.25)'}
                  onMouseOut={e  => e.currentTarget.style.transform='scale(1)'}
                />
              ))}
            </div>
          </F>
        </div>

        {/* ملاحظات */}
        <div style={{ gridColumn:'1/-1' }}>
          <F label="ملاحظات">
            <textarea name="notes" value={values.notes} onChange={handleChange}
              placeholder="أي ملاحظات إضافية..." rows={2}
              style={{ ...INP_BASE, resize:'vertical', minHeight:64 }}
              onFocus={e => { e.target.style.borderColor='var(--accent)'; e.target.style.boxShadow='0 0 0 3px rgba(13,148,136,.12)'; }}
              onBlur={e  => { e.target.style.borderColor='var(--border)'; e.target.style.boxShadow='none'; }}
            />
          </F>
        </div>

      </div>

      <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20, paddingTop:16, borderTop:'1px solid var(--border)' }}>
        <Button variant="secondary" onClick={onCancel}>إلغاء</Button>
        <Button variant="primary" loading={loading} onClick={() => { if (validate()) onSubmit(values); }}>
          💾 {editId ? 'حفظ التعديلات' : 'إنشاء المجموعة'}
        </Button>
      </div>
    </div>
  );
}
