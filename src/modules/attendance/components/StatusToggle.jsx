// src/modules/attendance/components/StatusToggle.jsx
// Tap once → present, tap again → absent, tap again → late, tap again → none
import { STATUS_META } from '../../../services/attendanceService';

const CYCLE = ['present', 'absent', 'late', 'none'];

export default function StatusToggle({ status = 'none', onChange, size = 'md' }) {
  const meta = STATUS_META[status] || STATUS_META.none;

  const handleClick = () => {
    const idx  = CYCLE.indexOf(status);
    const next = CYCLE[(idx + 1) % CYCLE.length];
    onChange?.(next);
  };

  const dim = size === 'lg' ? 44 : size === 'sm' ? 28 : 36;
  const fs  = size === 'lg' ? '1rem' : size === 'sm' ? '0.72rem' : '0.88rem';

  return (
    <button
      onClick={handleClick}
      title={`الحالة: ${meta.label} — اضغط للتغيير`}
      style={{
        width:          dim,
        height:         dim,
        borderRadius:   8,
        border:         `2px solid ${meta.border}`,
        background:     meta.bg,
        color:          meta.color,
        fontSize:       fs,
        fontWeight:     700,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        cursor:         'pointer',
        transition:     'all 0.12s cubic-bezier(0.4,0,0.2,1)',
        flexShrink:     0,
        fontFamily:     'Cairo, sans-serif',
        userSelect:     'none',
      }}
      onMouseOver={e  => e.currentTarget.style.transform='scale(1.1)'}
      onMouseOut={e   => e.currentTarget.style.transform='scale(1)'}
      onMouseDown={e  => e.currentTarget.style.transform='scale(0.94)'}
      onMouseUp={e    => e.currentTarget.style.transform='scale(1)'}
    >
      {meta.icon}
    </button>
  );
}

// Quick-set button (set specific status directly)
export function StatusQuickBtn({ label, status, active, onClick }) {
  const meta = STATUS_META[status];
  return (
    <button
      onClick={onClick}
      style={{
        padding:    '5px 14px',
        borderRadius: 7,
        fontSize:   '0.76rem',
        fontWeight: 700,
        cursor:     'pointer',
        transition: 'all 0.12s',
        fontFamily: 'Cairo, sans-serif',
        border:     `1.5px solid ${active ? meta.border : 'var(--border)'}`,
        background: active ? meta.bg : 'transparent',
        color:      active ? meta.color : 'var(--text3)',
      }}
      onMouseOver={e => { if (!active) { e.currentTarget.style.background = meta.bg; e.currentTarget.style.color = meta.color; e.currentTarget.style.borderColor = meta.border; }}}
      onMouseOut={e  => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text3)'; e.currentTarget.style.borderColor = 'var(--border)'; }}}
    >
      {meta.icon} {label || meta.label}
    </button>
  );
}
