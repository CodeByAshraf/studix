// src/modules/student-report/StudentReportPage.jsx
import { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../../store/app.store';
import { useAuth } from '../../store/auth.context';
import { useToast } from '../../components/Toast';
import { formatDate, formatCurrency } from '../../utils/helpers';
import { openStudentReportPrint } from './buildPrintReport';
import { generateStudentReport } from './buildStudentReport';
import { generateMessage, copyMessage, openWhatsapp } from './studentWhatsappService';
import WhatsappPreviewModal from './WhatsappPreviewModal';
import { pgCreateWaReportLog } from '../../services/api';
import { deriveMatDist } from '../../services/materialService';
import { getRefundedAmount } from '../../services/paymentService';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                   'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

const AV_PAL = [
  {bg:'#1a56db22',c:'#1a56db'},{bg:'#05966922',c:'#059669'},
  {bg:'#7c3aed22',c:'#7c3aed'},{bg:'#d9770622',c:'#d97706'},
  {bg:'#0d948822',c:'#0d9488'},{bg:'#e11d4822',c:'#e11d48'},
];
const av = n => AV_PAL[((n?.charCodeAt(0)||0)+(n?.charCodeAt(1)||0)) % AV_PAL.length];
const initials = n => (n||'').trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('');

const pctColor = p => p==null?'#94a3b8':p>=80?'#10b981':p>=60?'#f59e0b':'#ef4444';
const pctGrade = p => p==null?'—':p>=90?'A+':p>=80?'A':p>=70?'B':p>=60?'C':p>=50?'D':'F';

const HW_META = {
  submitted:{label:'سُلِّم',   c:'#10b981', bg:'#10b98118', icon:'✓'},
  late:     {label:'متأخر',    c:'#f59e0b', bg:'#f59e0b18', icon:'⏱'},
  missing:  {label:'لم يُسلَّم',c:'#ef4444', bg:'#ef444418', icon:'✗'},
};
const PAY_METHOD = {cash:'كاش',transfer:'تحويل',instapay:'انستاباي',check:'شيك'};
const PAY_STATUS_META = {
  paid:   {l:'مدفوع',    c:'#10b981', bg:'#10b98115'},
  partial:{l:'جزئي',     c:'#f59e0b', bg:'#f59e0b15'},
  unpaid: {l:'غير مدفوع',c:'#ef4444', bg:'#ef444415'},
};

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────
function KpiCard({ icon, label, value, sub, color='var(--accent)', alert }) {
  return (
    <div style={{
      background:'var(--surface)', border:`1px solid ${alert?'rgba(239,68,68,.3)':'var(--border)'}`,
      borderRadius:14, padding:'16px 18px', position:'relative', overflow:'hidden',
    }}>
      <div style={{ position:'absolute', bottom:-14, left:-8, width:48, height:48, borderRadius:'50%', background:`${color}10`, pointerEvents:'none' }}/>
      <div style={{ fontSize:'0.68rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:8, display:'flex', alignItems:'center', gap:6 }}>
        <span>{icon}</span>{label}
      </div>
      <div style={{ fontSize:'1.55rem', fontWeight:900, color, lineHeight:1, letterSpacing:'-0.5px' }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize:'0.68rem', color:'var(--text3)', marginTop:5 }}>{sub}</div>}
    </div>
  );
}

function Section({ icon, title, count, accentColor='#0d9488', children, noPad }) {
  return (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden', pageBreakInside:'avoid' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'13px 20px', borderBottom:'1px solid var(--border)', background:'var(--surface2)' }}>
        <div style={{ width:34, height:34, borderRadius:9, background:`${accentColor}20`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.1rem', flexShrink:0 }}>{icon}</div>
        <div style={{ fontWeight:800, fontSize:'0.95rem', flex:1 }}>{title}</div>
        {count != null && (
          <span style={{ fontSize:'0.7rem', fontWeight:700, color:accentColor, background:`${accentColor}18`, padding:'3px 10px', borderRadius:99, border:`1px solid ${accentColor}30` }}>
            {count}
          </span>
        )}
      </div>
      <div style={noPad ? {} : { padding:'16px 20px' }}>{children}</div>
    </div>
  );
}

function Ring({ pct, color, size=72, strokeW=6 }) {
  const r = (size - strokeW * 2) / 2;
  const circ = 2 * Math.PI * r;
  const off  = circ - (Math.min(100, Math.max(0, pct || 0)) / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform:'rotate(-90deg)', flexShrink:0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--surface3)" strokeWidth={strokeW}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={strokeW}
        strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
        style={{ transition:'stroke-dashoffset .7s ease' }}/>
    </svg>
  );
}

function MiniBar({ value, max, color }) {
  const pct = max > 0 ? Math.round(value / max * 100) : 0;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <div style={{ flex:1, height:6, background:'var(--surface3)', borderRadius:99, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:color, borderRadius:99, transition:'width .6s' }}/>
      </div>
      <span style={{ fontSize:'0.7rem', fontWeight:700, color, minWidth:32, textAlign:'left' }}>{pct}%</span>
    </div>
  );
}

function StatRow({ label, value, color='var(--text)', mono }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 0', borderBottom:'1px solid var(--border)' }}>
      <span style={{ fontSize:'0.8rem', color:'var(--text3)' }}>{label}</span>
      <span style={{ fontSize:'0.85rem', fontWeight:700, color }}>{value}</span>
    </div>
  );
}

function EmptySection({ msg }) {
  return (
    <div style={{ textAlign:'center', padding:'32px', color:'var(--text3)' }}>
      <div style={{ fontSize:32, opacity:.25, marginBottom:8 }}>📭</div>
      <div style={{ fontSize:'0.82rem' }}>{msg}</div>
    </div>
  );
}

