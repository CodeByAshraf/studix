// src/modules/reports/components/ChartComponents.jsx
// المرحلة 4: Pure CSS + SVG charts — كل component مُغلَّف بـ memo
// لا تُعاد render إلا إذا تغيّرت props فعلاً
import { memo } from 'react';

// ── Shared helpers ───────────────────────────────────────────
export function formatK(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
  if (n >= 1000)    return (n/1000).toFixed(1) + 'k';
  return String(Math.round(n));
}

export function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

// ── KPI Metric card ─────────────────────────────────────────
export const MetricCard = memo(function MetricCard({ icon, label, value, sub, color = 'var(--accent)', trend, trendUp, onClick, style }) {
  return (
    <div onClick={onClick}
      style={{
        background:'var(--surface)', border:'1px solid var(--border)',
        borderRadius:14, padding:'18px 20px',
        cursor:onClick?'pointer':'default',
        transition:'transform .12s, box-shadow .12s',
        position:'relative', overflow:'hidden',
        ...style,
      }}
      onMouseOver={e => { if(onClick){e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 6px 24px rgba(0,0,0,.2)';} }}
      onMouseOut={e  => { e.currentTarget.style.transform='';e.currentTarget.style.boxShadow=''; }}
    >
      {/* Background accent glow */}
      <div style={{ position:'absolute', bottom:-20, left:-10, width:80, height:80, borderRadius:'50%', background:`${color}12`, pointerEvents:'none' }}/>
      <div style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:8 }}>
        {icon && <span style={{ marginLeft:5 }}>{icon}</span>}{label}
      </div>
      <div style={{ fontSize:'1.7rem', fontWeight:800, color, fontFamily:'Cairo,sans-serif', letterSpacing:'-0.5px', lineHeight:1, marginBottom:6 }}>
        {value ?? '—'}
      </div>
      {sub && <div style={{ fontSize:'0.7rem', color:'var(--text3)' }}>{sub}</div>}
      {trend && (
        <div style={{ fontSize:'0.72rem', fontWeight:700, marginTop:6, color: trendUp === true ? '#10b981' : trendUp === false ? '#ef4444' : 'var(--text3)' }}>
          {trend}
        </div>
      )}
    </div>
  );
}
);

// ── Bar chart (horizontal or vertical) ──────────────────────
export const BarChart = memo(function BarChart({
  data = [],           // [{label, value, color?}]
  maxValue,
  height = 160,
  horizontal = false,
  showValues = true,
  labelWidth = 110,
  gap = 6,
  barColor = 'var(--accent)',
}) {
  const max = maxValue || Math.max(...data.map(d => d.value), 1);

  if (horizontal) {
    return (
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {data.map((d, i) => {
          const pct = clamp(Math.round((d.value / max) * 100));
          const color = d.color || barColor;
          return (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ width:labelWidth, fontSize:'0.76rem', color:'var(--text2)', textAlign:'right', flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {d.label}
              </span>
              <div style={{ flex:1, height:8, background:'var(--surface3)', borderRadius:99, overflow:'hidden', position:'relative' }}>
                <div style={{ height:'100%', width:`${pct}%`, background:color, borderRadius:99, transition:'width .7s cubic-bezier(0.4,0,0.2,1)' }}/>
              </div>
              {showValues && (
                <span style={{ fontSize:'0.72rem', fontWeight:700, color, fontFamily:'Cairo,sans-serif', minWidth:40, textAlign:'left', flexShrink:0 }}>
                  {d.suffix ? `${d.value}${d.suffix}` : formatK(d.value)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Vertical
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap, height, padding:'0 4px' }}>
      {data.map((d, i) => {
        const pct = clamp(Math.round((d.value / max) * 100));
        const color = d.color || barColor;
        return (
          <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
            {showValues && (
              <span style={{ fontSize:'0.62rem', fontWeight:700, color, fontFamily:'Cairo,sans-serif', opacity: d.value > 0 ? 1 : 0 }}>
                {d.suffix ? `${d.value}${d.suffix}` : formatK(d.value)}
              </span>
            )}
            <div style={{ width:'100%', flex:1, display:'flex', alignItems:'flex-end' }}>
              <div style={{ width:'100%', height:`${pct}%`, minHeight: d.value > 0 ? 4 : 0, background:color+'40', borderRadius:'4px 4px 0 0', position:'relative', cursor:'default', transition:'background .15s' }}
                title={`${d.label}: ${d.value}`}
                onMouseOver={e  => e.currentTarget.style.background = color+'70'}
                onMouseOut={e   => e.currentTarget.style.background = color+'40'}
              >
                <div style={{ position:'absolute', bottom:0, width:'100%', height:`${pct}%`, background:color, borderRadius:'3px 3px 0 0' }}/>
              </div>
            </div>
            <span style={{ fontSize:'0.6rem', color:'var(--text3)', textAlign:'center', maxWidth:'100%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
);

// ── Donut chart ──────────────────────────────────────────────
export const DonutChart = memo(function DonutChart({ segments = [], size = 100, centerLabel, centerValue, centerColor = 'var(--accent)' }) {
  // segments: [{value, color, label}]
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (!total) return <div style={{ width:size, height:size, borderRadius:'50%', background:'var(--surface3)', display:'flex', alignItems:'center', justifyContent:'center' }}>—</div>;

  // Build conic-gradient
  let acc = 0;
  const stops = segments.map(seg => {
    const pct = (seg.value / total) * 100;
    const from = acc;
    acc += pct;
    return `${seg.color} ${from.toFixed(1)}% ${acc.toFixed(1)}%`;
  });

  const inner = size * 0.58;

  return (
    <div style={{ position:'relative', width:size, height:size, flexShrink:0 }}>
      <div style={{ width:size, height:size, borderRadius:'50%', background:`conic-gradient(${stops.join(', ')})` }}/>
      {/* Inner circle */}
      <div style={{
        position:'absolute',
        top:  (size - inner) / 2,
        left: (size - inner) / 2,
        width:  inner,
        height: inner,
        borderRadius:'50%',
        background:'var(--surface)',
        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      }}>
        {centerValue && <div style={{ fontSize:size*0.14, fontWeight:800, color:centerColor, fontFamily:'Cairo,sans-serif', lineHeight:1 }}>{centerValue}</div>}
        {centerLabel && <div style={{ fontSize:size*0.1, color:'var(--text3)', marginTop:2 }}>{centerLabel}</div>}
      </div>
    </div>
  );
}
);

// ── Spark line (SVG) ─────────────────────────────────────────
export const SparkLine = memo(function SparkLine({ data = [], width = 200, height = 50, color = 'var(--accent)', fill = true }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return [x, y];
  });
  const pathD = pts.map((p, i) => `${i===0?'M':'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const fillD = `${pathD} L${width},${height} L0,${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow:'visible' }}>
      {fill && <path d={fillD} fill={color} fillOpacity={0.12}/>}
      <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
      {/* Last point dot */}
      <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r={3} fill={color}/>
    </svg>
  );
}
);

// ── Progress ring ────────────────────────────────────────────
export const ProgressRing = memo(function ProgressRing({ pct, size = 60, stroke = 5, color = '#10b981', bg = 'var(--surface3)', label }) {
  const r   = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const off  = circ - (clamp(pct) / 100) * circ;
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
      <svg width={size} height={size} style={{ transform:'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={bg} strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
          style={{ transition:'stroke-dashoffset .6s ease' }}/>
      </svg>
      {label && <span style={{ fontSize:'0.62rem', color:'var(--text3)', fontWeight:600 }}>{label}</span>}
    </div>
  );
}
);

// ── Heat calendar row ────────────────────────────────────────
export const HeatRow = memo(function HeatRow({ cells = [], size = 12, gap = 3 }) {
  const STATUS_COLORS = { present:'#10b981', absent:'#ef4444', late:'#f59e0b', none:'var(--surface3)' };
  return (
    <div style={{ display:'flex', gap, alignItems:'center', flexWrap:'wrap' }}>
      {cells.map((cell, i) => (
        <div key={i}
          title={`${cell.date||''} — ${cell.status||'—'}`}
          style={{ width:size, height:size, borderRadius:2, background:STATUS_COLORS[cell.status]||STATUS_COLORS.none, transition:'transform .1s', cursor:'default' }}
          onMouseOver={e  => e.currentTarget.style.transform='scale(1.4)'}
          onMouseOut={e   => e.currentTarget.style.transform='scale(1)'}
        />
      ))}
    </div>
  );
}
);

// ── Stat row (label + bar + value) ──────────────────────────
export const StatRow = memo(function StatRow({ label, value, max, color = 'var(--accent)', suffix = '' }) {
  const pct = max > 0 ? clamp(Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
      <span style={{ width:120, fontSize:'0.76rem', color:'var(--text2)', textAlign:'right', flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{label}</span>
      <div style={{ flex:1, height:6, background:'var(--surface3)', borderRadius:99, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${pct}%`, background:color, borderRadius:99, transition:'width .6s ease' }}/>
      </div>
      <span style={{ fontSize:'0.72rem', fontWeight:700, color, fontFamily:'Cairo,sans-serif', minWidth:50, textAlign:'left', flexShrink:0 }}>
        {value}{suffix}
      </span>
    </div>
  );
}
);

// ── Section card wrapper ─────────────────────────────────────
export const AnalyticsCard = memo(function AnalyticsCard({ title, subtitle, actions, children, noPad }) {
  return (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', borderBottom:'1px solid var(--border)', flexWrap:'wrap', gap:8 }}>
        <div>
          <div style={{ fontSize:'0.9rem', fontWeight:800 }}>{title}</div>
          {subtitle && <div style={{ fontSize:'0.72rem', color:'var(--text3)', marginTop:2 }}>{subtitle}</div>}
        </div>
        {actions && <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>{actions}</div>}
      </div>
      <div style={noPad ? {} : { padding:'16px 18px' }}>{children}</div>
    </div>
  );
});
