// src/layouts/components/SidebarLogo.jsx

export default function SidebarLogo({ collapsed }) {
  return (
    <div style={{
      display:     'flex',
      alignItems:  'center',
      gap:         12,
      padding:     '0 16px',
      height:      '100%',
      overflow:    'hidden',
    }}>
      {/* Studix mark */}
      <div style={{
        width:          38,
        height:         38,
        borderRadius:   10,
        background:     'linear-gradient(135deg, var(--accent) 0%, var(--accent2) 100%)',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        flexShrink:     0,
        boxShadow:      '0 0 0 3px rgba(13,148,136,0.2)',
        fontFamily:     'Cairo, sans-serif',
        fontWeight:     900,
        fontSize:       15,
        color:          '#fff',
        letterSpacing:  -0.5,
      }}>
        Sx
      </div>

      {/* Text — fades out when collapsed */}
      <div style={{
        overflow:   'hidden',
        opacity:    collapsed ? 0 : 1,
        width:      collapsed ? 0 : 'auto',
        transition: 'opacity 0.25s ease, width 0.25s ease',
        whiteSpace: 'nowrap',
      }}>
        <div style={{
          fontSize:      '1.08rem',
          fontWeight:    900,
          color:         'var(--text)',
          lineHeight:    1,
          fontFamily:    "'Cairo', sans-serif",
          letterSpacing: -0.5,
        }}>
          Studix
        </div>
        <div style={{
          fontSize:      '0.6rem',
          color:         'var(--accent)',
          fontFamily:    "'Cairo', sans-serif",
          marginTop:     3,
          letterSpacing: 0.5,
          opacity:       0.8,
        }}>
          Learn. Track. Succeed.
        </div>
      </div>
    </div>
  );
}
