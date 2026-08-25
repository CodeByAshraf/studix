// src/layouts/components/SidebarSection.jsx

export default function SidebarSection({ label, collapsed }) {
  return (
    <div style={{
      padding:       '14px 18px 4px',
      overflow:      'hidden',
      whiteSpace:    'nowrap',
    }}>
      {collapsed ? (
        /* Divider line when collapsed */
        <div style={{
          height:     1,
          background: 'var(--border)',
          margin:     '4px 4px',
          opacity:    0.5,
        }}/>
      ) : (
        <span style={{
          fontSize:      '0.62rem',
          fontWeight:    700,
          letterSpacing: '0.1em',
          color:         'var(--text3)',
          textTransform: 'uppercase',
          display:       'block',
        }}>
          {label}
        </span>
      )}
    </div>
  );
}
