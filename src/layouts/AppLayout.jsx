// src/layouts/AppLayout.jsx
import { useState, useEffect, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar  from './Topbar';

const SIDEBAR_WIDTH     = 256;
const SIDEBAR_COLLAPSED = 72;
const MOBILE_BREAKPOINT = 768;

// AppLayout now uses React Router <Outlet /> for nested routes
// children prop kept for backward compat
export default function AppLayout({ children }) {
  const [collapsed,  setCollapsed]  = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile,   setIsMobile]   = useState(false);

  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth <= MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      if (!mobile) setMobileOpen(false);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') setMobileOpen(false); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  const toggleCollapse = useCallback(() => setCollapsed(c => !c), []);
  const openMobile     = useCallback(() => setMobileOpen(true),   []);
  const closeMobile    = useCallback(() => setMobileOpen(false),  []);

  const sidebarWidth = isMobile ? 0 : (collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH);

  return (
    <div style={{ display:'flex', minHeight:'100vh', background:'var(--bg)', direction:'rtl' }}>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div onClick={closeMobile} style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,0.55)',
          zIndex:190, backdropFilter:'blur(3px)',
        }}/>
      )}

      <Sidebar
        collapsed={isMobile ? false : collapsed}
        onToggleCollapse={toggleCollapse}
        mobileOpen={mobileOpen}
        onMobileClose={closeMobile}
      />

      <div style={{
        flex:1, marginRight:sidebarWidth,
        display:'flex', flexDirection:'column',
        minHeight:'100vh', minWidth:0,
        transition:'margin-right 0.28s cubic-bezier(0.4,0,0.2,1)',
      }}>
        <Topbar onMenuToggle={isMobile ? openMobile : toggleCollapse}/>
        <main style={{ flex:1, padding:28, overflowY:'auto', animation:'pageReveal 0.22s ease' }}>
          <style>{`
            @keyframes pageReveal{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
            .mobile-only{display:none!important}
            @media(max-width:768px){.mobile-only{display:flex!important}}
          `}</style>
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  );
}
