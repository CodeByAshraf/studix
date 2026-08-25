// src/layouts/components/NavBadge.jsx

const BADGE_STYLES = {
  warning: {
    background: 'rgba(245,158,11,0.15)',
    color:      '#f59e0b',
    border:     '1px solid rgba(245,158,11,0.25)',
  },
  danger: {
    background: 'rgba(239,68,68,0.15)',
    color:      '#ef4444',
    border:     '1px solid rgba(239,68,68,0.25)',
  },
  accent: {
    background: 'var(--accent)',
    color:      'var(--surface)',
    border:     '1px solid transparent',
  },
  neutral: {
    background: 'var(--surface3)',
    color:      'var(--text2)',
    border:     '1px solid var(--border)',
  },
};

export default function NavBadge({ count, variant = 'neutral', collapsed = false }) {
  if (!count || count < 1) return null;

  const style = BADGE_STYLES[variant] || BADGE_STYLES.neutral;

  return (
    <span
      style={{
        ...style,
        display:        'inline-flex',
        alignItems:     'center',
        justifyContent: 'center',
        minWidth:        collapsed ? 8 : 20,
        height:          collapsed ? 8 : 20,
        padding:         collapsed ? 0 : '0 6px',
        borderRadius:    99,
        fontSize:        '0.62rem',
        fontWeight:      700,
        lineHeight:      1,
        marginRight:     'auto',
        flexShrink:      0,
        fontFamily:      'Cairo, sans-serif',
        transition:      'all 0.25s cubic-bezier(0.4,0,0.2,1)',
        overflow:        'hidden',
      }}
    >
      {collapsed ? '' : count > 99 ? '99+' : count}
    </span>
  );
}
