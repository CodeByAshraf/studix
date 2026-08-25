// src/layouts/Topbar.jsx
import { useState, useRef, useEffect, useCallback } from 'react';
import { useUI } from '../store/ui.context';
import { NAV_ITEMS } from '../constants/nav';
import NavIcon from './components/NavIcon';

const PAGE_LABELS = NAV_ITEMS.reduce((acc, item) => {
  acc[item.id] = item.label;
  return acc;
}, {});

export default function Topbar({ onMenuToggle, sidebarWidth }) {
  const { currentPage, unreadNotifs, navigate, theme, setTheme, notifications } = useUI();
  const [searchOpen,  setSearchOpen]  = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [notifOpen,   setNotifOpen]   = useState(false);
  const searchRef = useRef(null);
  const notifRef  = useRef(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Focus search on open
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const pageLabel = PAGE_LABELS[currentPage] || 'النظام';

  const themes = [
    { id: 'teal',     color: '#0d9488', label: 'تيل'   },
    { id: 'dark',     color: '#f5a623', label: 'ذهبي'  },
    { id: 'midnight', color: '#a78bfa', label: 'نيلي'  },
    { id: 'emerald',  color: '#10b981', label: 'زمردي' },
    { id: 'rose',     color: '#f43f5e', label: 'وردي'  },
    { id: 'light',    color: '#1a56db', label: 'فاتح'  },
  ];

  const recentNotifs = (notifications || []).filter(n => !n.read).slice(0, 5);

  return (
    <header style={{
      height:         64,
      background:     'var(--surface)',
      borderBottom:   '1px solid var(--border)',
      display:        'flex',
      alignItems:     'center',
      padding:        '0 20px',
      gap:            12,
      position:       'sticky',
      top:            0,
      zIndex:         100,
      boxShadow:      '0 1px 3px rgba(0,0,0,0.08)',
    }}>

      {/* ── Mobile hamburger ─────────────────── */}
      <button
        onClick={onMenuToggle}
        className="mobile-only"
        style={{
          display:        'none', // overridden by responsive CSS
          width:          36,
          height:         36,
          borderRadius:   10,
          alignItems:     'center',
          justifyContent: 'center',
          color:          'var(--text2)',
          transition:     'all 0.15s',
          flexShrink:     0,
        }}
        onMouseOver={e => { e.currentTarget.style.background = 'var(--surface2)'; e.currentTarget.style.color = 'var(--text)'; }}
        onMouseOut={e  => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text2)'; }}
      >
        <NavIcon name="menu" size={20}/>
      </button>

      {/* ── Breadcrumb ───────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text3)' }}>
        <span
          style={{ cursor: 'pointer', transition: 'color 0.15s' }}
          onClick={() => navigate('dashboard')}
          onMouseOver={e  => e.currentTarget.style.color = 'var(--accent)'}
          onMouseOut={e   => e.currentTarget.style.color = 'var(--text3)'}
        >
          النظام
        </span>
        <span style={{ opacity: 0.4, fontSize: '0.7rem' }}>›</span>
        <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.92rem' }}>
          {pageLabel}
        </span>
      </div>

      {/* ── Spacer ───────────────────────────── */}
      <div style={{ flex: 1 }}/>

      {/* ── Search bar ───────────────────────── */}
      <div style={{
        display:      'flex',
        alignItems:   'center',
        gap:          8,
        background:   searchOpen ? 'var(--surface3)' : 'var(--surface2)',
        border:       `1px solid ${searchOpen ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 99,
        padding:      '0 14px',
        height:       36,
        width:        searchOpen ? 280 : 200,
        transition:   'all 0.25s ease',
        cursor:       searchOpen ? 'text' : 'pointer',
        boxShadow:    searchOpen ? '0 0 0 3px rgba(13,148,136,0.12)' : 'none',
      }}
        onClick={() => setSearchOpen(true)}
      >
        <NavIcon name="search" size={15} style={{ color: 'var(--text3)', flexShrink: 0 }}/>
        <input
          ref={searchRef}
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onBlur={() => { if (!searchQuery) setSearchOpen(false); }}
          placeholder="بحث في النظام..."
          style={{
            flex:       1,
            background: 'transparent',
            border:     'none',
            outline:    'none',
            fontSize:   '0.82rem',
            color:      'var(--text)',
            direction:  'rtl',
          }}
        />
        {searchQuery && (
          <button
            onClick={e => { e.stopPropagation(); setSearchQuery(''); setSearchOpen(false); }}
            style={{ color: 'var(--text3)', fontSize: '1rem', lineHeight: 1 }}
          >×</button>
        )}
      </div>

      {/* ── Theme switcher ────────────────────── */}
      <div style={{ display: 'flex', gap: 4, padding: '0 4px' }}>
        {themes.map(t => (
          <button
            key={t.id}
            title={t.label}
            onClick={() => setTheme(t.id)}
            style={{
              width:       14,
              height:      14,
              borderRadius: '50%',
              background:  t.color,
              border:      theme === t.id ? '2px solid var(--text)' : '2px solid transparent',
              cursor:      'pointer',
              transition:  'transform 0.15s, border-color 0.15s',
              flexShrink:  0,
            }}
            onMouseOver={e => e.currentTarget.style.transform = 'scale(1.35)'}
            onMouseOut={e  => e.currentTarget.style.transform = theme === t.id ? 'scale(1.2)' : 'scale(1)'}
          />
        ))}
      </div>

      {/* ── Actions ──────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>

        {/* Notifications */}
        <div style={{ position: 'relative' }} ref={notifRef}>
          <button
            onClick={() => setNotifOpen(o => !o)}
            style={{
              width:          36,
              height:         36,
              borderRadius:   10,
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              color:          'var(--text2)',
              background:     notifOpen ? 'var(--surface2)' : 'transparent',
              transition:     'all 0.15s',
              position:       'relative',
            }}
            onMouseOver={e => { if (!notifOpen) { e.currentTarget.style.background = 'var(--surface2)'; e.currentTarget.style.color = 'var(--text)'; }}}
            onMouseOut={e  => { if (!notifOpen) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text2)'; }}}
          >
            <NavIcon name="bell" size={18}/>
            {unreadNotifs > 0 && (
              <span style={{
                position:   'absolute',
                top:        5,
                left:       6,
                width:      18,
                height:     18,
                borderRadius: '50%',
                background: 'var(--red)',
                color:      '#fff',
                fontSize:   '0.6rem',
                fontWeight: 700,
                display:    'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border:     '2px solid var(--surface)',
                fontFamily: 'Cairo, sans-serif',
              }}>
                {unreadNotifs > 9 ? '9+' : unreadNotifs}
              </span>
            )}
          </button>

          {/* Notifications dropdown */}
          {notifOpen && (
            <div style={{
              position:    'absolute',
              top:         'calc(100% + 8px)',
              left:        0,
              width:       320,
              background:  'var(--surface)',
              border:      '1px solid var(--border)',
              borderRadius: 14,
              boxShadow:   '0 8px 40px rgba(0,0,0,0.3)',
              zIndex:      999,
              animation:   'fadeDown 0.15s ease',
              overflow:    'hidden',
            }}>
              <style>{`@keyframes fadeDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}`}</style>
              <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 700 }}>الإشعارات</span>
                <button
                  onClick={() => { navigate('notifications'); setNotifOpen(false); }}
                  style={{ fontSize: '0.74rem', color: 'var(--accent)', fontWeight: 600 }}
                >
                  عرض الكل
                </button>
              </div>
              {recentNotifs.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text3)', fontSize: '0.82rem' }}>
                  لا توجد إشعارات جديدة
                </div>
              ) : (
                recentNotifs.map((n, i) => (
                  <div key={n.id || i} style={{
                    display:    'flex',
                    gap:        10,
                    padding:    '11px 16px',
                    borderBottom: '1px solid var(--border)',
                    cursor:     'pointer',
                    transition: 'background 0.12s',
                    background: !n.read ? 'rgba(13,148,136,0.04)' : 'transparent',
                  }}
                    onMouseOver={e => e.currentTarget.style.background = 'var(--surface2)'}
                    onMouseOut={e  => e.currentTarget.style.background = !n.read ? 'rgba(13,148,136,0.04)' : 'transparent'}
                  >
                    <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>
                      {n.type === 'absence' ? '🚫' : n.type === 'payment' ? '💰' : n.type === 'exam' ? '📝' : '📢'}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>{n.time}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 4px' }}/>

        {/* User pill */}
        <div
          style={{
            display:     'flex',
            alignItems:  'center',
            gap:         9,
            padding:     '4px 10px 4px 4px',
            borderRadius: 99,
            cursor:      'pointer',
            transition:  'background 0.15s',
          }}
          onClick={() => navigate('settings')}
          onMouseOver={e => e.currentTarget.style.background = 'var(--surface2)'}
          onMouseOut={e  => e.currentTarget.style.background = 'transparent'}
        >
          <div style={{
            width:          34,
            height:         34,
            borderRadius:   '50%',
            background:     'linear-gradient(135deg,#6366f1,#8b5cf6)',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            fontSize:       '0.75rem',
            fontWeight:     700,
            color:          '#fff',
            border:         '2px solid var(--border2)',
            flexShrink:     0,
          }}>سك</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.2 }}>سكرتيرة المركز</span>
            <span style={{ fontSize: '0.68rem', color: 'var(--text3)', lineHeight: 1.2 }}>مدير النظام</span>
          </div>
        </div>
      </div>
    </header>
  );
}
