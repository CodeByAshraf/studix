// src/modules/attendance/components/AttendanceStats.jsx

export default function AttendanceStats({ present, absent, late, total, pct, compact = false }) {
  const pctColor = pct === null ? 'var(--text3)' : pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444';

  if (compact) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <div style={{ width:60, height:5, background:'var(--surface3)', borderRadius:99, overflow:'hidden' }}>
          <div style={{ height:'100%', width:`${pct||0}%`, background:pctColor, borderRadius:99, transition:'width .5s ease' }}/>
        </div>
        <span style={{ fontSize:'0.72rem', fontWeight:700, color:pctColor, fontFamily:'Cairo,sans-serif', minWidth:32 }}>
          {pct !== null ? `${pct}%` : '—'}
        </span>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
      {[
        { label:'حاضر', value:present, color:'#10b981', bg:'rgba(16,185,129,.1)' },
        { label:'غائب', value:absent,  color:'#ef4444', bg:'rgba(239,68,68,.1)'  },
        { label:'متأخر',value:late,    color:'#f59e0b', bg:'rgba(245,158,11,.1)' },
      ].map(s => (
        <div key={s.label} style={{
          display:'flex', alignItems:'center', gap:5,
          background:s.bg, padding:'4px 10px', borderRadius:99, fontSize:'0.72rem', fontWeight:700,
        }}>
          <span style={{ color:s.color }}>{s.value}</span>
          <span style={{ color:'var(--text3)' }}>{s.label}</span>
        </div>
      ))}
      <div style={{
        marginRight:4, padding:'4px 11px', borderRadius:99,
        background: pct !== null ? `${pctColor}18` : 'var(--surface3)',
        fontSize:'0.78rem', fontWeight:800,
        color: pctColor, fontFamily:'Cairo,sans-serif',
      }}>
        {pct !== null ? `${pct}%` : '—'}
      </div>
    </div>
  );
}
