// src/modules/homework/HomeworkReports.jsx
import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/app.store';
import { formatDate } from '../../utils/helpers';
import { SUB_STATUS, getHomeworkEligibleStudents } from '../../services/homeworkService';
import { PrintHeader } from '../../components/shared';
import { pgGetHwSubmissionsAggregate, pgGetHomeworks } from '../../services/api';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useToast } from '../../components/Toast';

const TABS = [
  { id:'subject', label:'حسب المادة',       icon:'📚' },
  { id:'teacher', label:'حسب المدرس',        icon:'👤' },
  { id:'group',   label:'حسب المجموعة',     icon:'◈'  },
  { id:'period',  label:'حسب الفترة الزمنية', icon:'📅' },
];

function StatBox({ label, value, color='var(--text)' }) {
  return (
    <div style={{ background:'var(--surface2)', borderRadius:10, padding:'12px 14px', textAlign:'center' }}>
      <div style={{ fontSize:'1.4rem', fontWeight:800, color, fontFamily:'Cairo,sans-serif', lineHeight:1 }}>{value ?? '—'}</div>
      <div style={{ fontSize:'0.66rem', color:'var(--text3)', marginTop:4, fontWeight:600 }}>{label}</div>
    </div>
  );
}

function ProgressBar({ submitted, late, missing, total }) {
  if (!total) return null;
  const subPct = Math.round(submitted/total*100);
  const latePct = Math.round(late/total*100);
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <div style={{ flex:1, height:6, background:'var(--surface3)', borderRadius:99, overflow:'hidden' }}>
        <div style={{ height:'100%', display:'flex' }}>
          <div style={{ width:`${subPct}%`, background:'#10b981', transition:'width .5s' }}/>
          <div style={{ width:`${latePct}%`, background:'#f59e0b', transition:'width .5s' }}/>
        </div>
      </div>
      <span style={{ fontSize:'0.72rem', fontWeight:700, color:'#10b981', fontFamily:'Cairo,sans-serif', minWidth:36 }}>
        {subPct}%
      </span>
    </div>
  );
}

function HwRow({ hw, stats, onView }) {
  return (
    <tr style={{ transition:'background .12s', cursor:'pointer' }}
      onClick={onView}
      onMouseOver={e  => Array.from(e.currentTarget.cells).forEach(td => td.style.background='var(--surface2)')}
      onMouseOut={e   => Array.from(e.currentTarget.cells).forEach(td => td.style.background='')}
    >
      <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontWeight:600 }}>{hw.title}</td>
      <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text2)' }}>{formatDate(hw.dueDate, {month:'short',day:'numeric'})}</td>
      <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)' }}>
        <ProgressBar submitted={stats.submitted} late={stats.late} missing={stats.missing} total={stats.total}/>
      </td>
      <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.75rem' }}>
        <span style={{ color:'#10b981', fontWeight:700 }}>{stats.submitted}</span>/{stats.total}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────
