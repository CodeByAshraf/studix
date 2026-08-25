// src/layouts/components/SidebarItem.jsx
import { useState, useRef, useEffect } from 'react';
import NavIcon from './NavIcon';
import NavBadge from './NavBadge';

export default function SidebarItem({ item, isActive, collapsed, onClick }) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipY, setTooltipY] = useState(0);
  const itemRef = useRef(null);

  const handleMouseEnter = () => {
    if (!collapsed) return;
    const rect = itemRef.current?.getBoundingClientRect();
    if (rect) setTooltipY(rect.top + rect.height / 2);
    setTooltipVisible(true);
  };

  return (
    <>
      <div
        ref={itemRef}
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={e => e.key === 'Enter' && onClick()}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setTooltipVisible(false)}
        style={{
          display:     'flex',
          alignItems:  'center',
          gap:         11,
          padding:     collapsed ? '10px 0' : '10px 14px',
          margin:      '1px 8px',
          borderRadius: 10,
          cursor:      'pointer',
          position:    'relative',
          overflow:    'hidden',
          justifyContent: collapsed ? 'center' : 'flex-start',
          // Active styling
          background:  isActive ? 'var(--accent-bg, rgba(13,148,136,0.12))' : 'transparent',
          color:       isActive ? 'var(--accent)' : 'var(--text2)',
          transition:  'all 0.15s ease',
          userSelect:  'none',
          outline:     'none',
        }}
        onFocus={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface2)'; }}
        onBlur={e  => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
        onMouseOver={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface2)'; e.currentTarget.style.color = 'var(--text)'; }}
        onMouseOut={e  => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text2)'; } }}
      >
        {/* Active indicator bar */}
        {isActive && (
          <span style={{
            position:    'absolute',
            right:       -8,
            top:         '50%',
            transform:   'translateY(-50%)',
            width:       3,
            height:      20,
            background:  'var(--accent)',
            borderRadius:'3px 0 0 3px',
          }}/>
        )}

        {/* Icon */}
        <span style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          width:          22,
          height:         22,
          flexShrink:     0,
          color:          'inherit',
        }}>
          <NavIcon name={item.icon} size={18}/>
        </span>

        {/* Label */}
        <span style={{
          fontSize:   '0.875rem',
          fontWeight: isActive ? 700 : 500,
          flex:       1,
          whiteSpace: 'nowrap',
          overflow:   'hidden',
          opacity:    collapsed ? 0 : 1,
          width:      collapsed ? 0 : 'auto',
          transition: 'opacity 0.2s ease, width 0.25s ease',
        }}>
          {item.label}
        </span>

        {/* Badge */}
        {item.badge && (
          <NavBadge
            count={item.badge.count}
            variant={item.badge.variant}
            collapsed={collapsed}
          />
        )}
      </div>

      {/* Tooltip when collapsed */}
      {collapsed && tooltipVisible && (
        <div
          style={{
            position:   'fixed',
            right:      80,
            top:        tooltipY,
            transform:  'translateY(-50%)',
            background: 'var(--surface3)',
            border:     '1px solid var(--border2)',
            color:      'var(--text)',
            fontSize:   '0.8rem',
            fontWeight: 600,
            padding:    '6px 12px',
            borderRadius: 8,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex:     9999,
            boxShadow:  '0 4px 20px rgba(0,0,0,0.3)',
            animation:  'tooltipSlide 0.12s ease',
          }}
        >
          {item.label}
          {item.badge && (
            <span style={{
              marginRight:  6,
              background:   'var(--accent)',
              color:        'var(--surface)',
              fontSize:     '0.6rem',
              padding:      '1px 5px',
              borderRadius: 99,
              fontFamily:   'Cairo, sans-serif',
            }}>
              {item.badge.count}
            </span>
          )}
          <style>{`@keyframes tooltipSlide{from{opacity:0;transform:translateY(-50%) translateX(6px)}to{opacity:1;transform:translateY(-50%) translateX(0)}}`}</style>
        </div>
      )}
    </>
  );
}
