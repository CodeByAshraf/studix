// src/modules/payments/PaymentForm.jsx
import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../store/app.store';
import useForm     from '../../hooks/useForm';
import { validatePayment, PAYMENT_METHODS, PAYMENT_TYPES, MONTHS_AR, getStudentFee } from '../../services/paymentService';
import Button      from '../../components/ui/Button';
import { ConfirmModal } from '../../components/ui/Modal';
import { useToast } from '../../components/Toast';

const PALETTE = [
  { bg:'rgba(59,130,246,.18)', color:'#3b82f6' },
  { bg:'rgba(16,185,129,.18)', color:'#10b981' },
  { bg:'rgba(245,158,11,.18)', color:'#f59e0b' },
  { bg:'rgba(139,92,246,.18)', color:'#8b5cf6' },
  { bg:'rgba(239,68,68,.18)',  color:'#ef4444' },
];
const avStyle = (name='') => PALETTE[((name.charCodeAt(0)||0)+(name.charCodeAt(1)||0))%PALETTE.length];

const BASE = {
  background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9,
  padding:'9px 12px', color:'var(--text)', fontFamily:'Cairo,sans-serif',
  fontSize:'0.875rem', outline:'none', width:'100%', direction:'rtl',
  transition:'border-color .15s, box-shadow .15s',
};
const focus = e => { e.target.style.borderColor='var(--accent)'; e.target.style.boxShadow='0 0 0 3px rgba(13,148,136,.12)'; e.target.style.background='var(--surface3)'; };
const blur  = (invalid) => e => { e.target.style.borderColor=invalid?'var(--red)':'var(--border)'; e.target.style.boxShadow='none'; e.target.style.background=invalid?'rgba(239,68,68,.05)':'var(--surface2)'; };

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
    onFocus={focus} onBlur={blur(invalid)}/>
);

const Sel = ({ name, value, onChange, children, invalid }) => (
  <select name={name} value={value||''} onChange={onChange}
    style={{ ...BASE, cursor:'pointer', borderColor:invalid?'var(--red)':'var(--border)' }}
    onFocus={focus} onBlur={blur(invalid)}
  >{children}</select>
);

const EMPTY = {
  studentId:'', month:new Date().getMonth()+1, year:new Date().getFullYear(),
  amount:'', method:'cash', payType:'subscription', materialId:'', date:new Date().toISOString().split('T')[0], notes:'',
  cashboxId:'',
};

