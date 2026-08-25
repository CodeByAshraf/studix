// src/modules/students/StudentForm.jsx
import { useEffect } from 'react';
import { useAppStore } from '../../store/app.store';
import useForm       from '../../hooks/useForm';
import { validateStudent } from '../../services/studentService';
import { GRADES }    from '../../services/groupService';
import FormField     from '../../components/forms/FormField';
import Button        from '../../components/ui/Button';

const EMPTY = {
  name: '', phone: '', parentPhone: '', grade: '',
  groupId: '', monthlyFee: '', school: '', notes: '', status: 'active',
  enrollDate: new Date().toISOString().split('T')[0],
};

const BASE_INP = {
  background:'var(--surface2)', border:'1px solid var(--border)',
  borderRadius:9, padding:'9px 12px', color:'var(--text)',
  fontFamily:'Cairo,sans-serif', fontSize:'0.875rem',
  outline:'none', width:'100%', direction:'rtl',
  transition:'border-color 0.15s, box-shadow 0.15s',
};

function Field({ label, required, error, children }) {
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

function Inp({ name, value, onChange, onBlur, placeholder, type='text', invalid, disabled }) {
  const style = { ...BASE_INP, borderColor: invalid ? 'var(--red)' : 'var(--border)', background: invalid ? 'rgba(239,68,68,0.05)' : 'var(--surface2)', opacity: disabled ? 0.6 : 1 };
  return (
    <input name={name} type={type} value={value||''} onChange={onChange} onBlur={onBlur}
      placeholder={placeholder} disabled={disabled} style={style}
      onFocus={e  => { e.target.style.borderColor='var(--accent)'; e.target.style.boxShadow='0 0 0 3px rgba(13,148,136,0.12)'; e.target.style.background='var(--surface3)'; }}
      onBlur={e   => { e.target.style.borderColor=invalid?'var(--red)':'var(--border)'; e.target.style.boxShadow='none'; e.target.style.background=invalid?'rgba(239,68,68,0.05)':'var(--surface2)'; onBlur?.(e); }}
    />
  );
}

function Sel({ name, value, onChange, children, invalid }) {
  return (
    <select name={name} value={value||''} onChange={onChange}
      style={{ ...BASE_INP, cursor:'pointer', borderColor:invalid?'var(--red)':'var(--border)', background:invalid?'rgba(239,68,68,0.05)':'var(--surface2)' }}
      onFocus={e  => { e.target.style.borderColor='var(--accent)'; e.target.style.boxShadow='0 0 0 3px rgba(13,148,136,0.12)'; }}
      onBlur={e   => { e.target.style.borderColor=invalid?'var(--red)':'var(--border)'; e.target.style.boxShadow='none'; }}
    >{children}</select>
  );
}

export default function StudentForm({ initialValues, editId, onSubmit, onCancel, loading }) {
  const groups               = useAppStore((s) => s.groups);
  const students             = useAppStore((s) => s.students);
  const { values, errors, touched, handleChange, handleBlur, setField, validate, reset } = useForm(
    EMPTY,
    (vals) => validateStudent(vals, students, editId)
  );

  // المجموعات المعروضة تُفلتر حسب الصف المختار: طالب أولى ثانوي يرى مجموعات
  // أولى ثانوي فقط. قبل اختيار الصف لا تظهر أي مجموعة (لتفادي اختيار خاطئ).
  const gradeGroups = values.grade
    ? groups.filter((g) => g.grade === values.grade)
    : [];

  // عند تعديل طالب قديم قد تكون مجموعته الحالية من صف مختلف (بيانات سابقة).
  // نضمّها للقائمة حتى لا تختفي مجموعته المسجّلة أثناء التعديل.
  const currentGroup = values.groupId && !gradeGroups.some((g) => g.id === values.groupId)
    ? groups.find((g) => g.id === values.groupId)
    : null;
  const visibleGroups = currentGroup ? [currentGroup, ...gradeGroups] : gradeGroups;
  // سعر المجموعة المختارة (احتياطي/تلميح لرسوم الطالب)
  const selectedGroupObj = groups.find((g) => g.id === values.groupId);
  const selectedGroupPrice = selectedGroupObj?.price || '';

  // تغيير الصف يصفّر المجموعة المختارة، حتى لا يبقى الطالب مربوطاً بمجموعة
  // من صف آخر إذا عدّل المستخدم الصف بعد اختيار المجموعة.
  const handleGradeChange = (e) => {
    handleChange(e);
    if (values.groupId) setField('groupId', '');
  };

  useEffect(() => {
    if (initialValues) {
      reset({
        name:        initialValues.name        || '',
        phone:       initialValues.phone       || '',
        parentPhone: initialValues.parentPhone || '',
        grade:       initialValues.grade       || '',
        groupId:     initialValues.groupId     || '',
        monthlyFee:  initialValues.monthlyFee != null ? String(initialValues.monthlyFee) : '',
        school:      initialValues.school      || '',
        notes:       initialValues.notes       || '',
        status:      initialValues.status      || 'active',
        enrollDate:  initialValues.enrollDate  || new Date().toISOString().split('T')[0],
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const err  = f => touched[f] && errors[f];
  const isEr = f => !!(touched[f] && errors[f]);

  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        {/* اسم الطالب */}
        <div style={{ gridColumn:'1/-1' }}>
          <Field label="اسم الطالب" required error={err('name')}>
            <Inp name="name" value={values.name} onChange={handleChange} onBlur={handleBlur}
              placeholder="الاسم الرباعي على الأقل..." invalid={isEr('name')}/>
          </Field>
        </div>
        {/* رقم الهاتف */}
        <Field label="رقم الهاتف" required error={err('phone')}>
          <Inp name="phone" value={values.phone} onChange={handleChange} onBlur={handleBlur}
            placeholder="01XXXXXXXXX" invalid={isEr('phone')}/>
        </Field>
        {/* رقم ولي الأمر */}
        <Field label="رقم ولي الأمر" error={err('parentPhone')}>
          <Inp name="parentPhone" value={values.parentPhone} onChange={handleChange} onBlur={handleBlur}
            placeholder="01XXXXXXXXX" invalid={isEr('parentPhone')}/>
        </Field>
        {/* السنة الدراسية */}
        <Field label="السنة الدراسية" required error={err('grade')}>
          <Sel name="grade" value={values.grade} onChange={handleGradeChange} invalid={isEr('grade')}>
            <option value="">اختر السنة...</option>
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </Sel>
        </Field>
        {/* المجموعة — تُعرض مجموعات الصف المختار فقط */}
        <Field label="المجموعة" required error={err('groupId')}>
          <Sel name="groupId" value={values.groupId} onChange={handleChange} invalid={isEr('groupId')}>
            <option value="">
              {!values.grade
                ? 'اختر السنة الدراسية أولاً...'
                : gradeGroups.length === 0
                  ? 'لا توجد مجموعات لهذا الصف'
                  : 'اختر المجموعة...'}
            </option>
            {visibleGroups.map(g => <option key={g.id} value={g.id}>{g.name} — {g.subject}</option>)}
          </Sel>
        </Field>
          {/* رسوم الشهر (خاصة بالطالب) */}
          <Field label="رسوم الشهر (ج.م)" required error={err('monthlyFee')}>
            <Inp name="monthlyFee" value={values.monthlyFee} onChange={handleChange} type="number" min="0"
              placeholder={selectedGroupPrice ? `سعر المجموعة: ${selectedGroupPrice}` : '500'}/>
          </Field>
        {/* المدرسة */}
        <Field label="المدرسة">
          <Inp name="school" value={values.school} onChange={handleChange} placeholder="اسم المدرسة..."/>
        </Field>
        {/* تاريخ الاشتراك */}
        <Field label="تاريخ الاشتراك">
          <Inp name="enrollDate" value={values.enrollDate} onChange={handleChange} type="date"/>
        </Field>
        {/* الحالة */}
        <Field label="الحالة">
          <Sel name="status" value={values.status} onChange={handleChange}>
            <option value="active">نشط</option>
            <option value="inactive">موقوف</option>
            <option value="graduated">متخرج</option>
          </Sel>
        </Field>
        {/* ملاحظات */}
        <div style={{ gridColumn:'1/-1' }}>
          <Field label="ملاحظات">
            <textarea name="notes" value={values.notes} onChange={handleChange}
              placeholder="أي ملاحظات إضافية..." rows={3}
              style={{ ...BASE_INP, resize:'vertical', minHeight:72 }}
              onFocus={e => { e.target.style.borderColor='var(--accent)'; e.target.style.boxShadow='0 0 0 3px rgba(13,148,136,0.12)'; }}
              onBlur={e  => { e.target.style.borderColor='var(--border)'; e.target.style.boxShadow='none'; }}
            />
          </Field>
        </div>
      </div>

      <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20, paddingTop:16, borderTop:'1px solid var(--border)' }}>
        <Button variant="secondary" onClick={onCancel}>إلغاء</Button>
        <Button variant="primary" loading={loading} onClick={() => { if (validate()) onSubmit(values); }}>
          💾 {editId ? 'حفظ التعديلات' : 'تسجيل الطالب'}
        </Button>
      </div>
    </div>
  );
}
