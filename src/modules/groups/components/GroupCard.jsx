// src/modules/groups/components/GroupCard.jsx
// ✅ MIGRATED: inline styles → Tailwind + CSS variables
// Before: 169 lines with 40+ style={{ }} objects
// After:  ~120 lines, readable, cacheable, no runtime object allocation
import { useMemo, memo } from 'react';
import { useAppStore }   from '../../../store/app.store';
import { getGroupStats, formatDays } from '../../../services/groupService';
import { formatCurrency }            from '../../../utils/helpers';

// ── Sub-components — still memoized for perf ─────────────────
const CapacityBar = memo(function CapacityBar({ pct, color, isFull, isAlmostFull }) {
  const barColor = isFull ? 'var(--red)' : isAlmostFull ? 'var(--orange)' : color;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-surface3 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, background: barColor }}
        />
      </div>
      <span className="text-xs font-bold font-mono min-w-[30px] text-left"
            style={{ color: barColor }}>{pct}%</span>
    </div>
  );
});

const StatChip = memo(function StatChip({ label, value, color = 'var(--text2)' }) {
  return (
    <div className="flex flex-col items-center bg-surface3 rounded-[9px] p-2 min-w-[56px]">
      <span className="text-base font-extrabold font-mono leading-none"
            style={{ color }}>{value}</span>
      <span className="text-[10px] text-text3 mt-1 font-semibold whitespace-nowrap">{label}</span>
    </div>
  );
});

// ── GroupCard ─────────────────────────────────────────────────
const GroupCard = memo(function GroupCard({ group, onEdit, onDelete, onViewStudents, onTransfer }) {
  const students   = useAppStore(s => s.students);
  const payments   = useAppStore(s => s.payments);
  const attendance = useAppStore(s => s.attendance);
  const treasuryTxn = useAppStore(s => s.treasuryTxn);

  const stats = useMemo(
    () => getGroupStats(group, students, payments, attendance, treasuryTxn),
    [group, students, payments, attendance, treasuryTxn]
  );

  const capacityPct     = stats.activeCount > 0 ? Math.round(stats.activeCount / group.max * 100) : 0;
  const isAlmostFull    = capacityPct >= 80 && !stats.isFull;
  const collectionColor = stats.collectionRate >= 80 ? 'var(--green)' : stats.collectionRate >= 50 ? 'var(--orange)' : 'var(--red)';

  return (
    <div className="bg-surface border border-border rounded-card overflow-hidden flex flex-col
                    transition-all duration-150 hover:-translate-y-0.5 hover:shadow-card">

      {/* Color stripe */}
      <div className="h-1" style={{ background: group.color }} />

      <div className="flex flex-col gap-3 p-4 flex-1">

        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-extrabold text-sm leading-tight truncate">{group.name}</div>
            <div className="text-xs text-text3 mt-0.5">{group.subject} · {group.grade}</div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button onClick={() => onEdit(group)}
              className="text-xs px-2.5 py-1 rounded-[7px] border border-border bg-surface2
                         text-text2 hover:bg-surface3 font-semibold transition-colors">
              ✎
            </button>
            <button onClick={() => onDelete(group)}
              className="text-xs px-2.5 py-1 rounded-[7px] border border-border bg-surface2
                         text-red hover:bg-red hover:text-white font-semibold transition-colors">
              ×
            </button>
          </div>
        </div>

        {/* Teacher + schedule */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs text-text2">
            <span>👤</span><span>{group.teacher || '—'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-text2">
            <span>🕐</span><span>{group.time} · {formatDays(group.days)}</span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex gap-2">
          <StatChip label="طالب"    value={stats.activeCount}
            color={stats.isFull ? 'var(--red)' : 'var(--text)'} />
          <StatChip label="تحصيل"   value={`${stats.collectionRate}%`} color={collectionColor} />
          <StatChip label="حضور %"  value={stats.attendancePct !== null ? `${stats.attendancePct}%` : '—'} />
        </div>

        {/* Capacity */}
        <CapacityBar pct={capacityPct} color={group.color} isFull={stats.isFull} isAlmostFull={isAlmostFull} />

        {/* Footer */}
        <div className="flex items-center justify-end pt-1 border-t border-border mt-auto">
          <div className="flex gap-1.5">
            <button onClick={() => onViewStudents(group)}
              className="text-xs px-3 py-1 rounded-[7px] bg-surface2 border border-border
                         text-text2 hover:bg-surface3 font-semibold transition-colors">
              الطلاب
            </button>
            {onTransfer && (
              <button onClick={() => onTransfer(group)}
                className="text-xs px-3 py-1 rounded-[7px] bg-surface2 border border-border
                           text-text2 hover:bg-surface3 font-semibold transition-colors">
                نقل
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
});

export default GroupCard;
