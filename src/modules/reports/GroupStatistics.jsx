// src/modules/reports/GroupStatistics.jsx
import { useMemo } from 'react';
import { useAppStore } from '../../store/app.store';
import { formatCurrency } from '../../utils/helpers';
import { MetricCard, BarChart, DonutChart, AnalyticsCard, ProgressRing } from './components/ChartComponents';
import { getGroupStats, formatDays } from '../../services/groupService';
import { MONTHS_AR } from '../../services/paymentService';

export default function GroupStatistics() {
  const attendance           = useAppStore((s) => s.attendance);
  const groups               = useAppStore((s) => s.groups);
  const payments             = useAppStore((s) => s.payments);
  const students             = useAppStore((s) => s.students);
  const treasuryTxn          = useAppStore((s) => s.treasuryTxn);

  const allGroupStats = useMemo(() =>
    groups.map(g => ({ ...g, stats: getGroupStats(g, students, payments, attendance, treasuryTxn) })),
  [groups, students, payments, attendance, treasuryTxn]);

  const globalStats = useMemo(() => {
    const totalGroups    = groups.length;
    const totalCapacity  = groups.reduce((s,g) => s+g.max, 0);
    const totalFilled    = students.filter(s => s.status==='active').length;
    const fillPct        = totalCapacity>0 ? Math.round(totalFilled/totalCapacity*100) : 0;
    const fullGroups     = allGroupStats.filter(g => g.stats.isFull).length;
    const avgAttendance  = allGroupStats.length
      ? Math.round(allGroupStats.reduce((s,g) => s+(g.stats.attPct||0), 0) / allGroupStats.length)
      : null;
    return { totalGroups, totalCapacity, totalFilled, fillPct, fullGroups, avgAttendance };
  }, [groups, students, allGroupStats]);

  // Capacity chart
  const capacityData = allGroupStats.map(g => ({
    label: g.name.split('—')[0].trim().substring(0,12),
    value: g.stats.activeCount,
    max:   g.max,
    color: g.color || '#3b82f6',
    suffix:`/${g.max}`,
  })).sort((a,b) => b.value-a.value);

  // Revenue by group
  const revenueData = allGroupStats.map(g => ({
    label: g.name.split('—')[0].trim().substring(0,12),
    value: g.stats.totalRevenue,
    color: g.color || '#10b981',
  })).sort((a,b) => b.value-a.value).filter(d=>d.value>0);

  // Attendance by group
  const attData = allGroupStats.filter(g => g.stats.attPct !== null).map(g => ({
    label: g.name.split('—')[0].trim().substring(0,12),
    value: g.stats.attPct,
    suffix:'%',
    color: g.stats.attPct>=80?'#10b981':g.stats.attPct>=60?'#f59e0b':'#ef4444',
  })).sort((a,b) => b.value-a.value);

  // Subject distribution
  const subjectCount = {};
  groups.forEach(g => { subjectCount[g.subject||'أخرى'] = (subjectCount[g.subject||'أخرى']||0)+1; });
  const COLORS = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#84cc16','#f97316'];
  const subjectData = Object.entries(subjectCount).map(([k,v],i) => ({ value:v, color:COLORS[i%COLORS.length], label:k }));

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12 }}>
        <MetricCard icon="◈"  label="عدد المجموعات"   value={globalStats.totalGroups}    color="var(--accent)"/>
        <MetricCard icon="👥" label="إجمالي السعة"     value={globalStats.totalCapacity}/>
        <MetricCard icon="✓"  label="نسبة الإشغال"    value={`${globalStats.fillPct}%`}
          color={globalStats.fillPct>=80?'#ef4444':globalStats.fillPct>=60?'#f59e0b':'#10b981'}/>
        <MetricCard icon="🔴" label="مجموعات ممتلئة"  value={globalStats.fullGroups}
          color={globalStats.fullGroups>0?'#ef4444':'#10b981'}/>
        <MetricCard icon="📊" label="متوسط الحضور"    value={globalStats.avgAttendance!==null?`${globalStats.avgAttendance}%`:'—'}
          color={globalStats.avgAttendance>=80?'#10b981':globalStats.avgAttendance>=60?'#f59e0b':'#ef4444'}/>
      </div>

      {/* Row 1: Capacity + Donut */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:18 }}>
        <AnalyticsCard title="إشغال المجموعات" subtitle="عدد الطلاب الفعليين مقابل السعة القصوى">
          <BarChart data={capacityData.map(d=>({...d, suffix:''}))} horizontal labelWidth={100}
            height={28*capacityData.length} barColor="var(--accent)"/>
        </AnalyticsCard>

        <AnalyticsCard title="توزيع المواد الدراسية">
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:14 }}>
            <DonutChart size={120}
              segments={subjectData}
              centerValue={groups.length}
              centerLabel="مجموعة"
              centerColor="var(--accent)"
            />
            <div style={{ width:'100%', display:'flex', flexDirection:'column', gap:5 }}>
              {subjectData.map((s,i)=>(
                <div key={i} style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ width:8,height:8,borderRadius:2,background:s.color,flexShrink:0 }}/>
                  <span style={{ flex:1,fontSize:'0.74rem',color:'var(--text2)' }}>{s.label}</span>
                  <span style={{ fontSize:'0.74rem',fontWeight:700,color:s.color,fontFamily:'Cairo,sans-serif' }}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </AnalyticsCard>
      </div>

      {/* Row 2: Revenue + Attendance by group */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:18 }}>
        <AnalyticsCard title="الإيراد الكلي حسب المجموعة">
          {revenueData.length===0
            ? <div style={{ textAlign:'center', padding:'24px', color:'var(--text3)', fontSize:'0.82rem' }}>لا توجد بيانات</div>
            : <BarChart data={revenueData} horizontal labelWidth={100} height={28*revenueData.length}/>
          }
        </AnalyticsCard>

        <AnalyticsCard title="نسبة الحضور لكل مجموعة">
          {attData.length===0
            ? <div style={{ textAlign:'center', padding:'24px', color:'var(--text3)', fontSize:'0.82rem' }}>لا توجد بيانات حضور</div>
            : <BarChart data={attData} horizontal labelWidth={100} height={28*attData.length}/>
          }
        </AnalyticsCard>
      </div>

      {/* Group detail cards */}
      <AnalyticsCard title="بطاقات المجموعات التفصيلية" noPad>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))', gap:0 }}>
          {allGroupStats.map((g, i) => {
            const s = g.stats;
            const fillColor = s.isFull?'#ef4444':s.isAlmostFull?'#f59e0b':g.color||'#3b82f6';
            return (
              <div key={g.id} style={{ padding:'16px', borderBottom:'1px solid var(--border)', borderLeft: i%2===0&&i<allGroupStats.length-1?'1px solid var(--border)':'none' }}>
                {/* Title */}
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                  <div style={{ width:8, height:8, borderRadius:'50%', background:g.color||'var(--accent)', flexShrink:0 }}/>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, fontSize:'0.88rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{g.name}</div>
                    <div style={{ fontSize:'0.68rem', color:'var(--text3)', marginTop:1 }}>
                      {g.subject} · {g.teacher||'—'} · 🕐{g.time}
                    </div>
                  </div>
                </div>

                {/* Progress rings row */}
                <div style={{ display:'flex', gap:10, justifyContent:'center', marginBottom:12 }}>
                  <ProgressRing pct={s.fillPct}  color={fillColor}                              label="إشغال" size={52} stroke={5}/>
                  <ProgressRing pct={s.attPct||0} color={s.attPct>=80?'#10b981':s.attPct>=60?'#f59e0b':'#ef4444'} label="حضور"  size={52} stroke={5}/>
                </div>

                {/* Stats */}
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {[
                    { l:'طلاب',   v:`${s.activeCount}/${g.max}`, c:'var(--text)'   },
                    { l:'إيراد',  v:s.totalRevenue>0?`${Math.round(s.totalRevenue/1000)}k`:'0', c:'var(--accent)' },
                  ].map(x => (
                    <div key={x.l} style={{ flex:1, background:'var(--surface2)', borderRadius:7, padding:'5px 8px', textAlign:'center' }}>
                      <div style={{ fontSize:'0.82rem', fontWeight:800, color:x.c, fontFamily:'Cairo,sans-serif', lineHeight:1 }}>{x.v}</div>
                      <div style={{ fontSize:'0.58rem', color:'var(--text3)', marginTop:2 }}>{x.l}</div>
                    </div>
                  ))}
                </div>

                {/* Days */}
                <div style={{ marginTop:8, fontSize:'0.68rem', color:'var(--text3)', textAlign:'center' }}>
                  {formatDays(g.days)}
                </div>
              </div>
            );
          })}
        </div>
      </AnalyticsCard>
    </div>
  );
}
