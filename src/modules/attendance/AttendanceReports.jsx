// src/modules/attendance/AttendanceReports.jsx
// Three report tabs: by-student · by-group · frequent-absentees
import { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../../store/app.store';
import AttendanceStats from './components/AttendanceStats';
import { getAttendanceStats, getGroupAttendanceStats, getGroupSessions, getFrequentAbsentees, STATUS_META } from '../../services/attendanceService';
import { formatDate }  from '../../utils/helpers';
import { useAvatarStyle } from '../students/components/StudentAvatar';
import { PrintHeader } from '../../components/shared';
import { openGroupSessionReport, openStudentAttendanceReport } from './buildAttendanceReport';
import { pgGetEligibleStudentsForSession, pgGetAttendance, pgGetAttendanceAggregate } from '../../services/api';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useToast } from '../../components/Toast';
import Button from '../../components/ui/Button';
import StudentSearchSelect from '../../components/ui/StudentSearchSelect';

const TABS = [
  { id:'student', label:'تقرير الطالب',     icon:'👤' },
  { id:'group',   label:'تقرير المجموعة',   icon:'◈'  },
  { id:'absents', label:'كثيرو الغياب',     icon:'⚠'  },
  { id:'print',   label:'طباعة كشف',        icon:'🖨' },
];

// ── Shared select style ──────────────────────────────────────
const SEL = {
  background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9,
  padding:'8px 12px', color:'var(--text)', fontFamily:'Cairo,sans-serif',
  fontSize:'0.85rem', outline:'none', cursor:'pointer', direction:'rtl',
};

// ── Avatar helper ────────────────────────────────────────────
function MiniAvatar({ name, size = 30 }) {
  const { bg, color } = useAvatarStyle(name);
  const letters = name.split(' ').map(w => w[0]).slice(0,2).join('');
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:size*0.32, fontWeight:700, flexShrink:0 }}>
      {letters}
    </div>
  );
}

