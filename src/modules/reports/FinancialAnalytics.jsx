// src/modules/reports/FinancialAnalytics.jsx
import { useMemo } from 'react';
import { useAppStore } from '../../store/app.store';
import { formatCurrency, formatDate } from '../../utils/helpers';
import { MetricCard, BarChart, DonutChart, AnalyticsCard, SparkLine, StatRow } from './components/ChartComponents';
import { MONTHS_AR, PAYMENT_METHODS, PAYMENT_STATUS } from '../../services/paymentService';

export default function FinancialAnalytics() {
  const groups               = useAppStore((s) => s.groups);
  const payments             = useAppStore((s) => s.payments);
  const students             = useAppStore((s) => s.students);

  const stats = useMemo(() => {
    const total       = payments.reduce((s,p) => s+p.amount, 0);
    const currentMonth= new Date().getMonth()+1;
    const currentYear = new Date().getFullYear();
    const monthRev    = payments.filter(p=>p.month===currentMonth&&(!p.year||p.year===currentYear)).reduce((s,p)=>s+p.amount,0);
    // MEDIUM-A Finding 1: نفس شهر ديسمبر/يناير عبر تغيير السنة — الشهر السابق قد يقع في
    // سنة مختلفة (لو currentMonth === يناير، الشهر السابق هو ديسمبر السنة الماضية).
    const lastMonthNum = currentMonth-1||12;
    const lastMonthYear= currentMonth===1 ? currentYear-1 : currentYear;
    const lastMonthRev= payments.filter(p=>p.month===lastMonthNum&&(!p.year||p.year===lastMonthYear)).reduce((s,p)=>s+p.amount,0);
    const growth      = lastMonthRev>0 ? Math.round(((monthRev-lastMonthRev)/lastMonthRev)*100) : null;

    // Monthly breakdown (12 months)
    const monthly = Array.from({length:12},(_,i) => {
      const m = i+1;
      const rev = payments.filter(p=>p.month===m&&(!p.year||p.year===currentYear)).reduce((s,p)=>s+p.amount,0);
      return { label:MONTHS_AR[m].substring(0,5), value:rev, color: m===currentMonth?'var(--accent)':'#3b82f6' };
    });

    // By payment method
    const byMethod = Object.entries(PAYMENT_METHODS).map(([k,v]) => ({
      label: v.label,
      value: payments.filter(p=>p.method===k).length,
      icon:  v.icon,
    })).filter(d=>d.value>0).sort((a,b)=>b.value-a.value);

    // By status
    const byStatus = Object.entries(PAYMENT_STATUS).map(([k,v]) => ({
      label: v.label,
      value: payments.filter(p=>p.status===k).length,
      color: v.color,
    })).filter(d=>d.value>0);

    // By group
    const byGroup = groups.map(g => ({
      label:   g.name.split('—')[0].trim().substring(0,14),
      value:   payments.filter(p=>p.groupId===g.id).reduce((s,p)=>s+p.amount,0),
      color:   g.color||'#3b82f6',
    })).sort((a,b)=>b.value-a.value).filter(d=>d.value>0);

    // Daily this month
    const todayStr = new Date().toISOString().split('T')[0];
    const todayRev = payments.filter(p=>p.date===todayStr).reduce((s,p)=>s+p.amount,0);

    // Recent payments
    const recent = [...payments].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8);

    // Unpaid count
    const activeStudents = students.filter(s=>s.status==='active');
    const paidThisMonth  = new Set(payments.filter(p=>p.month===currentMonth&&(!p.year||p.year===currentYear)&&p.status==='paid').map(p=>p.studentId));
    const unpaidCount    = activeStudents.filter(s=>!paidThisMonth.has(s.id)).length;
    const collectRate    = activeStudents.length ? Math.round((activeStudents.length-unpaidCount)/activeStudents.length*100) : null;

    return { total, monthRev, lastMonthRev, growth, monthly, byMethod, byStatus, byGroup, todayRev, recent, unpaidCount, collectRate };
  }, [payments, students, groups]);

  const PALETTE = [
    {bg:'rgba(59,130,246,.18)',color:'#3b82f6'},{bg:'rgba(16,185,129,.18)',color:'#10b981'},
    {bg:'rgba(245,158,11,.18)',color:'#f59e0b'},{bg:'rgba(139,92,246,.18)',color:'#8b5cf6'},
    {bg:'rgba(239,68,68,.18)', color:'#ef4444'},
  ];
  const avStyle = n => PALETTE[((n.charCodeAt(0)||0)+(n.charCodeAt(1)||0))%PALETTE.length];

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12 }}>
        <MetricCard icon="💰" label="الإيراد الكلي"       value={formatCurrency(stats.total)}    color="var(--green)"/>
        <MetricCard icon="📅" label="إيراد هذا الشهر"      value={formatCurrency(stats.monthRev)} color="var(--accent)"
          trend={stats.growth!==null ? `${stats.growth>0?'↑':'↓'} ${Math.abs(stats.growth)}% عن الشهر الماضي` : undefined}
          trendUp={stats.growth>0}/>
        <MetricCard icon="📆" label="إيراد اليوم"          value={formatCurrency(stats.todayRev)} color="#3b82f6"/>
        <MetricCard icon="⚠"  label="لم يدفعوا هذا الشهر" value={stats.unpaidCount}              color={stats.unpaidCount>0?'#ef4444':'#10b981'}/>
        <MetricCard icon="📊" label="معدل التحصيل"         value={stats.collectRate!==null?`${stats.collectRate}%`:'—'}
          color={stats.collectRate>=80?'#10b981':stats.collectRate>=60?'#f59e0b':'#ef4444'}/>
      </div>

      {/* Monthly revenue trend */}
      <AnalyticsCard title="الإيراد الشهري" subtitle={`سنة ${new Date().getFullYear()}`}>
        <div style={{ marginBottom:6 }}>
          <SparkLine data={stats.monthly.map(m=>m.value)} width={660} height={50} color="var(--accent)" fill/>
        </div>
        <BarChart data={stats.monthly} height={130}/>
      </AnalyticsCard>

      {/* Row: By group + Method + Status */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:18 }}>
        <AnalyticsCard title="الإيراد حسب المجموعة">
          {stats.byGroup.length===0 ? (
            <div style={{ textAlign:'center', padding:'24px', color:'var(--text3)', fontSize:'0.82rem' }}>لا توجد بيانات</div>
          ) : (
            <BarChart data={stats.byGroup} horizontal labelWidth={110} height={28*stats.byGroup.length}/>
          )}
        </AnalyticsCard>

        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {/* By method */}
          <AnalyticsCard title="طرق الدفع">
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {stats.byMethod.map((m,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 10px', background:'var(--surface2)', borderRadius:8 }}>
                  <span style={{ fontSize:'0.82rem' }}>{m.icon} {m.label}</span>
                  <span style={{ fontFamily:'Cairo,sans-serif', fontWeight:700, fontSize:'0.82rem', color:'var(--accent)' }}>{m.value}</span>
                </div>
              ))}
            </div>
          </AnalyticsCard>

          {/* By status */}
          <AnalyticsCard title="حالة الدفعات">
            <DonutChart size={90}
              segments={stats.byStatus.map(s => ({ value:s.value, color:PAYMENT_STATUS[['paid','partial','unpaid'][stats.byStatus.indexOf(s)]]?.color||'#999', label:s.label }))}
              centerValue={stats.byStatus.reduce((s,x)=>s+x.value,0)}
              centerLabel="دفعة"
              centerColor="var(--accent)"
            />
            <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:5 }}>
              {stats.byStatus.map((s,i)=>{
                const c = ['#10b981','#f59e0b','#ef4444'][i];
                return (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <span style={{ width:8,height:8,borderRadius:'50%',background:c,flexShrink:0 }}/>
                    <span style={{ flex:1,fontSize:'0.74rem',color:'var(--text2)' }}>{s.label}</span>
                    <span style={{ fontSize:'0.74rem',fontWeight:700,color:c,fontFamily:'Cairo,sans-serif' }}>{s.value}</span>
                  </div>
                );
              })}
            </div>
          </AnalyticsCard>
        </div>
      </div>

      {/* Recent payments */}
      <AnalyticsCard title="آخر المدفوعات" subtitle={`${payments.length} دفعة إجمالاً`}>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
            <thead>
              <tr style={{ background:'var(--surface2)' }}>
                {['الطالب','الشهر','المبلغ','الطريقة','التاريخ'].map(h=>(
                  <th key={h} style={{ padding:'8px 14px', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.recent.map(p => {
                const s = students.find(x=>x.id===p.studentId);
                const { bg, color } = avStyle(s?.name||'');
                const letters = (s?.name||'').split(' ').map(w=>w[0]).slice(0,2).join('');
                const mInfo = PAYMENT_METHODS[p.method] || { icon:'💰', label:p.method };
                return (
                  <tr key={p.id} onMouseOver={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='var(--surface2)')} onMouseOut={e=>Array.from(e.currentTarget.cells).forEach(td=>td.style.background='')}>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <div style={{ width:28,height:28,borderRadius:'50%',background:bg,color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'0.68rem',fontWeight:700,flexShrink:0 }}>{letters}</div>
                        <span style={{ fontWeight:600 }}>{s?.name||'—'}</span>
                      </div>
                    </td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', color:'var(--text2)' }}>{MONTHS_AR[p.month]}</td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontFamily:'Cairo,sans-serif', fontWeight:700, color:'var(--green)' }}>{formatCurrency(p.amount)}</td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text3)' }}>{mInfo.icon} {mInfo.label}</td>
                    <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.75rem', color:'var(--text3)' }}>{formatDate(p.date, {month:'short',day:'numeric'})}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </AnalyticsCard>
    </div>
  );
}
