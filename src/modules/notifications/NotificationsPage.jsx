// src/modules/notifications/NotificationsPage.jsx
import { useState } from 'react';
import { useUI } from '../../store/ui.context';
import { PageHeader } from '../../components/shared';
import { Button, Badge } from '../../components/ui';
import { SectionBoundary } from '../../components/ErrorBoundary';

const TYPE_META = {
  absence:      { icon: '🚫', label: 'غياب',      badgeVariant: 'danger'  },
  payment:      { icon: '💰', label: 'مدفوعات',   badgeVariant: 'warning' },
  exam:         { icon: '📝', label: 'امتحانات',  badgeVariant: 'info'    },
  announcement: { icon: '📢', label: 'إعلانات',   badgeVariant: 'success' },
  system:       { icon: '⚙',  label: 'النظام',    badgeVariant: 'neutral' },
};

export default function NotificationsPage() {
  const { notifications, markNotifRead, markAllNotifsRead } = useUI();
  const [filterType, setFilterType] = useState('');
  const [filterRead, setFilterRead] = useState('');

  const filtered = notifications.filter(n => {
    if (filterType && n.type !== filterType) return false;
    if (filterRead === 'unread' && n.read)   return false;
    if (filterRead === 'read'   && !n.read)  return false;
    return true;
  });

  const unread = notifications.filter(n => !n.read).length;

  return (
    <div>
      <PageHeader
        title="مركز الإشعارات"
        subtitle={`${unread} غير مقروء`}
        actions={
          unread > 0 && (
            <Button variant="ghost" size="sm" onClick={markAllNotifsRead}>✓ قراءة الكل</Button>
          )
        }
      />

      <div style={{ padding: '0 28px' }}>
        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <select className="form-select" style={{ width: 'auto' }} value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">كل الأنواع</option>
            {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
          <select className="form-select" style={{ width: 'auto' }} value={filterRead} onChange={e => setFilterRead(e.target.value)}>
            <option value="">الكل</option>
            <option value="unread">غير مقروء</option>
            <option value="read">مقروء</option>
          </select>
        </div>

        <SectionBoundary label="Notifications List">
          <div className="card">
            {filtered.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🔔</div>
                <div className="empty-text">لا توجد إشعارات</div>
              </div>
            ) : (
              filtered.map(n => {
                const meta = TYPE_META[n.type] || TYPE_META.system;
                return (
                  <div
                    key={n.id}
                    onClick={() => markNotifRead(n.id)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 12,
                      padding: '14px 20px',
                      borderBottom: '1px solid var(--border)',
                      cursor: 'pointer',
                      background: n.read ? 'transparent' : 'rgba(var(--accent-rgb, 13,148,136), 0.03)',
                      transition: 'background 0.12s',
                      borderRight: n.read ? 'none' : '3px solid var(--accent)',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-row)'}
                    onMouseLeave={e => e.currentTarget.style.background = n.read ? 'transparent' : 'rgba(var(--accent-rgb,13,148,136),0.03)'}
                  >
                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                      {meta.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                        <span style={{ fontSize: 13.5, fontWeight: n.read ? 500 : 700, color: 'var(--text)' }}>{n.title}</span>
                        <Badge variant={meta.badgeVariant} dot={false}>{meta.label}</Badge>
                        {n.urgent && <Badge variant="danger" dot={false}>⚡ عاجل</Badge>}
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.6 }}>{n.body}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{n.time}</div>
                    </div>
                    {!n.read && (
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', marginTop: 6, flexShrink: 0 }}/>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </SectionBoundary>
      </div>
    </div>
  );
}
