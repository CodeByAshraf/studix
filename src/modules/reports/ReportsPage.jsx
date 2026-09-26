// src/modules/reports/ReportsPage.jsx
import { useEffect, useState, useMemo } from 'react';
import { useAppStore } from '../../store/app.store';
import { SectionBoundary } from '../../components/ErrorBoundary';
import { formatCurrency } from '../../utils/helpers';
import { pgGetPaymentAggregates, pgGetAttendanceAggregate, pgGetGradesAggregate } from '../../services/api';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useToast } from '../../components/Toast';
// المرحلة 4: lazy loading لـ sub-reports — كل تقرير يُحمَّل عند أول استخدام فقط
// يُقلّل الـ initial bundle لـ ReportsPage بنسبة ~60%
import { lazy, Suspense } from 'react';
const StudentPerformance  = lazy(() => import('./StudentPerformance'));
const AttendanceAnalytics = lazy(() => import('./AttendanceAnalytics'));
const FinancialAnalytics  = lazy(() => import('./FinancialAnalytics'));
const GroupStatistics     = lazy(() => import('./GroupStatistics'));

function TabSkeleton() {
  return (
    <div style={{ padding: 24 }}>
      {[1,2,3].map(i => (
        <div key={i} className="skeleton" style={{ height: 80, borderRadius: 12, marginBottom: 12 }}/>
      ))}
    </div>
  );
}

const TABS = [
  { id:'overview',    icon:'🏠', label:'نظرة عامة'       },
  { id:'students',    icon:'👥', label:'أداء الطلاب'      },
  { id:'attendance',  icon:'✓',  label:'تحليل الحضور'    },
  { id:'financial',   icon:'💰', label:'التحليل المالي'   },
  { id:'groups',      icon:'◈',  label:'إحصائيات المجموعات' },
];

