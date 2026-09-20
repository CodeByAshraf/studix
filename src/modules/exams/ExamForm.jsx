// src/modules/exams/ExamForm.jsx
import { useEffect } from 'react';
import { useAppStore } from '../../store/app.store';
import useForm       from '../../hooks/useForm';
import { validateExam, computeExamEndTime, EXAM_TYPES, EXAM_STATUS } from '../../services/examService';
import { GRADES } from '../../services/groupService';
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

const I = ({name,value,onChange,placeholder,type='text',invalid,min,max,disabled}) => (
  <input name={name} type={type} value={value||''} min={min} max={max} onChange={onChange} placeholder={placeholder} disabled={disabled}
    style={{...BASE, borderColor:invalid?'var(--red)':'var(--border)', background:invalid?'rgba(239,68,68,.05)':'var(--surface2)', opacity:disabled?0.65:1, cursor:disabled?'default':'text'}}
    onFocus={disabled?undefined:fo} onBlur={disabled?undefined:bl(invalid)}/>
);

const S = ({name,value,onChange,children,invalid}) => (
  <select name={name} value={value||''} onChange={onChange}
    style={{...BASE, cursor:'pointer', borderColor:invalid?'var(--red)':'var(--border)'}}
    onFocus={fo} onBlur={bl(invalid)}
  >{children}</select>
);

// Exams Phase 2: academicYear is never a form input — there is no per-student or
// per-exam choice to make (the whole center tracks a single current value,
// centerProfile.academic_year); it is stamped automatically from that value at creation
// (see examService.js's createExam) and simply displayed here read-only.
const EMPTY = {
  name:'', grade:'', subject:'', date:new Date().toISOString().split('T')[0],
  total:'100', pass:'50', type:'monthly', teacher:'', status:'upcoming', notes:'',
  // Exams Phase 3C — both optional; scheduling/administrative display only, no timer/Start
  // logic exists yet. Empty string here (not null) matches every other optional text/select
  // field's local form-state convention.
  scheduledTime:'', durationMinutes:'',
};

export default function ExamForm({ initialValues, editId, onSubmit, onCancel, loading }) {
  const centerProfile        = useAppStore((s) => s.centerProfile);
  const { values, errors, touched, handleChange, validate, reset } = useForm(EMPTY, validateExam);

  useEffect(() => {
    if (initialValues) {
      reset({
        name:    initialValues.name    || '',
        grade:   initialValues.grade   || '',
        subject: initialValues.subject || '',
        date:    initialValues.date    || new Date().toISOString().split('T')[0],
        total:   String(initialValues.total || 100),
        pass:    String(initialValues.pass  || 50),
        type:    initialValues.type    || 'monthly',
        teacher: initialValues.teacher || '',
        status:  initialValues.status  || 'upcoming',
        notes:   initialValues.notes   || '',
        scheduledTime:   initialValues.scheduledTime   || '',
        durationMinutes: initialValues.durationMinutes != null ? String(initialValues.durationMinutes) : '',
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const err  = f => touched[f] && errors[f];
  const isEr = f => !!(touched[f] && errors[f]);

  // Exams Phase 3C — display-only, never persisted (see examService.js's createExam/
  // updateExam: only scheduledTime/durationMinutes themselves are ever sent to the server).
  const endTime = computeExamEndTime(values.scheduledTime, values.durationMinutes);

  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        <div style={{ gridColumn:'1/-1' }}>
          <F label="اسم الامتحان" required error={err('name')}>
            <I name="name" value={values.name} onChange={handleChange} placeholder="مثال: امتحان شهري مارس — رياضيات" invalid={isEr('name')}/>
          </F>
        </div>

        {/* الصف — Exams Phase 2: الهدف الأكاديمي (لا المجموعة) */}
        <F label="الصف" required error={err('grade')}>
          <S name="grade" value={values.grade} onChange={handleChange} invalid={isEr('grade')}>
            <option value="">اختر الصف...</option>
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </S>
        </F>

        {/* السنة الدراسية — عرض فقط، من إعدادات المركز (centerProfile.academicYear) */}
        <F label="السنة الدراسية">
          <I name="academicYearDisplay" value={editId ? (initialValues?.academicYear || '—') : (centerProfile?.academicYear || '—')} onChange={() => {}} disabled/>
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

        {/* الجدولة — Exams Phase 3C: اختيارية بالكامل، عرض/مرجع إداري فقط (لا مؤقّت،
            لا إجراء بدء بعد). موعد النهاية محسوب فقط، لا يُحفَظ إطلاقاً. */}
        <F label="وقت الامتحان (اختياري)" error={err('scheduledTime')}>
          <I name="scheduledTime" value={values.scheduledTime} onChange={handleChange} type="time" invalid={isEr('scheduledTime')}/>
        </F>

        <F label="المدة (دقائق، اختياري)" error={err('durationMinutes')}>
          <I name="durationMinutes" value={values.durationMinutes} onChange={handleChange} type="number" min="1" placeholder="مثال: 60" invalid={isEr('durationMinutes')}/>
        </F>

        {endTime && (
          <div style={{ gridColumn:'1/-1' }}>
            <F label="موعد الانتهاء المتوقَّع">
              <I name="endTimeDisplay" value={`${endTime.time}${endTime.crossesMidnight ? ' (اليوم التالي)' : ''}`} onChange={() => {}} disabled/>
            </F>
          </div>
        )}

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
        <Button variant="primary" loading={loading} onClick={() => {
          if (!validate()) return;
          // academicYear is never edited by the user — stamped once from the center's
          // current setting at creation, and preserved unchanged on every later edit.
          const academicYear = editId ? (initialValues?.academicYear || '') : (centerProfile?.academicYear || '');
          // groupId: no longer collected by this form at all (Exams Phase 2 — Group is
          // not the target). An existing exam's historical group_id must survive an
          // unrelated edit untouched, not be silently nulled out — a brand-new exam
          // simply has none (null).
          const groupId = editId ? (initialValues?.groupId ?? null) : null;
          onSubmit({ ...values, academicYear, groupId });
        }}>
          💾 {editId ? 'حفظ التعديلات' : 'إنشاء الامتحان'}
        </Button>
      </div>
    </div>
  );
}
