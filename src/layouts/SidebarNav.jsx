// src/layouts/SidebarNav.jsx
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth.context';
import { useUI   } from '../store/ui.context';
import { SvgIcon } from './icons';

export default function SidebarNav({ sections, mobileOpen, onMobileClose }) {
  const { canAccess, currentUser, logout } = useAuth();
  const { currentPage, navigate, unreadNotifs } = useUI();
  const rrNavigate = useNavigate();
  const [collapsed, setCollapsed] = useState({});

  const toggleSection = useCallback((id) => {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleNavClick = useCallback((pageId) => {
    navigate(pageId); // updates UIContext currentPage
    const path = pageId === 'dashboard' ? '/' : `/${pageId}`;
    rrNavigate(path); // updates browser URL
    onMobileClose?.();
  }, [navigate, rrNavigate, onMobileClose]);

  return (
    <aside
      className="sidebar"
      style={mobileOpen
        ? { transform: 'translateX(0)' }
        : undefined
      }
    >
      {/* Logo */}
      <div className="sidebar-logo">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: 'var(--accent)', color: 'var(--surface)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 900, flexShrink: 0,
            fontFamily: 'Cairo, sans-serif', letterSpacing: -0.5,
          }}>Sx</div>
          <div>
            <div className="logo-title">Studix</div>
            <div className="logo-slogan">Learn. Track. Succeed.</div>
          </div>
        </div>
        <div className="logo-sub" style={{ marginTop: 6 }}>v2.0 · ERP</div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {sections.map(section => {
          const accessible = section.items.some(item => canAccess(item.id));
          if (!accessible) return null;
          const isCollapsed = collapsed[section.id];

          return (
            <div key={section.id} className="nav-section">
              <div className="nav-section-header" onClick={() => toggleSection(section.id)}>
                <span className="nav-section-title">{section.label}</span>
                <span className={`nav-section-arrow ${isCollapsed ? '' : 'open'}`}>›</span>
              </div>

              {!isCollapsed && (
                <div className="nav-section-items">
                  {section.items.map(item => {
                    if (!canAccess(item.id)) return null;
                    const isActive = currentPage === item.id;
                    const badge = item.id === 'notifications' ? unreadNotifs : 0;

                    return (
                      <div
                        key={item.id}
                        className={`nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => handleNavClick(item.id)}
                      >
                        <span className="nav-svg-icon">
                          <SvgIcon name={item.icon || item.id}/>
                        </span>
                        <span className="nav-item-label">{item.label}</span>
                        {badge > 0 && (
                          <span style={{
                            background: 'var(--red)', color: '#fff',
                            borderRadius: 10, minWidth: 18, height: 18,
                            padding: '0 5px', fontSize: 10, fontWeight: 700,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            marginRight: 'auto', flexShrink: 0,
                            animation: 'pulse 1.8s infinite',
                          }}>{badge}</span>
                        )}
                        {isActive && !badge && <span className="nav-active-dot"/>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <div style={{ padding: '8px 10px', background: 'var(--surface2)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--accent), var(--accent2, var(--accent)))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, color: 'var(--surface)', flexShrink: 0,
            }}>
              {currentUser?.name?.[0] || '؟'}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{currentUser?.name || 'مستخدم'}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>{currentUser?.role}</div>
            </div>
          </div>
          <button
            onClick={logout}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 11, fontFamily: 'Cairo, sans-serif', fontWeight: 700 }}
          >
            خروج ←
          </button>
        </div>
      </div>
    </aside>
  );
}
