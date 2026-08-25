// src/modules/reports/StudentPerformance.jsx
import { useState, useMemo } from 'react';
import { useAppStore } from '../../store/app.store';
import { formatCurrency, formatDate } from '../../utils/helpers';
import { MetricCard, BarChart, DonutChart, AnalyticsCard, StatRow, HeatRow, ProgressRing } from './components/ChartComponents';
import { scoreColor } from '../../services/examService';

const PALETTE = [
  {bg:'rgba(59,130,246,.18)',color:'#3b82f6'},{bg:'rgba(16,185,129,.18)',color:'#10b981'},
  {bg:'rgba(245,158,11,.18)',color:'#f59e0b'},{bg:'rgba(139,92,246,.18)',color:'#8b5cf6'},
  {bg:'rgba(239,68,68,.18)', color:'#ef4444'},{bg:'rgba(6,182,212,.18)', color:'#06b6d4'},
];
const avStyle = n => PALETTE[((n.charCodeAt(0)||0)+(n.charCodeAt(1)||0))%PALETTE.length];

export default function StudentPerformance() {
  const attendance           = useAppStore((s) => s.attendance);
  const exams                = useAppStore((s) => s.exams);
  const grades               = useAppStore((s) => s.grades);
  const groups               = useAppStore((s) => s.groups);
  const payments             = useAppStore((s) => s.payments);
  const students             = useAppStore((s) => s.students);
  const [selectedStudentId, setSelectedStudentId] = useState('');

  const activeStudents = students.filter(s => s.status === 'active');

  // ── Global student metrics ────────────────────────────────
  const globalStats = useMemo(() => {
    const total      = students.length;
    const active     = activeStudents.length;
    const inactive   = students.filter(s => s.status === 'inactive').length;
    const graduated  = students.filter(s => s.status === 'graduated').length;

    // Grade distribution
    const gradeCount = {};
    students.forEach(s => { gradeCount[s.grade] = (gradeCount[s.grade]||0)+1; });
    const gradeData = Object.entries(gradeCount)
      .sort(([,a],[,b]) => b-a)
      .map(([label,value]) => ({ label: label.replace('الصف ','').replace(' الثانوي','').replace(' الإعدادي',' إع'), value }));

    // Enrollment by month
    const enrollByMonth = Array(12).fill(0);
    students.forEach(s => {
      if (s.enrollDate) {
        const m = new Date(s.enrollDate).getMonth();
        enrollByMonth[m]++;
      }
    });

    // Top group by student count
    const groupCounts = groups.map(g => ({
      label: g.name.split('—')[0].trim().substring(0,12),
      value: students.filter(s => s.groupId === g.id && s.status==='active').length,
      color: g.color || '#3b82f6',
    })).sort((a,b) => b.value - a.value);

    return { total, active, inactive, graduated, gradeData, enrollByMonth, groupCounts };
  }, [students, groups]);

  // ── Selected student deep profile ────────────────────────
  const studentProfile = useMemo(() => {
    if (!selectedStudentId) return null;
    const s = students.find(x => x.id === selectedStudentId);
    if (!s) return null;
    const group = groups.find(g => g.id === s.groupId);

    // Attendance
    const attRecs    = attendance.filter(r => r.studentId === s.id).sort((a,b) => a.date.localeCompare(b.date));
    const attPresent = attRecs.filter(r => r.status==='present').length;
    const attAbsent  = attRecs.filter(r => r.status==='absent').length;
    const attLate    = attRecs.filter(r => r.status==='late').length;
    const attPct     = attRecs.length ? Math.round(attPresent/attRecs.length*100) : null;
    const heatCells  = attRecs.slice(-24).map(r => ({ date:r.date, status:r.status }));

    // Exams
    const studentGrades = grades.filter(g => g.studentId===s.id && !g.absent && g.score!==null);
    const examResults = studentGrades.map(g => {
      const exam = exams.find(e => e.id===g.examId);
      return exam ? { name:exam.name.substring(0,20), score:g.score, total:exam.total, pct:Math.round(g.score/exam.total*100) } : null;
    }).filter(Boolean).sort((a,b) => b.pct-a.pct);
    const avgExamPct = examResults.length ? Math.round(examResults.reduce((s,g)=>s+g.pct,0)/examResults.length) : null;

    // Payments
    const payRecs = payments.filter(p => p.studentId===s.id);
    const totalPaid = payRecs.reduce((sum,p) => sum+p.amount, 0);

    return { s, group, attRecs, attPresent, attAbsent, attLate, attPct, heatCells, examResults, avgExamPct, payRecs, totalPaid };
  }, [selectedStudentId, students, groups, attendance, grades, exams, payments]);

  const MONTHS_SHORT = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
      {/* Overview KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
        <MetricCard icon="👥" label="إجمالي الطلاب"  value={globalStats.total}    color="#3b82f6"/>
        <MetricCard icon="✓"  label="نشطون"           value={globalStats.active}   color="#10b981"/>
        <MetricCard icon="⏸"  label="موقوفون"         value={globalStats.inactive} color="#f59e0b"/>
        <MetricCard icon="🎓" label="متخرجون"          value={globalStats.graduated}color="#8b5cf6"/>
      </div>

      {/* Row 1: Grade distribution + Group distribution */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:18 }}>
        <AnalyticsCard title="توزيع الطلاب حسب السنة الدراسية">
          <BarChart data={globalStats.gradeData} horizontal height={28*globalStats.gradeData.length} labelWidth={100}
            barColor="#3b82f6"/>
        </AnalyticsCard>

        <AnalyticsCard title="الطلاب في المجموعات" subtitle="حسب الإشغال الفعلي">
          <BarChart data={globalStats.groupCounts} horizontal height={28*globalStats.groupCounts.length} labelWidth={100}/>
        </AnalyticsCard>
      </div>

      {/* Enrollment trend */}
      <AnalyticsCard title="التسجيلات الشهرية" subtitle="توزيع تواريخ التسجيل">
        <BarChart
          data={MONTHS_SHORT.map((m,i) => ({ label:m, value:globalStats.enrollByMonth[i], color:'var(--accent)' }))}
          height={140}
        />
      </AnalyticsCard>

      {/* Student deep-dive */}
      <AnalyticsCard title="تحليل طالب بعينه" subtitle="اختر طالباً لعرض ملفه التحليلي"
        actions={
          <select value={selectedStudentId} onChange={e => setSelectedStudentId(e.target.value)}
            style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'6px 11px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', outline:'none', cursor:'pointer', direction:'rtl', minWidth:200 }}>
            <option value="">اختر طالباً...</option>
            {activeStudents.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        }
      >
        {!studentProfile ? (
          <div style={{ textAlign:'center', padding:'32px', color:'var(--text3)', fontSize:'0.85rem' }}>اختر طالباً من القائمة أعلاه</div>
        ) : (() => {
          const { s, group, attPresent, attAbsent, attLate, attPct, heatCells, examResults, avgExamPct, totalPaid } = studentProfile;
          const { bg, color } = avStyle(s.name);
          const letters = s.name.split(' ').map(w=>w[0]).slice(0,2).join('');
          return (
            <div>
              {/* Profile header */}
              <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:20, padding:'14px', background:'var(--surface2)', borderRadius:12 }}>
                <div style={{ width:52, height:52, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.1rem', fontWeight:700, flexShrink:0 }}>{letters}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800, fontSize:'1.05rem', marginBottom:2 }}>{s.name}</div>
                  <div style={{ fontSize:'0.72rem', color:'var(--text3)', display:'flex', gap:12 }}>
                    <span>{s.code}</span>
                    <span>{group?.name||'—'}</span>
                    <span>{s.grade}</span>
                  </div>
                </div>
                <div style={{ display:'flex', gap:10 }}>
                  <ProgressRing pct={attPct||0} size={56} color={scoreColor(attPct)} label="حضور"/>
                  <ProgressRing pct={avgExamPct||0} size={56} color={scoreColor(avgExamPct)} label="درجات"/>
                </div>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                {/* Attendance */}
                <div>
                  <div style={{ fontSize:'0.78rem', fontWeight:700, marginBottom:10 }}>🗓 سجل الحضور</div>
                  <div style={{ display:'flex', gap:8, marginBottom:12 }}>
                    {[{l:'حاضر',v:attPresent,c:'#10b981'},{l:'غائب',v:attAbsent,c:'#ef4444'},{l:'متأخر',v:attLate,c:'#f59e0b'}].map(x=>(
                      <div key={x.l} style={{ flex:1, background:`${x.c}12`, borderRadius:9, padding:'8px', textAlign:'center', border:`1px solid ${x.c}22` }}>
                        <div style={{ fontSize:'1.1rem', fontWeight:800, color:x.c, fontFamily:'Cairo,sans-serif' }}>{x.v}</div>
                        <div style={{ fontSize:'0.62rem', color:'var(--text3)', marginTop:2 }}>{x.l}</div>
                      </div>
                    ))}
                  </div>
                  <HeatRow cells={heatCells} size={13}/>
                </div>

                {/* Exams */}
                <div>
                  <div style={{ fontSize:'0.78rem', fontWeight:700, marginBottom:10 }}>📝 نتائج الامتحانات</div>
                  {examResults.length === 0 ? (
                    <div style={{ color:'var(--text3)', fontSize:'0.8rem' }}>لا توجد نتائج</div>
                  ) : (
                    examResults.map((e, i) => (
                      <StatRow key={i} label={e.name} value={e.pct} max={100} suffix="%" color={scoreColor(e.pct)}/>
                    ))
                  )}
                </div>
              </div>

              {/* Financial */}
              <div style={{ marginTop:14, padding:'12px 14px', background:'var(--surface2)', borderRadius:10, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ fontSize:'0.8rem', color:'var(--text3)' }}>💰 إجمالي المدفوع</div>
                <div style={{ fontSize:'1rem', fontWeight:800, color:'var(--green)', fontFamily:'Cairo,sans-serif' }}>{formatCurrency(totalPaid)}</div>
              </div>
            </div>
          );
        })()}
      </AnalyticsCard>
    </div>
  );
}
