// src/modules/reports/AttendanceAnalytics.jsx
import { useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/app.store';
import { MetricCard, BarChart, DonutChart, AnalyticsCard, SparkLine } from './components/ChartComponents';
import { getFrequentAbsentees, statsByStudentFromRecords } from '../../services/attendanceService';
import { pgGetAttendanceAggregate } from '../../services/api';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useToast } from '../../components/Toast';
import { formatDate } from '../../utils/helpers';

const PALETTE = [
  {bg:'rgba(59,130,246,.18)',color:'#3b82f6'},{bg:'rgba(16,185,129,.18)',color:'#10b981'},
  {bg:'rgba(245,158,11,.18)',color:'#f59e0b'},{bg:'rgba(139,92,246,.18)',color:'#8b5cf6'},
  {bg:'rgba(239,68,68,.18)', color:'#ef4444'},
];
const avStyle = n => PALETTE[((n.charCodeAt(0)||0)+(n.charCodeAt(1)||0))%PALETTE.length];

// C4 Attendance Batch A: 90 calendar days back is a deliberately generous lookback window for
// the daily-trend aggregate call (see research.md §2/spec.md clarification) — safely covers
// weekly/biweekly session cadences while staying far short of "the whole history"; the client
// still takes only the last 14 dates that actually have data from whatever this window returns,
// identical to today's "last 14 session-dates," not "last 14 calendar days," semantics.
function isoDate(d) { return d.toISOString().slice(0, 10); }
function ninetyDaysAgoIso() {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return isoDate(d);
}

