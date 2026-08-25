// src/components/shared/EmptyState.jsx
import Button from '../ui/Button';

export default function EmptyState({ icon = '📋', title, subtitle, action, actionLabel }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      {title    && <div className="empty-text">{title}</div>}
      {subtitle && <div className="empty-sub">{subtitle}</div>}
      {action && (
        <Button variant="primary" style={{ marginTop: 12 }} onClick={action}>
          {actionLabel || 'إضافة جديد'}
        </Button>
      )}
    </div>
  );
}
