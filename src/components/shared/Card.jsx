// src/components/shared/Card.jsx

export default function Card({ children, title, subtitle, actions, noPadding = false, style }) {
  const hasHeader = title || actions;
  return (
    <div className="card" style={style}>
      {hasHeader && (
        <div className="card-header">
          <div>
            {title    && <div className="card-title">{title}</div>}
            {subtitle && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{subtitle}</div>}
          </div>
          {actions && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {actions}
            </div>
          )}
        </div>
      )}
      {noPadding ? children : <div className="card-body">{children}</div>}
    </div>
  );
}

export function CardSection({ children, title, style }) {
  return (
    <div style={{ padding: '0 20px 16px', ...style }}>
      {title && (
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}
