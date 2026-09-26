// src/modules/exams/ExamReports.jsx
import { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../../store/app.store';
import { scoreColor } from '../../services/examService';
import { PrintHeader } from '../../components/shared';
import { openStudentExamReport, openGroupExamReport } from './buildExamReport';
import Button from '../../components/ui/Button';
import StudentSearchSelect from '../../components/ui/StudentSearchSelect';
import { pgGetGradesAggregate, pgGetGrades } from '../../services/api';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useToast } from '../../components/Toast';

// Phase 1D (Grades global-read migration) — joins the students already held in the store with
// a groupBy=student aggregate row {key,avgPct,examCount,failCount}; a student absent from the
// aggregate (no grades yet) maps to null/0, same default getTopStudents/getWeakStudents/
// RankingTable produced when filtering an empty sg array locally.
function joinStudentAggregate(students, aggRows) {
  const byId = new Map(aggRows.map((r) => [r.key, r]));
  return students.filter((s) => s.status === 'active').map((s) => {
    const agg = byId.get(s.id);
    return { ...s, avgPct: agg?.avgPct ?? null, examCount: agg?.examCount ?? 0, failCount: agg?.failCount ?? 0 };
  });
}
// avatar helper (no hook — safe inside .map())
const AV_PAL = [
  {bg:'rgba(59,130,246,.18)',color:'#3b82f6'},{bg:'rgba(16,185,129,.18)',color:'#10b981'},
  {bg:'rgba(245,158,11,.18)',color:'#f59e0b'},{bg:'rgba(139,92,246,.18)',color:'#8b5cf6'},
  {bg:'rgba(239,68,68,.18)', color:'#ef4444'},
];
const avStyle = n => AV_PAL[((n.charCodeAt(0)||0)+(n.charCodeAt(1)||0))%AV_PAL.length];

const TABS = [
  { id:'top',     label:'الأوائل',       icon:'🏆' },
  { id:'ranking', label:'ترتيب عام',    icon:'📊' },
  { id:'weak',    label:'يحتاجون دعم',  icon:'⚠'  },
  { id:'print',   label:'طباعة كشف',    icon:'🖨' },
];

function MiniAvatar({ name, size = 32 }) {
  const { bg, color } = avStyle(name);
  const letters = name.split(' ').map(w=>w[0]).slice(0,2).join('');
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:size*0.3, fontWeight:700, flexShrink:0 }}>
      {letters}
    </div>
  );
}

function ScoreBar({ pct, color }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <div style={{ flex:1, height:6, background:'var(--surface3)', borderRadius:99, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:color, borderRadius:99, transition:'width .5s ease' }}/>
      </div>
      <span style={{ fontSize:'0.75rem', fontWeight:800, color, fontFamily:'Cairo,sans-serif', minWidth:36 }}>{pct}%</span>
    </div>
  );
}

