// src/modules/student-report/StudentReportPage.jsx
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAppStore } from '../../store/app.store';
import { useAuth } from '../../store/auth.context';
import { useToast } from '../../components/Toast';
import { formatDate, formatCurrency } from '../../utils/helpers';
import { openStudentReportPrint } from './buildPrintReport';
import { generateStudentReport } from './buildStudentReport';
import { generateMessage, copyMessage, openWhatsapp } from './studentWhatsappService';
import WhatsappPreviewModal from './WhatsappPreviewModal';
import { pgCreateWaReportLog, pgGetStudentReportData } from '../../services/api';
import { buildInteractiveReportData } from './reportData';
import { useAsyncData } from '../../hooks/useAsyncData';
import { isSectionVisible } from '../../reportEngine';

// أي تاب من التابات أدناه يقابل أي علم في reportConfig — "نظرة عامة" وحدها بلا علم (تبقى
// ظاهرة دائماً، هي لوحة التجميع الافتراضية لا قسم مستقل قابل للإخفاء؛ نفس معاملة بطاقة
// هوية الطالب أعلى الصفحة — انظر تعليق REPORT_SECTIONS في reportMeta.js لشرح النطاق كاملاً).
const TAB_SECTION_KEY = {
  attendance: 'showAttendance',
  exams:      'showExams',
  recitation: 'showRecitation',
  homeworks:  'showHomework',
  materials:  'showBooklets',
  payments:   'showPaymentHistory',
  timeline:   'showAcademicTimeline',
};

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
  // absenceFollowup: لا نقطة نهاية مُصفّاة (scoped) لهذه الـ collection حتى الآن — تبقى
  // مقروءة من الـ store الكامل عمداً (خارج نطاق هذه المرحلة، انظر تقرير التنفيذ).
  const absFollowup   = useAppStore(s => s.absenceFollowup);
  const centerProfile = useAppStore(s => s.centerProfile);
  // إعدادات أقسام التقرير الاحترافي (Settings ← أقسام التقرير) — محلية، منظّمة الأصل
  // (نفس نمط centerProfile)، انظر src/store/slices/reportSettings.slice.js.
  const reportConfig   = useAppStore(s => s.reportConfig);
  const { currentUser } = useAuth();
  const toast = useToast();
  const currentUserName = currentUser?.name || currentUser?.id || 'النظام';
  const addWaReportLog = useAppStore(s => s.addWaReportLog);

  // Phase 2 (Scalability Architecture) — التقرير الاحترافي ورسالة واتساب كلاهما يستهلكان
  // gatherStudentData (reportData.js)، وكانا يُغذَّيان بـ "fullStore" محلي مُجمَّع يدوياً من
  // شرائح الـ store هنا — لكنه كان ناقصاً hwSubmissions/invMaterials (لم يُضافا إليه قط رغم
  // أن gatherStudentData تقرأهما)، فكانت درجة الواجبات في التقرير المطبوع تصل null دائماً
  // والمذكرات المسلَّمة تصل بلا اسم/سعر/متبقٍّ دائماً — بصرف النظر عن البيانات الحقيقية.
  // يُستبدَل الآن بحزمة مصغَّرة حقيقية من الخادم (GET /students/:id/report-data) تشمل
  // الحقلين الناقصين — تصحيح صريح موثَّق هنا، لا استبدال صامت لسلوك آخر.
  const [reportBusy, setReportBusy] = useState(false); // يُعطِّل زرّي "تقرير احترافي"/"واتساب" أثناء الجلب فقط

  // ── workflow معاينة رسالة واتساب (المنطق كله في الـ service) ──
  const [waPreview, setWaPreview] = useState(null);

  const handleOpenPreview = async () => {
    setReportBusy(true);
    try {
      const bundle = await pgGetStudentReportData(student.id);
      const result = generateMessage(student.id, bundle, { profile: centerProfile });
      if (!result) { toast.error('تعذّر توليد الرسالة'); return; }
      setWaPreview(result);
    } catch (err) {
      toast.error(err.message || 'تعذّر جلب بيانات التقرير');
    } finally {
      setReportBusy(false);
    }
  };

  const handleGenerateProfessionalReport = async () => {
    setReportBusy(true);
    try {
      const bundle = await pgGetStudentReportData(student.id);
      generateStudentReport(student.id, bundle, { profile: centerProfile, generatedBy: currentUserName, config: reportConfig });
    } catch (err) {
      toast.error(err.message || 'تعذّر جلب بيانات التقرير');
    } finally {
      setReportBusy(false);
    }
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

  // ── All report data (Scalability Architecture Phase 4) ──────────────────
  // بدل تسع مصفوفات كاملة من الـ store، يُجلَب تاريخ هذا الطالب فقط عبر GET /students/
  // :id/report-data (نفس الحزمة المُستخدَمة بالفعل للتقرير الاحترافي/واتساب أدناه)، ثم
  // buildInteractiveReportData (reportData.js) يحوّلها لنفس شكل data الحالي بالضبط —
  // بلا أي تغيير على أي حساب، فقط تغيير مصدر البيانات. طلب واحد فقط لكل طالب مُختار
  // (لا طلبات منفصلة للحضور/الامتحانات/الواجبات/إلخ).
  const {
    data:    reportBundle,
    loading: reportDataLoading,
    error:   reportDataError,
  } = useAsyncData(
    () => (student ? pgGetStudentReportData(student.id) : Promise.resolve(null)),
    [student?.id],
    null,
  );

  useEffect(() => {
    if (reportDataError) toast.error(reportDataError.message || 'فشل تحميل بيانات التقرير');
  }, [reportDataError]);

  const data = useMemo(() => {
    if (!student || !reportBundle) return null;
    // حارس سباق: طالب جديد يُختار قبل اكتمال جلب سابق — الحزمة القديمة (لطالب آخر) لا
    // تُعرَض أبداً حتى تصل الحزمة الصحيحة الخاصة بالطالب الحالي (بغضّ النظر عن توقيت
    // تحديث علم loading نفسه)، فلا يظهر تقرير طالب سابق ولو للحظة.
    if (reportBundle.students?.[0]?.id !== student.id) return null;

    const built = buildInteractiveReportData(student.id, reportBundle);
    if (!built) return null;

    // متابعة الغياب: لا نقطة نهاية مُصفّاة لهذه الـ collection بعد (خارج نطاق هذه
    // المرحلة) — تبقى مُشتَقّة من absFollowup الكامل من الـ store، بنفس المنطق الحالي.
    const absentIds = built.attAll.filter(r => r.status === 'absent').map(r => r.id);
    const followups = absFollowup?.filter(f => absentIds.includes(f.attendanceId)) || [];

    return { ...built, followups };
  }, [student, reportBundle, absFollowup]);

  // يميّز "لا يوجد طالب مُختار بعد" عن "طالب مُختار، لسّه بيتحمّل" عن "فشل التحميل" —
  // الجسم الرئيسي أدناه يعرض واحداً من الثلاث بلا أي بيانات ناقصة/طالب سابق.
  const reportIsLoading = !!student && reportDataLoading;
  const reportHasError  = !!student && !reportDataLoading && !!reportDataError;

  // ── Tab definitions ──────────────────────────────────────
  // كل تاب مربوط بعلمه في TAB_SECTION_KEY (عدا "نظرة عامة" — دائماً ظاهرة). تصفية حسب
  // reportConfig هنا فقط: لو صار التاب النشط الحالي مخفياً (تغيير إعداد أثناء العرض)،
  // effectiveTab أدناه يتراجع تلقائياً لـ "نظرة عامة" بدل عرض محتوى تاب لا يملك زراً.
  const TABS = [
    { id:'overview',    icon:'📊', label:'نظرة عامة' },
    { id:'attendance',  icon:'✓',  label:'الحضور'     },
    { id:'exams',       icon:'📝', label:'الامتحانات' },
    { id:'recitation',  icon:'🎤', label:'التسميع'    },
    { id:'homeworks',   icon:'📋', label:'الواجبات'   },
    { id:'materials',   icon:'📚', label:'المذكرات'   },
    { id:'payments',    icon:'💰', label:'المدفوعات'  },
    { id:'timeline',    icon:'🕐', label:'التاريخ'    },
  ].filter(t => !TAB_SECTION_KEY[t.id] || isSectionVisible(reportConfig, TAB_SECTION_KEY[t.id]));

  const effectiveTab = TABS.some(t => t.id === activeTab) ? activeTab : 'overview';

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
            <button onClick={() => openStudentReportPrint({ student, group, data, profile: centerProfile, config: reportConfig })}
              style={{ display:'flex', alignItems:'center', gap:7, padding:'9px 18px', borderRadius:10, border:'1px solid var(--border)', background:'var(--surface2)', color:'var(--text2)', fontSize:'0.88rem', fontWeight:700, cursor:'pointer', transition:'all .15s' }}
              onMouseOver={e=>{e.currentTarget.style.background='var(--surface3)';e.currentTarget.style.color='var(--text)';}}
              onMouseOut={e =>{e.currentTarget.style.background='var(--surface2)';e.currentTarget.style.color='var(--text2)';}}>
              🖨 طباعة / PDF
            </button>
            <button onClick={handleGenerateProfessionalReport} disabled={reportBusy}
              style={{ display:'flex', alignItems:'center', gap:7, padding:'9px 18px', borderRadius:10, border:'none', background:'#2563eb', color:'#fff', fontSize:'0.88rem', fontWeight:700, cursor: reportBusy ? 'wait' : 'pointer', opacity: reportBusy ? 0.7 : 1, transition:'opacity .15s' }}
              onMouseOver={e=>{if(!reportBusy)e.currentTarget.style.opacity='0.9';}}
              onMouseOut={e =>{if(!reportBusy)e.currentTarget.style.opacity='1';}}>
              ⭐ تقرير احترافي (PDF)
            </button>
            <button onClick={handleOpenPreview} disabled={reportBusy}
              style={{ display:'flex', alignItems:'center', gap:7, padding:'9px 18px', borderRadius:10, border:'none', background:'#25D366', color:'#fff', fontSize:'0.88rem', fontWeight:700, cursor: reportBusy ? 'wait' : 'pointer', opacity: reportBusy ? 0.7 : 1, transition:'opacity .15s' }}
              onMouseOver={e=>{if(!reportBusy)e.currentTarget.style.opacity='0.9';}}
              onMouseOut={e =>{if(!reportBusy)e.currentTarget.style.opacity='1';}}>
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

      {/* ── Loading state (جلب بيانات التقرير المُصفّاة لهذا الطالب) ─── */}
      {reportIsLoading && (
        <div style={{ textAlign:'center', padding:'80px 20px', color:'var(--text3)' }}>
          <div style={{ fontSize:40, opacity:.4, marginBottom:12 }}>⏳</div>
          <div style={{ fontWeight:700, fontSize:'0.95rem' }}>...جارِ تحميل تقرير الطالب</div>
        </div>
      )}

      {/* ── Error state ──────────────────────────────── */}
      {reportHasError && (
        <div style={{ textAlign:'center', padding:'80px 20px', color:'var(--red)' }}>
          <div style={{ fontSize:40, opacity:.4, marginBottom:12 }}>⚠</div>
          <div style={{ fontWeight:700, fontSize:'0.95rem' }}>تعذّر تحميل تقرير الطالب</div>
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
                    ['👤','المدرس',         group?.teacherName||'—',  false ],
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
              {/* Overall score ring — بيانات امتحانات (exam average)، ليست هوية، فتتبع
                  showExams مثل أي مكان آخر تظهر فيه؛ اسم/كود/حالة الطالب أعلاه تبقى ظاهرة
                  دائماً (هوية التقرير، لا قسم قابل للإخفاء). */}
              {isSectionVisible(reportConfig, 'showExams') && (
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8, flexShrink:0 }} className="no-print">
                  <Ring pct={data.avgExamPct||0} color={pctColor(data.avgExamPct)} size={84} strokeW={7}/>
                  <div style={{ textAlign:'center' }}>
                    <div style={{ fontSize:'1.3rem', fontWeight:900, color:pctColor(data.avgExamPct), lineHeight:1 }}>
                      {data.avgExamPct!=null ? `${data.avgExamPct}%` : '—'}
                    </div>
                    <div style={{ fontSize:'0.62rem', color:'var(--text3)', marginTop:3 }}>متوسط الامتحانات</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Quick KPIs ─────────────────────────────
              كل KPI مربوط بعلم قسمه (flag، ليس prop لـ KpiCard — يُستبعَد قبل map عبر
              destructuring) — إخفاء قسم يُخفي مؤشّراته هنا أيضاً، لا فقط تابه، فلا يتسرّب
              أي رقم مالي/دراسي عبر لوحة النظرة العامة بينما قسمه مُطفَأ من الإعدادات. */}
          {(() => {
            const kpis = [
              { icon:'✓',  label:'نسبة الحضور',    value:data.attPct!=null?`${data.attPct}%`:'—',    color:pctColor(data.attPct),   flag:'showAttendance' },
              { icon:'📝', label:'متوسط الامتحانات', value:data.avgExamPct!=null?`${data.avgExamPct}%`:'—', color:pctColor(data.avgExamPct), flag:'showExams' },
              { icon:'📋', label:'إنجاز الواجبات',  value:data.hwRows.length?`${Math.round((data.hwSubmitted+data.hwLate)/data.hwRows.length*100)}%`:'—', color:'#8b5cf6', flag:'showHomework' },
              { icon:'💰', label:'صافي المدفوع',  value:formatCurrency(data.netPaid), color:'#10b981', flag:'showFinancialSummary' },
              { icon:'📚', label:'مذكرات استُلمت',  value:`${data.matReceived}/${data.matRows.length}`, color:'#3b82f6', flag:'showBooklets' },
              { icon:'🕐', label:'جلسات الحضور',    value:data.attAll.length, color:'var(--text)', flag:'showAttendance' },
            ].filter(k => isSectionVisible(reportConfig, k.flag));
            return kpis.length ? (
              <div style={{ display:'grid', gridTemplateColumns:`repeat(${kpis.length},1fr)`, gap:12 }}>
                {kpis.map(({ flag, ...k }) => <KpiCard key={k.label} {...k}/>)}
              </div>
            ) : null;
          })()}

          {/* ── Tabs ─────────────────────────────────── */}
          <div className="no-print" style={{ display:'flex', gap:2, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:14, padding:4, overflowX:'auto', flexShrink:0 }}>
            {TABS.map(t => (
              <button key={t.id} onClick={()=>setActiveTab(t.id)}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 18px', borderRadius:10, fontSize:'0.88rem', fontWeight:effectiveTab===t.id?800:500, cursor:'pointer', transition:'all .15s', border:'none', whiteSpace:'nowrap',
                  background:  effectiveTab===t.id ? 'var(--surface)' : 'transparent',
                  color:       effectiveTab===t.id ? 'var(--accent)'   : 'var(--text3)',
                  boxShadow:   effectiveTab===t.id ? '0 2px 8px rgba(0,0,0,.15)' : 'none',
                }}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* ══════════════════════════════════════════════════
              OVERVIEW TAB
          ══════════════════════════════════════════════════ */}
          {(effectiveTab==='overview') && (() => {
            // نفس منطق "نظرة عامة" مُصغَّر لكل قسم من مؤشرات "المدفوعات السريعة" أعلاه —
            // بطاقات هذا التاب تُلخِّص الحضور/الامتحانات/المالية/الواجبات بصورة مصغَّرة
            // مستقلة تماماً عن التابات المخصَّصة (Attendance/Exams/… تابات)، فتحتاج نفس
            // التصفية بعلمها الخاص هنا أيضاً — وإلا يتسرّب نفس النوع من البيانات (مثال:
            // مالية) عبر هذا التاب حتى لو تاب "المدفوعات" نفسه مُخفى بالكامل.
            const summaryCards = [
              {
                flag: 'showAttendance',
                node: (
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
                ),
              },
              {
                flag: 'showExams',
                node: (
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
                ),
              },
              {
                flag: 'showFinancialSummary',
                node: (
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
                ),
              },
            ].filter(c => isSectionVisible(reportConfig, c.flag));

            return (
              <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                {summaryCards.length > 0 && (
                  <div style={{ display:'grid', gridTemplateColumns:`repeat(${summaryCards.length},1fr)`, gap:16 }}>
                    {summaryCards.map((c, i) => <div key={i}>{c.node}</div>)}
                  </div>
                )}

                {/* Homework summary */}
                {isSectionVisible(reportConfig, 'showHomework') && (
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
                )}

                {/* Recent activity — نفس بيانات تاب "التاريخ" (data.timeline)، فيتبع علمه */}
                {isSectionVisible(reportConfig, 'showAcademicTimeline') && (
                  <Section icon="⏱" title="آخر النشاطات" accentColor="#0d9488">
                    {data.timeline.slice(0,6).map((t,i)=>(
                      <TimelineItem key={i} {...t} last={i===Math.min(5,data.timeline.length-1)}/>
                    ))}
                  </Section>
                )}
              </div>
            );
          })()}

          {/* ══════════════════════════════════════════════════
              ATTENDANCE TAB
          ══════════════════════════════════════════════════ */}
          {(effectiveTab==='attendance') && (
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
          {(effectiveTab==='exams') && (
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
              RECITATION TAB — نفس نمط تبويب الامتحانات أعلاه بالضبط، بلا رسم اتجاه
              (غير مطلوب هنا). كل سجل recitationRows هو جلسة تاريخية مستقلة — لا دمج.
          ══════════════════════════════════════════════════ */}
          {(effectiveTab==='recitation') && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              {data.recitationRows.length === 0 ? (
                <Section icon="🎤" title="التسميع" accentColor="#8b5cf6"><EmptySection msg="لا توجد جلسات تسميع مسجّلة"/></Section>
              ) : (
                <Section icon="🎤" title="تفاصيل التسميع" count={data.recitationRows.length} accentColor="#8b5cf6" noPad>
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.83rem' }}>
                      <thead style={{ background:'var(--surface2)' }}>
                        <tr>{['التاريخ','المجموعة','الحصة','الدرجة','من','النسبة','ملاحظة'].map(h=>(
                          <th key={h} style={{ padding:'10px 18px', textAlign:'right', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.07em', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {data.recitationRows.map((r,i)=>{
                          const color = r.pct===null?'#94a3b8':pctColor(r.pct);
                          return (
                            <tr key={i}
                              style={{ background:i%2===0?'':'var(--surface2)' }}
                              onMouseOver={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='var(--hover-row)')}
                              onMouseOut={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='')}
                            >
                              <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', color:'var(--text3)' }}>{formatDate(r.date,{month:'short',day:'numeric'})}</td>
                              <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', color:'var(--text2)' }}>{r.groupName || '—'}</td>
                              <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', color:'var(--text3)' }}>{r.sessionTime || '—'}</td>
                              <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', fontWeight:900, color }}>{r.score}</td>
                              <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', color:'var(--text3)' }}>{r.maxScore}</td>
                              <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)' }}>
                                {r.pct!==null && (
                                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                    <div style={{ width:48, height:5, background:'var(--surface3)', borderRadius:99, overflow:'hidden' }}>
                                      <div style={{ height:'100%', width:`${r.pct}%`, background:color }}/>
                                    </div>
                                    <span style={{ fontSize:'0.75rem', fontWeight:700, color }}>{r.pct}%</span>
                                  </div>
                                )}
                              </td>
                              <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', color:'var(--text3)', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.note || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {data.avgRecitationPct!==null && (
                        <tfoot>
                          <tr style={{ background:'var(--surface2)' }}>
                            <td colSpan={5} style={{ padding:'10px 18px', fontWeight:800, color:'var(--text3)', fontSize:'0.8rem' }}>المتوسط العام</td>
                            <td colSpan={2} style={{ padding:'10px 18px', fontWeight:900, color:pctColor(data.avgRecitationPct), fontSize:'0.95rem' }}>
                              {data.avgRecitationPct}%
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </Section>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════
              HOMEWORKS TAB
          ══════════════════════════════════════════════════ */}
          {(effectiveTab==='homeworks') && (
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
          {(effectiveTab==='materials') && (
            <Section icon="📚" title="المذكرات الدراسية" count={data.matRows.length} accentColor="#3b82f6" noPad>
              {data.matRows.length===0 ? <EmptySection msg="لا توجد مذكرات"/> : (
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.83rem' }}>
                    <thead style={{ background:'var(--surface2)' }}>
                      <tr>{['المذكرة','المادة','السعر','استلم','تاريخ الاستلام','حالة الدفع','المدفوع','المتبقي'].map(h=>(
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
                            <td style={{ padding:'10px 18px', borderBottom:'1px solid var(--border)', fontWeight:700, color:r.remaining>0?'#ef4444':'var(--text3)' }}>
                              {r.remaining>0?`${r.remaining} ج.م`:'—'}
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
          {(effectiveTab==='payments') && (
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
          {(effectiveTab==='timeline') && (
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