// Timeline event
function TimelineItem({ date, icon, title, sub, color, last }) {
  return (
    <div style={{ display:'flex', gap:12, position:'relative' }}>
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', flexShrink:0 }}>
        <div style={{ width:32, height:32, borderRadius:'50%', background:`${color}20`, border:`2px solid ${color}40`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.9rem', flexShrink:0, zIndex:1 }}>{icon}</div>
        {!last && <div style={{ width:2, flex:1, background:'var(--border)', marginTop:4 }}/>}
      </div>
      <div style={{ flex:1, paddingBottom:last?0:16 }}>
        <div style={{ fontWeight:600, fontSize:'0.85rem' }}>{title}</div>
        <div style={{ fontSize:'0.72rem', color:'var(--text3)', marginTop:2, display:'flex', gap:8 }}>
          {sub && <span>{sub}</span>}
          <span style={{ color:'var(--text3)' }}>📅 {formatDate(date, {month:'short', day:'numeric', year:'2-digit'})}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Print — نافذة مستقلة نظيفة (buildPrintReport.js)
// ─────────────────────────────────────────────────────────────

// ═════════════════════════════════════════════════════════════
// MAIN PAGE
// ═════════════════════════════════════════════════════════════
export default function StudentReportPage() {
  const students      = useAppStore(s => s.students);
  const groups        = useAppStore(s => s.groups);
  const attendance    = useAppStore(s => s.attendance);
  const absFollowup   = useAppStore(s => s.absenceFollowup);
  const payments      = useAppStore(s => s.payments);
  const exams         = useAppStore(s => s.exams);
  const grades        = useAppStore(s => s.grades);
  const homeworks     = useAppStore(s => s.homeworks);
  const hwSubmissions = useAppStore(s => s.hwSubmissions);
  const materials     = useAppStore(s => s.invMaterials);
  const centerProfile = useAppStore(s => s.centerProfile);
  const communications = useAppStore(s => s.communications);
  const inventoryTxn   = useAppStore(s => s.inventoryTxn);
  const treasuryTxn    = useAppStore(s => s.treasuryTxn);
  // matDist مُشتَق من inventoryTxn (المُزامَن إقلاعياً بالفعل) — لا حالة مستقلة بعد الآن.
  const matDist = useMemo(() => deriveMatDist(inventoryTxn), [inventoryTxn]);
  const { currentUser } = useAuth();
  const toast = useToast();
  const currentUserName = currentUser?.name || currentUser?.id || 'النظام';
  // تجميع الـ store للتقرير الاحترافي (المحرّك الجديد يقرأ منه) — treasuryTxn مطلوبة
  // لكشف الاسترداد الفعلي في gatherStudentData (BUG-02، انظر reportData.js).
  const fullStore = { students, groups, attendance, payments, exams, grades, communications, inventoryTxn, treasuryTxn };
  const addWaReportLog = useAppStore(s => s.addWaReportLog);

  // ── workflow معاينة رسالة واتساب (المنطق كله في الـ service) ──
  const [waPreview, setWaPreview] = useState(null);

  const handleOpenPreview = () => {
    const result = generateMessage(student.id, fullStore, { profile: centerProfile });
    if (!result) { toast.error('تعذّر توليد الرسالة'); return; }
    setWaPreview(result);
  };

  const handleWaOpen = async () => {
    if (!waPreview) return;
    const { studentId, parentPhone, reportType, message } = waPreview;
    const res = openWhatsapp(parentPhone, message);
    if (!res.ok) { toast.error(res.error); return; }

    // واتساب فُتح بالفعل هنا ولا رجوع عنه — النجاح مؤكّد بغضّ النظر عن حفظ قيد
    // التدقيق أدناه، فيُعرض فوراً ولا يُعلَّق على استجابة الخادم.
    toast.success('تم فتح واتساب بالرسالة الجاهزة');
    setWaPreview(null);

    // قيد تدقيق داخلي (مستقل عن مركز التواصل) — best-effort: فشل الحفظ هنا لا يُلغي
    // نجاح فتح واتساب أعلاه، فقط تحذير ثانوي غير حاجب (لا toast.error).
    try {
      const saved = await pgCreateWaReportLog({
        studentId,
        parentPhone,
        reportType,
        messageType: reportType,
        createdBy: currentUser?.id ?? null,
        status: 'prepared',
      });
      addWaReportLog(saved);
    } catch (err) {
      toast.warning(err.message || 'تم فتح واتساب، لكن تعذّر حفظ قيد التدقيق الداخلي.');
    }
  };

  const [query,      setQuery]      = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [activeTab,  setActiveTab]  = useState('overview');

  // ── Search ───────────────────────────────────────────────
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return students.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.code?.toLowerCase().includes(q) ||
      s.phone?.includes(q)
    ).slice(0, 7);
  }, [students, query]);

  const student = useMemo(() => students.find(s => s.id === selectedId), [students, selectedId]);
  const group   = useMemo(() => groups.find(g => g.id === student?.groupId), [groups, student]);

  // ── All report data ──────────────────────────────────────
  const data = useMemo(() => {
    if (!student) return null;

    // Attendance
    const attAll     = attendance.filter(r => r.studentId === student.id).sort((a,b)=>a.date.localeCompare(b.date));
    const attPresent = attAll.filter(r=>r.status==='present').length;
    const attAbsent  = attAll.filter(r=>r.status==='absent').length;
    const attLate    = attAll.filter(r=>r.status==='late').length;
    const attPct     = attAll.length ? Math.round(attPresent/attAll.length*100) : null;

    // Monthly attendance trend
    const monthlyMap = {};
    attAll.forEach(r => {
      const k = r.date.slice(0,7);
      if (!monthlyMap[k]) monthlyMap[k] = {present:0,absent:0,late:0,total:0};
      monthlyMap[k].total++;
      monthlyMap[k][r.status]++;
    });
    const attTrend = Object.entries(monthlyMap).sort(([a],[b])=>a.localeCompare(b))
      .map(([m,d]) => ({ label:m.slice(5), val:d.total?Math.round(d.present/d.total*100):0 }));

    // Exams
    const myGrades = grades.filter(g=>g.studentId===student.id);
    const examRows = myGrades.map(g=>{
      const exam = exams.find(e=>e.id===g.examId);
      if (!exam) return null;
      const pct = g.absent ? null : Math.round(g.score/exam.total*100);
      return { exam, score:g.score, total:exam.total, pct, absent:g.absent, pass:exam.pass };
    }).filter(Boolean).sort((a,b)=>a.exam.date.localeCompare(b.exam.date));
    const validExams  = examRows.filter(r=>!r.absent && r.pct!=null);
    const avgExamPct  = validExams.length ? Math.round(validExams.reduce((s,r)=>s+r.pct,0)/validExams.length) : null;
    const passedExams = validExams.filter(r=>r.score>=r.pass).length;

    // Homeworks
    const myGroupHW = homeworks.filter(h=>h.groupId===student.groupId);
    const hwRows = myGroupHW.map(hw=>{
      const sub = hwSubmissions.find(s=>s.hwId===hw.id&&s.studentId===student.id);
      return { hw, status: sub?.status||'missing', submittedAt:sub?.submittedAt, score:sub?.score };
    }).sort((a,b)=>a.hw.dueDate.localeCompare(b.hw.dueDate));
    const hwSubmitted = hwRows.filter(r=>r.status==='submitted').length;
    const hwLate      = hwRows.filter(r=>r.status==='late').length;
    const hwMissing   = hwRows.filter(r=>r.status==='missing').length;

    // Materials
    const matRows = matDist.filter(d=>d.studentId===student.id).map(d=>{
      const mat = materials.find(m=>m.id===d.matId);
      return mat ? {...d, mat} : null;
    }).filter(Boolean);
    const matReceived = matRows.filter(r=>r.received).length;
    const matPaid     = matRows.filter(r=>r.payStatus==='paid').length;
    const matTotal    = matRows.reduce((s,r)=>s+(r.paidAmount||0), 0);

    // Payments
    // NEEDS BUSINESS DECISION (المُغلق الآن) — بيان مطبوع: الجدول أدناه (payRows) يعرض
    // المبالغ الأصلية التاريخية لكل معاملة كما هي (لا تعديل). totalPaid يبقى إجمالياً
    // خاماً (Gross) مطابقاً لمجموع تلك الصفوف بالضبط؛ الاسترداد الفعلي يُشتقّ من
    // treasury_txn في حقلين منفصلين (refundedTotal/netPaid) بدل استبدال الإجمالي برقم
    // صافٍ يناقض الجدول المطابق له تماماً. Net = Gross − Refunded دائماً.
    const payRows  = payments.filter(p=>p.studentId===student.id).sort((a,b)=>a.date.localeCompare(b.date));
    const totalPaid= payRows.reduce((s,p)=>s+p.amount, 0);
    const refundedTotal = payRows.reduce((s,p)=>s+getRefundedAmount(p.id, treasuryTxn), 0);
    const netPaid  = totalPaid - refundedTotal;
    const paidCount= payRows.filter(p=>p.status==='paid').length;

    // Timeline — merge all events
    const timeline = [
      { date:student.enrollDate, icon:'🎓', title:'التسجيل في المركز', sub:group?.name, color:'#0d9488', type:'enroll' },
      ...payRows.map(p=>({ date:p.date, icon:'💰', title:`دفع ${formatCurrency(p.amount)}`, sub:MONTHS_AR[(p.month||1)-1], color:'#10b981', type:'payment' })),
      ...attAll.filter(r=>r.status!=='present').map(r=>({ date:r.date, icon:r.status==='absent'?'✗':'⏱', title:r.status==='absent'?'غياب':'حضور متأخر', sub:null, color:r.status==='absent'?'#ef4444':'#f59e0b', type:'attendance' })),
      ...examRows.map(r=>({ date:r.exam.date, icon:'📝', title:r.exam.name, sub:r.absent?'غائب':`${r.score}/${r.total}`, color:r.pct>=60?'#8b5cf6':'#ef4444', type:'exam' })),
      ...hwRows.filter(r=>r.submittedAt).map(r=>({ date:r.submittedAt, icon:'📋', title:`تسليم: ${r.hw.title}`, sub:HW_META[r.status]?.label, color:HW_META[r.status]?.c||'#94a3b8', type:'hw' })),
      ...matRows.filter(r=>r.receivedAt).map(r=>({ date:r.receivedAt, icon:'📚', title:`استلام: ${r.mat.name}`, sub:r.mat.subject, color:'#3b82f6', type:'material' })),
    ].filter(t=>t.date).sort((a,b)=>b.date.localeCompare(a.date));

    // Absence followup
    const absentIds = attAll.filter(r=>r.status==='absent').map(r=>r.id);
    const followups = absFollowup?.filter(f=>absentIds.includes(f.attendanceId)) || [];

    return {
      attAll, attPresent, attAbsent, attLate, attPct, attTrend,
      examRows, avgExamPct, passedExams, validExams,
      hwRows, hwSubmitted, hwLate, hwMissing,
      matRows, matReceived, matPaid, matTotal,
      payRows, totalPaid, refundedTotal, netPaid, paidCount,
      timeline, followups,
    };
  }, [student, attendance, absFollowup, grades, exams, homeworks, hwSubmissions, matDist, materials, payments, group, treasuryTxn]);

  // ── Tab definitions ──────────────────────────────────────
  const TABS = [
    { id:'overview',    icon:'📊', label:'نظرة عامة' },
    { id:'attendance',  icon:'✓',  label:'الحضور'     },
    { id:'exams',       icon:'📝', label:'الامتحانات' },
    { id:'homeworks',   icon:'📋', label:'الواجبات'   },
    { id:'materials',   icon:'📚', label:'المذكرات'   },
    { id:'payments',    icon:'💰', label:'المدفوعات'  },
    { id:'timeline',    icon:'🕐', label:'التاريخ'    },
  ];

  // ── Student avatar ───────────────────────────────────────
  const studentAv = student ? av(student.name) : null;

  return (
    <div style={{ minHeight:'100vh', padding:'0 0 60px' }}>

      {/* ── Page header ───────────────────────────── */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:14, padding:'0 28px', marginBottom:24 }} className="no-print">
        <div>
          <h1 style={{ fontSize:'1.35rem', fontWeight:900, letterSpacing:'-0.4px', marginBottom:3 }}>
            تقرير الطالب الكامل
          </h1>
          <p style={{ fontSize:'0.78rem', color:'var(--text3)' }}>
            سجل شامل لكل أنشطة الطالب — حضور · امتحانات · مدفوعات · واجبات · مذكرات
          </p>
        </div>
        {student && (
          <div style={{ display:'flex', gap:8 }} className="no-print">
            <button onClick={() => openStudentReportPrint({ student, group, data, profile: centerProfile })}
              style={{ display:'flex', alignItems:'center', gap:7, padding:'9px 18px', borderRadius:10, border:'1px solid var(--border)', background:'var(--surface2)', color:'var(--text2)', fontSize:'0.88rem', fontWeight:700, cursor:'pointer', transition:'all .15s' }}
              onMouseOver={e=>{e.currentTarget.style.background='var(--surface3)';e.currentTarget.style.color='var(--text)';}}
              onMouseOut={e =>{e.currentTarget.style.background='var(--surface2)';e.currentTarget.style.color='var(--text2)';}}>
              🖨 طباعة / PDF
            </button>
            <button onClick={() => generateStudentReport(student.id, fullStore, { profile: centerProfile, generatedBy: currentUserName })}
              style={{ display:'flex', alignItems:'center', gap:7, padding:'9px 18px', borderRadius:10, border:'none', background:'#2563eb', color:'#fff', fontSize:'0.88rem', fontWeight:700, cursor:'pointer', transition:'opacity .15s' }}
              onMouseOver={e=>{e.currentTarget.style.opacity='0.9';}}
              onMouseOut={e =>{e.currentTarget.style.opacity='1';}}>
              ⭐ تقرير احترافي (PDF)
            </button>
            <button onClick={handleOpenPreview}
              style={{ display:'flex', alignItems:'center', gap:7, padding:'9px 18px', borderRadius:10, border:'none', background:'#25D366', color:'#fff', fontSize:'0.88rem', fontWeight:700, cursor:'pointer', transition:'opacity .15s' }}
              onMouseOver={e=>{e.currentTarget.style.opacity='0.9';}}
              onMouseOut={e =>{e.currentTarget.style.opacity='1';}}>
              📲 إرسال ملخص لولي الأمر
            </button>
          </div>
        )}
      </div>

      {/* ── Search box ──────────────────────────────── */}
      <div style={{ padding:'0 28px', marginBottom:28 }} className="no-print">
        <div style={{ maxWidth:540, position:'relative' }}>
          <div style={{ display:'flex', alignItems:'center', gap:11, background:'var(--surface)', border:'2px solid var(--border)', borderRadius:14, padding:'12px 18px', transition:'border-color .2s', boxShadow:'0 2px 16px rgba(0,0,0,.1)' }}
            onFocusCapture={e=>e.currentTarget.style.borderColor='var(--accent)'}
            onBlurCapture={e =>e.currentTarget.style.borderColor='var(--border)'}
          >
            <span style={{ fontSize:'1.2rem', flexShrink:0 }}>🔍</span>
            <input
              value={query}
              onChange={e=>{ setQuery(e.target.value); if(!e.target.value) setSelectedId(null); }}
              placeholder="ابحث باسم الطالب أو الكود أو رقم الهاتف..."
              autoComplete="off"
              style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--text)', fontSize:'0.95rem' }}
            />
            {query && (
              <button onClick={()=>{setQuery('');setSelectedId(null);}}
                style={{ color:'var(--text3)', cursor:'pointer', fontSize:'1.1rem', background:'none', border:'none' }}>×</button>
            )}
          </div>

          {/* Dropdown */}
          {results.length > 0 && !selectedId && (
            <div style={{ position:'absolute', top:'calc(100% + 8px)', right:0, left:0, zIndex:100, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden', boxShadow:'0 12px 40px rgba(0,0,0,.3)' }}>
              {results.map(s => {
                const g = groups.find(x=>x.id===s.groupId);
                const {bg,c} = av(s.name);
                return (
                  <div key={s.id}
                    onClick={()=>{setSelectedId(s.id);setQuery(s.name);setActiveTab('overview');}}
                    style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 18px', cursor:'pointer', borderBottom:'1px solid var(--border)', transition:'background .1s' }}
                    onMouseOver={e=>e.currentTarget.style.background='var(--surface2)'}
                    onMouseOut={e =>e.currentTarget.style.background=''}
                  >
                    <div style={{ width:38, height:38, borderRadius:'50%', background:bg, color:c, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.85rem', fontWeight:800, flexShrink:0 }}>
                      {initials(s.name)}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700 }}>{s.name}</div>
                      <div style={{ fontSize:'0.7rem', color:'var(--text3)', display:'flex', gap:10, marginTop:2 }}>
                        <span style={{ background:'var(--surface2)', padding:'1px 7px', borderRadius:5 }}>{s.code}</span>
                        <span>{s.grade}</span>
                        {g && <span>{g.name}</span>}
                      </div>
                    </div>
                    <span style={{ fontSize:'0.7rem', color:'var(--text3)' }}>{s.phone}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Empty state ──────────────────────────────── */}
      {!student && (
        <div style={{ textAlign:'center', padding:'80px 20px', color:'var(--text3)' }}>
          <div style={{ fontSize:64, opacity:.2, marginBottom:16 }}>👨‍🎓</div>
          <div style={{ fontWeight:800, fontSize:'1.1rem', marginBottom:8 }}>ابدأ بالبحث عن طالب</div>
          <div style={{ fontSize:'0.85rem' }}>ادخل الاسم أو الكود أو رقم الهاتف</div>
        </div>
      )}

      {/* ═══════ REPORT BODY ═══════════════════════════════ */}
      {student && data && (
        <div style={{ padding:'0 28px', display:'flex', flexDirection:'column', gap:20 }}>

          {/* ── Student header card ──────────────────── */}
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:18, overflow:'hidden', boxShadow:'0 4px 20px rgba(0,0,0,.12)' }}>
            {/* Accent bar */}
            <div style={{ height:6, background:`linear-gradient(90deg, ${studentAv?.c}, ${studentAv?.c}88)` }}/>
            <div style={{ padding:'22px 24px', display:'flex', gap:20, flexWrap:'wrap', alignItems:'flex-start' }}>
              {/* Avatar */}
              <div style={{ width:80, height:80, borderRadius:20, background:studentAv?.bg, color:studentAv?.c, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.7rem', fontWeight:900, flexShrink:0, border:`2px solid ${studentAv?.c}30`, boxShadow:`0 4px 20px ${studentAv?.c}30` }}>
                {initials(student.name)}
              </div>
              {/* Info grid */}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', marginBottom:10 }}>
                  <h2 style={{ fontSize:'1.5rem', fontWeight:900, letterSpacing:'-0.4px', margin:0 }}>{student.name}</h2>
                  <span style={{ padding:'3px 12px', borderRadius:99, fontSize:'0.72rem', fontWeight:700,
                    background:student.status==='active'?'#10b98120':'#ef444420',
                    color:student.status==='active'?'#10b981':'#ef4444',
                    border:`1px solid ${student.status==='active'?'#10b98130':'#ef444430'}`,
                  }}>
                    {student.status==='active'?'● نشط':'● موقوف'}
                  </span>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(170px,1fr))', gap:'6px 20px', fontSize:'0.8rem', color:'var(--text3)' }}>
                  {[
                    ['🆔','الكود',        student.code,         true  ],
                    ['📚','السنة الدراسية', student.grade,        false ],
                    ['◈', 'المجموعة',      group?.name||'—',     false ],
                    ['👤','المدرس',         group?.teacher||'—',  false ],
                    ['📞','هاتف الطالب',   student.phone,        true  ],
                    ['👨‍👩‍👦','ولي الأمر',   student.parentPhone||'—', true],
                    ['🏫','المدرسة',        student.school||'—',  false ],
                    ['📅','تاريخ التسجيل', formatDate(student.enrollDate), false],
                  ].map(([icon,label,val]) => (
                    <div key={label} style={{ display:'flex', gap:6, alignItems:'baseline' }}>
                      <span>{icon}</span>
                      <span style={{ color:'var(--text3)', fontSize:'0.72rem' }}>{label}:</span>
                      <span style={{ color:'var(--text)', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{val}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Overall score ring */}
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8, flexShrink:0 }} className="no-print">
                <Ring pct={data.avgExamPct||0} color={pctColor(data.avgExamPct)} size={84} strokeW={7}/>
                <div style={{ textAlign:'center' }}>
                  <div style={{ fontSize:'1.3rem', fontWeight:900, color:pctColor(data.avgExamPct), lineHeight:1 }}>
                    {data.avgExamPct!=null ? `${data.avgExamPct}%` : '—'}
                  </div>
                  <div style={{ fontSize:'0.62rem', color:'var(--text3)', marginTop:3 }}>متوسط الامتحانات</div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Quick KPIs ───────────────────────────── */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:12 }}>
            {[
              { icon:'✓',  label:'نسبة الحضور',    value:data.attPct!=null?`${data.attPct}%`:'—',    color:pctColor(data.attPct)   },
              { icon:'📝', label:'متوسط الامتحانات', value:data.avgExamPct!=null?`${data.avgExamPct}%`:'—', color:pctColor(data.avgExamPct) },
              { icon:'📋', label:'إنجاز الواجبات',  value:data.hwRows.length?`${Math.round((data.hwSubmitted+data.hwLate)/data.hwRows.length*100)}%`:'—', color:'#8b5cf6' },
              { icon:'💰', label:'صافي المدفوع',  value:formatCurrency(data.netPaid), color:'#10b981' },
              { icon:'📚', label:'مذكرات استُلمت',  value:`${data.matReceived}/${data.matRows.length}`, color:'#3b82f6' },
              { icon:'🕐', label:'جلسات الحضور',    value:data.attAll.length, color:'var(--text)' },
            ].map(k => <KpiCard key={k.label} {...k}/>)}
          </div>

          {/* ── Tabs ─────────────────────────────────── */}
          <div className="no-print" style={{ display:'flex', gap:2, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:14, padding:4, overflowX:'auto', flexShrink:0 }}>
            {TABS.map(t => (
              <button key={t.id} onClick={()=>setActiveTab(t.id)}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 18px', borderRadius:10, fontSize:'0.88rem', fontWeight:activeTab===t.id?800:500, cursor:'pointer', transition:'all .15s', border:'none', whiteSpace:'nowrap',
                  background:  activeTab===t.id ? 'var(--surface)' : 'transparent',
                  color:       activeTab===t.id ? 'var(--accent)'   : 'var(--text3)',
                  boxShadow:   activeTab===t.id ? '0 2px 8px rgba(0,0,0,.15)' : 'none',
                }}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* ══════════════════════════════════════════════════
              OVERVIEW TAB
          ══════════════════════════════════════════════════ */}
          {(activeTab==='overview') && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>

                {/* Attendance summary */}
                <Section icon="✓" title="ملخص الحضور" accentColor="#10b981">
                  <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:14 }}>
                    <div style={{ position:'relative', flexShrink:0 }}>
                      <Ring pct={data.attPct||0} color={pctColor(data.attPct)} size={72} strokeW={6}/>
                      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column' }}>
                        <span style={{ fontSize:'0.85rem', fontWeight:900, color:pctColor(data.attPct) }}>{data.attPct??'—'}%</span>
                      </div>
                    </div>
                    <div style={{ flex:1 }}>
                      <StatRow label="حاضر"  value={data.attPresent} color="#10b981"/>
                      <StatRow label="غائب"  value={data.attAbsent}  color="#ef4444"/>
                      <StatRow label="متأخر" value={data.attLate}    color="#f59e0b"/>
                      <StatRow label="الإجمالي" value={data.attAll.length}/>
                    </div>
                  </div>
                </Section>

                {/* Exams summary */}
                <Section icon="📝" title="ملخص الامتحانات" accentColor="#8b5cf6">
                  <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:14 }}>
                    <div style={{ position:'relative', flexShrink:0 }}>
                      <Ring pct={data.avgExamPct||0} color={pctColor(data.avgExamPct)} size={72} strokeW={6}/>
                      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column' }}>
                        <span style={{ fontSize:'0.72rem', fontWeight:900, color:pctColor(data.avgExamPct) }}>{pctGrade(data.avgExamPct)}</span>
                      </div>
                    </div>
                    <div style={{ flex:1 }}>
                      <StatRow label="نجح"    value={data.passedExams}                        color="#10b981"/>
                      <StatRow label="رسب"    value={data.validExams.length-data.passedExams}  color="#ef4444"/>
                      <StatRow label="غاب"    value={data.examRows.filter(r=>r.absent).length} color="#f59e0b"/>
                      <StatRow label="الإجمالي" value={data.examRows.length}/>
                    </div>
                  </div>
                </Section>

                {/* Finance summary */}
                <Section icon="💰" title="ملخص المالية" accentColor="#10b981">
                  <div style={{ marginBottom:8 }}>
                    <div style={{ fontSize:'1.6rem', fontWeight:900, color:'#10b981', marginBottom:4 }}>{formatCurrency(data.netPaid)}</div>
                    <div style={{ fontSize:'0.72rem', color:'var(--text3)' }}>صافي المدفوع</div>
                  </div>
                  {data.refundedTotal > 0 && (
                    <>
                      <StatRow label="إجمالي قبل الاسترداد" value={formatCurrency(data.totalPaid)}/>
                      <StatRow label="المسترد" value={formatCurrency(data.refundedTotal)} color="#ef4444"/>
                    </>
                  )}
                  <StatRow label="عدد الدفعات" value={data.paidCount}/>
                  <StatRow label="مذكرات مدفوعة" value={`${data.matPaid}/${data.matRows.length}`} color="#3b82f6"/>
                  <StatRow label="إجمالي المذكرات" value={formatCurrency(data.matTotal)} color="#10b981"/>
                </Section>
              </div>

              {/* Homework summary */}
              <Section icon="📋" title="ملخص الواجبات" accentColor="#f59e0b">
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
                  {[
                    {l:'إجمالي الواجبات', v:data.hwRows.length,    c:'var(--text)' },
                    {l:'سُلِّم في الوقت', v:data.hwSubmitted,      c:'#10b981'     },
                    {l:'تسليم متأخر',     v:data.hwLate,           c:'#f59e0b'     },
                    {l:'لم يُسلَّم',      v:data.hwMissing,        c:'#ef4444'     },
                  ].map(s=>(
                    <div key={s.l} style={{ textAlign:'center', padding:'12px', background:'var(--surface2)', borderRadius:12 }}>
                      <div style={{ fontSize:'1.4rem', fontWeight:900, color:s.c }}>{s.v}</div>
                      <div style={{ fontSize:'0.68rem', color:'var(--text3)', marginTop:4 }}>{s.l}</div>
                    </div>
                  ))}
                </div>
                {data.hwRows.length > 0 && (
                  <div style={{ marginTop:12 }}>
                    <MiniBar value={data.hwSubmitted+data.hwLate} max={data.hwRows.length} color="#f59e0b"/>
                  </div>
                )}
              </Section>

              {/* Recent activity */}
              <Section icon="⏱" title="آخر النشاطات" accentColor="#0d9488">
                {data.timeline.slice(0,6).map((t,i)=>(
                  <TimelineItem key={i} {...t} last={i===Math.min(5,data.timeline.length-1)}/>
                ))}
              </Section>
            </div>
          )}

          {/* ══════════════════════════════════════════════════
              ATTENDANCE TAB
          ══════════════════════════════════════════════════ */}
          {(activeTab==='attendance') && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              {/* Trend chart */}
              {data.attTrend.length > 0 && (
                <Section icon="📈" title="اتجاه الحضور الشهري" accentColor="#10b981">
                  <div style={{ display:'flex', alignItems:'flex-end', gap:6, height:80 }}>
                    {data.attTrend.map((d,i)=>{
                      const pct = d.val;
                      const color = pct>=80?'#10b981':pct>=60?'#f59e0b':'#ef4444';
                      return (
                        <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                          <div style={{ fontSize:'0.6rem', color:'var(--text3)', fontWeight:700 }}>{pct}%</div>
                          <div style={{ width:'100%', height:`${Math.max(4,pct)}%`, background:color, borderRadius:'3px 3px 0 0', minHeight:4, transition:'height .5s' }}/>
                          <div style={{ fontSize:'0.58rem', color:'var(--text3)' }}>{d.label}</div>
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}

              {/* Full table */}
              <Section icon="✓" title="سجل الحضور الكامل" count={data.attAll.length} accentColor="#10b981" noPad>
                {data.attAll.length === 0 ? <EmptySection msg="لا يوجد سجل حضور"/> : (
                  <div style={{ maxHeight:420, overflowY:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.83rem' }}>
                      <thead style={{ position:'sticky', top:0, background:'var(--surface2)', zIndex:1 }}>
                        <tr>{['التاريخ','اليوم','الحالة','متابعة الغياب'].map(h=>(
                          <th key={h} style={{ padding:'10px 18px', textAlign:'right', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.07em', borderBottom:'1px solid var(--border)' }}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {data.attAll.slice().reverse().map((r,i)=>{
                          const days=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
                          const day = days[new Date(r.date).getDay()];
                          const isAbsent = r.status==='absent';
                          const followup = isAbsent ? data.followups.find(f=>f.attendanceId===r.id) : null;
                          const statColor = r.status==='present'?'#10b981':r.status==='late'?'#f59e0b':'#ef4444';
                          const statLabel = r.status==='present'?'حاضر':r.status==='late'?'متأخر':'غائب';
                          return (
                            <tr key={r.id}
                              style={{ background:i%2===0?'':'var(--surface2)', transition:'background .1s' }}
                              onMouseOver={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='var(--hover-row)')}
                              onMouseOut={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='')}
                            >
                              <td style={{ padding:'9px 18px', borderBottom:'1px solid var(--border)' }}>
                                {formatDate(r.date,{year:'2-digit',month:'short',day:'numeric'})}
                              </td>
                              <td style={{ padding:'9px 18px', borderBottom:'1px solid var(--border)', color:'var(--text3)' }}>{day}</td>
                              <td style={{ padding:'9px 18px', borderBottom:'1px solid var(--border)' }}>
                                <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'3px 10px', borderRadius:99, fontSize:'0.7rem', fontWeight:700, background:`${statColor}15`, color:statColor }}>
                                  {statLabel}
                                </span>
                              </td>
                              <td style={{ padding:'9px 18px', borderBottom:'1px solid var(--border)', fontSize:'0.75rem' }}>
                                {followup ? (
                                  <div>
                                    <span style={{ color:{excused:'#10b981',contacted:'#f59e0b',pending:'#ef4444'}[followup.followStatus]||'var(--text3)', fontWeight:700 }}>
                                      {{excused:'مبرر',contacted:'تم التواصل',unexcused:'غير مبرر',pending:'لم تتم المتابعة'}[followup.followStatus]}
                                    </span>
                                    {followup.absenceReason && <span style={{ color:'var(--text3)', marginRight:6 }}>— {followup.absenceReason}</span>}
                                  </div>
                                ) : isAbsent ? (
                                  <span style={{ color:'#ef4444', fontSize:'0.7rem' }}>⚠ لم تتم المتابعة</span>
                                ) : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>
            </div>
          )}

          {/* ══════════════════════════════════════════════════
              EXAMS TAB
          ══════════════════════════════════════════════════ */}
          {(activeTab==='exams') && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              {data.examRows.length === 0 ? (
                <Section icon="📝" title="الامتحانات" accentColor="#8b5cf6"><EmptySection msg="لا توجد امتحانات مسجّلة"/></Section>
              ) : (
                <>
                  {/* Score trend */}
                  <Section icon="📈" title="مسار الدرجات" accentColor="#8b5cf6">
                    <div style={{ display:'flex', alignItems:'flex-end', gap:8, height:80 }}>
                      {data.examRows.map((r,i)=>{
                        const pct = r.absent ? 0 : r.pct;
                        const color = pctColor(pct);
                        return (
                          <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3, minWidth:0 }}>
                            <div style={{ fontSize:'0.58rem', color, fontWeight:700 }}>{r.absent?'غ':`${pct}%`}</div>
                            <div style={{ width:'100%', height:`${Math.max(4,pct)}%`, background:color, borderRadius:'3px 3px 0 0', minHeight:4 }}/>
                            <div style={{ fontSize:'0.55rem', color:'var(--text3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', width:'100%', textAlign:'center' }}>{r.exam.subject.slice(0,4)}</div>
                          </div>
                        );
                      })}
                    </div>
                  </Section>

                  {/* Full exams table */}
                  <Section icon="📝" title="تفاصيل الامتحانات" count={data.examRows.length} accentColor="#8b5cf6" noPad>
                    <div style={{ overflowX:'auto' }}>
                      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.83rem' }}>
                        <thead style={{ background:'var(--surface2)' }}>
                          <tr>{['الامتحان','المادة','التاريخ','الدرجة','من','النسبة','التقدير','النتيجة'].map(h=>(
                            <th key={h} style={{ padding:'10px 18px', textAlign:'right', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.07em', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }}>{h}</th>
                          ))}</tr>
                        </thead>
                        <tbody>
                          {data.examRows.map((r,i)=>{
                            const color = r.absent?'#94a3b8':pctColor(r.pct);
                            return (
                              <tr key={i}
                                style={{ background:i%2===0?'':'var(--surface2)' }}
                                onMouseOver={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='var(--hover-row)')}
                                onMouseOut={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='')}
                              >
                                <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', fontWeight:600, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.exam.name}</td>
                                <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', color:'var(--text2)' }}>{r.exam.subject}</td>
                                <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', color:'var(--text3)' }}>{formatDate(r.exam.date,{month:'short',day:'numeric'})}</td>
                                <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', fontWeight:900, color }}>{r.absent?'غائب':r.score}</td>
                                <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', color:'var(--text3)' }}>{r.total}</td>
                                <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)' }}>
                                  {!r.absent && (
                                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                      <div style={{ width:48, height:5, background:'var(--surface3)', borderRadius:99, overflow:'hidden' }}>
                                        <div style={{ height:'100%', width:`${r.pct}%`, background:color }}/>
                                      </div>
                                      <span style={{ fontSize:'0.75rem', fontWeight:700, color }}>{r.pct}%</span>
                                    </div>
                                  )}
                                </td>
                                <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', fontWeight:900, color, fontSize:'0.9rem' }}>{r.absent?'—':pctGrade(r.pct)}</td>
                                <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)' }}>
                                  {!r.absent && (
                                    <span style={{ display:'inline-flex', padding:'3px 10px', borderRadius:99, fontSize:'0.7rem', fontWeight:700,
                                      background:r.score>=r.pass?'#10b98115':'#ef444415',
                                      color:r.score>=r.pass?'#10b981':'#ef4444' }}>
                                      {r.score>=r.pass?'ناجح':'راسب'}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        {data.validExams.length>0 && (
                          <tfoot>
                            <tr style={{ background:'var(--surface2)' }}>
                              <td colSpan={5} style={{ padding:'10px 18px', fontWeight:800, color:'var(--text3)', fontSize:'0.8rem' }}>المتوسط العام</td>
                              <td colSpan={3} style={{ padding:'10px 18px', fontWeight:900, color:pctColor(data.avgExamPct), fontSize:'0.95rem' }}>
                                {data.avgExamPct}% — {pctGrade(data.avgExamPct)}
                              </td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </Section>
                </>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════
              HOMEWORKS TAB
          ══════════════════════════════════════════════════ */}
          {(activeTab==='homeworks') && (
            <Section icon="📋" title="الواجبات" count={data.hwRows.length} accentColor="#f59e0b" noPad>
              {data.hwRows.length===0 ? <EmptySection msg="لا توجد واجبات"/> : (
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.83rem' }}>
                    <thead style={{ background:'var(--surface2)' }}>
                      <tr>{['الواجب','المادة','موعد التسليم','تاريخ التسليم','الحالة','الدرجة'].map(h=>(
                        <th key={h} style={{ padding:'10px 18px', textAlign:'right', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.07em', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {data.hwRows.map((r,i)=>{
                        const meta = HW_META[r.status];
                        const isLate = r.status==='late';
                        return (
                          <tr key={i}
                            style={{ background:i%2===0?'':'var(--surface2)' }}
                            onMouseOver={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='var(--hover-row)')}
                            onMouseOut={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='')}
                          >
                            <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', fontWeight:600, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.hw.title}</td>
                            <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', color:'var(--text2)' }}>{r.hw.subject}</td>
                            <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', color:isLate?'#ef4444':'var(--text3)' }}>{formatDate(r.hw.dueDate,{month:'short',day:'numeric'})}</td>
                            <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', color:'var(--text3)' }}>{r.submittedAt?formatDate(r.submittedAt,{month:'short',day:'numeric'}):'—'}</td>
                            <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)' }}>
                              <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:99, fontSize:'0.7rem', fontWeight:700, background:meta.bg, color:meta.c }}>
                                {meta.icon} {meta.label}
                              </span>
                            </td>
                            <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', fontWeight:700, color:r.score!=null?pctColor(r.score/(r.hw.totalScore||10)*100):'var(--text3)' }}>
                              {r.score!=null?`${r.score}/${r.hw.totalScore||'—'}`:'—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}

          {/* ══════════════════════════════════════════════════
              MATERIALS TAB
          ══════════════════════════════════════════════════ */}
          {(activeTab==='materials') && (
            <Section icon="📚" title="المذكرات الدراسية" count={data.matRows.length} accentColor="#3b82f6" noPad>
              {data.matRows.length===0 ? <EmptySection msg="لا توجد مذكرات"/> : (
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.83rem' }}>
                    <thead style={{ background:'var(--surface2)' }}>
                      <tr>{['المذكرة','المادة','السعر','استلم','تاريخ الاستلام','حالة الدفع','المدفوع'].map(h=>(
                        <th key={h} style={{ padding:'10px 18px', textAlign:'right', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.07em', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {data.matRows.map((r,i)=>{
                        const payMeta = PAY_STATUS_META[r.payStatus] || PAY_STATUS_META.unpaid;
                        return (
                          <tr key={i}
                            style={{ background:i%2===0?'':'var(--surface2)' }}
                            onMouseOver={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='var(--hover-row)')}
                            onMouseOut={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='')}
                          >
                            <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', fontWeight:600 }}>{r.mat.name}</td>
                            <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', color:'var(--text2)' }}>{r.mat.subject}</td>
                            <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', fontWeight:700, color:'#10b981' }}>{r.mat.price} ج.م</td>
                            <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)' }}>
                              <span style={{ fontWeight:700, color:r.received?'#10b981':'#ef4444' }}>{r.received?'✓ استلم':'✗ لم يستلم'}</span>
                            </td>
                            <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', color:'var(--text3)' }}>
                              {r.receivedAt?formatDate(r.receivedAt,{month:'short',day:'numeric'}):'—'}
                            </td>
                            <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)' }}>
                              <span style={{ display:'inline-flex', padding:'3px 10px', borderRadius:99, fontSize:'0.7rem', fontWeight:700, background:payMeta.bg, color:payMeta.c }}>{payMeta.l}</span>
                            </td>
                            <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', fontWeight:700, color:'#10b981' }}>
                              {r.paidAmount>0?`${r.paidAmount} ج.م`:'—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}

          {/* ══════════════════════════════════════════════════
              PAYMENTS TAB
          ══════════════════════════════════════════════════ */}
          {(activeTab==='payments') && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              {/* Totals — Gross/Refunded/Net (BUG-02: الجدول أدناه يعرض المبالغ الأصلية
                  التاريخية كما هي، فالإجمالي هنا يبقى خاماً مطابقاً لمجموعها؛ الاسترداد
                  يظهر كبند منفصل، والصافي = الإجمالي − المسترد) */}
              <div style={{ display:'grid', gridTemplateColumns: data.refundedTotal > 0 ? 'repeat(5,1fr)' : 'repeat(3,1fr)', gap:12 }}>
                <KpiCard icon="💰" label="إجمالي المدفوع"  value={formatCurrency(data.totalPaid)}  color="#10b981"/>
                {data.refundedTotal > 0 && (
                  <>
                    <KpiCard icon="↩️" label="المسترد"      value={formatCurrency(data.refundedTotal)} color="#ef4444"/>
                    <KpiCard icon="💵" label="الصافي"       value={formatCurrency(data.netPaid)}   color="#3b82f6"/>
                  </>
                )}
                <KpiCard icon="🧾" label="عدد الدفعات"      value={data.paidCount}                  color="#3b82f6"/>
                <KpiCard icon="📚" label="مذكرات (مجموع)"  value={formatCurrency(data.matTotal)}   color="#8b5cf6"/>
              </div>

              <Section icon="💰" title="سجل المدفوعات" count={data.payRows.length} accentColor="#10b981" noPad>
                {data.payRows.length===0 ? <EmptySection msg="لا توجد مدفوعات"/> : (
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.83rem' }}>
                      <thead style={{ background:'var(--surface2)' }}>
                        <tr>{['تاريخ الدفع','الشهر','المبلغ','طريقة الدفع','الحالة','ملاحظات'].map(h=>(
                          <th key={h} style={{ padding:'10px 18px', textAlign:'right', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.07em', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {data.payRows.slice().reverse().map((p,i)=>{
                          const meta = PAY_STATUS_META[p.status]||PAY_STATUS_META.paid;
                          return (
                            <tr key={p.id}
                              style={{ background:i%2===0?'':'var(--surface2)' }}
                              onMouseOver={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='var(--hover-row)')}
                              onMouseOut={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='')}
                            >
                              <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', color:'var(--text3)' }}>{formatDate(p.date,{year:'2-digit',month:'short',day:'numeric'})}</td>
                              <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', color:'var(--text2)' }}>{MONTHS_AR[(p.month||1)-1]} {p.year||''}</td>
                              <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', fontWeight:900, color:'#10b981', fontSize:'0.95rem' }}>{formatCurrency(p.amount)}</td>
                              <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', color:'var(--text3)' }}>{PAY_METHOD[p.method]||p.method}</td>
                              <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)' }}>
                                <span style={{ display:'inline-flex', padding:'3px 10px', borderRadius:99, fontSize:'0.7rem', fontWeight:700, background:meta.bg, color:meta.c }}>{meta.l}</span>
                              </td>
                              <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', color:'var(--text3)', fontSize:'0.78rem' }}>{p.notes||'—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{ background:'var(--surface2)' }}>
                          <td colSpan={2} style={{ padding:'10px 18px', fontWeight:800, fontSize:'0.82rem' }}>
                            {data.refundedTotal > 0 ? 'الإجمالي (قبل الاسترداد)' : 'الإجمالي'}
                          </td>
                          <td colSpan={4} style={{ padding:'10px 18px', fontWeight:900, color:'#10b981', fontSize:'1rem' }}>{formatCurrency(data.totalPaid)}</td>
                        </tr>
                        {data.refundedTotal > 0 && (
                          <tr style={{ background:'var(--surface2)' }}>
                            <td colSpan={2} style={{ padding:'10px 18px', fontWeight:800, fontSize:'0.82rem' }}>الصافي (بعد الاسترداد)</td>
                            <td colSpan={4} style={{ padding:'10px 18px', fontWeight:900, color:'#3b82f6', fontSize:'1rem' }}>{formatCurrency(data.netPaid)}</td>
                          </tr>
                        )}
                      </tfoot>
                    </table>
                  </div>
                )}
              </Section>
            </div>
          )}

          {/* ══════════════════════════════════════════════════
              TIMELINE TAB
          ══════════════════════════════════════════════════ */}
          {(activeTab==='timeline') && (
            <Section icon="🕐" title={`التاريخ الكامل للطالب`} count={data.timeline.length} accentColor="#0d9488">
              {data.timeline.length === 0 ? <EmptySection msg="لا توجد أحداث مسجّلة"/> : (
                <div style={{ maxHeight:600, overflowY:'auto', paddingLeft:8 }}>
                  {data.timeline.map((t,i)=>(
                    <TimelineItem key={i} {...t} last={i===data.timeline.length-1}/>
                  ))}
                </div>
              )}
            </Section>
          )}

        </div>
      )}

      {waPreview && (
        <WhatsappPreviewModal
          studentName={waPreview.studentName}
          parentPhone={waPreview.parentPhone}
          message={waPreview.message}
          onCopy={copyMessage}
          onOpen={handleWaOpen}
          onClose={() => setWaPreview(null)}
        />
      )}
    </div>
  );
}
