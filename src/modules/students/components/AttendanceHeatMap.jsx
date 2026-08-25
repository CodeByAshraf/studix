// src/modules/students/components/AttendanceHeatMap.jsx

const STATUS_STYLE = {
  present: { bg: '#10b981', label: 'حاضر'  },
  absent:  { bg: '#ef4444', label: 'غائب'  },
  late:    { bg: '#f59e0b', label: 'متأخر' },
  none:    { bg: 'var(--surface3)', label: '—' },
};

export default function AttendanceHeatMap({ records = [], maxCells = 12, size = 13 }) {
  // Fill to maxCells with 'none' placeholders
  const cells = [
    ...records.slice(-maxCells),
    ...Array(Math.max(0, maxCells - records.length)).fill({ status: 'none' }),
  ].slice(-maxCells);

  const presentCount = records.filter(r => r.status === 'present').length;
  const total        = records.length;
  const pct          = total > 0 ? Math.round(presentCount / total * 100) : null;
  const pctColor     = pct === null ? 'var(--text3)' : pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* Heat cells */}
      <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
        {cells.map((cell, i) => {
          const s = STATUS_STYLE[cell.status] || STATUS_STYLE.none;
          return (
            <div
              key={i}
              title={`${cell.date || ''}  ${s.label}`}
              style={{
                width:        size,
                height:       size,
                borderRadius: 2,
                background:   s.bg,
                cursor:       cell.status !== 'none' ? 'default' : 'default',
                transition:   'transform 0.1s',
              }}
              onMouseOver={e  => e.currentTarget.style.transform = 'scale(1.3)'}
              onMouseOut={e   => e.currentTarget.style.transform = 'scale(1)'}
            />
          );
        })}
      </div>

      {/* Percentage */}
      {pct !== null && (
        <span style={{
          fontSize:   '0.72rem',
          fontWeight: 700,
          color:      pctColor,
          fontFamily: 'Cairo, sans-serif',
          minWidth:   32,
        }}>
          {pct}%
        </span>
      )}
    </div>
  );
}