// ── Top students podium ──────────────────────────────────────
function TopStudentsPodium({ topStudents }) {
  if (topStudents.length === 0) {
    return (
      <div style={{ textAlign:'center', padding:'48px', color:'var(--text3)' }}>
        <div style={{ fontSize:44, opacity:.4, marginBottom:10 }}>🏆</div>
        <div style={{ fontWeight:600 }}>لا توجد بيانات كافية</div>
      </div>
    );
  }

  const MEDALS = ['🥇','🥈','🥉'];
  const HEIGHTS = [140,110,90];

  const top3 = topStudents.slice(0,3);
  const rest  = topStudents.slice(3);

  return (
    <div>
      {/* Podium */}
      {top3.length >= 2 && (
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'center', gap:12, marginBottom:28, padding:'10px 0 0' }}>
          {/* Reorder for podium: 2nd, 1st, 3rd */}
          {[
            top3[1] ? { ...top3[1], rank:2 } : null,
            top3[0] ? { ...top3[0], rank:1 } : null,
            top3[2] ? { ...top3[2], rank:3 } : null,
          ].filter(Boolean).map(s => (
            <div key={s.id} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:'1.5rem' }}>{MEDALS[s.rank-1]}</span>
              <MiniAvatar name={s.name} size={44}/>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:'0.82rem', fontWeight:700, maxWidth:100, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.name.split(' ').slice(0,2).join(' ')}</div>
                <div style={{ fontSize:'0.82rem', fontWeight:800, color:scoreColor(s.avgPct), fontFamily:'Cairo,sans-serif' }}>{s.avgPct}%</div>
              </div>
              <div style={{ width:80, height:HEIGHTS[s.rank-1], background:`${scoreColor(s.avgPct)}22`, borderRadius:'8px 8px 0 0', border:`2px solid ${scoreColor(s.avgPct)}44`, position:'relative', overflow:'hidden' }}>
                <div style={{ position:'absolute', bottom:0, width:'100%', height:`${s.avgPct}%`, background:scoreColor(s.avgPct)+'44', transition:'height .8s ease' }}/>
                <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.4rem' }}>{MEDALS[s.rank-1]}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rest of top 10 */}
      {rest.length > 0 && (
        <div style={{ border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
          <div style={{ padding:'10px 16px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', fontSize:'0.72rem', fontWeight:700, color:'var(--text3)' }}>
            المراكز 4–{Math.min(topStudents.length,10)}
          </div>
          {rest.map((s, i) => (
            <div key={s.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 16px', borderBottom:'1px solid var(--border)', transition:'background .12s' }}
              onMouseOver={e => e.currentTarget.style.background='var(--surface2)'}
              onMouseOut={e  => e.currentTarget.style.background=''}
            >
              <span style={{ width:22, fontSize:'0.72rem', fontWeight:700, color:'var(--text3)', fontFamily:'Cairo,sans-serif', textAlign:'center' }}>{i+4}</span>
              <MiniAvatar name={s.name} size={30}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:600, fontSize:'0.88rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.name}</div>
                <div style={{ fontSize:'0.68rem', color:'var(--text3)' }}>{s.examCount} امتحان</div>
              </div>
              <div style={{ width:150, flexShrink:0 }}><ScoreBar pct={s.avgPct} color={scoreColor(s.avgPct)}/></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Full ranking table ───────────────────────────────────────
// Phase 1D: studentAgg is the unfiltered groupBy=student aggregate shared with the Top/Weak
// tabs; when filterExam is set, this table fetches its OWN examId-scoped aggregate instead
// (both the average and examCount then reflect only that one exam) — same behavior the old
// client-side `grades.filter(g => g.examId === filterExam)` produced, now computed server-side.
function RankingTable({ students, exams, studentAgg }) {
  const [filterExam, setFilterExam] = useState('');
  const toast = useToast();

  const { data: filteredAgg, error: filteredAggError } = useAsyncData(
    () => (filterExam ? pgGetGradesAggregate({ groupBy: 'student', examId: filterExam }) : Promise.resolve(null)),
    [filterExam], null,
  );

  useEffect(() => {
    if (filteredAggError) toast.error(filteredAggError.message || 'فشل تحميل ترتيب الطلاب');
  }, [filteredAggError]);

  const activeAgg = filterExam ? (filteredAgg ?? []) : studentAgg;

  const ranking = useMemo(() => {
    return joinStudentAggregate(students, activeAgg)
      .sort((a,b) => {
        if (a.avgPct === null && b.avgPct !== null) return 1;
        if (a.avgPct !== null && b.avgPct === null) return -1;
        return (b.avgPct ?? -1) - (a.avgPct ?? -1);
      });
  }, [students, activeAgg]);

  return (
    <div>
      <div style={{ marginBottom:14 }}>
        <select value={filterExam} onChange={e => setFilterExam(e.target.value)}
          style={{ background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'7px 12px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', outline:'none', cursor:'pointer', direction:'rtl' }}>
          <option value="">كل الامتحانات</option>
          {exams.filter(e=>e.status==='done').map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>

      <div style={{ border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
          <thead>
            <tr style={{ background:'var(--surface2)' }}>
              {['الترتيب','الطالب','المجموعة','عدد الامتحانات','متوسط الدرجات','التقدير'].map(h => (
                <th key={h} style={{ padding:'9px 14px', fontSize:'0.65rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranking.map((s, i) => {
              const { bg, color } = avStyle(s.name);
              const letters = s.name.split(' ').map(w=>w[0]).slice(0,2).join('');
              const gColor = scoreColor(s.avgPct);
              const grade = s.avgPct === null ? '—' : s.avgPct >= 90 ? 'A+' : s.avgPct >= 80 ? 'A' : s.avgPct >= 70 ? 'B' : s.avgPct >= 60 ? 'C' : s.avgPct >= 50 ? 'D' : 'F';
              return (
                <tr key={s.id} style={{ transition:'background .12s' }}
                  onMouseOver={e => Array.from(e.currentTarget.cells).forEach(td=>td.style.background='var(--surface2)')}
                  onMouseOut={e  => Array.from(e.currentTarget.cells).forEach(td=>td.style.background='')}
                >
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
                    <span style={{ display:'inline-flex', width:28, height:28, borderRadius:'50%', alignItems:'center', justifyContent:'center', fontSize:'0.75rem', fontWeight:800, fontFamily:'Cairo,sans-serif',
                      background: i<3 ? ['rgba(245,158,11,.2)','rgba(148,163,184,.2)','rgba(180,120,70,.2)'][i] : 'var(--surface3)',
                      color: i<3 ? ['#f59e0b','#94a3b8','#b47846'][i] : 'var(--text3)',
                    }}>{i+1}</span>
                  </td>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                      <div style={{ width:30, height:30, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.72rem', fontWeight:700, flexShrink:0 }}>{letters}</div>
                      <div>
                        <div style={{ fontWeight:600 }}>{s.name}</div>
                        <div style={{ fontSize:'0.68rem', color:'var(--text3)', fontFamily:'Cairo,sans-serif' }}>{s.code}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text2)' }}>{s.grade}</td>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontFamily:'Cairo,sans-serif', textAlign:'center' }}>{s.examCount}</td>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
                    {s.avgPct !== null ? <ScoreBar pct={s.avgPct} color={gColor}/> : <span style={{ color:'var(--text3)', fontSize:'0.78rem' }}>لا بيانات</span>}
                  </td>
                  <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
                    <span style={{ display:'inline-flex', padding:'3px 10px', borderRadius:99, fontSize:'0.72rem', fontWeight:800, background:`${gColor}18`, color:gColor }}>{grade}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Weak students ────────────────────────────────────────────
// Phase 1D: threshold-filters the SAME shared studentAgg the Top Students tab already
// fetched — no second network call for this tab.
function WeakStudentsView({ students, groups, studentAgg }) {
  const [threshold, setThreshold] = useState(60);

  const weak = useMemo(
    () => joinStudentAggregate(students, studentAgg)
      .filter((s) => s.avgPct !== null && s.avgPct < threshold)
      .sort((a, b) => a.avgPct - b.avgPct),
    [students, studentAgg, threshold],
  );

  return (
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:16, alignItems:'center' }}>
        <span style={{ fontSize:'0.78rem', color:'var(--text3)' }}>أقل من:</span>
        {[50,60,70].map(n => (
          <button key={n} onClick={() => setThreshold(n)}
            style={{ padding:'5px 14px', borderRadius:8, fontSize:'0.78rem', fontWeight:700, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .12s',
              background: threshold===n ? 'var(--accent)' : 'var(--surface2)',
              color:      threshold===n ? 'var(--surface)' : 'var(--text2)',
              border:     `1px solid ${threshold===n ? 'var(--accent)' : 'var(--border)'}`,
            }}>
            {n}%
          </button>
        ))}
        {weak.length > 0 && (
          <span style={{ marginRight:'auto', background:'rgba(239,68,68,.1)', color:'#ef4444', border:'1px solid rgba(239,68,68,.2)', borderRadius:99, padding:'4px 12px', fontSize:'0.75rem', fontWeight:700 }}>
            ⚠ {weak.length} طالب يحتاج دعماً
          </span>
        )}
      </div>

      {weak.length === 0 ? (
        <div style={{ textAlign:'center', padding:'48px', color:'var(--text3)' }}>
          <div style={{ fontSize:44, opacity:.4, marginBottom:10 }}>🎉</div>
          <div style={{ fontWeight:600 }}>لا يوجد طلاب أقل من {threshold}%</div>
        </div>
      ) : (
        <div style={{ border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
          {weak.map((s, i) => {
            const group = groups.find(g => g.id === s.groupId);
            const { bg, color } = avStyle(s.name);
            const letters = s.name.split(' ').map(w=>w[0]).slice(0,2).join('');
            return (
              <div key={s.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'13px 16px', borderBottom:'1px solid var(--border)', transition:'background .12s' }}
                onMouseOver={e => e.currentTarget.style.background='var(--surface2)'}
                onMouseOut={e  => e.currentTarget.style.background=''}
              >
                <span style={{ width:22, fontSize:'0.72rem', fontWeight:700, color:'#ef4444', fontFamily:'Cairo,sans-serif', textAlign:'center' }}>{i+1}</span>
                <div style={{ width:34, height:34, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.78rem', fontWeight:700, flexShrink:0 }}>{letters}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.name}</div>
                  <div style={{ fontSize:'0.7rem', color:'var(--text3)', display:'flex', gap:10, marginTop:1 }}>
                    <span>{group?.name||'—'}</span>
                    <span>{s.examCount} امتحان · رسب في {s.failCount}</span>
                  </div>
                </div>
                <div style={{ width:130, flexShrink:0 }}><ScoreBar pct={s.avgPct} color={scoreColor(s.avgPct)}/></div>
                <span style={{ display:'inline-flex', padding:'3px 10px', borderRadius:99, fontSize:'0.7rem', fontWeight:700, background:'rgba(239,68,68,.1)', color:'#ef4444', border:'1px solid rgba(239,68,68,.2)', flexShrink:0 }}>
                  {s.avgPct < 40 ? 'خطير' : s.avgPct < 50 ? 'ضعيف جداً' : 'يحتاج متابعة'}
                </span>
                <a href={`tel:${s.parentPhone||s.phone}`}
                  style={{ padding:'5px 10px', borderRadius:7, border:'1px solid var(--border)', background:'var(--surface2)', fontSize:'0.72rem', color:'var(--text2)', textDecoration:'none', transition:'all .12s', flexShrink:0 }}
                  onMouseOver={e => { e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.color='var(--accent)'; }}
                  onMouseOut={e  => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--text2)'; }}>
                  📞
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
export default function ExamReports() {
  const exams                = useAppStore((s) => s.exams);
  const groups               = useAppStore((s) => s.groups);
  const students             = useAppStore((s) => s.students);
  const centerProfile        = useAppStore((s) => s.centerProfile);
  const toast = useToast();
  const [tab, setTab] = useState('top');

  // Phase 1D (Grades global-read migration) — one unfiltered groupBy=student aggregate,
  // shared by the Top Students and Weak Students tabs (RankingTable fetches its own
  // examId-scoped variant separately, only when its filter is set).
  const { data: studentAgg = [], error: studentAggError } = useAsyncData(
    () => pgGetGradesAggregate({ groupBy: 'student' }), [], []);

  useEffect(() => {
    if (studentAggError) toast.error(studentAggError.message || 'فشل تحميل إحصاءات الدرجات');
  }, [studentAggError]);

  const topStudents = useMemo(
    () => joinStudentAggregate(students, studentAgg).filter((s) => s.avgPct !== null).sort((a, b) => b.avgPct - a.avgPct).slice(0, 10),
    [students, studentAgg],
  );

  return (
    <>
      <PrintHeader reportTitle="تقارير الامتحانات" reportSubtitle="" />
      <div>
      <div style={{ display:'flex', gap:2, marginBottom:20, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:12, padding:3, width:'fit-content' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:10, fontSize:'0.85rem', fontWeight:tab===t.id?700:500, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .15s', border:'none',
              background:tab===t.id ? 'var(--surface)' : 'transparent',
              color:      tab===t.id ? 'var(--accent)'  : 'var(--text2)',
              boxShadow:  tab===t.id ? '0 1px 4px rgba(0,0,0,.15)' : 'none',
            }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div style={{ animation:'fadeIn .18s ease' }}>
        {tab === 'top'     && <TopStudentsPodium topStudents={topStudents}/>}
        {tab === 'ranking' && <RankingTable students={students} exams={exams} studentAgg={studentAgg}/>}
        {tab === 'weak'    && <WeakStudentsView students={students} groups={groups} studentAgg={studentAgg}/>}
        {tab === 'print'   && <ExamPrintView groups={groups} exams={exams} students={students} profile={centerProfile}/>}
      </div>
    </div>
    </>
  );
}

// ── تاب الطباعة: بالطالب أو بالمجموعة+امتحان ──────────────────────────────────
// Phase 1D: grades for the print report are fetched on-demand, scoped by studentId/examId,
// only when "generate" is clicked — not read from the global store continuously.
function ExamPrintView({ groups, exams, students, profile }) {
  const [mode, setMode] = useState('group'); // 'group' | 'student'
  const [groupId, setGroupId] = useState('');
  const [examId, setExamId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [generating, setGenerating] = useState(false);
  const toast = useToast();

  // C2 fix (Pre-Installer Audit): new exams no longer carry a groupId (Exams Phase 2 —
  // targeted by grade, not group; see ExamForm.jsx/examService.js). `exam.groupId ===
  // groupId` was therefore always empty for any current exam. Migration 007 backfilled
  // `grade` on every historical exam row from its old group's grade, so resolving via the
  // selected group's grade covers current AND historical exams with no ambiguity —
  // mirrors getExamEligibleStudents' own grade-only eligibility rule exactly.
  const selectedGroup = groups.find(g => g.id === groupId);
  const groupExams    = selectedGroup ? exams.filter(e => e.grade === selectedGroup.grade) : [];
  // student mode's group scoping is unrelated to exam targeting — student.groupId is the
  // Primary-group membership field (kept in sync by enrollmentService), not exam.groupId.
  const groupStudents = students.filter(s => s.groupId === groupId && s.status === 'active');
  const boxStyle = { width:'100%', background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'10px 12px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.88rem', cursor:'pointer', direction:'rtl' };
  const lblStyle = { fontSize:'0.75rem', fontWeight:700, color:'var(--text3)', display:'block', marginBottom:6 };

  return (
    <div style={{ maxWidth:560, margin:'0 auto' }}>
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'24px' }}>
        <div style={{ fontWeight:800, fontSize:'1rem', marginBottom:16 }}>🖨 طباعة كشف درجات</div>

        {/* اختيار النوع */}
        <div style={{ display:'flex', gap:8, marginBottom:18, background:'var(--surface2)', borderRadius:10, padding:3 }}>
          {[{id:'group',l:'بالمجموعة + امتحان'},{id:'student',l:'بالطالب'}].map(m => (
            <button key={m.id} onClick={()=>setMode(m.id)}
              style={{ flex:1, padding:'8px', borderRadius:8, border:'none', cursor:'pointer', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', fontWeight:mode===m.id?700:500,
                background:mode===m.id?'var(--accent)':'transparent', color:mode===m.id?'var(--surface)':'var(--text2)' }}>
              {m.l}
            </button>
          ))}
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div>
            <label style={lblStyle}>المجموعة</label>
            <select value={groupId} onChange={e=>{setGroupId(e.target.value);setExamId('');setStudentId('');}} style={boxStyle}>
              <option value="">اختر المجموعة...</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}{g.grade?` — ${g.grade}`:''}</option>)}
            </select>
          </div>

          {mode === 'group' && (
            <div>
              <label style={lblStyle}>الامتحان</label>
              <select value={examId} onChange={e=>setExamId(e.target.value)} style={boxStyle} disabled={!groupId}>
                <option value="">{!groupId ? 'اختر المجموعة أولاً...' : groupExams.length===0 ? 'لا توجد امتحانات لهذه المجموعة' : 'اختر الامتحان...'}</option>
                {groupExams.map(e => <option key={e.id} value={e.id}>{e.name}{e.subject?` — ${e.subject}`:''}</option>)}
              </select>
            </div>
          )}

          {mode === 'student' && (
            <div>
              <label style={lblStyle}>الطالب</label>
              <StudentSearchSelect
                students={groupStudents}
                value={studentId}
                onChange={(id) => setStudentId(id)}
                disabled={!groupId}
                placeholder={!groupId ? 'اختر المجموعة أولاً...' : 'ابحث عن الطالب...'}
              />
            </div>
          )}

          <Button variant="primary"
            disabled={generating || (mode==='group' ? (!groupId || !examId) : (!groupId || !studentId))}
            onClick={async () => {
              const group = groups.find(g => g.id === groupId);
              setGenerating(true);
              try {
                if (mode === 'group') {
                  const exam = exams.find(e => e.id === examId);
                  const grades = await pgGetGrades({ examId: exam.id });
                  openGroupExamReport({ group, exam, students, grades, profile });
                } else {
                  const student = students.find(s => s.id === studentId);
                  const grades = await pgGetGrades({ studentId: student.id });
                  openStudentExamReport({ student, group, exams, grades, profile });
                }
              } catch (err) {
                toast.error(err.message || 'فشل تحميل درجات الكشف');
              } finally {
                setGenerating(false);
              }
            }} style={{ marginTop:6 }}>
            🖨 توليد الكشف وطباعته
          </Button>
        </div>
      </div>
    </div>
  );
}
