// src/modules/students/StudentForm.jsx
import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/app.store';
import useForm       from '../../hooks/useForm';
import { validateStudent } from '../../services/studentService';
import { GRADES, formatDays, selectedAttendDays, toAttendDays } from '../../services/groupService';
import { pgGetStudentEnrollments } from '../../services/api';
import FormField     from '../../components/forms/FormField';
import Button        from '../../components/ui/Button';
import AttendDaysPicker from './components/AttendDaysPicker';

// Fix 2 — a stored/edited attend_days re-checked against the group's CURRENT meeting days:
// days the group no longer meets are dropped; if none remain the user must pick again (never
// silently widened to "all days"). null stays null ("follows the group").
function normalizeAttendDays(days, group) {
  if (days == null) return { value: null };
  const kept = selectedAttendDays(days, group);
  if (kept.length === 0) return { error: true };
  return { value: toAttendDays(kept, group) };
}

let rowSeq = 0;
const newRow = (groupId = '', attendDays = null) => ({ key: `row-${++rowSeq}`, groupId, attendDays });

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
    <input name={name} type={type} value={value||''} onChange={onChange}
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

  // Enrollment schedule (Fix 2): Student + Group + Selected Days = Enrollment. primaryDays is
  // the Primary enrollment's attend_days (null = every day the group meets); additional is the
  // complete Additional Groups list, each row with its own attend_days. Both are sent with the
  // student and applied by the backend in one transaction (studentCreate.js / crud.js).
  const [primaryDays, setPrimaryDays]     = useState(null);
  const [hasAdditional, setHasAdditional] = useState(false);
  const [additional, setAdditional]       = useState([]);
  const [scheduleError, setScheduleError] = useState('');
  // Edit: the student's current enrollments must load before the schedule can be saved —
  // 'failed' saves the student WITHOUT schedule fields, so the backend leaves every enrollment
  // untouched rather than overwriting it with an empty list.
  const [scheduleState, setScheduleState] = useState(editId ? 'loading' : 'ready');

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
    setPrimaryDays(null);
  };

  // ── Enrollment schedule (Fix 2) — state declared above, next to useForm ──
  useEffect(() => {
    if (!editId) { setScheduleState('ready'); return undefined; }
    let cancelled = false;
    setScheduleState('loading');
    pgGetStudentEnrollments(editId)
      .then((rows) => {
        if (cancelled) return;
        const primary = rows.find((r) => r.role === 'primary');
        const rowsAdditional = rows.filter((r) => r.role === 'additional')
          .map((r) => newRow(r.groupId, r.attendDays ?? null));
        setPrimaryDays(primary?.attendDays ?? null);
        setAdditional(rowsAdditional);
        setHasAdditional(rowsAdditional.length > 0);
        setScheduleState('ready');
      })
      .catch(() => { if (!cancelled) setScheduleState('failed'); });
    return () => { cancelled = true; };
  }, [editId]);

  const handlePrimaryChange = (e) => {
    handleChange(e);
    setPrimaryDays(null); // a newly chosen Primary Group starts with all of its days
    setScheduleError('');
  };

  const groupById = (id) => groups.find((g) => g.id === id);

  // Additional Group options for one row: same-grade groups (plus the row's own current group,
  // e.g. legacy data from another grade), never the Primary or a group another row already has.
  const additionalOptions = (row) => {
    const taken = new Set([values.groupId, ...additional.filter((a) => a.key !== row.key).map((a) => a.groupId)]);
    const own = row.groupId && !gradeGroups.some((g) => g.id === row.groupId) ? [groupById(row.groupId)].filter(Boolean) : [];
    return [...own, ...gradeGroups].filter((g) => !taken.has(g.id) || g.id === row.groupId);
  };

  const updateRow = (key, patch) => {
    setAdditional((prev) => prev.map((a) => (a.key === key ? { ...a, ...patch } : a)));
    setScheduleError('');
  };

  const toggleAdditional = (checked) => {
    setHasAdditional(checked);
    setAdditional(checked ? [newRow()] : []);
    setScheduleError('');
  };

  // Validates the schedule and builds the request fields, or returns { error }.
  const buildSchedule = () => {
    if (scheduleState !== 'ready') return {};
    const rows = hasAdditional ? additional : [];
    if (rows.some((a) => !a.groupId)) return { error: 'اختر المجموعة لكل مجموعة إضافية أو احذف السطر الفارغ.' };
    const ids = rows.map((a) => a.groupId);
    if (new Set(ids).size !== ids.length) return { error: 'لا يمكن اختيار نفس المجموعة الإضافية مرتين.' };
    if (values.groupId && ids.includes(values.groupId)) return { error: 'المجموعة الرئيسية لا يمكن اختيارها كمجموعة إضافية أيضاً.' };

    let primaryAttendDays;
    if (values.groupId) {
      const p = normalizeAttendDays(primaryDays, groupById(values.groupId));
      if (p.error) return { error: 'اختر أيام حضور الطالب في المجموعة الرئيسية.' };
      primaryAttendDays = p.value;
    }
    const additionalGroups = [];
    for (const a of rows) {
      const n = normalizeAttendDays(a.attendDays, groupById(a.groupId));
      if (n.error) return { error: `اختر أيام الحضور في "${groupById(a.groupId)?.name || 'المجموعة الإضافية'}".` };
      additionalGroups.push({ groupId: a.groupId, attendDays: n.value });
    }
    return { fields: { primaryAttendDays, additionalGroups } };
  };

  const handleSubmit = () => {
    const valid = validate();
    const schedule = buildSchedule();
    setScheduleError(schedule.error || '');
    if (!valid || schedule.error) return;
    onSubmit({ ...values, ...schedule.fields });
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
        {/* المجموعة الرئيسية — تُعرض مجموعات الصف المختار فقط. Phase 3B: اختيارية — يمكن
            تسجيل/تعديل طالب بلا مجموعة رئيسية (المجموعات الإضافية تُدار من ملف الطالب). */}
        <Field label="المجموعة الرئيسية" error={err('groupId')}>
          <Sel name="groupId" value={values.groupId} onChange={handlePrimaryChange} invalid={isEr('groupId')}>
            <option value="">
              {!values.grade
                ? 'اختر السنة الدراسية أولاً...'
                : gradeGroups.length === 0
                  ? 'لا توجد مجموعات لهذا الصف — بدون مجموعة رئيسية'
                  : 'بدون مجموعة رئيسية (اختياري)'}
            </option>
            {visibleGroups.map(g => <option key={g.id} value={g.id}>{g.name} — {g.subject}</option>)}
          </Sel>
          {selectedGroupObj && scheduleState === 'ready' && (
            <div style={{ marginTop:8 }}>
              <AttendDaysPicker group={selectedGroupObj} value={primaryDays}
                onChange={(d) => { setPrimaryDays(d); setScheduleError(''); }}
                label="أيام حضور الطالب في المجموعة الرئيسية"/>
            </div>
          )}
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

      {/* ── المجموعات الإضافية (Fix 2) — كل مجموعة بأيام حضورها الخاصة، بلا رسوم إضافية ── */}
      <div style={{ marginTop:16, paddingTop:14, borderTop:'1px solid var(--border)', display:'flex', flexDirection:'column', gap:10 }}>
        {scheduleState === 'loading' && (
          <div style={{ fontSize:'0.75rem', color:'var(--text3)' }}>جارٍ تحميل مجموعات الطالب...</div>
        )}
        {scheduleState === 'failed' && (
          <div style={{ fontSize:'0.75rem', color:'var(--orange)' }}>
            تعذّر تحميل مجموعات الطالب — ستُحفَظ بيانات الطالب فقط، دون أي تغيير على مجموعاته أو أيام حضوره.
          </div>
        )}
        {scheduleState === 'ready' && (
          <>
            <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:'0.82rem', fontWeight:700, cursor:'pointer' }}>
              <input type="checkbox" checked={hasAdditional} onChange={(e) => toggleAdditional(e.target.checked)}/>
              الطالب يحضر مجموعة أخرى (مجموعة إضافية)
            </label>
            {hasAdditional && additional.map((row, i) => {
              const rowGroup = groupById(row.groupId);
              return (
                <div key={row.key} data-testid={`additional-row-${i}`}
                  style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:12, padding:12, display:'flex', flexDirection:'column', gap:8 }}>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    <div style={{ flex:1 }}>
                      <Sel name={`additional-${i}`} value={row.groupId}
                        onChange={(e) => updateRow(row.key, { groupId: e.target.value, attendDays: null })}>
                        <option value="">{values.grade ? 'اختر المجموعة الإضافية...' : 'اختر السنة الدراسية أولاً...'}</option>
                        {additionalOptions(row).map(g => (
                          <option key={g.id} value={g.id}>{g.name} — {g.subject}{g.days?.length ? ` (${formatDays(g.days)})` : ''}</option>
                        ))}
                      </Sel>
                    </div>
                    <Button variant="ghost" size="sm"
                      onClick={() => {
                        const next = additional.filter(a => a.key !== row.key);
                        setAdditional(next);
                        if (next.length === 0) setHasAdditional(false);
                        setScheduleError('');
                      }}>حذف</Button>
                  </div>
                  {rowGroup && (
                    <AttendDaysPicker group={rowGroup} value={row.attendDays}
                      onChange={(d) => updateRow(row.key, { attendDays: d })}/>
                  )}
                </div>
              );
            })}
            {hasAdditional && (
              <div>
                <Button variant="ghost" size="sm" onClick={() => setAdditional(prev => [...prev, newRow()])}>+ إضافة مجموعة أخرى</Button>
              </div>
            )}
          </>
        )}
        {scheduleError && (
          <div style={{ fontSize:'0.75rem', color:'var(--red)' }}>⚠ {scheduleError}</div>
        )}
      </div>

      <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20, paddingTop:16, borderTop:'1px solid var(--border)' }}>
        <Button variant="secondary" onClick={onCancel}>إلغاء</Button>
        <Button variant="primary" loading={loading} disabled={scheduleState === 'loading'} onClick={handleSubmit}>
          💾 {editId ? 'حفظ التعديلات' : 'تسجيل الطالب'}
        </Button>
      </div>
    </div>
  );
}
