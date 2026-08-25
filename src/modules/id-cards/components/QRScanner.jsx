// src/modules/id-cards/components/QRScanner.jsx
// Simulates QR scanner — in production wire to react-qr-scanner or camera API
import { useAppStore } from '../../../store/app.store';
import { useAuth }     from '../../../store/auth.context';
import { useState, useCallback, useRef } from 'react';
import { useToast } from '../../../components/Toast';
import { formatDate } from '../../../utils/helpers';

const AV_PAL = [
  {bg:'rgba(59,130,246,.2)',color:'#3b82f6'},{bg:'rgba(16,185,129,.2)',color:'#10b981'},
  {bg:'rgba(245,158,11,.2)',color:'#f59e0b'},{bg:'rgba(139,92,246,.2)',color:'#8b5cf6'},
  {bg:'rgba(239,68,68,.2)', color:'#ef4444'},
];
const av = n => AV_PAL[((n?.charCodeAt(0)||0)+(n?.charCodeAt(1)||0))%AV_PAL.length];

export default function QRScanner() {
  const attendance           = useAppStore((s) => s.attendance);
  const groups               = useAppStore((s) => s.groups);
  const setAttendance        = useAppStore((s) => s.setAttendance);
  const students             = useAppStore((s) => s.students);
  const { currentUser } = useAuth();
  const toast = useToast();

  const [manualCode, setManualCode]   = useState('');
  const [lastScan,   setLastScan]     = useState(null);
  const [scanType,   setScanType]     = useState('present'); // 'present' | 'absent' | 'late'
  const [todayScans, setTodayScans]   = useState([]);
  const inputRef = useRef(null);

  const today = new Date().toISOString().split('T')[0];

  // Process a scanned/typed code
  const processCode = useCallback((code) => {
    if (!code?.trim()) return;

    let studentId = null;
    let studentObj = null;

    // Try to parse JSON payload first
    try {
      const payload = JSON.parse(code);
      if (payload.type === 'student') {
        studentId  = payload.id;
        studentObj = students.find(s => s.id === payload.id);
      }
    } catch {
      // Try direct code lookup
      studentObj = students.find(s =>
        s.code?.toLowerCase() === code.trim().toLowerCase() ||
        s.id === code.trim()
      );
      if (studentObj) studentId = studentObj.id;
    }

    if (!studentObj) {
      toast.error(`كود غير معروف: ${code}`);
      setLastScan({ error: true, code, time: new Date().toLocaleTimeString('ar-EG') });
      return;
    }

    // Check if already scanned today
    const existingToday = attendance.find(r =>
      r.studentId === studentId && r.date === today
    );

    if (existingToday) {
      toast.warning(`${studentObj.name} — تم تسجيله مسبقاً اليوم (${existingToday.status})`);
      setLastScan({ student:studentObj, existing:existingToday, time:new Date().toLocaleTimeString('ar-EG') });
      return;
    }

    // Record attendance
    const group = groups.find(g => g.id === studentObj.groupId);
    const newRecord = {
      id:          `att_qr_${Date.now()}`,
      studentId,
      groupId:     studentObj.groupId,
      date:        today,
      status:      scanType,
      sessionTime: new Date().toLocaleTimeString('ar-EG', { hour:'2-digit', minute:'2-digit' }),
      recordedBy:  currentUser?.name || 'QR Scanner',
      method:      'qr',
    };

    setAttendance(prev => [...prev, newRecord]);

    const scanEntry = {
      student:     studentObj,
      group,
      record:      newRecord,
      time:        newRecord.sessionTime,
      status:      scanType,
    };
    setLastScan(scanEntry);
    setTodayScans(prev => [scanEntry, ...prev].slice(0, 20));

    toast.success(`✓ ${studentObj.name} — ${scanType === 'present' ? 'تم تسجيل الحضور' : scanType === 'late' ? 'تسجيل متأخر' : 'تم التسجيل'}`);
    setManualCode('');
    inputRef.current?.focus();
  }, [students, groups, attendance, setAttendance, scanType, today, currentUser, toast]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') processCode(manualCode);
  };

  const STATUS_META = {
    present: { label:'حاضر',  color:'#10b981', bg:'rgba(16,185,129,.1)', icon:'✓' },
    late:    { label:'متأخر', color:'#f59e0b', bg:'rgba(245,158,11,.1)', icon:'⏱' },
    absent:  { label:'غائب',  color:'#ef4444', bg:'rgba(239,68,68,.1)',  icon:'✗' },
  };

  const todayStats = {
    present: todayScans.filter(s=>s.status==='present').length,
    late:    todayScans.filter(s=>s.status==='late').length,
    absent:  todayScans.filter(s=>s.status==='absent').length,
  };

  return (
    <div style={{ display:'flex', gap:20, flexWrap:'wrap', alignItems:'flex-start' }}>

      {/* ── Scanner Panel ──────────────────── */}
      <div style={{ flex:'0 0 300px', display:'flex', flexDirection:'column', gap:14 }}>

        {/* Scanner frame */}
        <div style={{
          background:'var(--surface)', border:'2px solid var(--accent)', borderRadius:16,
          padding:'20px', textAlign:'center',
          boxShadow:'0 0 0 4px rgba(13,148,136,.08)',
        }}>
          {/* Animated scanner visual */}
          <div style={{
            width:140, height:140, margin:'0 auto 16px',
            borderRadius:12, background:'var(--surface2)',
            display:'flex', alignItems:'center', justifyContent:'center',
            position:'relative', overflow:'hidden',
            border:'2px solid var(--accent)',
          }}>
            {/* Corner markers */}
            {['top:0,right:0','top:0,left:0','bottom:0,right:0','bottom:0,left:0'].map((pos,i) => {
              const [v,h] = pos.split(',');
              return <div key={i} style={{
                position:'absolute', [v]:0, [h]:0,
                width:16, height:16,
                borderTop: v==='top'   ? '3px solid var(--accent)' : 'none',
                borderBottom: v==='bottom' ? '3px solid var(--accent)' : 'none',
                borderRight:  h==='right'  ? '3px solid var(--accent)' : 'none',
                borderLeft:   h==='left'   ? '3px solid var(--accent)' : 'none',
              }}/>;
            })}
            {/* Scan line animation */}
            <div style={{
              position:'absolute', right:0, left:0, height:2,
              background:'linear-gradient(90deg, transparent, var(--accent), transparent)',
              animation:'scanLine 2s ease-in-out infinite',
            }}/>
            <span style={{ fontSize:36, opacity:.4 }}>📱</span>
          </div>

          <div style={{ fontSize:'0.82rem', fontWeight:700, marginBottom:4 }}>مسح QR Code</div>
          <div style={{ fontSize:'0.72rem', color:'var(--text3)', marginBottom:16 }}>
            ضع بطاقة الطالب أمام الكاميرا
          </div>

          {/* Manual input fallback */}
          <div style={{ fontSize:'0.68rem', color:'var(--text3)', marginBottom:8, fontWeight:600 }}>
            أو أدخل كود الطالب يدوياً:
          </div>
          <div style={{ display:'flex', gap:6 }}>
            <input
              ref={inputRef}
              value={manualCode}
              onChange={e => setManualCode(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="TC-2026-0001"
              autoFocus
              style={{
                flex:1, padding:'9px 11px', borderRadius:9,
                background:'var(--surface2)', border:'1px solid var(--border)',
                color:'var(--text)', fontFamily:'Cairo,sans-serif',
                fontSize:'0.82rem', outline:'none', direction:'ltr', textAlign:'center',
                transition:'border-color .15s',
              }}
              onFocus={e => e.target.style.borderColor='var(--accent)'}
              onBlur={e  => e.target.style.borderColor='var(--border)'}
            />
            <button onClick={() => processCode(manualCode)}
              style={{ padding:'9px 14px', borderRadius:9, border:'none', background:'var(--accent)', color:'var(--surface)', fontSize:'0.82rem', fontWeight:700, cursor:'pointer', fontFamily:'Cairo,sans-serif' }}
              onMouseOver={e => e.currentTarget.style.opacity='.85'}
              onMouseOut={e  => e.currentTarget.style.opacity='1'}>
              ✓
            </button>
          </div>
        </div>

        {/* Scan type selector */}
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, padding:'14px' }}>
          <div style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--text3)', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.06em' }}>
            نوع التسجيل
          </div>
          <div style={{ display:'flex', gap:6 }}>
            {Object.entries(STATUS_META).map(([k, m]) => (
              <button key={k} onClick={() => setScanType(k)}
                style={{ flex:1, padding:'8px 4px', borderRadius:9, fontSize:'0.72rem', fontWeight:700, cursor:'pointer', fontFamily:'Cairo,sans-serif', transition:'all .12s',
                  border:`2px solid ${scanType===k ? m.color : 'var(--border)'}`,
                  background: scanType===k ? m.bg : 'transparent',
                  color:      scanType===k ? m.color : 'var(--text3)',
                }}>
                {m.icon} {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Today stats */}
        <div style={{ display:'flex', gap:8 }}>
          {Object.entries(STATUS_META).map(([k, m]) => (
            <div key={k} style={{ flex:1, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:'10px', textAlign:'center' }}>
              <div style={{ fontSize:'1.3rem', fontWeight:800, color:m.color, fontFamily:'Cairo,sans-serif' }}>{todayStats[k]||0}</div>
              <div style={{ fontSize:'0.6rem', color:'var(--text3)', marginTop:3 }}>{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Result + Feed ──────────────────── */}
      <div style={{ flex:1, minWidth:260, display:'flex', flexDirection:'column', gap:14 }}>

        {/* Last scan result */}
        {lastScan && (
          <div style={{
            background:'var(--surface)', border:`2px solid ${lastScan.error ? '#ef4444' : lastScan.existing ? '#f59e0b' : '#10b981'}`,
            borderRadius:14, padding:'16px 18px',
            animation:'fadeIn .2s ease',
          }}>

            {lastScan.error ? (
              <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                <span style={{ fontSize:'1.6rem' }}>❌</span>
                <div>
                  <div style={{ fontWeight:800, color:'#ef4444' }}>كود غير معروف</div>
                  <div style={{ fontSize:'0.78rem', color:'var(--text3)', fontFamily:'Cairo,sans-serif' }}>{lastScan.code}</div>
                </div>
              </div>
            ) : lastScan.existing ? (
              <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                <span style={{ fontSize:'1.6rem' }}>⚠️</span>
                <div>
                  <div style={{ fontWeight:800, color:'#f59e0b' }}>تم التسجيل مسبقاً</div>
                  <div style={{ fontSize:'0.85rem', fontWeight:700 }}>{lastScan.student?.name}</div>
                  <div style={{ fontSize:'0.72rem', color:'var(--text3)' }}>الحالة: {STATUS_META[lastScan.existing.status]?.label} · {lastScan.existing.sessionTime}</div>
                </div>
              </div>
            ) : (
              <div style={{ display:'flex', gap:12, alignItems:'center' }}>
                {(() => { const { bg, color } = av(lastScan.student?.name||''); const l = (lastScan.student?.name||'').split(' ').map(w=>w[0]).slice(0,2).join('');
                  return <div style={{ width:48, height:48, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1rem', fontWeight:700, flexShrink:0 }}>{l}</div>;
                })()}
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:900, fontSize:'1rem', marginBottom:2 }}>{lastScan.student?.name}</div>
                  <div style={{ fontSize:'0.72rem', color:'var(--text3)', display:'flex', gap:10, flexWrap:'wrap' }}>
                    <span style={{ fontFamily:'Cairo,sans-serif' }}>{lastScan.student?.code}</span>
                    {lastScan.group && <span>{lastScan.group.name}</span>}
                  </div>
                </div>
                <div style={{ textAlign:'center' }}>
                  <div style={{ fontSize:'1.4rem', fontWeight:900, color:STATUS_META[lastScan.status]?.color }}>
                    {STATUS_META[lastScan.status]?.icon}
                  </div>
                  <div style={{ fontSize:'0.68rem', color:STATUS_META[lastScan.status]?.color, fontWeight:700 }}>{STATUS_META[lastScan.status]?.label}</div>
                  <div style={{ fontSize:'0.62rem', color:'var(--text3)', marginTop:2 }}>{lastScan.time}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Today's scan feed */}
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ fontWeight:700, fontSize:'0.88rem' }}>سجل اليوم — {formatDate(today)}</div>
            <span style={{ fontSize:'0.72rem', color:'var(--text3)', background:'var(--surface2)', padding:'2px 9px', borderRadius:99 }}>{todayScans.length}</span>
          </div>

          {todayScans.length === 0 ? (
            <div style={{ padding:'32px', textAlign:'center', color:'var(--text3)', fontSize:'0.82rem' }}>
              <div style={{ fontSize:32, opacity:.3, marginBottom:8 }}>📷</div>
              لم يُسجَّل حضور بعد اليوم
            </div>
          ) : (
            <div style={{ maxHeight:360, overflowY:'auto' }}>
              {todayScans.map((s, i) => {
                const { bg, color } = av(s.student?.name||'');
                const letters = (s.student?.name||'').split(' ').map(w=>w[0]).slice(0,2).join('');
                const meta = STATUS_META[s.status];
                return (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 16px', borderBottom:'1px solid var(--border)', transition:'background .1s' }}
                    onMouseOver={e=>e.currentTarget.style.background='var(--surface2)'}
                    onMouseOut={e =>e.currentTarget.style.background=''}
                  >
                    <div style={{ width:32, height:32, borderRadius:'50%', background:bg, color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.72rem', fontWeight:700, flexShrink:0 }}>{letters}</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:600, fontSize:'0.85rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.student?.name}</div>
                      <div style={{ fontSize:'0.66rem', color:'var(--text3)' }}>{s.group?.name||'—'} · {s.time}</div>
                    </div>
                    <span style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'3px 9px', borderRadius:99, fontSize:'0.68rem', fontWeight:700, background:meta.bg, color:meta.color, flexShrink:0 }}>
                      {meta.icon} {meta.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