// ── Stat pill ────────────────────────────────────────────────
function StatBox({ label, value, color = 'var(--text)', sub }) {
  return (
    <div style={{ background:'var(--surface2)', borderRadius:12, padding:'14px 16px', textAlign:'center' }}>
      <div style={{ fontSize:'1.5rem', fontWeight:800, color, fontFamily:'Cairo,sans-serif', lineHeight:1 }}>{value}</div>
      <div style={{ fontSize:'0.68rem', color:'var(--text3)', marginTop:5, fontWeight:600 }}>{label}</div>
      {sub && <div style={{ fontSize:'0.62rem', color:'var(--text3)', marginTop:2 }}>{sub}</div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// REPORT 1 — BY STUDENT
// ════════════════════════════════════════════════════════════
function ReportByStudent({ students }) {
  const [selectedStudent, setSelectedStudent] = useState('');
  const toast = useToast();

  const student = students.find(s => s.id === selectedStudent);

  // C4 Attendance migration Phase 2: scoped GET /api/attendance?studentId= instead of
  // filtering the full global attendance array — getAttendanceStats itself is unchanged
  // and still does the exact same computation, just over the already-scoped result.
  const { data: attendance = [], error: attendanceError } = useAsyncData(
    () => (selectedStudent ? pgGetAttendance({ studentId: selectedStudent }) : Promise.resolve([])),
    [selectedStudent], []);

  useEffect(() => {
    if (attendanceError) toast.error(attendanceError.message || 'فشل تحميل سجل حضور الطالب');
  }, [attendanceError]);

  const records = useMemo(() =>
    [...attendance].sort((a,b) => b.date.localeCompare(a.date)),
  [attendance]);

  const stats = useMemo(() =>
    getAttendanceStats(selectedStudent, attendance),
  [selectedStudent, attendance]);

  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <label style={{ display:'block', fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>
          اختر الطالب
        </label>
        <div style={{ width:300 }}>
          <StudentSearchSelect
            students={students.filter(s => s.status==='active')}
            value={selectedStudent}
            onChange={(id) => setSelectedStudent(id)}
          />
        </div>
      </div>

      {!selectedStudent ? (
        <div style={{ textAlign:'center', padding:'48px 20px', color:'var(--text3)', fontSize:'0.85rem' }}>
          اختر طالباً لعرض تقرير حضوره
        </div>
      ) : (
        <>
          {/* Student header */}
          <div style={{ display:'flex', alignItems:'center', gap:14, padding:'16px 18px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, marginBottom:16 }}>
            <MiniAvatar name={student?.name||''} size={46}/>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:800, fontSize:'1.05rem' }}>{student?.name}</div>
              <div style={{ fontSize:'0.72rem', color:'var(--text3)', fontFamily:'Cairo,sans-serif' }}>{student?.code}</div>
            </div>
            <AttendanceStats {...stats} pct={stats.pct}/>
          </div>

          {/* Stats grid */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:16 }}>
            <StatBox label="إجمالي الجلسات" value={stats.total}/>
            <StatBox label="حضور"  value={stats.present} color="#10b981"/>
            <StatBox label="غياب"  value={stats.absent}  color="#ef4444"/>
            <StatBox label="نسبة الحضور" value={stats.pct !== null ? `${stats.pct}%` : '—'}
              color={stats.pct >= 80 ? '#10b981' : stats.pct >= 60 ? '#f59e0b' : '#ef4444'}/>
          </div>

          {/* Records list */}
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
            <div style={{ padding:'12px 16px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', fontWeight:700, color:'var(--text3)' }}>
              سجل الجلسات ({records.length})
            </div>
            {records.length === 0 ? (
              <div style={{ textAlign:'center', padding:'32px', color:'var(--text3)', fontSize:'0.82rem' }}>لا توجد سجلات</div>
            ) : (
              <div style={{ maxHeight:380, overflowY:'auto' }}>
                {records.map((r, i) => {
                  const meta = STATUS_META[r.status] || STATUS_META.none;
                  return (
                    <div key={r.id||i} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 16px', borderBottom:'1px solid var(--border)', transition:'background .12s' }}
                      onMouseOver={e => e.currentTarget.style.background='var(--surface2)'}
                      onMouseOut={e  => e.currentTarget.style.background=''}
                    >
                      <span style={{ fontSize:'1rem', width:24, textAlign:'center', flexShrink:0 }}>{meta.icon}</span>
                      <span style={{ flex:1, fontSize:'0.85rem' }}>{formatDate(r.date)}</span>
                      <span style={{ fontSize:'0.75rem', fontFamily:'Cairo,sans-serif', color:'var(--text3)' }}>{r.sessionTime}</span>
                      <span style={{ display:'inline-flex', alignItems:'center', padding:'2px 10px', borderRadius:99, fontSize:'0.7rem', fontWeight:700, background:meta.bg, color:meta.color, border:`1px solid ${meta.border}` }}>
                        {meta.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// REPORT 2 — BY GROUP
// ════════════════════════════════════════════════════════════
function ReportByGroup({ groups, students }) {
  const [selectedGroup, setSelectedGroup] = useState('');
  const [expandedDate, setExpandedDate]  = useState(null);
  const toast = useToast();

  const group = groups.find(g => g.id === selectedGroup);

  // C4 Attendance migration Phase 2: scoped GET /api/attendance?groupId= instead of
  // filtering the full global attendance array — getGroupAttendanceStats/getGroupSessions
  // are unchanged and still do the exact same computation (including the per-session
  // expand view, which needs real rows, not an aggregate) over the already-scoped result.
  const { data: attendance = [], error: attendanceError } = useAsyncData(
    () => (selectedGroup ? pgGetAttendance({ groupId: selectedGroup }) : Promise.resolve([])),
    [selectedGroup], []);

  useEffect(() => {
    if (attendanceError) toast.error(attendanceError.message || 'فشل تحميل سجل حضور المجموعة');
  }, [attendanceError]);

  const stats   = useMemo(() => getGroupAttendanceStats(selectedGroup, attendance), [selectedGroup, attendance]);
  const sessions = useMemo(() => getGroupSessions(selectedGroup, attendance), [selectedGroup, attendance]);
  const groupStudents = useMemo(() => students.filter(s => s.groupId === selectedGroup), [students, selectedGroup]);

  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <label style={{ display:'block', fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>
          اختر المجموعة
        </label>
        <select style={{ ...SEL, width:300 }} value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)}>
          <option value="">اختر مجموعة...</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      {!selectedGroup ? (
        <div style={{ textAlign:'center', padding:'48px 20px', color:'var(--text3)', fontSize:'0.85rem' }}>
          اختر مجموعة لعرض تقرير الحضور
        </div>
      ) : (
        <>
          {/* Group header */}
          <div style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 18px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, marginBottom:16 }}>
            <div style={{ width:10, height:10, borderRadius:'50%', background:group?.color||'var(--accent)', flexShrink:0 }}/>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:800, fontSize:'1rem' }}>{group?.name}</div>
              <div style={{ fontSize:'0.72rem', color:'var(--text3)' }}>{group?.grade} · {groupStudents.length} طالب</div>
            </div>
          </div>

          {/* Stats */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:16 }}>
            <StatBox label="عدد الجلسات"   value={stats.sessionCount}/>
            <StatBox label="إجمالي الحضور" value={stats.present} color="#10b981"/>
            <StatBox label="إجمالي الغياب" value={stats.absent}  color="#ef4444"/>
            <StatBox label="نسبة الحضور"   value={stats.pct !== null ? `${stats.pct}%` : '—'}
              color={stats.pct >= 80 ? '#10b981' : stats.pct >= 60 ? '#f59e0b' : '#ef4444'}/>
          </div>

          {/* Sessions list with expand */}
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
            <div style={{ padding:'12px 16px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', fontSize:'0.78rem', fontWeight:700, color:'var(--text3)' }}>
              الجلسات ({sessions.length})
            </div>
            {sessions.length === 0 ? (
              <div style={{ textAlign:'center', padding:'32px', color:'var(--text3)', fontSize:'0.82rem' }}>لا توجد جلسات مسجّلة</div>
            ) : (
              sessions.map(s => {
                const pct = s.total ? Math.round(s.presentCount/s.total*100) : 0;
                const pctColor = pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444';
                const expanded = expandedDate === s.date;
                return (
                  <div key={s.date}>
                    <div
                      onClick={() => setExpandedDate(expanded ? null : s.date)}
                      style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 16px', borderBottom:'1px solid var(--border)', cursor:'pointer', transition:'background .12s' }}
                      onMouseOver={e => e.currentTarget.style.background='var(--surface2)'}
                      onMouseOut={e  => e.currentTarget.style.background=''}
                    >
                      <span style={{ fontSize:'0.75rem', color:'var(--text3)', transition:'transform .15s', display:'inline-block', transform: expanded ? 'rotate(90deg)' : '' }}>›</span>
                      <span style={{ flex:1, fontSize:'0.85rem', fontWeight:600 }}>{formatDate(s.date)}</span>
                      <div style={{ display:'flex', gap:10, fontSize:'0.72rem' }}>
                        <span style={{ color:'#10b981' }}>✓ {s.presentCount}</span>
                        <span style={{ color:'#f59e0b' }}>⏱ {s.lateCount}</span>
                        <span style={{ color:'#ef4444' }}>✗ {s.absentCount}</span>
                      </div>
                      <span style={{ fontSize:'0.75rem', fontWeight:800, color:pctColor, fontFamily:'Cairo,sans-serif', minWidth:36 }}>
                        {pct}%
                      </span>
                    </div>
                    {/* Expanded student list */}
                    {expanded && (
                      <div style={{ background:'var(--surface2)', borderBottom:'1px solid var(--border)' }}>
                        {s.records.map(r => {
                          const std  = students.find(st => st.id === r.studentId);
                          const meta = STATUS_META[r.status] || STATUS_META.none;
                          return (
                            <div key={r.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 24px', borderBottom:'1px solid var(--border)' }}>
                              {std && <MiniAvatar name={std.name} size={26}/>}
                              <span style={{ flex:1, fontSize:'0.82rem' }}>{std?.name || r.studentId}</span>
                              <span style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'2px 9px', borderRadius:99, fontSize:'0.68rem', fontWeight:700, background:meta.bg, color:meta.color, border:`1px solid ${meta.border}` }}>
                                {meta.icon} {meta.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// REPORT 3 — FREQUENT ABSENTEES
// ════════════════════════════════════════════════════════════
function ReportFrequentAbsentees({ students, groups }) {
  const [threshold, setThreshold] = useState(3);
  const [filterGroup, setFilterGroup] = useState('');
  const toast = useToast();

  const filtered = useMemo(() =>
    filterGroup ? students.filter(s => s.groupId === filterGroup) : students,
  [students, filterGroup]);

  // C4 Attendance migration Phase 2 (final consumer): scoped GET
  // /api/attendance/aggregate?groupBy=student&studentIds=<active ids>[&groupId=] instead of
  // filtering the full global attendance array — studentIds is always the client's current
  // active (and group-filtered) student ids, never omitted/empty, so the request never scales
  // with inactive/withdrawn students who still have attendance history (FR-004, research.md
  // §1a). Omitting studentIds when empty would fall through to an UNSCOPED request server-side
  // (and an explicitly-empty studentIds throws a 400) — both wrong, so the fetch is skipped
  // entirely when there are zero active students, matching StudentsPage.jsx's
  // `visibleStudentIds.length ? pgGetAttendance(...) : Promise.resolve([])` guard.
  const activeStudentIds = useMemo(() =>
    filtered.filter(s => s.status === 'active').map(s => s.id),
  [filtered]);
  const activeStudentIdsKey = activeStudentIds.join(',');

  const { data: aggregateRows = [], error: aggregateError } = useAsyncData(
    () => (activeStudentIds.length
      ? pgGetAttendanceAggregate({ groupBy: 'student', studentIds: activeStudentIdsKey, groupId: filterGroup || undefined })
      : Promise.resolve([])),
    [activeStudentIdsKey, filterGroup], []);

  useEffect(() => {
    if (aggregateError) toast.error(aggregateError.message || 'فشل تحميل بيانات حضور الطلاب');
  }, [aggregateError]);

  const statsByStudentId = useMemo(() => new Map(aggregateRows.map(r => [r.key, r])), [aggregateRows]);

  const absentees = useMemo(() =>
    getFrequentAbsentees(filtered, statsByStudentId, threshold),
  [filtered, statsByStudentId, threshold]);

  return (
    <div>
      {/* Controls */}
      <div style={{ display:'flex', gap:12, marginBottom:20, flexWrap:'wrap', alignItems:'center' }}>
        <div>
          <label style={{ display:'block', fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>
            الحد الأدنى للغيابات
          </label>
          <div style={{ display:'flex', gap:5 }}>
            {[2,3,5,7].map(n => (
              <button key={n} onClick={() => setThreshold(n)}
                style={{ padding:'6px 14px', borderRadius:8, fontSize:'0.78rem', fontWeight:700, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .12s',
                  background: threshold === n ? 'var(--accent)' : 'var(--surface2)',
                  color:      threshold === n ? 'var(--surface)' : 'var(--text2)',
                  border:     `1px solid ${threshold === n ? 'var(--accent)' : 'var(--border)'}`,
                }}>
                {n}+
              </button>
            ))}
          </div>
        </div>
        <div>
          <label style={{ display:'block', fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>
            المجموعة
          </label>
          <select style={SEL} value={filterGroup} onChange={e => setFilterGroup(e.target.value)}>
            <option value="">كل المجموعات</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        {absentees.length > 0 && (
          <div style={{ marginRight:'auto', background:'rgba(239,68,68,.1)', color:'#ef4444', border:'1px solid rgba(239,68,68,.2)', borderRadius:99, padding:'5px 14px', fontSize:'0.78rem', fontWeight:700 }}>
            ⚠ {absentees.length} طالب يحتاج متابعة
          </div>
        )}
      </div>

      {/* List */}
      {absentees.length === 0 ? (
        <div style={{ textAlign:'center', padding:'56px 20px', color:'var(--text3)' }}>
          <div style={{ fontSize:44, marginBottom:12, opacity:.4 }}>🎉</div>
          <div style={{ fontSize:'0.9rem', fontWeight:600 }}>لا يوجد طلاب تجاوزوا {threshold} غيابات</div>
        </div>
      ) : (
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between' }}>
            <span style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--text3)' }}>الطلاب كثيرو الغياب</span>
          </div>
          {absentees.map((s, i) => {
            const group  = groups.find(g => g.id === s.groupId);
            const pct    = s.pct;
            const pctColor = pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444';
            const severity = s.absent >= 7 ? 'خطير' : s.absent >= 5 ? 'تحذير' : 'متابعة';
            const sevColor  = s.absent >= 7 ? '#ef4444' : s.absent >= 5 ? '#f59e0b' : '#3b82f6';

            return (
              <div key={s.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'13px 16px', borderBottom:'1px solid var(--border)', transition:'background .12s' }}
                onMouseOver={e => e.currentTarget.style.background='var(--surface2)'}
                onMouseOut={e  => e.currentTarget.style.background=''}
              >
                {/* Rank badge */}
                <div style={{ width:28, height:28, borderRadius:'50%', background:`${sevColor}18`, border:`2px solid ${sevColor}40`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.72rem', fontWeight:800, color:sevColor, flexShrink:0 }}>
                  {i+1}
                </div>

                <MiniAvatar name={s.name} size={36}/>

                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:'0.9rem' }}>{s.name}</div>
                  <div style={{ fontSize:'0.7rem', color:'var(--text3)', marginTop:2 }}>
                    {group?.name || '—'} · {s.grade}
                  </div>
                </div>

                {/* Stats */}
                <div style={{ display:'flex', gap:8, flexShrink:0, flexWrap:'wrap' }}>
                  <div style={{ textAlign:'center' }}>
                    <div style={{ fontSize:'1.1rem', fontWeight:800, color:'#ef4444', fontFamily:'Cairo,sans-serif', lineHeight:1 }}>{s.absent}</div>
                    <div style={{ fontSize:'0.62rem', color:'var(--text3)' }}>غياب</div>
                  </div>
                  <div style={{ textAlign:'center' }}>
                    <div style={{ fontSize:'1.1rem', fontWeight:800, color:pctColor, fontFamily:'Cairo,sans-serif', lineHeight:1 }}>{pct !== null ? `${pct}%` : '—'}</div>
                    <div style={{ fontSize:'0.62rem', color:'var(--text3)' }}>الحضور</div>
                  </div>
                </div>

                {/* Severity */}
                <span style={{ display:'inline-flex', alignItems:'center', padding:'3px 10px', borderRadius:99, fontSize:'0.68rem', fontWeight:700, background:`${sevColor}15`, color:sevColor, border:`1px solid ${sevColor}30`, flexShrink:0 }}>
                  {severity}
                </span>

                {/* Phone quick-action */}
                <a href={`tel:${s.parentPhone || s.phone}`}
                  style={{ display:'flex', alignItems:'center', gap:4, padding:'5px 10px', borderRadius:7, border:'1px solid var(--border)', background:'var(--surface2)', fontSize:'0.72rem', color:'var(--text2)', textDecoration:'none', transition:'all .12s', flexShrink:0 }}
                  onMouseOver={e => { e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.color='var(--accent)'; }}
                  onMouseOut={e  => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--text2)'; }}
                >
                  📞 اتصال
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// REPORT 4 — PRINT (كشف حضور مجموعة + جلسة/تاريخ محدد)
// ════════════════════════════════════════════════════════════
// يستدعي openGroupSessionReport الموجودة بالفعل في buildAttendanceReport.js — بلا أي
// استعلام حضور جديد؛ "الجلسة" هنا نفس مفهوم getGroupSessions المُستخدَم بالفعل في
// ReportByGroup أعلاه (تجميع حسب date فقط — لا يوجد فرز مُنفصل بحسب sessionTime في
// الواجهة الحالية، فلا يُخترَع هنا). لا وقت جلسة (sessionTime) مُرسَل صراحةً — نفس دلالة
// "كل سجلات هذا التاريخ" التي تعرضها ReportByGroup بالفعل عند التوسيع.
function ReportPrint({ groups, students, profile }) {
  const [selectedGroup, setSelectedGroup] = useState('');
  const [selectedDate,  setSelectedDate]  = useState('');
  const [printing, setPrinting] = useState(false);
  const toast = useToast();

  const group = groups.find(g => g.id === selectedGroup);

  // C4 Attendance migration Phase 2: scoped GET /api/attendance?groupId= instead of
  // filtering the full global attendance array — feeds both the session-date dropdown
  // (getGroupSessions, unchanged) and the print itself below (reused, not re-fetched, since
  // it's already scoped to exactly this group).
  const { data: attendance = [], error: attendanceError } = useAsyncData(
    () => (selectedGroup ? pgGetAttendance({ groupId: selectedGroup }) : Promise.resolve([])),
    [selectedGroup], []);

  useEffect(() => {
    if (attendanceError) toast.error(attendanceError.message || 'فشل تحميل سجل حضور المجموعة');
  }, [attendanceError]);

  const sessions = useMemo(() => getGroupSessions(selectedGroup, attendance), [selectedGroup, attendance]);

  // Group Closure (Attendance Integration) — the roster for this exact historical
  // date/group is fetched fresh (attendanceEligibility.js, evaluated against THAT date's
  // enrollment state — see attendanceEligibility.js's own header on why status is ignored
  // and only start_date/end_date matter), not derived from today's current groupId filter.
  const handlePrint = async () => {
    setPrinting(true);
    try {
      const eligibleStudentIds = await pgGetEligibleStudentsForSession(selectedGroup, selectedDate);
      openGroupSessionReport({ group, date: selectedDate, students, attendance, profile, eligibleStudentIds });
    } catch (e) {
      toast.error(e.message || 'تعذّر تحميل قائمة الطلاب المؤهَّلين لهذه الجلسة');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom:20 }}>
        <label style={{ display:'block', fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>
          اختر المجموعة
        </label>
        <select style={{ ...SEL, width:300 }} value={selectedGroup}
          onChange={e => { setSelectedGroup(e.target.value); setSelectedDate(''); }}>
          <option value="">اختر مجموعة...</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      {!selectedGroup ? (
        <div style={{ textAlign:'center', padding:'48px 20px', color:'var(--text3)', fontSize:'0.85rem' }}>
          اختر مجموعة لطباعة كشف حضور إحدى جلساتها
        </div>
      ) : (
        <div>
          <label style={{ display:'block', fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>
            اختر الجلسة (التاريخ)
          </label>
          <select style={{ ...SEL, width:300, marginBottom:16 }} value={selectedDate} disabled={sessions.length === 0}
            onChange={e => setSelectedDate(e.target.value)}>
            <option value="">{sessions.length === 0 ? 'لا توجد جلسات مسجّلة لهذه المجموعة' : 'اختر الجلسة...'}</option>
            {sessions.map(s => (
              <option key={s.date} value={s.date}>{formatDate(s.date)} — {s.total} طالب</option>
            ))}
          </select>

          <div>
            <Button variant="primary" disabled={!selectedDate} loading={printing} onClick={handlePrint}>
              🖨 طباعة كشف الحضور
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// MAIN REPORTS COMPONENT
// ════════════════════════════════════════════════════════════
export default function AttendanceReports() {
  const groups               = useAppStore((s) => s.groups);
  const students             = useAppStore((s) => s.students);
  const centerProfile        = useAppStore((s) => s.centerProfile);
  const [activeTab, setActiveTab] = useState('student');

  return (
    <>
      <PrintHeader reportTitle="تقارير الحضور" reportSubtitle="" />
      <div>
      {/* Tabs */}
      <div style={{ display:'flex', gap:2, marginBottom:20, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:12, padding:3, width:'fit-content' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{
              display:'flex', alignItems:'center', gap:6,
              padding:'8px 16px', borderRadius:10, fontSize:'0.85rem', fontWeight: activeTab === t.id ? 700 : 500,
              cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .15s', border:'none',
              background: activeTab === t.id ? 'var(--surface)' : 'transparent',
              color:      activeTab === t.id ? 'var(--accent)' : 'var(--text2)',
              boxShadow:  activeTab === t.id ? '0 1px 4px rgba(0,0,0,.15)' : 'none',
            }}
            onMouseOver={e => { if (activeTab !== t.id) e.currentTarget.style.background='var(--surface3)'; }}
            onMouseOut={e  => { if (activeTab !== t.id) e.currentTarget.style.background='transparent'; }}
          >
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ animation:'fadeIn .18s ease' }}>
        {/* C4 Attendance migration Phase 2: all four tabs now fetch their own scoped/aggregate
            data (see ReportByStudent/ReportByGroup/ReportFrequentAbsentees/ReportPrint above)
            — this component no longer reads the global attendance store at all. */}
        {activeTab === 'student' && <ReportByStudent students={students}/>}
        {activeTab === 'group'   && <ReportByGroup   groups={groups} students={students}/>}
        {activeTab === 'absents' && <ReportFrequentAbsentees students={students} groups={groups}/>}
        {activeTab === 'print'   && <ReportPrint     groups={groups} students={students} profile={centerProfile}/>}
      </div>
    </div>
    </>
  );
}
