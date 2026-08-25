// src/modules/attendance/AttendancePage.jsx
import { useState, useMemo }  from 'react';
import { useAppStore } from '../../store/app.store';
import { SectionBoundary }    from '../../components/ErrorBoundary';
import { getAttendanceStats, getFrequentAbsentees } from '../../services/attendanceService';
import SessionMarking          from './SessionMarking';
import AttendanceReports       from './AttendanceReports';
import AbsenceFollowup         from './AbsenceFollowup';
import QRAttendance            from './QRAttendance';

// ─────────────────────────────────────────────────────────────
const VIEWS = [
  { id:'session',  icon:'▶',  label:'تسجيل حصة'      },
  { id:'followup', icon:'📞', label:'متابعة الغياب'   },
  { id:'reports',  icon:'📊', label:'التقارير'          },
  { id:'qr',       icon:'📱', label:'QR (قريباً)',     badge:'beta' },
];

// ── KPI tile ─────────────────────────────────────────────────
function KPI({ icon, label, value, color = 'var(--text)', sub, onClick }) {
  return (
    <div style={{
      background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14,
      padding:'16px 18px', cursor:onClick?'pointer':'default', transition:'transform .12s, box-shadow .12s',
    }}
      onMouseOver={e => { if (onClick) { e.currentTarget.style.transform='translateY(-1px)'; e.currentTarget.style.boxShadow='0 4px 20px rgba(0,0,0,.2)'; }}}
      onMouseOut={e  => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=''; }}
      onClick={onClick}
    >
      <div style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize:'1.6rem', fontWeight:800, color, fontFamily:'Cairo,sans-serif', letterSpacing:'-0.4px', lineHeight:1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize:'0.7rem', color:'var(--text3)', marginTop:5 }}>{sub}</div>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
export default function AttendancePage() {
  const absenceFollowup      = useAppStore((s) => s.absenceFollowup);
  const attendance           = useAppStore((s) => s.attendance);
  const groups               = useAppStore((s) => s.groups);
  const students             = useAppStore((s) => s.students);
  const [view, setView] = useState('session');

  // ── Overview stats ────────────────────────────────────────
  const overview = useMemo(() => {
    const total   = attendance.length;
    const present = attendance.filter(r => r.status === 'present').length;
    const absent  = attendance.filter(r => r.status === 'absent').length;
    const late    = attendance.filter(r => r.status === 'late').length;
    const pct     = total ? Math.round(present / total * 100) : null;
    const sessions= [...new Set(attendance.map(r => `${r.groupId}-${r.date}`))].length;
    const absentees = getFrequentAbsentees(students, attendance, 3).length;
    const pendingFollowup = attendance.filter(r => r.status==='absent').filter(r => !absenceFollowup?.find(f => f.attendanceId===r.id)).length;
    return { total, present, absent, late, pct, sessions, absentees, pendingFollowup };
  }, [students, attendance, absenceFollowup]);

  const pctColor = overview.pct === null ? 'var(--text)'
    : overview.pct >= 80 ? '#10b981'
    : overview.pct >= 60 ? '#f59e0b'
    : '#ef4444';

  return (
    <div>
      {/* ── Page header ─────────────────────── */}
      <div style={{ padding:'0 28px', marginBottom:20 }}>
        <h1 style={{ fontSize:'1.35rem', fontWeight:800, letterSpacing:'-0.3px', marginBottom:3 }}>نظام الحضور</h1>
        <p style={{ fontSize:'0.78rem', color:'var(--text3)' }}>
          تسجيل الحضور اليدوي والتقارير التحليلية
        </p>
      </div>

      {/* ── KPI Overview ────────────────────── */}
      <SectionBoundary label="Attendance KPIs">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12, padding:'0 28px', marginBottom:24 }}>
          <KPI icon="✅" label="معدل الحضور"    value={overview.pct !== null ? `${overview.pct}%` : '—'} color={pctColor}/>
          <KPI icon="✓"  label="حاضر (إجمالي)" value={overview.present} color="#10b981"/>
          <KPI icon="✗"  label="غائب (إجمالي)" value={overview.absent}  color="#ef4444"/>
          <KPI icon="📅" label="عدد الجلسات"    value={overview.sessions}/>
          <KPI icon="📞" label="تحتاج متابعة"  value={overview.pendingFollowup} color={overview.pendingFollowup > 0 ? '#ef4444' : '#10b981'}
            onClick={overview.pendingFollowup > 0 ? () => setView('followup') : undefined}
            sub={overview.pendingFollowup > 0 ? 'اضغط للمتابعة' : 'تم متابعة الكل'}/>
          <KPI icon="⚠"  label="كثيرو الغياب"  value={overview.absentees} color={overview.absentees > 0 ? '#ef4444' : '#10b981'}
            onClick={() => setView('reports')}
            sub={overview.absentees > 0 ? 'اضغط للمتابعة' : 'لا يوجد'}/>
        </div>
      </SectionBoundary>

      {/* ── View switcher ────────────────────── */}
      <div style={{ display:'flex', gap:2, padding:'0 28px', marginBottom:22 }}>
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => setView(v.id)}
            style={{
              display:'flex', alignItems:'center', gap:6,
              padding:'10px 20px', borderRadius:10,
              fontSize:'0.88rem', fontWeight: view === v.id ? 700 : 500,
              cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .15s',
              border:`1.5px solid ${view === v.id ? 'var(--accent)' : 'var(--border)'}`,
              background: view === v.id ? 'rgba(13,148,136,.1)' : 'transparent',
              color:      view === v.id ? 'var(--accent)' : 'var(--text2)',
              position:   'relative',
            }}
            onMouseOver={e => { if (view !== v.id) { e.currentTarget.style.background='var(--surface2)'; e.currentTarget.style.color='var(--text)'; }}}
            onMouseOut={e  => { if (view !== v.id) { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='var(--text2)'; }}}
          >
            <span>{v.icon}</span>
            {v.label}
            {v.badge && (
              <span style={{ fontSize:'0.55rem', fontWeight:700, background:'rgba(245,158,11,.15)', color:'#f59e0b', padding:'1px 5px', borderRadius:4, fontFamily:'Cairo,sans-serif' }}>
                {v.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Content ──────────────────────────── */}
      <div style={{ padding:'0 28px 40px', animation:'pageIn .2s ease' }}>

        <SectionBoundary label={`attendance:${view}`}>
          {view === 'session'  && <SessionMarking onDone={() => setView('followup')}/>}
          {view === 'followup' && <AbsenceFollowup/>}
          {view === 'reports'  && <AttendanceReports/>}
          {view === 'qr'      && <QRAttendance/>}
        </SectionBoundary>
      </div>
    </div>
  );
}