export default function AttendanceAnalytics() {
  // C4 Attendance Batch A: `attendance` (full store array) stays selected here for exactly two
  // remaining computations this batch does not migrate — `sessions` (distinct group+date pairs;
  // no aggregate dimension reproduces this without double-counting groups that share a session
  // date, same reasoning as AttendancePage.jsx's identical gap — see research.md §4) and
  // `absentees` (already migrated in feature 001 via statsByStudentFromRecords, which itself
  // still takes the raw array). Every other figure below now comes from the aggregate endpoint.
  const attendance           = useAppStore((s) => s.attendance);
  const groups               = useAppStore((s) => s.groups);
  const students             = useAppStore((s) => s.students);
  const toast = useToast();

  const { data: statusAgg = [], error: statusErr } = useAsyncData(
    () => pgGetAttendanceAggregate({ groupBy: 'status' }), [], []);
  const { data: groupAgg = [], error: groupErr } = useAsyncData(
    () => pgGetAttendanceAggregate({ groupBy: 'group' }), [], []);
  const { data: dateAgg = [], error: dateErr } = useAsyncData(
    () => pgGetAttendanceAggregate({ groupBy: 'date', from: ninetyDaysAgoIso(), to: isoDate(new Date()) }),
    [], []);
  const { data: weekdayAgg = [], error: weekdayErr } = useAsyncData(
    () => pgGetAttendanceAggregate({ groupBy: 'weekday', status: 'absent' }), [], []);

  useEffect(() => {
    const err = statusErr || groupErr || dateErr || weekdayErr;
    if (err) toast.error(err.message || 'فشل تحميل تحليلات الحضور');
  }, [statusErr, groupErr, dateErr, weekdayErr]);

  const stats = useMemo(() => {
    const byStatus = new Map(statusAgg.map(r => [r.key, r.count]));
    const present  = byStatus.get('present') ?? 0;
    const absent   = byStatus.get('absent')  ?? 0;
    const late     = byStatus.get('late')    ?? 0;
    const total    = present + absent + late;
    const pct      = total ? Math.round(present/total*100) : null;
    const sessions = [...new Set(attendance.map(r => `${r.groupId}-${r.date}`))].length;

    // By group
    const byGroupAggMap = new Map(groupAgg.map(r => [r.key, r]));
    const byGroup = groups.map(g => {
      const recs  = byGroupAggMap.get(g.id);
      const gPres = recs?.present ?? 0;
      const gTotal = recs?.total ?? 0;
      const gPct  = gTotal ? Math.round(gPres/gTotal*100) : 0;
      return { label:g.name.split('—')[0].trim().substring(0,14), value:gPct, suffix:'%', color: g.color||'#3b82f6', raw:gTotal };
    }).sort((a,b) => b.value-a.value);

    // Daily trend (last 14 session dates within the fetched 90-day window)
    const dailyTrend = dateAgg
      .slice(-14)
      .map(d => ({ date: d.key, pct: d.total ? Math.round(d.present/d.total*100) : 0, total: d.total }));

    // Absent count per weekday
    const DAYS_AR = { sat:'السبت',sun:'الأحد',mon:'الاثنين',tue:'الثلاثاء',wed:'الأربعاء',thu:'الخميس',fri:'الجمعة' };
    const dayData = weekdayAgg
      .map(r => ({ label:DAYS_AR[r.key], value:r.count, color:'#ef4444' }))
      .sort((a,b) => b.value-a.value);

    // Frequent absentees (already migrated, feature 001 — still reads the raw array via the adapter)
    const absentees = getFrequentAbsentees(students, statsByStudentFromRecords(students, attendance), 2).slice(0,8);

    return { total, present, absent, late, pct, sessions, byGroup, dailyTrend, dayData, absentees };
  }, [attendance, students, groups, statusAgg, groupAgg, dateAgg, weekdayAgg]);

  const pctColor = stats.pct===null?'var(--text)':stats.pct>=80?'#10b981':stats.pct>=60?'#f59e0b':'#ef4444';

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12 }}>
        <MetricCard icon="📊" label="معدل الحضور الكلي" value={stats.pct!==null?`${stats.pct}%`:'—'} color={pctColor}/>
        <MetricCard icon="✓"  label="حاضر (سجل)"        value={stats.present}  color="#10b981"/>
        <MetricCard icon="✗"  label="غائب (سجل)"         value={stats.absent}   color="#ef4444"/>
        <MetricCard icon="⏱"  label="متأخر (سجل)"        value={stats.late}     color="#f59e0b"/>
        <MetricCard icon="📅" label="جلسات مسجّلة"        value={stats.sessions}/>
      </div>

      {/* Row 1: Donut + Daily trend */}
      <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:18, alignItems:'stretch' }}>
        <AnalyticsCard title="توزيع حالة الحضور" style={{ minWidth:220 }}>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:16 }}>
            <DonutChart size={130}
              segments={[
                { value:stats.present, color:'#10b981', label:'حاضر'  },
                { value:stats.late,    color:'#f59e0b', label:'متأخر' },
                { value:stats.absent,  color:'#ef4444', label:'غائب'  },
              ]}
              centerValue={stats.pct!==null?`${stats.pct}%`:'—'}
              centerLabel="الحضور"
              centerColor={pctColor}
            />
            <div style={{ display:'flex', flexDirection:'column', gap:6, width:'100%' }}>
              {[{l:'حاضر',v:stats.present,c:'#10b981'},{l:'متأخر',v:stats.late,c:'#f59e0b'},{l:'غائب',v:stats.absent,c:'#ef4444'}].map(x=>(
                <div key={x.l} style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ width:8, height:8, borderRadius:'50%', background:x.c, flexShrink:0 }}/>
                  <span style={{ flex:1, fontSize:'0.76rem', color:'var(--text2)' }}>{x.l}</span>
                  <span style={{ fontSize:'0.76rem', fontWeight:700, color:x.c, fontFamily:'Cairo,sans-serif' }}>{x.v}</span>
                </div>
              ))}
            </div>
          </div>
        </AnalyticsCard>

        <AnalyticsCard title="اتجاه الحضور اليومي" subtitle={`آخر ${stats.dailyTrend.length} جلسة مسجّلة`}>
          {stats.dailyTrend.length < 2 ? (
            <div style={{ textAlign:'center', padding:'32px', color:'var(--text3)', fontSize:'0.82rem' }}>بيانات غير كافية</div>
          ) : (
            <div>
              <div style={{ marginBottom:12 }}>
                <SparkLine data={stats.dailyTrend.map(d=>d.pct)} width={440} height={70} color="#10b981"/>
              </div>
              <BarChart
                data={stats.dailyTrend.map(d => ({
                  label: formatDate(d.date, {month:'numeric',day:'numeric'}),
                  value: d.pct,
                  color: d.pct>=80?'#10b981':d.pct>=60?'#f59e0b':'#ef4444',
                  suffix:'%',
                }))}
                height={80}
                showValues={false}
              />
              <div style={{ display:'flex', justifyContent:'space-between', marginTop:4, fontSize:'0.6rem', color:'var(--text3)' }}>
                <span>{formatDate(stats.dailyTrend[0]?.date, {month:'short',day:'numeric'})}</span>
                <span>{formatDate(stats.dailyTrend.at(-1)?.date, {month:'short',day:'numeric'})}</span>
              </div>
            </div>
          )}
        </AnalyticsCard>
      </div>

      {/* Row 2: By group + Absent by day */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:18 }}>
        <AnalyticsCard title="نسبة الحضور حسب المجموعة">
          {stats.byGroup.length===0 ? (
            <div style={{ color:'var(--text3)', fontSize:'0.82rem', textAlign:'center', padding:'24px' }}>لا توجد بيانات</div>
          ) : (
            <BarChart data={stats.byGroup} horizontal labelWidth={100} height={28*stats.byGroup.length}/>
          )}
        </AnalyticsCard>

        <AnalyticsCard title="الغيابات حسب يوم الأسبوع" subtitle="أكثر الأيام غياباً">
          {stats.dayData.length===0 ? (
            <div style={{ color:'var(--text3)', fontSize:'0.82rem', textAlign:'center', padding:'24px' }}>لا توجد بيانات</div>
          ) : (
            <BarChart data={stats.dayData} height={120} barColor="#ef4444"/>
          )}
        </AnalyticsCard>
      </div>

      {/* Frequent absentees */}
      <AnalyticsCard title="الطلاب الأكثر غياباً" subtitle="غابوا مرتين أو أكثر">
        {stats.absentees.length===0 ? (
          <div style={{ textAlign:'center', padding:'32px', color:'var(--text3)' }}>
            <div style={{ fontSize:38, marginBottom:8, opacity:.4 }}>🎉</div>
            <div>لا يوجد طلاب كثيرو الغياب</div>
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:10 }}>
            {stats.absentees.map(s => {
              const { bg, color } = avStyle(s.name);
              const letters = s.name.split(' ').map(w=>w[0]).slice(0,2).join('');
              const grp = groups.find(g => g.id===s.groupId);
              const pctColor = s.pct>=80?'#10b981':s.pct>=60?'#f59e0b':'#ef4444';
              return (
                <div key={s.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'var(--surface2)', borderRadius:10, border:'1px solid var(--border)' }}>
                  <div style={{ width:34, height:34, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.78rem', fontWeight:700, flexShrink:0 }}>{letters}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:'0.85rem' }}>{s.name}</div>
                    <div style={{ fontSize:'0.68rem', color:'var(--text3)' }}>{grp?.name||'—'}</div>
                  </div>
                  <div style={{ textAlign:'center', flexShrink:0 }}>
                    <div style={{ fontSize:'1rem', fontWeight:800, color:'#ef4444', fontFamily:'Cairo,sans-serif' }}>{s.absent}</div>
                    <div style={{ fontSize:'0.58rem', color:'var(--text3)' }}>غياب</div>
                  </div>
                  <div style={{ textAlign:'center', flexShrink:0 }}>
                    <div style={{ fontSize:'0.88rem', fontWeight:800, color:pctColor, fontFamily:'Cairo,sans-serif' }}>{s.pct!==null?`${s.pct}%`:'—'}</div>
                    <div style={{ fontSize:'0.58rem', color:'var(--text3)' }}>الحضور</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </AnalyticsCard>
    </div>
  );
}
