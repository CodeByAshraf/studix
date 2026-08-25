// src/modules/payments/PaymentsPage.jsx
import { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../../store/app.store';
import { useAuth }     from '../../store/auth.context';
import { SectionBoundary } from '../../components/ErrorBoundary';
import { Modal } from '../../components/ui/Modal';
import Button        from '../../components/ui/Button';
import { useToast }  from '../../components/Toast';
import { useErrorHandler } from '../../hooks/useErrorHandler';
import {
  MONTHS_AR, getMonthlyRevenue, getUnpaidStudents,
  getRefundedAmount, getRemainingRefundable,
} from '../../services/paymentService';
import { pgCreatePayment, pgRefundPayment } from '../../services/api';
import { formatCurrency }  from '../../utils/helpers';
import PaymentForm    from './PaymentForm';
import PaymentHistory from './PaymentHistory';
import UnpaidStudents from './UnpaidStudents';
import PaymentReports from './PaymentReports';
import { ReceiptPreview, printReceipt } from '../id-cards/components/PaymentReceipt';

const VIEWS = [
  { id:'add',     icon:'💰', label:'تسجيل دفعة'   },
  { id:'history', icon:'📋', label:'سجل المدفوعات' },
  { id:'unpaid',  icon:'⚠',  label:'لم يدفعوا'     },
  { id:'refund',  icon:'↩️', label:'استرداد'        },
  { id:'reports', icon:'📊', label:'التقارير'       },
];

function KPI({ icon, label, value, color = 'var(--text)', sub, alert, onClick }) {
  return (
    <div style={{
      background:'var(--surface)', border:`1px solid ${alert ? 'rgba(239,68,68,.3)' : 'var(--border)'}`,
      borderRadius:14, padding:'16px 18px',
      cursor:onClick?'pointer':'default', transition:'transform .12s, box-shadow .12s',
    }}
      onMouseOver={e => { if (onClick) { e.currentTarget.style.transform='translateY(-1px)'; e.currentTarget.style.boxShadow='0 4px 20px rgba(0,0,0,.2)'; }}}
      onMouseOut={e  => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=''; }}
      onClick={onClick}
    >
      <div style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize:'1.55rem', fontWeight:800, color, fontFamily:'Cairo,sans-serif', letterSpacing:'-0.4px', lineHeight:1 }}>{value}</div>
      {sub && <div style={{ fontSize:'0.7rem', color:'var(--text3)', marginTop:5 }}>{sub}</div>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
export default function PaymentsPage() {
  // Zustand selectors
  const payments           = useAppStore((s) => s.payments);
  const setPayments        = useAppStore((s) => s.setPayments);
  const students           = useAppStore((s) => s.students);
  const groups             = useAppStore((s) => s.groups);
  const setTreasuryTxn     = useAppStore((s) => s.setTreasuryTxn);
  const treasuryTxn        = useAppStore((s) => s.treasuryTxn);
  const cashboxes          = useAppStore((s) => s.cashboxes);
  const addLog             = useAppStore((s) => s.addLog);
  const { currentUser }    = useAuth();
  const toast = useToast();
  const { loading, run } = useErrorHandler(toast);

  const [view,              setView]             = useState('history');
  const [addModalOpen,      setAddModalOpen]      = useState(false);
  // Phase 3B-14C (قرار 4 صريح): لا حذف حقيقي للدفعات إطلاقاً — الزر الذي كان "حذف
  // الدفعة" أصبح يفتح مودال "استرداد كامل" (المبلغ المتبقي القابل للاسترداد + سبب
  // مطلوب)، بدل أي حذف/تعديل مباشر على سجل الدفعة الثابت (immutable).
  const [fullRefundTarget,  setFullRefundTarget]  = useState(null);
  const [fullRefundReason,  setFullRefundReason]  = useState('');
  const [prefilledStudentId,setPrefilledStudentId]= useState('');
  // بعد تسجيل الدفعة: يحمل بيانات الإيصال لعرض مودال "طباعة الإيصال؟"
  const [receiptPrompt,     setReceiptPrompt]     = useState(null);

  const currentMonth = new Date().getMonth() + 1;
  const currentYear  = new Date().getFullYear();

  // ── KPI data ──────────────────────────────────────────────
  const kpi = useMemo(() => {
    const monthRevenue = getMonthlyRevenue(payments, currentMonth, currentYear);
    const totalRevenue = payments.reduce((s, p) => s + p.amount, 0);
    const unpaidCount  = getUnpaidStudents(students, payments, currentMonth, currentYear).length;
    const todayStr     = new Date().toISOString().split('T')[0];
    const todayRevenue = payments.filter(p => p.date === todayStr).reduce((s, p) => s + p.amount, 0);
    const thisMonthCount = payments.filter(p => p.month === currentMonth && p.year === currentYear).length;
    return { monthRevenue, totalRevenue, unpaidCount, todayRevenue, thisMonthCount };
  }, [payments, students, currentMonth, currentYear]);

  // ── Add payment ───────────────────────────────────────────
  const openAdd = useCallback((studentId = '') => {
    setPrefilledStudentId(studentId);
    setAddModalOpen(true);
    if (view !== 'add') setView('history');
  }, [view]);

  const closeAdd = useCallback(() => {
    setAddModalOpen(false);
    setPrefilledStudentId('');
  }, []);

  // ── Add payment (Phase 3B-14C: ذرّي، خادم-الحقيقة بالكامل) ──────────────
  // لا تعديل محلي قبل نجاح الخادم إطلاقاً — عند النجاح تُتبنّى استجابة الخادم الكاملة
  // (payment + treasuryTxn معاً)؛ عند الفشل، لا تغيير على الإطلاق لأي من الـ collections.
  const handleSave = useCallback(async (formData) => {
    await run(async () => {
      const student = students.find(s => s.id === formData.studentId);
      const group   = groups.find(g => g.id === student?.groupId);

      const { payment, treasuryTxn: newTxn } = await pgCreatePayment({
        studentId:  formData.studentId,
        groupId:    student?.groupId || null,
        materialId: formData.materialId || null,
        month:      Number(formData.month),
        year:       Number(formData.year),
        amount:     Number(formData.amount),
        method:     formData.method,
        payType:    formData.payType,
        date:       formData.date,
        notes:      formData.notes || null,
        cashboxId:  formData.cashboxId,
      });

      setPayments(prev => [payment, ...prev]);
      setTreasuryTxn(prev => [...prev, newTxn]);

      addLog({ action:'create', module:'payments', entityType:'payment', entityId:payment.id, description:`دفعة: ${student?.name} — ${payment.amount} ج.م` })
        .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
      toast.success(`تم تسجيل دفعة ${student?.name} بنجاح ✓`);
      closeAdd();
      // اعرض خيار طباعة الإيصال لأي عملية دفع (اختياري — للمستخدم أن يطبع أو يتخطّى)
      setReceiptPrompt({ payment, student, group });
    }, { errorMsg: 'فشل تسجيل الدفعة' });
  }, [students, groups, setPayments, setTreasuryTxn, run, toast, addLog, currentUser, closeAdd]);

  // ── Full refund (يحلّ محلّ "حذف الدفعة" القديم — قرار Phase 3B-14C صريح) ──
  // الدفعة سجل ثابت (immutable) — لا حذف، لا تعديل. هذا يسترد فقط المبلغ المتبقي
  // القابل للاسترداد من هذه الدفعة، عبر حركة treasury_txn جديدة مرتبطة، بنفس خزنة
  // الدفعة الأصلية دائماً (لا اختيار/افتراض بديل — قرار صريح). لا تعديل محلي قبل نجاح
  // الخادم؛ عند الفشل لا تغيير على الإطلاق.
  const handleFullRefund = useCallback(async () => {
    const p = fullRefundTarget;
    const remaining = getRemainingRefundable(p, treasuryTxn);
    if (!fullRefundReason.trim()) { toast.error('اكتب سبب الاسترداد'); return; }
    await run(async () => {
      const { refundTxn } = await pgRefundPayment(p.id, remaining, fullRefundReason.trim());
      setTreasuryTxn(prev => [...prev, refundTxn]);
      addLog({ action:'update', module:'payments', entityType:'payment', entityId:p.id,
        description:`استرداد كامل (${remaining} ج.م) لدفعة ${p.id}: ${fullRefundReason.trim()}` })
        .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
      toast.info(`تم استرداد ${remaining} ج.م بالكامل`);
      setFullRefundTarget(null);
      setFullRefundReason('');
    }, { errorMsg: 'فشل الاسترداد' });
  }, [fullRefundTarget, fullRefundReason, treasuryTxn, setTreasuryTxn, run, toast, addLog, currentUser]);

  return (
    <div>
      {/* ── Page header ─────────────────────── */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:14, padding:'0 28px', marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:'1.35rem', fontWeight:800, letterSpacing:'-0.3px', marginBottom:3 }}>إدارة المدفوعات</h1>
          <p style={{ fontSize:'0.78rem', color:'var(--text3)' }}>الرسوم الشهرية وتقارير الإيراد</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => openAdd()}>+ تسجيل دفعة</Button>
      </div>

      {/* ── KPIs ────────────────────────────── */}
      <SectionBoundary label="Payment KPIs">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12, padding:'0 28px', marginBottom:24 }}>
          <KPI icon="💰" label={`إيراد ${MONTHS_AR[currentMonth]}`} value={formatCurrency(kpi.monthRevenue)} color="var(--green)" sub={`${kpi.thisMonthCount} دفعة`}/>
          <KPI icon="📅" label="إيراد اليوم" value={formatCurrency(kpi.todayRevenue)} color="var(--accent)"/>
          <KPI icon="📊" label="الإيراد الكلي" value={formatCurrency(kpi.totalRevenue)} color="#3b82f6"/>
          <KPI icon="⚠" label="لم يدفعوا" value={kpi.unpaidCount} color={kpi.unpaidCount>0?'#ef4444':'#10b981'} alert={kpi.unpaidCount>0}
            sub={kpi.unpaidCount>0 ? 'اضغط للمتابعة' : 'الكل دفع ✓'} onClick={() => setView('unpaid')}/>
          <KPI icon="👥" label="عدد الطلاب النشطين" value={students.filter(s=>s.status==='active').length}/>
        </div>
      </SectionBoundary>

      {/* ── View switcher ────────────────────── */}
      <div style={{ display:'flex', gap:2, padding:'0 28px', marginBottom:22 }}>
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => setView(v.id)}
            style={{
              display:'flex', alignItems:'center', gap:6,
              padding:'9px 18px', borderRadius:10, fontSize:'0.88rem',
              fontWeight: view===v.id ? 700 : 500, cursor:'pointer',
              fontFamily:'Cairo,sans-serif', transition:'all .15s',
              border:`1.5px solid ${view===v.id ? 'var(--accent)' : 'var(--border)'}`,
              background: view===v.id ? 'rgba(13,148,136,.1)' : 'transparent',
              color:      view===v.id ? 'var(--accent)' : 'var(--text2)',
            }}
            onMouseOver={e => { if (view!==v.id) { e.currentTarget.style.background='var(--surface2)'; e.currentTarget.style.color='var(--text)'; }}}
            onMouseOut={e  => { if (view!==v.id) { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='var(--text2)'; }}}
          >
            <span>{v.icon}</span>{v.label}
          </button>
        ))}
      </div>

      {/* ── Content ──────────────────────────── */}
      <div style={{ padding:'0 28px 40px', animation:'pageIn .2s ease' }}>
        <SectionBoundary label={`payments:${view}`}>
          {view === 'add' && (
            <div style={{ maxWidth:560 }}>
              <PaymentForm onSubmit={handleSave} onCancel={() => setView('history')} loading={loading}/>
            </div>
          )}
          {view === 'history' && (
            <PaymentHistory
              onAddPayment={() => openAdd()}
              onDeletePayment={p => setFullRefundTarget(p)}
            />
          )}
          {view === 'unpaid'  && <UnpaidStudents onQuickPay={(id) => openAdd(id)}/>}
          {view === 'refund'  && <RefundView students={students} payments={payments} treasuryTxn={treasuryTxn} setTreasuryTxn={setTreasuryTxn} addLog={addLog} currentUser={currentUser} toast={toast}/>}
          {view === 'reports' && <PaymentReports/>}
        </SectionBoundary>
      </div>

      {/* ── Add payment modal ────────────────── */}
      <Modal isOpen={addModalOpen} onClose={closeAdd} title="تسجيل دفعة جديدة" size="md">
        <PaymentForm
          onSubmit={handleSave}
          onCancel={closeAdd}
          loading={loading}
          prefilledStudentId={prefilledStudentId}
        />
      </Modal>

      {/* ── استرداد كامل (يحلّ محلّ حذف الدفعة القديم — الدفعة سجل ثابت) ────── */}
      <Modal
        isOpen={!!fullRefundTarget}
        onClose={() => { setFullRefundTarget(null); setFullRefundReason(''); }}
        title="↩️ استرداد كامل"
        size="sm"
        footer={
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end', width:'100%' }}>
            <Button variant="secondary" onClick={() => { setFullRefundTarget(null); setFullRefundReason(''); }}>إلغاء</Button>
            <Button variant="primary" loading={loading} onClick={handleFullRefund}>تأكيد الاسترداد الكامل</Button>
          </div>
        }
      >
        {fullRefundTarget && (() => {
          const remaining = getRemainingRefundable(fullRefundTarget, treasuryTxn);
          return (
            <div>
              <p style={{ color:'var(--text2)', fontSize:'0.88rem', marginBottom:16 }}>
                سيتم استرداد المبلغ المتبقي القابل للاسترداد من هذه الدفعة بالكامل
                (<strong style={{ color:'var(--red)' }}>{formatCurrency(remaining)}</strong>)
                من نفس الخزنة التي دخل إليها المبلغ الأصلي. الدفعة نفسها تبقى كما هي —
                لا يمكن التراجع.
              </p>
              <label style={{ fontSize:'0.75rem', fontWeight:700, color:'var(--text3)', display:'block', marginBottom:6 }}>
                سبب الاسترداد <span style={{ color:'var(--red)' }}>*</span>
              </label>
              <textarea value={fullRefundReason} onChange={e => setFullRefundReason(e.target.value)} rows={2}
                placeholder="مثال: خطأ في التسجيل"
                style={{ width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'10px 12px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.88rem', direction:'rtl', resize:'vertical' }}/>
            </div>
          );
        })()}
      </Modal>

      {/* ── إيصال الدفع (اختياري) ───────────────────── */}
      <Modal
        isOpen={!!receiptPrompt}
        onClose={() => setReceiptPrompt(null)}
        title="🧾 إيصال الدفع"
        size="sm"
        footer={
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end', width:'100%' }}>
            <Button variant="secondary" onClick={() => setReceiptPrompt(null)}>تخطّي</Button>
            <Button variant="primary" onClick={() => {
              printReceipt(
                receiptPrompt.payment,
                receiptPrompt.student,
                receiptPrompt.group,
                receiptPrompt.payment?.recordedBy || currentUser?.name || currentUser?.id
              );
              setReceiptPrompt(null);
            }}>🖨 طباعة الإيصال</Button>
          </div>
        }
      >
        {receiptPrompt && (
          <div>
            <p style={{ textAlign:'center', color:'var(--text2)', fontSize:'0.9rem', marginBottom:16 }}>
              تم تسجيل الدفعة بنجاح. يمكنك طباعة الإيصال أو تخطّيه.
            </p>
            <ReceiptPreview
              payment={receiptPrompt.payment}
              student={receiptPrompt.student}
              group={receiptPrompt.group}
              operator={receiptPrompt.payment?.recordedBy || currentUser?.name || currentUser?.id}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// شاشة الاسترداد — رد فلوس لطالب (مثل إلغاء حجز)
// ═══════════════════════════════════════════════════════════════════════════
function RefundView({ students, payments, treasuryTxn, setTreasuryTxn, addLog, currentUser, toast }) {
  const [studentId, setStudentId] = useState('');
  const [refundTarget, setRefundTarget] = useState(null); // الدفعة المراد ردّها
  const [refundAmount, setRefundAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const student = students.find(s => s.id === studentId);

  // دفعات الطالب التي لا يزال لها مبلغ متبقٍ قابل للاسترداد (مُشتَقّ من treasury_txn
  // المرتبط — الدفعة نفسها ثابتة، لا حقل refunded عليها إطلاقاً — Phase 3B-14C).
  const studentPayments = useMemo(() => {
    if (!studentId) return [];
    return payments
      .filter(p => p.studentId === studentId && (p.amount || 0) > 0)
      .map(p => ({ ...p, remaining: getRemainingRefundable(p, treasuryTxn) }))
      .filter(p => p.remaining > 0);
  }, [payments, treasuryTxn, studentId]);

  const totalPaid = studentPayments.reduce((s, p) => s + p.remaining, 0);

  const PAY_TYPE_L = { subscription:'رسوم شهرية', material:'مذكرة', exam:'رسوم امتحان', extra:'مراجعة/حجز', other:'أخرى' };

  // خادم-الحقيقة بالكامل: لا تعديل محلي قبل نجاح الخادم؛ عند النجاح تُتبنّى حركة
  // الاسترداد الجديدة فقط (الدفعة نفسها لا تتغيّر أبداً — immutable). نفس خزنة الدفعة
  // الأصلية تُستخدَم دائماً على الخادم — لا يُرسَل/يُختار cashboxId هنا إطلاقاً.
  const doRefund = async () => {
    const amt = Number(refundAmount);
    if (!amt || amt <= 0) { toast.error('أدخل مبلغاً صحيحاً'); return; }
    if (amt > refundTarget.remaining) { toast.error(`المبلغ أكبر من المتبقي القابل للاسترداد (${refundTarget.remaining} ج.م)`); return; }
    if (!reason.trim()) { toast.error('اكتب سبب الاسترداد'); return; }

    setSubmitting(true);
    try {
      const { refundTxn } = await pgRefundPayment(refundTarget.id, amt, reason.trim());
      setTreasuryTxn(prev => [...prev, refundTxn]);
      addLog({ action: 'update', module: 'payments', entityType: 'payment', entityId: refundTarget.id, description: `استرداد ${amt} ج.م لـ ${student?.name}: ${reason.trim()}` })
        .catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));
      toast.success(`تم استرداد ${amt} ج.م لـ ${student?.name} ✓`);
      setRefundTarget(null); setRefundAmount(''); setReason('');
    } catch (e) {
      toast.error(e?.message || 'فشل الاسترداد');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SectionBoundary name="RefundView">
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 22, marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 6 }}>↩️ استرداد مبلغ لطالب</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text3)', marginBottom: 18 }}>
            اختر الطالب لعرض دفعاته، ثم حدّد الدفعة والمبلغ المراد ردّه. سيُخصم المبلغ من الخزنة.
          </div>

          <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text3)', display: 'block', marginBottom: 6 }}>الطالب</label>
          <select value={studentId} onChange={e => setStudentId(e.target.value)}
            style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', color: 'var(--text)', fontFamily: 'Cairo,sans-serif', fontSize: '0.88rem', cursor: 'pointer', direction: 'rtl' }}>
            <option value="">اختر الطالب...</option>
            {students.filter(s => s.status === 'active').map(s => <option key={s.id} value={s.id}>{s.name} — {s.code}</option>)}
          </select>
        </div>

        {studentId && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 800 }}>دفعات {student?.name}</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text3)' }}>الإجمالي المتاح: <strong style={{ color: 'var(--green)' }}>{formatCurrency(totalPaid)}</strong></div>
            </div>

            {studentPayments.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--text3)' }}>لا توجد دفعات قابلة للاسترداد</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {studentPayments.map(p => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{PAY_TYPE_L[p.payType] || 'دفعة'}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>{p.date}{p.notes ? ` · ${p.notes}` : ''}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontWeight: 800, color: 'var(--green)' }}>{formatCurrency(p.remaining)}</span>
                      <button onClick={() => { setRefundTarget(p); setRefundAmount(String(p.remaining)); setReason(''); }}
                        style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--red)', background: 'rgba(239,68,68,.08)', color: 'var(--red)', fontFamily: 'Cairo,sans-serif', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}>
                        استرداد
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* مودال تأكيد الاسترداد */}
        {refundTarget && (
          <div onClick={() => setRefundTarget(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: 420, maxWidth: '92vw' }}>
              <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: 4 }}>↩️ استرداد مبلغ</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text3)', marginBottom: 18 }}>
                {student?.name} · متبقٍ قابل للاسترداد {formatCurrency(refundTarget.remaining)}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text3)', display: 'block', marginBottom: 6 }}>المبلغ المراد ردّه (ج.م)</label>
                  <input type="number" min="1" max={refundTarget.remaining} value={refundAmount} onChange={e => setRefundAmount(e.target.value)}
                    style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', color: 'var(--text)', fontFamily: 'Cairo,sans-serif', fontSize: '0.88rem', direction: 'rtl' }} autoFocus/>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text3)', marginTop: 4 }}>يمكن رد جزء من المتبقي أو كله</div>
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text3)', display: 'block', marginBottom: 6 }}>سبب الاسترداد (إلغاء الحجز، ...) <span style={{ color: 'var(--red)' }}>*</span></label>
                  <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="مثال: إلغاء حجز الطالب"
                    style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', color: 'var(--text)', fontFamily: 'Cairo,sans-serif', fontSize: '0.88rem', direction: 'rtl', resize: 'vertical' }}/>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                <Button variant="secondary" onClick={() => setRefundTarget(null)} disabled={submitting}>إلغاء</Button>
                <Button variant="primary" onClick={doRefund} loading={submitting}>تأكيد الاسترداد</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </SectionBoundary>
  );
}
