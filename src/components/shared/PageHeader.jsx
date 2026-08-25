// src/components/shared/PageHeader.jsx

export default function PageHeader({ title, subtitle, actions, breadcrumb }) {
  return (
    <div className="page-header">
      {breadcrumb && (
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
          {breadcrumb.map((crumb, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {i > 0 && <span style={{ opacity: 0.4 }}>›</span>}
              <span
                style={{ cursor: crumb.onClick ? 'pointer' : 'default', color: crumb.onClick ? 'var(--accent)' : 'inherit' }}
                onClick={crumb.onClick}
              >
                {crumb.label}
              </span>
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="page-title">{title}</div>
          {subtitle && <div className="page-subtitle">{subtitle}</div>}
        </div>
        {actions && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
