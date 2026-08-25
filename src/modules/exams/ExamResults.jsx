// src/modules/exams/ExamResults.jsx
import { useMemo } from 'react';
import { useAppStore } from '../../store/app.store';
import { scorePercent, scoreColor, scoreGrade, getExamStatsWithPass, EXAM_TYPES } from '../../services/examService';
import { formatDate } from '../../utils/helpers';
// avatar helper (no hook — safe inside .map())
const AV_PAL = [
  {bg:'rgba(59,130,246,.18)',color:'#3b82f6'},{bg:'rgba(16,185,129,.18)',color:'#10b981'},
  {bg:'rgba(245,158,11,.18)',color:'#f59e0b'},{bg:'rgba(139,92,246,.18)',color:'#8b5cf6'},
  {bg:'rgba(239,68,68,.18)', color:'#ef4444'},{bg:'rgba(6,182,212,.18)', color:'#06b6d4'},
];
const avStyle = n => AV_PAL[((n.charCodeAt(0)||0)+(n.charCodeAt(1)||0))%AV_PAL.length];

const MEDAL = ['🥇','🥈','🥉'];

function StatBox({ label, value, color = 'var(--text)', sub }) {
  return (
    <div style={{ background:'var(--surface2)', borderRadius:12, padding:'14px 16px', textAlign:'center' }}>
      <div style={{ fontSize:'1.4rem', fontWeight:800, color, fontFamily:'Cairo,sans-serif', lineHeight:1 }}>{value ?? '—'}</div>
      <div style={{ fontSize:'0.68rem', color:'var(--text3)', marginTop:5, fontWeight:600 }}>{label}</div>
      {sub && <div style={{ fontSize:'0.62rem', color:'var(--text3)', marginTop:2 }}>{sub}</div>}
    </div>
  );
}