export default function PaymentForm({ onSubmit, onCancel, loading, prefilledStudentId }) {
  const groups               = useAppStore((s) => s.groups);
  const payments             = useAppStore((s) => s.payments);
  const students             = useAppStore((s) => s.students);
  const materials            = useAppStore((s) => s.invMaterials);
  const cashboxes            = useAppStore((s) => s.cashboxes);
  const toast                = useToast();
  const [confirmMaterial, setConfirmMaterial] = useState(false);
  const { values, errors, touched, handleChange, validate, setField } = useForm(EMPTY, validatePayment);

  // Phase 3B-14C (قرار 3 صريح): لا خزنة افتراضية ضمنية بأي شكل — الحقل يبدأ فارغاً
  // دائماً، حتى لو كانت هناك خزنة نشطة واحدة فقط؛ المستخدم يجب أن يختارها صراحةً بنفسه،
  // والتحقّق (paymentSchema.cashboxId) يمنع الإرسال بلا اختيار فعلي.
  const activeCashboxes = useMemo(() => cashboxes.filter(cb => cb.active), [cashboxes]);

  useEffect(() => { if (prefilledStudentId) setField('studentId', prefilledStudentId); }, [prefilledStudentId]);

  const selectedStudent = students.find(s => s.id === values.studentId);
  const selectedGroup   = groups.find(g => g.id === selectedStudent?.groupId);

  useEffect(() => {
    if (selectedStudent && getStudentFee(selectedStudent, selectedGroup) && !values.amount) setField('amount', String(getStudentFee(selectedStudent, selectedGroup)));
  }, [selectedGroup?.id]);

  // MEDIUM-A Finding 1: يجب مطابقة السنة أيضاً، لا الشهر فقط — طالب دفع اشتراك أكتوبر
  // 2025 لا يجب أن يُعتبر "دافع بالفعل" عند تسجيل اشتراك أكتوبر 2026 (نفس رقم الشهر،
  // سنة مختلفة). values.year قادم من <select> فيصل كنص دائماً، بنفس نمط Number(values.month).
  const monthPayments = useMemo(() =>
    payments.filter(p => p.studentId === values.studentId && p.month === Number(values.month) && p.year === Number(values.year)),
  [payments, values.studentId, values.month, values.year]);

  // مذكرات السنة الدراسية للطالب المختار (تظهر عند اختيار نوع الدفع = مذكرة).
  const gradeMaterials = useMemo(() => {
    if (!selectedStudent) return [];
    return (materials || []).filter(m => m.grade === selectedStudent.grade);
  }, [materials, selectedStudent]);

  // هل دفع الطالب اشتراك هذا الشهر من قبل؟ (يوقف العملية)
  const alreadyPaidSubscription = useMemo(() =>
    monthPayments.some(p => (p.payType || 'subscription') === 'subscription'),
  [monthPayments]);

  // هل دفع الطالب هذه المذكرة تحديداً من قبل؟ (تحذير فقط)
  const alreadyPaidMaterial = useMemo(() => {
    if (!values.materialId) return false;
    return payments.some(p =>
      p.studentId === values.studentId &&
      p.payType === 'material' &&
      p.materialId === values.materialId
    );
  }, [payments, values.studentId, values.materialId]);

  const selectedMaterial = gradeMaterials.find(m => m.id === values.materialId);

  const totalPaid = monthPayments.reduce((s, p) => s + p.amount, 0);
  const remaining = selectedStudent ? Math.max(0, getStudentFee(selectedStudent, selectedGroup) - totalPaid) : null;

  const err  = f => touched[f] && errors[f];
  const isEr = f => !!(touched[f] && errors[f]);

  return (
    <div>
      {/* Student preview */}
      {selectedStudent && (() => {
        const { bg, color } = avStyle(selectedStudent.name);
        const letters = selectedStudent.name.split(' ').map(w=>w[0]).slice(0,2).join('');
        return (
          <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', background:'var(--surface2)', borderRadius:12, marginBottom:16, border:'1px solid var(--border)' }}>
            <div style={{ width:40, height:40, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.85rem', fontWeight:700, flexShrink:0 }}>
              {letters}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700 }}>{selectedStudent.name}</div>
              <div style={{ fontSize:'0.72rem', color:'var(--text3)' }}>
                {selectedStudent?.name} · الاشتراك: <span style={{ color:'var(--green)', fontWeight:700, fontFamily:'Cairo,sans-serif' }}>{getStudentFee(selectedStudent, selectedGroup)||'—'} ج.م</span>
              </div>
            </div>
            {remaining !== null && remaining > 0 && (
              <div style={{ textAlign:'center', background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.2)', borderRadius:8, padding:'6px 10px' }}>
                <div style={{ fontSize:'0.65rem', color:'var(--text3)' }}>متبقي هذا الشهر</div>
                <div style={{ fontSize:'0.9rem', fontWeight:800, color:'#ef4444', fontFamily:'Cairo,sans-serif' }}>{remaining} ج.م</div>
              </div>
            )}
          </div>
        );
      })()}

      {/* لا خزنة نشطة إطلاقاً — فشل واضح، لا افتراض صامت (قرار Phase 3B-14C الصريح) */}
      {activeCashboxes.length === 0 && (
        <div style={{ padding:'11px 14px', marginBottom:14, background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.3)', borderRadius:9, fontSize:'0.82rem', color:'#dc2626', display:'flex', alignItems:'center', gap:8 }}>
          ❌ لا توجد خزنة نشطة لتسجيل الدفعة. أنشئ خزنة من صفحة الخزنة أولاً.
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        {/* تحذير: اشتراك هذا الشهر مدفوع من قبل (يوقف العملية) */}
        {values.payType === 'subscription' && alreadyPaidSubscription && selectedStudent && (
          <div style={{ gridColumn:'1/-1', padding:'11px 14px', background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.3)', borderRadius:9, fontSize:'0.82rem', color:'#dc2626', display:'flex', alignItems:'center', gap:8 }}>
            ❌ هذا الطالب دفع اشتراك {MONTHS_AR[Number(values.month)] || 'هذا الشهر'} من قبل — لا يمكن تسجيل دفعة اشتراك أخرى لنفس الشهر.
          </div>
        )}
        <div style={{ gridColumn:'1/-1' }}>
          <F label="الطالب" required error={err('studentId')}>
            <Sel name="studentId" value={values.studentId} onChange={handleChange} invalid={isEr('studentId')}>
              <option value="">اختر الطالب...</option>
              {students.filter(s=>s.status==='active').map(s => {
                const g = groups.find(g=>g.id===s.groupId);
                return <option key={s.id} value={s.id}>{s.name} — {g?.name||'بلا مجموعة'}</option>;
              })}
            </Sel>
          </F>
        </div>

        <F label="الشهر" required error={err('month')}>
          <Sel name="month" value={values.month} onChange={handleChange} invalid={isEr('month')}>
            {MONTHS_AR.slice(1).map((m,i) => <option key={i+1} value={i+1}>{m}</option>)}
          </Sel>
        </F>

        <F label="السنة">
          <Sel name="year" value={values.year} onChange={handleChange}>
            {[2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
          </Sel>
        </F>

        <F label="نوع الدفع" required>
          <Sel name="payType" value={values.payType} onChange={handleChange}>
            {Object.entries(PAYMENT_TYPES).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </Sel>
        </F>

        {/* اختيار المذكرة — يظهر فقط عند نوع الدفع "مذكرة دراسية" */}
        {values.payType === 'material' && (
          <div style={{ gridColumn:'1/-1' }}>
            <F label="المذكرة" required>
              <Sel name="materialId" value={values.materialId} onChange={(e) => {
                handleChange(e);
                const m = gradeMaterials.find(x => x.id === e.target.value);
                if (m?.price) setField('amount', String(m.price));
              }}>
                <option value="">
                  {!selectedStudent ? 'اختر الطالب أولاً...'
                    : gradeMaterials.length === 0 ? `لا توجد مذكرات لـ ${selectedStudent.grade}`
                    : 'اختر المذكرة...'}
                </option>
                {gradeMaterials.map(m => (
                  <option key={m.id} value={m.id}>{m.name}{m.subject ? ` — ${m.subject}` : ''} ({m.price} ج.م)</option>
                ))}
              </Sel>
            </F>
            {alreadyPaidMaterial && (
              <div style={{ marginTop:8, padding:'10px 12px', background:'rgba(245,158,11,.1)', border:'1px solid rgba(245,158,11,.3)', borderRadius:8, fontSize:'0.8rem', color:'#b45309', display:'flex', alignItems:'center', gap:8 }}>
                ⚠ هذا الطالب دفع ثمن هذه المذكرة من قبل. يمكنك المتابعة إذا كنت متأكداً.
              </div>
            )}
          </div>
        )}

        <F label="المبلغ (ج.م)" required error={err('amount')}>
          <I name="amount" value={values.amount} onChange={handleChange} type="number" min="1" placeholder={getStudentFee(selectedStudent, selectedGroup)||'500'} invalid={isEr('amount')}/>
        </F>

        <F label="طريقة الدفع">
          <Sel name="method" value={values.method} onChange={handleChange}>
            {Object.entries(PAYMENT_METHODS).map(([k,v]) => (
              <option key={k} value={k}>{v.icon} {v.label}</option>
            ))}
          </Sel>
        </F>

        <F label="الخزنة" required error={err('cashboxId')}>
          <Sel name="cashboxId" value={values.cashboxId} onChange={handleChange} invalid={isEr('cashboxId')}>
            <option value="">اختر الخزنة...</option>
            {activeCashboxes.map(cb => <option key={cb.id} value={cb.id}>{cb.name}</option>)}
          </Sel>
        </F>

        <div style={{ gridColumn:'1/-1' }}>
          <F label="تاريخ الدفع" required error={err('date')}>
            <I name="date" value={values.date} onChange={handleChange} type="date" invalid={isEr('date')}/>
          </F>
        </div>

        <div style={{ gridColumn:'1/-1' }}>
          <F label="ملاحظات">
            <textarea name="notes" value={values.notes} onChange={handleChange} placeholder="أي ملاحظات..." rows={2}
              style={{ ...BASE, resize:'vertical', minHeight:60 }}
              onFocus={focus} onBlur={e=>{e.target.style.borderColor='var(--border)';e.target.style.boxShadow='none';}}/>
          </F>
        </div>
      </div>

      <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20, paddingTop:16, borderTop:'1px solid var(--border)' }}>
        <Button variant="secondary" onClick={onCancel}>إلغاء</Button>
        <Button variant="primary" loading={loading} disabled={activeCashboxes.length === 0} onClick={() => {
          if (!validate()) return;

          // اشتراك مكرر لنفس الشهر → أوقف العملية تماماً (toast بدل alert)
          if (values.payType === 'subscription' && alreadyPaidSubscription) {
            const monthName = MONTHS_AR[Number(values.month)] || `شهر ${values.month}`;
            toast.error(`الطالب "${selectedStudent?.name}" دفع اشتراك ${monthName} من قبل — لا يمكن تسجيل دفعة أخرى.`);
            return;
          }

          // مذكرة: لازم اختيار مذكرة
          if (values.payType === 'material' && !values.materialId) {
            toast.error('اختر المذكرة أولاً.');
            return;
          }

          // مذكرة مدفوعة من قبل → مودال تأكيد احترافي
          if (values.payType === 'material' && alreadyPaidMaterial) {
            setConfirmMaterial(true);
            return;
          }

          onSubmit(values);
        }}>
          💰 تسجيل الدفعة
        </Button>
      </div>

      {/* مودال تأكيد: مذكرة مدفوعة من قبل */}
      <ConfirmModal
        isOpen={confirmMaterial}
        onClose={() => setConfirmMaterial(false)}
        onConfirm={() => { setConfirmMaterial(false); onSubmit(values); }}
        title="مذكرة مدفوعة من قبل"
        message={`الطالب "${selectedStudent?.name}" دفع ثمن مذكرة "${selectedMaterial?.name}" من قبل. هل تريد المتابعة وتسجيل الدفعة؟`}
        confirmLabel="نعم، تابع التسجيل"
      />
    </div>
  );
}