// ── Executive summary ────────────────────────────────────────
function OverviewDashboard() {
  const exams                = useAppStore((s) => s.exams);
  const groups               = useAppStore((s) => s.groups);
  const students             = useAppStore((s) => s.students);
  const toast = useToast();

  const now = new Date();
  const thisMonth = now.getMonth() + 1;
  const thisYear  = now.getFullYear();

  // Monthly revenue trend (last 6 months) — يعبر حدود السنة أحياناً (مثال: فبراير
  // يشمل سبتمبر–ديسمبر من السنة السابقة)، فيُحسَب الشهر والسنة معاً عبر Date بدل حساب
  // دوري (modulo) يتجاهل السنة تماماً. trendMonths/trendYears يُحسَبان هنا فقط لتحديد
  // أي سنوات تقويمية يجب طلب /aggregate?groupBy=month لها (سنة واحدة أو سنتان).
  const trendMonths = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const d = new Date(thisYear, (thisMonth - 1) - (5 - i), 1);
    return { month: d.getMonth() + 1, year: d.getFullYear() };
  }), [thisMonth, thisYear]);
  const trendYears = useMemo(() => [...new Set(trendMonths.map(t => t.year))], [trendMonths]);

  // Scalability Architecture Phase 4 Cutover 2: بدل مصفوفة payments الكاملة من الـ
  // store، كل رقم هنا يُجلَب عبر GET /api/payments/aggregate — بلا أي تغيير على صيغة أي
  // حساب (نفس getNetRevenue بالضبط، مطابقة صارمة month+year بلا أي fallback — لا يوجد
  // fallback هنا أصلاً في السلوك الحالي، فلا يُضاف الآن).
  const { data: monthAgg = [], error: monthErr } = useAsyncData(
    () => pgGetPaymentAggregates({ groupBy: 'none', month: thisMonth, year: thisYear }), [thisMonth, thisYear], []);
  const { data: totalAgg = [], error: totalErr } = useAsyncData(
    () => pgGetPaymentAggregates({ groupBy: 'none' }), [], []);
  const { data: statusAgg = [], error: statusErr } = useAsyncData(
    () => pgGetPaymentAggregates({ groupBy: 'status' }), [], []);
  const { data: trendAggY1 = [], error: trendErr1 } = useAsyncData(
    () => pgGetPaymentAggregates({ groupBy: 'month', year: trendYears[0] }), [trendYears[0]], []);
  const { data: trendAggY2 = [], error: trendErr2 } = useAsyncData(
    () => (trendYears[1] !== undefined ? pgGetPaymentAggregates({ groupBy: 'month', year: trendYears[1] }) : Promise.resolve([])),
    [trendYears[1]], []);

  // Attendance C4 Batch A: بدل مصفوفة attendance الكاملة من الـ store، النسبة المئوية هنا
  // تُحسَب عبر GET /api/attendance/aggregate?groupBy=status — نفس عدّاد present/(present+
  // absent+late) بالضبط، فقط مصدره الآن عدّ من جهة الخادم بدل تصفية مصفوفة كاملة محلياً.
  const { data: attStatusAgg = [], error: attStatusErr } = useAsyncData(
    () => pgGetAttendanceAggregate({ groupBy: 'status' }), [], []);

  // Phase 1D (Grades global-read migration): "متوسط الدرجات" now comes from
  // GET /api/grades/aggregate?groupBy=none instead of filtering the store's global grades
  // array — same mean-of-(score/exam.total*100) formula, computed server-side.
  const { data: gradesOverall = [], error: gradesOverallErr } = useAsyncData(
    () => pgGetGradesAggregate({ groupBy: 'none' }), [], []);

  useEffect(() => {
    const err = monthErr || totalErr || statusErr || trendErr1 || trendErr2 || attStatusErr || gradesOverallErr;
    if (err) toast.error(err.message || 'فشل تحميل ملخّص المدفوعات');
  }, [monthErr, totalErr, statusErr, trendErr1, trendErr2, attStatusErr, gradesOverallErr]);

  const summary = useMemo(() => {
    // Students
    const activeStudents = students.filter(s => s.status==='active').length;
    const newThisMonth   = students.filter(s => s.enrollDate?.startsWith(now.toISOString().slice(0,7))).length;

    // Revenue — monthRev/totalRev وعدداهما (payments.length/هذا الشهر) من نفس نداءَي
    // /aggregate?groupBy=none أعلاه، بلا نداء إضافي.
    const monthRev = monthAgg[0]?.revenue ?? 0;
    const totalRev = totalAgg[0]?.revenue ?? 0;
    const totalCount = totalAgg[0]?.count ?? 0;
    const monthCount = monthAgg[0]?.count ?? 0;
    const paidCount  = statusAgg.find(r => r.key === 'paid')?.count ?? 0;

    // Attendance — counts per status from the server-side aggregate (groupBy=status);
    // a status with zero rows is simply absent from attStatusAgg, so default to 0.
    const attByStatus = new Map(attStatusAgg.map(r => [r.key, r.count]));
    const attPresent  = attByStatus.get('present') ?? 0;
    const attAbsent   = attByStatus.get('absent')  ?? 0;
    const attLate     = attByStatus.get('late')    ?? 0;
    const attTotal    = attPresent + attAbsent + attLate;
    const attPct      = attTotal ? Math.round(attPresent / attTotal * 100) : null;

    // Exams avg — gradesOverall is already the server-side mean, scoped to non-absent,
    // scored grades only (GET /api/grades/aggregate?groupBy=none).
    const avgExamPct = gradesOverall[0]?.avgPct ?? null;

    // Groups
    const fullGroups = groups.filter(g => {
      const count = students.filter(s => s.groupId===g.id && s.status==='active').length;
      return count >= g.max;
    }).length;

    const revenueByYearMonth = new Map();
    for (const r of trendAggY1) revenueByYearMonth.set(`${trendYears[0]}-${r.key}`, r.revenue);
    if (trendYears[1] !== undefined) for (const r of trendAggY2) revenueByYearMonth.set(`${trendYears[1]}-${r.key}`, r.revenue);
    const monthlyTrend = trendMonths.map(({ month, year }) => revenueByYearMonth.get(`${year}-${month}`) ?? 0);

    return { activeStudents, newThisMonth, monthRev, totalRev, totalCount, monthCount, paidCount, attPct, avgExamPct, fullGroups, monthlyTrend };
  }, [students, groups, attStatusAgg, gradesOverall, monthAgg, totalAgg, statusAgg, trendAggY1, trendAggY2, trendMonths, trendYears]);

  const M = ['Cairo,sans-serif'];

  const Big = ({ icon, label, value, sub, color='var(--accent)', trend }) => (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'20px 22px', position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', top:-16, left:-8, width:70, height:70, borderRadius:'50%', background:`${color}10` }}/>
      <div style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:8 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize:'1.9rem', fontWeight:800, color, fontFamily:M, letterSpacing:'-0.5px', lineHeight:1 }}>{value}</div>
      {sub && <div style={{ fontSize:'0.72rem', color:'var(--text3)', marginTop:6 }}>{sub}</div>}
      {trend && <div style={{ fontSize:'0.72rem', fontWeight:700, marginTop:6, color:trend.up?'#10b981':'#f59e0b' }}>{trend.text}</div>}
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      {/* Big numbers */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14 }}>
        <Big icon="👥" label="الطلاب النشطون"   value={summary.activeStudents} color="#3b82f6"
          trend={summary.newThisMonth>0?{up:true,text:`↑ +${summary.newThisMonth} هذا الشهر`}:undefined}/>
        <Big icon="💰" label={`إيراد هذا الشهر`} value={formatCurrency(summary.monthRev)} color="#10b981"
          sub={`من إجمالي ${formatCurrency(summary.totalRev)}`}/>
        <Big icon="✓"  label="معدل الحضور"        value={summary.attPct!==null?`${summary.attPct}%`:'—'}
          color={summary.attPct>=80?'#10b981':summary.attPct>=60?'#f59e0b':'#ef4444'}/>
        <Big icon="📊" label="متوسط الدرجات"      value={summary.avgExamPct!==null?`${summary.avgExamPct}%`:'—'}
          color={summary.avgExamPct>=70?'#10b981':summary.avgExamPct>=50?'#f59e0b':'#ef4444'}/>
      </div>

      {/* Quick stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14 }}>
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'18px' }}>
          <div style={{ fontSize:'0.75rem', fontWeight:700, color:'var(--text3)', marginBottom:12 }}>📦 المجموعات</div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            <div style={{ display:'flex', justifyContent:'space-between' }}>
              <span style={{ fontSize:'0.82rem', color:'var(--text2)' }}>إجمالي</span>
              <span style={{ fontWeight:700, fontFamily:M }}>{groups.length}</span>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between' }}>
              <span style={{ fontSize:'0.82rem', color:'var(--text2)' }}>ممتلئة</span>
              <span style={{ fontWeight:700, color:'#ef4444', fontFamily:M }}>{summary.fullGroups}</span>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between' }}>
              <span style={{ fontSize:'0.82rem', color:'var(--text2)' }}>متاحة</span>
              <span style={{ fontWeight:700, color:'#10b981', fontFamily:M }}>{groups.length - summary.fullGroups}</span>
            </div>
          </div>
        </div>

        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'18px' }}>
          <div style={{ fontSize:'0.75rem', fontWeight:700, color:'var(--text3)', marginBottom:12 }}>📝 الامتحانات</div>
          {[
            {l:'إجمالي الامتحانات', v:exams.length},
            {l:'قيد التصحيح',       v:exams.filter(e=>e.status==='grading').length, c:'#f59e0b'},
            {l:'قادمة',             v:exams.filter(e=>e.status==='upcoming').length, c:'#3b82f6'},
          ].map(x=>(
            <div key={x.l} style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
              <span style={{ fontSize:'0.82rem', color:'var(--text2)' }}>{x.l}</span>
              <span style={{ fontWeight:700, color:x.c||'var(--text)', fontFamily:M }}>{x.v}</span>
            </div>
          ))}
        </div>

        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'18px' }}>
          <div style={{ fontSize:'0.75rem', fontWeight:700, color:'var(--text3)', marginBottom:12 }}>💳 المدفوعات</div>
          {[
            {l:'إجمالي الدفعات',  v:summary.totalCount},
            {l:'هذا الشهر',       v:summary.monthCount, c:'var(--accent)'},
            {l:'مدفوعات كاملة',   v:summary.paidCount, c:'#10b981'},
          ].map(x=>(
            <div key={x.l} style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
              <span style={{ fontSize:'0.82rem', color:'var(--text2)' }}>{x.l}</span>
              <span style={{ fontWeight:700, color:x.c||'var(--text)', fontFamily:M }}>{x.v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Revenue trend mini bars */}
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'18px 20px' }}>
        <div style={{ fontSize:'0.85rem', fontWeight:700, marginBottom:14 }}>📈 اتجاه الإيراد — آخر 6 أشهر</div>
        <div style={{ display:'flex', alignItems:'flex-end', gap:8, height:80 }}>
          {summary.monthlyTrend.map((v, i) => {
            const max = Math.max(...summary.monthlyTrend, 1);
            const pct = Math.round((v/max)*100);
            const isLast = i===summary.monthlyTrend.length-1;
            return (
              <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                {v>0 && <span style={{ fontSize:'0.62rem', color:isLast?'var(--accent)':'var(--text3)', fontFamily:M, fontWeight:700 }}>
                  {v>999?`${Math.round(v/1000)}k`:v}
                </span>}
                <div style={{ width:'100%', height:`${pct||4}%`, background:isLast?'var(--accent)':'#3b82f640', borderRadius:'4px 4px 0 0', border:`1px solid ${isLast?'var(--accent)':'#3b82f620'}`, position:'relative', overflow:'hidden' }}>
                  <div style={{ position:'absolute', bottom:0, width:'100%', height:'100%', background:isLast?'var(--accent)':'#3b82f680', borderRadius:'3px 3px 0 0' }}/>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div>
      {/* Page header */}
      <div style={{ padding:'0 28px', marginBottom:20 }}>
        <h1 style={{ fontSize:'1.35rem', fontWeight:800, letterSpacing:'-0.3px', marginBottom:3 }}>التقارير والتحليلات</h1>
        <p style={{ fontSize:'0.78rem', color:'var(--text3)' }}>لوحات بيانات شاملة لكافة جوانب المركز</p>
      </div>

      {/* Tabs */}
      <div style={{ padding:'0 28px', marginBottom:24, overflowX:'auto' }}>
        <div style={{ display:'flex', gap:2, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:12, padding:3, width:'fit-content' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              style={{
                display:'flex', alignItems:'center', gap:6,
                padding:'9px 18px', borderRadius:10,
                fontSize:'0.85rem', fontWeight:activeTab===t.id?700:500,
                cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .15s', border:'none',
                background:activeTab===t.id ? 'var(--surface)' : 'transparent',
                color:      activeTab===t.id ? 'var(--accent)'  : 'var(--text2)',
                boxShadow:  activeTab===t.id ? '0 1px 4px rgba(0,0,0,.15)' : 'none',
                whiteSpace: 'nowrap',
              }}
              onMouseOver={e => { if(activeTab!==t.id){e.currentTarget.style.background='var(--surface3)';e.currentTarget.style.color='var(--text)';} }}
              onMouseOut={e  => { if(activeTab!==t.id){e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--text2)';} }}
            >
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding:'0 28px 40px', animation:'pageIn .2s ease' }}>

        <SectionBoundary label={`reports:${activeTab}`}>
          {activeTab === 'overview'   && <OverviewDashboard/>}
          {activeTab === 'students'   && <Suspense fallback={<TabSkeleton/>}><StudentPerformance/></Suspense>}
          {activeTab === 'attendance' && <Suspense fallback={<TabSkeleton/>}><AttendanceAnalytics/></Suspense>}
          {activeTab === 'financial'  && <Suspense fallback={<TabSkeleton/>}><FinancialAnalytics/></Suspense>}
          {activeTab === 'groups'     && <Suspense fallback={<TabSkeleton/>}><GroupStatistics/></Suspense>}
        </SectionBoundary>
      </div>
    </div>
  );
}
