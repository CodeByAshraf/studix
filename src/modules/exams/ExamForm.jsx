// src/modules/exams/ExamForm.jsx
import { useEffect } from 'react';
import { useAppStore } from '../../store/app.store';
import useForm       from '../../hooks/useForm';
import { validateExam, EXAM_TYPES, EXAM_STATUS } from '../../services/examService';
import Button        from '../../components/ui/Button';

const SUBJECTS = ['رياضيات','فيزياء','كيمياء','أحياء','إنجليزية','عربي','تاريخ','جغرافيا','فلسفة','حاسب','أخرى'];

const BASE = {
  background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9,
  padding:'9px 12px', color:'var(--text)', fontFamily:'Cairo,sans-serif',
  fontSize:'0.875rem', outline:'none', width:'100%', direction:'rtl',
  transition:'border-color .15s, box-shadow .15s',
};
const fo = e => { e.target.style.borderColor='var(--accent)'; e.target.style.boxShadow='0 0 0 3px rgba(13,148,136,.12)'; e.target.style.background='var(--surface3)'; };
const bl = (inv) => e => { e.target.style.borderColor=inv?'var(--red)':'var(--border)'; e.target.style.boxShadow='none'; e.target.style.background=inv?'rgba(239,68,68,.05)':'var(--surface2)'; };

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

const I = ({name,value,onChange,placeholder,type='text',invalid,min,max}) => (
  <input name={name} type={type} value={value||''} min={min} max={max} onChange={onChange} placeholder={placeholder}
    style={{...BASE, borderColor:invalid?'var(--red)':'var(--border)', background:invalid?'rgba(239,68,68,.05)':'var(--surface2)'}}
    onFocus={fo} onBlur={bl(invalid)}/>
);

const S = ({name,value,onChange,children,invalid}) => (
  <select name={name} value={value||''} onChange={onChange}
    style={{...BASE, cursor:'pointer', borderColor:invalid?'var(--red)':'var(--border)'}}
    onFocus={fo} onBlur={bl(invalid)}
  >{children}</select>
);

const EMPTY = {
  name:'', groupId:'', subject:'', date:new Date().toISOString().split('T')[0],
  total:'100', pass:'50', type:'monthly', teacher:'', status:'upcoming', notes:'',
};

export default function ExamForm({ initialValues, editId, onSubmit, onCancel, loading }) {
  const groups               = useAppStore((s) => s.groups);
  const { values, errors, touched, handleChange, validate, reset } = useForm(EMPTY, validateExam);

  useEffect(() => {
    if (initialValues) {
      reset({
        name:    initialValues.name    || '',
        groupId: initialValues.groupId || '',
        subject: initialValues.subject || '',
        date:    initialValues.date    || new Date().toISOString().split('T')[0],
        total:   String(initialValues.total || 100),
        pass:    String(initialValues.pass  || 50),
        type:    initialValues.type    || 'monthly',
        teacher: initialValues.teacher || '',
        status:  initialValues.status  || 'upcoming',
        notes:   initialValues.notes   || '',
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
          <F label="اسم الامتحان" required error={err('name')}>
            <I name="name" value={values.name} onChange={handleChange} placeholder="مثال: امتحان شهري مارس — رياضيات" invalid={isEr('name')}/>
          </F>
        </div>

        <F label="المجموعة" required error={err('groupId')}>
          <S name="groupId" value={values.groupId} onChange={handleChange} invalid={isEr('groupId')}>
            <option value="">اختر المجموعة...</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </S>
        </F>

        <F label="المادة" required error={err('subject')}>
          <S name="subject" value={values.subject} onChange={handleChange} invalid={isEr('subject')}>
            <option value="">اختر المادة...</option>
            {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
          </S>
        </F>

        <F label="نوع الامتحان">
          <S name="type" value={values.type} onChange={handleChange}>
            {Object.entries(EXAM_TYPES).map(([k,v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </S>
        </F>

        <F label="تاريخ الامتحان" required error={err('date')}>
          <I name="date" value={values.date} onChange={handleChange} type="date" invalid={isEr('date')}/>
        </F>

        <F label="الدرجة الكلية" required error={err('total')}>
          <I name="total" value={values.total} onChange={handleChange} type="number" min="1" placeholder="100" invalid={isEr('total')}/>
        </F>

        <F label="درجة النجاح" required error={err('pass')}>
          <I name="pass" value={values.pass} onChange={handleChange} type="number" min="0" placeholder="50" invalid={isEr('pass')}/>
        </F>

        <F label="المدرس / المصحح">
          <I name="teacher" value={values.teacher} onChange={handleChange} placeholder="اسم المدرس..."/>
        </F>

        {editId && (
          <F label="حالة الامتحان">
            <S name="status" value={values.status} onChange={handleChange}>
              {Object.entries(EXAM_STATUS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
            </S>
          </F>
        )}

        <div style={{ gridColumn:'1/-1' }}>
          <F label="ملاحظات">
            <textarea name="notes" value={values.notes} onChange={handleChange} placeholder="تعليمات أو ملاحظات..." rows={2}
              style={{...BASE, resize:'vertical', minHeight:60}}
              onFocus={fo} onBlur={e=>{e.target.style.borderColor='var(--border)';e.target.style.boxShadow='none';}}/>
          </F>
        </div>
      </div>

      <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20, paddingTop:16, borderTop:'1px solid var(--border)' }}>
        <Button variant="secondary" onClick={onCancel}>إلغاء</Button>
        <Button variant="primary" loading={loading} onClick={() => { if (validate()) onSubmit(values); }}>
          💾 {editId ? 'حفظ التعديلات' : 'إنشاء الامتحان'}
        </Button>
      </div>
    </div>
  );
}
