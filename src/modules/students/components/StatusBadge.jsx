// src/modules/students/components/StatusBadge.jsx

const STATUSES = {
  active:    { label: 'نشط',     bg: 'rgba(16,185,129,.1)',  color: '#10b981', border: 'rgba(16,185,129,.2)' },
  inactive:  { label: 'موقوف',   bg: 'rgba(245,158,11,.1)',  color: '#f59e0b', border: 'rgba(245,158,11,.2)' },
  graduated: { label: 'متخرج',   bg: 'rgba(59,130,246,.1)',  color: '#3b82f6', border: 'rgba(59,130,246,.2)'  },
};

export default function StatusBadge({ status, size = 'md' }) {
  const s = STATUSES[status] || STATUSES.inactive;
  const padding = size === 'sm' ? '2px 7px' : '3px 10px';
  const fontSize = size === 'sm' ? '0.65rem' : '0.7rem';

  return (
    <span style={{
      display:      'inline-flex',
      alignItems:   'center',
      gap:          4,
      padding,
      borderRadius: 99,
      fontSize,
      fontWeight:   700,
      background:   s.bg,
      color:        s.color,
      border:       `1px solid ${s.border}`,
      whiteSpace:   'nowrap',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: s.color }}/>
      {s.label}
    </span>
  );
}
