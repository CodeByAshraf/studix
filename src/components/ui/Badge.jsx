// src/components/ui/Badge.jsx — Tailwind migrated
import { memo } from 'react';

const COLORS = {
  green:  { bg: 'rgba(16,185,129,.12)',  color: '#10b981', border: 'rgba(16,185,129,.25)' },
  red:    { bg: 'rgba(239,68,68,.12)',   color: '#ef4444', border: 'rgba(239,68,68,.25)'  },
  orange: { bg: 'rgba(245,158,11,.12)',  color: '#f59e0b', border: 'rgba(245,158,11,.25)' },
  blue:   { bg: 'rgba(59,130,246,.12)',  color: '#3b82f6', border: 'rgba(59,130,246,.25)' },
  purple: { bg: 'rgba(139,92,246,.12)',  color: '#8b5cf6', border: 'rgba(139,92,246,.25)' },
  gray:   { bg: 'rgba(148,163,184,.12)', color: '#94a3b8', border: 'rgba(148,163,184,.25)'},
};

const Badge = memo(function Badge({ label, color = 'gray', icon, dot = false }) {
  const c = COLORS[color] || COLORS.gray;
  return (
    <span
      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-badge
                 text-xs font-bold border"
      style={{ background: c.bg, color: c.color, borderColor: c.border }}
    >
      {dot && (
        <span className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: c.color }} />
      )}
      {icon && <span>{icon}</span>}
      {label}
    </span>
  );
});

export default Badge;
