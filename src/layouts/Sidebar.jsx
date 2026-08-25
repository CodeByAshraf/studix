// src/layouts/Sidebar.jsx
// Production-grade RTL sidebar with collapse, mobile drawer, tooltips
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth.context';
import { useUI   } from '../store/ui.context';
import { NAV_ITEMS, NAV_SECTIONS } from '../constants/nav';
import SidebarLogo      from './components/SidebarLogo';
import SidebarSection   from './components/SidebarSection';
import SidebarItem      from './components/SidebarItem';

const SIDEBAR_WIDTH    = 256;
const SIDEBAR_COLLAPSED = 72;

// يربط عنصر التنقّل بصلاحية الصفحة. معظم الـ ids تطابق pageId مباشرة؛ الاستثناءات:
// تقرير الطالب ومركز التواصل يتبعان صلاحية "students" (نفس ProtectedRoute pageId في
// App.jsx)، ومخزون المواد يتبع صلاحية "materials" (نفس pageId="materials" هناك أيضاً).
// بدون هذه الخريطة، canAccess(item.id) كان سيبحث عن صلاحية باسم "communication"/
// "inventory" غير موجودة إطلاقاً في أي دور — العنصران كانا سيبقيان مخفيَّين حتى بعد
// إضافتهما إلى NAV_ITEMS.
const PAGE_ID_OVERRIDES = { 'student-report': 'students', communication: 'students', inventory: 'materials' };