export default function ExamResults({ exam }) {
  const grades               = useAppStore((s) => s.grades);
  const students             = useAppStore((s) => s.students);

  const groupStudents = useMemo(() =>
    students.filter(s => s.groupId === exam.groupId),
  [students, exam.groupId]);

  const examGrades = useMemo(() =>
    grades.filter(g => g.examId === exam.id),
  [grades, exam.id]);

  const stats = useMemo(() =>
    getExamStatsWithPass(exam.id, grades, exam),
  [grades, exam]);

  // Build ranked results
  const ranked = useMemo(() => {
    return groupStudents
      .map(s => {
        const grade = examGrades.find(g => g.studentId === s.id);
        const score  = grade?.score ?? null;
        const absent = grade?.absent || false;
        const pct    = absent ? null : scorePercent(score, exam.total);
        return { ...s, score, absent, pct, passed: !absent && score !== null && score >= exam.pass };
      })
      .sort((a, b) => {
        if (a.absent && !b.absent) return 1;
        if (!a.absent && b.absent) return -1;
        if (a.score === null && b.score !== null) return 1;
        if (a.score !== null && b.score === null) return -1;
        return (b.score ?? -1) - (a.score ?? -1);
      });
  }, [groupStudents, examGrades, exam]);

  const passRate = stats.count > 0 ? Math.round(stats.passed / stats.count * 100) : null;
  const passColor = passRate === null ? 'var(--text3)' : passRate >= 80 ? '#10b981' : passRate >= 50 ? '#f59e0b' : '#ef4444';

  // Distribution
  const dist = [
    { range:'90-100%', count: ranked.filter(r => r.pct !== null && r.pct >= 90).length, color:'#10b981' },
    { range:'80-89%',  count: ranked.filter(r => r.pct !== null && r.pct >= 80 && r.pct < 90).length, color:'#22c55e' },
    { range:'70-79%',  count: ranked.filter(r => r.pct !== null && r.pct >= 70 && r.pct < 80).length, color:'#f59e0b' },
    { range:'60-69%',  count: ranked.filter(r => r.pct !== null && r.pct >= 60 && r.pct < 70).length, color:'#f97316' },
    { range:'أقل من 60%', count: ranked.filter(r => r.pct !== null && r.pct < 60).length, color:'#ef4444' },
  ];
  const maxDist = Math.max(...dist.map(d => d.count), 1);

  if (examGrades.length === 0) {
    return (
      <div style={{ textAlign:'center', padding:'48px 20px', color:'var(--text3)' }}>
        <div style={{ fontSize:44, marginBottom:12, opacity:.4 }}>📊</div>
        <div style={{ fontWeight:600 }}>لم يتم إدخال الدرجات بعد</div>
        <div style={{ fontSize:'0.8rem', marginTop:6 }}>استخدم زر "إدخال الدرجات" لبدء التصحيح</div>
      </div>
    );
  }

  return (
    <div>
      {/* Stats summary */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10, marginBottom:20 }}>
        <StatBox label="متوسط الدرجات"    value={stats.avg !== null ? `${stats.avg}/${exam.total}` : '—'} color="var(--accent)"/>
        <StatBox label="أعلى درجة"         value={stats.highest}       color="#10b981"/>
        <StatBox label="أدنى درجة"         value={stats.lowest}        color="#ef4444"/>
        <StatBox label="نسبة النجاح"        value={passRate !== null ? `${passRate}%` : '—'} color={passColor}/>
        <StatBox label="غائبون"             value={stats.absent}        color="var(--text3)"/>
      </div>

      {/* Distribution bar chart */}
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'18px 20px', marginBottom:16 }}>
        <div style={{ fontSize:'0.82rem', fontWeight:700, marginBottom:14 }}>توزيع الدرجات</div>
        <div style={{ display:'flex', gap:12, alignItems:'flex-end', height:80 }}>
          {dist.map((d, i) => (
            <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
              <span style={{ fontSize:'0.7rem', fontWeight:700, color:d.color, fontFamily:'Cairo,sans-serif' }}>{d.count}</span>
              <div style={{ width:'100%', height:Math.max(4, Math.round(d.count/maxDist*60)), background:d.color+'28', borderRadius:'4px 4px 0 0', border:`1px solid ${d.color}40`, position:'relative' }}>
                <div style={{ position:'absolute', bottom:0, width:'100%', height:`${Math.round(d.count/maxDist*100)}%`, background:d.color+'60', borderRadius:'3px 3px 0 0' }}/>
              </div>
              <span style={{ fontSize:'0.6rem', color:'var(--text3)', textAlign:'center', maxWidth:'100%' }}>{d.range}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Ranking table */}
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
        <div style={{ padding:'12px 18px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', fontWeight:700, color:'var(--text3)' }}>
          ترتيب الطلاب ({ranked.length})
        </div>
        {ranked.map((s, i) => {
          const { bg, color } = avStyle(s.name);
          const letters = s.name.split(' ').map(w=>w[0]).slice(0,2).join('');
          const gColor = scoreColor(s.pct);
          const rank = s.absent ? null : ranked.filter(r => !r.absent && r.score !== null).findIndex(r => r.id === s.id) + 1;

          return (
            <div key={s.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 18px', borderBottom:'1px solid var(--border)', transition:'background .12s' }}
              onMouseOver={e => e.currentTarget.style.background='var(--surface2)'}
              onMouseOut={e  => e.currentTarget.style.background=''}
            >
              {/* Rank */}
              <div style={{ width:32, height:32, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                {rank && rank <= 3 ? (
                  <span style={{ fontSize:'1.1rem' }}>{MEDAL[rank-1]}</span>
                ) : rank ? (
                  <span style={{ fontSize:'0.78rem', fontWeight:800, color:'var(--text3)', fontFamily:'Cairo,sans-serif' }}>{rank}</span>
                ) : (
                  <span style={{ fontSize:'0.75rem', color:'var(--text3)' }}>—</span>
                )}
              </div>

              {/* Avatar */}
              <div style={{ width:34, height:34, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.78rem', fontWeight:700, flexShrink:0 }}>{letters}</div>

              {/* Name */}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.name}</div>
                <div style={{ fontSize:'0.68rem', color:'var(--text3)', fontFamily:'Cairo,sans-serif' }}>{s.code}</div>
              </div>

              {/* Score bar */}
              {!s.absent && s.score !== null ? (
                <div style={{ width:120, display:'flex', flexDirection:'column', gap:4, flexShrink:0 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.68rem' }}>
                    <span style={{ fontFamily:'Cairo,sans-serif', fontWeight:700, color:gColor }}>{s.score}</span>
                    <span style={{ color:'var(--text3)' }}>/{exam.total}</span>
                  </div>
                  <div style={{ height:5, background:'var(--surface3)', borderRadius:99, overflow:'hidden' }}>
                    <div style={{ height:'100%', width:`${s.pct}%`, background:gColor, borderRadius:99, transition:'width .5s' }}/>
                  </div>
                </div>
              ) : (
                <div style={{ width:120, fontSize:'0.75rem', color:'var(--text3)' }}>
                  {s.absent ? 'غائب عن الامتحان' : 'لم تُدخَل الدرجة'}
                </div>
              )}

              {/* Percentage */}
              {!s.absent && s.pct !== null && (
                <div style={{ textAlign:'center', minWidth:50, flexShrink:0 }}>
                  <div style={{ fontSize:'0.92rem', fontWeight:800, color:gColor, fontFamily:'Cairo,sans-serif' }}>{s.pct}%</div>
                  <div style={{ fontSize:'0.68rem', fontWeight:700, color:gColor }}>{scoreGrade(s.pct)}</div>
                </div>
              )}

              {/* Status badge */}
              <span style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'3px 9px', borderRadius:99, fontSize:'0.68rem', fontWeight:700, flexShrink:0,
                background: s.absent ? 'rgba(239,68,68,.1)' : s.passed ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)',
                color:      s.absent ? '#ef4444' : s.passed ? '#10b981' : '#ef4444',
                border:     `1px solid ${s.absent ? 'rgba(239,68,68,.2)' : s.passed ? 'rgba(16,185,129,.2)' : 'rgba(239,68,68,.2)'}`,
              }}>
                {s.absent ? 'غائب' : s.passed ? '✓ ناجح' : '✗ راسب'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