export default function HomeworkReports({ onViewHomework }) {
  const groups               = useAppStore((s) => s.groups);
  const students             = useAppStore((s) => s.students);
  const toast = useToast();

  // Phase 2 (Homework global-read migration): one page-level GET /api/homeworks (pgGetHomeworks)
  // replaces the global s.homeworks bootstrap — every tab + the summary span all homeworks, so
  // the full parent list is the required scope. Fetched once per mount, reused by every tab.
  const { data: homeworks = [], error: homeworksError } = useAsyncData(() => pgGetHomeworks(), [], []);
  useEffect(() => {
    if (homeworksError) toast.error(homeworksError.message || 'فشل تحميل الواجبات');
  }, [homeworksError]);
  const [tab, setTab] = useState('subject');
  const [filterPeriod, setFilterPeriod] = useState({ from: '', to: '' });
  const [filterGroup, setFilterGroup] = useState('');

  // C4 Grades/hwSubmissions Frontend Migration (Batch A, feature 004): two page-level aggregate
  // fetches (fetched ONCE, reused across all 4 tabs + summary — FR-007/SC-002, research.md §7:
  // fully migratable, no deferred sub-part) replace the global hwSubmissions store selector.
  const { data: statusAgg = [], error: statusAggError } = useAsyncData(
    () => pgGetHwSubmissionsAggregate({ groupBy: 'status' }), [], []);
  const { data: perHomeworkAgg = [], error: perHomeworkAggError } = useAsyncData(
    () => pgGetHwSubmissionsAggregate({ groupBy: 'homework' }), [], []);

  useEffect(() => {
    const err = statusAggError || perHomeworkAggError;
    if (err) toast.error(err.message || 'فشل تحميل إحصائيات تسليم الواجبات');
  }, [statusAggError, perHomeworkAggError]);

  const perHomeworkMap = useMemo(() =>
    new Map(perHomeworkAgg.map(r => [r.key, r])),
  [perHomeworkAgg]);

  // Build stats for a list of homeworks
  // Homework 2.0 Phase 2: grade-based eligibility (getHomeworkEligibleStudents), never
  // Group-based — the fifth (and last) independent copy of this roster logic, now unified.
  // FR-008: total stays the eligible-student count (client-computed), never the aggregate row's
  // own `total` (a submission-ROW count — see research.md §4).
  const getStats = (hwList) => hwList.map(hw => {
    const eligibleStudents = getHomeworkEligibleStudents(hw, students);
    const agg = perHomeworkMap.get(hw.id);
    return {
      hw,
      total:     eligibleStudents.length,
      submitted: agg?.submitted ?? 0,
      late:      agg?.late ?? 0,
      missing:   agg?.missing ?? 0,
    };
  });

  // ── By subject ───────────────────────────────────────────
  const bySubject = useMemo(() => {
    const subjects = [...new Set(homeworks.map(h => h.subject))];
    return subjects.map(sub => {
      const hwList = homeworks.filter(h => h.subject === sub);
      const stats  = getStats(hwList);
      const totals = stats.reduce((a, s) => ({
        total: a.total+s.total, submitted: a.submitted+s.submitted,
        late: a.late+s.late, missing: a.missing+s.missing,
      }), { total:0, submitted:0, late:0, missing:0 });
      return { subject: sub, count: hwList.length, hws: stats, totals };
    });
  }, [homeworks, perHomeworkMap, students]);

  // ── By teacher ───────────────────────────────────────────
  const byTeacher = useMemo(() => {
    const teachers = [...new Set(homeworks.map(h => h.teacher).filter(Boolean))];
    return teachers.map(teacher => {
      const hwList = homeworks.filter(h => h.teacher === teacher);
      const stats  = getStats(hwList);
      const totals = stats.reduce((a, s) => ({
        total: a.total+s.total, submitted: a.submitted+s.submitted,
        late: a.late+s.late, missing: a.missing+s.missing,
      }), { total:0, submitted:0, late:0, missing:0 });
      return { teacher, count: hwList.length, hws: stats, totals };
    });
  }, [homeworks, perHomeworkMap, students]);

  // ── By group ─────────────────────────────────────────────
  // C3 fix (Pre-Installer Audit): new homeworks no longer carry a groupId (Homework 2.0 —
  // targeted by grade, not group), so `h.groupId === g.id` was always empty for any
  // current homework. Resolve via the group's grade instead — same rule as
  // getHomeworkEligibleStudents. A homework can now legitimately appear under more than
  // one group's breakdown when several groups share a grade — that's the correct
  // consequence of grade-based targeting (the same homework genuinely applies to every
  // group in that grade), not a duplication bug.
  const byGroup = useMemo(() => {
    return groups.map(g => {
      const hwList = homeworks.filter(h => h.grade === g.grade);
      const stats  = getStats(hwList);
      const totals = stats.reduce((a, s) => ({
        total: a.total+s.total, submitted: a.submitted+s.submitted,
        late: a.late+s.late, missing: a.missing+s.missing,
      }), { total:0, submitted:0, late:0, missing:0 });
      return { group: g, count: hwList.length, hws: stats, totals };
    }).filter(g => g.count > 0);
  }, [homeworks, perHomeworkMap, students, groups]);

  // ── By period ────────────────────────────────────────────
  // C3 fix (Pre-Installer Audit): same dead-filter pattern as byGroup above — filterGroup
  // holds a group id, resolved here to its grade before matching h.grade.
  const byPeriod = useMemo(() => {
    let filtered = homeworks;
    if (filterPeriod.from) filtered = filtered.filter(h => h.dueDate >= filterPeriod.from);
    if (filterPeriod.to)   filtered = filtered.filter(h => h.dueDate <= filterPeriod.to);
    if (filterGroup) {
      const grade = groups.find(g => g.id === filterGroup)?.grade;
      filtered = filtered.filter(h => h.grade === grade);
    }
    return getStats(filtered);
  }, [homeworks, perHomeworkMap, students, filterPeriod, filterGroup, groups]);

  // Summary totals — from the same statusAgg fetch above (groupBy=status), not a client-side
  // filter over every submission row.
  const totalHWs = homeworks.length;
  const totalSub = statusAgg.find(r => r.key === 'submitted')?.count ?? 0;
  const totalLate= statusAgg.find(r => r.key === 'late')?.count ?? 0;
  const totalMis = statusAgg.find(r => r.key === 'missing')?.count ?? 0;

  const SEL = { background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'7px 11px', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', outline:'none', cursor:'pointer', direction:'rtl' };

  const GroupBlock = ({ label, color, children, totals }) => (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden', marginBottom:14 }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'13px 18px', borderBottom:'1px solid var(--border)', background:'var(--surface2)' }}>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:800, fontSize:'0.92rem' }}>{label}</div>
          {totals && (
            <div style={{ fontSize:'0.72rem', color:'var(--text3)', marginTop:3, display:'flex', gap:12 }}>
              <span style={{ color:'#10b981' }}>✓ {totals.submitted}</span>
              <span style={{ color:'#f59e0b' }}>⏱ {totals.late}</span>
              <span style={{ color:'#ef4444' }}>✗ {totals.missing}</span>
            </div>
          )}
        </div>
        {totals && <ProgressBar {...totals}/>}
      </div>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
        <thead>
          <tr style={{ background:'var(--surface2)' }}>
            {['عنوان الواجب','موعد التسليم','نسبة التسليم','تم / الكل'].map(h => (
              <th key={h} style={{ padding:'8px 14px', fontSize:'0.62rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );

  return (
    <>
      <PrintHeader reportTitle="تقارير الواجبات" reportSubtitle="" />
      <div>
      {/* Overall summary */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:20 }}>
        <StatBox label="إجمالي الواجبات" value={totalHWs}/>
        <StatBox label="تم التسليم" value={totalSub} color="#10b981"/>
        <StatBox label="متأخر"       value={totalLate} color="#f59e0b"/>
        <StatBox label="لم يُسلَّم" value={totalMis}  color="#ef4444"/>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:2, marginBottom:20, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:12, padding:3, width:'fit-content', flexWrap:'wrap' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'7px 14px', borderRadius:10, fontSize:'0.82rem', fontWeight:tab===t.id?700:500, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .15s', border:'none',
              background:tab===t.id?'var(--surface)':'transparent',
              color:      tab===t.id?'var(--accent)':'var(--text2)',
              boxShadow:  tab===t.id?'0 1px 4px rgba(0,0,0,.15)':'none',
            }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── BY SUBJECT ─────────────────────────── */}
      {tab === 'subject' && (
        bySubject.length === 0 ? (
          <div style={{ textAlign:'center', padding:'48px', color:'var(--text3)' }}>لا توجد واجبات</div>
        ) : (
          bySubject.map(({ subject, count, hws, totals }) => (
            <GroupBlock key={subject} label={`📚 ${subject} (${count} واجب)`} totals={totals}>
              {hws.map(({ hw, ...stats }) => (
                <HwRow key={hw.id} hw={hw} stats={stats} onView={() => onViewHomework?.(hw)}/>
              ))}
            </GroupBlock>
          ))
        )
      )}

      {/* ── BY TEACHER ─────────────────────────── */}
      {tab === 'teacher' && (
        byTeacher.length === 0 ? (
          <div style={{ textAlign:'center', padding:'48px', color:'var(--text3)' }}>لا توجد واجبات مسجّلة بمدرس</div>
        ) : (
          byTeacher.map(({ teacher, count, hws, totals }) => (
            <GroupBlock key={teacher} label={`👤 ${teacher} (${count} واجب)`} totals={totals}>
              {hws.map(({ hw, ...stats }) => (
                <HwRow key={hw.id} hw={hw} stats={stats} onView={() => onViewHomework?.(hw)}/>
              ))}
            </GroupBlock>
          ))
        )
      )}

      {/* ── BY GROUP ───────────────────────────── */}
      {tab === 'group' && (
        byGroup.length === 0 ? (
          <div style={{ textAlign:'center', padding:'48px', color:'var(--text3)' }}>لا توجد واجبات</div>
        ) : (
          byGroup.map(({ group, count, hws, totals }) => (
            <GroupBlock key={group.id} label={`◈ ${group.name} (${count} واجب)`} totals={totals}>
              {hws.map(({ hw, ...stats }) => (
                <HwRow key={hw.id} hw={hw} stats={stats} onView={() => onViewHomework?.(hw)}/>
              ))}
            </GroupBlock>
          ))
        )
      )}

      {/* ── BY PERIOD ──────────────────────────── */}
      {tab === 'period' && (
        <div>
          <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
            <div>
              <label style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', display:'block', marginBottom:4 }}>من تاريخ</label>
              <input type="date" value={filterPeriod.from} onChange={e => setFilterPeriod(p => ({...p, from: e.target.value}))}
                style={{ ...SEL }}/>
            </div>
            <div>
              <label style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', display:'block', marginBottom:4 }}>إلى تاريخ</label>
              <input type="date" value={filterPeriod.to} onChange={e => setFilterPeriod(p => ({...p, to: e.target.value}))}
                style={{ ...SEL }}/>
            </div>
            <div>
              <label style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', display:'block', marginBottom:4 }}>المجموعة</label>
              <select style={SEL} value={filterGroup} onChange={e => setFilterGroup(e.target.value)}>
                <option value="">كل المجموعات</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            {(filterPeriod.from || filterPeriod.to || filterGroup) && (
              <button onClick={() => { setFilterPeriod({from:'',to:''}); setFilterGroup(''); }}
                style={{ ...SEL, color:'var(--text3)', cursor:'pointer', marginTop:16 }}>× مسح</button>
            )}
          </div>

          {byPeriod.length === 0 ? (
            <div style={{ textAlign:'center', padding:'48px', color:'var(--text3)' }}>لا توجد واجبات في هذه الفترة</div>
          ) : (
            <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
              <div style={{ padding:'12px 16px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', fontWeight:700, color:'var(--text3)' }}>
                {byPeriod.length} واجب
              </div>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.82rem' }}>
                <thead>
                  <tr style={{ background:'var(--surface2)' }}>
                    {['عنوان الواجب','المادة','المدرس','المجموعة','موعد التسليم','نسبة التسليم','تم/الكل'].map(h => (
                      <th key={h} style={{ padding:'8px 14px', fontSize:'0.62rem', fontWeight:700, color:'var(--text3)', textAlign:'right', borderBottom:'1px solid var(--border)', textTransform:'uppercase', letterSpacing:'0.07em', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byPeriod.map(({ hw, total, submitted, late, missing }) => {
                    const grp = groups.find(g => g.id === hw.groupId);
                    return (
                      <tr key={hw.id} style={{ cursor:'pointer', transition:'background .12s' }}
                        onClick={() => onViewHomework?.(hw)}
                        onMouseOver={e  => Array.from(e.currentTarget.cells).forEach(td => td.style.background='var(--surface2)')}
                        onMouseOut={e   => Array.from(e.currentTarget.cells).forEach(td => td.style.background='')}
                      >
                        <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontWeight:600 }}>{hw.title}</td>
                        <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text2)' }}>{hw.subject}</td>
                        <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text2)' }}>{hw.teacher||'—'}</td>
                        <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text2)' }}>{grp?.name||'—'}</td>
                        <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', color:'var(--text3)' }}>{formatDate(hw.dueDate)}</td>
                        <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', minWidth:120 }}>
                          <ProgressBar submitted={submitted} late={late} missing={missing} total={total}/>
                        </td>
                        <td style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:'0.75rem' }}>
                          <span style={{ color:'#10b981', fontWeight:700 }}>{submitted}</span>/{total}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
    </>
  );
}