export default function Sidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onMobileClose,
}) {
  const { currentUser, logout, canAccess, isAdmin } = useAuth();
  const { currentPage, navigate } = useUI();
  const rrNavigate = useNavigate();

  // adminOnly (مثال: وصول الدعم الفني) يتحقّق من isAdmin مباشرة، لا من canAccess/مصفوفة
  // الصلاحيات القابلة للتفويض — نفس السبب بالضبط الذي جعل الخادم يحرس ذلك المسار بـ
  // requireRole('admin') بدل requirePermission العادي: قدرة حسّاسة لا يجوز أن تصبح
  // قابلة للتفويض لدور غير admin بمجرّد تعديل صلاحيات ذلك الدور.
  const canSeeItem = useCallback((item) => {
    if (item.adminOnly) return isAdmin;
    const pageId = PAGE_ID_OVERRIDES[item.id] ?? item.id;
    return canAccess(pageId);
  }, [canAccess, isAdmin]);

  const handleNavigate = useCallback((pageId) => {
    navigate(pageId);
    const path = pageId === 'dashboard' ? '/' : `/${pageId}`;
    rrNavigate(path);
    onMobileClose?.();
  }, [navigate, rrNavigate, onMobileClose]);

  // Build grouped sections
  const topItems     = NAV_SECTIONS['__top__'] || [];
  const sectionKeys  = Object.keys(NAV_SECTIONS).filter(k => k !== '__top__');

  const sidebarStyle = {
    position:        'fixed',
    top:             0,
    right:           0,
    width:           collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH,
    height:          '100vh',
    background:      'var(--surface)',
    borderLeft:      '1px solid var(--border)',
    display:         'flex',
    flexDirection:   'column',
    zIndex:          200,
    overflow:        'hidden',
    transition:      'width 0.28s cubic-bezier(0.4,0,0.2,1)',
    // Mobile: slide in from right
    '@media (max-width: 768px)': {
      right:      mobileOpen ? 0 : -SIDEBAR_WIDTH,
      width:      SIDEBAR_WIDTH,
      boxShadow:  mobileOpen ? '0 0 40px rgba(0,0,0,0.5)' : 'none',
    },
  };

  return (
    <>
      <aside style={{
        position:   'fixed',
        top:        0,
        right:      0,
        width:      collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH,
        height:     '100vh',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
        display:    'flex',
        flexDirection: 'column',
        zIndex:     200,
        overflow:   'hidden',
        transition: 'width 0.28s cubic-bezier(0.4,0,0.2,1)',
        // On mobile: hidden until open
        ...(typeof window !== 'undefined' && window.innerWidth <= 768 ? {
          width:     SIDEBAR_WIDTH,
          right:     mobileOpen ? 0 : -SIDEBAR_WIDTH - 10,
          boxShadow: mobileOpen ? '0 0 40px rgba(0,0,0,0.6)' : 'none',
          transition:'right 0.28s cubic-bezier(0.4,0,0.2,1)',
        } : {}),
      }}>

        {/* ── Brand header ─────────────────────────── */}
        <div style={{
          height:      64,
          borderBottom: '1px solid var(--border)',
          flexShrink:  0,
          display:     'flex',
          alignItems:  'center',
        }}>
          <SidebarLogo collapsed={collapsed}/>
        </div>

        {/* ── Navigation ───────────────────────────── */}
        <nav style={{
          flex:       1,
          overflowY:  'auto',
          overflowX:  'hidden',
          padding:    '8px 0',
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--border) transparent',
        }}>

          {/* Top-level items (no section label) */}
          {topItems.filter(canSeeItem).map(item => (
            <SidebarItem
              key={item.id}
              item={item}
              isActive={currentPage === item.id}
              collapsed={collapsed}
              onClick={() => handleNavigate(item.id)}
            />
          ))}

          {/* Sectioned items */}
          {sectionKeys.map(sectionLabel => {
            const visibleItems = NAV_SECTIONS[sectionLabel].filter(canSeeItem);
            if (visibleItems.length === 0) return null;
            return (
            <div key={sectionLabel}>
              <SidebarSection label={sectionLabel} collapsed={collapsed}/>
              {visibleItems.map(item => (
                <SidebarItem
                  key={item.id}
                  item={item}
                  isActive={currentPage === item.id}
                  collapsed={collapsed}
                  onClick={() => handleNavigate(item.id)}
                />
              ))}
            </div>
            );
          })}

        </nav>

        {/* ── Footer ───────────────────────────────── */}
        <div style={{
          padding:    '10px 8px 12px',
          borderTop:  '1px solid var(--border)',
          flexShrink: 0,
        }}>
          {/* User row */}
          <div
            style={{
              display:     'flex',
              alignItems:  'center',
              gap:         10,
              padding:     '8px 10px',
              borderRadius: 10,
              cursor:      'pointer',
              overflow:    'hidden',
              transition:  'background 0.15s ease',
            }}
            onMouseOver={e  => e.currentTarget.style.background = 'var(--surface2)'}
            onMouseOut={e   => e.currentTarget.style.background = 'transparent'}
          >
            {/* Avatar */}
            <div style={{
              width:          34,
              height:         34,
              borderRadius:   '50%',
              background:     'linear-gradient(135deg,#6366f1,#8b5cf6)',
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              fontSize:       '0.78rem',
              fontWeight:     700,
              color:          '#fff',
              flexShrink:     0,
              border:         '2px solid var(--border2)',
            }}>
              {(currentUser?.name || 'م').split(' ').map(w => w[0]).slice(0, 2).join('')}
            </div>

            {/* Name + role — hidden when collapsed */}
            <div style={{
              flex:       1,
              overflow:   'hidden',
              opacity:    collapsed ? 0 : 1,
              width:      collapsed ? 0 : 'auto',
              transition: 'opacity 0.2s ease, width 0.25s ease',
              whiteSpace: 'nowrap',
            }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text)' }}>
                {currentUser?.name || 'سكرتيرة المركز'}
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text3)', marginTop: 1 }}>
                {currentUser?.role || 'مدير النظام'}
              </div>
            </div>

            {/* Logout icon */}
            {!collapsed && (
              <button
                onClick={e => { e.stopPropagation(); logout(); }}
                title="تسجيل الخروج"
                style={{
                  color:      'var(--text3)',
                  fontSize:   '0.75rem',
                  padding:    4,
                  borderRadius: 6,
                  transition: 'all 0.15s',
                  flexShrink: 0,
                }}
                onMouseOver={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = 'var(--red)'; }}
                onMouseOut={e  => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text3)'; }}
              >
                ←
              </button>
            )}
          </div>

          {/* Collapse toggle */}
          <button
            onClick={onToggleCollapse}
            title={collapsed ? 'توسيع القائمة' : 'طي القائمة'}
            style={{
              width:          '100%',
              marginTop:      6,
              padding:        '6px 0',
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              gap:            6,
              borderRadius:   8,
              color:          'var(--text3)',
              fontSize:       '0.78rem',
              fontWeight:     600,
              transition:     'all 0.15s ease',
            }}
            onMouseOver={e => { e.currentTarget.style.background = 'var(--surface2)'; e.currentTarget.style.color = 'var(--text)'; }}
            onMouseOut={e  => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text3)'; }}
          >
            <span style={{
              display:         'inline-block',
              transform:       collapsed ? 'rotate(180deg)' : 'rotate(0deg)',
              transition:      'transform 0.25s ease',
              fontSize:        '0.9rem',
            }}>
              ‹
            </span>
            {!collapsed && <span>طي القائمة</span>}
          </button>
        </div>

      </aside>
    </>
  );
}
