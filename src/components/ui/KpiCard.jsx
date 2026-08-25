// src/components/ui/KpiCard.jsx — Tailwind migrated
import { memo } from 'react';

const KpiCard = memo(function KpiCard({
  icon, label, value, sub, color = 'var(--accent)', trend,
}) {
  const trendPositive = trend > 0;
  const trendNeutral  = trend === undefined || trend === null;

  return (
    <div className="bg-surface border border-border rounded-card p-4
                    flex flex-col gap-2 shadow-card">
      <div className="flex items-center justify-between">
        <div className="w-9 h-9 rounded-[9px] flex items-center justify-center text-lg shrink-0"
             style={{ background: `${color}18` }}>
          {icon}
        </div>
        {!trendNeutral && (
          <span className={`text-xs font-bold font-mono ${trendPositive ? 'text-green' : 'text-red'}`}>
            {trendPositive ? '▲' : '▼'} {Math.abs(trend)}%
          </span>
        )}
      </div>

      <div>
        <div className="text-2xl font-extrabold font-mono leading-none"
             style={{ color }}>{value}</div>
        <div className="text-xs text-text3 font-semibold mt-1">{label}</div>
        {sub && <div className="text-[11px] text-text3 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
});

export default KpiCard;

// ── KpiGrid — wrapper للـ KPI cards في الـ Dashboard ──────────
export const KpiGrid = memo(function KpiGrid({ children }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      gap: 12,
    }}>
      {children}
    </div>
  );
});
