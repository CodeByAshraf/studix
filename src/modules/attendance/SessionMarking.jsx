// src/modules/attendance/SessionMarking.jsx
// Core feature: open a session, mark every student, save
import { useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../../store/app.store';
import { useAuth }     from '../../store/auth.context';
import { useToast }  from '../../components/Toast';
import Button        from '../../components/ui/Button';
import StatusToggle, { StatusQuickBtn } from './components/StatusToggle';
import AttendanceStats from './components/AttendanceStats';
import { getSessionRecords, STATUS_META } from '../../services/attendanceService';
import { pgSaveAttendanceSession } from '../../services/api';
import { useAvatarStyle } from '../students/components/StudentAvatar';
import { formatDate } from '../../utils/helpers';

// ── Student row in marking sheet ─────────────────────────────
function StudentMarkRow({ student, status, onStatusChange, index }) {
  const { bg, color } = useAvatarStyle(student.name);
  const letters = student.name.split(' ').map(w => w[0]).slice(0,2).join('');
  const meta    = STATUS_META[status] || STATUS_META.none;

  return (
    <div style={{
      display:'flex', alignItems:'center', gap:12,
      padding:'11px 18px',
      borderBottom:'1px solid var(--border)',
      background: status === 'absent' ? 'rgba(239,68,68,.03)' : status === 'present' ? 'rgba(16,185,129,.02)' : 'transparent',
      transition:'background .2s',
      borderRight:`3px solid ${status && status !== 'none' ? meta.color : 'transparent'}`,
    }}>
      {/* Rank */}
      <span style={{ width:22, fontSize:'0.68rem', color:'var(--text3)', fontFamily:'Cairo,sans-serif', textAlign:'center', flexShrink:0 }}>
        {index + 1}
      </span>

      {/* Avatar */}
      <div style={{ width:36, height:36, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.8rem', fontWeight:700, flexShrink:0 }}>
        {letters}
      </div>

      {/* Name + code */}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontWeight:600, fontSize:'0.9rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{student.name}</div>
        <div style={{ fontSize:'0.68rem', color:'var(--text3)', fontFamily:'Cairo,sans-serif' }}>{student.code}</div>
      </div>

      {/* Status quick-set row */}
      <div style={{ display:'flex', gap:5, flexShrink:0 }}>
        {['present','late','absent'].map(s => {
          const m = STATUS_META[s];
          return (
            <button key={s}
              onClick={() => onStatusChange(status === s ? 'none' : s)}
              style={{
                padding:'5px 11px', borderRadius:7, fontSize:'0.72rem', fontWeight:700,
                cursor:'pointer', transition:'all .12s', fontFamily:'Cairo,sans-serif',
                border:     `1.5px solid ${status === s ? m.border : 'var(--border)'}`,
                background: status === s ? m.bg : 'transparent',
                color:      status === s ? m.color : 'var(--text3)',
              }}
              onMouseOver={e => { if (status !== s) { e.currentTarget.style.background=m.bg; e.currentTarget.style.color=m.color; e.currentTarget.style.borderColor=m.border; }}}
              onMouseOut={e  => { if (status !== s) { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='var(--text3)'; e.currentTarget.style.borderColor='var(--border)'; }}}
            >
              {m.icon} {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
export default function SessionMarking({ onDone }) {
  const addLog               = useAppStore((s) => s.addLog);
  const attendance           = useAppStore((s) => s.attendance);
  const groups               = useAppStore((s) => s.groups);
  const setAttendance        = useAppStore((s) => s.setAttendance);
  const students             = useAppStore((s) => s.students);
  const { currentUser } = useAuth();
  const toast = useToast();

  // ── Session setup state ───────────────────────────────────
  const [step,         setStep]         = useState('setup');  // 'setup' | 'marking' | 'done'
  const [selectedGroup,setSelectedGroup]= useState('');
  const [sessionDate,  setSessionDate]  = useState(new Date().toISOString().split('T')[0]);
  const [sessionTime,  setSessionTime]  = useState('09:00');
  const [marks,        setMarks]        = useState({});       // { [studentId]: status }
  const [saving,       setSaving]       = useState(false);
  const [search,       setSearch]       = useState('');

  // ── Load group students ───────────────────────────────────
  const group = useMemo(() => groups.find(g => g.id === selectedGroup), [groups, selectedGroup]);

  const groupStudents = useMemo(() =>
    students.filter(s => s.groupId === selectedGroup && s.status === 'active'),
  [students, selectedGroup]);

  const filteredStudents = useMemo(() => {
    const q = search.toLowerCase();
    return q ? groupStudents.filter(s => s.name.toLowerCase().includes(q)) : groupStudents;
  }, [groupStudents, search]);

  // ── Existing session check ────────────────────────────────
  const existingSession = useMemo(() =>
    getSessionRecords(selectedGroup, sessionDate, attendance),
  [selectedGroup, sessionDate, attendance]);

  // ── Current stats ─────────────────────────────────────────
  const stats = useMemo(() => {
    const values = Object.values(marks);
    return {
      present:  values.filter(s => s === 'present').length,
      absent:   values.filter(s => s === 'absent').length,
      late:     values.filter(s => s === 'late').length,
      unmarked: groupStudents.length - values.filter(s => s && s !== 'none').length,
      total:    groupStudents.length,
    };
  }, [marks, groupStudents]);

  // ── Start session ─────────────────────────────────────────
  const handleStartSession = useCallback(() => {
    if (!selectedGroup) { toast.warning('اختر مجموعة أولاً'); return; }
    // Pre-fill from existing session if any
    const init = {};
    groupStudents.forEach(s => { init[s.id] = 'present'; }); // default all present
    existingSession.forEach(r => { init[r.studentId] = r.status; });
    setMarks(init);
    setStep('marking');
  }, [selectedGroup, groupStudents, existingSession, toast]);

  // ── Mark all ──────────────────────────────────────────────
  const markAll = useCallback((status) => {
    const updated = {};
    groupStudents.forEach(s => { updated[s.id] = status; });
    setMarks(updated);
  }, [groupStudents]);

  // ── Change single student ─────────────────────────────────
  const setMark = useCallback((studentId, status) => {
    setMarks(prev => ({ ...prev, [studentId]: status }));
  }, []);

  // ── Save session ──────────────────────────────────────────
  // Phase 3B-4 (تحضيري): PostgreSQL هو مصدر الحقيقة الآن — الحفظ يذهب للخادم أولاً
  // (معاملة ذرّية واحدة تستبدل الجلسة بالكامل)، ولا يُطبَّق أي تغيير على الحالة
  // المحلية إلا بعد نجاح الخادم. الـ id/created_at الفعليين يأتيان من الاستجابة.
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const records = Object.entries(marks)
        .filter(([, status]) => status && status !== 'none')
        .map(([studentId, status]) => ({ studentId, status }));

      const saved = await pgSaveAttendanceSession(selectedGroup, sessionDate, sessionTime, records);

      setAttendance(prev => [
        ...prev.filter(r => !(r.groupId === selectedGroup && r.date === sessionDate)),
        ...saved.records,
      ]);

      addLog({
        action:      'create',
        module:      'attendance',
        entityType:  'attendance',
        entityId:    selectedGroup,
        description: `حصة ${group?.name} — ${sessionDate} — ${saved.records.length} طالب`,
      }).catch((e) => toast.error(e.message || 'تعذّر تسجيل الحدث في سجل النشاط'));

      toast.success(`تم حفظ الحضور ✓  ${stats.present} حاضر · ${stats.absent} غائب · ${stats.late} متأخر`);
      setStep('done');
    } catch (err) {
      toast.error(err.message || 'فشل حفظ الحضور — حاول مرة أخرى');
    } finally {
      setSaving(false);
    }
  }, [marks, selectedGroup, sessionDate, sessionTime, setAttendance, addLog, currentUser, group, stats, toast]);

  const reset = useCallback(() => {
    setStep('setup'); setSelectedGroup(''); setMarks({});
    setSessionDate(new Date().toISOString().split('T')[0]);
    setSearch('');
  }, []);

  const INP_STYLE = {
    background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9,
    padding:'9px 13px', color:'var(--text)', fontFamily:'Cairo,sans-serif',
    fontSize:'0.875rem', outline:'none', direction:'rtl',
  };
  const INP_EVENTS = {
    onFocus: e => { e.target.style.borderColor='var(--accent)'; e.target.style.boxShadow='0 0 0 3px rgba(13,148,136,.12)'; e.target.style.background='var(--surface3)'; },
    onBlur:  e => { e.target.style.borderColor='var(--border)'; e.target.style.boxShadow='none'; e.target.style.background='var(--surface2)'; },
  };
  const INP = { ...INP_STYLE, ...INP_EVENTS };

  // ════════════════════════════════════════════════════════
  // STEP: SETUP
  // ════════════════════════════════════════════════════════
  if (step === 'setup') {
    return (
      <div style={{ maxWidth:560, margin:'0 auto' }}>
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden' }}>
          {/* Header */}
          <div style={{ padding:'20px 24px 16px', borderBottom:'1px solid var(--border)', background:'var(--surface2)' }}>
            <div style={{ fontSize:'1.05rem', fontWeight:800, marginBottom:4 }}>فتح حصة جديدة</div>
            <div style={{ fontSize:'0.78rem', color:'var(--text3)' }}>اختر المجموعة والتاريخ ثم ابدأ التسجيل</div>
          </div>

          <div style={{ padding:'22px 24px', display:'flex', flexDirection:'column', gap:16 }}>
            {/* Group select */}
            <div>
              <label style={{ display:'block', fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>
                المجموعة *
              </label>
              <select value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)} style={{ ...INP_STYLE, width:'100%', cursor:'pointer' }} {...INP_EVENTS}>
                <option value="">اختر المجموعة...</option>
                {groups.map(g => {
                  const count = students.filter(s => s.groupId === g.id && s.status === 'active').length;
                  return <option key={g.id} value={g.id}>{g.name} ({count} طالب)</option>;
                })}
              </select>
            </div>

            {/* Date + Time */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div>
                <label style={{ display:'block', fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>التاريخ</label>
                <input type="date" value={sessionDate} onChange={e => setSessionDate(e.target.value)} style={{ ...INP_STYLE, width:'100%' }} {...INP_EVENTS}/>
              </div>
              <div>
                <label style={{ display:'block', fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>وقت الحصة</label>
                <input type="time" value={sessionTime} onChange={e => setSessionTime(e.target.value)} style={{ ...INP_STYLE, width:'100%' }} {...INP_EVENTS}/>
              </div>
            </div>

            {/* Preview */}
            {selectedGroup && (
              <div style={{ background:'var(--surface2)', borderRadius:12, padding:'14px 16px', fontSize:'0.82rem' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                  <span style={{ color:'var(--text3)' }}>عدد الطلاب</span>
                  <span style={{ fontWeight:700, color:'var(--accent)', fontFamily:'Cairo,sans-serif' }}>{groupStudents.length}</span>
                </div>
                {existingSession.length > 0 && (
                  <div style={{ display:'flex', gap:8, padding:'8px 10px', background:'rgba(245,158,11,.1)', borderRadius:8, color:'#f59e0b', fontSize:'0.76rem' }}>
                    ⚠ توجد بيانات محفوظة لهذه الجلسة — ستُستبدل عند الحفظ
                  </div>
                )}
              </div>
            )}

            <Button variant="primary" onClick={handleStartSession}
              disabled={!selectedGroup}>
              ▶ بدء تسجيل الحضور
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  // STEP: DONE
  // ════════════════════════════════════════════════════════
  if (step === 'done') {
    return (
      <div style={{ maxWidth:480, margin:'0 auto', textAlign:'center', padding:'40px 20px' }}>
        <div style={{ fontSize:56, marginBottom:16 }}>✅</div>
        <div style={{ fontSize:'1.25rem', fontWeight:800, marginBottom:8 }}>تم حفظ سجل الحضور</div>
        <div style={{ fontSize:'0.85rem', color:'var(--text3)', marginBottom:24 }}>
          {group?.name} — {formatDate(sessionDate)}
        </div>
        <div style={{ display:'flex', gap:10, justifyContent:'center', marginBottom:28, flexWrap:'wrap' }}>
          {[
            { label:'حاضر',  value:stats.present, color:'#10b981' },
            { label:'غائب',  value:stats.absent,  color:'#ef4444' },
            { label:'متأخر', value:stats.late,    color:'#f59e0b' },
          ].map(s => (
            <div key={s.label} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:'14px 20px', textAlign:'center' }}>
              <div style={{ fontSize:'1.6rem', fontWeight:800, color:s.color, fontFamily:'Cairo,sans-serif' }}>{s.value}</div>
              <div style={{ fontSize:'0.72rem', color:'var(--text3)', marginTop:4 }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
          <Button variant="secondary" onClick={reset}>حصة جديدة</Button>
          <Button variant="ghost" onClick={onDone}>← العودة للتقارير</Button>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════
  // STEP: MARKING
  // ════════════════════════════════════════════════════════
  return (
    <div>
      {/* Session header */}
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, marginBottom:16, overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', flexWrap:'wrap', gap:10 }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ width:10, height:10, borderRadius:'50%', background:group?.color||'var(--accent)' }}/>
              <span style={{ fontWeight:800, fontSize:'1rem' }}>{group?.name}</span>
            </div>
            <div style={{ fontSize:'0.76rem', color:'var(--text3)', marginTop:2 }}>
              {formatDate(sessionDate)} — {sessionTime}
            </div>
          </div>
          <AttendanceStats {...stats} pct={stats.total > 0 ? Math.round((stats.present/stats.total)*100) : null}/>
        </div>

        {/* Progress bar */}
        <div style={{ height:4, background:'var(--surface3)' }}>
          <div style={{ height:'100%', display:'flex', gap:0, transition:'width .3s' }}>
            <div style={{ width:`${(stats.present/stats.total)*100}%`, background:'#10b981', transition:'width .3s' }}/>
            <div style={{ width:`${(stats.late/stats.total)*100}%`,    background:'#f59e0b', transition:'width .3s' }}/>
            <div style={{ width:`${(stats.absent/stats.total)*100}%`,  background:'#ef4444', transition:'width .3s' }}/>
          </div>
        </div>
      </div>

      {/* Controls row */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, flexWrap:'wrap' }}>
        {/* Search */}
        <div style={{ flex:1, minWidth:180, display:'flex', alignItems:'center', gap:8, background:'var(--surface2)', border:'1px solid var(--border)', borderRadius:9, padding:'0 11px' }}
          onFocusCapture={e => e.currentTarget.style.borderColor='var(--accent)'}
          onBlurCapture={e  => e.currentTarget.style.borderColor='var(--border)'}
        >
          <span style={{ color:'var(--text3)', fontSize:'0.85rem' }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث..."
            style={{ flex:1, background:'none', border:'none', outline:'none', color:'var(--text)', fontFamily:'Cairo,sans-serif', fontSize:'0.82rem', padding:'8px 0', direction:'rtl' }}/>
        </div>

        {/* Bulk actions */}
        <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
          <span style={{ fontSize:'0.72rem', color:'var(--text3)', alignSelf:'center', marginLeft:4 }}>تحديد الكل:</span>
          {['present','absent','late'].map(s => {
            const m = STATUS_META[s];
            return (
              <button key={s} onClick={() => markAll(s)}
                style={{ padding:'5px 12px', borderRadius:7, fontSize:'0.74rem', fontWeight:700, cursor:'pointer', transition:'all .12s', fontFamily:'Cairo,sans-serif', border:`1px solid ${m.border}`, background:m.bg, color:m.color }}
                onMouseOver={e => e.currentTarget.style.opacity='0.75'}
                onMouseOut={e  => e.currentTarget.style.opacity='1'}
              >
                {m.icon} {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Unmarked warning */}
      {stats.unmarked > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 14px', background:'rgba(245,158,11,.1)', border:'1px solid rgba(245,158,11,.2)', borderRadius:9, marginBottom:12, fontSize:'0.78rem', color:'#f59e0b' }}>
          ⚠ {stats.unmarked} طالب لم يُسجَّل بعد
        </div>
      )}

      {/* Students list */}
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden', marginBottom:16 }}>
        {filteredStudents.length === 0 ? (
          <div style={{ textAlign:'center', padding:'40px', color:'var(--text3)', fontSize:'0.85rem' }}>
            {search ? 'لا توجد نتائج' : 'لا يوجد طلاب في هذه المجموعة'}
          </div>
        ) : (
          filteredStudents.map((student, i) => (
            <StudentMarkRow
              key={student.id}
              student={student}
              status={marks[student.id] || 'none'}
              onStatusChange={status => setMark(student.id, status)}
              index={i}
            />
          ))
        )}
      </div>

      {/* Save bar */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'14px 18px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, flexWrap:'wrap', gap:12 }}>
        <div style={{ fontSize:'0.82rem', color:'var(--text2)' }}>
          <span style={{ color:'#10b981', fontWeight:700 }}>{stats.present}</span> حاضر ·{' '}
          <span style={{ color:'#f59e0b', fontWeight:700 }}>{stats.late}</span> متأخر ·{' '}
          <span style={{ color:'#ef4444', fontWeight:700 }}>{stats.absent}</span> غائب
          {stats.unmarked > 0 && <span style={{ color:'var(--text3)', marginRight:8 }}>· {stats.unmarked} لم يُسجَّل</span>}
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <Button variant="secondary" onClick={reset}>إلغاء</Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>
            💾 حفظ الجلسة
          </Button>
        </div>
      </div>
    </div>
  );
}
