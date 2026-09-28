// src/modules/students/components/AttendDaysPicker.jsx
// Fix 2 — one enrollment's attendance days. Shows ONLY the group's own meeting days (never
// all 7), all selected by default. value/onChange use the stored attend_days shape: null =
// attends every day the group meets, otherwise the selected subset. The last selected day
// cannot be deselected, so an empty selection ([]) can never be produced.
import { DAYS_AR, groupMeetingDays, selectedAttendDays, toAttendDays } from '../../../services/groupService';

export default function AttendDaysPicker({ group, value, onChange, label = 'أيام الحضور' }) {
  const meeting = groupMeetingDays(group);
  if (!group) return null;
  if (meeting.length === 0) {
    return (
      <div style={{ fontSize:'0.72rem', color:'var(--text3)' }}>
        لم تُحدَّد أيام انعقاد لهذه المجموعة — عدّل المجموعة لإضافة أيامها.
      </div>
    );
  }

  const selected = selectedAttendDays(value, group);
  const toggle = (day) => {
    const next = selected.includes(day) ? selected.filter((d) => d !== day) : [...selected, day];
    if (next.length === 0) return; // at least one day always stays selected
    onChange(toAttendDays(next, group));
  };

  return (
    <div role="group" aria-label={label} style={{ display:'flex', flexDirection:'column', gap:6 }}>
      <div style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--text3)' }}>
        {label}{value == null && <span style={{ fontWeight:600, marginRight:6 }}>(كل أيام المجموعة)</span>}
      </div>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        {meeting.map((d) => {
          const active = selected.includes(d);
          return (
            <button key={d} type="button" onClick={() => toggle(d)} aria-pressed={active}
              style={{
                padding:'5px 11px', borderRadius:7, fontSize:'0.72rem', fontWeight:700,
                cursor:'pointer', fontFamily:'Cairo,sans-serif',
                border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'rgba(13,148,136,.12)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text3)',
              }}>
              {DAYS_AR[d]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
